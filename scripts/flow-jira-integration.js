#!/usr/bin/env node

/**
 * Wogi Flow - Jira Integration
 *
 * Sync tasks between Wogi Flow and Jira. Supports:
 * - Listing assigned Jira issues
 * - Importing issues to ready.json
 * - Syncing completed tasks back to Jira
 *
 * Part of Phase 6: Team & Integrations
 *
 * Usage:
 *   flow jira list              List assigned issues
 *   flow jira sync              Import issues to ready.json
 *   flow jira push              Push completed tasks to Jira
 *   flow jira config            Show/set Jira configuration
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const {
  PROJECT_ROOT,
  STATE_DIR,
  parseFlags,
  color,
  info,
  warn,
  error,
  success,
  fileExists,
  safeJsonParse,
  getConfig,
  setConfigValue,
  resolveConfigValue,
  printHeader,
  generateTaskId,
  writeJson,
  getReadyData
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const READY_PATH = path.join(STATE_DIR, 'ready.json');
const JIRA_CACHE_PATH = path.join(STATE_DIR, 'jira-cache.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// Configuration
// ============================================================

/**
 * Get Jira configuration from config.json
 */
function getJiraConfig() {
  const config = getConfig();
  const jiraConfig = config?.integrations?.jira || {};

  return {
    enabled: jiraConfig.enabled || false,
    baseUrl: jiraConfig.baseUrl || null,
    projectKey: jiraConfig.projectKey || null,
    email: jiraConfig.email || null,
    apiToken: resolveConfigValue(jiraConfig.apiToken),
    jqlFilter: jiraConfig.jqlFilter || 'assignee = currentUser() AND status != Done ORDER BY priority DESC',
    syncStatuses: jiraConfig.syncStatuses || {
      ready: ['To Do', 'Open', 'Backlog'],
      inProgress: ['In Progress', 'In Review'],
      completed: ['Done', 'Closed', 'Resolved']
    }
  };
}

/**
 * Save Jira configuration (async with locking)
 */
async function saveJiraConfig(jiraConfig) {
  const config = getConfig();
  const currentJira = config?.integrations?.jira || {};
  await setConfigValue('integrations.jira', {
    ...currentJira,
    ...jiraConfig
  });
}

// ============================================================
// Jira API Client
// ============================================================

/**
 * Make authenticated Jira API request
 */
function jiraRequest(method, endpoint, body = null) {
  const config = getJiraConfig();

  if (!config.baseUrl || !config.email || !config.apiToken) {
    throw new Error('Jira not configured. Run: flow jira config');
  }

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, config.baseUrl);
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Jira API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ============================================================
// Issue Operations
// ============================================================

/**
 * Fetch issues from Jira using JQL
 */
async function fetchIssues(jql = null) {
  const config = getJiraConfig();
  const query = jql || config.jqlFilter;

  const searchUrl = `/rest/api/3/search?jql=${encodeURIComponent(query)}&fields=summary,status,priority,assignee,created,updated,description`;

  const result = await jiraRequest('GET', searchUrl);

  return result.issues.map(issue => ({
    key: issue.key,
    id: issue.id,
    summary: issue.fields.summary,
    description: issue.fields.description?.content?.[0]?.content?.[0]?.text || '',
    status: issue.fields.status?.name,
    priority: issue.fields.priority?.name,
    assignee: issue.fields.assignee?.displayName,
    created: issue.fields.created,
    updated: issue.fields.updated,
    url: `${config.baseUrl}/browse/${issue.key}`
  }));
}

/**
 * Get cached issues or fetch fresh
 */
async function getIssues(forceRefresh = false) {
  if (!forceRefresh && fileExists(JIRA_CACHE_PATH)) {
    const cache = safeJsonParse(JIRA_CACHE_PATH);
    // Validate cache has issues array and valid timestamp
    if (cache?.issues && cache?.fetchedAt) {
      const fetchTime = new Date(cache.fetchedAt).getTime();
      // Check for valid date and within TTL
      if (!isNaN(fetchTime) && Date.now() - fetchTime < CACHE_TTL_MS) {
        return cache.issues;
      }
    }
  }

  const issues = await fetchIssues();

  // Save to cache using writeJson for atomic writes
  writeJson(JIRA_CACHE_PATH, {
    fetchedAt: new Date().toISOString(),
    issues
  });

  return issues;
}

/**
 * Update issue status in Jira
 */
async function updateIssueStatus(issueKey, statusName) {
  // Get available transitions
  const transitions = await jiraRequest('GET', `/rest/api/3/issue/${issueKey}/transitions`);

  const transition = transitions.transitions.find(t =>
    t.name.toLowerCase() === statusName.toLowerCase() ||
    t.to.name.toLowerCase() === statusName.toLowerCase()
  );

  if (!transition) {
    throw new Error(`Transition to "${statusName}" not available for ${issueKey}`);
  }

  await jiraRequest('POST', `/rest/api/3/issue/${issueKey}/transitions`, {
    transition: { id: transition.id }
  });

  return { success: true, issueKey, newStatus: statusName };
}

