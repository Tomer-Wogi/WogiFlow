/**
 * Wogi Flow - Task Boundary Reset (Core Module)
 *
 * Experimental, opt-in: on real WogiFlow task completion, write a restart flag
 * and send SIGTERM to the parent Claude Code process. The wogi-claude wrapper
 * detects the flag on claude's clean exit and relaunches with a fresh context,
 * recovering the 10-20% of session tokens that prior conversation was burning.
 *
 * Design (two-phase, after empirical P11 failure on 2026-04-15):
 *
 *   Phase 1 — markRestartPending()
 *     Called from task-completion sites (scripts/hooks/core/task-completed.js,
 *     scripts/flow-done.js). Writes a small marker file under .workflow/state/.
 *     No signals, no exits — just a durable "task is done; please restart at
 *     the next safe boundary" note.
 *
 *   Phase 2 — consumeAndTriggerRestart()
 *     Called from the Stop hook entry (scripts/hooks/entry/claude-code/stop.js),
 *     which runs as a direct child of the claude process. If the pending marker
 *     exists AND preconditions hold, the function writes the wrapper flag and
 *     sends SIGTERM to ppid (claude). The wrapper restarts claude with a fresh
 *     context.
 *
 * Why two phases?
 *   The original single-phase design attached to Claude Code's TaskCompleted
 *   event — which turned out not to fire for Task-tool subagent completions
 *   despite an internal code comment claiming so. P11.1 (observed-behavior
 *   evidence requirement) was added to the rubric after that failure. This
 *   redesign uses Stop hook + marker file because the Stop hook is directly
 *   observed firing in Claude Code sessions and is a verified child of the
 *   claude process.
 *
 * Preconditions (Phase 2 only; Phase 1 is always safe to write):
 *   1. config.taskBoundaryReset.enabled === true
 *   2. process.env.WOGI_WRAPPER_PID is set (wogi-claude wrapper is present)
 *   3. process.env.WOGI_RESTART_FLAG is set
 *   4. The task-just-completed marker file exists
 *
 * If any precondition fails in Phase 2: no-op. The marker stays in place for
 * a future Stop-hook invocation, or is cleaned up on session-end.
 *
 * Rollback: set config.taskBoundaryReset.enabled = false. Phase 1 still writes
 * the marker (cheap, harmless); Phase 2 no-ops. No state-file corruption.
 */

const fs = require('node:fs');
const path = require('node:path');

const { getConfig, PATHS } = require('../../flow-utils');

const PENDING_MARKER_FILE = 'task-just-completed';

/**
 * Locate the pending-marker file path inside .workflow/state/.
 * @returns {string}
 */
function getPendingMarkerPath() {
  return path.join(PATHS.state, PENDING_MARKER_FILE);
}

/**
 * Phase 1 — mark that a task just completed and a restart is desired at the
 * next Stop-hook boundary. Safe to call even when the feature is disabled;
 * Phase 2 is what checks the config.
 *
 * @param {Object} ctx
 * @param {string} ctx.taskId
 * @param {string} [ctx.taskTitle]
 * @param {string} [ctx.source]   where the call came from, for telemetry
 * @returns {{ marked: boolean, markerPath?: string, reason?: string }}
 */
function markRestartPending(ctx) {
  try {
    const markerPath = getPendingMarkerPath();
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    const payload = {
      version: 1,
      taskId: ctx?.taskId || null,
      taskTitle: ctx?.taskTitle || null,
      source: ctx?.source || 'unspecified',
      markedAt: new Date().toISOString()
    };
    fs.writeFileSync(markerPath, JSON.stringify(payload, null, 2));
    return { marked: true, markerPath };
  } catch (err) {
    return { marked: false, reason: `marker-write-failed: ${err.message}` };
  }
}

/**
 * Check whether the Phase-2 preconditions hold.
 * @returns {{ ready: boolean, reason?: string, flagPath?: string, parentPid?: number }}
 */
function checkPreconditions() {
  try {
    const config = getConfig();
    const tbr = config.taskBoundaryReset || {};
    if (tbr.enabled !== true) {
      return { ready: false, reason: 'disabled-by-config' };
    }

    const wrapperPid = process.env.WOGI_WRAPPER_PID;
    if (!wrapperPid) {
      return { ready: false, reason: 'no-wrapper-pid' };
    }

    const flagPath = process.env.WOGI_RESTART_FLAG;
    if (!flagPath) {
      return { ready: false, reason: 'no-flag-path' };
    }

    const parentPid = process.ppid;
    if (!parentPid || typeof parentPid !== 'number') {
      return { ready: false, reason: 'no-parent-pid' };
    }

    return { ready: true, flagPath, parentPid };
  } catch (err) {
    return { ready: false, reason: `config-error: ${err.message}` };
  }
}

