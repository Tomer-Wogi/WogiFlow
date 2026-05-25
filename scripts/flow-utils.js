#!/usr/bin/env node

/**
 * Wogi Flow - Shared Utilities
 *
 * Common functions used across all flow scripts.
 * Eliminates Python dependency and provides consistent path handling.
 *
 * Re-export facade for five focused modules, plus home for task management,
 * ready.json operations, classification, request log, git utilities, and AST grep.
 *
 * Focused modules (prefer importing directly for new code):
 * - flow-paths.js: Path constants and utilities
 * - flow-io.js: File I/O, locking, JSON handling
 * - flow-config-loader.js: Config reading, caching, validation
 * - flow-tokens.js: Token estimation
 * - flow-output.js: Colors, terminal output, CLI help
 *
 * This file re-exports all functions from the above for backwards compatibility.
 */

const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// Import from focused modules
// ============================================================

const flowPaths = require('./flow-paths');
const flowIO = require('./flow-io');
const flowConfigLoader = require('./flow-config-loader');
const flowTokens = require('./flow-tokens');
const flowOutput = require('./flow-output');

// Destructure imports still used inside this file (ready.json ops only).
// After wf-94cc3b72 decomposition, most helpers moved to focused modules.
const { PATHS, STATE_DIR } = flowPaths;
const { readJson, writeJson, dirExists } = flowIO;
const { warn } = flowOutput;

// ============================================================
// Constants - Named values for magic numbers
// ============================================================

/** Default timeout for shell commands (2 minutes) */
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;

/** Quick command timeout (30 seconds) */
const QUICK_COMMAND_TIMEOUT_MS = 30000;

/** Maximum history entries to keep in durable sessions */
const MAX_SESSION_HISTORY = 50;

/** Default max iterations for workflow loops */
const MAX_WORKFLOW_ITERATIONS = 100;

// ============================================================
// CLI Session ID Detection
// ============================================================

/**
 * Get the current AI CLI session ID.
 * Currently supports Claude Code only.
 *
 * @returns {string|null} Session ID or null
 */
function getSessionId() {
  return process.env.CLAUDE_SESSION_ID
      || process.env.AI_SESSION_ID        // Generic fallback
      || null;
}

// Task list to status mapping (extracted to avoid DRY violation)
const LIST_TO_STATUS_MAP = {
  'ready': 'ready',
  'inProgress': 'in_progress',
  'blocked': 'blocked',
  'recentlyCompleted': 'completed'
};

// Standard limits for task/context operations (extracted magic numbers)
const TASK_LIMITS = {
  MAX_READY_TASK_IDS: 10,           // Max task IDs to show in session context
  MAX_READY_TASK_IDS_MEMORY: 20,    // Max task IDs to capture in memory blocks
  MAX_RECENTLY_COMPLETED: 10,       // Max completed tasks before archiving
  MAX_KEY_FACTS: 10,                // Max key facts in memory blocks
  MAX_MODIFIED_FILES: 20,           // Max modified files to track
  MAX_DECISIONS: 10,                // Max decisions to show
  MAX_RECENT_ACTIVITY: 3            // Max recent activity entries
};

/**
 * Sync task status and timestamps when moving between lists
 * @param {object} task - The task object to update
 * @param {string} toList - The target list name
 */
function syncTaskStatusOnMove(task, toList) {
  if (typeof task !== 'object' || !task) return;

  task.status = LIST_TO_STATUS_MAP[toList] || task.status;

  // Add timestamps for tracking
  if (toList === 'inProgress' && !task.startedAt) {
    task.startedAt = new Date().toISOString();
  } else if (toList === 'recentlyCompleted') {
    task.completedAt = new Date().toISOString();
  }
}

// ============================================================
// Registry Discovery (extracted to flow-registries.js)
// ============================================================

const {
  getActiveRegistries,
  getRegistryPaths,
  getRegistryMapFiles,
} = require('./flow-registries');

// ============================================================
// Task ID Generation (extracted to flow-id.js)
// ============================================================

