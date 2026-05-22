'use strict';

/**
 * Tests for the S3 reliable-signal layer (epic-workspace-sustained-exec / wf-d3ae1717):
 *   - workspace-stop-notify: heartbeat vs typed terminal selection
 *   - workspace-messages: atomic write produces complete, parseable JSON
 *   - workspace-dispatch-tracking.refreshDispatchDeadline: heartbeat extends deadline
 *   - overdue-dispatches.sweepAndReconcile: worker-progress refreshes, worker-blocked resolves
 *
 * Run: NODE_ENV=test node --test tests/flow-workspace-stop-notify.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

// Temp project root = workspace root (single repo acting as a worker).
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-notify-'));
fs.mkdirSync(path.join(ROOT, '.workflow', 'state'), { recursive: true });
fs.mkdirSync(path.join(ROOT, '.workspace', 'messages'), { recursive: true });
process.env.WOGI_PROJECT_ROOT = ROOT;
process.env.WOGI_WORKSPACE_ROOT = ROOT;
process.env.WOGI_REPO_NAME = 'backend';
delete process.env.WOGI_MANAGER_PORT; // no real-time POST in tests

const notify = require('../scripts/hooks/core/workspace-stop-notify');
const { readMessages, saveMessage, createMessage } = require('../lib/workspace-messages');
const tracking = require('../lib/workspace-dispatch-tracking');
const { sweepAndReconcile } = require('../scripts/hooks/core/overdue-dispatches');

const STATE = path.join(ROOT, '.workflow', 'state');
function setReady(ready) { fs.writeFileSync(path.join(STATE, 'ready.json'), JSON.stringify(ready)); }
function setPhase(phase, taskId) { fs.writeFileSync(path.join(STATE, 'workflow-phase.json'), JSON.stringify({ phase, taskId })); }
function clearBus() {
  const dir = path.join(ROOT, '.workspace', 'messages');
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
}

after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_err) {} });

describe('S3 workspace-stop-notify: typed terminal', () => {
  it('emits worker-stopped (mid-work) for in-progress + active phase', async () => {
    clearBus();
    setReady({ inProgress: [{ id: 'wf-mid00001' }], ready: [] });
    setPhase('coding', 'wf-mid00001');
    await notify.notifyWorkerTerminal();
    const msgs = readMessages(ROOT, { type: 'worker-stopped' });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].state, 'mid-work');
    assert.equal(msgs[0].taskId, 'wf-mid00001');
  });

  it('emits worker-awaiting-approval for in-progress + spec_review (NOT done)', async () => {
    clearBus();
    setReady({ inProgress: [{ id: 'wf-spec0001' }], ready: [] });
    setPhase('spec_review', 'wf-spec0001');
    await notify.notifyWorkerTerminal();
    assert.equal(readMessages(ROOT, { type: 'worker-awaiting-approval' }).length, 1);
    assert.equal(readMessages(ROOT, { type: 'worker-stopped' }).length, 0);
    assert.equal(readMessages(ROOT, { type: 'task-complete' }).length, 0);
  });

  it('emits worker-idle when nothing in progress and nothing queued', async () => {
    clearBus();
    setReady({ inProgress: [], ready: [] });
    setPhase('idle', null);
    await notify.notifyWorkerTerminal();
    assert.equal(readMessages(ROOT, { type: 'worker-idle' }).length, 1);
  });
});

describe('S3 workspace-stop-notify: heartbeat', () => {
  it('emits worker-progress with progress fields (NOT a terminal)', async () => {
    clearBus();
    setReady({ inProgress: [{ id: 'wf-hb000001' }], ready: [] });
    setPhase('coding', 'wf-hb000001');
    await notify.notifyWorkerProgress({ taskId: 'wf-hb000001', remaining: 2, total: 5, attempt: 3 });
    const hb = readMessages(ROOT, { type: 'worker-progress' });
    assert.equal(hb.length, 1);
    assert.equal(hb[0].taskId, 'wf-hb000001');
    assert.equal(hb[0].remaining, 2);
    assert.equal(hb[0].total, 5);
    assert.equal(hb[0].continuation, 3);
    assert.equal(hb[0].state, 'in-progress');
    // a heartbeat must NOT be a worker-stopped
    assert.equal(readMessages(ROOT, { type: 'worker-stopped' }).length, 0);
  });
});

describe('S3 workspace-messages: atomic write', () => {
  it('saveMessage writes complete, parseable JSON (no torn read)', () => {
    clearBus();
    const msg = createMessage({ from: 'backend', to: 'manager', type: 'worker-progress', subject: 's', body: 'b' });
    const fp = saveMessage(ROOT, msg);
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw); // throws if torn
    assert.equal(parsed.id, msg.id);
    // no leftover tmp files in the dir
    const leftovers = fs.readdirSync(path.dirname(fp)).filter(f => f.includes('.tmp.'));
    assert.equal(leftovers.length, 0);
  });
});

describe('S3 dispatch-tracking + overdue: heartbeat refresh & terminal reconcile', () => {
  it('refreshDispatchDeadline extends a pending dispatch deadline', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-disp-'));
    tracking.recordDispatch(ws, { taskId: 'wf-d15a0b01', repoName: 'backend', expectedDurationMs: 1000 });
    const before = tracking.readDispatches(ws)[0].expectedDeadline;
    const r = tracking.refreshDispatchDeadline(ws, 'wf-d15a0b01', 60000);
    assert.ok(r);
    assert.equal(r.heartbeatCount, 1);
    assert.ok(Date.parse(r.expectedDeadline) > Date.parse(before));
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('sweepAndReconcile resolves a worker-blocked terminal as graceful-stop', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-sweep-'));
    fs.mkdirSync(path.join(ws, '.workspace', 'messages'), { recursive: true });
    tracking.recordDispatch(ws, { taskId: 'wf-b10c0a5e', repoName: 'backend' });
    const m = createMessage({ from: 'backend', to: 'manager', type: 'worker-blocked', subject: 'blocked', body: 'x' });
    m.taskId = 'wf-b10c0a5e'; m.reason = 'iteration cap reached';
    saveMessage(ws, m);
    const n = sweepAndReconcile(ws);
    assert.equal(n, 1);
    const rec = tracking.readDispatches(ws).find(d => d.taskId === 'wf-b10c0a5e');
    assert.equal(rec.status, 'graceful-stop');
    assert.equal(rec.reconciledReason, 'iteration cap reached');
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
