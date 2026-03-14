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
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

// ============================================================
// Import from focused modules
// ============================================================

const flowPaths = require('./flow-paths');
const flowIO = require('./flow-io');
const flowConfigLoader = require('./flow-config-loader');
const flowTokens = require('./flow-tokens');
const flowOutput = require('./flow-output');

// Destructure commonly used imports for internal use in this file
const { PATHS, PROJECT_ROOT, STATE_DIR } = flowPaths;
const { readJson, writeJson, readFile, writeFile, fileExists, dirExists, safeJsonParse, acquireLock } = flowIO;
const { getConfig, invalidateConfigCache } = flowConfigLoader;
const { success, warn, error, info, color } = flowOutput;
const { estimateComplexity } = flowTokens;

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
// Registry Discovery (v1.5.1 -- wf-927db36d)
// ============================================================

const MANIFEST_PATH = path.join(STATE_DIR, 'registry-manifest.json');

const DEFAULT_REGISTRIES = [
  { id: 'components', name: 'Component Registry', mapFile: 'app-map.md', indexFile: 'component-index.json', category: 'code', type: 'components', active: true },
  { id: 'functions', name: 'Function Registry', mapFile: 'function-map.md', indexFile: 'function-index.json', category: 'code', type: 'functions', active: true },
  { id: 'apis', name: 'API Registry', mapFile: 'api-map.md', indexFile: 'api-index.json', category: 'code', type: 'apis', active: true }
];

/**
 * Get all active registries from the manifest (with fallback to defaults).
 * Lightweight -- reads the manifest file directly without requiring flow-registry-manager.
 * @returns {Array<{id, name, mapFile, indexFile, category, type, active}>}
 */
function getActiveRegistries() {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const manifest = safeJsonParse(MANIFEST_PATH, null);
      if (manifest) {
        const active = (manifest.registries || []).filter(r => r.active);
        if (active.length > 0) return active;
      }
    } catch (err) {
      // Fall through to defaults
    }
  }
  return DEFAULT_REGISTRIES;
}

/**
 * Get paths for all active registry map and index files.
 * @returns {{ maps: string[], indexes: string[], mapsByCategory: Object }}
 */
function getRegistryPaths() {
  const registries = getActiveRegistries();
  const maps = registries.map(r => path.join(STATE_DIR, r.mapFile));
  const indexes = registries.map(r => path.join(STATE_DIR, r.indexFile));

  const mapsByCategory = {};
  for (const r of registries) {
    if (!mapsByCategory[r.category]) mapsByCategory[r.category] = [];
    mapsByCategory[r.category].push({
      id: r.id,
      mapPath: path.join(STATE_DIR, r.mapFile),
      indexPath: path.join(STATE_DIR, r.indexFile)
    });
  }

  return { maps, indexes, mapsByCategory, registries };
}

/**
 * Get map file names only (for copying to worktrees, etc.).
 * @returns {string[]} e.g. ['app-map.md', 'function-map.md', 'api-map.md', 'schema-map.md']
 */
function getRegistryMapFiles() {
  return getActiveRegistries().map(r => r.mapFile);
}

// ============================================================
// Task ID Generation (hash-based IDs)
// ============================================================

/**
 * Generate a hash-based ID with a given prefix
 * Uses SHA256 hash of seed + title + timestamp for collision resistance.
 *
 * @param {string} prefix - ID prefix (e.g., 'wf', 'ep', 'ft', 'pl')
 * @param {string} seed - Seed string for the hash (e.g., '', 'epic-', 'feature-')
 * @param {string} title - Title to include in hash input
 * @returns {string} ID in format prefix-XXXXXXXX
 */
