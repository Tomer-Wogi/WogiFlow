#!/usr/bin/env node

/**
 * Wogi Flow - Linear Integration
 *
 * Sync tasks between Wogi Flow and Linear. Supports:
 * - Listing assigned Linear issues
 * - Importing issues to ready.json
 * - Syncing completed tasks back to Linear
 *
 * Part of Phase 6: Team & Integrations
 *
 * Usage:
 *   flow linear list             List assigned issues
 *   flow linear sync             Import issues to ready.json
 *   flow linear push             Push completed tasks to Linear
 *   flow linear config           Show/set Linear configuration
 */

const fs = require('fs');
const path = require('path');
const { HttpClient } = require('./flow-http-client');
const { TIMEOUTS } = require('./flow-constants');
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
  writeJson
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const READY_PATH = path.join(STATE_DIR, 'ready.json');
const LINEAR_CACHE_PATH = path.join(STATE_DIR, 'linear-cache.json');
const CACHE_TTL_MS = TIMEOUTS.CACHE_TTL;
const LINEAR_API_URL = 'https://api.linear.app/graphql';

// ============================================================
// Configuration
// ============================================================

/**
 * Get Linear configuration from config.json
 */
function getLinearConfig() {
  const config = getConfig();
  const linearConfig = config?.integrations?.linear || {};

  return {
    enabled: linearConfig.enabled || false,
    apiKey: resolveConfigValue(linearConfig.apiKey),
    teamId: linearConfig.teamId || null,
    teamKey: linearConfig.teamKey || null,
    syncStatuses: linearConfig.syncStatuses || {
      ready: ['Backlog', 'Todo', 'Triage'],
      inProgress: ['In Progress', 'In Review'],
      completed: ['Done', 'Canceled']
    }
  };
}

// ============================================================
// Linear GraphQL Client
// ============================================================

/**
 * Make authenticated Linear GraphQL request using shared HttpClient
 */
async function linearRequest(query, variables = {}) {
  const config = getLinearConfig();

  if (!config.apiKey) {
    throw new Error('Linear API key not configured. Run: flow linear config');
  }

  const client = new HttpClient(LINEAR_API_URL, {
    headers: {
      'Authorization': config.apiKey
    },
    timeout: 30000
  });

  const response = await client.post('/', { query, variables });

  if (response.data?.errors) {
    throw new Error(response.data.errors[0].message);
  }

  return response.data?.data;
}

// ============================================================
// Issue Operations
// ============================================================

/**
 * Fetch assigned issues from Linear
 */
async function fetchIssues() {
  const config = getLinearConfig();

  const query = `
    query AssignedIssues($teamId: String) {
      viewer {
        assignedIssues(
          filter: {
            state: { type: { nin: ["completed", "canceled"] } }
            ${config.teamId ? 'team: { id: { eq: $teamId } }' : ''}
          }
          orderBy: priority
          first: 50
        ) {
          nodes {
            id
            identifier
            title
            description
            priority
            priorityLabel
            state {
              name
              type
            }
            team {
              key
              name
            }
            createdAt
            updatedAt
            url
          }
        }
      }
    }
  `;

  const variables = config.teamId ? { teamId: config.teamId } : {};
  const result = await linearRequest(query, variables);

  return result.viewer.assignedIssues.nodes.map(issue => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description || '',
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    status: issue.state.name,
    statusType: issue.state.type,
    team: issue.team.key,
    teamName: issue.team.name,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    url: issue.url
  }));
}

/**
 * Get cached issues or fetch fresh
 */