const {
  generateHashId,
  generateTaskId,
  generateEpicId,
  generateFeatureId,
  generatePlanId,
  validateTaskId,
  isLegacyTaskId,
  isValidWogiId,
} = require('./flow-id');

// ============================================================
// CLI Flag Parsing (extracted to flow-cli-flags.js)
// ============================================================

const { parseFlags } = require('./flow-cli-flags');

// ============================================================
// Ready.json Operations
// ============================================================

/**
 * Validate ready.json structure
 * @param {Object} data - Data to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateReadyJson(data) {
  const errors = [];

  // Check required top-level arrays
  const requiredArrays = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];
  for (const key of requiredArrays) {
    if (!Array.isArray(data[key])) {
      errors.push(`Missing or invalid "${key}" array`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate tasks in each array
  const allArrays = [...requiredArrays];
  for (const arrayName of allArrays) {
    const tasks = data[arrayName] || [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const prefix = `${arrayName}[${i}]`;

      // Required fields
      if (!task.id || typeof task.id !== 'string') {
        errors.push(`${prefix}: missing or invalid "id"`);
      }

      // Optional but validated fields
      if (task.title !== undefined && typeof task.title !== 'string') {
        errors.push(`${prefix}: "title" must be a string`);
      }
      if (task.status !== undefined && typeof task.status !== 'string') {
        errors.push(`${prefix}: "status" must be a string`);
      }
      if (task.priority !== undefined && !/^P[0-4]$/.test(task.priority)) {
        errors.push(`${prefix}: "priority" must be P0-P4`);
      }
      if (task.dependencies !== undefined && !Array.isArray(task.dependencies)) {
        errors.push(`${prefix}: "dependencies" must be an array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Ready data cache (avoids repeated file reads within same process)
// 200ms TTL covers a single hook invocation (<100ms) but expires between user actions (seconds apart)
let _readyDataCache = null;
let _readyDataCacheTime = 0;
const READY_DATA_CACHE_TTL = 200;

/**
 * Read ready.json task queue with optional validation
 * @param {boolean} [validate=false] - Whether to validate structure
 * @returns {Object} Task queue data with ready, inProgress, blocked, recentlyCompleted arrays
 * @throws {Error} If validate is true and structure is invalid
 */
function getReadyData(validate = false) {
  // Fast path: skip file read if cache is fresh (within TTL)
  if (_readyDataCache && !validate && (Date.now() - _readyDataCacheTime) < READY_DATA_CACHE_TTL) {
    return _readyDataCache;
  }

  const data = readJson(PATHS.ready, {
    ready: [],
    inProgress: [],
    blocked: [],
    recentlyCompleted: []
  });

  if (validate) {
    const validation = validateReadyJson(data);
    if (!validation.valid) {
      throw new Error(`Invalid ready.json: ${validation.errors.join(', ')}`);
    }
  }

  _readyDataCache = data;
  _readyDataCacheTime = Date.now();

  return data;
}

/**
 * Invalidate the ready data cache (call after writes)
 */
function invalidateReadyDataCache() {
  _readyDataCache = null;
  _readyDataCacheTime = 0;
}

/**
 * Check if a task ID matches any valid WogiFlow ID format.
 * Valid formats:
 *   - wf-[8 hex]           Standard task (e.g., wf-a1b2c3d4)
 *   - wf-[8 hex]-NN        Sub-task (e.g., wf-a1b2c3d4-01)
 *   - wf-cr-[6 hex]        Review fix task (e.g., wf-cr-a1e8f7)
 *   - wf-rv-[8 hex]        Review finding task (e.g., wf-rv-a1b2c3d4)
 *   - ep-[8 hex]           Epic (e.g., ep-a1b2c3d4)
 *   - ft-[8 hex]           Feature (e.g., ft-a1b2c3d4)
 *   - pl-[8 hex]           Plan (e.g., pl-a1b2c3d4)
 *   - TASK-NNN / BUG-NNN   Legacy format
 *
 * @param {string} id - ID to check
 * @returns {boolean}
 */
// isValidWogiId — extracted to flow-id.js (audit Story 12 partial — pattern
// validator). Re-exported below for backwards compat with 302 importers.

