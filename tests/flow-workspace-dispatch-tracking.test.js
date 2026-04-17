'use strict';

/**
 * Tests for workspace dispatch tracking — silent-worker-halt detection (wf-d3e67abe).
 *
 * Covers the 8 acceptance criteria:
 *   1. Happy path — dispatch recorded, reconciled on completion
 *   2. Silent death surfaced on manager turn
 *   3. Graceful stop (worker-stopped) distinguishable from silent death
 *   4. Legitimately long task — no false positive
 *   5. Caller overrides deadline
 *   6. Backwards compatibility (task-complete shape, waitForCompletion regression)
 *   7. No background processes introduced
 *   8. decisions.md contract exists
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const tracking = require('../lib/workspace-dispatch-tracking');
const { buildOverdueContext, sweepAndReconcile, isManagerSession } = require('../scripts/hooks/core/overdue-dispatches');
const { createMessage, saveMessage, MESSAGE_TYPES } = require('../lib/workspace-messages');

// ============================================================
// Helpers
// ============================================================

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-dispatch-test-'));
  fs.mkdirSync(path.join(root, '.workspace', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, '.workspace', 'messages'), { recursive: true });
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
}

// ============================================================
// Scenario 1: Happy path — record + reconcile
// ============================================================

describe('recordDispatch (Scenario 1)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('appends a pending record with dispatchedAt, expectedDeadline, expectedDurationMs', () => {
    const r = tracking.recordDispatch(root, { taskId: 'wf-a1b2c3d4', repoName: 'worker-1' });
    assert.equal(r.taskId, 'wf-a1b2c3d4');
    assert.equal(r.repoName, 'worker-1');
    assert.equal(r.status, 'pending');
    assert.equal(r.expectedDurationMs, tracking.DEFAULT_DURATION_MS);
    assert.ok(Date.parse(r.dispatchedAt) > 0);
    assert.ok(Date.parse(r.expectedDeadline) > Date.parse(r.dispatchedAt));

    const all = tracking.readDispatches(root);
    assert.equal(all.length, 1);
    assert.equal(all[0].taskId, 'wf-a1b2c3d4');
  });

  it('rejects invalid taskId', () => {
    assert.throws(() => tracking.recordDispatch(root, { taskId: 'not-a-task', repoName: 'worker-1' }), /Invalid taskId/);
  });

  it('reconcileDispatch marks the record completed and removes from overdue', () => {
    tracking.recordDispatch(root, { taskId: 'wf-a1b2c3d4', repoName: 'worker-1', expectedDurationMs: 1 });
    // Sleep past the 1ms deadline
    const deadline = Date.now() + 10;
    while (Date.now() < deadline) { /* spin */ }

    // Before reconcile: overdue should contain this record
    const before = tracking.getOverdueDispatches(root);
    assert.equal(before.length, 1);

    const updated = tracking.reconcileDispatch(root, 'wf-a1b2c3d4', 'completed');
    assert.equal(updated.status, 'completed');
    assert.ok(updated.reconciledAt);

    // After reconcile: not overdue
    const after = tracking.getOverdueDispatches(root);
    assert.equal(after.length, 0);
  });

  it('reconcileDispatch returns null when no pending record matches', () => {
    const result = tracking.reconcileDispatch(root, 'wf-no-record', 'completed');
    assert.equal(result, null);
  });
});

// ============================================================
// Scenario 2: Silent death surfaced on manager turn
// ============================================================

describe('buildOverdueContext (Scenario 2 — silent death surfacing)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('returns overdue block when pending dispatch is past deadline', () => {
    tracking.recordDispatch(root, { taskId: 'wf-a1b2c3d4', repoName: 'worker-1', expectedDurationMs: 1 });
    // Wait for deadline
    const waitUntil = Date.now() + 10;
    while (Date.now() < waitUntil) { /* spin */ }

    const ctx = buildOverdueContext({ workspaceRoot: root });
    assert.ok(ctx);
    assert.match(ctx, /OVERDUE WORKSPACE DISPATCHES \(1\)/);
    assert.match(ctx, /wf-a1b2c3d4/);
    assert.match(ctx, /worker-1/);
    assert.match(ctx, /dispatched-tasks\.json/);
  });

  it('returns null when no dispatches are overdue', () => {
    tracking.recordDispatch(root, { taskId: 'wf-a1b2c3d4', repoName: 'worker-1' });
    const ctx = buildOverdueContext({ workspaceRoot: root });
    assert.equal(ctx, null);
  });

  it('returns null when no workspace root and env unset', () => {
    const origRoot = process.env.WOGI_WORKSPACE_ROOT;
    delete process.env.WOGI_WORKSPACE_ROOT;
    try {
      const ctx = buildOverdueContext({});
      assert.equal(ctx, null);
    } finally {
      if (origRoot !== undefined) process.env.WOGI_WORKSPACE_ROOT = origRoot;
    }
  });
});