async function getIssues(forceRefresh = false) {
  if (!forceRefresh && fileExists(LINEAR_CACHE_PATH)) {
    const cache = safeJsonParse(LINEAR_CACHE_PATH);
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
  writeJson(LINEAR_CACHE_PATH, {
    fetchedAt: new Date().toISOString(),
    issues
  });

  return issues;
}

/**
 * Update issue state in Linear
 */
async function updateIssueState(issueId, stateName) {
  // First, get available states for the issue's team
  const stateQuery = `
    query GetIssueStates($issueId: String!) {
      issue(id: $issueId) {
        team {
          states {
            nodes {
              id
              name
              type
            }
          }
        }
      }
    }
  `;

  const stateResult = await linearRequest(stateQuery, { issueId });
  const states = stateResult.issue.team.states.nodes;

  const targetState = states.find(s =>
    s.name.toLowerCase() === stateName.toLowerCase() ||
    s.type.toLowerCase() === stateName.toLowerCase()
  );

  if (!targetState) {
    throw new Error(`State "${stateName}" not found`);
  }

  // Update the issue
  const updateQuery = `
    mutation UpdateIssue($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
        issue {
          identifier
          state { name }
        }
      }
    }
  `;

  const updateResult = await linearRequest(updateQuery, {
    issueId,
    stateId: targetState.id
  });

  return {
    success: updateResult.issueUpdate.success,
    identifier: updateResult.issueUpdate.issue.identifier,
    newState: updateResult.issueUpdate.issue.state.name
  };
}

/**
 * Add comment to issue
 */
async function addComment(issueId, body) {
  const query = `
    mutation AddComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment {
          id
        }
      }
    }
  `;

  return linearRequest(query, { issueId, body });
}

// ============================================================
// Sync Operations
// ============================================================

/**
 * Import Linear issues to ready.json
 */
async function syncToReady() {
  const config = getLinearConfig();
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
    const externalId = `linear:${issue.identifier}`;
    const existing = existingByExternal.get(externalId);

    // Determine status category
    let targetList = 'ready';
    if (config.syncStatuses.inProgress.includes(issue.status)) {
      targetList = 'inProgress';
    } else if (issue.statusType === 'completed' || issue.statusType === 'canceled') {
      continue; // Skip completed
    }

    if (existing) {
      // Update existing task
      existing.title = issue.title;
      existing.priority = mapPriority(issue.priority);
      existing.updatedAt = new Date().toISOString();
      updated.push(issue.identifier);
    } else {
      // Create new task using standard task ID generator
      const taskId = generateTaskId();
      const task = {
        id: taskId,
        externalId,
        externalUrl: issue.url,
        title: issue.title,
        type: 'story',
        feature: 'general',
        status: targetList === 'ready' ? 'ready' : 'in_progress',
        priority: mapPriority(issue.priority),
        source: 'linear',
        importedAt: new Date().toISOString()
      };

      ready[targetList].push(task);
      imported.push(issue.identifier);
    }
  }

  // Save ready.json using atomic write
  ready.lastUpdated = new Date().toISOString();
  writeJson(READY_PATH, ready);

  return { imported, updated };
}

/**
 * Push completed tasks back to Linear
 */
async function pushCompleted() {
  const ready = safeJsonParse(READY_PATH);

  if (!ready || !ready.recentlyCompleted) {
    return { pushed: [] };
  }

  const pushed = [];

  for (const task of ready.recentlyCompleted) {
    if (!task.externalId || !task.externalId.startsWith('linear:')) {
      continue;
    }

    // Need to get the issue ID from the identifier
    const identifier = task.externalId.replace('linear:', '');

    try {
      // Use proper GraphQL variables to prevent injection
      const searchQuery = `
        query SearchIssue($identifier: String!) {
          issues(filter: { identifier: { eq: $identifier } }) {
            nodes { id }
          }
        }
      `;

      const searchResult = await linearRequest(searchQuery, { identifier });
      const issueId = searchResult.issues?.nodes?.[0]?.id;

      if (!issueId) {
        warn(`Could not find issue ${identifier}`);
        continue;
      }

      await updateIssueState(issueId, 'Done');
      await addComment(issueId, `Completed via Wogi Flow at ${task.completedAt}`);
      pushed.push(identifier);
    } catch (err) {
      warn(`Failed to update ${identifier}: ${err.message}`);
    }
  }

  return { pushed };
}

/**
 * Map Linear priority (0-4) to Wogi Flow priority
 */
