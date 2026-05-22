/**
 * Wogi Flow — Overdue Dispatch Detection (wf-d3e67abe)
 *
 * Computes overdue workspace dispatches for manager sessions and
 * returns an additionalContext string to inject into UserPromptSubmit,
 * surfacing silent worker deaths to the model before it processes the
 * next prompt.
 *
 * Manager-scoped: returns null for worker sessions and when
 * WOGI_WORKSPACE_ROOT is unset.
 */

const path = require('node:path');

/**
 * Returns true when this process is a workspace manager session
 * (i.e., NOT a worker). A session counts as manager when:
 *   - WOGI_WORKSPACE_ROOT is set (we have a workspace to inspect), AND
 *   - WOGI_REPO_NAME is 'manager' OR unset (not a worker name).
 */
function isManagerSession() {
  if (!process.env.WOGI_WORKSPACE_ROOT) return false;
  const repo = process.env.WOGI_REPO_NAME;
  return !repo || repo === 'manager';
}

function formatDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours === 0) return `${min}m`;
  return `${hours}h${min}m`;
}

function formatLine(record, now) {
  const dispatched = Date.parse(record.dispatchedAt || '');
  const deadline = Date.parse(record.expectedDeadline || '');
  const sinceDispatch = Number.isFinite(dispatched) ? formatDuration(now - dispatched) : '?';
  const pastDeadline = Number.isFinite(deadline) ? formatDuration(now - deadline) : '?';
  const budget = record.expectedDurationMs
    ? formatDuration(record.expectedDurationMs)
    : '?';
  return `• ${record.taskId} → ${record.repoName}  | dispatched ${sinceDispatch} ago (${pastDeadline} past ${budget} deadline) | no task-complete / worker-stopped message`;
}

/**
 * Reconcile any pending dispatches against `task-complete` or `worker-stopped`
 * messages in the workspace message bus. Called before overdue computation so
 * records that matched an incoming message don't get flagged as silent deaths.
 *
 * @param {string} workspaceRoot
 * @returns {number} count of reconciled records
 */
function sweepAndReconcile(workspaceRoot) {
  let reconciled = 0;
  let readMessages, reconcileDispatch, readDispatches, refreshDispatchDeadline;
  try {
    const libMessages = path.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-messages.js');
    const libTracking = path.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-dispatch-tracking.js');
    readMessages = require(libMessages).readMessages;
    const tracking = require(libTracking);
    reconcileDispatch = tracking.reconcileDispatch;
    readDispatches = tracking.readDispatches;
    refreshDispatchDeadline = tracking.refreshDispatchDeadline;
  } catch (_err) {
    return 0; // Fail-open
  }

  let dispatches;
  try {
    dispatches = readDispatches(workspaceRoot).filter(r => r && r.status === 'pending');
  } catch (_err) {
    return 0;
  }
  if (dispatches.length === 0) return 0;

  const byTaskId = new Map();
  for (const r of dispatches) {
    if (r.taskId && !byTaskId.has(r.taskId)) byTaskId.set(r.taskId, r);
  }

  // S3 (wf-d3ae1717): heartbeats refresh the deadline (work ongoing, NOT a
  // silent halt); terminal types resolve the dispatch. worker-progress is
  // applied FIRST so a heartbeat that arrived before a terminal doesn't keep a
  // since-resolved dispatch alive.
  try {
    const heartbeats = readMessages(workspaceRoot, { type: 'worker-progress' });
    if (refreshDispatchDeadline) {
      for (const hb of heartbeats) {
        const taskId = hb.taskId;
        if (!taskId || !byTaskId.has(taskId)) continue;
        try { refreshDispatchDeadline(workspaceRoot, taskId); } catch (_err) { /* per-record */ }
      }
    }
  } catch (_err) { /* heartbeats are best-effort */ }

  // Pull terminal message types. readMessages throws on missing dir internally
  // but guards with existsSync, so it's safe. worker-blocked / worker-idle /
  // worker-awaiting-approval are terminal stops alongside the legacy pair.
  let messages = [];
  try {
    const completes = readMessages(workspaceRoot, { type: 'task-complete' });
    const stops = readMessages(workspaceRoot, { type: 'worker-stopped' });
    const blocked = readMessages(workspaceRoot, { type: 'worker-blocked' });
    const idle = readMessages(workspaceRoot, { type: 'worker-idle' });
    const awaiting = readMessages(workspaceRoot, { type: 'worker-awaiting-approval' });
    messages = completes.concat(stops, blocked, idle, awaiting);
  } catch (_err) {
    return 0;
  }

  for (const msg of messages) {
    const taskId = msg.taskId || (msg.type === 'task-complete' ? msg.subject : null);
    if (!taskId || !byTaskId.has(taskId)) continue;
    try {
      // task-complete → completed; everything else is a non-overdue graceful
      // stop (the reason field distinguishes blocked / awaiting / idle / graceful).
      const status = msg.type === 'task-complete' ? 'completed' : 'graceful-stop';
      const reason = msg.type === 'task-complete' ? null : (msg.reason || msg.type);
      const result = reconcileDispatch(workspaceRoot, taskId, status, reason);
      if (result) {
        reconciled++;
        byTaskId.delete(taskId); // Don't double-reconcile
      }
    } catch (_err) {
      // Per-record failure must not poison the sweep.
    }
  }

  return reconciled;
}

