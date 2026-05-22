'use strict';

/**
 * Wogi Workspace — Channel Server Dispatch Tracking Helpers (v2.29.4)
 *
 * Pure-function helpers that the channel server's HTTP POST handler calls
 * to record inbound dispatches and reconcile inbound completions. Extracted
 * from `workspace-channel-server.js` so they can be unit-tested without
 * spawning the channel-server process.
 *
 * Why these exist (silent-halt RCA, 2026-04-27):
 *   `recordDispatch` was only called from the programmatic dispatch helper
 *   (`workspace-routing.js → dispatchToChannel`). Manager AI sessions that
 *   used raw `curl POST http://localhost:8801` bypassed it entirely. With
 *   no record, the overdue detector had nothing to detect — workers could
 *   die silently with zero manager-side signal.
 *
 * Both helpers are best-effort and fail-open. Idempotency lives at the
 * call site (Fix A skips when a pending record already exists; Fix B
 * delegates idempotency to `reconcileDispatch` which returns `null` when
 * no pending record matches).
 */

const TASK_ID_PATTERN = /\bwf-[0-9a-f]{8}\b/i;
const DISPATCH_BODY_PATTERN = /^\s*\/wogi-start\s+(wf-[0-9a-f]{8})\b/i;
const QUESTION_BODY_PATTERN = /^\s*##\s*QUESTION/im;
const COMPLETION_BODY_PATTERN = /##\s*Results\b|task-complete\b/i;

/**
 * Record an inbound dispatch when the channel server (running in worker
 * mode) receives a `/wogi-start <id>` POST from the manager.
 *
 * No-ops when:
 *   - workspaceRoot is missing
 *   - body is not a non-empty string
 *   - this server is in manager mode (REPO_NAME === 'manager')
 *   - the `from` header is not the manager
 *   - the body does not match the dispatch pattern
 *   - a pending record for (taskId, repoName) already exists (idempotency)
 *
 * @param {Object} ctx
 * @param {string} ctx.workspaceRoot
 * @param {string} ctx.repoName
 * @param {string} ctx.from
 * @param {string} ctx.body
 * @param {Object} [tracking] — injectable for tests; defaults to the lib module
 * @returns {{action: 'recorded'|'skip-existing'|'skip-not-worker'|'skip-bad-from'|'skip-no-match'|'skip-no-root'|'skip-empty-body'|'error', reason?: string, taskId?: string}}
 */
function tryRecordInboundDispatch(ctx, tracking) {
  const { workspaceRoot, repoName, from, body } = ctx || {};
  if (!workspaceRoot) return { action: 'skip-no-root' };
  if (typeof body !== 'string' || !body) return { action: 'skip-empty-body' };
  if (repoName === 'manager') return { action: 'skip-not-worker' };
  if (from !== 'manager' && from !== 'workspace-manager') return { action: 'skip-bad-from' };
  const m = body.match(DISPATCH_BODY_PATTERN);
  if (!m) return { action: 'skip-no-match' };
  const taskId = m[1].toLowerCase();
  try {
    const tr = tracking || require('./workspace-dispatch-tracking');
    const existing = tr.readDispatches(workspaceRoot).find(r =>
      r && r.taskId === taskId && r.repoName === repoName && r.status === 'pending'
    );
    if (existing) return { action: 'skip-existing', taskId };
    tr.recordDispatch(workspaceRoot, {
      taskId,
      repoName,
      dispatchedBy: from
    });
    return { action: 'recorded', taskId };
  } catch (err) {
    return { action: 'error', reason: err.message, taskId };
  }
}

/**
 * Reconcile an inbound completion when the channel server (running in
 * manager mode) receives a worker-side POST that looks like a completion.
 *
 * No-ops when:
 *   - workspaceRoot is missing
 *   - body is not a non-empty string
 *   - this server is in worker mode (REPO_NAME !== 'manager')
 *   - the `from` header IS the manager (no self-completion)
 *   - the body looks like a `## QUESTION:` (escalation, not completion)
 *   - the body does not contain `## Results` or `task-complete`
 *   - the body does not contain a `wf-XXXXXXXX` reference
 *   - reconcileDispatch finds no pending record (idempotent)
 *
 * @param {Object} ctx
 * @param {string} ctx.workspaceRoot
 * @param {string} ctx.repoName
 * @param {string} ctx.from
 * @param {string} ctx.body
 * @param {Object} [tracking] — injectable for tests; defaults to the lib module
 * @returns {{action: 'reconciled'|'skip-not-manager'|'skip-self'|'skip-question'|'skip-not-completion'|'skip-no-id'|'skip-no-pending'|'skip-no-root'|'skip-empty-body'|'error', reason?: string, taskId?: string}}
 */
