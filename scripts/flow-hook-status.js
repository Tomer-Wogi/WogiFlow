'use strict';

/**
 * Wogi Flow - Hook Status Aggregator
 *
 * Pre-computes a single hook-status.json file containing all state
 * that PreToolUse/PostToolUse hooks need. Hooks read 1 file instead
 * of 6-8 separate reads per invocation.
 *
 * Writers: flow-start.js, task-completed.js, routing-gate.js, phase-gate.js
 * Reader: pre-tool-use.js, post-tool-use.js
 *
 * IMPORTANT: This module must NOT require flow-utils at load time (circular dep risk).
 * flow-utils does NOT require this module — keep it that way.
 */

const fs = require('node:fs');
const path = require('node:path');

// Lazy-load to avoid circular deps at module level
let _PATHS = null;
function getPATHS() {
  if (!_PATHS) {
    _PATHS = require('./flow-paths').PATHS;
  }
  return _PATHS;
}

// Lazy-load safeJsonParseString to avoid circular deps
let _safeJsonParseString = null;
function getSafeJsonParseString() {
  if (!_safeJsonParseString) {
    _safeJsonParseString = require('./flow-io').safeJsonParseString;
  }
  return _safeJsonParseString;
}

const HOOK_STATUS_FILENAME = 'hook-status.json';

function getHookStatusPath() {
  return path.join(getPATHS().state, HOOK_STATUS_FILENAME);
}

/**
 * Read the current hook status (single file read).
 * Uses safeJsonParseString for prototype pollution protection.
 * Returns null if file doesn't exist, is corrupt, or stale vs config.json.
 * @returns {Object|null}
 */
function readHookStatus() {
  try {
    const statusPath = getHookStatusPath();
    const content = fs.readFileSync(statusPath, 'utf-8');
    const parsed = getSafeJsonParseString()(content, null);
    if (!parsed) return null;

    // Staleness check: if config.json is newer than hook-status.json, invalidate
    try {
      const configPath = path.join(getPATHS().workflow, 'config.json');
      const configMtime = fs.statSync(configPath).mtimeMs;
      const statusMtime = fs.statSync(statusPath).mtimeMs;
      if (configMtime > statusMtime) {
        // Config changed after hook-status was written — refresh needed
        return null;
      }
    } catch (_err) { /* config missing or stat failed — use cached status */ }

    return parsed;
  } catch (_err) {
    return null;
  }
}

/**
 * Write the hook status file atomically with PID-scoped temp file.
 * @param {Object} status - The full status object
 */
function writeHookStatus(status) {
  status.updatedAt = new Date().toISOString();
  const statusPath = getHookStatusPath();
  const tmpPath = statusPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
    fs.renameSync(tmpPath, statusPath);
  } catch (_err) {
    // Non-blocking — hooks fall back to individual reads
    try { fs.unlinkSync(tmpPath); } catch (_e) { /* ignore */ }
  }
}

/**
 * Build enforcement block from config (shared by createDefaultStatus + refreshHookStatus).
 * @param {Object} config - Parsed config object
 * @returns {Object} enforcement flags + componentReuse + phaseGate
 */
function buildEnforcementFromConfig(config) {
  return {
    enforcement: {
      taskGating: config.enforcement?.taskGating?.enabled === true,
      scopeGating: config.enforcement?.scopeGating?.enabled === true,
      routingGate: config.enforcement?.routingGate?.enabled === true,
      commitLogGate: config.enforcement?.commitLogGate?.enabled === true,
      todoWriteGate: config.enforcement?.todoWriteGate?.enabled === true,
      loopEnforcement: config.enforcement?.loopEnforcement?.enabled === true
    },
    componentReuse: config.componentReuse?.enabled === true,
    // Correct path: hooks.rules.phaseGate.enabled (matches phase-gate.js:84)
    phaseGate: config.hooks?.rules?.phaseGate?.enabled === true
  };
}

