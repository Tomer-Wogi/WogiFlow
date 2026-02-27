#!/usr/bin/env node

/**
 * Wogi Flow - Parallel Execution Module
 *
 * Enables parallel task execution with dependency detection and worktree isolation.
 *
 * Features:
 * - Detects independent tasks that can run in parallel
 * - Manages concurrent execution with configurable limits
 * - Integrates with worktree isolation for safe parallel execution
 * - Provides progress visibility for all running tasks
 *
 * Usage:
 *   const { canRunInParallel, executeParallel, detectDependencies } = require('./flow-parallel');
 *
 *   if (canRunInParallel(tasks)) {
 *     await executeParallel(tasks, { maxConcurrent: 3 });
 *   }
 *
 * Claude Code 2.1.50+ Worktree Isolation:
 *   Agent definitions now support `isolation: "worktree"` as a declarative option.
 *   When set, Claude Code automatically creates an isolated git worktree for the agent,
 *   giving it a separate copy of the repository. This is an alternative to WogiFlow's
 *   existing flow-worktree.js module for parallel execution.
 *
 *   Future adoption: Consider using `isolation: "worktree"` in Task tool calls
 *   for agent-based parallel execution instead of manually managing worktrees.
 *   This would simplify the parallel execution pipeline by delegating worktree
 *   lifecycle management to Claude Code itself.
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig } = require('./flow-utils');

// ============================================================
// Configuration (uses centralized getConfig from flow-utils)
// ============================================================

/**
 * Get parallel execution config
 * Merges defaults with config.json parallel section
 */
function getParallelConfig() {
  const config = getConfig();
  return {
    ...getDefaultConfig(),
    ...(config.parallel || {})
  };
}

function getDefaultConfig() {
  return {
    enabled: true,
    maxConcurrent: 3,
    autoApprove: false,
    requireWorktree: true,
    showProgress: true
  };
}

// ============================================================
// Dependency Detection
// ============================================================

/**
 * Detect dependencies between tasks
 *
 * @param {Array} tasks - Array of task objects with { id, dependencies, files }
 * @returns {Object} Dependency graph { taskId: [dependsOn...] }
 */
function detectDependencies(tasks) {
  const dependencies = {};

  for (const task of tasks) {
    dependencies[task.id] = [];

    // Explicit dependencies from task definition
    if (task.dependencies && Array.isArray(task.dependencies)) {
      dependencies[task.id].push(...task.dependencies);
    }

    // File-based dependency detection
    if (task.files && Array.isArray(task.files)) {
      for (const otherTask of tasks) {
        if (otherTask.id === task.id) continue;

        // Check if this task modifies files that the other task depends on
        if (otherTask.files && Array.isArray(otherTask.files)) {
          const overlap = task.files.some(f => otherTask.files.includes(f));
          if (overlap && !dependencies[task.id].includes(otherTask.id)) {
            // Only add dependency if order matters (task comes after otherTask in list)
            const taskIndex = tasks.findIndex(t => t.id === task.id);
            const otherIndex = tasks.findIndex(t => t.id === otherTask.id);
            if (otherIndex < taskIndex) {
              dependencies[task.id].push(otherTask.id);
            }
          }
        }
      }
    }
  }

  return dependencies;
}

/**
 * Find tasks that can run in parallel (no unmet dependencies)
 *
 * @param {Array} tasks - Array of task objects
 * @param {Set} completed - Set of completed task IDs
 * @param {Object} dependencies - Dependency graph
 * @returns {Array} Tasks that can run now
 */
function findParallelizable(tasks, completed = new Set(), dependencies = null) {
  const deps = dependencies || detectDependencies(tasks);
  const parallelizable = [];

  for (const task of tasks) {
    if (completed.has(task.id)) continue;

    const taskDeps = deps[task.id] || [];
    const unmetDeps = taskDeps.filter(d => !completed.has(d));

    if (unmetDeps.length === 0) {
      parallelizable.push(task);
    }
  }

  return parallelizable;
}

