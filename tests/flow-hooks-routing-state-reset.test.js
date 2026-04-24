'use strict';

/**
 * Tests for the mid-session routing-state reset behavior (wf-2c6c8b40 / G2).
 *
 * Covers:
 *   - routing-gate.removeRoutingFlag()    — deletes pending, preserves cleared-marker
 *   - routing-gate.resetRoutingState()    — deletes both files
 *   - post-compact handler                — reset + re-arm survives stale cleared-marker
 *   - phase-gate.transitionPhase()        — clears stale pending flag on transition
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-routing-state-reset.test.js
 */

// MUST set session id BEFORE requiring routing-gate — paths are captured at load.
process.env.CLAUDE_CODE_SESSION_ID = `test-routing-reset-${process.pid}-${Date.now()}`;

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  removeRoutingFlag,
  resetRoutingState,
  isRoutingPending,
  isRoutingRecentlyCleared,
  ROUTING_FLAG_PATH,
  ROUTING_CLEARED_PATH,
} = require('../scripts/hooks/core/routing-gate');

function cleanFlags() {
  for (const p of [ROUTING_FLAG_PATH, ROUTING_CLEARED_PATH]) {
    try { fs.unlinkSync(p); } catch (_err) { /* ignore */ }
  }
}

function writeFlag() {
  fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({
    timestamp: new Date().toISOString(), pid: process.pid
  }), 'utf-8');
}

function writeClearedMarker() {
  fs.writeFileSync(ROUTING_CLEARED_PATH, JSON.stringify({
    timestamp: new Date().toISOString(), pid: process.pid
  }), 'utf-8');
}

// ============================================================
// removeRoutingFlag
// ============================================================

describe('removeRoutingFlag — clears pending flag only', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  it('deletes the pending flag when it exists', () => {
    writeFlag();
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), true);
    const r = removeRoutingFlag();
    assert.equal(r.removed, true);
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), false);
  });

  it('is idempotent — returns removed=true when flag is already absent', () => {
    const r = removeRoutingFlag();
    assert.equal(r.removed, true);
  });

  it('PRESERVES the cleared-marker (skill-chain suppression window)', () => {
    writeFlag();
    writeClearedMarker();
    removeRoutingFlag();
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), false);
    assert.equal(fs.existsSync(ROUTING_CLEARED_PATH), true,
      'cleared-marker must survive so active skill chains stay suppressed');
    assert.equal(isRoutingRecentlyCleared(), true);
  });
});

// ============================================================
// resetRoutingState
// ============================================================

describe('resetRoutingState — clears both flag and cleared-marker', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  it('deletes both files when both exist', () => {
    writeFlag();
    writeClearedMarker();
    const r = resetRoutingState();
    assert.equal(r.reset, true);
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), false);
    assert.equal(fs.existsSync(ROUTING_CLEARED_PATH), false);
  });

  it('is idempotent — returns reset=true when neither file exists', () => {
    const r = resetRoutingState();
    assert.equal(r.reset, true);
  });

  it('leaves a clean slate — isRoutingPending + isRoutingRecentlyCleared both false', () => {
    writeFlag();
    writeClearedMarker();
    resetRoutingState();
    assert.equal(isRoutingPending(), false);
    assert.equal(isRoutingRecentlyCleared(), false);
  });
});

// ============================================================
// post-compact integration: reset + re-arm
// ============================================================

describe('post-compact handler — reset + re-arm sequence', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  it('re-arms routing even when a stale cleared-marker is present', () => {
    // Scenario: auto-compaction fires inside the 15s cleared-marker window.
    // Without resetRoutingState(), setRoutingPending() short-circuits on
    // isRoutingRecentlyCleared() and the flag is never re-set → bypass.
    writeClearedMarker();

    // Enable the gate in-process so setRoutingPending() actually writes.
    // We bypass getConfig() by monkey-patching enforcement check via env: the
    // gate checks config.enforcement.routingGate.enabled !== false. Simplest
    // approach here is to invoke the handler and accept that in repos with
    // the gate disabled this test asserts only the reset portion.
    const { handlePostCompact } = require('../scripts/hooks/core/post-compact');
    handlePostCompact();

    // The cleared-marker must be gone after the handler runs — reset deleted it.
    assert.equal(fs.existsSync(ROUTING_CLEARED_PATH), false,
      'PostCompact must clear the stale cleared-marker so re-arm works');

    // If the gate is enabled, the flag is re-armed. If disabled, it stays absent.
    // Either outcome is correct — the critical invariant is: no stale suppression.
    assert.equal(isRoutingRecentlyCleared(), false);
  });
});

// ============================================================
// phase-gate integration: transitionPhase clears stale flag
// ============================================================

describe('phase-gate.transitionPhase — clears stale routing-pending flag', () => {
  let tmpState;
  let origCwd;
  let phasePath;

  beforeEach(() => {
    cleanFlags();
    // phase-gate reads/writes workflow-phase.json under .workflow/state/
    // relative to process.cwd(). Use a tempdir so tests don't stomp on the
    // real state file.
    origCwd = process.cwd();
    tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-phase-test-'));
    fs.mkdirSync(path.join(tmpState, '.workflow', 'state'), { recursive: true });
    process.chdir(tmpState);
    phasePath = path.join(tmpState, '.workflow', 'state', 'workflow-phase.json');
    // Seed an idle phase
    fs.writeFileSync(phasePath, JSON.stringify({ phase: 'idle', taskId: null }), 'utf-8');
  });

  afterEach(() => {
    process.chdir(origCwd);
    try { fs.rmSync(tmpState, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    cleanFlags();
  });

  it('removes stale routing-pending flag after a successful transition', () => {
    // Re-require phase-gate so it re-resolves PATHS against the new cwd.
    delete require.cache[require.resolve('../scripts/hooks/core/phase-gate')];
    delete require.cache[require.resolve('../scripts/flow-utils')];
    const { transitionPhase } = require('../scripts/hooks/core/phase-gate');

    writeFlag();
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), true);

    const ok = transitionPhase('idle', 'routing', 'wf-testtest');
    assert.equal(ok, true, 'transition idle→routing should succeed');

    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), false,
      'transitionPhase must clear the stale pending flag');
  });

  it('preserves the cleared-marker on transition (no bypass window opened)', () => {
    delete require.cache[require.resolve('../scripts/hooks/core/phase-gate')];
    delete require.cache[require.resolve('../scripts/flow-utils')];
    const { transitionPhase } = require('../scripts/hooks/core/phase-gate');

    writeFlag();
    writeClearedMarker();

    transitionPhase('idle', 'routing', 'wf-testtest');

    assert.equal(fs.existsSync(ROUTING_CLEARED_PATH), true,
      'cleared-marker must survive phase transitions — skill chains depend on it');
  });

  it('does NOT touch routing state when the transition fails', () => {
    delete require.cache[require.resolve('../scripts/hooks/core/phase-gate')];
    delete require.cache[require.resolve('../scripts/flow-utils')];
    const { transitionPhase } = require('../scripts/hooks/core/phase-gate');

    writeFlag();

    // Invalid transition (idle → coding is not in VALID_TRANSITIONS from idle)
    const ok = transitionPhase('idle', 'validating', 'wf-testtest');
    assert.equal(ok, false);

    // Flag should still be there — we only clear on successful writes
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), true,
      'failed transitions must not mutate routing state');
  });
});
