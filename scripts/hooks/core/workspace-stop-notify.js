'use strict';

/**
 * Workspace worker signal emission (epic-workspace-sustained-exec / S3, wf-d3ae1717;
 * originally wf-6e31850e A-3 / wf-d3e67abe).
 *
 * Two distinct signals so the manager never mistakes a pause for a stop:
 *
 *   notifyWorkerProgress() — a HEARTBEAT, emitted when the continuation gate (S2)
 *     forces the worker to keep going. "Work ongoing," NOT a stop. Carries the
 *     current sub-task progress + git HEAD so the manager can refresh the
 *     dispatch deadline instead of polling git.
 *
 *   notifyWorkerTerminal() — emitted ONLY on a genuine stop (after all gates
 *     decline to continue). Picks a precise terminal type:
 *       worker-awaiting-approval — in-progress task sitting in spec_review/exploring
 *                                  (waiting on the manager's GO — NOT done)
 *       worker-stopped           — in-progress, active phase, but stopping anyway
 *                                  (legacy mid-work stop)
 *       worker-idle              — nothing in progress and nothing queued
 *
 * The old code emitted `worker-stopped` UNCONDITIONALLY at the top of the Stop
 * sequence — before the gates ran — so the manager saw "stopped mid-work" on
 * every turn boundary, even when the worker was about to be forced to continue.
 * That ordering bug is fixed: emission now happens at the decision point.
 *
 * All emission is best-effort and fail-open; never throws into the Stop path.
 */

const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const AWAITING_PHASES = new Set(['spec_review', 'exploring', 'routing', 'idle']);

function isWorker() {
  return Boolean(process.env.WOGI_REPO_NAME &&
    process.env.WOGI_REPO_NAME !== 'manager' &&
    VALID_NAME.test(process.env.WOGI_REPO_NAME) &&
    process.env.WOGI_WORKSPACE_ROOT);
}

function readState() {
  const nodePath = require('node:path');
  const { PATHS, safeJsonParse } = require('../../flow-utils');
  const ready = safeJsonParse(nodePath.join(PATHS.state, 'ready.json'), {});
  const phaseData = safeJsonParse(nodePath.join(PATHS.state, 'workflow-phase.json'), {});
  const inProgressTask = (ready.inProgress || [])[0] || null;
  const queued = (ready.ready || []).length;
  let lastSha = null;
  try {
    lastSha = require('node:child_process').execSync('git rev-parse --short HEAD 2>/dev/null || true', {
      cwd: PATHS.root, encoding: 'utf-8', timeout: 2000
    }).trim() || null;
  } catch (_err) { /* non-critical */ }
  return { inProgressTask, queued, phase: phaseData?.phase || null, lastSha };
}

function emit(type, fields) {
  const nodePath = require('node:path');
  const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;
  const repoName = process.env.WOGI_REPO_NAME;
  const libMessages = nodePath.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-messages');
  const { createMessage, saveMessage } = require(libMessages);
  const msg = createMessage({
    from: repoName,
    to: 'manager',
    type,
    subject: fields.subject,
    body: fields.body,
    priority: fields.priority || 'medium',
    actionRequired: Boolean(fields.actionRequired)
  });
  Object.assign(msg, fields.extra || {});
  saveMessage(workspaceRoot, msg);

  // Real-time nudge to the manager port (best-effort) so it doesn't have to wait
  // for its own next prompt to read the bus.
  try {
    const managerPort = process.env.WOGI_MANAGER_PORT;
    if (managerPort) {
      const http = require('node:http');
      const payload = `[${type}] ${fields.subject}`;
      const buf = Buffer.from(payload, 'utf-8');
      const req = http.request({
        hostname: '127.0.0.1', port: parseInt(managerPort, 10), path: '/', method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': buf.byteLength, 'X-Wogi-From': repoName }
      });
      req.on('error', () => {});
      req.write(buf); req.end();
    }
  } catch (_err) { /* best effort */ }
}

/**
 * Heartbeat — the continuation gate forced another turn. NOT a stop.
 * @param {Object} info { taskId, remaining, total, attempt }
 */
async function notifyWorkerProgress(info = {}) {
  if (!isWorker()) return;
  try {
    const { lastSha } = readState();
    emit('worker-progress', {
      subject: `Worker ${process.env.WOGI_REPO_NAME} working on ${info.taskId || 'task'} (${info.remaining ?? '?'} sub-task(s) left)`,
      body: [
        `Worker "${process.env.WOGI_REPO_NAME}" is continuing (heartbeat).`,
        info.taskId ? `Task: ${info.taskId}` : null,
        (info.total != null) ? `Sub-tasks: ${(info.total - (info.remaining ?? 0))}/${info.total} done, ${info.remaining ?? '?'} remaining` : null,
        info.attempt != null ? `Continuation: ${info.attempt}` : null,
        lastSha ? `HEAD: ${lastSha}` : null
      ].filter(Boolean).join('\n'),
      priority: 'low',
      actionRequired: false,
      extra: {
        reason: 'continuation',
        state: 'in-progress',
        taskId: info.taskId || null,
        taskInProgress: info.taskId || null,
        remaining: info.remaining ?? null,
        total: info.total ?? null,
        continuation: info.attempt ?? null,
        lastSha,
        heartbeatAt: new Date().toISOString()
      }
    });
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] worker-progress emit failed: ${err.message}`);
  }
}

/**
 * Terminal — emitted at a genuine stop. Picks the precise terminal type.
 */
async function notifyWorkerTerminal() {
  if (!isWorker()) return;
  try {
    const { inProgressTask, queued, phase, lastSha } = readState();
    const taskId = inProgressTask?.id || null;

    let type, subject, priority, actionRequired, state;
    if (!inProgressTask) {
      type = 'worker-idle';
      state = 'idle';
      subject = `Worker ${process.env.WOGI_REPO_NAME} idle (${queued} queued)`;
      priority = 'medium';
      actionRequired = queued > 0; // queued-but-not-started is worth the manager's attention
    } else if (AWAITING_PHASES.has(phase)) {
      type = 'worker-awaiting-approval';
      state = 'awaiting-approval';
      subject = `Worker ${process.env.WOGI_REPO_NAME} awaiting approval on ${taskId} (phase: ${phase})`;
      priority = 'high';
      actionRequired = true;
    } else {
      type = 'worker-stopped';
      state = 'mid-work';
      subject = `Worker stopped mid-work on ${taskId}`;
      priority = 'high';
      actionRequired = true;
    }

    emit(type, {
      subject,
      body: [
        `Worker "${process.env.WOGI_REPO_NAME}" stopped.`,
        `State: ${state}`,
        taskId ? `Task in progress: ${taskId}` : `Queued: ${queued}`,
        phase ? `Phase: ${phase}` : null,
        lastSha ? `Last commit: ${lastSha}` : null
      ].filter(Boolean).join('\n'),
      priority,
      actionRequired,
      extra: {
        reason: 'graceful',
        state,
        taskId,
        taskInProgress: taskId,
        phase,
        lastSha
      }
    });
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] worker terminal emit failed: ${err.message}`);
  }
}

module.exports = {
  notifyWorkerProgress,
  notifyWorkerTerminal,
  isWorker,
  AWAITING_PHASES,
  // Back-compat alias: the old single unconditional emitter. Now routes to the
  // typed terminal notifier (callers that want a terminal stop signal).
  notifyWorkerStopped: notifyWorkerTerminal
};
