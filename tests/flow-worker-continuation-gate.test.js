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

  // RC1 (wf-e5e57361): an in-progress worker in an active phase with NO
  // decomposed ledger (total=0 — parked before TodoWrite) MUST NOT idle
  // silently — it drives a proceed-or-escalate stall continuation instead.
  // (Was previously a silent allow-stop = the bug.)
  it('FIRES a stall continuation when there is no ledger in an active phase (never idles)', () => {
    const r = call({ subtaskState: fakeSubtaskState(0, 0), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, true);
    assert.equal(r.reason, 'in-progress-stall');
    assert.match(r.stopReason, /PARKED|SUSTAINED EXECUTION/);
    assert.match(r.stopReason, /Do NOT create a git worktree/);
  });

  // Completion boundary: a ledger existed and ALL sub-tasks are done (total>0,
  // remaining=0) → allow a clean stop so `flow done` can run (S6 behavior).
  it('allows a clean stop when the ledger is complete (total>0, remaining=0)', () => {
    const r = call({ subtaskState: fakeSubtaskState(0, 3), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, false);
    assert.equal(r.reason, 'subtasks-complete');
  });

  // RC1: parked in an approval phase (spec_review) MUST NOT idle silently.
  it('FIRES a stall continuation in a parked phase (spec_review) instead of idling', () => {
    setup({ phase: 'spec_review' });
    const r = call({ subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, true);
    assert.equal(r.reason, 'in-progress-stall');
    assert.match(r.stopReason, /spec_review/);
    assert.match(r.stopReason, /## QUESTION:/);
  });

  // Genuinely non-actionable phases (completing) still allow a normal stop.
  it('does NOT fire in a non-actionable phase (completing)', () => {
    setup({ phase: 'completing' });
    const r = call({ subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-1' });
    assert.equal(r.fired, false);
    assert.match(r.reason, /phase-not-actionable/);
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

describe('worker-continuation-gate: stall fallback (RC1, never silent idle)', () => {
  beforeEach(() => setup({ phase: 'spec_review' }));

  it('escalates to the manager after noProgressK stall turns, never silently idles', () => {
    const st = fakeSubtaskState(3);
    const frozen = () => 'frozen';
    // K=3 in baseConfig. Stall fires while making no progress, then escalates.
    const r1 = call({ subtaskState: st, fingerprintFn: frozen }); // streak 0 → fire
    assert.equal(r1.fired, true);
    assert.equal(r1.reason, 'in-progress-stall');
    assert.equal(call({ subtaskState: st, fingerprintFn: frozen }).fired, true); // streak 1 → fire
    assert.equal(call({ subtaskState: st, fingerprintFn: frozen }).fired, true); // streak 2 → fire
    const rEsc = call({ subtaskState: st, fingerprintFn: frozen });              // streak 3 == K → escalate
    assert.equal(rEsc.fired, false);
    assert.equal(rEsc.reason, 'stall-escalated');
    assert.equal(rEsc.escalated, true);
    // A worker-blocked message was written to the bus (escalation, not silent idle).
    const msgs = fs.readdirSync(path.join(TMP, '.workspace', 'messages'));
    assert.ok(msgs.length >= 1, 'expected an escalation message on the bus');
  });

  it('every stall turn is either a continuation or an escalation — never a silent allow without escalation', () => {
    const st = fakeSubtaskState(0, 0); // no ledger (total=0), active phase
    setup({ phase: 'coding' });
    const frozen = () => 'frozen';
    for (let i = 0; i < 10; i++) {
      const r = call({ subtaskState: st, fingerprintFn: frozen });
      if (r.fired) {
        assert.equal(r.decision, 'continue');
      } else {
        // The only allowed non-fire is an escalation (or already-escalated).
        assert.ok(/escalat/.test(r.reason), `unexpected silent allow: ${r.reason}`);
      }
    }
  });

  it('autonomous mode tailors the directive to "pre-approved → proceed"', () => {
    fs.writeFileSync(path.join(STATE, 'session-state.json'), JSON.stringify({ autonomousMode: { active: true } }));
    const r = call({ subtaskState: fakeSubtaskState(3), fingerprintFn: () => 'fp-x' });
    assert.equal(r.fired, true);
    assert.match(r.stopReason, /PRE-APPROVED/);
  });

  // F1 regression (found in /wogi-review of this fix): the stall and happy
  // paths share the `escalated` flag, so they MUST share the fingerprint field
  // too — otherwise a mode transition AFTER an escalation gets stuck in
  // "already-escalated" because the other mode's fingerprint is null.
  it('resumes across a stall→happy mode transition after escalation (F1)', () => {
    // beforeEach set phase=spec_review (stall mode). K=3 in baseConfig.
    const frozen = () => 'frozen';
    const stallSt = fakeSubtaskState(0, 0); // no ledger
    call({ subtaskState: stallSt, fingerprintFn: frozen }); // streak 0 → fire
    call({ subtaskState: stallSt, fingerprintFn: frozen }); // streak 1 → fire
    call({ subtaskState: stallSt, fingerprintFn: frozen }); // streak 2 → fire
    const esc = call({ subtaskState: stallSt, fingerprintFn: frozen }); // streak 3 → escalate
    assert.equal(esc.reason, 'stall-escalated');
    // Manager re-dispatched; worker decomposed → happy path (remaining>0) with a
    // CHANGED fingerprint (real progress). Must RESUME, not stay escalated.
    fs.writeFileSync(path.join(STATE, 'workflow-phase.json'), JSON.stringify({ phase: 'coding', taskId: 'wf-task0001' }));
    const resumed = call({ subtaskState: fakeSubtaskState(2, 3), fingerprintFn: () => 'moved' });
    assert.equal(resumed.fired, true, 'must resume after progress, not stay already-escalated');
    assert.equal(resumed.decision, 'continue');
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
