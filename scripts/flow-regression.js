#!/usr/bin/env node

/**
 * Wogi Flow - Regression Testing
 *
 * Tests random completed tasks to catch regressions early.
 * Inspired by the "Long Running Agents" pattern where 3 random
 * completed features are tested after each new task completion.
 *
 * Usage:
 *   flow regression              # Test 3 random completed tasks
 *   flow regression --all        # Test all completed tasks
 *   flow regression --task ID    # Test specific task
 *   flow regression --count N    # Test N random tasks
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getProjectRoot, colors, getConfig } = require('./flow-utils');
const { getExec, getCommand } = require('./flow-script-resolver');

const PROJECT_ROOT = getProjectRoot();
const STATE_DIR = path.join(PROJECT_ROOT, '.workflow', 'state');
const READY_PATH = path.join(STATE_DIR, 'ready.json');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

/**
 * Load ready.json and get completed tasks
 */
function getCompletedTasks() {
  if (!fs.existsSync(READY_PATH)) {
    return [];
  }

  try {
    const ready = JSON.parse(fs.readFileSync(READY_PATH, 'utf8'));
    return ready.recentlyCompleted || [];
  } catch (err) {
    log('yellow', `Warning: Could not parse ready.json: ${err.message}`);
    return [];
  }
}

/**
 * Find test files associated with a task
 */
