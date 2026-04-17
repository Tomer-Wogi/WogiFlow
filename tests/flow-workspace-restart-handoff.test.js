'use strict';

/**
 * Tests for the workspace restart-handoff protocol (2.22.2).
 *
 * Covers:
 *   - worker-ready announce conditions (worker mode + empty queue + no dup)
 *   - worker-ready message shape
 *   - Session-start-worker branches: auto-resume vs announce-ready vs skip
 *   - Manager reconcileWorkerReady: surfaces lost dispatches, acknowledges messages
 *   - buildOverdueContext composes lost + overdue sections correctly
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const workerReady = require('../lib/workspace-worker-ready');
const tracking = require('../lib/workspace-dispatch-tracking');
const { createMessage, saveMessage, readMessages, MESSAGE_TYPES } = require('../lib/workspace-messages');
const { handleWorkerSessionStart } = require('../scripts/hooks/core/session-start-worker');
const {
  reconcileWorkerReady,
  formatLostDispatchesContext,
  buildOverdueContext
} = require('../scripts/hooks/core/overdue-dispatches');

// ============================================================
// Helpers
// ============================================================

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-handoff-'));
  fs.mkdirSync(path.join(root, '.workspace', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, '.workspace', 'messages'), { recursive: true });
  return root;
}
function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
}
function withEnv(vars, fn) {
  const orig = {};
  for (const k of Object.keys(vars)) orig[k] = process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
  }
}

// ============================================================
// MESSAGE_TYPES registration
// ============================================================

describe('worker-ready message type', () => {
  it('is in MESSAGE_TYPES (lib/workspace-messages.js)', () => {
    assert.ok(MESSAGE_TYPES.includes('worker-ready'));
  });

  it('createMessage accepts type: worker-ready', () => {
    const msg = createMessage({
      from: 'worker-1', to: 'manager', type: 'worker-ready',
      subject: 'ready', body: 'hello'
    });
    assert.equal(msg.type, 'worker-ready');
    assert.equal(msg.status, 'pending');
  });
});

// ============================================================
// shouldAnnounceReady
// ============================================================

describe('shouldAnnounceReady', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('announces when worker mode + empty queue + no pending announce', () => {
    const d = workerReady.shouldAnnounceReady({
      workspaceRoot: root,
      repoName: 'worker-1',
      readyData: { ready: [], inProgress: [] }
    });
    assert.equal(d.announce, true);
    assert.equal(d.reason, 'ok');
  });

  it('skips when in-progress tasks exist', () => {
    const d = workerReady.shouldAnnounceReady({
      workspaceRoot: root,
      repoName: 'worker-1',
      readyData: { ready: [], inProgress: [{ id: 'wf-12345678' }] }
    });
    assert.equal(d.announce, false);
    assert.equal(d.reason, 'in-progress-not-empty');
  });

  it('skips when queued channel dispatches exist (auto-resume branch)', () => {
    const d = workerReady.shouldAnnounceReady({
      workspaceRoot: root,
      repoName: 'worker-1',
      readyData: {
        ready: [{ id: 'wf-abcd1234', channelSource: 'wogi-workspace-channel' }],
        inProgress: []
      }
    });
    assert.equal(d.announce, false);
    assert.equal(d.reason, 'queued-channel-work-present');
  });

  it('skips when a pending worker-ready already exists for this repo', () => {
    const msg = createMessage({
      from: 'worker-1', to: 'manager', type: 'worker-ready',
      subject: 'ready', body: 'existing'
    });
    saveMessage(root, msg);

    const d = workerReady.shouldAnnounceReady({
      workspaceRoot: root,
      repoName: 'worker-1',
      readyData: { ready: [], inProgress: [] }
    });
    assert.equal(d.announce, false);
    assert.equal(d.reason, 'already-announced');
  });

  it('skips when not in worker mode (no workspace root)', () => {
    const d = workerReady.shouldAnnounceReady({
      workspaceRoot: null,
      repoName: 'worker-1',
      readyData: { ready: [], inProgress: [] }
    });
    assert.equal(d.announce, false);
    assert.equal(d.reason, 'no-workspace-root');
  });

  it('skips when repo name is "manager"', () => {
    const d = workerReady.shouldAnnounceReady({
      workspaceRoot: root,
      repoName: 'manager',
      readyData: { ready: [], inProgress: [] }
    });
    assert.equal(d.announce, false);
    assert.equal(d.reason, 'not-worker');
  });
});

// ============================================================
// announceWorkerReady
// ============================================================

describe('announceWorkerReady', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('writes a well-formed worker-ready message to the bus', () => {
    const r = workerReady.announceWorkerReady(root, 'worker-1');
    assert.equal(r.written, true);
    assert.match(r.messageId, /^msg-[a-f0-9]{8}$/);
    assert.ok(fs.existsSync(r.path));
    const msgs = readMessages(root, { type: 'worker-ready' });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].from, 'worker-1');
    assert.equal(msgs[0].to, 'manager');
    assert.equal(msgs[0].status, 'pending');
    assert.match(msgs[0].body, /empty task queue/);
  });
});

// ============================================================
// handleWorkerSessionStart branches
// ============================================================

describe('handleWorkerSessionStart', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('branch = skip when not in worker mode', () => {
    const r = withEnv({ WOGI_WORKSPACE_ROOT: '', WOGI_REPO_NAME: '' }, () =>
      handleWorkerSessionStart()
    );
    assert.equal(r.branch, 'skip');
    assert.equal(r.reason, 'not-worker');
  });
});

// ============================================================
// reconcileWorkerReady
// ============================================================

describe('reconcileWorkerReady (manager side)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('surfaces a lost dispatch when worker announces ready + dispatch still pending', () => {
    // Manager dispatched wf-11111111 to worker-1 2 minutes ago — still pending
    tracking.recordDispatch(root, {
      taskId: 'wf-11111111',
      repoName: 'worker-1',
      expectedDurationMs: 30 * 60 * 1000
    });
    // Simulate "dispatched 2 minutes ago" by backdating
    const statePath = tracking.stateFilePath(root);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.dispatches[0].dispatchedAt = new Date(Date.now() - 120000).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Worker announces ready with empty queue
    const announceRes = workerReady.announceWorkerReady(root, 'worker-1');
    assert.equal(announceRes.written, true);

    // Manager reconciles
    const { acknowledged, lostDispatches } = reconcileWorkerReady(root);
    assert.equal(acknowledged, 1);
    assert.equal(lostDispatches.length, 1);
    assert.equal(lostDispatches[0].taskId, 'wf-11111111');
    assert.equal(lostDispatches[0].repoName, 'worker-1');

    // Message should now be acknowledged, not pending
    const msgs = readMessages(root, { type: 'worker-ready' });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].status, 'acknowledged');
  });

  it('no surface when no pending dispatches match the announcing repo', () => {
    // Dispatch to a DIFFERENT worker — shouldn't affect worker-1 announcement
    tracking.recordDispatch(root, {
      taskId: 'wf-22222222',
      repoName: 'worker-2'
    });
    const announceRes = workerReady.announceWorkerReady(root, 'worker-1');
    assert.equal(announceRes.written, true);
    const { lostDispatches } = reconcileWorkerReady(root);
    assert.equal(lostDispatches.length, 0);
  });

  it('respects staleGraceMs (just-sent dispatches are not flagged as lost)', () => {
    // Dispatch NOW (very fresh)
    tracking.recordDispatch(root, {
      taskId: 'wf-33333333',
      repoName: 'worker-1'
    });
    workerReady.announceWorkerReady(root, 'worker-1');
    // Default grace is 30000ms → this dispatch is far younger
    const { lostDispatches } = reconcileWorkerReady(root, { staleGraceMs: 30000 });
    assert.equal(lostDispatches.length, 0, 'fresh dispatch within grace should not be flagged lost');
  });

  it('ignores non-pending dispatches', () => {
    tracking.recordDispatch(root, { taskId: 'wf-44444444', repoName: 'worker-1' });
    tracking.reconcileDispatch(root, 'wf-44444444', 'completed');
    // Backdate the other dispatch
    const stateBefore = JSON.parse(fs.readFileSync(tracking.stateFilePath(root), 'utf8'));
    stateBefore.dispatches[0].dispatchedAt = new Date(Date.now() - 120000).toISOString();
    fs.writeFileSync(tracking.stateFilePath(root), JSON.stringify(stateBefore, null, 2));

    workerReady.announceWorkerReady(root, 'worker-1');
    const { lostDispatches } = reconcileWorkerReady(root);
    assert.equal(lostDispatches.length, 0, 'completed dispatch should not be flagged lost');
  });
});

// ============================================================
// formatLostDispatchesContext + buildOverdueContext integration
// ============================================================

describe('formatLostDispatchesContext', () => {
  it('returns null for empty input', () => {
    assert.equal(formatLostDispatchesContext([]), null);
    assert.equal(formatLostDispatchesContext(null), null);
  });

  it('formats lost-dispatch lines with repo + taskId', () => {
    const out = formatLostDispatchesContext([
      { taskId: 'wf-12345678', repoName: 'worker-1', dispatchedAt: '2026-04-17T10:00:00Z' }
    ]);
    assert.ok(out);
    assert.match(out, /LOST DISPATCHES/);
    assert.match(out, /wf-12345678/);
    assert.match(out, /worker-1/);
    assert.match(out, /dispatchToChannel/);
  });
});

describe('buildOverdueContext integration', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('includes lost-dispatches section when worker-ready matches pending dispatch', () => {
    tracking.recordDispatch(root, {
      taskId: 'wf-55555555',
      repoName: 'worker-3',
      expectedDurationMs: 30 * 60 * 1000
    });
    const statePath = tracking.stateFilePath(root);
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    s.dispatches[0].dispatchedAt = new Date(Date.now() - 120000).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
    workerReady.announceWorkerReady(root, 'worker-3');

    const ctx = buildOverdueContext({ workspaceRoot: root });
    assert.ok(ctx);
    assert.match(ctx, /LOST DISPATCHES/);
    assert.match(ctx, /wf-55555555/);
  });

  it('returns null when nothing to surface', () => {
    const ctx = buildOverdueContext({ workspaceRoot: root });
    assert.equal(ctx, null);
  });
});

// ============================================================
// End-to-end: restart handoff round trip
// ============================================================

describe('end-to-end restart handoff', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('manager dispatches → worker restarts empty → manager surfaces lost dispatch', () => {
    // 1. Manager dispatches a task to worker-1
    tracking.recordDispatch(root, {
      taskId: 'wf-e2e00001',
      repoName: 'worker-1'
    });
    // Backdate so grace period is satisfied
    const sp = tracking.stateFilePath(root);
    const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
    st.dispatches[0].dispatchedAt = new Date(Date.now() - 60000).toISOString();
    fs.writeFileSync(sp, JSON.stringify(st, null, 2));

    // 2. Worker-1 restarts with empty queue → announces ready (we call directly)
    const announce = workerReady.announceWorkerReady(root, 'worker-1');
    assert.equal(announce.written, true);

    // 3. Manager's next turn runs buildOverdueContext — surfaces lost
    const ctx = buildOverdueContext({ workspaceRoot: root });
    assert.ok(ctx, 'manager should surface something');
    assert.match(ctx, /wf-e2e00001/);
    assert.match(ctx, /worker-1/);

    // 4. Second run — message should already be acknowledged, no re-surface
    const ctx2 = buildOverdueContext({ workspaceRoot: root });
    // Should be null OR at least not have the LOST DISPATCHES block
    if (ctx2) {
      assert.ok(!/LOST DISPATCHES/.test(ctx2), 'acknowledged worker-ready should not re-surface');
    }
  });
});
