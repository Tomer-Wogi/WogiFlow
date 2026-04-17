#!/usr/bin/env node

/**
 * Wogi Workspace — Worker Readiness Announce (restart-handoff protocol)
 *
 * Problem this solves:
 *   When a worker session restarts (wogi-claude wrapper relaunches claude
 *   after a task-boundary), channel dispatches sent by the manager during
 *   the restart window can be lost — they arrive either while the old
 *   claude is shutting down or before the new claude has wired up its
 *   MCP channel, and the notification never reaches a live session.
 *
 *   Previous sessions observed: manager dispatches session N, worker
 *   completes N and restarts, manager tries to dispatch N+1 during the
 *   restart gap, N+1 is lost, worker comes up fresh with empty queue
 *   and sits idle until the user notices and the manager re-dispatches.
 *
 * Design:
 *   File-based announce via the workspace-messages bus. When a worker
 *   SessionStart fires and the worker has zero in-progress tasks and
 *   zero queued channel dispatches, write a structured `worker-ready`
 *   message to `.workspace/messages/`. The manager's next turn sweeps
 *   the bus, cross-references the dispatched-tasks.json (wf-d3e67abe)
 *   to see if anything is owed to this worker, and surfaces lost
 *   dispatches for re-dispatch.
 *
 *   File-based delivery is durable: no timing games, no buffer TTL,
 *   no dependency on the MCP channel server being up during the
 *   restart gap. Worker writes → manager reads → reconciles.
 *
 * Dedup:
 *   If a pending `worker-ready` message already exists for this repo,
 *   we skip — no need to stack announcements while the manager hasn't
 *   picked up the first one yet.
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');

/**
 * Detect if the current process is a workspace worker (not a manager and not a
 * single-repo session). Mirrors the isWorkspaceWorker detection used in
 * scripts/hooks/core/task-completed.js.
 *
 * @returns {boolean}
 */
function isWorker() {
  if (!process.env.WOGI_WORKSPACE_ROOT) return false;
  const repo = process.env.WOGI_REPO_NAME;
  if (!repo || repo === 'manager') return false;
  return true;
}

/**
 * Resolve the workspace root from env (worker mode).
 *
 * @returns {string|null}
 */
function getWorkspaceRoot() {
  const root = process.env.WOGI_WORKSPACE_ROOT;
  if (!root || !path.isAbsolute(root)) return null;
  return root;
}

/**
 * Check whether a pending worker-ready message already exists for this repo.
 * Used to dedup — we don't need to stack announcements.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @returns {boolean}
 */
function hasPendingAnnounce(workspaceRoot, repoName) {
  try {
    const messagesDir = path.join(workspaceRoot, '.workspace', 'messages');
    if (!fs.existsSync(messagesDir)) return false;
    const files = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const msg = safeReadJson(path.join(messagesDir, file));
        if (!msg) continue;
        if (msg.type === 'worker-ready' &&
            msg.from === repoName &&
            msg.status === 'pending') {
          return true;
        }
      } catch (_err) { /* skip malformed */ }
    }
    return false;
  } catch (_err) {
    return false;
  }
}

/**
 * Decide whether this worker should announce ready.
 * Preconditions:
 *   - Worker mode (WOGI_WORKSPACE_ROOT + WOGI_REPO_NAME !== 'manager')
 *   - ready.json has zero in-progress tasks
 *   - ready.json has zero queued channel-dispatched tasks
 *     (if it has queued work, the SessionStart hook auto-invokes
 *     /wogi-start instead of announcing — different branch)
 *   - No pending worker-ready message already exists for this repo
 *
 * @param {Object} [opts] - override knobs for testing
 * @param {string} [opts.workspaceRoot]
 * @param {string} [opts.repoName]
 * @param {Object} [opts.readyData]
 * @returns {{announce: boolean, reason: string, repoName?: string, workspaceRoot?: string}}
 */
function shouldAnnounceReady(opts = {}) {
  const workspaceRoot = opts.workspaceRoot || getWorkspaceRoot();
  const repoName = opts.repoName || process.env.WOGI_REPO_NAME;

  if (!workspaceRoot) return { announce: false, reason: 'no-workspace-root' };
  if (!opts.repoName && !isWorker()) return { announce: false, reason: 'not-worker' };
  if (!repoName || repoName === 'manager') return { announce: false, reason: 'not-worker' };

  let readyData = opts.readyData;
  if (!readyData) {
    try {
      const { PATHS } = require('../scripts/flow-utils');
      const readyPath = path.join(PATHS.state, 'ready.json');
      readyData = safeReadJson(readyPath, { ready: [], inProgress: [] });
    } catch (_err) {
      readyData = { ready: [], inProgress: [] };
    }
  }

  const inProgress = Array.isArray(readyData.inProgress) ? readyData.inProgress : [];
  if (inProgress.length > 0) {
    return { announce: false, reason: 'in-progress-not-empty' };
  }

  const queuedChannel = (Array.isArray(readyData.ready) ? readyData.ready : [])
    .filter(t => t && (
      t.channelSource === 'wogi-workspace-channel' ||
      t.dispatchedBy === 'workspace-manager' ||
      (typeof t.source === 'string' && t.source.startsWith('workspace:'))
    ));
  if (queuedChannel.length > 0) {
    return { announce: false, reason: 'queued-channel-work-present' };
  }

  if (hasPendingAnnounce(workspaceRoot, repoName)) {
    return { announce: false, reason: 'already-announced' };
  }

  return { announce: true, reason: 'ok', workspaceRoot, repoName };
}

/**
 * Write a worker-ready message to the workspace-messages bus.
 *
 * @param {string} workspaceRoot
 * @param {string} repoName
 * @returns {{written: boolean, messageId?: string, path?: string, reason?: string}}
 */
function announceWorkerReady(workspaceRoot, repoName) {
  try {
    const { createMessage, saveMessage } = require('./workspace-messages');
    const msg = createMessage({
      from: repoName,
      to: 'manager',
      type: 'worker-ready',
      subject: `Worker ${repoName} ready — queue empty, awaiting dispatch`,
      body: [
        `Worker "${repoName}" has started a fresh session with an empty task queue.`,
        `If you dispatched any tasks to this worker that were lost during the`,
        `restart window, they can be re-dispatched now. No pending work detected`,
        `in ready.json (zero inProgress, zero queued channel dispatches).`
      ].join('\n'),
      priority: 'medium',
      actionRequired: false
    });
    const filePath = saveMessage(workspaceRoot, msg);
    return { written: true, messageId: msg.id, path: filePath };
  } catch (err) {
    return { written: false, reason: `write-failed: ${err.message}` };
  }
}

module.exports = {
  isWorker,
  getWorkspaceRoot,
  hasPendingAnnounce,
  shouldAnnounceReady,
  announceWorkerReady
};
