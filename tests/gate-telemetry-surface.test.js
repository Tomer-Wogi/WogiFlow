'use strict';

/**
 * Tests for B7 gate-telemetry surfacing (wf-c3b5afab).
 *
 * Covers: printGateTelemetryWatch() in flow-session-end.js
 *         printGateMissRateSummary() in flow-health.js
 *
 * Verifies: empty-log path, populated-log path, threshold boundary (0.10 inclusive).
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/gate-telemetry-surface.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Capture console.log output for assertion. Restore in after().
const origLog = console.log;
let captured = [];

before(() => {
  console.log = (...args) => {
    captured.push(args.map(a => (typeof a === 'string' ? a : String(a))).join(' '));
  };
});

after(() => {
  console.log = origLog;
});

function reset() {
  captured = [];
}

// Strip ANSI color codes so assertions match regardless of TTY.
function plain(line) {
  return line.replace(/\[[0-9;]*m/g, '');
}

function joinedPlain() {
  return captured.map(plain).join('\n');
}

// Explicit .js — a legacy bash script scripts/flow-session-end (no extension)
// shadows Node module resolution of the same basename.
const { printGateTelemetryWatch, MISS_RATE_THRESHOLD } = require('../scripts/flow-session-end.js');
const { printGateMissRateSummary, GATE_MISS_RATE_THRESHOLD } = require('../scripts/flow-health.js');

describe('printGateTelemetryWatch — session-end surface', () => {
  it('emits "No telemetry yet (baseline)" when stats has empty perGate', () => {
    reset();
    printGateTelemetryWatch({ perGate: {} });
    const out = joinedPlain();
    assert.match(out, /Gate Telemetry — Miss Rate Watch/);
    assert.match(out, /No telemetry yet \(baseline\)/);
  });

  it('emits baseline line when stats is null/undefined', () => {
    reset();
    printGateTelemetryWatch(null);
    assert.match(joinedPlain(), /No telemetry yet \(baseline\)/);
  });

  it('emits baseline line when perGate is missing', () => {
    reset();
    printGateTelemetryWatch({});
    assert.match(joinedPlain(), /No telemetry yet \(baseline\)/);
  });

  it('emits "miss rate unmeasurable" when gates have 0 PASS events', () => {
    reset();
    printGateTelemetryWatch({
      perGate: {
        'no-pass-gate': {
          invocations: 2,
          verdicts: { PASS: 0, CONCERN: 2, FAIL: 0, ERROR: 0, SKIP: 0 },
          missedAfterPass: 0,
          missRate: 0,
        },
      },
    });
    assert.match(joinedPlain(), /miss rate unmeasurable/);
  });

  it('ranks top-3 gates by missRate descending and flags those >= threshold', () => {
    reset();
    printGateTelemetryWatch({
      perGate: {
        'clean-gate':       { verdicts: { PASS: 10 }, missedAfterPass: 0, missRate: 0.00 },
        'mid-gate':         { verdicts: { PASS: 10 }, missedAfterPass: 1, missRate: 0.05 },
        'rubber-gate':      { verdicts: { PASS: 10 }, missedAfterPass: 4, missRate: 0.40 },
        'borderline-gate':  { verdicts: { PASS: 10 }, missedAfterPass: 1, missRate: 0.10 },
      },
    });
    const out = joinedPlain();

    const rubberIdx = out.indexOf('rubber-gate');
    const borderlineIdx = out.indexOf('borderline-gate');
    const midIdx = out.indexOf('mid-gate');
    const cleanIdx = out.indexOf('clean-gate');

    assert.ok(rubberIdx >= 0, 'rubber-gate should be printed');
    assert.ok(borderlineIdx >= 0, 'borderline-gate should be printed');
    assert.ok(midIdx >= 0, 'mid-gate should be printed');
    assert.ok(rubberIdx < borderlineIdx, 'rubber-gate (40%) should come before borderline-gate (10%)');
    assert.ok(borderlineIdx < midIdx, 'borderline-gate (10%) should come before mid-gate (5%)');
    assert.equal(cleanIdx, -1, 'clean-gate is outside top-3 and must not be printed');

    assert.match(out, /rubber-gate.*rubber-stamping risk/);
    assert.match(out, /borderline-gate.*rubber-stamping risk/,
      'missRate exactly at threshold (0.10) must be flagged — inclusive boundary');
  });

  it('does NOT flag gates below threshold as rubber-stamping', () => {
    reset();
    printGateTelemetryWatch({
      perGate: {
        'just-under': { verdicts: { PASS: 100 }, missedAfterPass: 9, missRate: 0.09 },
      },
    });
    const out = joinedPlain();
    assert.match(out, /just-under/);
    assert.doesNotMatch(out, /just-under.*rubber-stamping risk/);
  });

  it('exports a 10% threshold constant', () => {
    assert.equal(MISS_RATE_THRESHOLD, 0.10);
  });
});

describe('printGateMissRateSummary — health surface', () => {
  it('emits baseline line when stats is empty', () => {
    reset();
    printGateMissRateSummary({ perGate: {} });
    assert.match(joinedPlain(), /No telemetry yet \(baseline\)/);
  });

  it('emits baseline line when stats is null', () => {
    reset();
    printGateMissRateSummary(null);
    assert.match(joinedPlain(), /No telemetry yet \(baseline\)/);
  });

  it('reports 0 gates above threshold when all are clean', () => {
    reset();
    printGateMissRateSummary({
      perGate: {
        'clean-a': { verdicts: { PASS: 5 }, missedAfterPass: 0, missRate: 0 },
        'clean-b': { verdicts: { PASS: 10 }, missedAfterPass: 0, missRate: 0 },
      },
    });
    const out = joinedPlain();
    assert.match(out, /Gate missRate: 0 gates above 10% threshold/);
  });

  it('counts gates above threshold (inclusive at 10%)', () => {
    reset();
    printGateMissRateSummary({
      perGate: {
        'clean':      { verdicts: { PASS: 10 }, missedAfterPass: 0, missRate: 0.00 },
        'borderline': { verdicts: { PASS: 10 }, missedAfterPass: 1, missRate: 0.10 },
        'rubber':     { verdicts: { PASS: 10 }, missedAfterPass: 3, missRate: 0.30 },
      },
    });
    const out = joinedPlain();
    assert.match(out, /Gate missRate: 2 gate\(s\) above 10% threshold \(see \/wogi-gate-stats\)/);
    assert.match(out, /borderline/);
    assert.match(out, /rubber/);
    assert.doesNotMatch(out, /\bclean:/); // clean should not appear in offender list
  });

  it('excludes gates with 0 PASS events from the counter', () => {
    reset();
    printGateMissRateSummary({
      perGate: {
        'no-pass': { verdicts: { PASS: 0 }, missedAfterPass: 0, missRate: 0.50 },
      },
    });
    assert.match(joinedPlain(), /Gate missRate: 0 gates above 10% threshold/);
  });

  it('exports a 10% threshold constant matching session-end', () => {
    assert.equal(GATE_MISS_RATE_THRESHOLD, 0.10);
    assert.equal(GATE_MISS_RATE_THRESHOLD, MISS_RATE_THRESHOLD);
  });
});
