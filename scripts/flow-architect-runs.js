'use strict';

/**
 * Wogi Flow — Architect-Run Marker Store (wf-2eafdab0 / v2.30.1)
 *
 * Owns the read/write/GC operations for Architect-run evidence markers
 * stored at `.workflow/state/architect-runs/<task-id>.json`.
 *
 * Why this lives in scripts/ (not hooks/core/): the architect-required gate
 * READS markers; flow-architect-pass.js WRITES markers. With both helpers
 * in hooks/core, we'd invert the established hooks-depend-on-scripts
 * direction (review finding M5). This module is the neutral home both
 * callers consume from.
 *
 * Public API:
 *   - getArchitectRunPath(taskId) → string|null (validateTaskId guarded)
 *   - writeArchitectRunMarker({taskId, model, plan, specPath}) → {written, path}
 *   - hasArchitectRun(taskId, currentSpecPath?) → boolean (content-validated)
 *   - gcStaleMarkers({maxAgeMs?, retainCompletedTasks?}) → {removed, kept}
 *   - ARCHITECT_RUNS_DIR (constant)
 *
 * Hardening this round (review-fix v2.30.1):
 *   - AC9:  hasArchitectRun validates JSON parse + taskId field match
 *   - AC11: validateTaskId guard before path.join (path-traversal defense)
 *   - AC14: tmp file unlinked on rename failure
 *   - AC15: specHash (sha256) in marker payload for staleness detection
 *   - AC8:  gcStaleMarkers removes completed-task markers older than maxAgeMs
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PATHS, safeJsonParse, validateTaskId, getReadyData } = require('./flow-utils');

const ARCHITECT_RUNS_DIR = path.join(PATHS.state, 'architect-runs');
const DEFAULT_GC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Compute path to the Architect-run evidence marker.
 * Returns null if taskId fails validateTaskId (path-traversal defense).
 */
function getArchitectRunPath(taskId) {
  if (!taskId || typeof taskId !== 'string') return null;
  // validateTaskId returns { valid, format }, not a bool — check the field.
  const v = validateTaskId(taskId);
  if (!v || v.valid !== true) return null;
  return path.join(ARCHITECT_RUNS_DIR, `${taskId}.json`);
}

/**
 * Compute sha256 of a file's content. Returns null if file missing/unreadable.
 */
function _hashFile(filePath) {
  if (!filePath) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (_err) {
    return null;
  }
}

/**
 * Write Architect-run marker. Atomic temp-then-rename. Tmp file unlinked
 * on rename failure (no leaked tmp files).
 */
function writeArchitectRunMarker(payload) {
  if (!payload || !payload.taskId) {
    return { written: false, path: null };
  }
  const filePath = getArchitectRunPath(payload.taskId);
  if (!filePath) {
    return { written: false, path: null };
  }
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    if (!fs.existsSync(ARCHITECT_RUNS_DIR)) {
      fs.mkdirSync(ARCHITECT_RUNS_DIR, { recursive: true });
    }
    const marker = {
      taskId: payload.taskId,
      completedAt: payload.completedAt || new Date().toISOString(),
      model: payload.model || null,
      plan: payload.plan || null,
      specHash: payload.specPath ? _hashFile(payload.specPath) : null,
      specPath: payload.specPath || null
    };
    fs.writeFileSync(tmpPath, JSON.stringify(marker, null, 2));
    fs.renameSync(tmpPath, filePath);
    return { written: true, path: filePath };
  } catch (_err) {
    // Clean up the tmp file if rename failed — don't leak.
    try { fs.unlinkSync(tmpPath); } catch (_e) { /* fail-open */ }
    return { written: false, path: null };
  }
}

/**
 * Validate that a marker exists AND its content is well-formed AND, if
 * `currentSpecPath` is provided, the spec hasn't changed since the marker
 * was written.
 *
 * Returns false on:
 *   - missing file
 *   - JSON parse failure (corrupted marker)
 *   - taskId field mismatch (wrong marker for this task)
 *   - specHash mismatch (spec was edited after Architect ran — stale)
 */
function hasArchitectRun(taskId, currentSpecPath) {
  const p = getArchitectRunPath(taskId);
  if (!p) return false;
  if (!fs.existsSync(p)) return false;
  const marker = safeJsonParse(p, null);
  if (!marker || typeof marker !== 'object') return false;
  if (marker.taskId !== taskId) return false;
  // specHash check (AC15 — stale-spec invalidation)
  if (currentSpecPath && marker.specHash) {
    const currentHash = _hashFile(currentSpecPath);
    if (currentHash && currentHash !== marker.specHash) return false;
  }
  return true;
}

/**
 * Remove markers whose task is in `recentlyCompleted` and whose mtime is
 * older than maxAgeMs. Idempotent; safe to call repeatedly.
 *
 * @param {Object} opts
 * @param {number} [opts.maxAgeMs=7d] — markers older than this are eligible
 * @param {boolean} [opts.retainCompletedTasks=false] — keep markers for completed tasks
 *                                                     (default: GC them)
 * @returns {{removed: string[], kept: string[]}}
 */
function gcStaleMarkers(opts = {}) {
  const maxAgeMs = typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : DEFAULT_GC_MAX_AGE_MS;
  const retainCompletedTasks = opts.retainCompletedTasks === true;
  const result = { removed: [], kept: [] };
  if (!fs.existsSync(ARCHITECT_RUNS_DIR)) return result;

  // Build set of completed task IDs (markers eligible for GC by default)
  let completedIds = new Set();
  try {
    const ready = getReadyData();
    if (ready && Array.isArray(ready.recentlyCompleted)) {
      for (const t of ready.recentlyCompleted) {
        if (t && t.id) completedIds.add(t.id);
      }
    }
  } catch (_err) { /* fail-open */ }

  const now = Date.now();
  let entries = [];
  try {
    entries = fs.readdirSync(ARCHITECT_RUNS_DIR);
  } catch (_err) { return result; }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const taskId = entry.slice(0, -5); // strip .json
    if (!validateTaskId(taskId).valid) {
      // Stray file — leave alone (could be backup or someone else's data)
      result.kept.push(taskId);
      continue;
    }
    const fullPath = path.join(ARCHITECT_RUNS_DIR, entry);
    let stat;
    try { stat = fs.statSync(fullPath); } catch (_err) { continue; }
    const ageMs = now - stat.mtimeMs;
    const isCompleted = completedIds.has(taskId);
    const isExpired = ageMs > maxAgeMs;

    // Eligible for GC: task is completed AND marker is older than maxAge,
    // unless retainCompletedTasks is true.
    if (isCompleted && isExpired && !retainCompletedTasks) {
      try {
        fs.unlinkSync(fullPath);
        result.removed.push(taskId);
      } catch (_err) {
        result.kept.push(taskId);
      }
    } else {
      result.kept.push(taskId);
    }
  }
  return result;
}

module.exports = {
  ARCHITECT_RUNS_DIR,
  getArchitectRunPath,
  writeArchitectRunMarker,
  hasArchitectRun,
  gcStaleMarkers
};