/**
 * Validate all task IDs in a ready.json data object before writing.
 * Checks ALL arrays: ready, inProgress, blocked, backlog, recentlyCompleted.
 * Only validates NEW entries -- historical descriptive IDs are grandfathered.
 *
 * @param {Object} data - ready.json data to validate
 * @param {Object} [previousData] - Previous ready.json data to detect new entries
 * @throws {Error} If any new task ID fails validation
 */
function validateReadyDataIds(data, previousData) {
  // Collect all existing IDs from previous data to skip historical entries
  const existingIds = new Set();
  if (previousData) {
    for (const list of ['ready', 'inProgress', 'recentlyCompleted', 'blocked']) {
      for (const task of (previousData[list] || [])) {
        if (task && task.id) existingIds.add(task.id);
      }
    }
    for (const task of (previousData.backlog || [])) {
      if (task && task.id) existingIds.add(task.id);
    }
  }

  const violations = [];
  // Validate ALL arrays, not just ready/inProgress
  const allLists = ['ready', 'inProgress', 'blocked'];
  for (const list of allLists) {
    for (const task of (data[list] || [])) {
      if (!task || !task.id) continue;
      // Skip IDs that already existed (historical)
      if (existingIds.has(task.id)) continue;
      if (!isValidWogiId(task.id)) {
        violations.push(`${list}: "${task.id}" (title: "${task.title || 'unknown'}")`);
      }
    }
  }
  // Also validate backlog (separate because it's not an array of the same shape sometimes)
  for (const task of (data.backlog || [])) {
    if (!task || !task.id) continue;
    if (existingIds.has(task.id)) continue;
    if (!isValidWogiId(task.id)) {
      violations.push(`backlog: "${task.id}" (title: "${task.title || 'unknown'}")`);
    }
  }

  if (violations.length > 0) {
    const msg = `Task ID validation failed \u2014 manually constructed IDs are not allowed.\n` +
      `Use generateTaskId() from flow-utils.js to create IDs.\n` +
      `Valid formats: wf-[8 hex], wf-[8 hex]-NN, wf-cr-[6 hex], wf-rv-[8 hex]\n` +
      `Example: wf-a1b2c3d4 (NOT wf-health-001, wf-my-task, etc.)\n\n` +
      `Violations:\n${violations.map(v => `  - ${v}`).join('\n')}`;
    console.error(`[TASK-ID-VIOLATION] ${msg}`);
    // In strict mode, throw to prevent write. In non-strict, warn only.
    if (process.env.WOGIFLOW_STRICT_IDS !== '0') {
      throw new Error(msg);
    }
  }
}

/**
 * Write ready.json task queue
 * Note: Does not mutate the input data object
 * Validates task IDs before writing to prevent descriptive IDs.
 *
 * WARNING: For concurrent access, use saveReadyDataAsync which uses file locking.
 */
function saveReadyData(data) {
  // Load previous data to detect new entries vs historical ones
  let previousData = null;
  try {
    previousData = readJson(PATHS.ready, null);
  } catch (_err) {
    // If we can't read previous data, validate all entries
  }
  validateReadyDataIds(data, previousData);
  const toSave = { ...data, lastUpdated: new Date().toISOString() };
  const result = writeJson(PATHS.ready, toSave);
  invalidateReadyDataCache(); // Invalidate AFTER write completes to avoid stale cache race
  maybeArmTaskBoundaryRestart(previousData, toSave);
  return result;
}

/**
 * Write ready.json with file locking (async version)
 * Use this when multiple processes might be writing to ready.json
 * Validates task IDs before writing to prevent descriptive IDs.
 *
 * SECURITY: Prevents race conditions that could corrupt ready.json
 */
async function saveReadyDataAsync(data) {
  const { withLock } = flowIO;
  return withLock(PATHS.ready, () => {
    let previousData = null;
    try {
      previousData = readJson(PATHS.ready, null);
    } catch (_err) {
      // If we can't read previous data, validate all entries
    }
    validateReadyDataIds(data, previousData);
    const toSave = { ...data, lastUpdated: new Date().toISOString() };
    const result = writeJson(PATHS.ready, toSave);
    invalidateReadyDataCache(); // Invalidate AFTER write completes
    maybeArmTaskBoundaryRestart(previousData, toSave);
    return result;
  });
}