/**
 * Check if tasks can run in parallel
 *
 * @param {Array} tasks - Tasks to check
 * @returns {boolean} True if at least 2 tasks can run in parallel
 */
function canRunInParallel(tasks) {
  if (!tasks || tasks.length < 2) return false;

  const parallelizable = findParallelizable(tasks);
  return parallelizable.length >= 2;
}

// ============================================================
// Progress Tracking
// ============================================================

/**
 * Create a progress tracker for parallel execution
 */
function createProgressTracker(tasks) {
  const state = {
    total: tasks.length,
    completed: 0,
    inProgress: new Set(),
    results: {},
    startTime: Date.now()
  };

  return {
    start(taskId) {
      state.inProgress.add(taskId);
      this.render();
    },

    complete(taskId, result) {
      state.inProgress.delete(taskId);
      state.completed++;
      state.results[taskId] = result;
      this.render();
    },

    fail(taskId, error) {
      state.inProgress.delete(taskId);
      state.results[taskId] = { success: false, error: error.message };
      this.render();
    },

    render() {
      const elapsed = Math.round((Date.now() - state.startTime) / 1000);
      const percent = Math.round((state.completed / state.total) * 100);
      const bar = '█'.repeat(Math.round(percent / 5)) + '░'.repeat(20 - Math.round(percent / 5));

      console.log('\n' + '─'.repeat(60));
      console.log(`⏱  Elapsed: ${elapsed}s | Progress: ${state.completed}/${state.total} (${percent}%)`);
      console.log(`[${bar}]`);

      if (state.inProgress.size > 0) {
        console.log(`🔄 Running: ${[...state.inProgress].join(', ')}`);
      }
      console.log('─'.repeat(60));
    },

    getSummary() {
      const successful = Object.values(state.results).filter(r => r.success).length;
      const failed = Object.values(state.results).filter(r => !r.success).length;
      const elapsed = Math.round((Date.now() - state.startTime) / 1000);

      return {
        total: state.total,
        completed: state.completed,
        successful,
        failed,
        elapsed,
        results: state.results
      };
    }
  };
}

// ============================================================
// Parallel Execution
// ============================================================

/**
 * Execute tasks in parallel with dependency awareness
 *
 * @param {Array} tasks - Tasks to execute
 * @param {Function} executor - Async function(task) to execute each task
 * @param {Object} options - Execution options
 * @returns {Object} Execution results
 */
