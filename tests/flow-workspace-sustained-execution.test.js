'use strict';

/**
 * S6 REGRESSION TEST (epic-workspace-sustained-exec / wf-68b5cef7) — the headline
 * contract the whole epic exists to guarantee:
 *
 *   "Dispatch a 3-sub-task job → it completes all 3 unattended across Stop
 *    boundaries → reports task-complete."
 *
 * Drives the REAL worker Stop-gate sequence (checkWorkspaceStopGates) across
 * simulated turns, using the S1 durable ledger + S2 continuation gate + S3
 * heartbeat/terminal signals, and the manager-side sweepAndReconcile.
 *
 * Also guards the escape hatches: runaway iteration cap, no-progress
 * escalation, and worker-mode isolation (solo sessions untouched).
 *
 * Run: NODE_ENV=test node --test tests/flow-workspace-sustained-execution.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

// Temp project root = worker repo, set BEFORE requiring PATHS-bound modules.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-sustained-'));
const STATE = path.join(ROOT, '.workflow', 'state');
fs.mkdirSync(STATE, { recursive: true });
fs.mkdirSync(path.join(ROOT, '.workspace', 'messages'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.workflow', 'config.json'), JSON.stringify({
  version: '2.0.0',
  workspace: { subtaskLedger: { enabled: true }, continuationGate: { enabled: true, perSubtaskTurns: 6, capBuffer: 4, maxContinuations: 60, noProgressK: 3 } }
}));
process.env.WOGI_PROJECT_ROOT = ROOT;
process.env.WOGI_WORKSPACE_ROOT = ROOT;
process.env.WOGI_REPO_NAME = 'backend';
delete process.env.WOGI_MANAGER_PORT;

const { checkWorkspaceStopGates } = require('../scripts/hooks/core/workspace-stop-gates');
const subtaskState = require('../lib/workspace-subtask-state');
const tracking = require('../lib/workspace-dispatch-tracking');
const { readMessages, saveMessage, createMessage } = require('../lib/workspace-messages');
const { sweepAndReconcile } = require('../scripts/hooks/core/overdue-dispatches');
const contGate = require('../scripts/hooks/core/worker-continuation-gate');

const TASK = 'wf-5b7a0c01';

function setReady(ready) { fs.writeFileSync(path.join(STATE, 'ready.json'), JSON.stringify(ready)); }
function setPhase(phase) { fs.writeFileSync(path.join(STATE, 'workflow-phase.json'), JSON.stringify({ phase, taskId: TASK })); }
function clearGateState() {
  contGate.clearCounter(STATE);
  for (const f of fs.readdirSync(path.join(ROOT, '.workspace', 'messages'))) {
    fs.rmSync(path.join(ROOT, '.workspace', 'messages', f));
  }
}

after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_err) {} });

describe('S6 — 3-sub-task job completes unattended across Stop boundaries', () => {
  it('continues for each remaining sub-task, then allows a clean stop + task-complete', async () => {
    clearGateState();
    // Manager dispatched a story the worker decomposed into 3 sub-tasks.
    tracking.recordDispatch(ROOT, { taskId: TASK, repoName: 'backend', dispatchedBy: 'manager' });
    setReady({ inProgress: [{ id: TASK, title: 'Foundation story' }], ready: [], recentlyCompleted: [] });
    setPhase('coding');
    subtaskState.write(TASK, [
      { id: '01', status: 'pending' }, { id: '02', status: 'pending' }, { id: '03', status: 'pending' }
    ]);

    let continuations = 0;
    for (let turn = 1; turn <= 3; turn++) {
      const r = await checkWorkspaceStopGates({ parsedInput: {} });
      assert.ok(r && r.shouldReturn, `turn ${turn}: gate should force continuation while sub-tasks remain`);
      assert.equal(r.result.continue, true);
      assert.match(r.result.stopReason, /SUSTAINED EXECUTION/);
      continuations++;
      // The worker does the sub-task this turn → mark it complete (real progress).
      subtaskState.markStatus(TASK, String(turn).padStart(2, '0'), 'completed');
    }

    // All 3 done → the continuation gate must NOT force another turn.
    assert.equal(subtaskState.remaining(TASK), 0);
    const done = await checkWorkspaceStopGates({ parsedInput: {} });
    assert.ok(!done || !done.shouldReturn, 'gate must allow stop once all sub-tasks are complete');

    // It ran ALL 3 sub-tasks unattended (the bug stalled after turn 1).
    assert.equal(continuations, 3);

    // Heartbeats were emitted on continuations (NOT terminal worker-stopped).
    assert.equal(readMessages(ROOT, { type: 'worker-progress' }).length, 3);
    assert.equal(readMessages(ROOT, { type: 'worker-stopped' }).length, 0);

    // Worker reports done → task-complete reaches the manager and resolves the dispatch.
    setReady({ inProgress: [], ready: [], recentlyCompleted: [{ id: TASK, completedAt: new Date().toISOString() }] });
    const tc = createMessage({ from: 'backend', to: 'manager', type: 'task-complete', subject: TASK, body: '## Results\ndone' });
    tc.taskId = TASK;
    saveMessage(ROOT, tc);
    const reconciled = sweepAndReconcile(ROOT);
    assert.equal(reconciled, 1);
    const rec = tracking.readDispatches(ROOT).find(d => d.taskId === TASK);
    assert.equal(rec.status, 'completed');
  });
});

describe('S6 — escape hatches', () => {
  it('runaway: never-completing sub-tasks escalate within a bounded count (no infinite loop)', async () => {
    clearGateState();
    setReady({ inProgress: [{ id: TASK }], ready: [], recentlyCompleted: [] });
    setPhase('coding');
    subtaskState.write(TASK, [{ id: '01', status: 'pending' }]); // total 1 → small derived cap

    let turns = 0, escalated = false;
    for (let i = 0; i < 200; i++) {
      // touch a file each turn so it's the CAP (not no-progress) that stops it
      fs.writeFileSync(path.join(STATE, `churn-${i}.tmp`), String(i));
      const r = await checkWorkspaceStopGates({ parsedInput: {} });
      if (r && r.shouldReturn) { turns++; continue; }
      escalated = true; break;
    }
    assert.ok(escalated, 'must stop eventually');
    assert.ok(turns < 60, `bounded by derived cap, got ${turns}`);
    assert.ok(readMessages(ROOT, { type: 'worker-blocked' }).length >= 1, 'escalates ## BLOCKED');
  });

  it('no-progress: identical fingerprint escalates after noProgressK', async () => {
    clearGateState();
    setReady({ inProgress: [{ id: TASK }], ready: [], recentlyCompleted: [] });
    setPhase('coding');
    subtaskState.write(TASK, [{ id: '01', status: 'pending' }, { id: '02', status: 'pending' }]);

    // No file changes, remaining never changes ⇒ fingerprint frozen.
    let stopped = false;
    for (let i = 0; i < 10; i++) {
      const r = await checkWorkspaceStopGates({ parsedInput: {} });
      if (!r || !r.shouldReturn) { stopped = true; break; }
    }
    assert.ok(stopped, 'frozen progress must trigger escalation+stop');
    assert.ok(readMessages(ROOT, { type: 'worker-blocked' }).length >= 1);
  });
});

describe('S6 — solo isolation', () => {
  it('does not force continuation outside worker mode', async () => {
    clearGateState();
    setReady({ inProgress: [{ id: TASK }], ready: [] });
    setPhase('coding');
    subtaskState.write(TASK, [{ id: '01', status: 'pending' }]);

    const savedWsRoot = process.env.WOGI_WORKSPACE_ROOT;
    const savedRepo = process.env.WOGI_REPO_NAME;
    delete process.env.WOGI_WORKSPACE_ROOT;
    delete process.env.WOGI_REPO_NAME;
    try {
      const r = await checkWorkspaceStopGates({ parsedInput: {} });
      // No worker env ⇒ continuation gate is a no-op; the gate sequence must not
      // force a sustained-execution continuation.
      const forcedSustained = Boolean(r && r.shouldReturn && /SUSTAINED EXECUTION/.test(r.result?.stopReason || ''));
      assert.equal(forcedSustained, false);
    } finally {
      process.env.WOGI_WORKSPACE_ROOT = savedWsRoot;
      process.env.WOGI_REPO_NAME = savedRepo;
    }
  });
});
