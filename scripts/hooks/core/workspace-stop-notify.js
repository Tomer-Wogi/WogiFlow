'use strict';

/**
 * Workspace worker-stopped notification (wf-6e31850e A-3 / extracted from stop.js).
 *
 * Writes a structured `worker-stopped` message to the workspace message bus
 * so the manager's overdue-check can distinguish "graceful stop" from
 * "silent death" vs "task-complete". Original: wf-d3e67abe.
 */

async function notifyWorkerStopped() {
  if (!process.env.WOGI_REPO_NAME || process.env.WOGI_REPO_NAME === 'manager') return;
  try {
    const nodePath = require('node:path');
    const childProcess = require('node:child_process');
    const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
    const repoName = process.env.WOGI_REPO_NAME;
    if (!VALID_NAME.test(repoName)) throw new Error('Invalid WOGI_REPO_NAME');

    const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;
    if (!workspaceRoot) return;

    const { PATHS, safeJsonParse } = require('../../flow-utils');
    const ready = safeJsonParse(nodePath.join(PATHS.state, 'ready.json'), {});
    const recentTask = (ready.recentlyCompleted || [])[0];
    const inProgressTask = (ready.inProgress || [])[0];
    const mostRecent = recentTask || inProgressTask;

    const hasInProgress = Boolean(inProgressTask);
    const state = hasInProgress ? 'mid-work' : 'idle';
    const taskInProgress = hasInProgress ? inProgressTask.id : null;

    let lastSha = null;
    try {
      lastSha = childProcess.execSync('git rev-parse --short HEAD 2>/dev/null || true', {
        cwd: PATHS.root,
        encoding: 'utf-8',
        timeout: 2000
      }).trim() || null;
    } catch (_err) { /* non-critical */ }

    try {
      const libMessages = nodePath.resolve(__dirname, '..', '..', '..', 'lib', 'workspace-messages');
      const { createMessage, saveMessage } = require(libMessages);
      const msg = createMessage({
        from: repoName,
        to: 'manager',
        type: 'worker-stopped',
        subject: hasInProgress
          ? `Worker stopped mid-work on ${taskInProgress}`
          : `Worker stopped (idle)`,
        body: [
          `Worker "${repoName}" is stopping.`,
          `State: ${state}`,
          taskInProgress ? `Task in progress: ${taskInProgress}` : null,
          mostRecent?.title ? `Most recent task: ${mostRecent.title}` : null,
          lastSha ? `Last commit: ${lastSha}` : null
        ].filter(Boolean).join('\n'),
        priority: hasInProgress ? 'high' : 'medium',
        actionRequired: hasInProgress
      });
      msg.taskId = taskInProgress;
      msg.reason = 'graceful';
      msg.state = state;
      msg.taskInProgress = taskInProgress;
      msg.lastSha = lastSha;
      saveMessage(workspaceRoot, msg);
    } catch (err) {
      if (process.env.DEBUG) console.error(`[Stop] Workspace message write failed: ${err.message}`);
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] Workspace notification failed: ${err.message}`);
  }
}

module.exports = { notifyWorkerStopped };