function tryReconcileInboundCompletion(ctx, tracking) {
  const { workspaceRoot, repoName, from, body } = ctx || {};
  if (!workspaceRoot) return { action: 'skip-no-root' };
  if (typeof body !== 'string' || !body) return { action: 'skip-empty-body' };
  if (repoName !== 'manager') return { action: 'skip-not-manager' };
  if (from === 'manager' || from === 'workspace-manager') return { action: 'skip-self' };
  if (QUESTION_BODY_PATTERN.test(body)) return { action: 'skip-question' };
  if (!COMPLETION_BODY_PATTERN.test(body)) return { action: 'skip-not-completion' };
  const m = body.match(TASK_ID_PATTERN);
  if (!m) return { action: 'skip-no-id' };
  const taskId = m[0].toLowerCase();
  try {
    const tr = tracking || require('./workspace-dispatch-tracking');
    const result = tr.reconcileDispatch(workspaceRoot, taskId, 'completed', 'channel-server-completion');
    if (!result) return { action: 'skip-no-pending', taskId };
    return { action: 'reconciled', taskId };
  } catch (err) {
    return { action: 'error', reason: err.message, taskId };
  }
}

// ============================================================
// Worker activity status (epic-workspace-sustained-exec / S4, wf-87611c5e)
// ============================================================

const fsNode = require('node:fs');
const pathNode = require('node:path');

const ACTIVE_PHASES = new Set(['coding', 'validating']);
const DEFAULT_STALENESS_MS = 300000; // 5 min

function _safeRead(p) {
  try { return JSON.parse(fsNode.readFileSync(p, 'utf-8')); } catch (_err) { return null; }
}
function _mtimeMs(p) {
  try { return fsNode.statSync(p).mtimeMs; } catch (_err) { return 0; }
}

/**
 * Derive the worker's real execution state for GET /status. Distinguishes
 * ack-received / work-started / in-progress / complete / blocked / idle so the
 * manager can never mistake a channel POST `ok` (or `/health` ok) for progress.
 *
 * Pure-ish (reads files from stateDir); injectable for tests.
 *
 * @param {Object} opts
 * @param {string} opts.stateDir       worker .workflow/state dir
 * @param {string} [opts.repoName]
 * @param {number} [opts.lastInboundAt] ms epoch of the last dispatch POST the server saw
 * @param {number} [opts.stalenessMs]  heartbeat freshness window
 * @param {number} [opts.now]
 * @returns {{repo, state, taskId, subtasks:{total,remaining}, lastHeartbeatAt, lastSha, phase}}
 */
function computeWorkerStatus(opts = {}) {
  const stateDir = opts.stateDir;
  const now = opts.now || Date.now();
  const stalenessMs = Number.isFinite(opts.stalenessMs) ? opts.stalenessMs : DEFAULT_STALENESS_MS;
  const out = {
    repo: opts.repoName || null,
    state: 'idle',
    taskId: null,
    subtasks: { total: 0, remaining: 0 },
    lastHeartbeatAt: null,
    lastSha: null,
    phase: null
  };
  try {
    if (!stateDir) return out;
    const ready = _safeRead(pathNode.join(stateDir, 'ready.json')) || {};
    const phaseData = _safeRead(pathNode.join(stateDir, 'workflow-phase.json')) || {};
    const ledger = _safeRead(pathNode.join(stateDir, 'subtask-state.json'));
    const counter = _safeRead(pathNode.join(stateDir, 'worker-continuation.json'));
    const phase = typeof phaseData.phase === 'string' ? phaseData.phase : null;
    out.phase = phase;

    const inProgress = (ready.inProgress || [])[0] || null;

    // Activity freshness: newest mtime of the files a working worker touches.
    const lastActivityMs = Math.max(
      _mtimeMs(pathNode.join(stateDir, 'workflow-phase.json')),
      _mtimeMs(pathNode.join(stateDir, 'subtask-state.json')),
      _mtimeMs(pathNode.join(stateDir, 'worker-continuation.json'))
    );
    if (lastActivityMs > 0) out.lastHeartbeatAt = new Date(lastActivityMs).toISOString();
    const activityFresh = lastActivityMs > 0 && (now - lastActivityMs) < stalenessMs;

    if (!inProgress) {
      const recent = (ready.recentlyCompleted || [])[0] || null;
      const completedTs = recent && recent.completedAt ? Date.parse(recent.completedAt) : NaN;
      if (Number.isFinite(completedTs) && (now - completedTs) < stalenessMs) {
        out.state = 'complete';
        out.taskId = recent.id || null;
      } else {
        out.state = 'idle';
      }
      return out;
    }

    out.taskId = inProgress.id || null;
    if (ledger && (!ledger.taskId || ledger.taskId === out.taskId) && Array.isArray(ledger.subtasks)) {
      const open = ledger.subtasks.filter(s => s && (s.status === 'pending' || s.status === 'in_progress')).length;
      out.subtasks = { total: ledger.subtasks.length, remaining: open };
    }

    const escalated = counter && counter.taskId === out.taskId && counter.escalated === true;
    if (escalated) {
      out.state = 'blocked';
    } else if (ACTIVE_PHASES.has(phase)) {
      out.state = activityFresh ? 'in-progress' : 'work-started';
    } else {
      // Picked up (in inProgress) but not yet in active-work phase.
      out.state = 'ack-received';
    }
    return out;
  } catch (_err) {
    return out; // fail-open: never 500
  }
}

module.exports = {
  TASK_ID_PATTERN,
  DISPATCH_BODY_PATTERN,
  QUESTION_BODY_PATTERN,
  COMPLETION_BODY_PATTERN,
  tryRecordInboundDispatch,
  tryReconcileInboundCompletion,
  computeWorkerStatus,
  ACTIVE_PHASES,
  DEFAULT_STALENESS_MS
};