async function executeParallel(tasks, executor, options = {}) {
  const config = getParallelConfig();
  const {
    maxConcurrent = config.maxConcurrent,
    showProgress = config.showProgress,
    onStart,
    onComplete,
    onError
  } = options;

  const dependencies = detectDependencies(tasks);
  const finished = new Set();   // All tasks that have run (success or failure)
  const succeeded = new Set();  // Only tasks that succeeded
  const tracker = showProgress ? createProgressTracker(tasks) : null;

  // Process tasks in waves (respecting dependencies)
  while (finished.size < tasks.length) {
    // Use 'succeeded' for dependency checking - tasks with failed dependencies won't run
    const parallelizable = findParallelizable(tasks, succeeded, dependencies)
      .filter(t => !finished.has(t.id)); // Don't re-run finished tasks

    if (parallelizable.length === 0) {
      // Check if we're stuck due to failed dependencies or circular deps
      const remaining = tasks.filter(t => !finished.has(t.id));
      if (remaining.length > 0) {
        // Check if remaining tasks have unmet dependencies due to failures
        const blockedByFailure = remaining.filter(t => {
          const taskDeps = dependencies[t.id] || [];
          return taskDeps.some(d => finished.has(d) && !succeeded.has(d));
        });

        if (blockedByFailure.length > 0) {
          // Tasks are blocked because their dependencies failed
          console.warn(`\n⚠️  ${blockedByFailure.length} task(s) skipped due to failed dependencies:`);
          blockedByFailure.forEach(t => {
            const failedDeps = (dependencies[t.id] || []).filter(d => finished.has(d) && !succeeded.has(d));
            console.warn(`   ${t.id} (blocked by: ${failedDeps.join(', ')})`);
            finished.add(t.id); // Mark as finished (skipped)
          });
          continue; // Try next wave
        }

        // No tasks blocked by failure - must be circular dependency
        throw new Error(`Circular dependency detected among: ${remaining.map(t => t.id).join(', ')}`);
      }
      break;
    }

    // Execute up to maxConcurrent tasks at once
    const batch = parallelizable.slice(0, maxConcurrent);
    const promises = batch.map(async (task) => {
      try {
        if (tracker) tracker.start(task.id);
        if (onStart) onStart(task);
      } catch (callbackError) {
        // Don't let callback errors prevent task execution
        console.warn(`Callback error for ${task.id}: ${callbackError.message}`);
      }

      try {
        const result = await executor(task);
        finished.add(task.id);
        succeeded.add(task.id);

        try {
          if (tracker) tracker.complete(task.id, result);
          if (onComplete) onComplete(task, result);
        } catch (callbackError) {
          console.warn(`Completion callback error for ${task.id}: ${callbackError.message}`);
        }

        return { taskId: task.id, success: true, result };
      } catch (err) {
        finished.add(task.id); // Mark as finished but NOT succeeded

        try {
          if (tracker) tracker.fail(task.id, err);
          if (onError) onError(task, err);
        } catch (callbackError) {
          console.warn(`Error callback error for ${task.id}: ${callbackError.message}`);
        }

        return { taskId: task.id, success: false, error: err.message };
      }
    });

    // Use allSettled to prevent one failure from killing all tasks
    const results = await Promise.allSettled(promises);

    // Handle any unexpected rejections (shouldn't happen but safety first)
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`Unexpected rejection in parallel execution: ${result.reason}`);
      }
    }
  }

  return tracker ? tracker.getSummary() : { finished: finished.size, succeeded: succeeded.size };
}

/**
 * Detect parallel execution potential and return standardized info object
 * Centralizes the parallel detection logic used by multiple modules
 *
 * @param {Array} tasks - Array of task objects to check
 * @param {Object} options - Optional settings
 * @param {Object} options.config - Optional config (uses getConfig if not provided)
 * @returns {Object|null} Parallel info object or null if not available
 */
