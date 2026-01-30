#!/usr/bin/env node

/**
 * Wogi Flow - Background Task Execution
 *
 * Run non-critical tasks (memory compaction, skill learning) in background processes.
 * Part of Crush research improvements (wf-80c41aef)
 *
 * Usage:
 *   flow background run <task>       - Run a task in background
 *   flow background status           - Show running background tasks
 *   flow background list             - List available background tasks
 *   flow background cancel <id>      - Cancel a running task
 *   flow background logs [id]        - Show task output logs
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  getProjectRoot,
  safeJsonParse,
  fileExists,
  color,
  printHeader,
  printSection
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = getProjectRoot();
const BACKGROUND_STATE_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'background-tasks.json');
const LOGS_DIR = path.join(PROJECT_ROOT, '.workflow', 'logs');

// Available background tasks with their configurations
const AVAILABLE_TASKS = {
  'memory-compact': {
    name: 'Memory Compaction',
    description: 'Compact and optimize memory database',
    script: 'flow-memory-compactor.js',
    args: [],
    timeout: 300000, // 5 minutes
    category: 'maintenance'
  },
  'skill-learn': {
    name: 'Skill Learning',
    description: 'Extract learnings from recent changes',
    script: 'flow-skill-learn.js',
    args: ['--trigger=background'],
    timeout: 180000, // 3 minutes
    category: 'learning'
  },
  'aggregate': {
    name: 'Learning Aggregation',
    description: 'Aggregate learnings across skills',
    script: 'flow-aggregate.js',
    args: [],
    timeout: 120000, // 2 minutes
    category: 'learning'
  },
  'knowledge-sync': {
    name: 'Knowledge Sync',
    description: 'Check and sync knowledge files',
    script: 'flow-knowledge-sync.js',
    args: ['status'],
    timeout: 60000, // 1 minute
    category: 'maintenance'
  },
  'entropy-check': {
    name: 'Entropy Check',
    description: 'Check memory entropy and auto-compact if needed',
    script: 'flow-entropy-monitor.js',
    args: ['--auto'],
    timeout: 180000, // 3 minutes
    category: 'maintenance'
  },
  'mcp-docs': {
    name: 'MCP Documentation',
    description: 'Scan and generate MCP tool documentation',
    script: 'flow-mcp-docs.js',
    args: ['scan'],
    timeout: 60000, // 1 minute
    category: 'documentation'
  }
};

// ============================================================
// State Management
// ============================================================

/**
 * Load background tasks state
 * @returns {Object} Background tasks state
 */
function loadState() {
  return safeJsonParse(BACKGROUND_STATE_PATH, {
    runningTasks: {},
    completedTasks: [],
    lastUpdated: null
  });
}

/**
 * Save background tasks state
 * @param {Object} state - State to save
 */
