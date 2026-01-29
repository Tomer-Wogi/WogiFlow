#!/usr/bin/env node

/**
 * Wogi Flow - Bulk Orchestrator Module
 *
 * Implements the orchestrator pattern for /wogi-bulk where each task
 * executes in a fresh sub-agent context, preventing context pollution.
 *
 * Inspired by Matt Maher's "do-work" pattern.
 *
 * Key features:
 * - Main context orchestrates, sub-agents execute
 * - Independent tasks run in parallel (with worktree isolation)
 * - Dependent tasks receive pass-forward summaries
 * - Configurable failure handling (stop-all, stop-dependent, continue)
 *
 * Usage:
 *   const { orchestrateBulk } = require('./flow-bulk-orchestrator');
 *   await orchestrateBulk(['wf-001', 'wf-002', 'wf-003'], options);
 */

const { getConfig, getReadyData } = require('./flow-utils');
const { detectDependencies } = require('./flow-parallel');

// ============================================================
// Configuration
// ============================================================

/**
 * Get bulk orchestrator configuration
 * @returns {Object} Orchestrator config with defaults
 */
function getOrchestratorConfig() {
  const config = getConfig();
  const defaults = {
    enabled: true,
    parallelLimit: 3,
    useWorktrees: true,
    onFailure: 'stop-dependent', // 'stop-all', 'stop-dependent', 'retry-then-skip', 'continue'
    summaryDepth: 'standard', // 'minimal', 'standard', 'detailed'
    continuous: {
      enabled: false,
      idleAction: 'stop', // 'stop' or 'wait'
      idleTimeout: 60, // seconds to wait before rechecking
      maxIdleChecks: 3 // max times to check before stopping
    }
  };

  const orchestratorConfig = config.bulkOrchestrator || {};
  return {
    ...defaults,
    ...orchestratorConfig,
    continuous: {
      ...defaults.continuous,
      ...(orchestratorConfig.continuous || {})
    }
  };
}

/**
 * Check if orchestrator mode is enabled
 * @returns {boolean}
 */
function isOrchestratorEnabled() {
  const config = getOrchestratorConfig();
  return config.enabled !== false;
}

// ============================================================
// Completion Summary Generation
// ============================================================

/**
 * Generate a completion summary for a task
 * Used for pass-forward to dependent tasks
 *
 * @param {string} taskId - Task ID
 * @param {Object} result - Task execution result
 * @param {string} depth - Summary depth: 'minimal', 'standard', 'detailed'
 * @returns {Object} Completion summary
 */
function generateCompletionSummary(taskId, result, depth = 'standard') {
  const summary = {
    taskId,
    status: result.success ? 'completed' : 'failed',
    timestamp: new Date().toISOString()
  };

  if (depth === 'minimal') {
    return summary;
  }

  // Standard depth
  summary.filesModified = result.filesModified || [];
  summary.keyChanges = result.keyChanges || result.summary || '';

  if (depth === 'detailed') {
    summary.newExports = result.newExports || [];
    summary.decisions = result.decisions || [];
    summary.warnings = result.warnings || [];
    summary.testResults = result.testResults || null;
  }

  return summary;
}

/**
 * Format completion summaries for sub-agent context
 * @param {Array} summaries - Array of completion summaries
 * @returns {string} Formatted context string
 */