function findTestFiles(taskId, taskData) {
  const testFiles = [];

  // Check if task has explicit test files
  if (taskData?.testFiles) {
    testFiles.push(...taskData.testFiles);
    return testFiles;
  }

  // Check if task has associated files
  const files = taskData?.files || [];

  for (const file of files) {
    // Look for test files with common patterns
    const ext = path.extname(file);
    const base = file.slice(0, -ext.length);
    const testPatterns = [
      `${base}.test${ext}`,
      `${base}.spec${ext}`,
      file.replace(/src\//, 'src/__tests__/'),
      file.replace(/src\/components\//, 'src/components/__tests__/'),
    ];

    for (const pattern of testPatterns) {
      if (fs.existsSync(path.join(PROJECT_ROOT, pattern))) {
        testFiles.push(pattern);
      }
    }
  }

  // Also look in request-log for files changed
  const logPath = path.join(STATE_DIR, 'request-log.md');
  if (fs.existsSync(logPath)) {
    const logContent = fs.readFileSync(logPath, 'utf8');
    // Escape special regex characters in taskId
    const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskPattern = new RegExp(`### R-\\d+.*${escapedTaskId}[\\s\\S]*?Files:\\s*([^\\n]+)`, 'i');
    const match = logContent.match(taskPattern);
    if (match) {
      const mentionedFiles = match[1].split(',').map(f => f.trim());
      for (const file of mentionedFiles) {
        const cleanFile = file.replace(/`/g, '');
        const ext = path.extname(cleanFile);
        if (ext) {
          const base = cleanFile.slice(0, -ext.length);
          const testPatterns = [
            `${base}.test${ext}`,
            `${base}.spec${ext}`,
          ];
          for (const pattern of testPatterns) {
            if (fs.existsSync(path.join(PROJECT_ROOT, pattern))) {
              testFiles.push(pattern);
            }
          }
        }
      }
    }
  }

  return [...new Set(testFiles)]; // Dedupe
}

/**
 * Run tests for a specific task
 */
function runTaskTests(taskId, taskData) {
  const testFiles = findTestFiles(taskId, taskData);

  if (testFiles.length === 0) {
    return {
      taskId,
      skipped: true,
      reason: 'No test files found'
    };
  }

  log('white', `   Running tests: ${testFiles.join(', ')}`);

  try {
    // Try to run tests with common test runners
    const testCommand = detectTestRunner(testFiles);
    execSync(testCommand, {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      timeout: 60000 // 1 minute timeout per task
    });

    return {
      taskId,
      passed: true,
      testFiles
    };
  } catch (err) {
    return {
      taskId,
      passed: false,
      error: err.message,
      testFiles
    };
  }
}

/**
 * Detect which test runner to use
 */
function detectTestRunner(testFiles) {
  const packageJson = path.join(PROJECT_ROOT, 'package.json');

  if (fs.existsSync(packageJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));

      // Check scripts
      if (pkg.scripts?.test) {
        // If specific files, pass them
        if (testFiles.length > 0) {
          const fileArgs = testFiles.join(' ');
          // Jest-style
          if (pkg.devDependencies?.jest || pkg.dependencies?.jest) {
            return `${getExec('jest')} ${fileArgs} --passWithNoTests`;
          }
          // Vitest
          if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) {
            return `${getExec('vitest')} run ${fileArgs}`;
          }
          // Mocha
          if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) {
            return `${getExec('mocha')} ${fileArgs}`;
          }
        }
        // Fallback to resolved test command
        const testCmd = getCommand('test') || 'npm test';
        return `${testCmd} -- --passWithNoTests`;
      }
    } catch (err) {
      // package.json is malformed, fall through to default
    }
  }

  // Default to jest via exec resolver
  return `${getExec('jest')} ${testFiles.join(' ')} --passWithNoTests`;
}

/**
 * Pick random tasks from array using Fisher-Yates shuffle
 */
function pickRandom(arr, count) {
  const shuffled = [...arr];
  // Fisher-Yates shuffle (unbiased)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, arr.length));
}

/**
 * Main regression testing function
 */
async function runRegressionTests(options = {}) {
  const config = getConfig();
  const regressionConfig = config.regressionTesting || {};

  // Check if enabled
  if (!regressionConfig.enabled && !options.force) {
    log('yellow', 'Regression testing is disabled. Enable in config.json or use --force');
    return { skipped: true };
  }

  const sampleSize = options.count || regressionConfig.sampleSize || 3;
  const onFailure = options.onFailure || regressionConfig.onFailure || 'warn';

  // Get completed tasks
  const completed = getCompletedTasks();

  if (completed.length === 0) {
    log('yellow', 'No completed tasks to test');
    return { skipped: true, reason: 'No completed tasks' };
  }

  log('cyan', '\n=== Regression Testing ===\n');

  // Determine which tasks to test
  let tasksToTest;

  if (options.all) {
    tasksToTest = completed;
    log('white', `Testing all ${completed.length} completed tasks...`);
  } else if (options.taskId) {
    const task = completed.find(t => t.id === options.taskId);
    if (!task) {
      log('red', `Task ${options.taskId} not found in completed tasks`);
      return { failed: true, reason: 'Task not found' };
    }
    tasksToTest = [task];
    log('white', `Testing specific task: ${options.taskId}`);
  } else {
    tasksToTest = pickRandom(completed, sampleSize);
    log('white', `Testing ${tasksToTest.length} random tasks (of ${completed.length} completed)...`);
  }

  // Run tests
  const results = [];

  for (const task of tasksToTest) {
    log('white', `\n📋 Testing ${task.id}: ${task.title || task.name || 'Untitled'}`);

    const result = runTaskTests(task.id, task);
    results.push(result);

    if (result.skipped) {
      log('yellow', `   ⏭️  Skipped: ${result.reason}`);
    } else if (result.passed) {
      log('green', `   ✅ Passed`);
    } else {
      log('red', `   ❌ Failed: ${result.error?.substring(0, 100)}...`);
    }
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => r.passed === false).length;
  const skipped = results.filter(r => r.skipped).length;

  console.log('\n' + '─'.repeat(50));
  log('white', '\n📊 Regression Test Summary');
  log('green', `   ✅ Passed:  ${passed}`);
  log('red', `   ❌ Failed:  ${failed}`);
  log('yellow', `   ⏭️  Skipped: ${skipped}`);
  console.log('');

  // Handle failures
  if (failed > 0) {
    const failedTasks = results.filter(r => r.passed === false);

    log('red', '⚠️  Regression detected in:');
    for (const f of failedTasks) {
      log('red', `   - ${f.taskId}`);
    }
    console.log('');

    if (onFailure === 'block') {
      log('red', 'Blocking task completion due to regression failures');
      process.exit(1);
    } else if (onFailure === 'fix') {
      log('yellow', 'Regressions need to be fixed before continuing');
      // In the future, could integrate with auto-fix
    }

    return {
      success: false,
      tested: tasksToTest.length,
      passed,
      failed,
      skipped,
      failures: failedTasks
    };
  }

  log('green', '✅ No regressions detected');

  return {
    success: true,
    tested: tasksToTest.length,
    passed,
    failed,
    skipped
  };
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);

  const options = {
    all: args.includes('--all'),
    force: args.includes('--force'),
    taskId: null,
    count: null,
    onFailure: null
  };

  // Parse --task
  const taskIdx = args.indexOf('--task');
  if (taskIdx !== -1 && args[taskIdx + 1]) {
    options.taskId = args[taskIdx + 1];
  }

  // Parse --count
  const countIdx = args.indexOf('--count');
  if (countIdx !== -1 && args[countIdx + 1]) {
    options.count = parseInt(args[countIdx + 1], 10);
  }

  // Parse --on-failure
  const failIdx = args.indexOf('--on-failure');
  if (failIdx !== -1 && args[failIdx + 1]) {
    options.onFailure = args[failIdx + 1];
  }

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Regression Testing

Usage:
  flow regression              Test 3 random completed tasks (default)
  flow regression --all        Test all completed tasks
  flow regression --task ID    Test specific task
  flow regression --count N    Test N random tasks
  flow regression --force      Run even if disabled in config
  flow regression --on-failure warn|block|fix  Override failure behavior

Configuration (config.json):
  "regressionTesting": {
    "enabled": true,
    "sampleSize": 3,
    "runOnTaskComplete": true,
    "onFailure": "warn"
  }

Exit codes:
  0 - All tests passed or skipped
  1 - Tests failed and onFailure is "block"
`);
    process.exit(0);
  }

  const onFailure = options.onFailure || getConfig().regressionTesting?.onFailure || 'warn';

  runRegressionTests(options)
    .then(result => {
      if (!result.success && onFailure === 'block') {
        process.exit(1);
      }
    })
    .catch(err => {
      log('red', `Error: ${err.message}`);
      process.exit(1);
    });
}

// Export for use by other modules
module.exports = {
  runRegressionTests,
  getCompletedTasks,
  findTestFiles
};