/**
 * Add comment to issue
 */
async function addComment(issueKey, comment) {
  await jiraRequest('POST', `/rest/api/3/issue/${issueKey}/comment`, {
    body: {
      type: 'doc',
      version: 1,
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: comment }]
      }]
    }
  });
}

// ============================================================
// Sync Operations
// ============================================================

/**
 * Import Jira issues to ready.json
 */
async function syncToReady() {
  const config = getJiraConfig();
  const issues = await getIssues(true);

  // Load current ready.json
  const ready = safeJsonParse(READY_PATH) || {
    ready: [],
    inProgress: [],
    blocked: [],
    recentlyCompleted: []
  };

  // Map existing tasks by external ID
  const existingByExternal = new Map();
  for (const task of [...ready.ready, ...ready.inProgress, ...ready.blocked]) {
    if (task.externalId) {
      existingByExternal.set(task.externalId, task);
    }
  }

  const imported = [];
  const updated = [];

  for (const issue of issues) {
    const externalId = `jira:${issue.key}`;
    const existing = existingByExternal.get(externalId);

    // Determine status category
    let targetList = 'ready';
    if (config.syncStatuses.inProgress.includes(issue.status)) {
      targetList = 'inProgress';
    } else if (config.syncStatuses.completed.includes(issue.status)) {
      continue; // Skip completed
    }

    if (existing) {
      // Update existing task
      existing.title = issue.summary;
      existing.priority = mapPriority(issue.priority);
      existing.updatedAt = new Date().toISOString();
      updated.push(issue.key);
    } else {
      // Create new task using standard task ID generator
      const taskId = generateTaskId();
      const task = {
        id: taskId,
        externalId,
        externalUrl: issue.url,
        title: issue.summary,
        type: 'story',
        feature: 'general',
        status: targetList === 'ready' ? 'ready' : 'in_progress',
        priority: mapPriority(issue.priority),
        source: 'jira',
        importedAt: new Date().toISOString()
      };

      ready[targetList].push(task);
      imported.push(issue.key);
    }
  }

  // Save ready.json using atomic write
  ready.lastUpdated = new Date().toISOString();
  writeJson(READY_PATH, ready);

  return { imported, updated };
}

/**
 * Push completed tasks back to Jira
 */
async function pushCompleted() {
  const config = getJiraConfig();
  const ready = safeJsonParse(READY_PATH);

  if (!ready || !ready.recentlyCompleted) {
    return { pushed: [] };
  }

  // Validate completed statuses array exists
  const completedStatuses = config.syncStatuses?.completed || [];
  if (completedStatuses.length === 0) {
    warn('No completed statuses configured, using default "Done"');
  }
  const targetStatus = completedStatuses[0] || 'Done';

  const pushed = [];

  for (const task of ready.recentlyCompleted) {
    // Validate external ID format
    if (!task.externalId || !task.externalId.startsWith('jira:')) {
      continue;
    }

    const issueKey = task.externalId.replace('jira:', '');
    // Validate issue key format (PROJECT-123)
    if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(issueKey)) {
      warn(`Invalid Jira issue key format: ${issueKey}`);
      continue;
    }

    try {
      await updateIssueStatus(issueKey, targetStatus);
    } catch (e) {
      warn(`Failed to update status for ${issueKey}: ${e.message}`);
      continue;
    }

    try {
      await addComment(issueKey, `Completed via Wogi Flow at ${task.completedAt}`);
    } catch (e) {
      warn(`Failed to add comment to ${issueKey}: ${e.message}`);
      // Status was updated, so still count as pushed
    }

    pushed.push(issueKey);
  }

  return { pushed };
}

/**
 * Map Jira priority to Wogi Flow priority
 */
function mapPriority(jiraPriority) {
  const mapping = {
    'Highest': 'P0',
    'High': 'P1',
    'Medium': 'P2',
    'Low': 'P3',
    'Lowest': 'P4'
  };
  return mapping[jiraPriority] || 'P2';
}

// ============================================================
// CLI Output
// ============================================================

function printIssues(issues) {
  if (issues.length === 0) {
    info('No issues found');
    return;
  }

  printHeader('JIRA ISSUES');

  for (const issue of issues) {
    const statusColor = getStatusColor(issue.status);
    const priorityIcon = getPriorityIcon(issue.priority);

    console.log(`\n  ${color('cyan', issue.key)} ${priorityIcon}`);
    console.log(`  ${issue.summary}`);
    console.log(`  ${color(statusColor, issue.status)} • ${color('dim', issue.assignee || 'Unassigned')}`);
  }

  console.log(`\n  ${color('dim', `Total: ${issues.length} issues`)}\n`);
}

