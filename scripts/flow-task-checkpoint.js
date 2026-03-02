#!/usr/bin/env node

/**
 * Wogi Flow - Task Checkpoint Manager
 *
 * Saves and restores task state at phase boundaries.
 * Enables lossless recovery after Claude's auto-compaction.
 *
 * Key features:
 * - Saves full task state (phase, scenarios, spec, files, verifications)
 * - Restores from checkpoint after auto-compact or session loss
 * - Integrates with flow-session-state for session continuity
 *
 * Part of S1: Smart Context Compaction
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  STATE_DIR,
  readJson,
  writeJson,
  withLock,
  fileExists,
  validateTaskId
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const CHECKPOINT_PATH = path.join(STATE_DIR, 'task-checkpoint.json');

/**
 * Valid phases for checkpoint tracking.
 * Maps to the /wogi-start execution flow.
 */
const VALID_PHASES = [
  'triage',
  'exploring',
  'spec_review',
  'coding',
  'scenario',       // Individual scenario execution
  'criteria_check',
  'wiring_check',
  'standards_check',
  'validating',
  'completing'
];

// ============================================================
// Checkpoint Structure
// ============================================================

/**
 * Create default checkpoint structure
 * @returns {Object} Empty checkpoint
 */
function getDefaultCheckpoint() {
  return {
    version: '1.0.0',
    taskId: null,
    taskTitle: null,
    currentPhase: null,
    phaseStartedAt: null,
    specPath: null,
    scenarios: {
      total: 0,
      completed: [],
      pending: [],
      currentIndex: -1
    },
    changedFiles: [],
    verificationResults: [],
    explorationSummary: null,
    completedPhases: [],
    lastUpdated: null,
    autoCompactRecovery: false
  };
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Save a checkpoint at the current phase boundary.
 *
 * @param {Object} params - Checkpoint data
 * @param {string} params.taskId - Task ID (wf-XXXXXXXX format)
 * @param {string} params.taskTitle - Human-readable task title
 * @param {string} params.currentPhase - Current execution phase
 * @param {string} [params.specPath] - Path to spec file
 * @param {Object} [params.scenarios] - Scenario tracking state
 * @param {string[]} [params.changedFiles] - Files modified so far
 * @param {Array} [params.verificationResults] - Verification outcomes
 * @param {string} [params.explorationSummary] - Explore phase summary
 * @returns {Promise<boolean>} True if checkpoint saved successfully
 */
async function saveCheckpoint(params) {
  const { taskId, taskTitle, currentPhase } = params;

  if (!taskId || !validateTaskId(taskId).valid) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Invalid task ID: ${taskId}`);
    }
    return false;
  }

  if (currentPhase && !VALID_PHASES.includes(currentPhase)) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Invalid phase: ${currentPhase}`);
    }
    return false;
  }

  try {
    return await withLock(CHECKPOINT_PATH, () => {
      const existing = readJson(CHECKPOINT_PATH, getDefaultCheckpoint());

      const checkpoint = {
        ...existing,
        version: '1.0.0',
        taskId,
        taskTitle: taskTitle || existing.taskTitle,
        currentPhase: currentPhase || existing.currentPhase,
        phaseStartedAt: new Date().toISOString(),
        specPath: params.specPath || existing.specPath,
        scenarios: params.scenarios || existing.scenarios,
        changedFiles: params.changedFiles || existing.changedFiles,
        verificationResults: params.verificationResults || existing.verificationResults,
        explorationSummary: params.explorationSummary || existing.explorationSummary,
        lastUpdated: new Date().toISOString(),
        autoCompactRecovery: false
      };

      // Track completed phases — add the PREVIOUS phase (not the one just starting)
      // This prevents marking a phase as "completed" before it actually finishes
      if (existing.currentPhase && existing.currentPhase !== currentPhase
          && !checkpoint.completedPhases.includes(existing.currentPhase)) {
        checkpoint.completedPhases.push(existing.currentPhase);
      }

      writeJson(CHECKPOINT_PATH, checkpoint);

      if (process.env.DEBUG) {
        console.log(`[checkpoint] Saved: ${taskId} at phase ${currentPhase}`);
      }

      return true;
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Save failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Load the current checkpoint.
 *
 * @returns {Object|null} Checkpoint data or null if none exists
 */
function loadCheckpoint() {
  try {
    if (!fileExists(CHECKPOINT_PATH)) {
      return null;
    }

    const checkpoint = readJson(CHECKPOINT_PATH, null);
    if (!checkpoint || !checkpoint.taskId) {
      return null;
    }

    return checkpoint;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Load failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Mark the current checkpoint for auto-compact recovery.
 * Called when we detect Claude's auto-compact has fired.
 *
 * @returns {boolean} True if marked successfully
 */
function markForRecovery() {
  try {
    const checkpoint = loadCheckpoint();
    if (!checkpoint) return false;

    checkpoint.autoCompactRecovery = true;
    checkpoint.lastUpdated = new Date().toISOString();
    writeJson(CHECKPOINT_PATH, checkpoint);

    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Mark for recovery failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Restore task state from checkpoint.
 * Returns the checkpoint and clears the recovery flag.
 *
 * @returns {Object|null} Restored checkpoint or null
 */
function restoreFromCheckpoint() {
  try {
    const checkpoint = loadCheckpoint();
    if (!checkpoint) return null;

    // Clear the recovery flag after restoring
    checkpoint.autoCompactRecovery = false;
    checkpoint.lastUpdated = new Date().toISOString();
    writeJson(CHECKPOINT_PATH, checkpoint);

    return checkpoint;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Restore failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Clear checkpoint (after task completion).
 *
 * @param {string} [taskId] - Only clear if matching this task ID
 * @returns {boolean} True if cleared
 */
function clearCheckpoint(taskId) {
  try {
    if (!fileExists(CHECKPOINT_PATH)) return true;

    if (taskId) {
      const checkpoint = loadCheckpoint();
      if (checkpoint && checkpoint.taskId !== taskId) {
        return false; // Don't clear a different task's checkpoint
      }
    }

    writeJson(CHECKPOINT_PATH, getDefaultCheckpoint());
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Clear failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Update scenario progress within the current checkpoint.
 *
 * @param {number} scenarioIndex - Index of the completed scenario
 * @param {string} scenarioTitle - Description of the scenario
 * @param {boolean} passed - Whether the scenario passed verification
 * @returns {boolean} True if updated
 */
function updateScenarioProgress(scenarioIndex, scenarioTitle, passed) {
  try {
    const checkpoint = loadCheckpoint();
    if (!checkpoint) return false;

    const { scenarios } = checkpoint;

    // Move from pending to completed
    scenarios.completed.push({
      index: scenarioIndex,
      title: scenarioTitle,
      passed,
      completedAt: new Date().toISOString()
    });

    // Remove from pending if present
    scenarios.pending = scenarios.pending.filter(
      (p) => p.index !== scenarioIndex
    );

    scenarios.currentIndex = scenarioIndex;
    checkpoint.lastUpdated = new Date().toISOString();

    writeJson(CHECKPOINT_PATH, checkpoint);
    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] Scenario update failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Add a changed file to the checkpoint.
 *
 * @param {string} filePath - Path of the changed file
 * @returns {boolean} True if added
 */
function trackChangedFile(filePath) {
  try {
    const checkpoint = loadCheckpoint();
    if (!checkpoint) return false;

    if (!checkpoint.changedFiles.includes(filePath)) {
      checkpoint.changedFiles.push(filePath);
      checkpoint.lastUpdated = new Date().toISOString();
      writeJson(CHECKPOINT_PATH, checkpoint);
    }

    return true;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[checkpoint] File tracking failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Format checkpoint for display (used in recovery messages).
 *
 * @param {Object} checkpoint - Checkpoint data
 * @returns {string} Formatted display string
 */
function formatCheckpointSummary(checkpoint) {
  if (!checkpoint) return 'No checkpoint available.';

  const lines = [];
  lines.push(`Task: ${checkpoint.taskId} — ${checkpoint.taskTitle || 'Untitled'}`);
  lines.push(`Phase: ${checkpoint.currentPhase || 'unknown'}`);
  lines.push(`Last Updated: ${checkpoint.lastUpdated || 'unknown'}`);

  const { scenarios } = checkpoint;
  if (scenarios && scenarios.total > 0) {
    lines.push(`Scenarios: ${scenarios.completed.length}/${scenarios.total} completed`);
    if (scenarios.pending.length > 0) {
      lines.push(`Pending: ${scenarios.pending.map((s) => s.title || `#${s.index}`).join(', ')}`);
    }
  }

  if (checkpoint.changedFiles.length > 0) {
    lines.push(`Changed Files: ${checkpoint.changedFiles.length}`);
  }

  if (checkpoint.specPath) {
    lines.push(`Spec: ${checkpoint.specPath}`);
  }

  if (checkpoint.completedPhases.length > 0) {
    lines.push(`Completed Phases: ${checkpoint.completedPhases.join(' → ')}`);
  }

  return lines.join('\n');
}

/**
 * Check if a checkpoint needs recovery (e.g., after auto-compact).
 *
 * @returns {{ needsRecovery: boolean, checkpoint: Object|null }}
 */
function checkRecoveryNeeded() {
  const checkpoint = loadCheckpoint();
  if (!checkpoint || !checkpoint.taskId) {
    return { needsRecovery: false, checkpoint: null };
  }

  // If explicitly marked for recovery
  if (checkpoint.autoCompactRecovery) {
    return { needsRecovery: true, checkpoint };
  }

  // If checkpoint is recent (within last 2 hours) and task has incomplete scenarios
  const lastUpdated = new Date(checkpoint.lastUpdated);
  const ageMs = Date.now() - lastUpdated.getTime();
  const twoHours = 2 * 60 * 60 * 1000;

  if (ageMs < twoHours && checkpoint.currentPhase && checkpoint.currentPhase !== 'completing') {
    const { scenarios } = checkpoint;
    if (scenarios.total > 0 && scenarios.completed.length < scenarios.total) {
      return { needsRecovery: true, checkpoint };
    }
  }

  return { needsRecovery: false, checkpoint };
}

// ============================================================
// CLI
// ============================================================

function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'save': {
      const taskId = args[0];
      const phase = args[1];
      if (!taskId || !phase) {
        console.error('Usage: flow-task-checkpoint.js save <taskId> <phase>');
        process.exit(1);
      }
      saveCheckpoint({ taskId, currentPhase: phase }).then((ok) => {
        if (ok) console.log(`Checkpoint saved: ${taskId} at ${phase}`);
        else {
          console.error('Checkpoint save failed');
          process.exit(1);
        }
      });
      break;
    }

    case 'load': {
      const checkpoint = loadCheckpoint();
      if (checkpoint) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log('No checkpoint found.');
      }
      break;
    }

    case 'check': {
      const { needsRecovery, checkpoint } = checkRecoveryNeeded();
      if (needsRecovery) {
        console.log('Recovery needed:');
        console.log(formatCheckpointSummary(checkpoint));
      } else {
        console.log('No recovery needed.');
      }
      break;
    }

    case 'clear': {
      const cleared = clearCheckpoint(args[0]);
      console.log(cleared ? 'Checkpoint cleared.' : 'Clear failed or task mismatch.');
      break;
    }

    case 'summary': {
      const cp = loadCheckpoint();
      console.log(formatCheckpointSummary(cp));
      break;
    }

    default:
      console.log(`
Task Checkpoint Manager

Usage: flow-task-checkpoint.js <command> [args]

Commands:
  save <taskId> <phase>  Save checkpoint
  load                   Load current checkpoint (JSON)
  check                  Check if recovery is needed
  clear [taskId]         Clear checkpoint
  summary                Show formatted summary

Examples:
  flow-task-checkpoint.js save wf-a1b2c3d4 exploring
  flow-task-checkpoint.js check
  flow-task-checkpoint.js clear wf-a1b2c3d4
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  CHECKPOINT_PATH,
  VALID_PHASES,
  saveCheckpoint,
  loadCheckpoint,
  markForRecovery,
  restoreFromCheckpoint,
  clearCheckpoint,
  updateScenarioProgress,
  trackChangedFile,
  formatCheckpointSummary,
  checkRecoveryNeeded
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