function formatSummariesForContext(summaries) {
  if (!summaries || summaries.length === 0) {
    return '';
  }

  const lines = ['## Context from Completed Dependencies\n'];

  for (const summary of summaries) {
    lines.push(`### Task ${summary.taskId} (${summary.status})`);

    if (summary.filesModified && summary.filesModified.length > 0) {
      lines.push(`**Files modified:** ${summary.filesModified.join(', ')}`);
    }

    if (summary.keyChanges) {
      lines.push(`**Key changes:** ${summary.keyChanges}`);
    }

    if (summary.newExports && summary.newExports.length > 0) {
      lines.push(`**New exports available:** ${summary.newExports.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Batch Building
// ============================================================

/**
 * Build execution batches from tasks respecting dependencies
 * Returns groups of tasks that can run in parallel
 *
 * @param {Array} tasks - Array of task objects
 * @param {Object} dependencies - Dependency graph from detectDependencies()
 * @returns {Array} Array of batches, each batch contains parallelizable tasks
 */
function buildExecutionBatches(tasks, dependencies) {
  const batches = [];
  const completed = new Set();
  const remaining = new Set(tasks.map(t => t.id));

  while (remaining.size > 0) {
    // Find tasks that can run now (all dependencies completed)
    const parallelizable = [];

    for (const taskId of remaining) {
      const task = tasks.find(t => t.id === taskId);
      const taskDeps = dependencies[taskId] || [];
      const unmetDeps = taskDeps.filter(d => !completed.has(d));

      if (unmetDeps.length === 0) {
        parallelizable.push(task);
      }
    }

    if (parallelizable.length === 0 && remaining.size > 0) {
      // Circular dependency or missing tasks
      const remainingIds = Array.from(remaining);
      console.error(`[orchestrator] Warning: Cannot resolve remaining tasks: ${remainingIds.join(', ')}`);
      break;
    }

    batches.push(parallelizable);

    // Mark these as "will be completed" for next iteration
    for (const task of parallelizable) {
      remaining.delete(task.id);
      completed.add(task.id);
    }
  }

  return batches;
}

// ============================================================
// Sub-Agent Execution
// ============================================================

/**
 * Build the prompt for sub-agent task execution
 *
 * @param {Object} task - Task object
 * @param {Array} dependencySummaries - Summaries from completed dependencies
 * @returns {string} Prompt for sub-agent
 */
function buildSubAgentPrompt(task, dependencySummaries = []) {
  const contextPrefix = formatSummariesForContext(dependencySummaries);

  return `${contextPrefix}

Execute task: ${task.id} - ${task.title}

Use /wogi-start ${task.id} to begin this task.
Follow all workflow rules and quality gates.
When complete, provide a summary of:
- Files modified
- Key changes made
- Any new exports or APIs added
- Decisions made during implementation
`;
}

/**
 * Parse sub-agent result into completion summary
 * @param {string} taskId - Task ID
 * @param {string} agentOutput - Raw output from sub-agent
 * @returns {Object} Parsed result
 */
function parseSubAgentResult(taskId, agentOutput) {
  const result = {
    success: true,
    filesModified: [],
    keyChanges: '',
    newExports: [],
    decisions: []
  };

  // Look for common patterns in output
  const filesMatch = agentOutput.match(/Files?\s*(modified|changed|created):\s*([^\n]+)/i);
  if (filesMatch) {
    result.filesModified = filesMatch[2].split(',').map(f => f.trim());
  }

  const changesMatch = agentOutput.match(/Key\s*changes?:\s*([^\n]+)/i);
  if (changesMatch) {
    result.keyChanges = changesMatch[1].trim();
  }

  const exportsMatch = agentOutput.match(/New\s*exports?:\s*([^\n]+)/i);
  if (exportsMatch) {
    result.newExports = exportsMatch[1].split(',').map(e => e.trim());
  }

  // Check for failure indicators
  if (/failed|error|blocked/i.test(agentOutput)) {
    result.success = false;
  }

  return result;
}

// ============================================================
// Failure Handling
// ============================================================

/**
 * Handle task failure based on config
 * @param {string} failedTaskId - ID of failed task
 * @param {Array} remainingTasks - Tasks not yet executed
 * @param {Object} dependencies - Dependency graph
 * @param {string} onFailure - Failure handling mode
 * @returns {Object} { continue: boolean, skip: string[], reason: string }
 */
function handleTaskFailure(failedTaskId, remainingTasks, dependencies, onFailure) {
  switch (onFailure) {
    case 'stop-all':
      return {
        continue: false,
        skip: remainingTasks.map(t => t.id),
        reason: `Task ${failedTaskId} failed, stopping all remaining tasks`
      };

    case 'stop-dependent': {
      // Find all tasks that depend on the failed task (directly or transitively)
      const dependentTasks = new Set();

      const findDependents = (taskId) => {
        for (const task of remainingTasks) {
          const taskDeps = dependencies[task.id] || [];
          if (taskDeps.includes(taskId) && !dependentTasks.has(task.id)) {
            dependentTasks.add(task.id);
            findDependents(task.id); // Recursive for transitive deps
          }
        }
      };

      findDependents(failedTaskId);

      return {
        continue: true,
        skip: Array.from(dependentTasks),
        reason: dependentTasks.size > 0
          ? `Task ${failedTaskId} failed, skipping dependent tasks: ${Array.from(dependentTasks).join(', ')}`
          : `Task ${failedTaskId} failed, no dependent tasks to skip`
      };
    }

    case 'continue':
      return {
        continue: true,
        skip: [],
        reason: `Task ${failedTaskId} failed, continuing with remaining tasks`
      };

    case 'retry-then-skip':
      return {
        continue: true,
        skip: [],
        retry: true,
        reason: `Task ${failedTaskId} failed, will retry once`
      };

    default:
      return {
        continue: true,
        skip: [],
        reason: 'Unknown failure mode, continuing'
      };
  }
}

// ============================================================
// Main Orchestrator
// ============================================================

/**
 * Orchestrate bulk task execution
 *
 * @param {Array} taskIds - Array of task IDs to execute
 * @param {Object} options - Orchestration options
 * @param {boolean} options.dryRun - If true, only show plan without executing
 * @param {Function} options.onTaskStart - Callback when task starts
 * @param {Function} options.onTaskComplete - Callback when task completes
 * @param {Function} options.onBatchComplete - Callback when batch completes
 * @returns {Object} Orchestration result
 */
async function orchestrateBulk(taskIds, options = {}) {
  const config = getOrchestratorConfig();

  if (!config.enabled) {
    return {
      success: false,
      error: 'Orchestrator is disabled. Set bulkOrchestrator.enabled: true in config.',
      fallback: true
    };
  }

  // Load tasks from ready.json
  const readyData = getReadyData();
  const allTasks = [...(readyData.ready || []), ...(readyData.inProgress || [])];

  // Find requested tasks
  const tasks = taskIds.map(id => {
    const task = allTasks.find(t => t.id === id);
    if (!task) {
      console.warn(`[orchestrator] Task not found: ${id}`);
      return { id, title: 'Unknown', notFound: true };
    }
    return task;
  }).filter(t => !t.notFound);

  if (tasks.length === 0) {
    return {
      success: false,
      error: 'No valid tasks found',
      requestedIds: taskIds
    };
  }

  // Detect dependencies
  const dependencies = detectDependencies(tasks);

  // Build execution batches
  const batches = buildExecutionBatches(tasks, dependencies);

  console.log(`\n[orchestrator] Execution plan:`);
  console.log(`  Total tasks: ${tasks.length}`);
  console.log(`  Batches: ${batches.length}`);
  batches.forEach((batch, i) => {
    const ids = batch.map(t => t.id).join(', ');
    console.log(`  Batch ${i + 1}: ${ids} (${batch.length} task${batch.length > 1 ? 's in parallel' : ''})`);
  });

  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      batches: batches.map(b => b.map(t => t.id)),
      dependencies,
      config
    };
  }

  // Return execution plan for the agent to execute
  // The actual sub-agent spawning is done by the calling agent using Task tool
  const executionPlan = {
    success: true,
    batches: batches.map((batch, index) => ({
      index,
      parallel: batch.length > 1,
      tasks: batch.map(task => {
        const taskDeps = dependencies[task.id] || [];
        return {
          id: task.id,
          title: task.title,
          dependencies: taskDeps,
          prompt: buildSubAgentPrompt(task, []) // Summaries added at execution time
        };
      })
    })),
    dependencies,
    config,
    completionSummaries: {} // To be filled as tasks complete
  };

  return executionPlan;
}

// ============================================================
// Continuous Work Loop
// ============================================================

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get ready tasks from ready.json
 * @returns {Array} Array of task objects in ready status
 */
function getReadyTasks() {
  const readyData = getReadyData();
  return readyData.ready || [];
}

/**
 * Check if continuous mode is enabled
 * @returns {boolean}
 */
function isContinuousEnabled() {
  const config = getOrchestratorConfig();
  return config.continuous && config.continuous.enabled === true;
}

/**
 * Continuous work loop that keeps checking for new tasks
 *
 * This implements Matt Maher's "do-work" pattern where the orchestrator
 * doesn't stop when the initial queue is empty - it keeps checking
 * for new work that may have been captured during execution.
 *
 * @param {Object} options - Continuous loop options
 * @param {number} options.idleTimeout - Seconds to wait when idle
 * @param {string} options.idleAction - 'stop' or 'wait' when idle
 * @param {number} options.maxIdleChecks - Max idle checks before stopping
 * @param {Function} options.onBatchComplete - Callback when a batch completes
 * @param {Function} options.onIdleCheck - Callback when checking for new work
 * @param {boolean} options.dryRun - If true, only show plans
 * @returns {Object} Final result with all completed tasks
 */
async function continuousWorkLoop(options = {}) {
  const config = getOrchestratorConfig();
  const continuousConfig = config.continuous;

  const idleAction = options.idleAction || continuousConfig.idleAction || 'stop';
  const idleTimeout = options.idleTimeout || continuousConfig.idleTimeout || 60;
  const maxIdleChecks = options.maxIdleChecks || continuousConfig.maxIdleChecks || 3;

  let idleChecks = 0;
  const totalCompleted = [];
  const totalSkipped = [];
  let shouldStop = false;

  // Handle graceful shutdown
  const handleShutdown = () => {
    console.log('\n[continuous] Received shutdown signal. Completing current work...');
    shouldStop = true;
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  try {
    console.log('\n[continuous] Starting continuous work loop');
    console.log(`  Idle action: ${idleAction}`);
    console.log(`  Idle timeout: ${idleTimeout}s`);
    console.log(`  Max idle checks: ${maxIdleChecks}`);

    while (!shouldStop) {
      // Get ready tasks
      const tasks = getReadyTasks();

      if (tasks.length === 0) {
        idleChecks++;

        if (idleAction === 'stop') {
          console.log('\n[continuous] Queue empty. Stopping.');
          break;
        }

        if (idleChecks >= maxIdleChecks) {
          console.log(`\n[continuous] No new work after ${maxIdleChecks} checks. Stopping.`);
          break;
        }

        console.log(`\n[continuous] Queue empty. Waiting ${idleTimeout}s for new work... (check ${idleChecks}/${maxIdleChecks})`);

        if (options.onIdleCheck) {
          options.onIdleCheck({ idleChecks, maxIdleChecks, idleTimeout });
        }

        await sleep(idleTimeout * 1000);
        continue;
      }

      // Reset idle counter when work is found
      idleChecks = 0;

      // Process tasks with orchestrator
      const taskIds = tasks.map(t => t.id);
      console.log(`\n[continuous] Found ${tasks.length} ready task(s): ${taskIds.join(', ')}`);

      const result = await orchestrateBulk(taskIds, {
        dryRun: options.dryRun
      });

      if (result.success) {
        // Track completed tasks (in real execution, this would be updated by callbacks)
        if (options.onBatchComplete) {
          options.onBatchComplete(result);
        }

        // For dry run, just track what would be done
        if (options.dryRun) {
          const allTasks = result.batches.flatMap(b => b.tasks.map(t => t.id));
          totalCompleted.push(...allTasks);
        }
      }

      // Small delay between cycles to prevent tight loops
      await sleep(1000);
    }

    console.log('\n[continuous] Work loop complete');
    console.log(`  Total tasks processed: ${totalCompleted.length}`);

    return {
      success: true,
      continuous: true,
      completed: totalCompleted,
      skipped: totalSkipped,
      idleChecks,
      stoppedBy: shouldStop ? 'signal' : 'idle'
    };
  } finally {
    // Cleanup signal listeners even if error occurs
    process.removeListener('SIGINT', handleShutdown);
    process.removeListener('SIGTERM', handleShutdown);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  getOrchestratorConfig,
  isOrchestratorEnabled,
  isContinuousEnabled,

  // Summary generation
  generateCompletionSummary,
  formatSummariesForContext,
  parseSubAgentResult,

  // Batch building
  buildExecutionBatches,
  buildSubAgentPrompt,

  // Failure handling
  handleTaskFailure,

  // Main orchestrator
  orchestrateBulk,

  // Continuous work loop
  continuousWorkLoop,
  getReadyTasks
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'config': {
      const config = getOrchestratorConfig();
      console.log('\n📊 Bulk Orchestrator Configuration:\n');
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    case 'plan': {
      const taskIds = args.slice(1);
      if (taskIds.length === 0) {
        console.log('Usage: flow-bulk-orchestrator plan <task-id> [task-id...]');
        process.exit(1);
      }

      orchestrateBulk(taskIds, { dryRun: true })
        .then(result => {
          if (result.success) {
            console.log('\n✓ Execution plan generated (dry run)');
          } else {
            console.error('\n✗ Planning failed:', result.error);
            process.exit(1);
          }
        })
        .catch(err => {
          console.error('Error:', err.message);
          process.exit(1);
        });
      break;
    }

    case 'continuous': {
      // Parse flags
      let idleTimeout;
      if (args.includes('--idle-timeout')) {
        const rawValue = args[args.indexOf('--idle-timeout') + 1];
        const parsed = parseInt(rawValue, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
          console.error('Error: --idle-timeout must be a positive integer');
          process.exit(1);
        }
        idleTimeout = parsed;
      }
      const dryRun = args.includes('--dry-run');

      continuousWorkLoop({
        idleTimeout,
        dryRun,
        onIdleCheck: ({ idleChecks, maxIdleChecks }) => {
          console.log(`  [idle check ${idleChecks}/${maxIdleChecks}]`);
        }
      })
        .then(result => {
          console.log('\n✓ Continuous loop completed');
          console.log(JSON.stringify(result, null, 2));
        })
        .catch(err => {
          console.error('\n✗ Continuous loop failed:', err.message);
          process.exit(1);
        });
      break;
    }

    case 'check': {
      const tasks = getReadyTasks();
      console.log(`\n📋 Ready tasks: ${tasks.length}`);
      for (const task of tasks) {
        console.log(`  • ${task.id} - ${task.title}`);
      }
      if (tasks.length === 0) {
        console.log('  (no tasks ready)');
      }
      break;
    }

    default:
      console.log(`
Wogi Flow - Bulk Orchestrator

Executes multiple tasks with sub-agent isolation and dependency awareness.

Usage:
  node flow-bulk-orchestrator.js <command> [args]

Commands:
  config                Show orchestrator configuration
  plan <ids...>         Show execution plan without running (dry run)
  continuous            Start continuous work loop
  check                 Check for ready tasks

Continuous options:
  --idle-timeout <s>    Override idle timeout (seconds)
  --dry-run             Show what would be done without executing

Examples:
  node flow-bulk-orchestrator.js config
  node flow-bulk-orchestrator.js plan wf-001 wf-002 wf-003
  node flow-bulk-orchestrator.js continuous
  node flow-bulk-orchestrator.js continuous --idle-timeout 30 --dry-run
`);
  }
}