function getStatusColor(status) {
  const lower = status?.toLowerCase() || '';
  if (lower.includes('done') || lower.includes('closed')) return 'green';
  if (lower.includes('progress')) return 'yellow';
  if (lower.includes('blocked')) return 'red';
  return 'blue';
}

function getPriorityIcon(priority) {
  const icons = {
    'Highest': color('red', '!!!'),
    'High': color('red', '!!'),
    'Medium': color('yellow', '!'),
    'Low': color('dim', '-'),
    'Lowest': color('dim', '--')
  };
  return icons[priority] || '';
}

function printConfig(config) {
  printHeader('JIRA CONFIGURATION');

  console.log(`  ${color('dim', 'Enabled:')} ${config.enabled ? color('green', 'Yes') : color('red', 'No')}`);
  console.log(`  ${color('dim', 'Base URL:')} ${config.baseUrl || color('yellow', 'Not set')}`);
  console.log(`  ${color('dim', 'Project:')} ${config.projectKey || color('yellow', 'Not set')}`);
  console.log(`  ${color('dim', 'Email:')} ${config.email || color('yellow', 'Not set')}`);
  console.log(`  ${color('dim', 'API Token:')} ${config.apiToken ? color('green', 'Set') : color('yellow', 'Not set')}`);

  console.log(`\n  ${color('dim', 'JQL Filter:')}`);
  console.log(`  ${config.jqlFilter}`);

  console.log(`\nTo configure, add to .workflow/config.json:`);
  console.log(`  "integrations": {`);
  console.log(`    "jira": {`);
  console.log(`      "enabled": true,`);
  console.log(`      "baseUrl": "https://your-company.atlassian.net",`);
  console.log(`      "projectKey": "PROJ",`);
  console.log(`      "email": "you@company.com",`);
  console.log(`      "apiToken": "{env:JIRA_API_TOKEN}"`);
  console.log(`    }`);
  console.log(`  }`);
  console.log('');
}

// ============================================================
// CLI Entry Point
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Jira Integration

Sync tasks between Wogi Flow and Jira.

Usage:
  flow jira list              List assigned issues
  flow jira list --refresh    Force refresh from Jira
  flow jira sync              Import issues to ready.json
  flow jira push              Push completed tasks to Jira
  flow jira config            Show Jira configuration

Options:
  --refresh         Force refresh from API (bypass cache)
  --json            Output as JSON
  --help, -h        Show this help

Configuration:
  Add to .workflow/config.json:
  {
    "integrations": {
      "jira": {
        "enabled": true,
        "baseUrl": "https://company.atlassian.net",
        "projectKey": "PROJ",
        "email": "user@company.com",
        "apiToken": "{env:JIRA_API_TOKEN}"
      }
    }
  }
`);
}

async function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);
  const command = positional[0] || 'list';

  if (flags.help || flags.h) {
    showHelp();
    process.exit(0);
  }

  const config = getJiraConfig();

  switch (command) {
    case 'list': {
      if (!config.enabled) {
        warn('Jira integration is not enabled');
        printConfig(config);
        process.exit(1);
      }

      info('Fetching Jira issues...');
      const issues = await getIssues(flags.refresh);

      if (flags.json) {
        console.log(JSON.stringify(issues, null, 2));
      } else {
        printIssues(issues);
      }
      break;
    }

    case 'sync': {
      if (!config.enabled) {
        error('Jira integration is not enabled');
        process.exit(1);
      }

      info('Syncing Jira issues to ready.json...');
      const result = await syncToReady();

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.imported.length > 0) {
          success(`Imported ${result.imported.length} issues: ${result.imported.join(', ')}`);
        }
        if (result.updated.length > 0) {
          info(`Updated ${result.updated.length} issues: ${result.updated.join(', ')}`);
        }
        if (result.imported.length === 0 && result.updated.length === 0) {
          info('No changes needed');
        }
      }
      break;
    }

    case 'push': {
      if (!config.enabled) {
        error('Jira integration is not enabled');
        process.exit(1);
      }

      info('Pushing completed tasks to Jira...');
      const result = await pushCompleted();

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.pushed.length > 0) {
          success(`Pushed ${result.pushed.length} tasks: ${result.pushed.join(', ')}`);
        } else {
          info('No completed Jira tasks to push');
        }
      }
      break;
    }

    case 'config': {
      if (flags.json) {
        console.log(JSON.stringify(config, null, 2));
      } else {
        printConfig(config);
      }
      break;
    }

    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getJiraConfig,
  fetchIssues,
  getIssues,
  syncToReady,
  pushCompleted,
  updateIssueStatus,
  addComment
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
