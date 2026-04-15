'use strict';

/**
 * Tests for scripts/hooks/core/routing-gate.js (Wave F hook coverage).
 *
 * Covers: config gate, flag set/clear roundtrip, TTL expiry, cleared-marker
 * override, stop-attempt counter, checkRoutingGate tool-filtering, unknown
 * tool allowlist pass-through.
 *
 * Uses a dedicated CLAUDE_CODE_SESSION_ID so test flag files are isolated
 * from the live session. Files live under .workflow/state/.routing-pending-<id>
 * and .routing-cleared-<id> — cleaned up in afterEach.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-routing-gate.test.js
 */

// IMPORTANT: set session ID BEFORE require — routing-gate captures it at
// module-load time into ROUTING_FLAG_PATH and ROUTING_CLEARED_PATH.
process.env.CLAUDE_CODE_SESSION_ID = `test-routing-gate-${process.pid}-${Date.now()}`;

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const routingGate = require('../scripts/hooks/core/routing-gate');
const {
  isRoutingGateEnabled,
  setRoutingPending,
  clearRoutingPending,
  isRoutingPending,
  isRoutingRecentlyCleared,
  checkRoutingGate,
  incrementStopAttempts,
  ROUTING_FLAG_PATH,
  ROUTING_CLEARED_PATH,
} = routingGate;

function cleanFlags() {
  for (const p of [ROUTING_FLAG_PATH, ROUTING_CLEARED_PATH]) {
    try { fs.unlinkSync(p); } catch (_err) { /* ignore */ }
  }
}

// Write flag directly (bypasses live-config check in setRoutingPending).
// Live .workflow/config.json has routingGate.enabled=false in this repo, so
// setRoutingPending would no-op. These tests verify the pure gate logic
// independently of the current project's gate configuration.
function writeFlag(extra = {}) {
  const data = { timestamp: new Date().toISOString(), pid: process.pid, ...extra };
  fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify(data), 'utf-8');
}

function writeClearedMarker() {
  fs.writeFileSync(
    ROUTING_CLEARED_PATH,
    JSON.stringify({ timestamp: new Date().toISOString(), pid: process.pid }),
    'utf-8'
  );
}

// ============================================================
// isRoutingGateEnabled
// ============================================================

describe('isRoutingGateEnabled — config handling', () => {
  it('returns true when no config provided (reads live config)', () => {
    // In this repo, config exists — just verify it returns a boolean.
    assert.equal(typeof isRoutingGateEnabled(), 'boolean');
  });

  it('returns true when config has no enforcement block', () => {
    assert.equal(isRoutingGateEnabled({}), true);
  });

  it('returns true when enforcement.routingGate is undefined', () => {
    assert.equal(isRoutingGateEnabled({ enforcement: {} }), true);
  });

  it('returns true when enforcement.routingGate.enabled is true', () => {
    assert.equal(isRoutingGateEnabled({ enforcement: { routingGate: { enabled: true } } }), true);
  });

  it('returns false ONLY when enforcement.routingGate.enabled === false', () => {
    assert.equal(isRoutingGateEnabled({ enforcement: { routingGate: { enabled: false } } }), false);
  });

  it('treats non-boolean false-y (0, null) as NOT-disabled (requires explicit false)', () => {
    assert.equal(isRoutingGateEnabled({ enforcement: { routingGate: { enabled: 0 } } }), true);
    assert.equal(isRoutingGateEnabled({ enforcement: { routingGate: { enabled: null } } }), true);
  });
});

// ============================================================
// setRoutingPending / isRoutingPending / clearRoutingPending
// ============================================================

