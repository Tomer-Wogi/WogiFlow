#!/usr/bin/env node

/**
 * Wogi Flow - TodoWrite Sync
 *
 * Syncs Wogi Flow acceptance criteria with Claude Code's native TodoWrite tool.
 * This provides unified progress tracking during task execution.
 *
 * Note: TodoWrite is Claude Code's internal tool - this module formats
 * instructions that will be displayed in output, which Claude Code
 * will use to update its native todo tracking.
 *
 * Usage:
 *   const { formatTodoWriteInit, formatTodoWriteUpdate, getTodoWriteStats } = require('./flow-todowrite-sync');
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, safeJsonParse } = require('./flow-utils');

// ============================================================================
// Constants
// ============================================================================

const TODO_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
};

// ============================================================================
// TodoWrite State Management
// ============================================================================

/**
 * Get the path to the TodoWrite state file
 */
function getTodoWriteStatePath() {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, '.workflow', 'state', 'todowrite-state.json');
}

/**
 * Load TodoWrite state for current task
 */
function loadTodoWriteState() {
  const statePath = getTodoWriteStatePath();
  return safeJsonParse(statePath, null);
}

/**
 * Save TodoWrite state
 * SECURITY: Wrapped in try-catch per security-patterns.md Rule #1
 */
function saveTodoWriteState(state) {
  const statePath = getTodoWriteStatePath();
  const dir = path.dirname(statePath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Failed to save TodoWrite state: ${err.message}`);
    // Don't throw - TodoWrite is best-effort
  }
}

/**
 * Clear TodoWrite state
 * SECURITY: Wrapped in try-catch per security-patterns.md Rule #1
 */
function clearTodoWriteState() {
  const statePath = getTodoWriteStatePath();
  try {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[DEBUG] Failed to clear TodoWrite state: ${err.message}`);
  }
}

/**
 * Recalculate stats from criteria array
 * Extracted to avoid DRY violation
 */
function recalculateStats(criteria) {
  return {
    total: criteria.length,
    pending: criteria.filter(c => c.status === TODO_STATUS.PENDING).length,
    inProgress: criteria.filter(c => c.status === TODO_STATUS.IN_PROGRESS).length,
    completed: criteria.filter(c => c.status === TODO_STATUS.COMPLETED).length
  };
}

// ============================================================================
// Acceptance Criteria Parsing
// ============================================================================

/**
 * Parse acceptance criteria from task spec
 * @param {Object} task - Task object from ready.json
 * @param {Object} spec - Loaded spec object (optional)
 * @returns {Array} Array of criteria objects
 */
function parseAcceptanceCriteria(task, spec = null) {
  const criteria = [];

  // Try spec first (most detailed)
  if (spec?.sections?.acceptanceCriteria) {
    const ac = spec.sections.acceptanceCriteria;

    // Handle array format
    if (Array.isArray(ac)) {
      ac.forEach((item, index) => {
        const content = typeof item === 'string' ? item : item.content || item.description || '';
        if (content) {
          criteria.push({
            id: `ac-${index + 1}`,
            content,
            status: TODO_STATUS.PENDING
          });
        }
      });
    }
    // Handle object format with scenarios
    else if (ac.scenarios) {
      ac.scenarios.forEach((scenario, index) => {
        const content = scenario.title || scenario.description || '';
        if (content) {
          criteria.push({
            id: `ac-${index + 1}`,
            content,
            status: TODO_STATUS.PENDING
          });
        }
      });
    }
  }

  // Fallback to task object
  if (criteria.length === 0 && task) {
    // Check various possible fields
    const sources = [
      task.acceptanceCriteria,
      task.scenarios,
      task.criteria,
      task.steps
    ];

    for (const source of sources) {
      if (Array.isArray(source) && source.length > 0) {
        source.forEach((item, index) => {
          if (!item) return; // Skip null/undefined
          const content = typeof item === 'string' ? item : item.content || item.description || item.title || '';
          if (content) {
            criteria.push({
              id: `ac-${index + 1}`,
              content,
              status: TODO_STATUS.PENDING
            });
          }
        });
        break;
      }
    }
  }

  // If still no criteria, create a generic one from task title
  if (criteria.length === 0 && task?.title) {
    criteria.push({
      id: 'main-task',
      content: task.title,
      status: TODO_STATUS.PENDING
    });
  }

  return criteria;
}