function mapPriority(linearPriority) {
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  const mapping = {
    0: 'P2',
    1: 'P0',
    2: 'P1',
    3: 'P2',
    4: 'P3'
  };
  return mapping[linearPriority] || 'P2';
}

// ============================================================
// CLI Output
// ============================================================

function printIssues(issues) {
  if (issues.length === 0) {
    info('No issues found');
    return;
  }

  printHeader('LINEAR ISSUES');

  for (const issue of issues) {
    const statusColor = getStatusColor(issue.statusType);
    const priorityIcon = getPriorityIcon(issue.priority);

    console.log(`\n  ${color('purple', issue.identifier)} ${priorityIcon}`);
    console.log(`  ${issue.title}`);
    console.log(`  ${color(statusColor, issue.status)} • ${color('dim', issue.teamName)}`);
  }

  console.log(`\n  ${color('dim', `Total: ${issues.length} issues`)}\n`);
}

function getStatusColor(statusType) {
  const colors = {
    'backlog': 'dim',
    'unstarted': 'blue',
    'started': 'yellow',
    'completed': 'green',
    'canceled': 'dim'
  };
  return colors[statusType] || 'blue';
}

function getPriorityIcon(priority) {
  const icons = {
    0: '',
    1: color('red', '!!!'),
    2: color('red', '!!'),
    3: color('yellow', '!'),
    4: color('dim', '-')
  };
  return icons[priority] || '';
}

function printConfig(config) {
  printHeader('LINEAR CONFIGURATION');

  console.log(`  ${color('dim', 'Enabled:')} ${config.enabled ? color('green', 'Yes') : color('red', 'No')}`);
  console.log(`  ${color('dim', 'API Key:')} ${config.apiKey ? color('green', 'Set') : color('yellow', 'Not set')}`);
  console.log(`  ${color('dim', 'Team ID:')} ${config.teamId || color('dim', 'All teams')}`);
  console.log(`  ${color('dim', 'Team Key:')} ${config.teamKey || color('dim', 'Not set')}`);

  console.log(`\nTo configure, add to .workflow/config.json:`);
  console.log(`  "integrations": {`);
  console.log(`    "linear": {`);
  console.log(`      "enabled": true,`);
  console.log(`      "apiKey": "{env:LINEAR_API_KEY}",`);
  console.log(`      "teamId": "your-team-id"`);
  console.log(`    }`);
  console.log(`  }`);
  console.log('');
  console.log('Get your API key at: https://linear.app/settings/api');
  console.log('');
}

// ============================================================
// CLI Entry Point
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Linear Integration

Sync tasks between Wogi Flow and Linear.

Usage:
  flow linear list              List assigned issues
  flow linear list --refresh    Force refresh from Linear
  flow linear sync              Import issues to ready.json
  flow linear push              Push completed tasks to Linear
  flow linear config            Show Linear configuration

Options:
  --refresh         Force refresh from API (bypass cache)
  --json            Output as JSON
  --help, -h        Show this help

Configuration:
  Add to .workflow/config.json:
  {
    "integrations": {
      "linear": {
        "enabled": true,
        "apiKey": "{env:LINEAR_API_KEY}",
        "teamId": "optional-team-id"
      }
    }
  }

  Get your API key at: https://linear.app/settings/api
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

  const config = getLinearConfig();

  switch (command) {
    case 'list': {
      if (!config.enabled) {
        warn('Linear integration is not enabled');
        printConfig(config);
        process.exit(1);
      }

      info('Fetching Linear issues...');
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
        error('Linear integration is not enabled');
        process.exit(1);
      }

      info('Syncing Linear issues to ready.json...');
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
        error('Linear integration is not enabled');
        process.exit(1);
      }

      info('Pushing completed tasks to Linear...');
      const result = await pushCompleted();

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.pushed.length > 0) {
          success(`Pushed ${result.pushed.length} tasks: ${result.pushed.join(', ')}`);
        } else {
          info('No completed Linear tasks to push');
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
  getLinearConfig,
  fetchIssues,
  getIssues,
  syncToReady,
  pushCompleted,
  updateIssueState,
  addComment
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
