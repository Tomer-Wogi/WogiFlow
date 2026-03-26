#!/usr/bin/env node

/**
 * Wogi Flow - Task Created (Core Module)
 *
 * CLI-agnostic task creation tracking logic.
 * Called when a native task is created via TaskCreate (Claude Code 2.1.84+).
 *
 * Handles:
 * - Linking native Claude Code tasks to the active WogiFlow task
 * - Tracking subtask creation for progress visibility
 * - Logging task creation events to session state
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const path = require('node:path');
const { getConfig, PATHS, safeJsonParse } = require('../../flow-utils');

/**
 * Check if task created handling is enabled
 * @returns {boolean}
 */
function isTaskCreatedEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.taskCreated?.enabled !== false;
}

/**
 * Handle task creation event
 * @param {Object} input - Parsed hook input from Claude Code
 * @returns {Object} Core result
 */
async function handleTaskCreated(input) {
  if (!isTaskCreatedEnabled()) {
    return { enabled: false, message: null };
  }

  const result = {
    enabled: true,
    linked: false,
    wogiTaskId: null,
    message: null
  };

  try {
    // Find the active WogiFlow task to link against
    const readyPath = path.join(PATHS.state, 'ready.json');
    const ready = safeJsonParse(readyPath, { inProgress: [] });

    if (Array.isArray(ready.inProgress) && ready.inProgress.length > 0) {
      const activeTask = ready.inProgress[0];
      const wogiTaskId = typeof activeTask === 'string' ? activeTask : activeTask?.id;

      if (wogiTaskId) {
        result.linked = true;
        result.wogiTaskId = wogiTaskId;
      }
    }

    // Track creation in session state (fire-and-forget)
    try {
      const sessionStatePath = path.join(PATHS.state, 'session-state.json');
      const sessionState = safeJsonParse(sessionStatePath, {});
      if (!sessionState.nativeTasksCreated) {
        sessionState.nativeTasksCreated = 0;
      }
      sessionState.nativeTasksCreated += 1;
      sessionState.lastNativeTaskAt = new Date().toISOString();

      const fs = require('node:fs');
      fs.writeFileSync(sessionStatePath, JSON.stringify(sessionState, null, 2));
    } catch (_err) {
      // Non-critical — session state tracking is best-effort
    }
  } catch (err) {
    result.message = `Task created handler error: ${err.message}`;
  }

  return result;
}

module.exports = { handleTaskCreated, isTaskCreatedEnabled };
