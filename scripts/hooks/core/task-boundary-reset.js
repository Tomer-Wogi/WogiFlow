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
const { safeJsonParse } = require('../../flow-io');

const PENDING_MARKER_FILE = 'task-just-completed';
const LAST_TRIGGERED_FILE = 'task-boundary-last-triggered';
// Window during which a recentlyCompleted[0] entry is considered "fresh
// enough" to retro-mark Phase 1 from the Stop hook. Large enough to cover
// a slow quality-gate run; small enough that a session opened hours later
// doesn't trigger a bogus restart.
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Locate the pending-marker file path inside .workflow/state/.
 * @returns {string}
 */
function getPendingMarkerPath() {
  return path.join(PATHS.state, PENDING_MARKER_FILE);
}

function getLastTriggeredPath() {
  return path.join(PATHS.state, LAST_TRIGGERED_FILE);
}

function readLastTriggered() {
  try {
    return safeJsonParse(getLastTriggeredPath(), null);
  } catch (_err) {
    return null;
  }
}

function writeLastTriggered(taskId) {
  try {
    const p = getLastTriggeredPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ taskId, at: new Date().toISOString() }));
  } catch (_err) { /* best effort — anti-replay is defense-in-depth */ }
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
 * @param {Object} [opts]
 * @param {string} [opts.transcriptPath] - Claude Code transcript path, used by
 *   the main-mode question classifier safety net. When absent, the classifier
 *   step is skipped (fail-open).
 * @returns {Promise<{ triggered: boolean, reason?: string, flagPath?: string, parentPid?: number }>}
 */
async function consumeAndTriggerRestart(opts = {}) {
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

  // Main-mode question classifier safety net (wf-191d5f6e). Catches the case
  // where the AI ends a turn with an open user-facing question but forgot to
  // call `flow ask` first. On a YES classification, auto-write the
  // pending-question marker and defer the restart. Fail-open throughout —
  // any error or skip falls through to normal restart logic.
  try {
    const isWorker = process.env.WOGI_WORKSPACE_ROOT &&
                     process.env.WOGI_REPO_NAME &&
                     process.env.WOGI_REPO_NAME !== 'manager';
    if (!isWorker) {
      const config = getConfig();
      const clf = config.mainModeQuestionClassifier;
      const enabled = clf?.enabled !== false;  // default true
      if (enabled && opts.transcriptPath) {
        const { classifyQuestion } = require('../../flow-worker-question-classifier');
        const result = await classifyQuestion({
          mode: 'main',
          transcriptPath: opts.transcriptPath,
          minConfidence: Number.isFinite(clf?.minConfidence) ? clf.minConfidence : 70,
          model: typeof clf?.model === 'string' ? clf.model : undefined
        });
        if (result?.blocked) {
          try {
            const { markQuestionPending } = require('../../flow-ask');
            markQuestionPending(`auto-deferred: ${String(result.reason || 'classifier detected open question').slice(0, 500)}`);
          } catch (_err) { /* best effort — marker write failure falls through to restart */ }
          return { triggered: false, reason: 'auto-deferred-question-detected' };
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[task-boundary-reset] main-mode classifier error (fail-open): ${err.message}`);
    }
  }

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
  const markerPayload = safeJsonParse(markerPath, null);
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

  // Record anti-replay sentinel so the Stop-hook fallback in the NEW session
  // (post-restart) doesn't retro-mark the same recentlyCompleted[0] and
  // trigger a second restart.
  if (markerPayload?.taskId) {
    writeLastTriggered(markerPayload.taskId);
  }

  return {
    triggered: true,
    flagPath: pre.flagPath,
    parentPid: pre.parentPid
  };
}

/**
 * Phase 1 fallback — called from the Stop hook BEFORE
 * consumeAndTriggerRestart. Detects a freshly-completed task in
 * recentlyCompleted and writes the pending marker if neither of the primary
 * Phase 1 paths fired.
 *
 * Why this exists: the primary Phase 1 writers are (a) flow-done.js:604 when
 * `flow done <taskId>` runs, and (b) task-completed.js:522 driven by Claude
 * Code's TaskCompleted hook. Path (b) does not fire for /wogi-start workflow
 * completions (TaskCompleted fires for Task-tool sub-agents only — the reason
 * for the two-phase redesign above). Path (a) only fires if the agent runs
 * `flow done`. Older phase docs quietly encouraged "move task to
 * recentlyCompleted in ready.json" as a substitute for `flow done`, which
 * silently disables the restart. This fallback catches that case: if a fresh
 * completion is visible in ready.json but no marker exists, we write one so
 * Phase 2 can do its job.
 *
 * Anti-replay: recentlyCompleted[0] survives the SIGTERM + wrapper restart
 * cycle, so without a guard the Stop hook in the NEW session would see the
 * same fresh completion and trigger a second restart. The
 * task-boundary-last-triggered sentinel prevents that — it records the last
 * taskId we triggered on, and we skip if the current fresh completion
 * matches.
 *
 * @returns {{ marked: boolean, taskId?: string, reason?: string }}
 */
function ensurePhase1MarkedIfRecentlyCompleted() {
  try {
    if (hasPendingMarker()) {
      return { marked: false, reason: 'marker-already-present' };
    }

    const readyPath = path.join(PATHS.state, 'ready.json');
    const ready = safeJsonParse(readyPath, null);
    const recent = ready && Array.isArray(ready.recentlyCompleted)
      ? ready.recentlyCompleted[0]
      : null;
    if (!recent || typeof recent !== 'object' || !recent.id || !recent.completedAt) {
      return { marked: false, reason: 'no-fresh-completion' };
    }

    const completedTs = new Date(recent.completedAt).getTime();
    if (!Number.isFinite(completedTs)) {
      return { marked: false, reason: 'unparseable-completedAt' };
    }
    const ageMs = Date.now() - completedTs;
    if (ageMs < 0 || ageMs > FRESHNESS_WINDOW_MS) {
      return { marked: false, reason: 'stale-completion' };
    }

    const lastTriggered = readLastTriggered();
    if (lastTriggered?.taskId === recent.id) {
      return { marked: false, reason: 'already-triggered-for-this-task' };
    }

    const result = markRestartPending({
      taskId: recent.id,
      taskTitle: recent.title,
      source: 'stop-hook-fallback'
    });
    return { marked: result.marked, taskId: recent.id, reason: result.reason };
  } catch (err) {
    return { marked: false, reason: `fallback-error: ${err.message}` };
  }
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

  // Phase 1 fallback — called from the Stop hook entry BEFORE Phase 2,
  // catches the case where flow-done didn't run and TaskCompleted didn't fire
  ensurePhase1MarkedIfRecentlyCompleted,

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
    consumeAndTriggerRestart().then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    }).catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
    return;
  }
  console.log('Usage: node task-boundary-reset.js <check|has-pending|mark|consume>');
  process.exit(2);
}
