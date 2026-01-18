#!/usr/bin/env node

/**
 * Wogi Flow - Phased Task Execution
 *
 * Coordinates progressive implementation phases for complex tasks.
 * Based on recursive language model principles - focus on one concern
 * at a time with context isolation between phases.
 *
 * Default Phases:
 * 1. Contract - Define types, interfaces, API contracts
 * 2. Skeleton - Create file structure, stub implementations
 * 3. Core Logic - Implement happy path
 * 4. Edge Cases - Handle errors and edge cases
 * 5. Polish - Optimization, cleanup, docs
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  getConfig,
  readJson,
  writeJson,
  ensureDir,
  color,
  success,
  warn,
  error,
  info
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const PHASED_STATE_PATH = path.join(PATHS.state, 'phased-tasks.json');

/**
 * Default phase definitions (used if not in config)
 */
const DEFAULT_PHASES = [
  { id: 'contract', name: 'Contract', description: 'Define interfaces, types, API contracts' },
  { id: 'skeleton', name: 'Skeleton', description: 'Create file structure, stub implementations' },
  { id: 'core', name: 'Core Logic', description: 'Implement main business logic' },
  { id: 'edge-cases', name: 'Edge Cases', description: 'Handle edge cases and error states' },
  { id: 'polish', name: 'Polish', description: 'Optimization, cleanup, documentation' }
];

// ============================================================
// State Management
// ============================================================

/**
 * Load phased task state
 * @returns {Object} State object
 */
function loadPhasedState() {
  if (!fs.existsSync(PHASED_STATE_PATH)) {
    return { tasks: {} };
  }
  try {
    return readJson(PHASED_STATE_PATH) || { tasks: {} };
  } catch (err) {
    // Log error for debugging but return empty state to avoid breaking flow
    if (process.env.DEBUG) console.error('Failed to load phased state:', err.message);
    return { tasks: {} };
  }
}

/**
 * Save phased task state
 * @param {Object} state - State to save
 */
function savePhasedState(state) {
  ensureDir(path.dirname(PHASED_STATE_PATH));
  writeJson(PHASED_STATE_PATH, state);
}

/**
 * Get phase definitions from config
 * @returns {Object[]} Phase definitions
 */
function getPhaseDefinitions() {
  const config = getConfig();
  const phases = config.phases?.definitions;
  return phases && phases.length > 0 ? phases : DEFAULT_PHASES;
}

/**
 * Check if phased mode is enabled
 * @returns {boolean}
 */
function isPhasedModeEnabled() {
  const config = getConfig();
  return config.phases?.enabled === true;
}

// ============================================================
// Phased Task Operations
// ============================================================

/**
 * Initialize phased execution for a task
 * @param {string} taskId - Task ID
 * @param {Object} options - Options
 * @returns {Object} Initialized phased task
 */
function initializePhasedTask(taskId, options = {}) {
  const {
    phases = null,      // Custom phases or use defaults
    skipPhases = [],    // Phase IDs to skip
    startPhase = null   // Start from specific phase
  } = options;

  const phaseDefinitions = phases || getPhaseDefinitions();

  // Filter out skipped phases
  const activePhases = phaseDefinitions.filter(p => !skipPhases.includes(p.id));

  // Find start index
  let startIndex = 0;
  if (startPhase) {
    const idx = activePhases.findIndex(p => p.id === startPhase);
    if (idx >= 0) startIndex = idx;
  }

  const phasedTask = {
    taskId,
    phases: activePhases.map((p, idx) => ({
      ...p,
      index: idx,
      status: idx < startIndex ? 'skipped' : 'pending',
      startedAt: null,
      completedAt: null,
      output: null,
      notes: []
    })),
    currentPhaseIndex: startIndex,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'active'
  };

  // Mark first phase as active
  if (phasedTask.phases.length > startIndex) {
    phasedTask.phases[startIndex].status = 'active';
    phasedTask.phases[startIndex].startedAt = new Date().toISOString();
  }

  // Save state
  const state = loadPhasedState();
  state.tasks[taskId] = phasedTask;
  savePhasedState(state);

  return phasedTask;
}

/**
 * Get current phase for a task
 * @param {string} taskId - Task ID
 * @returns {Object|null} Current phase or null
 */
function getCurrentPhase(taskId) {
  const state = loadPhasedState();
  const task = state.tasks[taskId];

  if (!task || task.status !== 'active') {
    return null;
  }

  return task.phases[task.currentPhaseIndex] || null;
}

/**
 * Complete current phase and move to next
 * @param {string} taskId - Task ID
 * @param {Object} result - Phase completion result
 * @returns {Object} Updated task state
 */