function saveState(state) {
  state.lastUpdated = new Date().toISOString();

  const dir = path.dirname(BACKGROUND_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(BACKGROUND_STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Generate a unique task ID
 * @returns {string} Unique task ID
 */
function generateTaskId() {
  return `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================
// Task Execution
// ============================================================

/**
 * Run a task in the background
 * @param {string} taskName - Name of the task to run
 * @param {Object} options - Task options
 * @returns {Object} Task info
 */
function runBackgroundTask(taskName, options = {}) {
  const taskConfig = AVAILABLE_TASKS[taskName];

  if (!taskConfig) {
    throw new Error(`Unknown task: ${taskName}. Use 'flow background list' to see available tasks.`);
  }

  const scriptPath = path.join(PROJECT_ROOT, 'scripts', taskConfig.script);

  if (!fileExists(scriptPath)) {
    throw new Error(`Script not found: ${taskConfig.script}`);
  }

  const taskId = generateTaskId();
  const logFile = path.join(LOGS_DIR, `${taskId}.log`);

  // Ensure logs directory exists
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  // Create log file stream
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // Build command arguments
  const args = [...taskConfig.args, ...(options.args || [])];

  // Spawn the process
  const child = spawn('node', [scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BACKGROUND_TASK: 'true', TASK_ID: taskId }
  });

  // Write initial log entry
  const startTime = new Date();
  logStream.write(`=== Background Task Started ===\n`);
  logStream.write(`Task: ${taskName} (${taskConfig.name})\n`);
  logStream.write(`ID: ${taskId}\n`);
  logStream.write(`Started: ${startTime.toISOString()}\n`);
  logStream.write(`Script: ${taskConfig.script}\n`);
  logStream.write(`Args: ${args.join(' ')}\n`);
  logStream.write(`===\n\n`);

  // Pipe output to log file
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  // Update state
  const state = loadState();
  state.runningTasks[taskId] = {
    id: taskId,
    name: taskName,
    displayName: taskConfig.name,
    pid: child.pid,
    startedAt: startTime.toISOString(),
    logFile,
    timeout: taskConfig.timeout
  };
  saveState(state);

  // Set up timeout
  const timeoutId = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGTERM');
      logStream.write(`\n=== Task timed out after ${taskConfig.timeout / 1000}s ===\n`);
      markTaskComplete(taskId, 'timeout');
    } catch (_err) {
      // Process may have already ended
    }
  }, taskConfig.timeout);

  // Handle task completion
  child.on('exit', (code, signal) => {
    clearTimeout(timeoutId);

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;

    logStream.write(`\n=== Task Completed ===\n`);
    logStream.write(`Exit code: ${code}\n`);
    logStream.write(`Signal: ${signal || 'none'}\n`);
    logStream.write(`Duration: ${duration.toFixed(2)}s\n`);
    logStream.write(`Ended: ${endTime.toISOString()}\n`);
    logStream.end();

    markTaskComplete(taskId, code === 0 ? 'success' : 'failed', code);
  });

  // Unref to allow parent process to exit
  child.unref();

  return {
    id: taskId,
    name: taskName,
    displayName: taskConfig.name,
    pid: child.pid,
    logFile
  };
}

/**
 * Mark a task as complete
 * @param {string} taskId - Task ID
 * @param {string} status - Completion status
 * @param {number} exitCode - Exit code
 */
function markTaskComplete(taskId, status, exitCode = null) {
  const state = loadState();
  const task = state.runningTasks[taskId];

  if (task) {
    const completedTask = {
      ...task,
      status,
      exitCode,
      completedAt: new Date().toISOString()
    };

    // Move to completed
    state.completedTasks.unshift(completedTask);
    state.completedTasks = state.completedTasks.slice(0, 50); // Keep last 50

    // Remove from running
    delete state.runningTasks[taskId];

    saveState(state);
  }
}

/**
 * Get status of running tasks
 * @returns {Object} Running tasks status
 */
function getStatus() {
  const state = loadState();
  const running = [];
  const stale = [];

  // Check if running tasks are still alive
  for (const [taskId, task] of Object.entries(state.runningTasks)) {
    try {
      // Check if process is still running
      process.kill(task.pid, 0);
      running.push(task);
    } catch (_err) {
      // Process not found - mark as stale
      stale.push(taskId);
    }
  }

  // Clean up stale tasks
  for (const taskId of stale) {
    markTaskComplete(taskId, 'unknown', null);
  }

  return {
    running,
    recentlyCompleted: state.completedTasks.slice(0, 10)
  };
}

/**
 * Cancel a running task
 * @param {string} taskId - Task ID to cancel
 * @returns {boolean} Success
 */
function cancelTask(taskId) {
  const state = loadState();
  const task = state.runningTasks[taskId];

  if (!task) {
    return false;
  }

  try {
    // Send SIGTERM to the process group
    process.kill(-task.pid, 'SIGTERM');
    markTaskComplete(taskId, 'cancelled');
    return true;
  } catch (_err) {
    // Process may have already ended
    markTaskComplete(taskId, 'unknown');
    return false;
  }
}

/**
 * Get logs for a task
 * @param {string} taskId - Task ID
 * @returns {string|null} Log contents or null
 */
function getTaskLogs(taskId) {
  const state = loadState();

  // Check running tasks
  let task = state.runningTasks[taskId];

  // Check completed tasks
  if (!task) {
    task = state.completedTasks.find(t => t.id === taskId);
  }

  if (!task || !task.logFile) {
    return null;
  }

  if (!fileExists(task.logFile)) {
    return null;
  }

  return fs.readFileSync(task.logFile, 'utf-8');
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  printHeader('Background Task Execution');

  console.log(`
Usage:
  flow background run <task>       Run a task in background
  flow background status           Show running background tasks
  flow background list             List available background tasks
  flow background cancel <id>      Cancel a running task
  flow background logs [id]        Show task output logs

Available Tasks:
`);

  for (const [name, config] of Object.entries(AVAILABLE_TASKS)) {
    console.log(`  ${color('cyan', name.padEnd(18))} ${config.description}`);
  }

  console.log(`
Examples:
  flow background run memory-compact
  flow background status
  flow background logs bg-abc123
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    showHelp();
    return;
  }

  switch (command) {
    case 'run': {
      const taskName = args[1];

      if (!taskName) {
        console.error(color('red', 'Error: Task name required'));
        console.log('Usage: flow background run <task>');
        console.log('Run "flow background list" to see available tasks.');
        process.exit(1);
      }

      try {
        const result = runBackgroundTask(taskName);
        console.log(color('green', `✓ Started background task: ${result.displayName}`));
        console.log(`  ID: ${color('cyan', result.id)}`);
        console.log(`  PID: ${result.pid}`);
        console.log(`  Log: ${color('dim', result.logFile)}`);
      } catch (err) {
        console.error(color('red', `Error: ${err.message}`));
        process.exit(1);
      }
      break;
    }

    case 'status': {
      const status = getStatus();

      printHeader('Background Tasks');

      if (status.running.length === 0) {
        console.log(color('dim', 'No background tasks running.'));
      } else {
        printSection('Running');
        for (const task of status.running) {
          const elapsed = ((Date.now() - new Date(task.startedAt).getTime()) / 1000).toFixed(0);
          console.log(`  ${color('cyan', task.id)} ${task.displayName}`);
          console.log(`    ${color('dim', `PID: ${task.pid} | Running: ${elapsed}s`)}`);
        }
      }

      if (status.recentlyCompleted.length > 0) {
        console.log('');
        printSection('Recently Completed');
        for (const task of status.recentlyCompleted.slice(0, 5)) {
          const statusColor = task.status === 'success' ? 'green' : task.status === 'failed' ? 'red' : 'yellow';
          console.log(`  ${color('dim', task.id)} ${task.displayName} ${color(statusColor, `[${task.status}]`)}`);
        }
      }
      break;
    }

    case 'list': {
      printHeader('Available Background Tasks');

      const byCategory = {};
      for (const [name, config] of Object.entries(AVAILABLE_TASKS)) {
        const cat = config.category || 'other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({ name, ...config });
      }

      for (const [category, tasks] of Object.entries(byCategory)) {
        printSection(category.charAt(0).toUpperCase() + category.slice(1));
        for (const task of tasks) {
          console.log(`  ${color('cyan', task.name.padEnd(18))} ${task.description}`);
          console.log(`    ${color('dim', `Timeout: ${task.timeout / 1000}s | Script: ${task.script}`)}`);
        }
        console.log('');
      }
      break;
    }

    case 'cancel': {
      const taskId = args[1];

      if (!taskId) {
        console.error(color('red', 'Error: Task ID required'));
        console.log('Usage: flow background cancel <id>');
        process.exit(1);
      }

      const success = cancelTask(taskId);
      if (success) {
        console.log(color('green', `✓ Cancelled task: ${taskId}`));
      } else {
        console.log(color('yellow', `Task not found or already completed: ${taskId}`));
      }
      break;
    }

    case 'logs': {
      const taskId = args[1];

      if (!taskId) {
        // Show logs for most recent task
        const status = getStatus();
        const recent = status.running[0] || status.recentlyCompleted[0];

        if (!recent) {
          console.log(color('dim', 'No tasks found.'));
          return;
        }

        console.log(color('dim', `Showing logs for most recent task: ${recent.id}`));
        console.log('');

        const logs = getTaskLogs(recent.id);
        if (logs) {
          console.log(logs);
        } else {
          console.log(color('yellow', 'No logs found.'));
        }
        return;
      }

      const logs = getTaskLogs(taskId);
      if (logs) {
        console.log(logs);
      } else {
        console.log(color('yellow', `No logs found for task: ${taskId}`));
      }
      break;
    }

    default:
      console.error(color('red', `Unknown command: ${command}`));
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  AVAILABLE_TASKS,
  runBackgroundTask,
  getStatus,
  cancelTask,
  getTaskLogs,
  loadState,
  saveState
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