/**
 * Phase 2 — called by the Stop hook entry (direct child of claude). If
 * preconditions pass AND the pending marker exists, consume the marker, write
 * the wrapper flag, and SIGTERM claude. Wrapper restarts.
 *
 * Returns a result object for diagnostics; never throws. If something goes
 * wrong, the Stop hook should continue with its normal flow.
 *
 * @returns {{ triggered: boolean, reason?: string, flagPath?: string, parentPid?: number }}
 */
function consumeAndTriggerRestart() {
  const markerPath = getPendingMarkerPath();
  if (!fs.existsSync(markerPath)) {
    return { triggered: false, reason: 'no-pending-marker' };
  }

  // Defer restart when the AI has a pending question for the user
  // (wf-729ab5c0 follow-up / pending-question safety).
  // The marker STAYS — we'll try again next Stop hook after user responds.
  try {
    const { hasPendingQuestion } = require('../../flow-ask');
    if (hasPendingQuestion()) {
      return { triggered: false, reason: 'pending-question-deferred' };
    }
  } catch (_err) { /* flow-ask may not be present in older installs; degrade open */ }

  const pre = checkPreconditions();
  if (!pre.ready) {
    if (process.env.DEBUG) {
      console.error(`[task-boundary-reset] phase-2 skip: ${pre.reason}`);
    }
    return { triggered: false, reason: pre.reason };
  }

  // Consume the marker. Do this BEFORE signaling so we never double-fire if
  // for some reason the signal delivery is delayed and a second Stop-hook
  // invocation races through.
  let markerPayload = null;
  try {
    markerPayload = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
  } catch (_err) { /* payload read is optional */ }
  try {
    fs.unlinkSync(markerPath);
  } catch (err) {
    // If we can't even delete the marker, something is wrong with the
    // filesystem. Abort before signaling so we don't cause a thrash.
    return { triggered: false, reason: `marker-unlink-failed: ${err.message}` };
  }

  // Write the wrapper's restart-requested flag with a copy of the marker
  // payload for diagnostic context.
  const flagPayload = {
    version: 1,
    reason: 'task-boundary',
    ...(markerPayload || {}),
    triggeredAt: new Date().toISOString(),
    wrapperPid: process.env.WOGI_WRAPPER_PID
  };
  try {
    const dir = path.dirname(pre.flagPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pre.flagPath, JSON.stringify(flagPayload, null, 2));
  } catch (err) {
    return { triggered: false, reason: `flag-write-failed: ${err.message}` };
  }

  // SIGTERM our parent (claude). The wrapper sees the flag on claude's exit
  // and restarts. If SIGTERM turns out to not shut claude down cleanly in
  // real testing, try SIGHUP or SIGINT as fallbacks (see spec wf-39e9dc09).
  try {
    process.kill(pre.parentPid, 'SIGTERM');
  } catch (err) {
    // Kill failed — clean up the flag so the wrapper doesn't try to restart
    // a claude that is still alive and may produce more output.
    try { fs.unlinkSync(pre.flagPath); } catch (_err) { /* best effort */ }
    return { triggered: false, reason: `sigterm-failed: ${err.message}` };
  }

  return {
    triggered: true,
    flagPath: pre.flagPath,
    parentPid: pre.parentPid
  };
}

/**
 * Convenience: whether a pending marker currently exists. Diagnostic only.
 * @returns {boolean}
 */
function hasPendingMarker() {
  try {
    return fs.existsSync(getPendingMarkerPath());
  } catch (_err) {
    return false;
  }
}

module.exports = {
  // Phase 1 — called from task-completion code paths
  markRestartPending,

  // Phase 2 — called from the Stop hook entry
  consumeAndTriggerRestart,

  // Diagnostics
  checkPreconditions,
  hasPendingMarker,
  getPendingMarkerPath,

  // Back-compat: earlier code calls this name. Route it to Phase 1 so existing
  // wiring in task-completed.js still does the right thing (mark the marker,
  // don't SIGTERM yet). A later refactor can remove this alias.
  maybeTriggerRestart: markRestartPending
};

// CLI smoke-check: `node scripts/hooks/core/task-boundary-reset.js <cmd>`
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === 'check') {
    console.log(JSON.stringify(checkPreconditions(), null, 2));
    process.exit(0);
  }
  if (arg === 'has-pending') {
    console.log(JSON.stringify({ hasPendingMarker: hasPendingMarker() }, null, 2));
    process.exit(0);
  }
  if (arg === 'mark') {
    console.log(JSON.stringify(markRestartPending({ source: 'cli-test' }), null, 2));
    process.exit(0);
  }
  if (arg === 'consume') {
    console.log(JSON.stringify(consumeAndTriggerRestart(), null, 2));
    process.exit(0);
  }
  console.log('Usage: node task-boundary-reset.js <check|has-pending|mark|consume>');
  process.exit(2);
}
