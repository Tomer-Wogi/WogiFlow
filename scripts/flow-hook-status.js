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

const HOOK_STATUS_FILENAME = 'hook-status.json';

function getHookStatusPath() {
  return path.join(getPATHS().state, HOOK_STATUS_FILENAME);
}

/**
 * Read the current hook status (single file read).
 * Returns null if file doesn't exist or is corrupt.
 * @returns {Object|null}
 */
function readHookStatus() {
  try {
    const content = fs.readFileSync(getHookStatusPath(), 'utf-8');
    return JSON.parse(content);
  } catch (_err) {
    return null;
  }
}

/**
 * Write the hook status file atomically.
 * @param {Object} status - The full status object
 */
function writeHookStatus(status) {
  status.updatedAt = new Date().toISOString();
  const statusPath = getHookStatusPath();
  const tmpPath = statusPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
    fs.renameSync(tmpPath, statusPath);
  } catch (_err) {
    // Non-blocking — hooks fall back to individual reads
    try { fs.unlinkSync(tmpPath); } catch (_e) { /* ignore */ }
  }
}

/**
 * Update specific fields in hook status (read-modify-write).
 * Creates the file if it doesn't exist.
 * @param {Object} updates - Fields to merge into current status
 */
function updateHookStatus(updates) {
  const current = readHookStatus() || createDefaultStatus();
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
    enforcement: {
      taskGating: config.enforcement?.taskGating?.enabled || false,
      scopeGating: config.enforcement?.scopeGating?.enabled || false,
      routingGate: config.enforcement?.routingGate?.enabled || false,
      commitLogGate: config.enforcement?.commitLogGate?.enabled || false,
      todoWriteGate: config.enforcement?.todoWriteGate?.enabled || false,
      loopEnforcement: config.enforcement?.loopEnforcement?.enabled || false
    },
    componentReuse: config.componentReuse?.enabled || false,
    phaseGate: config.hooks?.rules?.intelligence?.phaseGate?.enabled || false,
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
    const phasePath = path.join(getPATHS().state, 'workflow-phase.json');
    const phaseData = JSON.parse(fs.readFileSync(phasePath, 'utf-8'));
    phase = phaseData.phase || 'idle';
  } catch (_err) { /* ignore */ }

  const status = {
    enforcement: {
      taskGating: config.enforcement?.taskGating?.enabled || false,
      scopeGating: config.enforcement?.scopeGating?.enabled || false,
      routingGate: config.enforcement?.routingGate?.enabled || false,
      commitLogGate: config.enforcement?.commitLogGate?.enabled || false,
      todoWriteGate: config.enforcement?.todoWriteGate?.enabled || false,
      loopEnforcement: config.enforcement?.loopEnforcement?.enabled || false
    },
    componentReuse: config.componentReuse?.enabled || false,
    phaseGate: config.hooks?.rules?.intelligence?.phaseGate?.enabled || false,
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
  HOOK_STATUS_FILENAME
};
