#!/usr/bin/env node

/**
 * Wogi Flow - Task Gate (Core Module)
 *
 * CLI-agnostic task gating logic with auto-task creation.
 * Checks if there's an active task before allowing implementation actions.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('path');

// Import from parent scripts directory
const { getConfig, getReadyData, saveReadyData, generateTaskId, PATHS, safeJsonParse } = require('../../flow-utils');
const { trackTaskStart, trackBypassAttempt } = require('../../flow-session-state');
const { setCurrentTask } = require('../../flow-memory-blocks');

/**
 * Check if task gating should be enforced
 * @returns {boolean}
 */
function isTaskGatingEnabled() {
  const config = getConfig();

  // Check hooks config first
  if (config.hooks?.rules?.taskGating?.enabled === false) {
    return false;
  }

  // Fall back to enforcement config
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
 * @returns {Object|null} Task object or null
 */
function getActiveTask() {
  try {
    const readyData = getReadyData();

    // Check inProgress queue
    if (readyData.inProgress && readyData.inProgress.length > 0) {
      const task = readyData.inProgress[0];
      return typeof task === 'string' ? { id: task } : task;
    }

    // Check durable session (use safeJsonParse to prevent prototype pollution)
    const durableSessionPath = path.join(PATHS.state, 'durable-session.json');
    const session = safeJsonParse(durableSessionPath, null);
    if (session && session.taskId && session.status === 'active') {
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
      autoCreated: true
    };

    // Add to inProgress
    const readyData = getReadyData();
    readyData.inProgress = readyData.inProgress || [];
    readyData.inProgress.unshift(task);

    saveReadyData(readyData);

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
 * @returns {Object} Result: { allowed, blocked, message, task }
 */
function checkTaskGate(options = {}) {
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
    const config = getConfig();
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
  if (!isTaskGatingEnabled()) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'task_gating_disabled'
    };
  }

  // Check for team lead enforcement (Agent Teams integration)
  // If the current session is a team lead, warn or block direct edits
  try {
    const { checkLeadEnforcement } = require('../../flow-agent-teams');
    const leadCheck = checkLeadEnforcement();
    if (leadCheck.enforce) {
      if (leadCheck.mode === 'block') {
        return {
          allowed: false,
          blocked: true,
          warning: false,
          message: leadCheck.message,
          reason: 'team_lead_enforcement'
        };
      }
      // warn mode - allow but inject warning
      // (continues to normal task gate logic below, warning will be in message)
    }
  } catch {
    // flow-agent-teams not available or errored, continue normally
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
  const config = getConfig();
  const shouldBlock = config.hooks?.rules?.taskGating?.blockWithoutTask !== false;

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
  const autoCreateEnabled = config.hooks?.rules?.taskGating?.autoCreateTask === true;

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