function completePhase(taskId, result = {}) {
  const state = loadPhasedState();
  const task = state.tasks[taskId];

  if (!task) {
    return { error: `Task ${taskId} not found in phased state` };
  }

  const currentIndex = task.currentPhaseIndex;
  const currentPhase = task.phases[currentIndex];

  if (!currentPhase) {
    return { error: 'No current phase' };
  }

  // Mark current phase complete
  currentPhase.status = 'completed';
  currentPhase.completedAt = new Date().toISOString();
  currentPhase.output = result.output || null;
  if (result.notes) {
    currentPhase.notes.push(...(Array.isArray(result.notes) ? result.notes : [result.notes]));
  }

  // Move to next phase
  const nextIndex = currentIndex + 1;
  if (nextIndex < task.phases.length) {
    task.currentPhaseIndex = nextIndex;
    task.phases[nextIndex].status = 'active';
    task.phases[nextIndex].startedAt = new Date().toISOString();

    savePhasedState(state);

    return {
      completed: currentPhase,
      next: task.phases[nextIndex],
      taskStatus: 'active',
      remainingPhases: task.phases.length - nextIndex
    };
  } else {
    // All phases complete
    task.status = 'completed';
    task.completedAt = new Date().toISOString();

    savePhasedState(state);

    return {
      completed: currentPhase,
      next: null,
      taskStatus: 'completed',
      remainingPhases: 0
    };
  }
}

/**
 * Skip current phase
 * @param {string} taskId - Task ID
 * @param {string} reason - Reason for skipping
 * @returns {Object} Updated state
 */
function skipPhase(taskId, reason = 'User requested skip') {
  const state = loadPhasedState();
  const task = state.tasks[taskId];

  if (!task) {
    return { error: `Task ${taskId} not found` };
  }

  const currentPhase = task.phases[task.currentPhaseIndex];
  if (currentPhase) {
    currentPhase.status = 'skipped';
    currentPhase.notes.push(`Skipped: ${reason}`);
  }

  return completePhase(taskId, { output: 'Skipped', notes: [reason] });
}

/**
 * Add note to current phase
 * @param {string} taskId - Task ID
 * @param {string} note - Note to add
 */
function addPhaseNote(taskId, note) {
  const state = loadPhasedState();
  const task = state.tasks[taskId];

  if (!task) return;

  const currentPhase = task.phases[task.currentPhaseIndex];
  if (currentPhase) {
    currentPhase.notes.push(note);
    savePhasedState(state);
  }
}

/**
 * Get phased task status
 * @param {string} taskId - Task ID
 * @returns {Object|null} Task status
 */
function getPhasedTaskStatus(taskId) {
  const state = loadPhasedState();
  return state.tasks[taskId] || null;
}

/**
 * Remove phased task state (cleanup)
 * @param {string} taskId - Task ID
 */
function removePhasedTask(taskId) {
  const state = loadPhasedState();
  delete state.tasks[taskId];
  savePhasedState(state);
}

// ============================================================
// Phase Context Generation
// ============================================================

/**
 * Generate context prompt for a phase
 * @param {Object} phase - Phase definition
 * @param {Object} task - Task info
 * @param {Object} previousPhases - Results from previous phases
 * @returns {string} Context prompt
 */