/**
 * wf-ee4e343b — Phase 1 chokepoint for task-boundary auto-restart.
 *
 * Why this exists: Phase 1 marker writes were previously split across three
 * disjoint paths (`flow done`, `task-completed.js` hook, Stop-hook fallback
 * with a 5-min freshness window). The Stop-hook fallback misses real-world
 * timing (user takes >5min to type next message → fallback rejects) and the
 * other two paths are not always called. By detecting "new entry in
 * recentlyCompleted" right here in saveReadyData — the actual chokepoint
 * every completion goes through — we arm the marker at the moment of
 * completion regardless of who completed the task.
 *
 * Gated on WOGI_WRAPPER_PID so test/CLI/non-wrapper invocations don't
 * write spurious markers. Lazy-required to avoid circular dependency
 * (task-boundary-reset.js → flow-utils.js).
 */
function maybeArmTaskBoundaryRestart(previousData, savedData) {
  try {
    if (!process.env.WOGI_WRAPPER_PID) return;
    // First-save guard (F2): when ready.json doesn't yet exist, previousData
    // is null. If savedData arrives pre-populated (fresh install seeded from
    // backup, init script bootstrapping recentlyCompleted, etc.) we MUST NOT
    // arm a restart marker — there's no completion event, just an initial
    // state snapshot. Real completions always have a previousData to diff
    // against because saveReadyData is the only writer.
    if (!previousData) return;
    // F7 fix (wf-ee4e343b cleanup): F2 was asymmetric — readJson returns {}
    // (truthy) on corrupt JSON or missing top-level keys, so the !previousData
    // guard would not catch that case. A corrupt ready.json that recovers as
    // {} followed by a save with populated recentlyCompleted would still
    // false-positive. Require previousData.recentlyCompleted to be an actual
    // array for the diff to be meaningful — anything else is "we don't know
    // the prior state," which is structurally identical to first-save and
    // must NOT arm.
    if (!Array.isArray(previousData.recentlyCompleted)) return;
    const prevTop = previousData.recentlyCompleted[0];
    const curTop = savedData?.recentlyCompleted?.[0];
    if (!curTop || !curTop.id) return;
    if (prevTop && prevTop.id === curTop.id) return; // no new completion
    const { markRestartPending } = require('./hooks/core/task-boundary-reset');
    markRestartPending({
      taskId: curTop.id,
      taskTitle: curTop.title,
      source: 'saveReadyData'
    });
  } catch (_err) {
    // Fail-open — never let an observability/marker write break ready.json save
  }
}

/**
 * Archive overflow completed tasks to a log file (v3.2)
 * When recentlyCompleted exceeds 10 items, archive the overflow
 * instead of losing them.
 *
 * @param {Array} tasks - Array of tasks to archive
 */
function archiveCompletedTasksToLog(tasks) {
  if (!tasks || tasks.length === 0) return;

  try {
    const archiveLogPath = path.join(PATHS.state, 'completed-archive.json');
    let archive = [];

    try {
      const loaded = readJson(archiveLogPath, []);
      if (Array.isArray(loaded)) archive = loaded;
    } catch (_err) {
      archive = [];
    }

    const timestamp = new Date().toISOString();
    for (const task of tasks) {
      const taskId = typeof task === 'string' ? task : task.id;
      const entry = {
        id: taskId,
        title: typeof task === 'object' ? task.title : null,
        archivedAt: timestamp
      };
      archive.push(entry);
    }

    // Keep archive manageable (max 1000 entries)
    if (archive.length > 1000) {
      archive = archive.slice(-1000);
    }

    writeJson(archiveLogPath, archive);

    if (process.env.DEBUG) {
      console.log(`[DEBUG] Archived ${tasks.length} completed task(s) to completed-archive.json`);
    }
  } catch (err) {
    // Silent failure - don't break task movement
    if (process.env.DEBUG) {
      console.error(`[DEBUG] archiveCompletedTasksToLog: ${err.message}`);
    }
  }
}

