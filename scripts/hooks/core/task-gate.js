#!/usr/bin/env node

/**
 * Wogi Flow - Task Gate (Core Module)
 *
 * CLI-agnostic task gating logic.
 * Checks if there's an active task before allowing implementation actions.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('path');

// Import from parent scripts directory
const { getConfig, getReadyData, saveReadyData, generateTaskId, PATHS } = require('../../flow-utils');

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

    // Check durable session
    const fs = require('fs');
    const durableSessionPath = path.join(PATHS.state, 'durable-session.json');
    if (fs.existsSync(durableSessionPath)) {
      const session = JSON.parse(fs.readFileSync(durableSessionPath, 'utf-8'));
      if (session.taskId && session.status === 'active') {
        return { id: session.taskId, fromDurableSession: true };
      }
    }

    return null;
  } catch (err) {
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

  // Also exempt plan files
  if (filePath && filePath.includes('.claude/plans/')) {
    return {
      allowed: true,
      blocked: false,
      message: null,
      reason: 'plan_file_exempt'
    };
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

  // Auto-create a quick task instead of blocking
  const autoTask = createQuickTask(filePath, operation);

  if (autoTask) {
    return {
      allowed: true,
      blocked: false,
      message: `Auto-created task: ${autoTask.id} - ${autoTask.title}`,
      task: autoTask,
      reason: 'task_auto_created'
    };
  }

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
