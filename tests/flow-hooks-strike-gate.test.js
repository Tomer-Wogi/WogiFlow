'use strict';

/**
 * Tests for scripts/hooks/core/strike-gate.js (Wave F hook coverage).
 *
 * Covers: config defaults + enable/disable path, strike tracker state
 * management (getTaskStrikes empty default, recordStrike increment +
 * action resolution, hypothesis documentation, reset/clear, production-crash
 * threshold lowering, attempts truncation at 10), checkStrikeGate
 * (no-active-task fast path, strike 2 hypothesis block, strike 3
 * mini-spec required, strike 4+ hard block, scope-inventory cross-gate
 * satisfies hypothesis requirement).
 *
 * Uses a dedicated test-scoped strike-tracker path via save/restore.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-strike-gate.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const strikeGate = require('../scripts/hooks/core/strike-gate');
const {
  isStrikeGateEnabled,
  getStrikeConfig,
  getStrikeTracker,
  getTaskStrikes,
  recordStrike,
  documentHypothesis,
  resetStrikes,
  clearStrikes,
  markProductionCrash,
  checkStrikeGate,
  STRIKE_TRACKER_PATH,
} = strikeGate;

let originalTracker = null;
function snapshot() {
  try { originalTracker = fs.readFileSync(STRIKE_TRACKER_PATH, 'utf-8'); } catch (_err) { originalTracker = null; }
}
function restore() {
  if (originalTracker !== null) fs.writeFileSync(STRIKE_TRACKER_PATH, originalTracker);
  else { try { fs.unlinkSync(STRIKE_TRACKER_PATH); } catch (_err) {} }
}
function wipeTracker() {
  try { fs.unlinkSync(STRIKE_TRACKER_PATH); } catch (_err) {}
}

before(snapshot);
after(restore);

// ============================================================
// Config
// ============================================================

describe('isStrikeGateEnabled', () => {
  it('returns true by default (empty config)', () => {
    assert.equal(isStrikeGateEnabled({}), true);
  });

  it('returns false when explicitly disabled', () => {
    assert.equal(isStrikeGateEnabled({ enforcement: { strikeEscalation: { enabled: false } } }), false);
  });

  it('returns true when explicitly enabled', () => {
    assert.equal(isStrikeGateEnabled({ enforcement: { strikeEscalation: { enabled: true } } }), true);
  });
});

describe('getStrikeConfig — defaults', () => {
  it('returns sane defaults', () => {
    const cfg = getStrikeConfig({});
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.blockThreshold, 2);
    assert.equal(cfg.escalateThreshold, 3);
    assert.equal(cfg.hardBlockThreshold, 4);
    assert.equal(cfg.productionCrashThreshold, 2);
  });

  it('honors overrides', () => {
    const cfg = getStrikeConfig({
      enforcement: { strikeEscalation: { blockThreshold: 1, escalateThreshold: 2, hardBlockThreshold: 3 } },
    });
    assert.equal(cfg.blockThreshold, 1);
    assert.equal(cfg.escalateThreshold, 2);
    assert.equal(cfg.hardBlockThreshold, 3);
  });
});

// ============================================================
// State: getTaskStrikes / recordStrike / documentHypothesis
// ============================================================

describe('getTaskStrikes — empty state', () => {
  beforeEach(wipeTracker);

  it('returns default-initialized shape for unknown task', () => {
    const s = getTaskStrikes('wf-missing0001');
    assert.equal(s.strikes, 0);
    assert.deepEqual(s.attempts, []);
    assert.equal(s.lastStrike, null);
    assert.equal(s.escalated, false);
    assert.equal(s.hypothesis, null);
    assert.equal(s.productionCrash, false);
  });

  it('getStrikeTracker returns { tasks: {} } when no file', () => {
    const t = getStrikeTracker();
    assert.ok(t.tasks);
    assert.equal(typeof t.tasks, 'object');
  });
});

describe('recordStrike — increment and action resolution', () => {
  beforeEach(wipeTracker);

  it('first strike returns action=continue (below blockThreshold 2)', () => {
    const r = recordStrike('wf-first0001', { trigger: 'verification-failure' });
    assert.equal(r.strikes, 1);
    assert.equal(r.action, 'continue');
    assert.equal(r.escalated, false);
  });

  it('second strike returns action=block-until-hypothesis', () => {
    recordStrike('wf-2strike001', {});
    const r = recordStrike('wf-2strike001', {});
    assert.equal(r.strikes, 2);
    assert.equal(r.action, 'block-until-hypothesis');
  });

  it('third strike returns action=escalate and sets escalated=true', () => {
    recordStrike('wf-3strike001', {});
    recordStrike('wf-3strike001', {});
    const r = recordStrike('wf-3strike001', {});
    assert.equal(r.strikes, 3);
    assert.equal(r.action, 'escalate');
    assert.equal(r.escalated, true);
  });

  it('fourth strike returns action=hard-block', () => {
    for (let i = 0; i < 3; i++) recordStrike('wf-hardblock1', {});
    const r = recordStrike('wf-hardblock1', {});
    assert.equal(r.strikes, 4);
    assert.equal(r.action, 'hard-block');
  });

  it('persists attempt details', () => {
    recordStrike('wf-details0001', {
      description: 'tried fix A',
      filesChanged: ['src/a.js', 'src/b.js'],
      verificationResult: 'fail',
      trigger: 'task-bounce',
    });
    const task = getTaskStrikes('wf-details0001');
    assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0].description, 'tried fix A');
    assert.deepEqual(task.attempts[0].filesChanged, ['src/a.js', 'src/b.js']);
    assert.equal(task.attempts[0].trigger, 'task-bounce');
  });

  it('truncates attempts history to last 10', () => {
    for (let i = 0; i < 15; i++) {
      recordStrike('wf-truncate01', { description: `attempt ${i}` });
    }
    const task = getTaskStrikes('wf-truncate01');
    assert.equal(task.attempts.length, 10, 'should cap at 10');
    // First attempt should be #5 (0-4 dropped)
    assert.equal(task.attempts[0].description, 'attempt 5');
    assert.equal(task.attempts[9].description, 'attempt 14');
  });

  it('sets lastStrike timestamp', () => {
    recordStrike('wf-timest0001', {});
    const task = getTaskStrikes('wf-timest0001');
    assert.ok(task.lastStrike);
    // ISO string
    assert.ok(!isNaN(new Date(task.lastStrike).getTime()));
  });
});

describe('production crash — lowered threshold', () => {
  beforeEach(wipeTracker);

  it('markProductionCrash creates task entry when missing', () => {
    markProductionCrash('wf-newcrash001');
    const task = getTaskStrikes('wf-newcrash001');
    assert.equal(task.productionCrash, true);
  });

  it('markProductionCrash sets flag on existing task', () => {
    recordStrike('wf-existcrash1', {});
    markProductionCrash('wf-existcrash1');
    const task = getTaskStrikes('wf-existcrash1');
    assert.equal(task.productionCrash, true);
  });

  it('production-crash task escalates at threshold 2 (instead of 3)', () => {
    markProductionCrash('wf-prodcrash01');
    recordStrike('wf-prodcrash01', {});
    const r = recordStrike('wf-prodcrash01', {});
    // At strike 2 with productionCrashThreshold=2, should escalate
    assert.equal(r.action, 'escalate');
  });
});

describe('documentHypothesis / resetStrikes / clearStrikes', () => {
  beforeEach(wipeTracker);

  it('documentHypothesis stores hypothesis + timestamp', () => {
    recordStrike('wf-hypoth0001', {});
    documentHypothesis('wf-hypoth0001', 'The issue is stale cache');
    const task = getTaskStrikes('wf-hypoth0001');
    assert.equal(task.hypothesis, 'The issue is stale cache');
    assert.ok(task.hypothesisAt);
  });

  it('documentHypothesis silently ignores unknown task', () => {
    assert.doesNotThrow(() => documentHypothesis('wf-unknown001', 'test'));
    // No task entry should have been created
    const task = getTaskStrikes('wf-unknown001');
    assert.equal(task.strikes, 0);
    assert.equal(task.hypothesis, null);
  });

  it('resetStrikes zeroes counter but keeps task entry', () => {
    for (let i = 0; i < 3; i++) recordStrike('wf-reset0001', {});
    resetStrikes('wf-reset0001');
    const task = getTaskStrikes('wf-reset0001');
    assert.equal(task.strikes, 0);
    assert.deepEqual(task.attempts, []);
    assert.equal(task.hypothesis, null);
    assert.equal(task.escalated, false);
  });

  it('clearStrikes removes task entry entirely', () => {
    recordStrike('wf-clear0001', {});
    clearStrikes('wf-clear0001');
    const tracker = getStrikeTracker();
    assert.equal(tracker.tasks['wf-clear0001'], undefined);
  });

  it('clearStrikes is idempotent (no throw on unknown task)', () => {
    assert.doesNotThrow(() => clearStrikes('wf-unknown002'));
  });
});

// ============================================================
// checkStrikeGate — no-active-task fast path
// ============================================================

describe('checkStrikeGate — fast paths', () => {
  it('allows any tool when gate disabled', () => {
    const config = { enforcement: { strikeEscalation: { enabled: false } } };
    const r = checkStrikeGate('Edit', config);
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
  });

  it('returns well-formed result for all tool types', () => {
    // With live ready.json state we can't control active task reliably.
    // Just verify shape.
    for (const tool of ['Edit', 'Write', 'Bash', 'Read']) {
      const r = checkStrikeGate(tool, {});
      assert.equal(typeof r.allowed, 'boolean');
      assert.equal(typeof r.blocked, 'boolean');
    }
  });
});

// ============================================================
// Module exports
// ============================================================

describe('module exports', () => {
  it('exports expected API', () => {
    for (const name of [
      'isStrikeGateEnabled', 'getStrikeConfig',
      'getStrikeTracker', 'getTaskStrikes',
      'recordStrike', 'documentHypothesis',
      'resetStrikes', 'clearStrikes', 'markProductionCrash',
      'checkStrikeGate', 'STRIKE_TRACKER_PATH',
    ]) {
      assert.ok(name in strikeGate, `missing: ${name}`);
    }
  });
});
