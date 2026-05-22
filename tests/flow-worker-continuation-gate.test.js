'use strict';

/**
 * Tests for scripts/hooks/core/worker-continuation-gate.js
 * (epic-workspace-sustained-exec / S2, wf-aee4a4fa).
 *
 * Covers: worker-mode guard, active-phase gating, remaining-subtask firing,
 * per-task iteration cap escalation, no-progress escalation (fingerprint),
 * progress-resume after escalation, derivedCap math, fail-open.
 *
 * Run: NODE_ENV=test node --test tests/flow-worker-continuation-gate.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const gate = require('../scripts/hooks/core/worker-continuation-gate');

let TMP, STATE;
function setup({ phase = 'coding', inProgressId = 'wf-task0001' } = {}) {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-contgate-'));
  STATE = path.join(TMP, '.workflow', 'state');
  fs.mkdirSync(STATE, { recursive: true });
  fs.mkdirSync(path.join(TMP, '.workspace', 'messages'), { recursive: true });
  const ready = inProgressId ? { inProgress: [{ id: inProgressId, title: 'T' }] } : { inProgress: [] };
  fs.writeFileSync(path.join(STATE, 'ready.json'), JSON.stringify(ready));
  fs.writeFileSync(path.join(STATE, 'workflow-phase.json'), JSON.stringify({ phase, taskId: inProgressId }));
}
afterEach(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_err) {} });

const baseConfig = { workspace: { continuationGate: { enabled: true, perSubtaskTurns: 6, capBuffer: 4, maxContinuations: 60, noProgressK: 3 } } };
const workerEnv = (extra = {}) => ({ WOGI_WORKSPACE_ROOT: TMP, WOGI_REPO_NAME: 'backend', ...extra });
function fakeSubtaskState(remaining, total = remaining) {
  return { summary: () => ({ total, remaining, completed: total - remaining, blocked: 0 }) };
}
function call(opts) {
  return gate.checkWorkerContinuation({
    config: baseConfig,
    env: workerEnv(),
    stateDir: STATE,
    root: TMP,
    ...opts
  });
}

describe('worker-continuation-gate: firing conditions', () => {
  beforeEach(() => setup());

  it('FIRES when worker + in-progress + coding + remaining>0', () => {
    const r = call({ subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, true);
    assert.equal(r.decision, 'continue');
    assert.match(r.stopReason, /SUSTAINED EXECUTION/);
    assert.match(r.stopReason, /3 of 3 sub-task/);
    assert.equal(r.attempt, 1);
  });

  it('does NOT fire when remaining = 0 (allows stop)', () => {
    const r = call({ subtaskState: fakeSubtaskState(0, 3), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, false);
    assert.equal(r.reason, 'no-remaining-subtasks');
  });

  it('does NOT fire in a non-active phase (spec_review)', () => {
    setup({ phase: 'spec_review' });
    const r = call({ subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, false);
    assert.match(r.reason, /phase-not-active/);
  });

  it('does NOT fire when no task in progress', () => {
    setup({ inProgressId: null });
    const r = call({ subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, false);
    assert.equal(r.reason, 'no-in-progress');
  });

  it('does NOT fire outside worker mode (solo untouched)', () => {
    const r = gate.checkWorkerContinuation({
      config: baseConfig, env: { /* no workspace vars */ }, stateDir: STATE, root: TMP,
      subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-1'
    });
    assert.equal(r.fired, false);
    assert.equal(r.reason, 'not-worker');
  });

  it('respects enabled:false', () => {
    const r = gate.checkWorkerContinuation({
      config: { workspace: { continuationGate: { enabled: false } } },
      env: workerEnv(), stateDir: STATE, root: TMP,
      subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-1'
    });
    assert.equal(r.fired, false);
    assert.equal(r.reason, 'disabled');
  });
});

