'use strict';

/**
 * Task-boundary restart coordinator (wf-6e31850e A-3 / extracted from stop.js).
 *
 * Coordinates session restart at task boundary. Calls into
 * task-boundary-reset for the actual SIGTERM, but handles the surrounding
 * concerns: Phase 1 fallback marking, session-history recording.
 *
 * Returns `{ shouldReturn: true, result: {...} }` when the entry should
 * short-circuit; otherwise `null` to continue.
 */

async function handleTaskBoundaryRestart({ parsedInput }) {
  try {
    const {
      consumeAndTriggerRestart,
      hasPendingMarker,
      ensurePhase1MarkedIfRecentlyCompleted
    } = require('./task-boundary-reset');

    // Phase 1 fallback
    try {
      const fallback = ensurePhase1MarkedIfRecentlyCompleted();
      if (fallback.marked && process.env.DEBUG) {
        console.error(`[Stop] Phase 1 fallback marked ${fallback.taskId}`);
      } else if (!fallback.marked && fallback.reason !== 'marker-already-present' &&
                 fallback.reason !== 'no-fresh-completion' &&
                 fallback.reason !== 'stale-completion' &&
                 fallback.reason !== 'already-triggered-for-this-task' &&
                 process.env.DEBUG) {
        console.error(`[Stop] Phase 1 fallback skipped: ${fallback.reason}`);
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Stop] Phase 1 fallback error (fail-open): ${err.message}`);
    }

    if (hasPendingMarker()) {
      try {
        const { recordSessionEnd } = require('./session-history');
        let cliSessionId = parsedInput?.sessionId || null;
        if (!cliSessionId) {
          const { PATHS, safeJsonParse } = require('../../flow-utils');
          const path = require('node:path');
          const ss = safeJsonParse(path.join(PATHS.state, 'session-state.json'), {});
          cliSessionId = ss.cliSessionId || null;
        }
        if (cliSessionId) {
          const { PATHS, safeJsonParse } = require('../../flow-utils');
          const path = require('node:path');
          const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), {});
          const recent = ready.recentlyCompleted || [];
          const lastCompleted = recent[0] || null;
          recordSessionEnd({
            cliSessionId,
            endReason: 'task-boundary-restart',
            tasksCompletedInSession: recent.slice(0, 5).map(t => t.id).filter(Boolean),
            lastActiveTaskTitle: lastCompleted?.title || null
          });
        }
      } catch (err) {
        if (process.env.DEBUG) console.error(`[Stop] Session history record failed (non-fatal): ${err.message}`);
      }
    }

    const restartResult = await consumeAndTriggerRestart({
      transcriptPath: parsedInput?.transcriptPath
    });
    if (restartResult.triggered) {
      if (process.env.DEBUG) {
        console.error(`[Stop] Task-boundary restart triggered — claude will exit, wrapper will relaunch`);
      }
      return { shouldReturn: true, result: { __raw: true, continue: false } };
    }
    if (restartResult.reason !== 'no-pending-marker' && process.env.DEBUG) {
      console.error(`[Stop] Task-boundary restart check: ${restartResult.reason}`);
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] Task-boundary restart module error (fail-open): ${err.message}`);
  }
  return null;
}

module.exports = { handleTaskBoundaryRestart };