// ============================================================================
// TodoWrite Formatting
// ============================================================================

/**
 * Format acceptance criteria for TodoWrite initialization
 * This creates the instruction text that will prompt TodoWrite updates
 *
 * @param {string} taskId - Task ID
 * @param {Array} criteria - Parsed acceptance criteria
 * @returns {Object} Formatted output and state
 */
function formatTodoWriteInit(taskId, criteria) {
  if (!criteria || criteria.length === 0) {
    return { output: '', state: null };
  }

  // Create state object
  const state = {
    taskId,
    criteria: criteria.map(c => ({
      ...c,
      activeForm: toActiveForm(c.content)
    })),
    startedAt: new Date().toISOString(),
    stats: {
      total: criteria.length,
      pending: criteria.length,
      inProgress: 0,
      completed: 0
    }
  };

  // Save state
  saveTodoWriteState(state);

  // Format output message
  let output = '\n';
  output += '━'.repeat(50) + '\n';
  output += 'Task Acceptance Criteria\n';
  output += '━'.repeat(50) + '\n';
  output += `Task: ${taskId}\n`;
  output += `Criteria: ${criteria.length}\n\n`;

  criteria.forEach((c, index) => {
    output += `  ${index + 1}. ○ ${c.content}\n`;
  });

  output += '\n';
  output += 'Progress will be tracked as criteria are verified.\n';
  output += '━'.repeat(50) + '\n';

  return { output, state };
}

/**
 * Convert task description to active form (present continuous)
 * @param {string} content - Task content
 * @returns {string} Active form
 */
function toActiveForm(content) {
  // Simple transformation rules
  const lowerContent = content.toLowerCase();

  // Already in active form
  if (lowerContent.match(/^(adding|creating|implementing|fixing|updating|removing|building)/)) {
    return content;
  }

  // Transform common patterns
  const transformations = [
    [/^add\b/i, 'Adding'],
    [/^create\b/i, 'Creating'],
    [/^implement\b/i, 'Implementing'],
    [/^fix\b/i, 'Fixing'],
    [/^update\b/i, 'Updating'],
    [/^remove\b/i, 'Removing'],
    [/^build\b/i, 'Building'],
    [/^write\b/i, 'Writing'],
    [/^test\b/i, 'Testing'],
    [/^verify\b/i, 'Verifying'],
    [/^check\b/i, 'Checking'],
    [/^ensure\b/i, 'Ensuring'],
    [/^validate\b/i, 'Validating'],
    [/^handle\b/i, 'Handling'],
    [/^support\b/i, 'Supporting']
  ];

  for (const [pattern, replacement] of transformations) {
    if (pattern.test(content)) {
      return content.replace(pattern, replacement);
    }
  }

  // Default: prefix with "Working on"
  return `Working on: ${content}`;
}

/**
 * Format TodoWrite update for a criterion status change
 *
 * @param {string} criterionId - Criterion ID to update
 * @param {string} newStatus - New status (pending, in_progress, completed)
 * @returns {Object} Updated state and formatted output
 */
function formatTodoWriteUpdate(criterionId, newStatus) {
  const state = loadTodoWriteState();

  if (!state) {
    return { output: '', state: null };
  }

  // Find the criterion by ID or by index
  let criterion = state.criteria.find(c => c.id === criterionId);
  if (!criterion) {
    // Try to find by index (criterion-1, criterion-2, etc.)
    const indexMatch = criterionId.match(/(\d+)$/);
    if (indexMatch) {
      const index = parseInt(indexMatch[1], 10) - 1;
      criterion = state.criteria[index];
    }
  }

  // If criterion not found, log and return early
  if (!criterion) {
    if (process.env.DEBUG) console.error(`[DEBUG] Criterion "${criterionId}" not found in state`);
    return { output: '', state };
  }

  // Update the criterion status
  criterion.status = newStatus;

  // Recalculate stats using helper
  state.stats = recalculateStats(state.criteria);
  state.lastUpdated = new Date().toISOString();

  // Save updated state
  saveTodoWriteState(state);

  // Format output
  const statusIcon = {
    [TODO_STATUS.PENDING]: '○',
    [TODO_STATUS.IN_PROGRESS]: '◐',
    [TODO_STATUS.COMPLETED]: '●'
  };

  let output = `[TodoWrite] ${criterion.content}: ${statusIcon[newStatus]} ${newStatus}`;
  output += ` (${state.stats.completed}/${state.stats.total} completed)`;

  return { output, state };
}

