#!/usr/bin/env node

/**
 * Wogi Flow - Browser Test Suggestion
 *
 * Detects UI tasks and suggests relevant browser test flows.
 * Integrates with /wogi-test-browser command.
 *
 * Usage:
 *   Called automatically after task completion in flow-done.js
 *   Or manually: flow browser-suggest <task-id>
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors, getConfig } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const FLOWS_DIR = path.join(WORKFLOW_DIR, 'tests', 'flows');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

/**
 * Check if a task is a UI task based on files it modified
 */
function isUITask(taskData) {
  const files = taskData?.files || [];

  // UI file patterns
  const uiPatterns = [
    /\.tsx$/,
    /\.jsx$/,
    /\/components\//,
    /\/pages\//,
    /\/views\//,
    /\/screens\//,
    /\/ui\//,
    /\.css$/,
    /\.scss$/,
    /\.styled\./,
  ];

  return files.some(file =>
    uiPatterns.some(pattern => pattern.test(file))
  );
}

/**
 * Get files changed by a task from various sources
 */
function getTaskFiles(taskId, taskData) {
  const files = new Set(taskData?.files || []);

  // Try to get files from request-log
  const logPath = path.join(STATE_DIR, 'request-log.md');
  if (fs.existsSync(logPath)) {
    try {
      const logContent = fs.readFileSync(logPath, 'utf8');
      const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const taskPattern = new RegExp(`### R-\\d+.*${escapedTaskId}[\\s\\S]*?Files:\\s*([^\\n]+)`, 'gi');

      let match;
      while ((match = taskPattern.exec(logContent)) !== null) {
        const mentionedFiles = match[1].split(',').map(f => f.trim().replace(/`/g, ''));
        mentionedFiles.forEach(f => files.add(f));
      }
    } catch (err) {
      // Ignore errors reading log
    }
  }

  // Try to get from git diff if task has branch info
  if (taskData?.branch) {
    try {
      const { execSync } = require('child_process');
      const diff = execSync(`git diff --name-only main...${taskData.branch}`, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      diff.split('\n').filter(Boolean).forEach(f => files.add(f));
    } catch (err) {
      // Git command failed, ignore
    }
  }

  return Array.from(files);
}

/**
 * Find browser test flows that match the task
 */
function findMatchingFlows(taskId, taskData) {
  if (!fs.existsSync(FLOWS_DIR)) {
    return [];
  }

  const matchingFlows = [];
  const files = getTaskFiles(taskId, taskData);
  const taskTitle = (taskData?.title || taskData?.name || '').toLowerCase();

  try {
    const flowFiles = fs.readdirSync(FLOWS_DIR).filter(f => f.endsWith('.json'));

    for (const flowFile of flowFiles) {
      const flowPath = path.join(FLOWS_DIR, flowFile);
      try {
        const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
        const flowName = flowFile.replace('.json', '');

        // Check if flow explicitly references this task
        if (flow.relatedTasks?.includes(taskId)) {
          matchingFlows.push(flowName);
          continue;
        }

        // Check if flow name matches any component in task files
        const flowNameLower = flowName.toLowerCase();
        for (const file of files) {
          const fileName = path.basename(file, path.extname(file)).toLowerCase();
          if (flowNameLower.includes(fileName) || fileName.includes(flowNameLower)) {
            matchingFlows.push(flowName);
            break;
          }
        }

        // Check if flow name matches task title keywords
        if (taskTitle) {
          const titleWords = taskTitle.split(/\s+/).filter(w => w.length > 3);
          if (titleWords.some(word => flowNameLower.includes(word))) {
            if (!matchingFlows.includes(flowName)) {
              matchingFlows.push(flowName);
            }
          }
        }

        // Check if flow tests components that were modified
        if (flow.components) {
          const flowComponents = flow.components.map(c => c.toLowerCase());
          for (const file of files) {
            const fileName = path.basename(file, path.extname(file)).toLowerCase();
            if (flowComponents.some(c => c.includes(fileName) || fileName.includes(c))) {
              if (!matchingFlows.includes(flowName)) {
                matchingFlows.push(flowName);
              }
              break;
            }
          }
        }
      } catch (err) {
        // Invalid flow file, skip
      }
    }
  } catch (err) {
    // Can't read flows directory
  }

  return matchingFlows;
}

/**
 * Main function to suggest browser tests for a task
 */
function suggestBrowserTests(taskId, taskData = {}) {
  const config = getConfig();
  const browserConfig = config.browserTesting || {};

  // Check if browser testing is enabled
  if (!browserConfig.enabled) {
    return { suggested: false, reason: 'Browser testing disabled' };
  }

  // Get task files and check if UI task
  const files = getTaskFiles(taskId, taskData);
  taskData = { ...taskData, files };

  const isUI = isUITask(taskData);

  // If runForUITasks is true, only suggest for UI tasks
  if (browserConfig.runForUITasks && !isUI) {
    return { suggested: false, reason: 'Not a UI task', isUITask: false };
  }

  // Find matching flows
  const flows = findMatchingFlows(taskId, taskData);

  if (flows.length === 0) {
    return {
      suggested: false,
      reason: 'No matching test flows found',
      isUITask: isUI,
      hint: isUI ? 'Consider creating a test flow for this component' : null
    };
  }

  return {
    suggested: true,
    flows,
    isUITask: isUI,
    autoRun: browserConfig.autoRun || false
  };
}

/**
 * List all available browser test flows
 */
function listFlows() {
  if (!fs.existsSync(FLOWS_DIR)) {
    return [];
  }

  try {
    return fs.readdirSync(FLOWS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch (err) {
    return [];
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Browser Test Suggestion

Usage:
  flow browser-suggest <task-id>    Suggest browser tests for task
  flow browser-suggest --list       List all available test flows

Configuration (config.json):
  "browserTesting": {
    "enabled": true,
    "runOnTaskComplete": true,
    "runForUITasks": true,
    "autoRun": false,
    "timeout": 30000,
    "screenshotOnFailure": true
  }

Test flows are stored in: .workflow/tests/flows/*.json
`);
    process.exit(0);
  }

  if (args.includes('--list')) {
    const flows = listFlows();
    if (flows.length === 0) {
      log('yellow', 'No browser test flows found');
      log('dim', `Create flows in: ${FLOWS_DIR}`);
    } else {
      log('cyan', 'Available browser test flows:');
      flows.forEach(f => log('white', `  - ${f}`));
    }
    process.exit(0);
  }

  const taskId = args[0];
  if (!taskId) {
    console.log('Usage: flow browser-suggest <task-id>');
    process.exit(1);
  }

  // Try to load task data from ready.json
  let taskData = {};
  const readyPath = path.join(STATE_DIR, 'ready.json');
  if (fs.existsSync(readyPath)) {
    try {
      const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
      const allTasks = [
        ...(ready.ready || []),
        ...(ready.inProgress || []),
        ...(ready.recentlyCompleted || []),
        ...(ready.blocked || [])
      ];
      const task = allTasks.find(t => t.id === taskId);
      if (task) taskData = task;
    } catch (err) {
      // Ignore
    }
  }

  const result = suggestBrowserTests(taskId, taskData);

  console.log('');
  if (result.suggested) {
    log('green', `✓ Browser tests suggested for ${taskId}`);
    log('cyan', '\nMatching test flows:');
    result.flows.forEach(f => log('white', `  - ${f}`));
    console.log('');
    log('dim', `Run: /wogi-test-browser ${result.flows[0]}`);
    if (result.flows.length > 1) {
      log('dim', `Or run all: /wogi-test-browser all`);
    }
  } else {
    log('yellow', `No browser tests suggested: ${result.reason}`);
    if (result.hint) {
      log('dim', result.hint);
    }
  }
}

/**
 * Format browser test suggestion for display
 * Used after task completion to suggest relevant tests
 */
function formatSuggestion(result, taskId) {
  if (!result.suggested) {
    return null;
  }

  const lines = [
    '',
    colors.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset,
    colors.cyan + '🧪 Browser Tests Available' + colors.reset,
    colors.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset,
    '',
    'This task modified UI files. Consider running browser tests',
    'to verify the changes work correctly.',
    '',
    colors.yellow + 'Matching test flows:' + colors.reset
  ];

  result.flows.forEach(f => {
    lines.push(`  - ${f}`);
  });

  lines.push('');
  lines.push(colors.dim + `Run: /wogi-test-browser ${result.flows[0]}` + colors.reset);

  if (result.flows.length > 1) {
    lines.push(colors.dim + 'Or run all: /wogi-test-browser all' + colors.reset);
  }

  lines.push('');
  lines.push(colors.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);

  return lines.join('\n');
}

/**
 * Check if browser tests should be suggested after task completion
 * Called by task completion flow
 */
function shouldSuggestAfterTask(taskId, taskData = {}) {
  const config = getConfig();
  const browserConfig = config.browserTesting || {};

  // Check if auto-suggestion is enabled
  if (!browserConfig.enabled || !browserConfig.runOnTaskComplete) {
    return { suggest: false, reason: 'Auto-suggestion disabled' };
  }

  const result = suggestBrowserTests(taskId, taskData);

  if (result.suggested) {
    return {
      suggest: true,
      flows: result.flows,
      formatted: formatSuggestion(result, taskId)
    };
  }

  return { suggest: false, reason: result.reason };
}

// Export for use by other modules
module.exports = {
  suggestBrowserTests,
  isUITask,
  findMatchingFlows,
  getTaskFiles,
  listFlows,
  formatSuggestion,
  shouldSuggestAfterTask
};