function generateHashId(prefix, seed, title) {
  const randomHex = crypto.randomBytes(8).toString('hex');
  const input = `${seed}${title}${Date.now()}${randomHex}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
  return `${prefix}-${hash}`;
}

/**
 * Generate a hash-based task ID
 * Format: wf-XXXXXXXX (8-char hex hash)
 *
 * @param {string} title - Task title
 * @returns {string} Task ID in format wf-XXXXXXXX
 *
 * @example
 * generateTaskId('Fix login bug') // => 'wf-a1b2c3d4'
 */
function generateTaskId(title) {
  return generateHashId('wf', '', title);
}

/**
 * Generate a hash-based epic ID
 * Format: ep-XXXXXXXX (8-char hex hash)
 *
 * @param {string} title - Epic title
 * @returns {string} Epic ID in format ep-XXXXXXXX
 */
function generateEpicId(title) {
  return generateHashId('ep', 'epic-', title);
}

/**
 * Generate a hash-based feature ID
 * Format: ft-XXXXXXXX (8-char hex hash)
 *
 * @param {string} title - Feature title
 * @returns {string} Feature ID in format ft-XXXXXXXX
 */
function generateFeatureId(title) {
  return generateHashId('ft', 'feature-', title);
}

/**
 * Generate a hash-based plan ID
 * Format: pl-XXXXXXXX (8-char hex hash)
 *
 * @param {string} title - Plan title
 * @returns {string} Plan ID in format pl-XXXXXXXX
 */
function generatePlanId(title) {
  return generateHashId('pl', 'plan-', title);
}

/**
 * Check if a string is a valid task ID (old or new format)
 * @param {string} id - ID to validate
 * @returns {{ valid: boolean, format: 'hash' | 'legacy' | null }}
 */
function validateTaskId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, format: null };
  }

  // New hash-based format: wf-XXXXXXXX
  if (/^wf-[a-f0-9]{8}$/i.test(id)) {
    return { valid: true, format: 'hash' };
  }

  // Legacy formats: TASK-XXX, BUG-XXX
  if (/^(TASK|BUG)-\d{3,}$/i.test(id)) {
    return { valid: true, format: 'legacy' };
  }

  return { valid: false, format: null };
}

/**
 * Check if ID is in legacy format (for migration warnings)
 * @param {string} id - ID to check
 * @returns {boolean}
 */
function isLegacyTaskId(id) {
  return /^(TASK|BUG)-\d{3,}$/i.test(id);
}

// ============================================================
// CLI Flag Parsing
// ============================================================

/**
 * Parse common CLI flags from arguments
 * Standardizes flag handling across all flow commands
 *
 * @param {string[]} args - Command line arguments (process.argv.slice(2))
 * @returns {{ flags: Object, positional: string[] }}
 *
 * @example
 * const { flags, positional } = parseFlags(process.argv.slice(2));
 * if (flags.json) outputJson(result);
 * if (flags.help) showHelp();
 */
function parseFlags(args) {
  const flags = {
    json: false,
    quiet: false,
    verbose: false,
    help: false,
    dryRun: false,
    deep: false
  };

  const positional = [];
  const namedFlags = {};

  // Known flags that take values (--flag value style)
  const valuedFlags = ['priority', 'from', 'severity', 'limit', 'format', 'output', 'strategy', 'type', 'file', 'analysis', 'model', 'domain', 'task-type'];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      flags.quiet = true;
    } else if (arg === '--verbose' || arg === '-v') {
      flags.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--deep') {
      flags.deep = true;
    } else if (arg.startsWith('--')) {
      // Handle --key=value style flags
      const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
      if (match) {
        const [, key, value] = match;
        if (value !== undefined) {
          // Has explicit value: --key=value
          namedFlags[key] = value;
        } else if (valuedFlags.includes(key) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
          // Known valued flag: --key value (consume next arg)
          namedFlags[key] = args[++i];
        } else if (valuedFlags.includes(key)) {
          // Valued flag without value - warn in debug mode, treat as boolean
          if (process.env.DEBUG) {
            console.warn(`[DEBUG] Flag --${key} expects a value but none provided`);
          }
          namedFlags[key] = true;
        } else {
          // Boolean flag: --flag
          namedFlags[key] = true;
        }
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { flags: { ...flags, ...namedFlags }, positional };
}

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
function isValidWogiId(id) {
  if (!id || typeof id !== 'string') return false;
  // Standard task, sub-task, review fix (wf-cr-), review finding (wf-rv-)
  if (/^wf-[a-f0-9]{8}(-\d{2})?$/i.test(id)) return true;
  if (/^wf-cr-[a-f0-9]{6}$/i.test(id)) return true;
  if (/^wf-rv-[a-f0-9]{8}$/i.test(id)) return true;
  // Epic, feature, plan IDs
  if (/^(ep|ft|pl)-[a-f0-9]{8}$/i.test(id)) return true;
  // Legacy format
  if (/^(TASK|BUG)-\d{3,}$/i.test(id)) return true;
  return false;
}

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
    return result;
  });
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
// Request Log Operations
// ============================================================

/**
 * Count entries in request-log.md
 */
function countRequestLogEntries() {
  try {
    const content = readFile(PATHS.requestLog, '');
    const matches = content.match(/^### R-/gm);
    return matches ? matches.length : 0;
  } catch (_err) {
    return 0;
  }
}

/**
 * Get the last request log entry
 */
function getLastRequestLogEntry() {
  try {
    const content = readFile(PATHS.requestLog, '');
    const matches = content.match(/^### R-.*$/gm);
    return matches ? matches[matches.length - 1] : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Get the highest request ID number from request-log.md
 * More robust than counting - handles gaps and deleted entries
 */
function getHighestRequestId() {
  try {
    const content = readFile(PATHS.requestLog, '');
    // Match all R-XXX patterns (3+ digits)
    const matches = content.match(/### R-(\d{3,})/g);
    if (!matches || matches.length === 0) return 0;

    // Extract numbers and find the max
    const numbers = matches.map(m => {
      const num = m.match(/R-(\d+)/);
      return num ? parseInt(num[1], 10) : 0;
    });
    return Math.max(...numbers);
  } catch (_err) {
    return 0;
  }
}

/**
 * Get next request ID
 * Uses highest existing ID + 1 to avoid duplicates even with gaps
 */
function getNextRequestId() {
  const highestId = getHighestRequestId();
  return `R-${String(highestId + 1).padStart(3, '0')}`;
}

/**
 * Add an entry to request-log.md
 * @param {Object} entry - Entry details
 * @param {string} entry.type - new | fix | change | refactor
 * @param {string[]} entry.tags - Array of tags (e.g., ['#figma', '#component:Button'])
 * @param {string} entry.request - What was requested
 * @param {string} entry.result - What was done
 * @param {string[]} [entry.files] - Files changed
 * @param {string} [entry.sessionId] - CLI session ID (auto-detected if not provided)
 */
function addRequestLogEntry(entry) {
  const { type, tags, request, result, files = [], sessionId } = entry;
  const id = getNextRequestId();
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);

  // Get session ID from entry or auto-detect from environment
  const session = sessionId || getSessionId();
  const sessionLine = session ? `\n**Session**: ${session}` : '';

  const filesLine = files.length > 0 ? `\n**Files**: ${files.join(', ')}` : '';
  const tagsStr = tags.join(' ');

  const logEntry = `
### ${id} | ${timestamp}
**Type**: ${type}
**Tags**: ${tagsStr}${sessionLine}
**Request**: "${request}"
**Result**: ${result}${filesLine}
`;

  try {
    // Use appendFileSync for atomic append (avoids read-modify-write race)
    fs.appendFileSync(PATHS.requestLog, logEntry);
    return id;
  } catch (err) {
    error(`Failed to add request log entry: ${err.message}`);
    return null;
  }
}

// ============================================================
// App Map Operations
// ============================================================

/**
 * Count components in app-map.md
 * Counts actual data rows (excludes headers and separator rows)
 */
function countAppMapComponents() {
  try {
    const content = readFile(PATHS.appMap, '');
    // Match data rows: start with | followed by non-dash content (excludes |---|---|)
    const dataRows = content.match(/^\|[^-|][^|]*\|/gm);
    // Each table has 1 header row per section, estimate ~2-3 sections
    const headerCount = (content.match(/^## /gm) || []).length * 1;
    const count = dataRows ? Math.max(0, dataRows.length - headerCount) : 0;
    return count;
  } catch (_err) {
    return 0;
  }
}

/**
 * Add a component to app-map.md
 * @param {Object} component - Component details
 * @param {string} component.name - Component name
 * @param {string} component.type - Component type (component, screen, modal, etc.)
 * @param {string} component.path - Path to component file
 * @param {string[]} [component.variants] - Available variants
 * @param {string} [component.description] - Component description
 * @returns {boolean} - Success status
 */
function addAppMapComponent(component) {
  const { name, type, path: filePath, variants = [], description = '' } = component;

  try {
    let content = readFile(PATHS.appMap, '');

    // Find the appropriate section based on type
    const sectionMap = {
      screen: '## Screens',
      modal: '## Modals',
      component: '## Components',
      layout: '## Layouts'
    };

    const section = sectionMap[type] || '## Components';
    const variantsStr = variants.length > 0 ? variants.join(', ') : '-';
    const descStr = description || '-';

    // Create new row
    const newRow = `| ${name} | ${filePath} | ${variantsStr} | ${descStr} |`;

    // Find section and add row
    const sectionIndex = content.indexOf(section);
    if (sectionIndex === -1) {
      warn(`Section "${section}" not found in app-map.md`);
      return false;
    }

    // Find the end of the table in this section (next section or end of file)
    const nextSectionMatch = content.substring(sectionIndex + section.length).match(/\n## /);
    const endIndex = nextSectionMatch
      ? sectionIndex + section.length + nextSectionMatch.index
      : content.length;

    // Find last table row in section
    const sectionContent = content.substring(sectionIndex, endIndex);
    const lastPipeIndex = sectionContent.lastIndexOf('\n|');

    if (lastPipeIndex !== -1) {
      // Find the end of the last row (next newline after the pipe)
      const afterPipe = sectionContent.substring(lastPipeIndex);
      const newlineOffset = afterPipe.indexOf('\n', 1);
      // If no newline found, insert at end of section content
      const insertOffset = newlineOffset !== -1 ? newlineOffset : afterPipe.length;
      const insertIndex = sectionIndex + lastPipeIndex + insertOffset;
      content = content.substring(0, insertIndex) + '\n' + newRow + content.substring(insertIndex);
    } else {
      // No table rows yet, add after header
      const headerEnd = sectionContent.indexOf('\n\n');
      if (headerEnd !== -1) {
        const insertIndex = sectionIndex + headerEnd;
        content = content.substring(0, insertIndex) + '\n' + newRow + content.substring(insertIndex);
      } else {
        // Malformed section - no header end found
        warn(`Could not find proper insertion point in section "${section}"`);
        return false;
      }
    }

    writeFile(PATHS.appMap, content);
    return true;
  } catch (err) {
    error(`Failed to add component to app-map: ${err.message}`);
    return false;
  }
}

// ============================================================
// CLI Tool Detection (Claude Code 2.1.72+ compatibility)
// ============================================================

const { execFileSync } = require('node:child_process');

/**
 * Compare a parsed semver against a required minimum.
 * Eliminates repeated inline version comparison logic.
 *
 * @param {number} major - Parsed major version
 * @param {number} minor - Parsed minor version
 * @param {number} patch - Parsed patch version
 * @param {number} rMajor - Required major
 * @param {number} rMinor - Required minor
 * @param {number} rPatch - Required patch
 * @returns {boolean}
 */
function meetsVersion(major, minor, patch, rMajor, rMinor, rPatch) {
  return major > rMajor ||
    (major === rMajor && minor > rMinor) ||
    (major === rMajor && minor === rMinor && patch >= rPatch);
}

/**
 * Detect if fd or fdfind is available on the system.
 * fd/fdfind is auto-approved in Claude Code 2.1.72+ bash allowlist,
 * making it a better choice than find for reduced permission prompts.
 *
 * Uses execFileSync (not execSync) per security rule 8.
 * Result is memoized for the process lifetime.
 *
 * @returns {string|false} The fd command name ('fd' or 'fdfind'), or false if unavailable
 */
let _fdCommand = null;
function getFdCommand() {
  if (_fdCommand !== null) return _fdCommand;
  for (const cmd of ['fd', 'fdfind']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 3000 });
      _fdCommand = cmd;
      return cmd;
    } catch (_err) {
      // Not available
    }
  }
  _fdCommand = false;
  return false;
}

// ============================================================
// Git Operations
// ============================================================

/**
 * Check if current directory is a git repo
 * Note: .git can be a directory (normal repo) or file (worktree)
 */
function isGitRepo() {
  const gitPath = path.join(PROJECT_ROOT, '.git');
  return fs.existsSync(gitPath);
}

/**
 * Get git status info (requires child_process)
 */
function getGitStatus() {
  if (!isGitRepo()) {
    return { isRepo: false };
  }

  try {
    const branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const uncommitted = status.split('\n').filter(Boolean).length;

    return {
      isRepo: true,
      branch,
      uncommitted,
      clean: uncommitted === 0
    };
  } catch (err) {
    return { isRepo: true, error: err.message };
  }
}

// ============================================================
// Permission Validation (Claude Code settings.local.json)
// ============================================================

/**
 * Analyze permission rules for issues
 * @param {string[]} permissions - Array of permission rules
 * @returns {Object} Analysis result with duplicates, overbroad, shadowed
 */
function analyzePermissions(permissions) {
  const result = {
    duplicates: [],
    overbroad: [],
    shadowed: [],
    total: permissions.length
  };

  // Check for duplicates
  const seen = new Set();
  for (const perm of permissions) {
    if (seen.has(perm)) {
      result.duplicates.push(perm);
    }
    seen.add(perm);
  }

  // Check for overly broad patterns
  const overbroadPatterns = ['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)'];
  for (const perm of permissions) {
    if (overbroadPatterns.includes(perm)) {
      result.overbroad.push(perm);
    }
  }

  // Check for shadowed rules (specific rules covered by wildcards)
  const wildcards = permissions.filter(p => p.includes('*'));
  const specific = permissions.filter(p => !p.includes('*'));

  for (const spec of specific) {
    // Extract tool type and pattern
    const match = spec.match(/^(\w+)\((.+)\)$/);
    if (match) {
      const [, tool, pattern] = match;
      // Check if a wildcard covers this
      for (const wild of wildcards) {
        const wildMatch = wild.match(/^(\w+)\((.+)\)$/);
        if (wildMatch && wildMatch[1] === tool) {
          const wildPattern = wildMatch[2].replace(/\*/g, '.*');
          try {
            const regex = new RegExp(`^${wildPattern}$`);
            if (regex.test(pattern)) {
              result.shadowed.push({ specific: spec, wildcard: wild });
              break;
            }
          } catch (_err) {
            // Invalid regex, skip
          }
        }
      }
    }
  }

  return result;
}

/**
 * Validate permission rules and return issues
 * @param {string[]} permissions - Array of permission rules
 * @returns {Object} Validation result with issues and warnings
 */
function validatePermissions(permissions) {
  const analysis = analyzePermissions(permissions);

  const issues = [];
  const warnings = [];

  // Critical: duplicates waste space
  if (analysis.duplicates.length > 0) {
    warnings.push({
      type: 'duplicate',
      message: `${analysis.duplicates.length} duplicate rule(s) found`,
      items: analysis.duplicates
    });
  }

  // Critical: overly broad rules are security risks
  if (analysis.overbroad.length > 0) {
    issues.push({
      type: 'overbroad',
      severity: 'critical',
      message: `${analysis.overbroad.length} overly broad rule(s) found`,
      items: analysis.overbroad
    });
  }

  // Info: shadowed rules are redundant but not harmful
  if (analysis.shadowed.length > 0) {
    warnings.push({
      type: 'shadowed',
      message: `${analysis.shadowed.length} rule(s) shadowed by wildcards (redundant)`,
      items: analysis.shadowed.map(s => s.specific)
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    analysis
  };
}

// ============================================================
// AST-Grep Integration
// ============================================================

/**
 * Common AST patterns for code discovery
 */
const AST_PATTERNS = {
  // React patterns
  reactComponent: 'function $NAME($PROPS) { return <$_>$$$</$_> }',
  reactArrowComponent: 'const $NAME = ($PROPS) => { return <$_>$$$</$_> }',
  useStateHook: 'const [$STATE, $SETTER] = useState($INIT)',
  useEffectHook: 'useEffect($FN, [$$$DEPS])',
  useCustomHook: 'const $RESULT = use$NAME($$$ARGS)',

  // TypeScript patterns
  interfaceDefinition: 'interface $NAME { $$$ }',
  typeDefinition: 'type $NAME = $$$',
  exportedFunction: 'export function $NAME($$$PARAMS) { $$$ }',
  exportedConst: 'export const $NAME = $$$',

  // Import patterns
  namedImport: 'import { $$$IMPORTS } from "$PATH"',
  defaultImport: 'import $NAME from "$PATH"',

  // Class patterns
  classDefinition: 'class $NAME { $$$ }',
  classExtends: 'class $NAME extends $BASE { $$$ }'
};

/**
 * Check if ast-grep CLI (sg) is available
 */
function isAstGrepAvailable() {
  try {
    execSync('which sg', { stdio: 'ignore' });
    return true;
  } catch (_err) {
    return false;
  }
}

// Allowed languages for ast-grep to prevent command injection (Security Rule 8)
const ALLOWED_AST_GREP_LANGUAGES = new Set([
  'typescript', 'javascript', 'tsx', 'jsx', 'python', 'go', 'rust',
  'java', 'c', 'cpp', 'csharp', 'ruby', 'swift', 'kotlin', 'html', 'css'
]);

/**
 * Search codebase using ast-grep for structural patterns
 * @param {string} pattern - AST pattern (e.g., "useState($INIT)")
 * @param {object} options - { lang, cwd, maxResults }
 * @returns {Array|null} Array of matches or null if ast-grep unavailable
 */
function astGrepSearch(pattern, options = {}) {
  const {
    lang = 'typescript',
    cwd = PROJECT_ROOT,
    maxResults = 20,
    searchDir = 'src'
  } = options;

  // Validate lang parameter to prevent command injection (Security Rule 8)
  if (!ALLOWED_AST_GREP_LANGUAGES.has(lang)) {
    if (process.env.DEBUG) {
      console.error(`[ast-grep] Invalid language: ${lang}. Allowed: ${[...ALLOWED_AST_GREP_LANGUAGES].join(', ')}`);
    }
    return null;
  }

  // Check if ast-grep is available
  if (!isAstGrepAvailable()) {
    return null;
  }

  const searchPath = path.join(cwd, searchDir);
  if (!dirExists(searchPath)) {
    return [];
  }

  try {
    // Use execFileSync with array args to prevent shell injection (Security Rule 8)
    const { execFileSync } = require('node:child_process');
    const result = execFileSync('sg', [
      '--pattern', pattern,
      '--lang', lang,
      '--json', searchPath
    ], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000
    });

    const matches = JSON.parse(result || '[]');
    return matches.slice(0, maxResults).map(m => ({
      file: path.relative(cwd, m.file || m.path),
      line: m.range?.start?.line ?? m.startLine ?? 0,
      endLine: m.range?.end?.line ?? m.endLine ?? 0,
      content: m.text || m.match,
      meta: m.metaVariables || {}  // Captured $VARS
    }));
  } catch (err) {
    // Parse error, timeout, or no matches
    if (err.stdout) {
      try {
        const matches = JSON.parse(err.stdout);
        return matches.slice(0, maxResults).map(m => ({
          file: path.relative(cwd, m.file || m.path),
          line: m.range?.start?.line ?? 0,
          content: m.text || m.match,
          meta: m.metaVariables || {}
        }));
      } catch (_err) {
        // Ignore parse errors
      }
    }
    return [];
  }
}

/**
 * Search for React components in the codebase
 * @param {object} options - Search options
 */
function findReactComponents(options = {}) {
  const { maxResults = 10 } = options;

  // Try function components first
  let results = astGrepSearch(AST_PATTERNS.reactComponent, { ...options, maxResults });

  // If ast-grep not available, return null
  if (results === null) return null;

  // Also search arrow function components
  const arrowResults = astGrepSearch(AST_PATTERNS.reactArrowComponent, { ...options, maxResults });
  if (arrowResults) {
    results = [...results, ...arrowResults];
  }

  // Dedupe by file
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.file)) return false;
    seen.add(r.file);
    return true;
  }).slice(0, maxResults);
}

/**
 * Search for custom hooks in the codebase
 * @param {object} options - Search options
 */
function findCustomHooks(options = {}) {
  const { maxResults = 10 } = options;

  // Search for function use* pattern
  const results = astGrepSearch('function use$NAME($$$) { $$$ }', { ...options, maxResults });

  if (results === null) return null;

  return results.filter(r => {
    // Filter to only actual hook files
    const fileName = path.basename(r.file).toLowerCase();
    return fileName.startsWith('use') || fileName.includes('hook');
  });
}

/**
 * Search for TypeScript interfaces/types
 * @param {string} namePattern - Optional name pattern to filter by
 * @param {object} options - Search options
 */
function findTypeDefinitions(namePattern = null, options = {}) {
  const { maxResults = 10 } = options;

  // Search interfaces
  let results = astGrepSearch(AST_PATTERNS.interfaceDefinition, { ...options, maxResults });

  if (results === null) return null;

  // Also search type aliases
  const typeResults = astGrepSearch(AST_PATTERNS.typeDefinition, { ...options, maxResults });
  if (typeResults) {
    results = [...results, ...typeResults];
  }

  // Filter by name pattern if provided
  if (namePattern) {
    const regex = new RegExp(namePattern, 'i');
    results = results.filter(r => regex.test(r.content));
  }

  return results.slice(0, maxResults);
}

// ============================================================
// Hierarchical Task Utilities
// ============================================================


/**
 * Normalize a task object to include optional hierarchical fields
 * Ensures backward compatibility with existing tasks
 * @param {Object} task - Task object from ready.json
 * @returns {Object} Normalized task with all optional fields
 */
function normalizeTask(task) {
  if (!task || typeof task === 'string') {
    return task; // Can't normalize string IDs (legacy format)
  }

  return {
    ...task,
    // Default level based on type if not set
    level: task.level || (task.type === 'epic' ? 'L0' : task.type === 'story' ? 'L1' : 'L2'),
    // Use existing parent field (backward compatible)
    parent: task.parent || null,
    // NEW: child task IDs
    children: task.children || [],
    // NEW: progress tracking for hierarchical items
    progress: task.progress || null
  };
}

/**
 * Find all tasks with a given parent ID
 * @param {Object} readyData - Ready.json data
 * @param {string} parentId - Parent task ID
 * @returns {Object[]} Array of child tasks
 */
function findAllWithParent(readyData, parentId) {
  const children = [];
  const lists = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];

  for (const listName of lists) {
    const list = readyData[listName] || [];
    for (const task of list) {
      if (task && typeof task !== 'string' && task.parent === parentId) {
        children.push(task);
      }
    }
  }

  return children;
}

/**
 * Find a task in all lists by ID
 * @param {Object} readyData - Ready.json data
 * @param {string} taskId - Task ID to find
 * @returns {Object|null} Task object or null
 */
function findTaskInAllLists(readyData, taskId) {
  const lists = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];

  for (const listName of lists) {
    const list = readyData[listName] || [];
    for (const task of list) {
      const id = typeof task === 'string' ? task : task.id;
      if (id === taskId) {
        return typeof task === 'string' ? { id: task } : task;
      }
    }
  }

  return null;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Explicit re-exports from flow-paths.js
  getProjectRoot: flowPaths.getProjectRoot,
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
