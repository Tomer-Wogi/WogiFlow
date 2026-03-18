#!/usr/bin/env node

/**
 * Wogi Flow - Progress Tracker
 *
 * Manages progress state for long-running tasks (reviews, audits, multi-criteria).
 * Writes to .workflow/state/task-progress.json for hook/status line consumption.
 * Optionally updates task title in ready.json with progress prefix for status line.
 *
 * Usage:
 *   flow-progress-tracker.js update <json>   Update progress state
 *   flow-progress-tracker.js get             Get current progress
 *   flow-progress-tracker.js clear           Clear progress state
 *   flow-progress-tracker.js format <json>   Format a progress bar string
 *
 * The AI calls this at natural checkpoints during execution.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, safeJsonParse, safeJsonParseString, getReadyData, saveReadyData } = require('./flow-utils');

const PROGRESS_PATH = path.join(PATHS.state, 'task-progress.json');

// ============================================================
// Progress State Management
// ============================================================

/**
 * Update the progress state file.
 *
 * @param {Object} progress
 * @param {string} progress.taskId - Current task ID
 * @param {string} progress.command - Command running (e.g., "/wogi-review")
 * @param {string} progress.phase - Current phase name
 * @param {number} progress.phaseNum - Current phase number (1-based)
 * @param {number} progress.totalPhases - Total phases
 * @param {string} [progress.step] - Current sub-step description
 * @param {number} [progress.stepNum] - Current sub-step number
 * @param {number} [progress.totalSteps] - Total sub-steps in this phase
 * @param {boolean} [progress.updateTitle] - Update task title in ready.json
 * @returns {{ saved: boolean }}
 */
function updateProgress(progress) {
  const state = {
    taskId: progress.taskId,
    command: progress.command,
    phase: progress.phase,
    phaseNum: progress.phaseNum || 0,
    totalPhases: progress.totalPhases || 0,
    step: progress.step || null,
    stepNum: progress.stepNum || 0,
    totalSteps: progress.totalSteps || 0,
    percentage: calculatePercentage(progress),
    startedAt: getExistingStartTime() || new Date().toISOString(),
    lastUpdate: new Date().toISOString()
  };

  try {
    fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    return { saved: false, reason: err.message };
  }

  // Update task title in ready.json for status line visibility (opt-in)
  if (progress.updateTitle === true && state.taskId) {
    updateTaskTitle(state);
  }

  return { saved: true, state };
}

/**
 * Calculate progress percentage from phase/step numbers.
 */
function calculatePercentage(progress) {
  const { phaseNum, totalPhases, stepNum, totalSteps } = progress;
  if (!totalPhases || !phaseNum) return 0;

  // Phase-level progress
  const phaseProgress = ((phaseNum - 1) / totalPhases) * 100;

  // Step-level progress within the current phase
  const phaseWeight = 100 / totalPhases;
  const stepProgress = (totalSteps && stepNum)
    ? (stepNum / totalSteps) * phaseWeight
    : 0;

  return Math.min(100, Math.round(phaseProgress + stepProgress));
}

/**
 * Get existing start time to preserve across updates.
 */
function getExistingStartTime() {
  try {
    const existing = safeJsonParse(PROGRESS_PATH, null);
    return existing?.startedAt || null;
  } catch (err) {
    return null;
  }
}

/**
 * Update task title in ready.json with progress prefix.
 * Format: "[2/5] Original title"
 */
function updateTaskTitle(state) {
  try {
    const data = getReadyData();
    const task = data.inProgress.find(t => t.id === state.taskId);
    if (!task) return;

    // Strip any existing progress prefix
    const cleanTitle = task.title.replace(/^\[\d+\/\d+\]\s*/, '');

    // Add new prefix
    task.title = `[${state.phaseNum}/${state.totalPhases}] ${cleanTitle}`;
    saveReadyData(data);
  } catch (err) {
    // Non-fatal — title update is cosmetic
    if (process.env.DEBUG) {
      console.error(`[progress-tracker] Title update failed: ${err.message}`);
    }
  }
}

