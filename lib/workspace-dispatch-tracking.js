#!/usr/bin/env node

/**
 * Wogi Workspace — Dispatch Tracking (wf-d3e67abe)
 *
 * Silent-worker-halt detection via file-based dispatch records.
 *
 * Manager records every dispatch; any pending dispatch past its
 * expectedDeadline without a matching completion/stop message =
 * silent death. Surfaced on the next manager turn via the
 * UserPromptSubmit hook (no background processes).
 *
 * State file: .workspace/state/dispatched-tasks.json
 * Ring buffer of last MAX_ACTIVE records; older overflow to
 * .workspace/state/dispatched-tasks.archive.jsonl (append-only).
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');

const DEFAULT_DURATION_MS = 30 * 60 * 1000; // 30 min — matches waitForCompletion default
const MAX_ACTIVE = 100;
const SCHEMA_VERSION = 1;

const VALID_STATUSES = new Set(['pending', 'completed', 'graceful-stop', 'silent-halt']);

function stateFilePath(workspaceRoot) {
  return path.join(workspaceRoot, '.workspace', 'state', 'dispatched-tasks.json');
}

function archiveFilePath(workspaceRoot) {
  return path.join(workspaceRoot, '.workspace', 'state', 'dispatched-tasks.archive.jsonl');
}

function loadState(workspaceRoot) {
  const data = safeReadJson(stateFilePath(workspaceRoot), null);
  if (data && typeof data === 'object' && Array.isArray(data.dispatches)) {
    return { version: data.version || SCHEMA_VERSION, dispatches: data.dispatches };
  }
  return { version: SCHEMA_VERSION, dispatches: [] };
}

function saveState(workspaceRoot, state) {
  const filePath = stateFilePath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function archiveRecord(workspaceRoot, record) {
  const filePath = archiveFilePath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
}

/**
 * Record a dispatch. Appends to state and trims ring buffer.
 *
 * @param {string} workspaceRoot
 * @param {Object} params
 * @param {string} params.taskId - wf-XXXXXXXX
 * @param {string} params.repoName
 * @param {number} [params.expectedDurationMs=DEFAULT_DURATION_MS]
 * @param {string} [params.dispatchedBy='manager']
 * @returns {Object} the created record
 */
function recordDispatch(workspaceRoot, { taskId, repoName, expectedDurationMs, dispatchedBy }) {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') {
    throw new Error('workspaceRoot required');
  }
  if (!/^wf-[0-9a-f]{8}$/i.test(taskId || '')) {
    throw new Error(`Invalid taskId: ${taskId}`);
  }
  if (!repoName || typeof repoName !== 'string') {
    throw new Error('repoName required');
  }

  const durationMs = Number.isFinite(expectedDurationMs) && expectedDurationMs > 0
    ? expectedDurationMs
    : DEFAULT_DURATION_MS;
  const now = Date.now();
  const dispatchedAt = new Date(now).toISOString();
  const expectedDeadline = new Date(now + durationMs).toISOString();

  const record = {
    taskId,
    repoName,
    dispatchedAt,
    expectedDeadline,
    expectedDurationMs: durationMs,
    status: 'pending',
    dispatchedBy: dispatchedBy || 'manager',
    reconciledAt: null,
    reconciledReason: null
  };

  const state = loadState(workspaceRoot);
  state.dispatches.push(record);

  // Ring buffer: overflow oldest records to archive
  while (state.dispatches.length > MAX_ACTIVE) {
    const overflow = state.dispatches.shift();
    try { archiveRecord(workspaceRoot, overflow); }
    catch (_err) { /* non-fatal — archive is best-effort */ }
  }

  saveState(workspaceRoot, state);
  return record;
}

/**
 * Reconcile the most recent pending record for a task.
 *
 * @param {string} workspaceRoot
 * @param {string} taskId
 * @param {string} status - 'completed' | 'graceful-stop' | 'silent-halt'
 * @param {string} [reason]
 * @returns {Object|null} updated record, or null if not found
 */
function reconcileDispatch(workspaceRoot, taskId, status, reason) {
  if (!VALID_STATUSES.has(status) || status === 'pending') {
    throw new Error(`Invalid reconcile status: ${status}`);
  }
  const state = loadState(workspaceRoot);
  // Find most recent pending record for this taskId (last wins — most recent dispatch)
  for (let i = state.dispatches.length - 1; i >= 0; i--) {
    const r = state.dispatches[i];
    if (r && r.taskId === taskId && r.status === 'pending') {
      r.status = status;
      r.reconciledAt = new Date().toISOString();
      r.reconciledReason = reason || null;
      saveState(workspaceRoot, state);
      return r;
    }
  }
  return null;
}

/**
 * Read all currently-active dispatch records (not archived).
 *
 * @param {string} workspaceRoot
 * @returns {Array<Object>}
 */
function readDispatches(workspaceRoot) {
  return loadState(workspaceRoot).dispatches;
}

/**
 * Get dispatches whose expectedDeadline has passed and are still pending.
 *
 * @param {string} workspaceRoot
 * @param {number} [now=Date.now()]
 * @returns {Array<Object>} overdue records
 */
function getOverdueDispatches(workspaceRoot, now) {
  const ts = Number.isFinite(now) ? now : Date.now();
  const dispatches = readDispatches(workspaceRoot);
  return dispatches.filter(r => {
    if (!r || r.status !== 'pending') return false;
    const deadline = Date.parse(r.expectedDeadline || '');
    return Number.isFinite(deadline) && deadline < ts;
  });
}

module.exports = {
  DEFAULT_DURATION_MS,
  MAX_ACTIVE,
  recordDispatch,
  reconcileDispatch,
  readDispatches,
  getOverdueDispatches,
  stateFilePath,
  archiveFilePath
};
