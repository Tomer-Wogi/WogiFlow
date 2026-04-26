#!/usr/bin/env node

/**
 * Wogi Flow — Autonomous Walk-Away Mode Orchestrator (Story C / wf-d712002e)
 *
 * Thin composition layer that ties together:
 *   - flow-autonomous-detector  (NL trigger detection)
 *   - flow-session-state         (disk-canonical activation flag)
 *   - flow-question-queue        (queued questions + skipped tasks)
 *   - flow-completion-summary    (terminal + JSON output)
 *
 * Responsibilities live in the underlying modules — this file only
 * wires them. Hot-path hooks (PreToolUse) should NOT import this file;
 * they should read the cache directly via flow-session-state.
 *
 * Programmatic:
 *   const am = require('./flow-autonomous-mode');
 *   const r = am.maybeActivateFromMessage(userMessage);
 *   if (am.shouldDeactivate(userMessage)) am.finalize({ endReason: 'user-interrupt' });
 *   am.finalize({ endReason: 'queue-drained' });
 */

const detector = require('./flow-autonomous-detector');
const sessionState = require('./flow-session-state');
const queue = require('./flow-question-queue');
const completionSummary = require('./flow-completion-summary');

/**
 * Inspect a user message and activate autonomous mode if it matches a
 * trigger phrase. No-op when already active. Returns the activation record
 * (or `null` when no trigger).
 */
function maybeActivateFromMessage(message) {
  if (sessionState.isAutonomousActive()) return sessionState.getAutonomousMode();
  const r = detector.detect(message);
  if (!r.autonomous) return null;
  return sessionState.activateAutonomousMode({ trigger: r.trigger });
}

/**
 * Check whether a user message should deactivate the active run
 * (stop/pause/cancel etc.). Returns false when no autonomous run is
 * active, regardless of message content.
 */
function shouldDeactivate(message) {
  if (!sessionState.isAutonomousActive()) return false;
  return detector.detectStop(message);
}

/**
 * Render the completion summary, persist the JSON payload, then clear
 * autonomous-mode state (cache + disk). The queue itself is preserved so
 * the user can resolve queued questions in a later session — only the
 * autonomous flag is cleared.
 *
 * @param {object} input
 * @param {string} input.endReason - queue-drained | user-interrupt | fatal-error
 * @param {Array} [input.completed]
 */
function finalize({ endReason = 'queue-drained', completed = [] } = {}) {
  const mode = sessionState.getAutonomousMode();
  const queueData = queue.loadQueue();
  const startedAt = mode?.activatedAt || new Date().toISOString();
  const adv = mode?.adversaryInvocations || { used: 0 };
  const cap = sessionState.getAutonomousConfig().maxAdversaryInvocations;
  const result = completionSummary.renderSummary({
    runId: mode?.runId || `auto-finalize-${Date.now().toString(36)}`,
    startedAt,
    trigger: mode?.trigger || 'unspecified',
    completed,
    queuedQuestions: queueData.questions.filter(q => !q.answered),
    skippedTasks: queueData.skippedTasks,
    adversaryInvocations: { used: adv.used || 0, cap, breakdown: adv.breakdown || {} },
    endReason
  });

  // Story B / wf-ab59f0e4: when the worker finalizes an autonomous run in
  // workspace worker mode, post the COMPLETION-SUMMARY message to the
  // manager channel. Best-effort — the run already finalized locally; if
  // the manager is unreachable, the summary file on disk is still
  // recoverable and the worker can be re-dispatched later.
  if (process.env.WOGI_WORKSPACE_ROOT && process.env.WOGI_REPO_NAME && process.env.WOGI_REPO_NAME !== 'manager') {
    try {
      postSummaryToManager(result.payload);
      result.posted = true;
    } catch (err) {
      result.posted = false;
      result.postError = err.message;
    }
  }

  if (mode) sessionState.deactivateAutonomousMode();
  return result;
}

/**
 * POST one or more COMPLETION-SUMMARY lines to the manager's channel-dispatch
 * HTTP bus. Synchronous + best-effort — finalize() must not throw if the
 * manager is unreachable.
 */
function postSummaryToManager(payload) {
  const { execFileSync } = require('node:child_process');
  const ws = require('./flow-workspace-summary');
  const taskId = payload.completed?.[0]?.taskId || 'unknown';
  const enriched = { ...payload, workerId: process.env.WOGI_REPO_NAME };
  const lines = ws.encodeMessage(enriched);
  const port = process.env.WOGI_MANAGER_PORT || '8800';
  const repo = process.env.WOGI_REPO_NAME;
  for (const line of lines) {
    execFileSync('curl', [
      '-s', '-X', 'POST',
      `http://127.0.0.1:${port}`,
      '-H', `X-Wogi-From: ${repo}`,
      '-H', `X-Wogi-TaskId: ${taskId}`,
      '--data-binary', line
    ], { stdio: 'ignore', timeout: 5000 });
  }
}

module.exports = {
  maybeActivateFromMessage,
  shouldDeactivate,
  finalize
};

if (require.main === module) {
  const [,, cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'activate': {
      const msg = rest.join(' ');
      const r = maybeActivateFromMessage(msg);
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case 'finalize': {
      const r = finalize({ endReason: rest[0] || 'queue-drained' });
      console.log(r.terminal);
      if (r.jsonPath) console.log(`\nJSON written: ${r.jsonPath}`);
      break;
    }
    case 'status': {
      const mode = sessionState.getAutonomousMode();
      console.log(JSON.stringify({
        active: sessionState.isAutonomousActive(),
        mode,
        config: sessionState.getAutonomousConfig()
      }, null, 2));
      break;
    }
    default:
      console.log('Usage: flow-autonomous-mode <activate "<msg>"|finalize <reason>|status>');
  }
}
