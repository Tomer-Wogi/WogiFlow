#!/usr/bin/env node

/**
 * Wogi Flow - Task Completed (Core Module)
 *
 * CLI-agnostic task completion logic.
 * Called when a sub-agent task finishes (Claude Code 2.1.33+ TaskCompleted event).
 *
 * Handles:
 * - Moving completed tasks from inProgress to recentlyCompleted in ready.json
 * - Logging completion to request-log.md
 * - Updating durable-history.json
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('node:path');
const fs = require('node:fs');

// Import from parent scripts directory
const { getConfig, PATHS, safeJsonParse, writeJson, withLock, validateTaskId, archiveCompletedTasksToLog } = require('../../flow-utils');
const { resetPhase, isPhaseGateEnabled } = require('./phase-gate');

/**
 * Check if task completed handling is enabled
 * @returns {boolean}
 */
function isTaskCompletedEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.taskCompleted?.enabled !== false;
}

/**
 * Handle task completion event
 * @param {Object} input - Parsed hook input
 * @returns {Object} Core result
 */
async function handleTaskCompleted(input) {
  if (!isTaskCompletedEnabled()) {
    return { enabled: false, message: 'Task completed handling is disabled' };
  }

  const result = {
    enabled: true,
    completed: false,
    taskId: null,
    message: null
  };

  try {
    // Read-modify-write ready.json under lock to prevent concurrent corruption
    const readyPath = path.join(PATHS.state, 'ready.json');
    // completedTask is set inside the lock callback and read after — intentional closure sharing
    let completedTask;

    await withLock(readyPath, async () => {
      const ready = safeJsonParse(readyPath, {
        inProgress: [],
        ready: [],
        recentlyCompleted: [],
        blocked: [],
        backlog: []
      });

      // Check if there's a task in progress
      if (!ready.inProgress || ready.inProgress.length === 0) {
        result.message = 'No tasks in progress';
        return;
      }

      // Try to match a specific task from input (supports parallel execution),
      // fall back to inProgress[0] when no identifying info is available
      const rawTaskId = input.taskId || input.toolInput?.taskId;
      const inputTaskId = rawTaskId && validateTaskId(rawTaskId).valid ? rawTaskId : null;
      if (inputTaskId) {
        completedTask = ready.inProgress.find(t => t.id === inputTaskId);
      }
      if (!completedTask) {
        completedTask = ready.inProgress[0];
      }

      // Normalize string entries to objects (prevents .id on string returning undefined)
      if (typeof completedTask === 'string') {
        completedTask = { id: completedTask, title: completedTask, type: 'unknown' };
      }
      if (!completedTask || !completedTask.id) {
        result.message = 'Could not identify completed task (invalid entry in inProgress)';
        return;
      }
      result.taskId = completedTask.id;

      // Move task to recentlyCompleted
      completedTask.status = 'completed';
      completedTask.completedAt = new Date().toISOString();

      // Strip progress prefix from title (e.g., "[3/5] Title" → "Title")
      // Done inside the lock to avoid race conditions with progress tracker
      if (completedTask.title) {
        completedTask.title = completedTask.title.replace(/^\[\d+\/\d+\]\s*/, '');
      }

      // Remove from inProgress
      ready.inProgress = ready.inProgress.filter(t =>
        (typeof t === 'string' ? t : t.id) !== completedTask.id
      );

      // Add to recentlyCompleted (at the beginning)
      if (!ready.recentlyCompleted) {
        ready.recentlyCompleted = [];
      }
      ready.recentlyCompleted.unshift(completedTask);

      // Keep recentlyCompleted trimmed to last 10, archive overflow
      if (ready.recentlyCompleted.length > 10) {
        const overflow = ready.recentlyCompleted.slice(10);
        archiveCompletedTasksToLog(overflow);
        ready.recentlyCompleted = ready.recentlyCompleted.slice(0, 10);
      }

      // Update timestamp
      ready.lastUpdated = new Date().toISOString();

      // Write back (atomic via writeJson)
      try {
        writeJson(readyPath, ready);
        result.completed = true;
        result.message = `Task ${completedTask.id} (${completedTask.title}) moved to completed`;
      } catch (err) {
        result.message = 'Failed to update ready.json';
      }
    });

    // Early return if no task was found (set inside lock callback)
    if (!completedTask || !completedTask.id) {
      return result;
    }

    // Reset workflow phase to idle on task completion
    if (result.completed && isPhaseGateEnabled()) {
      try {
        resetPhase();
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Phase reset failed: ${err.message}`);
        }
      }
    }

    // Clear progress tracker state on task completion
    if (result.completed) {
      try {
        const { clearProgress } = require('../../flow-progress-tracker');
        clearProgress();
      } catch (err) {
        // Non-fatal — progress tracker may not exist in older installs
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Progress clear failed: ${err.message}`);
        }
      }
    }

    // Update durable history if it exists (under lock to prevent concurrent corruption)
    if (result.completed) {
      try {
        const historyPath = path.join(PATHS.state, 'durable-history.json');
        if (fs.existsSync(historyPath)) {
          await withLock(historyPath, async () => {
            const history = safeJsonParse(historyPath, { completions: [] });
            if (!history.completions) {
              history.completions = [];
            }
            history.completions.push({
              taskId: completedTask.id,
              title: completedTask.title,
              completedAt: completedTask.completedAt,
              type: completedTask.type,
              feature: completedTask.feature
            });
            writeJson(historyPath, history);
          });
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] History write failed: ${err.message}`);
        }
      }
    }

    // Record task performance stats (fire-and-forget)
    try {
      const { recordTaskCompletion } = require('../../flow-stats-collector');
      const statsRecord = {
        taskId: completedTask.id,
        model: input.model || process.env.CLAUDE_MODEL || 'unknown',
        taskType: completedTask.type || 'unknown',
        iterations: input.iterations || 1,
        firstAttemptPass: input.firstAttemptPass !== false,
        tokenEstimate: input.tokenEstimate || 0,
        wallClockMs: input.wallClockMs || 0,
        qualityGateResults: input.qualityGateResults || [],
        changedFiles: input.changedFiles || [],
        scenarioCount: input.scenarioCount || 0
      };
      recordTaskCompletion(statsRecord).catch((err) => {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Stats recording failed: ${err.message}`);
        }
      });
    } catch (_err) {
      // Non-critical - stats collector may not be available
    }

    // Clear task checkpoint after completion (fire-and-forget)
    try {
      const { clearCheckpoint } = require('../../flow-task-checkpoint');
      clearCheckpoint(completedTask.id);
    } catch (_err) {
      // Non-critical - checkpoint may not exist
    }

    // Mark all non-rejected observations for this task as committed (fire-and-forget)
    try {
      const memoryDb = require('../../flow-memory-db');
      memoryDb.markTaskObservationsCommitted(completedTask.id).catch(() => {
        // Non-critical - silently ignore DB errors
      });
    } catch (_err) {
      // Non-critical - memory DB may not be available
    }

    // Memory pipeline: remember task completion decisions (fire-and-forget)
    try {
      const memoryDb = require('../../flow-memory-db');
      const decisions = input.decisions || input.summary || completedTask.title || '';
      memoryDb.rememberCompletion(
        completedTask.id,
        completedTask.title || '',
        typeof decisions === 'string' ? decisions : JSON.stringify(decisions)
      ).catch(() => {
        // Non-critical - memory pipeline may not be available
      });
    } catch (_err) {
      // Non-critical - memory DB may not be available
    }

    // Generate completion summary (fire-and-forget)
    if (result.completed) {
      try {
        const { generateCompletionSummary } = require('../../flow-task-completion-summary');
        const summaryResult = generateCompletionSummary(completedTask, input);
        if (process.env.DEBUG && !summaryResult.success) {
          console.error(`[Task Completed] Summary generation: ${summaryResult.reason || 'unknown'}`);
        }
      } catch (_err) {
        // Non-critical - summary generator may not be available
      }
    }

    // Auto-scan all active registries if configured (fire-and-forget)
    try {
      const { RegistryManager } = require('../../flow-registry-manager');
      const manager = new RegistryManager();
      manager.loadPlugins();
      manager.activatePlugins();
      manager.scanAll().catch((err) => {
        if (process.env.DEBUG) {
          console.error(`[Task Completed] Registry scan failed: ${err.message}`);
        }
      });
    } catch (_err) {
      // Non-critical - registry manager may not be available
    }
    // Check pending queue — notify user if items are waiting
    try {
      const { getPendingCount } = require('../../flow-pending');
      const pendingCount = getPendingCount();
      if (pendingCount > 0) {
        result.pendingQueue = {
          count: pendingCount,
          message: `You have ${pendingCount} pending item${pendingCount !== 1 ? 's' : ''} queued. Run /wogi-pending --list to review, or I'll process them next.`
        };
      }
    } catch (_err) {
      // Non-critical — pending module may not be available
    }
  } catch (err) {
    result.message = `Task completed handler error: ${err.message}`;
  }

  return result;
}

module.exports = { handleTaskCompleted, isTaskCompletedEnabled };
