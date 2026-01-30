#!/usr/bin/env node

/**
 * Wogi Flow - Project Status Overview
 *
 * Shows task counts, features, bugs, components, and config summary.
 *
 * Usage:
 *   flow status           Human-readable status
 *   flow status --json    JSON output for programmatic access
 */

const path = require('path');

const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  dirExists,
  getTaskCounts,
  getConfig,
  getReadyData,
  countRequestLogEntries,
  countAppMapComponents,
  getGitStatus,
  listDirs,
  listFiles,
  parseFlags,
  outputJson,
  printHeader,
  printSection,
  color
} = require('./flow-utils');

const {
  getBypassTracking
} = require('./flow-session-state');

/**
 * Collect all status data
 */
function collectStatus() {
  const status = {
    tasks: { ready: 0, inProgress: 0, blocked: 0, recentlyCompleted: 0 },
    features: [],
    bugs: [],
    components: 0,
    requestLog: 0,
    git: { isRepo: false, branch: null, uncommitted: 0 },
    cli: { type: 'claude-code', bridgeStatus: 'unknown' },
    config: {},
    recommendation: {}
  };

  // Task counts
  if (fileExists(PATHS.ready)) {
    status.tasks = getTaskCounts();
  }

  // Features
  if (dirExists(PATHS.changes)) {
    status.features = listDirs(PATHS.changes);
  }

  // Bugs
  if (dirExists(PATHS.bugs)) {
    status.bugs = listFiles(PATHS.bugs, '.md').filter(f => !f.startsWith('.'));
  }

  // Components
  if (fileExists(PATHS.appMap)) {
    status.components = countAppMapComponents();
  }

  // Request log
  if (fileExists(PATHS.requestLog)) {
    status.requestLog = countRequestLogEntries();
  }

  // Git
  status.git = getGitStatus();

  // CLI
  if (fileExists(PATHS.config)) {
    try {
      const config = getConfig();
      status.cli.type = config.cli?.type || 'claude-code';

      // Check bridge status
      const bridgesDir = path.join(PROJECT_ROOT, '.workflow', 'bridges');
      const modelsDir = path.join(PROJECT_ROOT, '.workflow', 'models');

      if (dirExists(bridgesDir) && dirExists(modelsDir)) {
        status.cli.bridgeStatus = 'configured';
      } else if (config.cli?.type) {
        status.cli.bridgeStatus = 'partial';
      } else {
        status.cli.bridgeStatus = 'legacy';
      }
    } catch {
      status.cli.bridgeStatus = 'error';
    }
  }

  // Config
  if (fileExists(PATHS.config)) {
    const config = getConfig();
    status.config = {
      mandatoryAfterTask: config.mandatorySteps?.afterTask || [],
      strictMode: config.enforcement?.strictMode || false,
      priorities: config.priorities || {}
    };
  }

  // Recommendation
  status.recommendation = getRecommendation();

  // Bypass tracking (enforcement)
  try {
    status.bypassTracking = getBypassTracking();
  } catch {
    status.bypassTracking = { count: 0, attempts: [], autoCreatedTasks: [] };
  }

  return status;
}