/**
 * Reconcile pending `worker-ready` messages (2.22.2 restart-handoff).
 *
 * A worker-ready message signals that a worker session started with an
 * empty queue — possibly because a prior dispatch was lost during the
 * wrapper's restart window. For each pending worker-ready:
 *   - Find pending dispatches to that repo in dispatched-tasks.json
 *   - If any found: they're likely the lost dispatches. Collect as
 *     `lostDispatches` for surface to the manager.
 *   - Mark the worker-ready message as acknowledged regardless — once
 *     the manager has seen it, there's nothing more to do with the
 *     same message. If another restart happens, a fresh worker-ready
 *     will be written.
 *
 * @param {string} workspaceRoot
 * @param {Object} [opts]
 * @param {number} [opts.staleGraceMs=30000] — ignore dispatches newer than this
 *   (to avoid flagging just-sent dispatches still in flight).
 * @returns {{acknowledged: number, lostDispatches: Array}}
 */
function reconcileWorkerReady(workspaceRoot, opts = {}) {
  const staleGraceMs = Number.isFinite(opts.staleGraceMs) ? opts.staleGraceMs : 30000;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();

  let readMessages, updateMessageStatus, readDispatches;
  try {
    const libMessages = path.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-messages.js');
    const libTracking = path.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-dispatch-tracking.js');
    const bus = require(libMessages);
    readMessages = bus.readMessages;
    updateMessageStatus = bus.updateMessageStatus;
    const tracking = require(libTracking);
    readDispatches = tracking.readDispatches;
  } catch (_err) {
    return { acknowledged: 0, lostDispatches: [] };
  }

  let pendingReady = [];
  try {
    pendingReady = readMessages(workspaceRoot, { type: 'worker-ready', status: 'pending' });
  } catch (_err) {
    return { acknowledged: 0, lostDispatches: [] };
  }
  if (pendingReady.length === 0) return { acknowledged: 0, lostDispatches: [] };

  let dispatches = [];
  try {
    dispatches = readDispatches(workspaceRoot).filter(r => r && r.status === 'pending');
  } catch (_err) {
    dispatches = [];
  }

  const lostDispatches = [];
  let acknowledged = 0;

  for (const msg of pendingReady) {
    const repoName = msg.from;
    if (!repoName) continue;

    // Find pending dispatches to this repo that are older than the grace
    // period (avoid race conditions with just-sent dispatches).
    const candidates = dispatches.filter(r => {
      if (r.repoName !== repoName) return false;
      const dispatched = Date.parse(r.dispatchedAt || '');
      if (!Number.isFinite(dispatched)) return false;
      return (now - dispatched) > staleGraceMs;
    });

    for (const c of candidates) {
      lostDispatches.push({ ...c, workerReadyMsgId: msg.id });
    }

    // Acknowledge the worker-ready message — we've processed it once.
    // If the restart-loss recurs, a fresh worker-ready will be written.
    try {
      if (updateMessageStatus) {
        updateMessageStatus(workspaceRoot, msg.id, 'acknowledged');
        acknowledged++;
      }
    } catch (_err) { /* non-fatal */ }
  }

  return { acknowledged, lostDispatches };
}

/**
 * Format the lost-dispatches block for manager additionalContext.
 *
 * @param {Array} lost
 * @returns {string|null}
 */
