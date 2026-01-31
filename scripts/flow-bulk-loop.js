#!/usr/bin/env node

/**
 * Wogi Flow - Bulk Loop (Continuous Work Mode)
 *
 * Continuously processes captured ideas and ready tasks autonomously.
 * Inspired by Matt Maher's "do-work" skill.
 *
 * Features:
 * - Processes ready tasks with all quality gates
 * - Converts captured ideas to stories
 * - YOLO mode for auto-approval (still runs quality gates)
 * - Safety mechanisms (context check, error threshold, max iterations)
 * - Graceful shutdown on Ctrl+C
 */

const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  getConfig,
  safeJsonParse,
  writeJson,
  fileExists,
  readFile,
  color,
  success,
  warn,
  error
} = require('./flow-utils');

const { loadDurableSession, saveDurableSession } = require('./flow-durable-session');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG = {
  maxTasks: Infinity,
  maxIterations: 100,
  pollInterval: 10000, // 10 seconds
  errorThreshold: 3,
  taskTimeout: 30 * 60 * 1000, // 30 minutes
  contextThreshold: 0.8, // 80% context usage triggers compact
  yolo: false,
  noCreate: false,
  dryRun: false
};

// ============================================================================
// State Management
// ============================================================================

let running = true;
let tasksCompleted = 0;
let consecutiveErrors = 0;
let startTime = Date.now();

// Graceful shutdown handler
process.on('SIGINT', () => {
  console.log('');
  console.log(color('yellow', '⚠ Graceful shutdown requested...'));
  console.log(color('dim', 'Current task will complete before stopping.'));
  running = false;
});

// ============================================================================
// Work Source Detection
// ============================================================================

/**
 * Find the next work item to process
 * @param {boolean} noCreate - If true, don't convert captures to stories
 * @returns {Object|null} Work item or null if none found
 */
function findNextWork(noCreate = false) {
  // Priority 1: In-progress tasks (resume interrupted work)
  const inProgress = getInProgressTask();
  if (inProgress) {
    return {
      type: 'task',
      taskId: inProgress.id,
      title: inProgress.title || inProgress.id,
      source: 'in-progress'
    };
  }

  // Priority 2: Ready tasks (highest priority first)
  const ready = getNextReadyTask();
  if (ready) {
    return {
      type: 'task',
      taskId: ready.id,
      title: ready.title || ready.id,
      priority: ready.priority,
      source: 'ready'
    };
  }

  // Priority 3: Captured ideas (if not noCreate)
  if (!noCreate) {
    const capture = getNextCapture();
    if (capture) {
      return {
        type: 'capture',
        title: capture.title,
        captureData: capture,
        source: 'capture'
      };
    }
  }

  return null;
}

/**
 * Safely get array from readyData with validation
 * @param {Object} readyData - Parsed ready.json data
 * @param {string} key - Key to extract
 * @returns {Array} Array or empty array if invalid
 */