function main() {
  const { flags } = parseFlags(process.argv.slice(2));

  const status = collectStatus();

  // JSON output - exit early to avoid human-readable output
  if (flags.json) {
    outputJson({
      success: true,
      ...status
    });
    return;
  }

  // Human-readable output - use already collected status data
  printHeader('PROJECT STATUS');

  // Task counts (use status.tasks from collectStatus)
  if (status.tasks.ready > 0 || status.tasks.inProgress > 0 || status.tasks.blocked > 0 || status.tasks.recentlyCompleted > 0) {
    printSection('Tasks');
    console.log(`  Ready: ${status.tasks.ready}`);
    console.log(`  In Progress: ${status.tasks.inProgress}`);
    console.log(`  Blocked: ${status.tasks.blocked}`);
    console.log(`  Recently Done: ${status.tasks.recentlyCompleted}`);
    console.log('');
  }

  // Features (use status.features from collectStatus)
  if (status.features.length > 0 || dirExists(PATHS.changes)) {
    printSection('Features');
    console.log(`  Active: ${status.features.length}`);
    if (status.features.length > 0) {
      for (const feature of status.features) {
        console.log(`    • ${feature}`);
      }
    }
    console.log('');
  }

  // Bugs (use status.bugs from collectStatus)
  if (status.bugs.length > 0 || dirExists(PATHS.bugs)) {
    printSection('Bugs');
    console.log(`  Open: ${status.bugs.length}`);
    console.log('');
  }

  // Components (use status.components from collectStatus)
  if (status.components > 0) {
    printSection('Components');
    console.log(`  Mapped: ${status.components}`);
    console.log('');
  }

  // Request log (use status.requestLog from collectStatus)
  if (status.requestLog > 0) {
    printSection('Request Log');
    console.log(`  Entries: ${status.requestLog}`);
    console.log('');
  }

  // Git status (use status.git from collectStatus)
  if (status.git.isRepo) {
    printSection('Git');
    console.log(`  Branch: ${status.git.branch || 'unknown'}`);
    console.log(`  Uncommitted: ${status.git.uncommitted || 0} files`);
    console.log('');
  }

  // CLI status
  printSection('CLI');
  const cliNames = {
    'claude-code': 'Claude Code'
  };
  const bridgeColors = {
    'configured': 'green',
    'partial': 'yellow',
    'legacy': 'yellow',
    'error': 'red'
  };
  console.log(`  Type: ${cliNames[status.cli.type] || status.cli.type}`);
  console.log(`  Bridge: ${color(bridgeColors[status.cli.bridgeStatus] || 'dim', status.cli.bridgeStatus)}`);
  console.log('');

  // Config summary (use status.config from collectStatus)
  if (status.config.mandatoryAfterTask) {
    printSection('Config');
    const afterTask = status.config.mandatoryAfterTask;

    if (afterTask.length > 0) {
      console.log(`  After task: ${afterTask.join(', ')}`);
    } else {
      console.log('  After task: (none)');
    }
  }

  // Bypass warnings (enforcement)
  if (status.bypassTracking && status.bypassTracking.count > 0) {
    printSection('⚠️  Workflow Bypasses');
    console.log(color('yellow', `  ${status.bypassTracking.count} bypass attempt(s) detected this session`));

    if (status.bypassTracking.autoCreatedTasks && status.bypassTracking.autoCreatedTasks.length > 0) {
      console.log(color('yellow', `  Auto-created tasks: ${status.bypassTracking.autoCreatedTasks.join(', ')}`));
    }

    // Show recent attempts (last 3)
    const recentAttempts = (status.bypassTracking.attempts || []).slice(-3);
    if (recentAttempts.length > 0) {
      console.log(color('dim', '  Recent attempts:'));
      for (const attempt of recentAttempts) {
        const file = attempt.filePath ? path.basename(attempt.filePath) : 'unknown';
        console.log(color('dim', `    - ${attempt.operation} ${file} (${attempt.reason})`));
      }
    }

    console.log('');
    console.log(color('cyan', '  💡 Use /wogi-start before making changes to follow the workflow.'));
    console.log('');
  }

  // Action-oriented recommendation (use status.recommendation from collectStatus)
  printSection('📌 Recommended Next Action');
  console.log(`  ${status.recommendation.action}`);
  if (status.recommendation.command) {
    console.log(color('dim', `  Run: ${status.recommendation.command}`));
  }

  console.log('');
  console.log(color('cyan', '═'.repeat(50)));
}

/**
 * Get recommended next action based on current state
 */
function getRecommendation() {
  // Check for uncommitted changes first
  const git = getGitStatus();
  if (git.isRepo && git.uncommitted > 0) {
    return {
      action: `Commit ${git.uncommitted} uncommitted file(s)`,
      command: 'git add -A && git commit -m "message"'
    };
  }

  // Check task state
  if (!fileExists(PATHS.ready)) {
    return {
      action: 'Initialize workflow to start tracking tasks',
      command: 'flow install'
    };
  }

  const data = getReadyData();

  // Check in-progress tasks first
  const inProgress = data.inProgress || [];
  if (inProgress.length > 0) {
    const task = inProgress[0];
    const taskId = typeof task === 'string' ? task : task.id;
    const taskTitle = typeof task === 'object' ? (task.title || task.description || '') : '';
    return {
      action: `Continue working on ${taskId}${taskTitle ? `: ${taskTitle.slice(0, 40)}` : ''}`,
      command: null
    };
  }

  // Check ready tasks
  const ready = data.ready || [];
  if (ready.length > 0) {
    // Find highest priority task (P0=critical, P1=high, P2=medium, P3=low, P4=lowest)
    const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
    const sorted = [...ready].sort((a, b) => {
      const aPriority = priorityOrder[a.priority] ?? 2;
      const bPriority = priorityOrder[b.priority] ?? 2;
      return aPriority - bPriority;
    });

    const task = sorted[0];
    const taskId = typeof task === 'string' ? task : task.id;
    const taskTitle = typeof task === 'object' ? (task.title || task.description || '') : '';
    const priority = typeof task === 'object' && task.priority ? ` [${task.priority}]` : '';
    return {
      action: `Start ${taskId}${priority}${taskTitle ? `: ${taskTitle.slice(0, 35)}` : ''}`,
      command: `flow start ${taskId}`
    };
  }

  // Check blocked tasks
  const blocked = data.blocked || [];
  if (blocked.length > 0) {
    return {
      action: `${blocked.length} task(s) are blocked - resolve dependencies`,
      command: 'flow ready'
    };
  }

  // No tasks at all
  return {
    action: 'Create a new task to work on',
    command: 'flow story "Your task title"'
  };
}

if (require.main === module) {
  main();
}