function formatLostDispatchesContext(lost) {
  if (!Array.isArray(lost) || lost.length === 0) return null;
  const lines = lost.map(r => {
    const dispatchedAt = r.dispatchedAt || '?';
    return `• ${r.taskId} → ${r.repoName}  | dispatched ${dispatchedAt} | still pending after worker restart`;
  });
  return [
    `━━━ LOST DISPATCHES — WORKER RESTARTED WITH EMPTY QUEUE (${lost.length}) ━━━`,
    ...lines,
    '',
    'A worker announced fresh readiness but these dispatches are still',
    'pending. Likely lost during the wrapper\'s restart window. Re-dispatch',
    'them now via dispatchToChannel(workspaceRoot, repoName, taskId).',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
}

/**
 * Build the overdue-dispatches additionalContext block, or return null
 * when nothing to surface (non-manager, no workspace root, no overdue).
 *
 * Also handles worker-ready reconciliation (2.22.2) — if workers announced
 * readiness and there are matching pending dispatches, include a lost-dispatch
 * section so the manager can re-dispatch.
 *
 * @param {Object} [opts]
 * @param {string} [opts.workspaceRoot] — override (primarily for tests)
 * @param {number} [opts.now=Date.now()]
 * @returns {string|null}
 */
function buildOverdueContext(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || process.env.WOGI_WORKSPACE_ROOT;
  if (!workspaceRoot) return null;
  if (!opts.workspaceRoot && !isManagerSession()) return null;

  // Sweep: reconcile any pending records that match incoming messages
  // before computing overdue. This prevents false positives for workers
  // whose completion/stop message arrived while the manager was idle.
  try { sweepAndReconcile(workspaceRoot); }
  catch (_err) { /* fail-open */ }

  // Reconcile worker-ready announcements. Surface any lost dispatches
  // the manager should re-send.
  let lostBlock = null;
  try {
    const { lostDispatches } = reconcileWorkerReady(workspaceRoot, { now: opts.now });
    lostBlock = formatLostDispatchesContext(lostDispatches);
  } catch (_err) { /* fail-open */ }

  let overdue;
  try {
    const libPath = path.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-dispatch-tracking.js');
    const { getOverdueDispatches } = require(libPath);
    overdue = getOverdueDispatches(workspaceRoot, opts.now);
  } catch (_err) {
    // If dispatch-tracking is missing but we have lost-dispatches from
    // worker-ready, still surface those.
    return lostBlock;
  }

  // Worker completion summaries (Story B / wf-ab59f0e4): surface unseen
  // summaries from any worker that finished an autonomous epic. Render via
  // flow-workspace-summary.renderMultiWorker for the multi-worker block.
  let summariesBlock = null;
  let seenTaskIds = [];
  try {
    const libPath = path.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-dispatch-tracking.js');
    const { readPendingCompletionSummaries, markCompletionSummariesSeen } = require(libPath);
    const pending = readPendingCompletionSummaries(workspaceRoot);
    if (Array.isArray(pending) && pending.length > 0) {
      const wsSummary = require(path.resolve(__dirname, '..', '..', 'flow-workspace-summary.js'));
      const payloads = pending.map(p => p.summary);
      summariesBlock = wsSummary.renderMultiWorker(payloads);
      seenTaskIds = pending.map(p => p.taskId);
      markCompletionSummariesSeen(workspaceRoot, seenTaskIds);
    }
  } catch (_err) { /* fail-open — surface what we can */ }

  if ((!Array.isArray(overdue) || overdue.length === 0) && !lostBlock && !summariesBlock) return null;

  const sections = [];

  if (summariesBlock) sections.push(summariesBlock);
  if (lostBlock) sections.push(lostBlock);

  if (Array.isArray(overdue) && overdue.length > 0) {
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const lines = overdue.map(r => formatLine(r, now));
    sections.push([
      `━━━ OVERDUE WORKSPACE DISPATCHES (${overdue.length}) ━━━`,
      ...lines,
      '',
      'These workers may have died silently. Check worker terminals;',
      'if dead, re-dispatch or mark failed. Records:',
      '  .workspace/state/dispatched-tasks.json',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'));
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

module.exports = {
  isManagerSession,
  buildOverdueContext,
  sweepAndReconcile,
  reconcileWorkerReady,
  formatLostDispatchesContext
};
