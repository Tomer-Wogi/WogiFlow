#!/usr/bin/env node

/**
 * Wogi Flow - State Cleanup Module
 *
 * v2.6.1: Centralized cleanup functions for stale workflow state.
 * Used by flow-morning.js and flow-session-end.js.
 *
 * Cleans up:
 * - session-state.json currentTask (if task not in inProgress)
 * - task-queue.json (if status is 'active' but tasks are done)
 * - durable-session.json (if task is completed)
 * - loop-session.json (legacy file)
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  getReadyData,
  saveReadyData,
  safeJsonParse
} = require('./flow-utils');

/**
 * Debug logging helper - only logs if DEBUG env var is set
 * @param {string} message - Message to log
 */
function debugLog(message) {
  if (process.env.DEBUG) {
    console.error(`[DEBUG] ${message}`);
  }
}

/**
 * Safe file write with error handling
 * @param {string} filePath - Path to write to
 * @param {object} data - Data to write as JSON
 * @returns {boolean} - True if successful
 */
function safeWriteJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    debugLog(`Could not write ${path.basename(filePath)}: ${err.message}`);
    return false;
  }
}

/**
 * Safe file deletion with error handling
 * @param {string} filePath - Path to delete
 * @returns {boolean} - True if successful or file doesn't exist
 */
function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    debugLog(`Could not delete ${path.basename(filePath)}: ${err.message}`);
    return false;
  }
}

/**
 * Extract task ID from a task object or string
 * @param {object|string} task - Task object or ID string
 * @returns {string|null} - Task ID or null
 */
function extractTaskId(task) {
  if (typeof task === 'object' && task !== null) {
    return task.id || null;
  }
  return typeof task === 'string' ? task : null;
}

/**
 * Get all task IDs from ready data (both ready and inProgress)
 * @param {object} readyData - Ready data object
 * @returns {string[]} - Array of task IDs
 */
function getAllTaskIds(readyData) {
  const readyIds = (readyData.ready || []).map(extractTaskId).filter(Boolean);
  const inProgressIds = (readyData.inProgress || []).map(extractTaskId).filter(Boolean);
  return [...readyIds, ...inProgressIds];
}

/**
 * Get inProgress task IDs from ready data
 * @param {object} readyData - Ready data object
 * @returns {string[]} - Array of task IDs
 */
function getInProgressIds(readyData) {
  return (readyData.inProgress || []).map(extractTaskId).filter(Boolean);
}

/**
 * Clean up session-state.json currentTask if task is no longer in progress
 * @param {object} readyData - Cached ready data
 * @returns {string|null} - Cleaned file name or null
 */
function cleanupSessionState(readyData) {
  const sessionStatePath = path.join(PATHS.state, 'session-state.json');
  const sessionState = safeJsonParse(sessionStatePath, null);

  if (!sessionState || !sessionState.currentTask) {
    return null;
  }

  const currentTaskId = extractTaskId(sessionState.currentTask);
  const inProgressIds = getInProgressIds(readyData);

  if (currentTaskId && !inProgressIds.includes(currentTaskId)) {
    sessionState.currentTask = null;
    if (safeWriteJson(sessionStatePath, sessionState)) {
      return 'session-state.json';
    }
  }

  return null;
}

/**
 * Clean up task-queue.json if all queued tasks are completed
 * @param {object} readyData - Cached ready data
 * @returns {string|null} - Cleaned file name or null
 */
function cleanupTaskQueue(readyData) {
  const taskQueuePath = path.join(PATHS.state, 'task-queue.json');
  const taskQueue = safeJsonParse(taskQueuePath, null);

  if (!taskQueue || taskQueue.status !== 'active') {
    return null;
  }

  const allTaskIds = getAllTaskIds(readyData);
  const queuedTasks = taskQueue.tasks || [];
  const stillActive = queuedTasks.some(id => allTaskIds.includes(id));

  if (!stillActive) {
    const clearedQueue = {
      tasks: [],
      currentIndex: 0,
      status: 'idle',
      startedAt: null,
      completedTasks: taskQueue.completedTasks || []
    };
    if (safeWriteJson(taskQueuePath, clearedQueue)) {
      return 'task-queue.json';
    }
  }

  return null;
}

/**
 * Clean up durable-session.json if task is no longer in progress
 * @param {object} readyData - Cached ready data
 * @returns {string|null} - Cleaned file name or null
 */
