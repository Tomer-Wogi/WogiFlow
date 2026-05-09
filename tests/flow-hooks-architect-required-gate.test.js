'use strict';

/**
 * Tests for checkArchitectRequired + writeArchitectRunMarker (wf-037f8d66 Fix 1).
 *
 * Mechanical enforcement of "Architect must run before coding for L1+ tasks."
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const gate = require('../scripts/hooks/core/architect-required-gate');

// ============================================================
// requiresArchitect
// ============================================================

test('requiresArchitect — L0 task requires', () => {
  assert.equal(gate.requiresArchitect({ level: 'L0' }), true);
});

test('requiresArchitect — L1 task requires', () => {
  assert.equal(gate.requiresArchitect({ level: 'L1' }), true);
});

test('requiresArchitect — L2 task does NOT require', () => {
  assert.equal(gate.requiresArchitect({ level: 'L2' }), false);
});

test('requiresArchitect — L3 task does NOT require', () => {
  assert.equal(gate.requiresArchitect({ level: 'L3' }), false);
});

test('requiresArchitect — missing/null/non-object → does not require', () => {
  assert.equal(gate.requiresArchitect(null), false);
  assert.equal(gate.requiresArchitect(undefined), false);
  assert.equal(gate.requiresArchitect({}), false);
  assert.equal(gate.requiresArchitect({ level: 'unknown' }), false);
});

test('requiresArchitect — case-insensitive level', () => {
  assert.equal(gate.requiresArchitect({ level: 'l1' }), true);
  assert.equal(gate.requiresArchitect({ level: 'l2' }), false);
});

// ============================================================
// isGateEnabled
// ============================================================

test('isGateEnabled — IGR enabled, no override → enabled', () => {
  assert.equal(gate.isGateEnabled({ intentGroundedReasoning: { enabled: true } }), true);
});

test('isGateEnabled — IGR disabled → gate disabled', () => {
  assert.equal(gate.isGateEnabled({ intentGroundedReasoning: { enabled: false } }), false);
});

test('isGateEnabled — IGR enabled but explicit gate disable → disabled', () => {
  assert.equal(gate.isGateEnabled({
    intentGroundedReasoning: { enabled: true },
    architectRequiredGate: { enabled: false }
  }), false);
});

test('isGateEnabled — missing IGR config → disabled (safe default)', () => {
  assert.equal(gate.isGateEnabled({}), false);
  assert.equal(gate.isGateEnabled(null), false);
});

// ============================================================
// checkArchitectRequired — gate decision
// ============================================================

const baseConfig = { intentGroundedReasoning: { enabled: true } };

test('checkArchitectRequired — non-mutation tool (Read) → not blocked', () => {
  const r = gate.checkArchitectRequired({
    phase: 'coding', taskId: 'wf-test', taskMeta: { level: 'L1' },
    config: baseConfig, toolName: 'Read'
  });
  assert.equal(r.blocked, false);
});

test('checkArchitectRequired — non-coding phase → not blocked', () => {
  const r = gate.checkArchitectRequired({
    phase: 'spec_review', taskId: 'wf-test', taskMeta: { level: 'L1' },
    config: baseConfig, toolName: 'Edit'
  });
  assert.equal(r.blocked, false);
});

test('checkArchitectRequired — L2 in coding → not blocked (skips spec_review correctly)', () => {
  const r = gate.checkArchitectRequired({
    phase: 'coding', taskId: 'wf-test', taskMeta: { level: 'L2' },
    config: baseConfig, toolName: 'Edit'
  });
  assert.equal(r.blocked, false);
});

test('checkArchitectRequired — IGR disabled → not blocked', () => {
  const r = gate.checkArchitectRequired({
    phase: 'coding', taskId: 'wf-test', taskMeta: { level: 'L1' },
    config: { intentGroundedReasoning: { enabled: false } }, toolName: 'Edit'
  });
  assert.equal(r.blocked, false);
});

test('checkArchitectRequired — no taskId → not blocked', () => {
  const r = gate.checkArchitectRequired({
    phase: 'coding', taskId: null, taskMeta: { level: 'L1' },
    config: baseConfig, toolName: 'Edit'
  });
  assert.equal(r.blocked, false);
});

test('checkArchitectRequired — L1 + coding + IGR + no Architect run → BLOCKED', () => {
  const r = gate.checkArchitectRequired({
    phase: 'coding',
    taskId: 'wf-NOMARKER12345',
    taskMeta: { level: 'L1' },
    config: baseConfig,
    toolName: 'Edit'
  });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'architect-required');
  assert.match(r.message, /ARCHITECT-REQUIRED/);
  assert.match(r.message, /wf-NOMARKER12345/);
});

// ============================================================
// writeArchitectRunMarker + hasArchitectRun
// ============================================================

test('writeArchitectRunMarker — writes file; hasArchitectRun returns true', () => {
  const taskId = 'wf-TESTMARKER' + Date.now();
  try {
    const result = gate.writeArchitectRunMarker({
      taskId, model: 'opus', plan: { sections: 8 }
    });
    assert.equal(result.written, true);
    assert.equal(gate.hasArchitectRun(taskId), true);

    const written = JSON.parse(fs.readFileSync(result.path, 'utf-8'));
    assert.equal(written.taskId, taskId);
    assert.equal(written.model, 'opus');
    assert.equal(typeof written.completedAt, 'string');
  } finally {
    const p = gate.getArchitectRunPath(taskId);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('writeArchitectRunMarker — null/missing taskId → no write', () => {
  const r = gate.writeArchitectRunMarker({});
  assert.equal(r.written, false);
});

test('hasArchitectRun — non-existent task → false', () => {
  assert.equal(gate.hasArchitectRun('wf-NEVER12345'), false);
});

// ============================================================
// End-to-end
// ============================================================

test('end-to-end — write marker then gate passes', () => {
  const taskId = 'wf-E2E' + Date.now();
  try {
    gate.writeArchitectRunMarker({ taskId, model: 'opus' });
    const r = gate.checkArchitectRequired({
      phase: 'coding', taskId, taskMeta: { level: 'L1' },
      config: baseConfig, toolName: 'Edit'
    });
    assert.equal(r.blocked, false);
  } finally {
    const p = gate.getArchitectRunPath(taskId);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  }
});
