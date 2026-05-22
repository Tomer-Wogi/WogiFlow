/**
 * Wogi Flow — Worker SessionStart handler (wf-restart-handoff)
 *
 * Handles the "worker just started" branch of SessionStart:
 *
 *   - If worker has queued channel dispatches in ready.json:
 *     inject additionalContext telling the model to invoke
 *     /wogi-start <nextId> now. Mirrors the existing Stop-hook
 *     autopickup flow (task-completed.js::buildAutoPickupContext)
 *     but fires at session boundary instead of turn boundary —
 *     necessary because restart (wf-d3e67abe/2.22.1) kills the
 *     previous claude and the Stop-hook autopickup no longer bridges
 *     between tasks.
 *
 *   - Else if worker has zero in-progress + zero queued channel
 *     dispatches: write a `worker-ready` message to the workspace
 *     message bus so the manager can reconcile against its durable
 *     dispatched-tasks.json and re-dispatch any work lost during
 *     the restart window.
 *
 * Returns a context fragment (or null) that the SessionStart entry
 * merges into the overall hook output.
 *
 * Fail-open: any error returns null and logs in DEBUG mode. Never
 * blocks session startup.
 */

const path = require('node:path');

const WORKER_READY_LIB = path.join(__dirname, '..', '..', '..', 'lib', 'workspace-worker-ready.js');
const TASK_COMPLETED_CORE = path.join(__dirname, 'task-completed.js');

/**
 * Handle worker SessionStart.
 *
 * @returns {{branch: 'auto-resume'|'announce-ready'|'skip', context?: string, announced?: Object, pickup?: Object}}
 */
function handleWorkerSessionStart() {
  try {
    const { isWorker, shouldAnnounceReady, announceWorkerReady } = require(WORKER_READY_LIB);
    if (!isWorker()) return { branch: 'skip', reason: 'not-worker' };

    // S5 (wf-ee87a24e): RESUME-IN-PROGRESS. If this restarted session has a task
    // still in `inProgress` with sub-tasks remaining (durable S1 ledger), resume
    // THAT task — do NOT fall through to "announce idle" (which would orphan it)
    // or pick a different next task. The durable ledger means completed sub-tasks
    // are NOT redone. Also post a worker-ready ack so the manager actively
    // re-triggers if the resume wake-up was missed.
    try {
      const { PATHS, safeJsonParse } = require('../../flow-utils');
      const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), { inProgress: [] });
      const inProgress = (ready.inProgress || [])[0] || null;
      if (inProgress && inProgress.id) {
        let remaining = null, total = null;
        try {
          const subtaskState = require(path.join(__dirname, '..', '..', '..', 'lib', 'workspace-subtask-state.js'));
          const summary = subtaskState.summary(inProgress.id);
          remaining = summary.remaining; total = summary.total;
        } catch (_err) { /* ledger optional */ }
        // Only treat as resumable if there is remaining decomposed work, OR no
        // ledger exists at all (single-step task interrupted mid-flight).
        if (remaining === null || remaining > 0) {
          // Best-effort ack so the manager knows the worker is back on this task.
          // Bypass shouldAnnounceReady's empty-queue gating (it returns
          // 'in-progress-not-empty' here by design) — for a resume we WANT the
          // manager pinged. announceWorkerReady dedups via hasPendingAnnounce.
          try {
            const wr = require(WORKER_READY_LIB);
            const wsRoot = process.env.WOGI_WORKSPACE_ROOT;
            const repoName = process.env.WOGI_REPO_NAME;
            if (wsRoot && repoName && repoName !== 'manager') {
              wr.announceWorkerReady(wsRoot, repoName);
            }
          } catch (_err) { /* ack is best-effort */ }
          const ctx = [
            `⚡ WORKSPACE SESSION START — RESUMING IN-PROGRESS TASK`,
            '',
            `This worker restarted with task ${inProgress.id} still in progress${total != null ? ` (${remaining} of ${total} sub-task(s) remaining)` : ''}.`,
            `Durable sub-task state is on disk — completed sub-tasks are recorded and must NOT be redone.`,
            '',
            'AUTONOMOUS MODE CONTRACT (workspace worker):',
            '  • Resume the SAME task — do not pick a different one, do not go idle.',
            '  • Read .workflow/state/subtask-state.json to see which sub-tasks remain.',
            '  • Grind to completion; only stop when done (flow done) or genuinely blocked.',
            '',
            `ACT NOW: Invoke Skill(skill="wogi-start", args="${inProgress.id}")`
          ].join('\n');
          return { branch: 'resume-in-progress', context: ctx, taskId: inProgress.id, remaining, total };
        }
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[session-start-worker] resume-in-progress check failed (fail-open): ${err.message}`);
    }

    // Check for queued work first — if any, tell the model to pick it up
    // instead of announcing idle readiness.
    let pickup;
    try {
      const { findQueuedChannelDispatches, buildAutoPickupContext } = require(TASK_COMPLETED_CORE);
      pickup = findQueuedChannelDispatches();
      if (pickup && pickup.count > 0 && pickup.nextTaskId) {
        const base = buildAutoPickupContext(pickup);
        // Adjust the leading line for session-start context — the canonical
        // pickup message starts with "You just completed a task." which isn't
        // true on session start. Re-frame it here.
        const context = [
          `⚡ WORKSPACE SESSION START — ${pickup.count} CHANNEL DISPATCH${pickup.count === 1 ? '' : 'ES'} QUEUED`,
          '',
          `This fresh worker session has ${pickup.count} channel-dispatched task${pickup.count === 1 ? '' : 's'} queued in ready.json.`,
          `The previous session restarted cleanly (wogi-claude wrapper). Pick up the next task now.`,
          '',
          `Next: ${pickup.nextTaskId} — ${pickup.nextTaskTitle || '(no title)'}`,
          '',
          'AUTONOMOUS MODE CONTRACT (workspace worker):',
          '  • These dispatches are pre-approved by the manager.',
          '  • You MUST start the next one IMMEDIATELY in this same turn.',
          '  • Do NOT hedge ("awaiting signal", "let me know"). Forbidden.',
          '',
          `ACT NOW: Invoke Skill(skill="wogi-start", args="${pickup.nextTaskId}")`
        ].join('\n');
        // base included for logging/telemetry parity if we ever want to diff them
        void base;
        return { branch: 'auto-resume', context, pickup };
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start-worker] pickup-check failed (fail-open): ${err.message}`);
      }
    }

    // No queued work — announce readiness so the manager can reconcile.
    const decision = shouldAnnounceReady();
    if (!decision.announce) {
      return { branch: 'skip', reason: decision.reason };
    }

    const announced = announceWorkerReady(decision.workspaceRoot, decision.repoName);
    if (!announced.written) {
      if (process.env.DEBUG) {
        console.error(`[session-start-worker] announce failed: ${announced.reason}`);
      }
      return { branch: 'skip', reason: announced.reason };
    }

    // Optional context surface — not strictly needed since the manager
    // handles reconciliation asynchronously, but a one-line note helps
    // humans reading worker transcripts understand why the worker is idle.
    const context = [
      `Worker session started with empty queue.`,
      `Announced readiness to manager (msg ${announced.messageId}) —`,
      `manager will reconcile against its dispatch log and re-dispatch`,
      `any work lost during the restart window.`
    ].join(' ');

    return { branch: 'announce-ready', context, announced };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[session-start-worker] unexpected error (fail-open): ${err.message}`);
    }
    return { branch: 'skip', reason: `error: ${err.message}` };
  }
}

module.exports = {
  handleWorkerSessionStart
};