/**
 * Mark a criterion as in-progress by index
 * Note: Only one criterion can be in_progress at a time (resets others to pending)
 * @param {number} index - 0-based index
 */
function markCriterionInProgress(index) {
  const state = loadTodoWriteState();
  if (!state || !state.criteria[index]) return null;

  // Mark previous in_progress items as pending (only one can be in progress)
  // This matches Claude Code TodoWrite behavior
  state.criteria.forEach(c => {
    if (c.status === TODO_STATUS.IN_PROGRESS) {
      c.status = TODO_STATUS.PENDING;
    }
  });

  state.criteria[index].status = TODO_STATUS.IN_PROGRESS;
  state.stats = recalculateStats(state.criteria);
  state.lastUpdated = new Date().toISOString();
  saveTodoWriteState(state);

  return state;
}

/**
 * Mark a criterion as completed by index
 * @param {number} index - 0-based index
 */
function markCriterionCompleted(index) {
  const state = loadTodoWriteState();
  if (!state || !state.criteria[index]) return null;

  state.criteria[index].status = TODO_STATUS.COMPLETED;
  state.stats = recalculateStats(state.criteria);
  state.lastUpdated = new Date().toISOString();
  saveTodoWriteState(state);

  return state;
}

/**
 * Get current TodoWrite stats
 * @returns {Object|null} Stats object or null if no state
 */
function getTodoWriteStats() {
  const state = loadTodoWriteState();
  if (!state) return null;

  return {
    taskId: state.taskId,
    stats: state.stats,
    criteria: state.criteria,
    startedAt: state.startedAt,
    lastUpdated: state.lastUpdated,
    completionPercent: state.stats.total > 0
      ? Math.round((state.stats.completed / state.stats.total) * 100)
      : 0
  };
}

/**
 * Format TodoWrite stats for completion report
 * @returns {string} Formatted stats string
 */
function formatTodoWriteStatsForReport() {
  const stats = getTodoWriteStats();
  if (!stats) return '';

  let output = '\n### Progress Tracking\n\n';
  output += `| Metric | Value |\n`;
  output += `|--------|-------|\n`;
  output += `| Total Criteria | ${stats.stats.total} |\n`;
  output += `| Completed | ${stats.stats.completed} |\n`;
  output += `| In Progress | ${stats.stats.inProgress} |\n`;
  output += `| Pending | ${stats.stats.pending} |\n`;
  output += `| Completion | ${stats.completionPercent}% |\n`;

  if (stats.criteria && stats.criteria.length > 0) {
    output += '\n#### Criteria Status\n\n';
    stats.criteria.forEach((c, i) => {
      const icon = c.status === 'completed' ? '[x]' :
                   c.status === 'in_progress' ? '[~]' : '[ ]';
      output += `${i + 1}. ${icon} ${c.content}\n`;
    });
  }

  return output;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Public API
  TODO_STATUS,
  parseAcceptanceCriteria,
  formatTodoWriteInit,
  formatTodoWriteUpdate,
  markCriterionInProgress,
  markCriterionCompleted,
  getTodoWriteStats,
  formatTodoWriteStatsForReport,
  clearTodoWriteState  // Used by flow-done.js for cleanup
};

// ============================================================================
// CLI (for testing)
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'stats':
      const stats = getTodoWriteStats();
      console.log(JSON.stringify(stats, null, 2));
      break;

    case 'report':
      console.log(formatTodoWriteStatsForReport());
      break;

    case 'clear':
      clearTodoWriteState();
      console.log('TodoWrite state cleared');
      break;

    default:
      console.log('Usage: flow todowrite-sync <command>');
      console.log('Commands: stats, report, clear');
  }
}