function cleanupDurableSession(readyData) {
  const durableSessionPath = path.join(PATHS.state, 'durable-session.json');
  const durableSession = safeJsonParse(durableSessionPath, null);

  if (!durableSession || !durableSession.taskId) {
    return null;
  }

  const inProgressIds = getInProgressIds(readyData);

  if (!inProgressIds.includes(durableSession.taskId)) {
    if (safeUnlink(durableSessionPath)) {
      return 'durable-session.json';
    }
  }

  return null;
}

/**
 * Clean up legacy loop-session.json file
 * @returns {string|null} - Cleaned file name or null
 */
function cleanupLegacyLoopSession() {
  const loopSessionPath = path.join(PATHS.state, 'loop-session.json');

  if (!fs.existsSync(loopSessionPath)) {
    return null;
  }

  if (safeUnlink(loopSessionPath)) {
    return 'loop-session.json';
  }

  return null;
}

/**
 * Clean up stale auto-created tasks older than specified age
 * @param {object} readyData - Ready data (will be modified)
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 24 hours)
 * @returns {string|null} - Description of cleaned tasks or null
 */
function cleanupStaleTasks(readyData, maxAgeMs = 24 * 60 * 60 * 1000) {
  const inProgress = readyData.inProgress || [];
  const now = Date.now();

  const staleTasks = inProgress.filter(task => {
    if (typeof task !== 'object') return false;
    if (!task.autoCreated) return false;

    const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : 0;
    const age = now - startedAt;

    return age > maxAgeMs;
  });

  if (staleTasks.length === 0) {
    return null;
  }

  // Move stale tasks to recentlyCompleted
  readyData.recentlyCompleted = readyData.recentlyCompleted || [];

  for (const task of staleTasks) {
    // Remove from inProgress
    const index = readyData.inProgress.findIndex(t =>
      typeof t === 'object' && t.id === task.id
    );
    if (index !== -1) {
      readyData.inProgress.splice(index, 1);
    }

    // Add to recentlyCompleted
    readyData.recentlyCompleted.unshift({
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString(),
      autoCompleted: true,
      completedBy: 'state-cleanup'
    });
  }

  // Trim recentlyCompleted to last 10
  readyData.recentlyCompleted = readyData.recentlyCompleted.slice(0, 10);

  saveReadyData(readyData);
  return `${staleTasks.length} stale task(s)`;
}

/**
 * Clean up all stale workflow state
 *
 * @param {object} options - Cleanup options
 * @param {boolean} options.cleanupStaleTasks - Also clean up stale auto-created tasks (default: false)
 * @param {number} options.staleTaskAgeMs - Max age for stale tasks in ms (default: 24 hours)
 * @returns {string[]} - List of cleaned state files/items
 */
function cleanupStaleState(options = {}) {
  const {
    cleanupStaleTasks: shouldCleanupStaleTasks = false,
    staleTaskAgeMs = 24 * 60 * 60 * 1000
  } = options;

  const cleaned = [];

  try {
    // Cache ready data once for all operations
    const readyData = getReadyData();

    // 1. Clean up session-state.json currentTask
    const sessionResult = cleanupSessionState(readyData);
    if (sessionResult) cleaned.push(sessionResult);

    // 2. Clean up task-queue.json
    const queueResult = cleanupTaskQueue(readyData);
    if (queueResult) cleaned.push(queueResult);

    // 3. Clean up durable-session.json
    const durableResult = cleanupDurableSession(readyData);
    if (durableResult) cleaned.push(durableResult);

    // 4. Clean up legacy loop-session.json
    const legacyResult = cleanupLegacyLoopSession();
    if (legacyResult) cleaned.push(legacyResult);

    // 5. Optionally clean up stale auto-created tasks
    if (shouldCleanupStaleTasks) {
      const staleResult = cleanupStaleTasks(readyData, staleTaskAgeMs);
      if (staleResult) cleaned.push(staleResult);
    }

  } catch (err) {
    debugLog(`State cleanup error: ${err.message}`);
  }

  return cleaned;
}

module.exports = {
  cleanupStaleState,
  cleanupSessionState,
  cleanupTaskQueue,
  cleanupDurableSession,
  cleanupLegacyLoopSession,
  cleanupStaleTasks,
  extractTaskId,
  getAllTaskIds,
  getInProgressIds
};