/**
 * Update specific fields in hook status (read-modify-write).
 * Creates the file if it doesn't exist.
 * Deep-merges known nested keys (enforcement, routing) to prevent clobbering.
 * @param {Object} updates - Fields to merge into current status
 */
function updateHookStatus(updates) {
  const current = readHookStatus() || createDefaultStatus();
  // Deep-merge known nested keys to prevent shallow-assign clobbering
  if (updates.enforcement) {
    updates.enforcement = { ...current.enforcement, ...updates.enforcement };
  }
  if (updates.routing) {
    updates.routing = { ...current.routing, ...updates.routing };
  }
  Object.assign(current, updates);
  writeHookStatus(current);
}

/**
 * Create default hook status from current config + state.
 * Called when hook-status.json doesn't exist yet.
 * @returns {Object}
 */
function createDefaultStatus() {
  let config = {};
  try {
    const { getConfig } = require('./flow-utils');
    config = getConfig() || {};
  } catch (_err) { /* ignore */ }

  return {
    ...buildEnforcementFromConfig(config),
    activeTask: null,
    phase: 'idle',
    routing: {
      pending: false,
      cleared: false,
      clearedAt: null
    },
    changedFiles: [],
    updatedAt: new Date().toISOString()
  };
}

/**
 * Refresh hook status from current config and state files.
 * Called at session start and after config changes.
 */
function refreshHookStatus() {
  let config = {};
  try {
    const { getConfig } = require('./flow-utils');
    config = getConfig() || {};
  } catch (_err) { /* ignore */ }

  let activeTask = null;
  try {
    const { getReadyData } = require('./flow-utils');
    const readyData = getReadyData();
    if (readyData.inProgress && readyData.inProgress.length > 0) {
      const task = readyData.inProgress[0];
      activeTask = { id: task.id, title: task.title, routedAt: task.routedAt || null };
    }
  } catch (_err) { /* ignore */ }

  let phase = 'idle';
  try {
    const { safeJsonParse } = require('./flow-utils');
    const phasePath = path.join(getPATHS().state, 'workflow-phase.json');
    const phaseData = safeJsonParse(phasePath, null);
    if (phaseData) phase = phaseData.phase || 'idle';
  } catch (_err) { /* ignore */ }

  const status = {
    ...buildEnforcementFromConfig(config),
    activeTask,
    phase,
    routing: {
      pending: false,
      cleared: false,
      clearedAt: null
    },
    changedFiles: []
  };

  writeHookStatus(status);
  return status;
}

/**
 * Update just the active task field.
 * @param {Object|null} task - { id, title, routedAt } or null
 */
function setActiveTask(task) {
  updateHookStatus({ activeTask: task });
}

/**
 * Update just the phase field.
 * @param {string} phase
 */
function setPhase(phase) {
  updateHookStatus({ phase });
}

/**
 * Update routing state.
 * @param {Object} routing - { pending, cleared, clearedAt }
 */
function setRouting(routing) {
  updateHookStatus({ routing });
}

/**
 * Add a file to the changed files list (deduped).
 * @param {string} filePath
 */
function trackFile(filePath) {
  const current = readHookStatus();
  if (!current) return;
  if (!current.changedFiles) current.changedFiles = [];
  if (!current.changedFiles.includes(filePath)) {
    current.changedFiles.push(filePath);
    writeHookStatus(current);
  }
}

/**
 * Clear hook status on task completion.
 */
function clearOnTaskComplete() {
  const current = readHookStatus() || createDefaultStatus();
  current.activeTask = null;
  current.phase = 'idle';
  current.routing = { pending: false, cleared: false, clearedAt: null };
  current.changedFiles = [];
  writeHookStatus(current);
}

module.exports = {
  readHookStatus,
  writeHookStatus,
  updateHookStatus,
  refreshHookStatus,
  createDefaultStatus,
  setActiveTask,
  setPhase,
  setRouting,
  trackFile,
  clearOnTaskComplete,
  getHookStatusPath,
  HOOK_STATUS_FILENAME
};
