#!/usr/bin/env node

/**
 * Wogi Flow - Task Gate (Core Module)
 *
 * CLI-agnostic task gating logic with auto-task creation.
 * Checks if there's an active task before allowing implementation actions.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const fs = require('fs');
const path = require('path');

// Import from parent scripts directory
const { getConfig, getReadyData, saveReadyData, generateTaskId, validateTaskId, PATHS, safeJsonParse } = require('../../flow-utils');
const { trackTaskStart, trackBypassAttempt } = require('../../flow-session-state');
const { setCurrentTask } = require('../../flow-memory-blocks');

/**
 * Check if task gating should be enforced
 * @param {Object} [config] - Pre-loaded config (optional, falls back to getConfig())
 * @returns {boolean}
 */
function isTaskGatingEnabled(config) {
  if (!config) config = getConfig();

  if (config.enforcement?.taskGating?.enabled === false) {
    return false;
  }

  if (config.enforcement?.strictMode === false) {
    return false;
  }

  if (config.enforcement?.requireTaskForImplementation === false) {
    return false;
  }

  return true;
}

/**
 * Get the currently active task (if any)
 *
 * SECURITY: Validates that the task has a `routedAt` field, which proves it
 * entered inProgress through a legitimate path (moveTaskAsync or createQuickTask).
 * Tasks manually inserted into ready.json won't have this field and are rejected.
 * This closes the bypass where AI edits ready.json directly to create fake tasks.
 *
 * @returns {Object|null} Task object or null
 */
function getActiveTask() {
  try {
    const readyData = getReadyData();

    // Check inProgress queue
    if (readyData.inProgress && readyData.inProgress.length > 0) {
      const task = readyData.inProgress[0];
      if (typeof task === 'string') return { id: task };

      // Validate task ID format before using it in paths (prevents path traversal)
      if (!task.id || typeof task.id !== 'string' || !validateTaskId(task.id).valid) {
        if (process.env.DEBUG) {
          console.error(`[task-gate] Rejecting task — invalid ID format: ${task.id}`);
        }
        return null;
      }

      // Validate routing metadata — reject manually inserted tasks.
      // Tasks without routedAt were not created through the proper routing system
      // (moveTaskAsync or createQuickTask). This prevents the bypass where AI
      // manually edits ready.json to insert a fake task after context compaction.
      //
      // Defense-in-depth: routedAt in the task object can be spoofed if the AI writes
      // it directly. So we also check for a routing receipt file written by moveTaskAsync()
      // (in flow-utils.js) when a task enters inProgress, and by createQuickTask() for
      // auto-created tasks. These are NOT written by clearRoutingPending() — that function
      // manages a separate routing-pending flag.
      if (!task.routedAt) {
        // Check for routing receipt as fallback (covers pre-v1.9.5 tasks and
        // tasks created by flow-start.js before this change was deployed).
        // Also accept tasks with startedAt as legacy (pre-routedAt migration).
        if (task.startedAt) {
          // Legacy task started before routedAt was introduced — allow it
          return task;
        }

        const receiptPath = path.join(PATHS.state, `.routing-receipt-${task.id}`);
        let hasReceipt = false;
        try {
          fs.accessSync(receiptPath);
          hasReceipt = true;
        } catch {
          // No receipt
        }

        if (!hasReceipt) {
          if (process.env.DEBUG) {
            console.error(`[task-gate] Rejecting task ${task.id} — missing routedAt and no routing receipt (manually inserted?)`);
          }
          return null;
        }
      }

      return task;
    }

    // Check durable session (use safeJsonParse to prevent prototype pollution)
    // SECURITY: Apply same receipt/routedAt validation as inProgress tasks
    const durableSessionPath = path.join(PATHS.state, 'durable-session.json');
    const session = safeJsonParse(durableSessionPath, null);
    if (session && session.taskId && session.status === 'active') {
      // Validate task ID format
      if (!validateTaskId(session.taskId).valid) {
        if (process.env.DEBUG) {
          console.error(`[task-gate] Rejecting durable session — invalid taskId: ${session.taskId}`);
        }
        return null;
      }
      // Check for routing receipt
      const receiptPath = path.join(PATHS.state, `.routing-receipt-${session.taskId}`);
      let hasReceipt = false;
      try {
        fs.accessSync(receiptPath);
        hasReceipt = true;
      } catch {
        // No receipt
      }
      if (!hasReceipt && !session.routedAt) {
        if (process.env.DEBUG) {
          console.error(`[task-gate] Rejecting durable session ${session.taskId} — no routing proof`);
        }
        return null;
      }
      return { id: session.taskId, fromDurableSession: true };
    }

    return null;
  } catch (_err) {
    // If we can't read state, assume no active task
    return null;
  }
}