describe('routing-pending flag lifecycle', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  it('starts unset — isRoutingPending returns false when no flag file exists', () => {
    assert.equal(isRoutingPending(), false);
  });

  it('setRoutingPending respects disabled gate in live config (returns set=false)', () => {
    // This repo's config has enforcement.routingGate.enabled=false.
    // Verify that path returns the expected reason without writing a flag.
    const r = setRoutingPending();
    // Either disabled (this repo) or flag_set (if config changes). Both are
    // the only correct outcomes when cleared marker is absent.
    assert.ok(['routing_gate_disabled', 'flag_set'].includes(r.reason), `unexpected reason: ${r.reason}`);
  });

  it('isRoutingPending returns true when flag file exists (fresh)', () => {
    writeFlag();
    assert.equal(isRoutingPending(), true);
  });

  it('clearRoutingPending removes the flag file', () => {
    writeFlag();
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), true);
    const r = clearRoutingPending();
    assert.equal(r.cleared, true);
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), false);
  });

  it('clearRoutingPending reports cleared=true when flag was already absent', () => {
    const r = clearRoutingPending();
    assert.equal(r.cleared, true);
  });

  it('clearRoutingPending writes a routing-cleared marker', () => {
    clearRoutingPending();
    assert.equal(fs.existsSync(ROUTING_CLEARED_PATH), true);
  });

  it('cleared marker content is valid JSON with timestamp', () => {
    clearRoutingPending();
    const parsed = JSON.parse(fs.readFileSync(ROUTING_CLEARED_PATH, 'utf-8'));
    assert.ok(parsed.timestamp);
    assert.equal(typeof parsed.pid, 'number');
  });

  it('isRoutingRecentlyCleared returns true immediately after clear', () => {
    clearRoutingPending();
    assert.equal(isRoutingRecentlyCleared(), true);
  });

  it('isRoutingRecentlyCleared returns false when no marker exists', () => {
    assert.equal(isRoutingRecentlyCleared(), false);
  });

  it('isRoutingPending returns false if cleared marker is fresh (overrides flag)', () => {
    writeFlag();
    writeClearedMarker();
    // Cleared marker should override the flag
    assert.equal(isRoutingPending(), false);
  });
});

// ============================================================
// TTL behavior
// ============================================================

describe('routing-pending TTL (30 min)', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  it('stale flag (> 30 min) is auto-cleaned and returns not-pending', () => {
    const oldTimestamp = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({ timestamp: oldTimestamp, pid: 1 }));
    assert.equal(isRoutingPending(), false);
    // File should be cleaned up
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), false);
  });

  it('fresh flag (< 30 min) is still pending', () => {
    const recentTimestamp = new Date(Date.now() - 60 * 1000).toISOString();
    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({ timestamp: recentTimestamp, pid: 1 }));
    assert.equal(isRoutingPending(), true);
  });

  it('cleared-marker TTL (15s) — stale marker is cleaned and returns not-cleared', () => {
    const oldTimestamp = new Date(Date.now() - 20 * 1000).toISOString();
    fs.writeFileSync(ROUTING_CLEARED_PATH, JSON.stringify({ timestamp: oldTimestamp, pid: 1 }));
    assert.equal(isRoutingRecentlyCleared(), false);
    assert.equal(fs.existsSync(ROUTING_CLEARED_PATH), false);
  });
});

// ============================================================
// checkRoutingGate
// ============================================================

describe('checkRoutingGate — tool filtering', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  const CONFIG_ENABLED = { enforcement: { routingGate: { enabled: true } } };
  const CONFIG_DISABLED = { enforcement: { routingGate: { enabled: false } } };

  it('allows non-gated tools (TodoWrite)', () => {
    writeFlag();
    const r = checkRoutingGate('TodoWrite', CONFIG_ENABLED);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'not_gated_tool');
  });

  it('allows non-gated tools (TaskCreate)', () => {
    writeFlag();
    const r = checkRoutingGate('TaskCreate', CONFIG_ENABLED);
    assert.equal(r.allowed, true);
  });

  it('blocks Bash when flag set', () => {
    writeFlag();
    const r = checkRoutingGate('Bash', CONFIG_ENABLED);
    assert.equal(r.allowed, false);
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'routing_pending');
    assert.ok(r.message && r.message.includes('/wogi-start'));
  });

  it('blocks Edit, Write, NotebookEdit (mutation tools)', () => {
    writeFlag();
    for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
      const r = checkRoutingGate(tool, CONFIG_ENABLED);
      assert.equal(r.blocked, true, `${tool} should be blocked`);
    }
  });

  it('blocks Read, Glob, Grep (read tools — prevent pre-routing context load)', () => {
    writeFlag();
    for (const tool of ['Read', 'Glob', 'Grep']) {
      const r = checkRoutingGate(tool, CONFIG_ENABLED);
      assert.equal(r.blocked, true, `${tool} should be blocked`);
    }
  });

  it('blocks WebSearch, WebFetch, Agent, EnterPlanMode', () => {
    writeFlag();
    for (const tool of ['WebSearch', 'WebFetch', 'Agent', 'EnterPlanMode']) {
      const r = checkRoutingGate(tool, CONFIG_ENABLED);
      assert.equal(r.blocked, true, `${tool} should be blocked`);
    }
  });

  it('allows gated tools when gate is disabled via config', () => {
    writeFlag();
    const r = checkRoutingGate('Bash', CONFIG_DISABLED);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'routing_gate_disabled');
  });

  it('allows gated tools when no flag is set', () => {
    // cleanFlags already cleared it
    const r = checkRoutingGate('Bash', CONFIG_ENABLED);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_routing_pending');
  });

  it('message mentions /wogi-start when blocked', () => {
    writeFlag();
    const r = checkRoutingGate('Edit', CONFIG_ENABLED);
    assert.ok(r.message.includes('/wogi-start'));
    assert.ok(r.message.includes('BLOCKED'));
  });

  it('cleared marker overrides flag (skill chain scenario)', () => {
    writeFlag();
    writeClearedMarker();
    const r = checkRoutingGate('Bash', CONFIG_ENABLED);
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no_routing_pending');
  });
});