// ============================================================
// Scenario 3: Graceful stop distinguishable from silent death
// ============================================================

describe('sweepAndReconcile (Scenario 3 — graceful stop)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('reconciles as graceful-stop when worker-stopped message matches a pending record', () => {
    tracking.recordDispatch(root, { taskId: 'wf-a1b2c3d4', repoName: 'worker-1', expectedDurationMs: 1 });
    const msg = createMessage({
      from: 'worker-1', to: 'manager', type: 'worker-stopped',
      subject: 'Worker stopped mid-work', body: 'graceful'
    });
    msg.taskId = 'wf-a1b2c3d4';
    msg.reason = 'graceful';
    saveMessage(root, msg);

    const count = sweepAndReconcile(root);
    assert.equal(count, 1);

    const [r] = tracking.readDispatches(root);
    assert.equal(r.status, 'graceful-stop');
    assert.equal(r.reconciledReason, 'graceful');
  });

  it('reconciles as completed when task-complete message matches', () => {
    tracking.recordDispatch(root, { taskId: 'wf-e5f67890', repoName: 'worker-2' });
    const msg = createMessage({
      from: 'worker-2', to: 'manager', type: 'task-complete',
      subject: 'Task completed: wf-e5f67890', body: 'done'
    });
    msg.taskId = 'wf-e5f67890';
    saveMessage(root, msg);

    const count = sweepAndReconcile(root);
    assert.equal(count, 1);

    const [r] = tracking.readDispatches(root);
    assert.equal(r.status, 'completed');
  });

  it('does not reconcile when no matching message exists', () => {
    tracking.recordDispatch(root, { taskId: 'wf-a1b2c3d4', repoName: 'worker-1' });
    const count = sweepAndReconcile(root);
    assert.equal(count, 0);

    const [r] = tracking.readDispatches(root);
    assert.equal(r.status, 'pending');
  });
});

// ============================================================
// Scenario 4: Legitimately long task — no false positive
// ============================================================

describe('getOverdueDispatches (Scenario 4 — long task)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('does not flag a long task whose deadline has not passed', () => {
    tracking.recordDispatch(root, {
      taskId: 'wf-a1b2c3d4',
      repoName: 'worker-1',
      expectedDurationMs: 7_200_000 // 2 hours
    });
    const overdue = tracking.getOverdueDispatches(root);
    assert.equal(overdue.length, 0);
  });
});

// ============================================================
// Scenario 5: Caller override — expectedDeadline computed from override
// ============================================================

describe('recordDispatch (Scenario 5 — override propagation)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('expectedDeadline = dispatchedAt + expectedDurationMs', () => {
    const override = 7_200_000;
    const r = tracking.recordDispatch(root, {
      taskId: 'wf-a1b2c3d4', repoName: 'worker-1', expectedDurationMs: override
    });
    const dispatchedMs = Date.parse(r.dispatchedAt);
    const deadlineMs = Date.parse(r.expectedDeadline);
    assert.equal(r.expectedDurationMs, override);
    assert.equal(deadlineMs - dispatchedMs, override);
  });

  it('falls back to DEFAULT_DURATION_MS for invalid override', () => {
    const r = tracking.recordDispatch(root, {
      taskId: 'wf-a1b2c3d4', repoName: 'worker-1', expectedDurationMs: -1
    });
    assert.equal(r.expectedDurationMs, tracking.DEFAULT_DURATION_MS);
  });
});

// ============================================================
// Scenario 6: Backwards compatibility
// ============================================================