function generatePhaseContext(phase, task, previousPhases = []) {
  const lines = [];

  lines.push(`## Phase: ${phase.name}`);
  lines.push('');
  lines.push(`**Focus**: ${phase.description}`);
  lines.push('');
  lines.push(`**Objective**: ${phase.output || 'Complete this phase successfully'}`);
  lines.push('');

  // Add constraints based on phase
  lines.push('**Phase Constraints**:');
  if (phase.id === 'contract') {
    lines.push('- Focus ONLY on type definitions and interfaces');
    lines.push('- Do NOT implement any business logic');
    lines.push('- Define clear contracts that later phases will implement');
  } else if (phase.id === 'skeleton') {
    lines.push('- Create file structure and stub functions');
    lines.push('- Throw NotImplementedError or TODO comments in stubs');
    lines.push('- Do NOT implement actual logic yet');
  } else if (phase.id === 'core') {
    lines.push('- Implement the happy path only');
    lines.push('- Assume valid inputs for now');
    lines.push('- Focus on making the main flow work');
  } else if (phase.id === 'edge-cases') {
    lines.push('- Add error handling and validation');
    lines.push('- Handle edge cases identified in core phase');
    lines.push('- Do NOT refactor working core logic');
  } else if (phase.id === 'polish') {
    lines.push('- Optimize if needed (measure first)');
    lines.push('- Add JSDoc/comments where helpful');
    lines.push('- Clean up any TODO comments');
  }
  lines.push('');

  // Add previous phase outputs if available
  if (previousPhases.length > 0) {
    lines.push('**Previous Phase Outputs**:');
    for (const prev of previousPhases) {
      if (prev.output) {
        lines.push(`- ${prev.name}: ${prev.output}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate phase focus keywords
 * @param {Object} phase - Phase definition
 * @returns {string[]} Focus keywords
 */
function getPhaseKeywords(phase) {
  const keywordMap = {
    contract: ['interface', 'type', 'typedef', 'contract', 'schema', 'definition'],
    skeleton: ['stub', 'scaffold', 'structure', 'file', 'directory', 'placeholder'],
    core: ['implement', 'logic', 'function', 'method', 'algorithm', 'happy-path'],
    'edge-cases': ['error', 'validation', 'edge', 'boundary', 'exception', 'fallback'],
    polish: ['optimize', 'cleanup', 'document', 'refactor', 'performance', 'comment']
  };

  return keywordMap[phase.id] || phase.focus || [];
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format phased task status for display
 * @param {Object} task - Phased task state
 * @returns {string} Formatted status
 */
function formatPhasedStatus(task) {
  if (!task) return 'No phased task found';

  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  Phased Task: ${task.taskId}`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  const completedCount = task.phases.filter(p => p.status === 'completed').length;
  const totalCount = task.phases.length;

  lines.push(`Progress: ${completedCount}/${totalCount} phases complete`);
  lines.push('');

  for (const phase of task.phases) {
    let icon;
    switch (phase.status) {
      case 'completed': icon = '✓'; break;
      case 'active': icon = '→'; break;
      case 'skipped': icon = '○'; break;
      default: icon = '·';
    }

    const statusColor = phase.status === 'active' ? 'cyan' :
                       phase.status === 'completed' ? 'green' :
                       phase.status === 'skipped' ? 'gray' : 'reset';

    lines.push(`${icon} ${phase.name}: ${color(statusColor, phase.status)}`);

    if (phase.status === 'active') {
      lines.push(`  Focus: ${phase.description}`);
    }

    if (phase.output && phase.status === 'completed') {
      lines.push(`  Output: ${phase.output}`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // State management
  loadPhasedState,
  savePhasedState,
  getPhaseDefinitions,
  isPhasedModeEnabled,

  // Task operations
  initializePhasedTask,
  getCurrentPhase,
  completePhase,
  skipPhase,
  addPhaseNote,
  getPhasedTaskStatus,
  removePhasedTask,

  // Context generation
  generatePhaseContext,
  getPhaseKeywords,

  // Formatting
  formatPhasedStatus,

  // Constants
  DEFAULT_PHASES,
  PHASED_STATE_PATH
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const taskId = args[1];

  switch (command) {
    case 'init':
      if (!taskId) {
        error('Usage: flow-phased-task init <taskId>');
        process.exit(1);
      }
      const result = initializePhasedTask(taskId);
      console.log(formatPhasedStatus(result));
      break;

    case 'status':
      if (!taskId) {
        error('Usage: flow-phased-task status <taskId>');
        process.exit(1);
      }
      const status = getPhasedTaskStatus(taskId);
      console.log(formatPhasedStatus(status));
      break;

    case 'complete':
      if (!taskId) {
        error('Usage: flow-phased-task complete <taskId>');
        process.exit(1);
      }
      const completeResult = completePhase(taskId, { output: args[2] || 'Completed' });
      if (completeResult.error) {
        error(completeResult.error);
      } else {
        success(`Phase completed: ${completeResult.completed.name}`);
        if (completeResult.next) {
          info(`Next phase: ${completeResult.next.name}`);
        } else {
          success('All phases complete!');
        }
      }
      break;

    case 'skip':
      if (!taskId) {
        error('Usage: flow-phased-task skip <taskId> [reason]');
        process.exit(1);
      }
      const skipResult = skipPhase(taskId, args[2] || 'Skipped by user');
      if (skipResult.error) {
        error(skipResult.error);
      } else {
        info(`Phase skipped: ${skipResult.completed.name}`);
        if (skipResult.next) {
          info(`Next phase: ${skipResult.next.name}`);
        }
      }
      break;

    case 'phases':
      console.log('Available phases:');
      const phases = getPhaseDefinitions();
      phases.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.name}: ${p.description}`);
      });
      break;

    default:
      console.log(`
Phased Task Execution

Usage: node flow-phased-task <command> <taskId> [options]

Commands:
  init <taskId>              Initialize phased execution for task
  status <taskId>            Show current phase status
  complete <taskId> [output] Complete current phase
  skip <taskId> [reason]     Skip current phase
  phases                     List available phase definitions

Options:
  --skip-phases=<ids>        Skip specific phases (comma-separated)
  --start-phase=<id>         Start from specific phase
`);
  }
}