function getArraySafe(readyData, key) {
  const value = readyData && readyData[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Parse priority string to number safely
 * @param {string} priority - Priority like "P0", "P1", etc.
 * @returns {number} Priority as number (default 2)
 */
function parsePriority(priority) {
  if (!priority || typeof priority !== 'string') return 2;
  const match = priority.match(/^P(\d)$/i);
  return match ? parseInt(match[1], 10) : 2;
}

/**
 * Get in-progress task from ready.json
 */
function getInProgressTask() {
  try {
    const readyData = safeJsonParse(PATHS.ready, {});
    const inProgress = getArraySafe(readyData, 'inProgress');
    return inProgress.length > 0 ? inProgress[0] : null;
  } catch (err) {
    return null;
  }
}

/**
 * Get next ready task sorted by priority
 */
function getNextReadyTask() {
  try {
    const readyData = safeJsonParse(PATHS.ready, {});
    const ready = getArraySafe(readyData, 'ready');

    if (ready.length === 0) return null;

    // Sort by priority (P0 = highest), using safe parsing
    const sorted = [...ready].sort((a, b) => {
      const pa = parsePriority(a && a.priority);
      const pb = parsePriority(b && b.priority);
      return pa - pb;
    });

    return sorted[0];
  } catch (err) {
    return null;
  }
}

/**
 * Get next captured idea from backlog
 */
function getNextCapture() {
  try {
    const readyData = safeJsonParse(PATHS.ready, {});
    const backlog = getArraySafe(readyData, 'backlog');

    // Look for items that are raw captures (not yet stories)
    const captures = backlog.filter(item =>
      item && typeof item === 'object' &&
      item.source === 'capture' &&
      !item.converted
    );

    return captures.length > 0 ? captures[0] : null;
  } catch (err) {
    return null;
  }
}

// ============================================================================
// Task Execution
// ============================================================================

/**
 * Execute a task using flow start
 * @param {string} taskId - Task ID to execute
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution result
 */
async function executeTask(taskId, options = {}) {
  const { spawnSync } = require('child_process');

  const args = ['scripts/flow-start.js', taskId];

  if (options.yolo) {
    args.push('--yolo');
  }

  console.log(color('dim', `  Running: flow start ${taskId}${options.yolo ? ' --yolo' : ''}`));

  try {
    const result = spawnSync('node', args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      timeout: options.taskTimeout || DEFAULT_CONFIG.taskTimeout
    });

    if (result.status === 0) {
      return { success: true };
    } else {
      return {
        success: false,
        error: `Exit code: ${result.status}`,
        signal: result.signal
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Create a story from a captured idea
 * @param {Object} capture - Capture data
 * @returns {Promise<Object>} Created story info
 */
async function createStoryFromCapture(capture) {
  const { spawnSync } = require('child_process');

  console.log(color('dim', `  Creating story from capture: "${capture.title}"`));

  const result = spawnSync('node', ['scripts/flow-story.js', capture.title], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 60000
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create story: ${result.stderr || 'Unknown error'}`);
  }

  // Parse the output to get the story ID
  const output = result.stdout || '';
  const idMatch = output.match(/wf-[a-z0-9]+/);

  if (!idMatch) {
    throw new Error('Could not parse story ID from output');
  }

  // Mark capture as converted
  markCaptureConverted(capture);

  return {
    id: idMatch[0],
    title: capture.title
  };
}

/**
 * Mark a capture as converted to story
 * @param {Object} capture - Capture to mark
 */
function markCaptureConverted(capture) {
  try {
    const readyData = safeJsonParse(PATHS.ready, {});
    const backlog = readyData.backlog || [];

    const index = backlog.findIndex(item =>
      item && typeof item === 'object' &&
      item.title === capture.title &&
      item.source === 'capture'
    );

    if (index >= 0) {
      backlog[index].converted = true;
      backlog[index].convertedAt = new Date().toISOString();
      readyData.backlog = backlog;
      writeJson(PATHS.ready, readyData);
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] markCaptureConverted: ${err.message}`);
    }
  }
}

// ============================================================================
// Context Management
// ============================================================================

/**
 * Get estimated context usage (placeholder - real implementation would check actual usage)
 * @returns {number} Context usage as decimal (0-1)
 */
function getContextUsage() {
  // In a real implementation, this would check Claude's actual context usage
  // For now, return a safe value
  return 0.5;
}

/**
 * Run context compaction
 * @returns {Promise<boolean>} Success
 */
async function runCompact() {
  const { spawnSync } = require('child_process');

  console.log(color('yellow', '  Running context compaction...'));

  const result = spawnSync('node', ['scripts/flow-compact.js'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    timeout: 120000
  });

  return result.status === 0;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format duration in human-readable form
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// ============================================================================
// Main Loop
// ============================================================================

/**
 * Run the bulk loop
 * @param {Object} options - Loop options
 */
async function runBulkLoop(options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options
  };

  tasksCompleted = 0;
  consecutiveErrors = 0;
  startTime = Date.now();
  running = true;

  console.log('');
  console.log(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(color('cyan', '🔄 BULK LOOP STARTED'));
  console.log(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`Mode: ${config.yolo ? color('yellow', 'YOLO (auto-approve)') : 'Standard'}`);
  console.log(`Max tasks: ${config.maxTasks === Infinity ? 'Unlimited' : config.maxTasks}`);
  console.log(`Max iterations: ${config.maxIterations}`);
  console.log(`Timeout: ${config.loopTimeout ? formatDuration(config.loopTimeout) : 'None'}`);
  console.log(`Create stories: ${config.noCreate ? 'No' : 'Yes'}`);
  console.log(`Dry run: ${config.dryRun ? 'Yes' : 'No'}`);
  console.log('');
  console.log(color('dim', 'Press Ctrl+C to stop gracefully'));
  console.log('');

  let iterations = 0;

  while (running) {
    iterations++;

    // Check stop conditions
    if (tasksCompleted >= config.maxTasks) {
      console.log(color('green', '✓ Max tasks reached. Stopping.'));
      break;
    }

    if (iterations > config.maxIterations) {
      console.log(color('yellow', '⚠ Max iterations reached. Stopping.'));
      break;
    }

    if (consecutiveErrors >= config.errorThreshold) {
      console.log(color('red', '✗ Error threshold exceeded. Stopping.'));
      break;
    }

    // Check timeout (if configured)
    if (config.loopTimeout && (Date.now() - startTime) >= config.loopTimeout) {
      console.log(color('yellow', `⚠ Timeout reached (${formatDuration(config.loopTimeout)}). Stopping.`));
      break;
    }

    // Check context usage
    const contextUsage = getContextUsage();
    if (contextUsage >= config.contextThreshold) {
      console.log(color('yellow', `⚠ Context at ${Math.round(contextUsage * 100)}%. Running compact...`));
      await runCompact();
    }

    // Find next work item
    const work = findNextWork(config.noCreate);

    if (!work) {
      console.log(color('dim', `No work found. Sleeping ${config.pollInterval / 1000}s...`));
      await sleep(config.pollInterval);
      continue;
    }

    console.log('');
    console.log(color('cyan', `[${tasksCompleted + 1}] Processing: ${work.title}`));
    console.log(color('dim', `  Source: ${work.source}${work.priority ? ` | Priority: ${work.priority}` : ''}`));

    if (config.dryRun) {
      console.log(color('yellow', '  [DRY RUN] Would execute this task'));
      tasksCompleted++;
      consecutiveErrors = 0;
      continue;
    }

    try {
      // If raw capture, create story first
      if (work.type === 'capture') {
        console.log(color('dim', '  → Creating story from capture...'));
        const story = await createStoryFromCapture(work.captureData);
        work.taskId = story.id;
        work.title = story.title;
      }

      // Execute the task
      const result = await executeTask(work.taskId, {
        yolo: config.yolo,
        taskTimeout: config.taskTimeout
      });

      if (result.success) {
        tasksCompleted++;
        consecutiveErrors = 0;
        console.log(color('green', `  ✓ Completed: ${work.title}`));
      } else {
        consecutiveErrors++;
        console.log(color('red', `  ✗ Failed: ${result.error}`));
      }
    } catch (err) {
      consecutiveErrors++;
      console.log(color('red', `  ✗ Error: ${err.message}`));
    }

    // Small delay between tasks
    if (running) {
      await sleep(1000);
    }
  }

  // Show summary
  const duration = Date.now() - startTime;

  console.log('');
  console.log(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(color('cyan', '🏁 BULK LOOP COMPLETE'));
  console.log(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`Tasks completed: ${tasksCompleted}`);
  console.log(`Iterations: ${iterations}`);
  console.log(`Duration: ${formatDuration(duration)}`);
  console.log(`Errors: ${consecutiveErrors > 0 ? color('red', consecutiveErrors.toString()) : '0'}`);
  console.log('');

  return {
    tasksCompleted,
    iterations,
    duration,
    errors: consecutiveErrors
  };
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(args) {
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--yolo':
        options.yolo = true;
        break;
      case '--no-create':
        options.noCreate = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--max-tasks':
        options.maxTasks = parseInt(args[++i]) || DEFAULT_CONFIG.maxTasks;
        break;
      case '--max-iterations':
        options.maxIterations = parseInt(args[++i]) || DEFAULT_CONFIG.maxIterations;
        break;
      case '--poll-interval': {
        const pollVal = parseInt(args[++i], 10);
        if (!isNaN(pollVal) && pollVal > 0) {
          options.pollInterval = pollVal * 1000;
        }
        break;
      }
      case '--timeout': {
        // Parse timeout like "30m", "1h", "2h" with bounds checking
        const timeoutArg = args[++i];
        if (timeoutArg) {
          const match = timeoutArg.match(/^(\d+)([mh])$/);
          if (match) {
            const value = parseInt(match[1], 10);
            const unit = match[2];
            // Enforce bounds: 1 minute to 24 hours
            const maxMinutes = unit === 'h' ? 24 * 60 : 24 * 60;
            const minutes = unit === 'h' ? value * 60 : value;
            if (minutes >= 1 && minutes <= maxMinutes) {
              options.loopTimeout = minutes * 60 * 1000;
            } else {
              console.warn(`Warning: timeout must be between 1m and 24h, got ${timeoutArg}`);
            }
          }
        }
        break;
      }
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Usage: flow bulk-loop [options]

Continuous work loop - processes captured ideas and tasks automatically.

Options:
  --yolo              Skip approval prompts (NOT quality gates)
  --no-create         Only process existing tasks, don't create from captures
  --dry-run           Show what would be processed without executing
  --max-tasks N       Stop after N tasks (default: unlimited)
  --max-iterations N  Stop after N iterations (default: 100)
  --poll-interval N   Seconds between checks when idle (default: 10)
  --timeout 2h        Stop after duration (e.g., 30m, 1h, 2h)
  -h, --help          Show this help message

Stop Conditions:
  - Ctrl+C (graceful stop)
  - Max tasks reached
  - Max iterations reached
  - 3 consecutive errors
  - Context at 80% triggers auto-compact (continues after)

Examples:
  flow bulk-loop                    # Start continuous loop
  flow bulk-loop --yolo             # Auto-approve mode
  flow bulk-loop --max-tasks 5      # Stop after 5 tasks
  flow bulk-loop --timeout 2h       # Stop after 2 hours
  flow bulk-loop --dry-run          # Show what would be processed
`);
}

// ============================================================================
// Main
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runBulkLoop(options)
    .then(result => {
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error(color('red', `Error: ${err.message}`));
      process.exit(1);
    });
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  runBulkLoop,
  findNextWork,
  executeTask,
  createStoryFromCapture,
  DEFAULT_CONFIG
};