/**
 * Find a task in ready.json by ID
 * Returns { task, list, index } or null
 */
function findTask(taskId) {
  const data = getReadyData();
  const lists = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];

  for (const listName of lists) {
    const list = data[listName] || [];
    for (let i = 0; i < list.length; i++) {
      const task = list[i];
      const id = typeof task === 'string' ? task : task.id;
      if (id === taskId) {
        return { task, list: listName, index: i, data };
      }
    }
  }

  return null;
}

/**
 * Move a task from one list to another
 *
 * WARNING: For concurrent access, use moveTaskAsync which uses file locking.
 */
function moveTask(taskId, fromList, toList) {
  const data = getReadyData();
  const from = data[fromList] || [];
  const to = data[toList] || [];

  let taskIndex = -1;
  let task = null;

  for (let i = 0; i < from.length; i++) {
    const t = from[i];
    const id = typeof t === 'string' ? t : t.id;
    if (id === taskId) {
      taskIndex = i;
      task = t;
      break;
    }
  }

  if (taskIndex === -1) {
    return { success: false, error: `Task ${taskId} not found in ${fromList}` };
  }

  from.splice(taskIndex, 1);

  // Use shared helper to sync status and timestamps (DRY fix)
  syncTaskStatusOnMove(task, toList);

  // Stamp routing metadata when moving to inProgress (matches moveTaskAsync behavior)
  if (toList === 'inProgress' && typeof task === 'object') {
    task.routedAt = new Date().toISOString();
    try {
      const receiptPath = path.join(PATHS.state, `.routing-receipt-${taskId}`);
      writeJson(receiptPath, { taskId, routedAt: task.routedAt, via: 'moveTask' });
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[flow-utils] Failed to write routing receipt (sync): ${err.message}`);
      }
    }
  }

  if (toList === 'recentlyCompleted') {
    to.unshift(task);
    // v3.2: Archive overflow instead of truncating
    if (to.length > 10) {
      const overflow = to.splice(10);
      archiveCompletedTasksToLog(overflow);
    }
    data[toList] = to;
  } else {
    to.push(task);
    data[toList] = to;
  }

  data[fromList] = from;
  saveReadyData(data);

  return { success: true, task };
}

/**
 * Move a task with file locking (async version)
 * Atomically reads, modifies, and writes ready.json
 *
 * SECURITY: Prevents race conditions when multiple processes move tasks
 */
async function moveTaskAsync(taskId, fromList, toList) {
  const { withLock } = flowIO;
  return withLock(PATHS.ready, () => {
    const data = getReadyData();
    const from = data[fromList] || [];
    const to = data[toList] || [];

    let taskIndex = -1;
    let task = null;

    for (let i = 0; i < from.length; i++) {
      const t = from[i];
      const id = typeof t === 'string' ? t : t.id;
      if (id === taskId) {
        taskIndex = i;
        task = t;
        break;
      }
    }

    if (taskIndex === -1) {
      return { success: false, error: `Task ${taskId} not found in ${fromList}` };
    }

    from.splice(taskIndex, 1);

    // Sync status field when moving between lists
    // Use shared helper to sync status and timestamps (DRY fix)
    syncTaskStatusOnMove(task, toList);

    // Stamp routing metadata when moving to inProgress (anti-bypass measure).
    // Only tasks moved through moveTaskAsync get this field — manually inserted
    // tasks in ready.json won't have it, so getActiveTask() will reject them.
    if (toList === 'inProgress') {
      task.routedAt = new Date().toISOString();
      // Write routing receipt file — a second validation layer that the AI
      // can't easily spoof because it would need to coordinate the exact task ID.
      // The receipt is checked by getActiveTask() as defense-in-depth.
      try {
        const receiptPath = path.join(PATHS.state, `.routing-receipt-${taskId}`);
        writeJson(receiptPath, { taskId, routedAt: task.routedAt, via: 'moveTaskAsync' });
      } catch (err) {
        // Non-blocking — routedAt field is the primary check
        if (process.env.DEBUG) {
          console.error(`[flow-utils] Failed to write routing receipt: ${err.message}`);
        }
      }
    }

    if (toList === 'recentlyCompleted') {
      to.unshift(task);
      // v3.2: Archive overflow instead of truncating
      if (to.length > 10) {
        const overflow = to.splice(10);
        archiveCompletedTasksToLog(overflow);
      }
      data[toList] = to;

      // Clean up routing receipt when task completes
      try {
        const receiptPath = path.join(PATHS.state, `.routing-receipt-${taskId}`);
        fs.unlinkSync(receiptPath);
      } catch (_err) {
        // ENOENT is fine — receipt may not exist for pre-v1.9.5 tasks
      }
    } else {
      to.push(task);
      data[toList] = to;
    }

    data[fromList] = from;
    const toSave = { ...data, lastUpdated: new Date().toISOString() };
    writeJson(PATHS.ready, toSave);

    return { success: true, task };
  });
}

/**
 * Cancel a task with knowledge preservation
 *
 * Moves task to recentlyCompleted with cancellation metadata instead of deleting.
 * This preserves the task history for future reference and learning.
 *
 * @param {string} taskId - Task ID to cancel
 * @param {string} reason - Cancellation reason: 'superseded', 'duplicate', 'requirements_changed', 'user_cancelled'
 * @param {boolean} workDone - Whether any work was done on this task
 * @returns {Promise<{success: boolean, task?: object, error?: string}>}
 */
async function cancelTask(taskId, reason, workDone = false) {
  const { withLock } = flowIO;
  return withLock(PATHS.ready, () => {
    const data = getReadyData();
    const lists = ['ready', 'inProgress', 'blocked', 'backlog'];

    let task = null;
    let fromList = null;

    // Find the task in any active list
    for (const listName of lists) {
      const list = data[listName] || [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const id = typeof t === 'string' ? t : t.id;
        if (id === taskId) {
          task = t;
          fromList = listName;
          list.splice(i, 1);
          break;
        }
      }
      if (task) break;
    }

    if (!task) {
      return { success: false, error: `Task ${taskId} not found in active lists` };
    }

    // Ensure task is an object (not just an ID string)
    if (typeof task === 'string') {
      warn(`Task ${taskId} was stored as string, not object. Converting with minimal data.`);
      task = { id: task, title: `Task ${task}`, _convertedFromString: true };
    }

    // Add cancellation metadata
    task.status = 'cancelled';
    task.cancelledAt = new Date().toISOString();
    task.cancelledFrom = fromList;  // Track which list it was in
    task.cancellationReason = reason;
    task.workDone = workDone;

    // Move to recentlyCompleted for preservation
    const completed = data.recentlyCompleted || [];
    completed.unshift(task);

    // Archive overflow (same as moveTaskAsync)
    if (completed.length > 10) {
      const overflow = completed.splice(10);
      archiveCompletedTasksToLog(overflow);
    }

    data.recentlyCompleted = completed;
    const toSave = { ...data, lastUpdated: new Date().toISOString() };
    writeJson(PATHS.ready, toSave);

    return { success: true, task };
  });
}

/**
 * Get task counts
 */
function getTaskCounts() {
  const data = getReadyData();
  return {
    ready: (data.ready || []).length,
    inProgress: (data.inProgress || []).length,
    blocked: (data.blocked || []).length,
    recentlyCompleted: (data.recentlyCompleted || []).length
  };
}

// ============================================================
// Request Log Operations (extracted to flow-request-log.js)
// ============================================================

const {
  countRequestLogEntries,
  getLastRequestLogEntry,
  getHighestRequestId,
  getNextRequestId,
  addRequestLogEntry,
} = require('./flow-request-log');

// ============================================================
// App Map + CLI Tool + Git (extracted to flow-sys.js)
// ============================================================

const {
  meetsVersion,
  getFdCommand,
  isGitRepo,
  getGitStatus,
  countAppMapComponents,
  addAppMapComponent,
} = require('./flow-sys');

// ============================================================
// Permission Validation (extracted to flow-permissions-audit.js)
// ============================================================

const { analyzePermissions, validatePermissions } = require('./flow-permissions-audit');

// ============================================================
// AST-Grep Integration (extracted to flow-ast-grep.js)
// ============================================================

const flowAstGrep = require('./flow-ast-grep');
const {
  AST_PATTERNS,
  isAstGrepAvailable,
  astGrepSearch,
  findReactComponents,
  findCustomHooks,
  findTypeDefinitions,
} = flowAstGrep;

// ============================================================
// Hierarchical Task Utilities (extracted to flow-task-hierarchy.js)
// ============================================================

const {
  normalizeTask,
  findAllWithParent,
  findTaskInAllLists,
} = require('./flow-task-hierarchy');

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Explicit re-exports from flow-paths.js
  getProjectRoot: flowPaths.getProjectRoot,
  getCanonicalStateDir: flowPaths.getCanonicalStateDir,
  isLinkedWorktree: flowPaths.isLinkedWorktree,
  PROJECT_ROOT: flowPaths.PROJECT_ROOT,
  PACKAGE_ROOT: flowPaths.PACKAGE_ROOT,
  PACKAGE_PATHS: flowPaths.PACKAGE_PATHS,
  WORKFLOW_DIR: flowPaths.WORKFLOW_DIR,
  STATE_DIR: flowPaths.STATE_DIR,
  CLAUDE_DIR: flowPaths.CLAUDE_DIR,
  PATHS: flowPaths.PATHS,
  isPathWithinProject: flowPaths.isPathWithinProject,
  SPEC_FILE_MAP: flowPaths.SPEC_FILE_MAP,
  getSpecFilePath: flowPaths.getSpecFilePath,
  checkSpecMigration: flowPaths.checkSpecMigration,

  // Explicit re-exports from flow-io.js
  LOCK_STALE_THRESHOLD_MS: flowIO.LOCK_STALE_THRESHOLD_MS,
  CLEANUP_LOCK_STALE_MS: flowIO.CLEANUP_LOCK_STALE_MS,
  LOCK_RETRY_DELAY_MS: flowIO.LOCK_RETRY_DELAY_MS,
  LOCK_MAX_RETRIES: flowIO.LOCK_MAX_RETRIES,
  DANGEROUS_KEYS: flowIO.DANGEROUS_KEYS,
  fileExists: flowIO.fileExists,
  dirExists: flowIO.dirExists,
  ensureDir: flowIO.ensureDir,
  checkForDangerousKeys: flowIO.checkForDangerousKeys,
  readJson: flowIO.readJson,
  writeJson: flowIO.writeJson,
  safeJsonParse: flowIO.safeJsonParse,
  safeJsonParseString: flowIO.safeJsonParseString,
  readFile: flowIO.readFile,
  writeFile: flowIO.writeFile,
  validateJson: flowIO.validateJson,
  listDirs: flowIO.listDirs,
  listFiles: flowIO.listFiles,
  countFiles: flowIO.countFiles,
  outputJson: flowIO.outputJson,
  acquireLock: flowIO.acquireLock,
  withLock: flowIO.withLock,
  withLockSync: flowIO.withLockSync,
  cleanupStaleLocks: flowIO.cleanupStaleLocks,

  // Explicit re-exports from flow-config-loader.js
  getConfig: flowConfigLoader.getConfig,
  getRawConfig: flowConfigLoader.getRawConfig,
  getConfigValue: flowConfigLoader.getConfigValue,
  setConfigValue: flowConfigLoader.setConfigValue,
  setConfigValueSync: flowConfigLoader.setConfigValueSync,
  resolveConfigValue: flowConfigLoader.resolveConfigValue,
  invalidateConfigCache: flowConfigLoader.invalidateConfigCache,
  validateConfig: flowConfigLoader.validateConfig,
  applyConfigCompatShim: flowConfigLoader.applyConfigCompatShim,
  KNOWN_CONFIG_KEYS: flowConfigLoader.KNOWN_CONFIG_KEYS,

  // Explicit re-exports from flow-tokens.js
  TOKEN_ESTIMATION: flowTokens.TOKEN_ESTIMATION,
  estimateTokens: flowTokens.estimateTokens,
  detectCodeContentRatio: flowTokens.detectCodeContentRatio,
  isCodeContent: flowTokens.isCodeContent,
  estimateComplexity: flowTokens.estimateComplexity,

  // Explicit re-exports from flow-output.js
  colors: flowOutput.colors,
  color: flowOutput.color,
  print: flowOutput.print,
  printHeader: flowOutput.printHeader,
  printSection: flowOutput.printSection,
  success: flowOutput.success,
  warn: flowOutput.warn,
  error: flowOutput.error,
  info: flowOutput.info,
  showHelp: flowOutput.showHelp,
  escapeRegex: flowOutput.escapeRegex,
  getTodayDate: flowOutput.getTodayDate,
  slugify: flowOutput.slugify,

  // Constants (defined in this file)
  DEFAULT_COMMAND_TIMEOUT_MS,
  QUICK_COMMAND_TIMEOUT_MS,
  MAX_SESSION_HISTORY,
  MAX_WORKFLOW_ITERATIONS,
  TASK_LIMITS,
  LIST_TO_STATUS_MAP,

  // CLI Session ID (CLI-Agnostic)
  getSessionId,

  // Registry Discovery (v1.5.1)
  getActiveRegistries,
  getRegistryPaths,
  getRegistryMapFiles,

  // Task ID Generation & Validation (v1.9.0)
  generateHashId,
  generateTaskId,
  validateTaskId,
  isValidWogiId,
  validateReadyDataIds,
  isLegacyTaskId,

  // Hierarchical Work Item ID Generation (v3.2)
  generateEpicId,
  generateFeatureId,
  generatePlanId,

  // CLI Flags
  parseFlags,

  // Ready.json
  getReadyData,
  invalidateReadyDataCache,
  validateReadyJson,
  saveReadyData,
  archiveCompletedTasksToLog,
  saveReadyDataAsync,
  findTask,
  moveTask,
  moveTaskAsync,
  cancelTask,
  getTaskCounts,

  // Request Log
  countRequestLogEntries,
  getLastRequestLogEntry,
  getHighestRequestId,
  getNextRequestId,
  addRequestLogEntry,

  // App Map
  countAppMapComponents,
  addAppMapComponent,

  // Git
  isGitRepo,
  getGitStatus,

  // Permission Validation
  analyzePermissions,
  validatePermissions,

  // AST-Grep Integration
  AST_PATTERNS,
  isAstGrepAvailable,
  astGrepSearch,
  findReactComponents,
  findCustomHooks,
  findTypeDefinitions,

  // Hierarchical Task Utilities
  normalizeTask,
  findAllWithParent,
  findTaskInAllLists,

  // CLI Tool Detection (Claude Code 2.1.72+ compatibility)
  meetsVersion,
  getFdCommand,

  // Gitignore Auto-Management (v1.9.8)
  get syncGitignore() { return require('./flow-gitignore').syncGitignore; },
  get checkGitignoreHealth() { return require('./flow-gitignore').checkGitignoreHealth; },
};

// ============================================================
// Automatic Stale Lock Cleanup on Module Load
// ============================================================

// Clean up any stale locks from previous sessions/crashes
// This runs once when the module is first required
(function autoCleanupStaleLocks() {
  try {
    // Only clean up if STATE_DIR exists (workflow initialized)
    if (dirExists(STATE_DIR)) {
      const { cleanupStaleLocks } = flowIO;
      const cleaned = cleanupStaleLocks(STATE_DIR, 60000); // 60s stale threshold
      if (cleaned > 0 && process.env.DEBUG) {
        console.log(`[DEBUG] Auto-cleaned ${cleaned} stale lock(s) from ${STATE_DIR}`);
      }
    }
  } catch (_err) {
    // Silent failure - don't break module loading
  }
})();
