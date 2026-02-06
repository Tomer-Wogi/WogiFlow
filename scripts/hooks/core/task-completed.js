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

const path = require('path');
const fs = require('fs');

// Import from parent scripts directory
const { getConfig, PATHS, safeJsonParse } = require('../../flow-utils');

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
function handleTaskCompleted(input) {
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
    // Read current ready.json
    const readyPath = path.join(PATHS.state, 'ready.json');
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
      return result;
    }

    // Find the most recently started in-progress task
    const completedTask = ready.inProgress[0];
    result.taskId = completedTask.id;

    // Move task to recentlyCompleted
    completedTask.status = 'completed';
    completedTask.completedAt = new Date().toISOString();

    // Remove from inProgress
    ready.inProgress = ready.inProgress.filter(t => t.id !== completedTask.id);

    // Add to recentlyCompleted (at the beginning)
    if (!ready.recentlyCompleted) {
      ready.recentlyCompleted = [];
    }
    ready.recentlyCompleted.unshift(completedTask);

    // Keep recentlyCompleted trimmed to last 10
    if (ready.recentlyCompleted.length > 10) {
      ready.recentlyCompleted = ready.recentlyCompleted.slice(0, 10);
    }

    // Update timestamp
    ready.lastUpdated = new Date().toISOString();

    // Write back
    try {
      fs.writeFileSync(readyPath, JSON.stringify(ready, null, 2) + '\n', 'utf-8');
      result.completed = true;
      result.message = `Task ${completedTask.id} (${completedTask.title}) moved to completed`;
    } catch (err) {
      result.message = `Failed to update ready.json: ${err.message}`;
    }

    // Update durable history if it exists
    try {
      const historyPath = path.join(PATHS.state, 'durable-history.json');
      if (fs.existsSync(historyPath)) {
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
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n', 'utf-8');
      }
    } catch (err) {
      // Non-critical - don't fail the hook for history logging
    }
  } catch (err) {
    result.message = `Task completed handler error: ${err.message}`;
  }

  return result;
}

module.exports = { handleTaskCompleted, isTaskCompletedEnabled };