function detectParallelInfo(tasks, options = {}) {
  try {
    const parallelConfig = getParallelConfig();
    if (!parallelConfig.enabled) return null;

    if (!tasks || tasks.length < 2) return null;

    const parallelizable = findParallelizable(tasks);
    if (parallelizable.length < 2) return null;

    // Get worktree config
    const config = options.config || getConfig();

    return {
      available: true,
      count: parallelizable.length,
      taskIds: parallelizable.map(t => t.id || t),
      tasks: parallelizable,
      worktreeEnabled: config.worktree?.enabled || false,
      suggestion: `${parallelizable.length} tasks can run in parallel with worktree isolation`
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[flow-parallel] detectParallelInfo failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Check if user approval is needed for parallel execution
 */
function needsApproval(tasks, config = null) {
  const cfg = config || getParallelConfig();

  if (!cfg.enabled) return { needed: false, reason: 'parallel-disabled' };
  if (cfg.autoApprove) return { needed: false, reason: 'auto-approved' };
  if (tasks.length < 2) return { needed: false, reason: 'single-task' };

  const parallelizable = findParallelizable(tasks);
  if (parallelizable.length < 2) return { needed: false, reason: 'dependencies' };

  return {
    needed: true,
    reason: 'manual-approval-required',
    tasks: parallelizable.map(t => t.id),
    message: `${parallelizable.length} tasks can run in parallel. Approve parallel execution?`
  };
}

// ============================================================
// Exports
// ============================================================

// Alias for backward compatibility - some modules expect loadConfig
function loadConfig() {
  return getParallelConfig();
}

/**
 * Get parallelizability scores for a set of tasks.
 *
 * @param {Array} tasks - Tasks to score
 * @returns {Object} { parallelCount, sequentialCount, summary, scores }
 */
function getParallelizabilityScores(tasks) {
  const parallelizable = findParallelizable(tasks);
  return {
    parallelCount: parallelizable.length,
    sequentialCount: tasks.length - parallelizable.length,
    summary: `${parallelizable.length} of ${tasks.length} tasks can run in parallel`,
    scores: []
  };
}

module.exports = {
  // Configuration
  loadConfig,
  getParallelConfig,
  getDefaultConfig,

  // Dependency detection
  detectDependencies,
  findParallelizable,
  canRunInParallel,
  detectParallelInfo,

  // Scoring
  getParallelizabilityScores,

  // Execution
  executeParallel,
  createProgressTracker,
  needsApproval
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'config': {
      const config = getParallelConfig();
      console.log('\n📊 Parallel Execution Configuration:\n');
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    case 'check': {
      // Load tasks from ready.json and check for parallelizable ones
      const readyPath = path.join(getProjectRoot(), '.workflow', 'state', 'ready.json');
      if (!fs.existsSync(readyPath)) {
        console.log('No ready.json found');
        process.exit(1);
      }

      const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
      const tasks = (ready.ready || []).filter(t => t.status === 'pending' || t.status === 'ready');

      if (tasks.length === 0) {
        console.log('No tasks ready for execution');
        process.exit(0);
      }

      const deps = detectDependencies(tasks);
      const parallelizable = findParallelizable(tasks);

      console.log('\n📋 Task Analysis:\n');
      console.log(`Total tasks: ${tasks.length}`);
      console.log(`Can run in parallel: ${parallelizable.length}`);
      console.log(`\nParallelizable tasks:`);
      parallelizable.forEach(t => console.log(`  - ${t.id}: ${t.title || t.description || 'No description'}`));

      console.log('\nDependency graph:');
      for (const [taskId, taskDeps] of Object.entries(deps)) {
        if (taskDeps.length > 0) {
          console.log(`  ${taskId} depends on: ${taskDeps.join(', ')}`);
        }
      }
      break;
    }

    case 'scores': {
      // Show parallelizability scores for ready tasks
      const scoresReadyPath = path.join(getProjectRoot(), '.workflow', 'state', 'ready.json');
      if (!fs.existsSync(scoresReadyPath)) {
        console.log('No ready.json found');
        process.exit(1);
      }

      const scoresReady = JSON.parse(fs.readFileSync(scoresReadyPath, 'utf-8'));
      const scoreTasks = scoresReady.ready || [];

      if (scoreTasks.length < 2) {
        console.log('\nNeed 2+ ready tasks for scoring');
        process.exit(0);
      }

      const summary = getParallelizabilityScores(scoreTasks);
      console.log('\nParallelizability Scores:\n');
      for (const s of (summary.scores || [])) {
        const bar = '\u2588'.repeat(Math.round(s.score / 10)) + '\u2591'.repeat(10 - Math.round(s.score / 10));
        console.log(`  ${s.taskId}: [${bar}] ${s.score}/100 (${s.label})`);
      }
      console.log(`\nSummary: ${summary.summary}`);
      break;
    }

    default:
      console.log(`
Wogi Flow - Parallel Execution

Usage:
  node flow-parallel.js <command>

Commands:
  config        Show parallel execution configuration
  check         Analyze tasks for parallel execution potential
  scores        Show parallelizability scores for ready tasks

Examples:
  node flow-parallel.js config
  node flow-parallel.js check
  node flow-parallel.js scores
`);
  }
}