describe('worker-continuation-gate: no-progress escalation', () => {
  beforeEach(() => setup());

  it('escalates after noProgressK identical fingerprints', () => {
    const fp = () => 'frozen';
    const st = fakeSubtaskState(3);
    // attempt 1 sets baseline fingerprint (streak 0) → fires
    assert.equal(call({ subtaskState: st, fingerprintFn: fp }).fired, true);
    // attempts 2,3: same fingerprint → streak grows; with noProgressK=3, escalates on the 4th evaluation
    assert.equal(call({ subtaskState: st, fingerprintFn: fp }).fired, true);  // streak 1
    assert.equal(call({ subtaskState: st, fingerprintFn: fp }).fired, true);  // streak 2
    const r = call({ subtaskState: st, fingerprintFn: fp });                  // streak 3 == K → escalate
    assert.equal(r.fired, false);
    assert.equal(r.reason, 'no-progress-escalated');
    assert.equal(r.escalated, true);
  });

  it('does NOT escalate when fingerprint keeps changing (progress)', () => {
    const st = fakeSubtaskState(3);
    let n = 0;
    const fp = () => `fp-${n++}`;
    for (let i = 0; i < 6; i++) {
      assert.equal(call({ subtaskState: st, fingerprintFn: fp }).fired, true);
    }
  });

  it('resumes after escalation when progress reappears', () => {
    const st = fakeSubtaskState(3);
    const frozen = () => 'frozen';
    for (let i = 0; i < 4; i++) call({ subtaskState: st, fingerprintFn: frozen });
    // now escalated → allow
    assert.equal(call({ subtaskState: st, fingerprintFn: frozen }).reason, 'already-escalated');
    // fingerprint changes → resumes
    const r = call({ subtaskState: st, fingerprintFn: () => 'moved' });
    assert.equal(r.fired, true);
  });
});

describe('worker-continuation-gate: per-task cap', () => {
  beforeEach(() => setup());

  it('escalates when count reaches derived cap', () => {
    // total=1 → cap = 1*perSubtaskTurns(6 here override) + capBuffer; use small cap config
    const cfg = { workspace: { continuationGate: { enabled: true, perSubtaskTurns: 2, capBuffer: 1, maxContinuations: 60, noProgressK: 99 } } };
    const st = fakeSubtaskState(1, 1); // total 1 → cap = 1*2+1 = 3
    let last;
    let nf = 0;
    for (let i = 0; i < 10; i++) {
      last = gate.checkWorkerContinuation({ config: cfg, env: workerEnv(), stateDir: STATE, root: TMP, subtaskState: st, fingerprintFn: () => `x${nf++}` });
      if (!last.fired) break;
    }
    assert.equal(last.fired, false);
    assert.equal(last.reason, 'cap-escalated');
  });

  it('derivedCap math: total*perSubtaskTurns + capBuffer, bounded by max', () => {
    assert.equal(gate.derivedCap(3, { perSubtaskTurns: 6, capBuffer: 4, maxContinuations: 60 }), 22);
    assert.equal(gate.derivedCap(100, { perSubtaskTurns: 6, capBuffer: 4, maxContinuations: 60 }), 60);
    assert.equal(gate.derivedCap(0, { perSubtaskTurns: 6, capBuffer: 4, maxContinuations: 60 }), 10);
  });
});

describe('worker-continuation-gate: counter reset on task change', () => {
  it('resets count when the in-progress task changes', () => {
    setup({ inProgressId: 'wf-aaaa1111' });
    const st = fakeSubtaskState(3);
    let nf = 0;
    call({ subtaskState: st, fingerprintFn: () => `a${nf++}` });
    call({ subtaskState: st, fingerprintFn: () => `a${nf++}` });
    let c = gate.readCounter(STATE);
    assert.equal(c.count, 2);
    // switch task
    fs.writeFileSync(path.join(STATE, 'ready.json'), JSON.stringify({ inProgress: [{ id: 'wf-bbbb2222' }] }));
    const r = call({ subtaskState: st, fingerprintFn: () => 'b0' });
    assert.equal(r.fired, true);
    assert.equal(r.attempt, 1); // reset
  });
});
