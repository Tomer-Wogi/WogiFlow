'use strict';

/**
 * Workspace Stop-hook gates (wf-6e31850e A-3 / extracted from stop.js).
 *
 * Three gates in sequence, all fail-open:
 *   1. Gap B — block end-of-turn when worker has queued dispatches but no
 *      task in progress.
 *   2. Worker Tool-First Turn Gate (G1+G4+G6) — every worker turn after a
 *      UserPromptSubmit must contain at least one tool call.
 *   3. AI Worker Question Classifier (G3) — Haiku classifier blocks
 *      turns ending with an open user-facing question in worker mode.
 *
 * Returns `{ shouldReturn: true, result: {...} }` to short-circuit, or null.
 */

async function checkWorkspaceStopGates({ parsedInput }) {
  // Gap B
  try {
    const isWorker = process.env.WOGI_WORKSPACE_ROOT &&
                     process.env.WOGI_REPO_NAME &&
                     process.env.WOGI_REPO_NAME !== 'manager';
    if (isWorker) {
      const { getConfig, PATHS, safeJsonParse } = require('../../flow-utils');
      const path = require('node:path');
      const config = getConfig();
      const gateEnabled = config.workspace?.autoPickupChannelDispatches !== false;
      if (gateEnabled) {
        const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), { ready: [], inProgress: [] });
        const inProgressCount = (ready.inProgress || []).length;
        const queued = (ready.ready || []).filter(t => {
          if (!t || typeof t !== 'object') return false;
          return t.channelSource === 'wogi-workspace-channel' ||
                 t.dispatchedBy === 'workspace-manager' ||
                 (typeof t.source === 'string' && t.source.startsWith('workspace:'));
        });
        if (inProgressCount === 0 && queued.length > 0) {
          const nextId = queued[0].id;
          const msg = [
            `AUTONOMOUS MODE VIOLATION: ${queued.length} channel dispatch(es) queued, no task in progress.`,
            '',
            `You are a workspace worker — "awaiting your signal" / "let me know" / "or will proceed" is NOT a valid terminal state.`,
            '',
            'Exactly one of these must be true at end-of-turn:',
            '  (a) You started the next pre-approved dispatch (ACTION), or',
            '  (b) You channel-dispatched a "## QUESTION:" to manager (ESCALATION), or',
            '  (c) Zero queued and zero in-progress (IDLE — not your current state).',
            '',
            `ACT NOW: Invoke Skill(skill="wogi-start", args="${nextId}")`,
            '',
            `Or escalate: curl -s -X POST http://127.0.0.1:${process.env.WOGI_MANAGER_PORT || '8800'} \\`,
            `  -H "X-Wogi-From: ${process.env.WOGI_REPO_NAME}" \\`,
            `  --data-binary "## QUESTION: <your blocker>"`
          ].join('\n');
          return { shouldReturn: true, result: { __raw: true, continue: true, stopReason: msg } };
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] Workspace autopickup gate error (fail-open): ${err.message}`);
  }

  // In-Progress Continuation Gate (S2 / wf-aee4a4fa) — the core sustained-
  // execution fix. Gap B (above) handles NOT-STARTED dispatches; this handles
  // an IN-PROGRESS decomposed task with sub-tasks remaining. Keeps the SAME
  // session grinding via {continue:true} instead of going idle after one turn.
  try {
    const { checkWorkerContinuation } = require('./worker-continuation-gate');
    const { getConfig } = require('../../flow-utils');
    const result = checkWorkerContinuation({ config: getConfig() });
    if (result?.fired && result.stopReason) {
      // S3: emit a worker-progress heartbeat (NOT a terminal stop) so the
      // manager sees ongoing work and refreshes the dispatch deadline.
      try {
        const { notifyWorkerProgress } = require('./workspace-stop-notify');
        await notifyWorkerProgress({ taskId: result.taskId, remaining: result.remaining, total: result.total, attempt: result.attempt });
      } catch (_err) { /* best effort */ }
      return { shouldReturn: true, result: { __raw: true, continue: true, stopReason: result.stopReason } };
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] Worker continuation gate error (fail-open): ${err.message}`);
  }

  // Worker Tool-First Turn Gate
  try {
    const { isWorkerMode, checkWorkerToolFirstTurn, renderBlockMessage } = require('./worker-tool-first-gate');
    if (isWorkerMode() && parsedInput?.transcriptPath) {
      const { getConfig } = require('../../flow-utils');
      const config = getConfig();
      const gateCfg = config.workspace?.toolFirstTurnGate;
      const enabled = gateCfg?.enabled !== false;
      if (enabled) {
        const strict = gateCfg?.strict !== false;
        const result = checkWorkerToolFirstTurn({ transcriptPath: parsedInput.transcriptPath, strict });
        if (result.blocked) {
          return { shouldReturn: true, result: { __raw: true, continue: true, stopReason: renderBlockMessage(result) } };
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] Worker tool-first gate error (fail-open): ${err.message}`);
  }

  // AI Worker Question Classifier
  try {
    const isWorker = process.env.WOGI_WORKSPACE_ROOT &&
                     process.env.WOGI_REPO_NAME &&
                     process.env.WOGI_REPO_NAME !== 'manager';
    if (isWorker) {
      const { getConfig } = require('../../flow-utils');
      const config = getConfig();
      const clf = config.workspace?.aiWorkerQuestionClassifier;
      const enabled = clf?.enabled !== false;
      if (enabled && parsedInput?.transcriptPath) {
        const { classifyWorkerQuestion } = require('../../flow-worker-question-classifier');
        const result = await classifyWorkerQuestion({
          transcriptPath: parsedInput.transcriptPath,
          minConfidence: Number.isFinite(clf?.minConfidence) ? clf.minConfidence : 70,
          model: typeof clf?.model === 'string' ? clf.model : undefined
        });
        if (result?.blocked) {
          const port = process.env.WOGI_MANAGER_PORT || '8800';
          const repo = process.env.WOGI_REPO_NAME;
          const msg = [
            `WORKER→USER QUESTION DETECTED (confidence ${result.confidence}%, threshold ${result.minConfidence}%):`,
            `  "${String(result.reason || '').slice(0, 200)}"`,
            '',
            'In workspace mode, workers CANNOT ask the user directly — the user only sees',
            'the manager terminal. Your question will stall silently.',
            '',
            'Channel-dispatch to the manager instead, THEN end the turn:',
            '',
            `  curl -s -X POST http://127.0.0.1:${port} \\`,
            `    -H "X-Wogi-From: ${repo}" \\`,
            `    --data-binary "## QUESTION: <your question>"`,
            '',
            'The manager will relay to the user, capture the answer, and dispatch a',
            'follow-up task to you with the resolved context.',
            '',
            'If you don\'t actually need the user — make a reasonable autonomous decision',
            'and note it in your ## Results reply to the manager. Then end the turn.'
          ].join('\n');
          return { shouldReturn: true, result: { __raw: true, continue: true, stopReason: msg } };
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] Worker question classifier error (fail-open): ${err.message}`);
  }

  return null;
}

module.exports = { checkWorkspaceStopGates };