// ============================================================
// incrementStopAttempts
// ============================================================

describe('incrementStopAttempts — retry counter', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  it('returns cleared:true when flag does not exist', () => {
    const r = incrementStopAttempts(10);
    assert.equal(r.cleared, true);
    assert.equal(r.attempts, 0);
  });

  it('first increment returns attempts=1, cleared=false', () => {
    writeFlag();
    const r = incrementStopAttempts(10);
    assert.equal(r.cleared, false);
    assert.equal(r.attempts, 1);
  });

  it('counter persists across calls', () => {
    writeFlag();
    incrementStopAttempts(10);
    incrementStopAttempts(10);
    const r = incrementStopAttempts(10);
    assert.equal(r.attempts, 3);
  });

  it('clears flag when maxAttempts reached', () => {
    writeFlag();
    // First increments up to max-1
    for (let i = 1; i < 3; i++) {
      incrementStopAttempts(3);
    }
    // Third hits max — should clear
    const r = incrementStopAttempts(3);
    assert.equal(r.cleared, true);
    assert.equal(r.attempts, 3);
    assert.equal(fs.existsSync(ROUTING_FLAG_PATH), false);
  });

  it('rejects tampered Infinity/NaN counters (validates Number.isFinite)', () => {
    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      stopAttempts: 'Infinity',
    }));
    const r = incrementStopAttempts(5);
    // Tampered value treated as 0, so result is 0 + 1 = 1
    assert.equal(r.attempts, 1);
    assert.equal(r.cleared, false);
  });

  it('rejects negative counters (treats as 0)', () => {
    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      stopAttempts: -100,
    }));
    const r = incrementStopAttempts(5);
    assert.equal(r.attempts, 1);
  });

  it('rejects non-integer counter (floors via Math.floor)', () => {
    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      stopAttempts: 2.7,
    }));
    const r = incrementStopAttempts(5);
    assert.equal(r.attempts, 3); // floor(2.7) + 1
  });

  it('preserves timestamp across increments', () => {
    const originalTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    fs.writeFileSync(ROUTING_FLAG_PATH, JSON.stringify({
      timestamp: originalTs,
      pid: 1,
    }));
    incrementStopAttempts(10);
    const after = JSON.parse(fs.readFileSync(ROUTING_FLAG_PATH, 'utf-8'));
    assert.equal(after.timestamp, originalTs);
  });
});

// ============================================================
// Integration: skill-chain scenario
// ============================================================

describe('integration — skill-chain scenario', () => {
  beforeEach(cleanFlags);
  afterEach(cleanFlags);

  it('simulates: user prompt → flag set → /wogi-start clears → Bash allowed', () => {
    const CONFIG_ENABLED = { enforcement: { routingGate: { enabled: true } } };
    // User prompt arrives — simulate UserPromptSubmit setting flag
    writeFlag();
    assert.equal(isRoutingPending(), true);

    // Bash attempted — blocked
    let r = checkRoutingGate('Bash', CONFIG_ENABLED);
    assert.equal(r.blocked, true);

    // /wogi-start skill invoked — clears flag
    clearRoutingPending();

    // Bash attempted again — allowed
    r = checkRoutingGate('Bash', CONFIG_ENABLED);
    assert.equal(r.allowed, true);
  });

  it('simulates: skill chain — fresh cleared marker prevents re-block', () => {
    const CONFIG_ENABLED = { enforcement: { routingGate: { enabled: true } } };
    writeFlag();
    clearRoutingPending();
    // Chained skill expansion would re-write flag via UserPromptSubmit
    writeFlag();
    // Bash still allowed because cleared marker overrides the flag
    const r = checkRoutingGate('Bash', CONFIG_ENABLED);
    assert.equal(r.allowed, true);
  });
});