/**
 * Create a quick task for ad-hoc edits when no task is active.
 * This prevents blocking while maintaining task tracking.
 *
 * @param {string} filePath - The file being edited
 * @param {string} operation - 'edit' or 'write'
 * @returns {Object|null} The created task or null on failure
 */
function createQuickTask(filePath, operation) {
  try {
    const fileName = filePath ? path.basename(filePath) : 'unknown';
    const title = `${operation === 'write' ? 'Create' : 'Fix'} ${fileName}`;
    const taskId = generateTaskId(title);

    const task = {
      id: taskId,
      title,
      type: 'bugfix',
      feature: 'general',
      status: 'in_progress',
      priority: 'P2',
      startedAt: new Date().toISOString(),
      autoCreated: true,
      routedAt: new Date().toISOString()
    };

    // Add to inProgress
    // NOTE: Uses unlocked saveReadyData because this function is sync.
    // Race condition risk is low since auto-task creation is opt-in and rare.
    const readyData = getReadyData();
    readyData.inProgress = readyData.inProgress || [];
    readyData.inProgress.unshift(task);

    saveReadyData(readyData);

    // Write routing receipt (anti-bypass defense-in-depth)
    try {
      const receiptPath = path.join(PATHS.state, `.routing-receipt-${taskId}`);
      fs.writeFileSync(receiptPath, JSON.stringify({ taskId, routedAt: task.routedAt, via: 'createQuickTask' }));
    } catch {
      // Non-blocking
    }

    // Sync session state (same as flow-start.js does)
    try {
      trackTaskStart(taskId, title);
      setCurrentTask(taskId, title);
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[task-gate] Failed to sync session state: ${err.message}`);
      }
    }

    return task;
  } catch (err) {
    // If creation fails, return null - checkTaskGate will fall back to blocking
    if (process.env.DEBUG) {
      console.error(`[task-gate] Failed to create quick task: ${err.message}`);
    }
    return null;
  }
}

/**
 * Check task gating for an edit/write operation
 *
 * @param {Object} options
 * @param {string} options.filePath - Path being edited/written
 * @param {string} options.operation - 'edit' or 'write'
 * @param {Object} [config] - Pre-loaded config (optional, falls back to getConfig())
 * @returns {Object} Result: { allowed, blocked, message, task }
 */
function checkTaskGate(options = {}, config) {
  if (!config) config = getConfig();
  const { filePath, operation = 'edit' } = options;
  // Exempt workflow state files from task gating
  if (filePath && filePath.includes('.workflow/state/')) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'workflow_state_exempt'
    };
  }

  // Exempt workflow changes (story/spec files) - required for story creation
  // Without this, you cannot create stories, which creates a bootstrapping problem
  if (filePath && filePath.includes('.workflow/changes/')) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'workflow_changes_exempt'
    };
  }

  // Also exempt plan files (configurable directory + hardcoded fallback for backward compat)
  // Use path.resolve + startsWith for path traversal safety
  if (filePath) {
    const plansDir = config.planning?.plansDirectory || '.workflow/plans';
    const resolvedPath = path.resolve(filePath);
    const resolvedPlansDir = path.resolve(plansDir);
    const resolvedClaudePlansDir = path.resolve('.claude/plans');

    // Safely check if path is within plans directories (prevents path traversal)
    if (resolvedPath.startsWith(resolvedPlansDir + path.sep) ||
        resolvedPath.startsWith(resolvedClaudePlansDir + path.sep) ||
        resolvedPath === resolvedPlansDir ||
        resolvedPath === resolvedClaudePlansDir) {
      return {
        allowed: true,
        blocked: false,
        message: null,
        reason: 'plan_file_exempt'
      };
    }

    // Also handle user-level Claude plans (absolute path like ~/.claude/plans/)
    // This is needed for Claude Code's plan mode which stores plans in user home
    if (resolvedPath.includes('/.claude/plans/')) {
      return {
        allowed: true,
        blocked: false,
        message: null,
        reason: 'user_plan_file_exempt'
      };
    }
  }


  // Check if gating is enabled
  if (!isTaskGatingEnabled(config)) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'task_gating_disabled'
    };
  }

  // Check for active task
  const activeTask = getActiveTask();

  if (activeTask) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      task: activeTask,
      reason: 'task_active'
    };
  }

  // No active task - should we block?
  const shouldBlock = config.enforcement?.taskGating?.blockWithoutTask !== false;

  if (!shouldBlock) {
    return {
      allowed: true,
      blocked: false,
      message: generateWarningMessage(operation, filePath),
      reason: 'warn_only'
    };
  }

  // Check if auto-task creation is enabled
  // Default to false (blocking) when strictMode is enabled
  const autoCreateEnabled = config.enforcement?.taskGating?.autoCreateTask === true;

  if (!autoCreateEnabled) {
    // Track the bypass attempt
    trackBypassAttempt({
      filePath,
      operation,
      reason: 'no_task_auto_create_disabled',
      taskId: null
    });

    // Block the edit - require /wogi-start to be used
    return {
      allowed: false,
      blocked: true,
      message: generateBlockMessage(operation, filePath),
      reason: 'no_active_task'
    };
  }

  // Auto-create a quick task (only when autoCreateTask is explicitly true)
  const autoTask = createQuickTask(filePath, operation);

  if (autoTask) {
    // Track the bypass (auto-created task is still a bypass)
    trackBypassAttempt({
      filePath,
      operation,
      reason: 'task_auto_created',
      taskId: autoTask.id
    });

    // Check if blockAutoTask is enabled (additional enforcement layer)
    // This allows edits to proceed but will trigger warnings elsewhere
    const blockAutoTask = config.enforcement?.blockAutoTask === true;

    if (blockAutoTask) {
      // Still create the task for tracking, but block the edit
      return {
        allowed: false,
        blocked: true,
        message: `Auto-task created for tracking (${autoTask.id}), but edits are blocked.\n\nTo proceed:\n1. Use /wogi-start ${autoTask.id} to start this task properly\n2. Or use /wogi-start to route your request through the workflow`,
        task: autoTask,
        reason: 'auto_task_blocked'
      };
    }

    return {
      allowed: true,
      blocked: false,
      message: `Auto-created task: ${autoTask.id} - ${autoTask.title}`,
      task: autoTask,
      reason: 'task_auto_created'
    };
  }

  // Track the bypass attempt (auto-create failed)
  trackBypassAttempt({
    filePath,
    operation,
    reason: 'auto_create_failed',
    taskId: null
  });

  // Fall back to blocking if auto-create failed
  return {
    allowed: false,
    blocked: true,
    message: generateBlockMessage(operation, filePath),
    reason: 'no_active_task'
  };
}

/**
 * Generate warning message (when not blocking)
 */
function generateWarningMessage(operation, filePath) {
  const fileName = filePath ? path.basename(filePath) : 'file';
  return `Warning: ${operation === 'write' ? 'Creating' : 'Editing'} ${fileName} without an active task. Consider starting a task first.`;
}

/**
 * Generate block message
 */
function generateBlockMessage(operation, filePath) {
  const fileName = filePath ? path.basename(filePath) : 'file';
  return `Cannot ${operation} ${fileName} without an active task.

To proceed:
1. Check available tasks: /wogi-ready
2. Start an existing task: /wogi-start wf-XXXXXXXX
3. Or create a new task: /wogi-story "description"

Task gating is enforced when strictMode is enabled.`;
}

module.exports = {
  isTaskGatingEnabled,
  getActiveTask,
  checkTaskGate,
  createQuickTask,
  generateBlockMessage,
  generateWarningMessage
};
