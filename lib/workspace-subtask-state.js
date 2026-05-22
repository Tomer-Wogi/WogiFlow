'use strict';

/**
 * Wogi Flow — Durable Sub-task State (epic-workspace-sustained-exec / S1, wf-e72350bf)
 *
 * Sub-tasks of a decomposed task are normally tracked ONLY in Claude Code's
 * in-context TodoWrite list, which is ephemeral: a Stop hook running in a fresh
 * `node` process can't read it, and a session restart loses it entirely. That's
 * the root cause behind workers re-executing completed sub-tasks after a restart
 * and behind the continuation gate (S2) having no reliable "work remaining"
 * signal.
 *
 * This module mirrors the decomposition to a durable, atomically-written ledger
 * at `.workflow/state/subtask-state.json` so that:
 *   - a fresh-process Stop hook can read "N of M sub-tasks remain" (S2),
 *   - a restarted session can resume without redoing completed sub-tasks (S5).
 *
 * The ledger holds the CURRENT in-progress task's decomposition. There is one
 * active task per worker at a time, so a single-task shape is sufficient and
 * avoids stale cross-task contamination — read* helpers take an optional taskId
 * and return empty when it doesn't match the ledger's task.
 *
 * Atomic write: tmp + fsync(file) + rename + fsync(dir), mirroring
 * task-boundary-reset.js:writeCleanCompletionMarker so the ledger survives the
 * SIGTERM/relaunch boundary and concurrent readers never see torn JSON.
 *
 * Fail-open throughout: any error degrades to "no durable state" (callers fall
 * back to their prior behavior). Never throws.
 */

const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('../scripts/flow-utils');
const { safeJsonParse } = require('../scripts/flow-io');

const LEDGER_FILE = 'subtask-state.json';
const LEDGER_VERSION = 1;
// Statuses that count as "still needs work" for remaining().
const OPEN_STATUSES = new Set(['pending', 'in_progress']);
const TERMINAL_STATUSES = new Set(['completed', 'blocked']);

function getLedgerPath() {
  return path.join(PATHS.state, LEDGER_FILE);
}

/**
 * Normalize a free-form sub-task entry (TodoWrite item or plain object/string)
 * into the ledger shape { id, title, status }.
 */
function normalizeSubtask(entry, index) {
  if (entry == null) return null;
  if (typeof entry === 'string') {
    return { id: String(index + 1).padStart(2, '0'), title: entry.slice(0, 500), status: 'pending' };
  }
  if (typeof entry !== 'object') return null;
  const rawStatus = typeof entry.status === 'string' ? entry.status.toLowerCase() : 'pending';
  const status = OPEN_STATUSES.has(rawStatus) || TERMINAL_STATUSES.has(rawStatus) ? rawStatus : 'pending';
  const title = entry.title || entry.content || entry.text || entry.description || entry.activeForm || `Sub-task ${index + 1}`;
  const id = entry.id != null ? String(entry.id) : String(index + 1).padStart(2, '0');
  return { id, title: String(title).slice(0, 500), status };
}

/**
 * Map a Claude Code TodoWrite toolInput ({ todos: [{ content, status }] })
 * into normalized sub-tasks. Returns [] for anything unparseable.
 */
function subtasksFromTodos(toolInput) {
  try {
    const todos = toolInput && Array.isArray(toolInput.todos) ? toolInput.todos : null;
    if (!todos) return [];
    return todos.map(normalizeSubtask).filter(Boolean);
  } catch (_err) {
    return [];
  }
}

/**
 * Read the full ledger object, or null if absent/unreadable.
 * @returns {{version:number, taskId:string, updatedAt:string, subtasks:Array}|null}
 */
function readLedger() {
  try {
    const data = safeJsonParse(getLedgerPath(), null);
    if (!data || typeof data !== 'object' || !Array.isArray(data.subtasks)) return null;
    return data;
  } catch (_err) {
    return null;
  }
}

/**
 * Read the sub-tasks for a given task. When taskId is provided and doesn't match
 * the ledger's task, returns [] (the ledger belongs to a different task).
 * @param {string} [taskId]
 * @returns {Array<{id:string,title:string,status:string}>}
 */
function read(taskId) {
  const led = readLedger();
  if (!led) return [];
  if (taskId && led.taskId && led.taskId !== taskId) return [];
  return led.subtasks;
}

/**
 * Write/replace the ledger for taskId atomically.
 * @param {string} taskId
 * @param {Array} subtasks  raw or normalized entries
 * @returns {{written:boolean, reason?:string, path?:string}}
 */
function write(taskId, subtasks) {
  if (!taskId) return { written: false, reason: 'no-task-id' };
  try {
    const normalized = (Array.isArray(subtasks) ? subtasks : [])
      .map(normalizeSubtask)
      .filter(Boolean);
    const payload = {
      version: LEDGER_VERSION,
      taskId,
      updatedAt: new Date().toISOString(),
      subtasks: normalized
    };
    const p = getLedgerPath();
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(payload, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, p);
    try {
      const dfd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    } catch (_err) { /* directory fsync best-effort (not supported on all FS) */ }
    return { written: true, path: p };
  } catch (err) {
    return { written: false, reason: `write-failed: ${err.message}` };
  }
}

/**
 * Count sub-tasks still needing work (pending + in_progress) for taskId.
 * blocked and completed do NOT count. Returns 0 when no matching ledger exists
 * (no durable state ⇒ "nothing known to remain"; callers decide what that means).
 * @param {string} [taskId]
 * @returns {number}
 */
function remaining(taskId) {
  const subs = read(taskId);
  return subs.filter(s => OPEN_STATUSES.has(s.status)).length;
}

/**
 * Summary counts for heartbeats / status (S3, S4).
 * @param {string} [taskId]
 * @returns {{total:number, remaining:number, completed:number, blocked:number}}
 */
function summary(taskId) {
  const subs = read(taskId);
  return {
    total: subs.length,
    remaining: subs.filter(s => OPEN_STATUSES.has(s.status)).length,
    completed: subs.filter(s => s.status === 'completed').length,
    blocked: subs.filter(s => s.status === 'blocked').length
  };
}

/**
 * Mark one sub-task's status, preserving the rest. No-op if the ledger task
 * doesn't match. Returns the updated count.
 * @param {string} taskId
 * @param {string} subId
 * @param {string} [status='completed']
 */
function markStatus(taskId, subId, status = 'completed') {
  const led = readLedger();
  if (!led || (taskId && led.taskId !== taskId)) return { written: false, reason: 'no-matching-ledger' };
  const next = led.subtasks.map(s => (s.id === String(subId) ? { ...s, status } : s));
  return write(led.taskId, next);
}

/**
 * Clear the ledger (e.g. on task completion). Best-effort.
 */
function clear() {
  try {
    fs.unlinkSync(getLedgerPath());
    return { cleared: true };
  } catch (err) {
    if (err && err.code !== 'ENOENT' && process.env.DEBUG) {
      console.error(`[workspace-subtask-state] clear: ${err.code} ${err.message}`);
    }
    return { cleared: false };
  }
}

module.exports = {
  getLedgerPath,
  normalizeSubtask,
  subtasksFromTodos,
  readLedger,
  read,
  write,
  remaining,
  summary,
  markStatus,
  clear,
  LEDGER_FILE,
  OPEN_STATUSES,
  TERMINAL_STATUSES
};