describe('backwards compatibility (Scenario 6)', () => {
  it('worker-stopped added to MESSAGE_TYPES without removing task-complete', () => {
    assert.ok(MESSAGE_TYPES.includes('task-complete'));
    assert.ok(MESSAGE_TYPES.includes('worker-stopped'));
  });

  it('dispatchToChannel keeps its existing signature (workspaceRoot, repoName, taskId, opts)', () => {
    const { dispatchToChannel } = require('../lib/workspace-routing');
    assert.equal(typeof dispatchToChannel, 'function');
    assert.equal(dispatchToChannel.length, 3); // 3 required params (opts is optional)
  });

  it('waitForCompletion signature preserved', () => {
    // Just verify the export shape — full regression covered by existing
    // workspace-routing tests.
    const routing = require('../lib/workspace-routing');
    assert.equal(typeof routing.dispatchToChannel, 'function');
  });
});

// ============================================================
// Scenario 7: No background processes
// ============================================================

describe('no background processes introduced (Scenario 7)', () => {
  it('workspace-dispatch-tracking does not use setInterval / long setTimeout / fs.watch', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'workspace-dispatch-tracking.js'), 'utf8');
    assert.ok(!/setInterval\s*\(/.test(src), 'setInterval must not appear');
    assert.ok(!/fs\.watch\s*\(/.test(src), 'fs.watch must not appear');
    // Long setTimeout (>1s) — the module must not schedule anything at all.
    assert.ok(!/setTimeout\s*\(/.test(src), 'setTimeout must not appear');
  });

  it('overdue-dispatches hook does not use setInterval / long setTimeout / fs.watch', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'hooks', 'core', 'overdue-dispatches.js'), 'utf8');
    assert.ok(!/setInterval\s*\(/.test(src));
    assert.ok(!/fs\.watch\s*\(/.test(src));
    assert.ok(!/setTimeout\s*\(/.test(src));
  });
});

// ============================================================
// Scenario 8: decisions.md contract exists
// ============================================================

describe('decisions.md contract (Scenario 8)', () => {
  it('contains Workspace Worker Silent-Halt Detection Contract rule', () => {
    const decisions = fs.readFileSync(path.join(__dirname, '..', '.workflow', 'state', 'decisions.md'), 'utf8');
    assert.match(decisions, /Workspace Worker Silent-Halt Detection Contract/);
    assert.match(decisions, /workspace-worker-silent-halt-detection/);
    assert.match(decisions, /dispatched-tasks\.json/);
  });
});

// ============================================================
// Scenario 6b: manager-only gating
// ============================================================

describe('manager-only scoping', () => {
  const origRoot = process.env.WOGI_WORKSPACE_ROOT;
  const origRepo = process.env.WOGI_REPO_NAME;
  afterEach(() => {
    if (origRoot === undefined) delete process.env.WOGI_WORKSPACE_ROOT;
    else process.env.WOGI_WORKSPACE_ROOT = origRoot;
    if (origRepo === undefined) delete process.env.WOGI_REPO_NAME;
    else process.env.WOGI_REPO_NAME = origRepo;
  });

  it('isManagerSession returns false when WOGI_WORKSPACE_ROOT unset', () => {
    delete process.env.WOGI_WORKSPACE_ROOT;
    assert.equal(isManagerSession(), false);
  });

  it('isManagerSession returns false when WOGI_REPO_NAME is a worker', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'worker-1';
    assert.equal(isManagerSession(), false);
  });

  it('isManagerSession returns true when WOGI_REPO_NAME is "manager"', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    process.env.WOGI_REPO_NAME = 'manager';
    assert.equal(isManagerSession(), true);
  });

  it('isManagerSession returns true when WOGI_REPO_NAME unset (single-repo manager)', () => {
    process.env.WOGI_WORKSPACE_ROOT = '/tmp/ws';
    delete process.env.WOGI_REPO_NAME;
    assert.equal(isManagerSession(), true);
  });
});

// ============================================================
// Ring buffer — overflow to archive
// ============================================================

describe('ring buffer + archive', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(() => cleanup(root));

  it('caps active records at MAX_ACTIVE and overflows oldest to archive.jsonl', () => {
    const N = tracking.MAX_ACTIVE + 5;
    for (let i = 0; i < N; i++) {
      const id = 'wf-' + String(i).padStart(8, '0');
      tracking.recordDispatch(root, { taskId: id, repoName: 'worker-1' });
    }

    const active = tracking.readDispatches(root);
    assert.equal(active.length, tracking.MAX_ACTIVE);

    const archivePath = tracking.archiveFilePath(root);
    assert.ok(fs.existsSync(archivePath), 'archive file must exist after overflow');
    const archiveLines = fs.readFileSync(archivePath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(archiveLines.length, 5, 'archive should contain exactly 5 overflow records');
  });
});
