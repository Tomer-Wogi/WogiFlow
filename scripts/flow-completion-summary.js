#!/usr/bin/env node

/**
 * Wogi Flow — Autonomous-Run Completion Summary (Story C / wf-d712002e)
 *
 * Renders the end-of-run summary for autonomous walk-away mode in two
 * formats:
 *   1. Human-readable terminal block (always 3 sections: completed,
 *      queued, skipped — empty-state placeholders rendered explicitly per
 *      decisions.md 2026-04-23 "vanishing-section" rule).
 *   2. Structured JSON payload at
 *      .workflow/state/autonomous-run-summary-<runId>.json that Story B can
 *      base64-wrap into a single-line channel-dispatch message.
 *
 * Programmatic:
 *   const cs = require('./flow-completion-summary');
 *   const { terminal, jsonPath } = cs.renderSummary({ runId, ... });
 *   cs.writeJsonPayload(payload);  // returns the path written
 */

const path = require('node:path');
const { PATHS } = require('./flow-paths');
const { writeJson } = require('./flow-io');
// CL-006 (2026-04-26): consolidated formatDuration to flow-time-format.
const { formatDuration } = require('./flow-time-format');

const SEP = '━'.repeat(58);

function summaryPath(runId) {
  return path.join(PATHS.state, `autonomous-run-summary-${runId}.json`);
}

/**
 * Build the full payload object — used for both terminal render and
 * persisted JSON. Caller passes raw collected data; this normalizes shape.
 *
 * @param {object} input
 * @param {string} input.runId
 * @param {string} input.startedAt
 * @param {string} [input.endedAt]
 * @param {string} input.trigger
 * @param {Array<{taskId:string,title:string}>} [input.completed]
 * @param {Array<object>} [input.queuedQuestions]
 * @param {Array<object>} [input.skippedTasks]
 * @param {{used:number,cap:number,breakdown?:object}} [input.adversaryInvocations]
 * @param {string} [input.endReason] - queue-drained | user-interrupt | fatal-error
 */
function buildPayload(input) {
  const endedAt = input.endedAt || new Date().toISOString();
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    endedAt,
    trigger: input.trigger || 'unspecified',
    completed: Array.isArray(input.completed) ? input.completed : [],
    queuedQuestions: Array.isArray(input.queuedQuestions) ? input.queuedQuestions : [],
    skippedTasks: Array.isArray(input.skippedTasks) ? input.skippedTasks : [],
    adversaryInvocations: {
      used: input.adversaryInvocations?.used ?? 0,
      cap: input.adversaryInvocations?.cap ?? 0,
      breakdown: input.adversaryInvocations?.breakdown || {}
    },
    endReason: input.endReason || 'queue-drained'
  };
}

function renderTerminal(payload) {
  const lines = [];
  lines.push(SEP);
  lines.push(`AUTONOMOUS RUN COMPLETE (runId: ${payload.runId}, duration: ${formatDuration(payload.startedAt, payload.endedAt)})`);
  lines.push(SEP);
  lines.push('');

  lines.push(`✓ Completed (${payload.completed.length} tasks):`);
  if (payload.completed.length === 0) {
    lines.push('  [none]');
  } else {
    for (const t of payload.completed) {
      lines.push(`  - ${t.taskId}: ${t.title || '(no title)'}`);
    }
  }
  lines.push('');

  lines.push(`? Queued questions (${payload.queuedQuestions.length}):`);
  if (payload.queuedQuestions.length === 0) {
    lines.push('  [none]');
  } else {
    for (const q of payload.queuedQuestions) {
      const blockers = Array.isArray(q.dependencies) && q.dependencies.length
        ? ` (blocks: ${q.dependencies.join(', ')})`
        : '';
      lines.push(`  - ${q.id}: ${q.text}${blockers}`);
    }
  }
  lines.push('');

  lines.push(`⊘ Skipped tasks (${payload.skippedTasks.length}):`);
  if (payload.skippedTasks.length === 0) {
    lines.push('  [none]');
  } else {
    for (const s of payload.skippedTasks) {
      const ref = s.blockingQuestionId ? ` (awaiting answer to ${s.blockingQuestionId})` : '';
      lines.push(`  - ${s.taskId}: ${s.reason}${ref}`);
    }
  }
  lines.push('');

  lines.push(`⚡ Adversary invocations: ${payload.adversaryInvocations.used} / ${payload.adversaryInvocations.cap} (cap)`);
  lines.push(`  reason: ${payload.endReason}`);
  lines.push(SEP);
  return lines.join('\n');
}

/**
 * Persist the JSON payload to .workflow/state/autonomous-run-summary-<runId>.json.
 * Returns the absolute path written.
 */
function writeJsonPayload(payload) {
  const p = summaryPath(payload.runId);
  writeJson(p, payload);
  return p;
}

function renderSummary(input, { writeJson: write = true } = {}) {
  const payload = buildPayload(input);
  const terminal = renderTerminal(payload);
  let jsonPath = null;
  if (write) {
    jsonPath = writeJsonPayload(payload);
  }
  return { payload, terminal, jsonPath };
}

module.exports = {
  buildPayload,
  renderTerminal,
  writeJsonPayload,
  renderSummary,
  summaryPath
};

if (require.main === module) {
  const sample = {
    runId: 'sample',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    trigger: 'go until you finish',
    completed: [
      { taskId: 'wf-aaaaaaaa', title: 'Add team-id to API' },
      { taskId: 'wf-bbbbbbbb', title: 'Update changelog' }
    ],
    queuedQuestions: [
      { id: 'q-12345678', text: 'Should admins be charged?', dependencies: ['wf-cccccccc'] }
    ],
    skippedTasks: [
      { taskId: 'wf-cccccccc', reason: 'awaiting answer', blockingQuestionId: 'q-12345678' }
    ],
    adversaryInvocations: { used: 4, cap: 30 },
    endReason: 'queue-drained'
  };
  const { terminal } = renderSummary(sample, { writeJson: false });
  console.log(terminal);
}