/**
 * Get current progress state.
 * @returns {Object|null}
 */
function getProgress() {
  return safeJsonParse(PROGRESS_PATH, null);
}

/**
 * Clear progress state (called on task completion).
 *
 * NOTE: Title restoration (stripping [N/M] prefix) is handled inside the
 * task-completed hook's withLock() callback to avoid race conditions on ready.json.
 * This function only deletes the progress state file.
 */
function clearProgress() {
  try {
    fs.unlinkSync(PROGRESS_PATH);
    return { cleared: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { cleared: true };
    return { cleared: false, reason: err.message };
  }
}

/**
 * Format a progress bar string for conversation output.
 *
 * @param {Object} opts
 * @param {number} opts.current - Current step
 * @param {number} opts.total - Total steps
 * @param {string} opts.label - Label text
 * @param {number} [opts.width=20] - Bar width
 * @returns {string} Formatted progress line
 */
function formatProgressBar(opts) {
  const { current, total, label, width = 20 } = opts;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const filled = total > 0 ? Math.round((current / total) * width) : 0;
  const empty = width - filled;

  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  return `[${bar}] ${pct}% ${label} (${current}/${total})`;
}

/**
 * Format a multi-level progress display for conversation output.
 *
 * @param {Object} opts
 * @param {string} opts.command - Command name
 * @param {string} opts.phase - Current phase
 * @param {number} opts.phaseNum
 * @param {number} opts.totalPhases
 * @param {string} [opts.step] - Current step within phase
 * @param {number} [opts.stepNum]
 * @param {number} [opts.totalSteps]
 * @returns {string} Multi-line progress display
 */
function formatProgress(opts) {
  const lines = [];
  const pct = calculatePercentage(opts);

  // Phase-level bar
  lines.push(formatProgressBar({
    current: opts.phaseNum,
    total: opts.totalPhases,
    label: opts.phase
  }));

  // Step-level detail (if applicable)
  if (opts.step && opts.totalSteps) {
    lines.push(`  ${opts.step} (${opts.stepNum}/${opts.totalSteps})`);
  }

  return lines.join('\n');
}

// ============================================================
// CLI Interface
// ============================================================

function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case 'update': {
      if (!arg) {
        console.error('Usage: flow-progress-tracker.js update \'{"taskId":"...","phase":"...","phaseNum":1,"totalPhases":5}\'');
        process.exit(1);
      }
      const progress = safeJsonParseString(arg, null);
      if (!progress) {
        console.error('Invalid JSON argument');
        process.exit(1);
      }
      const result = updateProgress(progress);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'get': {
      const state = getProgress();
      if (state) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(JSON.stringify({ active: false }));
      }
      break;
    }

    case 'clear': {
      const result = clearProgress();
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'format': {
      if (!arg) {
        console.error('Usage: flow-progress-tracker.js format \'{"current":2,"total":5,"label":"Phase"}\'');
        process.exit(1);
      }
      const opts = safeJsonParseString(arg, null);
      if (!opts) {
        console.error('Invalid JSON argument');
        process.exit(1);
      }
      console.log(formatProgressBar(opts));
      break;
    }

    default:
      console.log(`
Wogi Flow - Progress Tracker

Usage: flow-progress-tracker.js <command> [args]

Commands:
  update <json>   Update progress state + task title
  get             Get current progress state
  clear           Clear progress state
  format <json>   Format a progress bar string

Update format:
  {"taskId":"wf-xxx","command":"/wogi-review","phase":"AI Review","phaseNum":2,"totalPhases":5}
`);
  }
}

module.exports = {
  updateProgress,
  getProgress,
  clearProgress,
  formatProgressBar,
  formatProgress,
  calculatePercentage
};

if (require.main === module) {
  main();
}
