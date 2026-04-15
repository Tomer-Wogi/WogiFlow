'use strict';

/**
 * Tests for flow-capture-gate.js + flow-conclusion-classifier.js
 *
 * Covers: disabled-mode short-circuit, level threshold, no-api-key skip,
 * level helpers, normalize helper, classifier prompt builder, dangerous-key
 * guard, registry integration.
 *
 * Run: NODE_ENV=test node --test tests/flow-capture-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const captureGateModule = require('../scripts/flow-capture-gate');
const classifier = require('../scripts/flow-conclusion-classifier');
const doneGates = require('../scripts/flow-done-gates');

describe('flow-capture-gate — disabled mode', () => {
  it('returns skipped when capture.enabled is false', () => {
    const ctx = {
      taskId: 'wf-test0001',
      config: { externalMemory: { capture: { enabled: false } } },
      color: () => '',
      success: () => {},
      warn: () => {},
      error: () => {},
    };
    const r = captureGateModule.captureGate(ctx);
    assert.equal(r.passed, true);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'capture-disabled');
  });

  it('returns skipped when externalMemory section absent', () => {
    const ctx = {
      taskId: 'wf-test0001',
      config: {},
      color: () => '',
      success: () => {},
      warn: () => {},
      error: () => {},
    };
    const r = captureGateModule.captureGate(ctx);
    assert.equal(r.passed, true);
    assert.equal(r.skipped, true);
  });
});

describe('flow-capture-gate — level threshold', () => {
  it('treats L3 as below L2 (skip)', () => {
    assert.equal(captureGateModule._levelIsBelowMin('L3', 'L2'), true);
  });
  it('treats L2 as not-below L2', () => {
    assert.equal(captureGateModule._levelIsBelowMin('L2', 'L2'), false);
  });
  it('treats L1 / L0 as not-below L2', () => {
    assert.equal(captureGateModule._levelIsBelowMin('L1', 'L2'), false);
    assert.equal(captureGateModule._levelIsBelowMin('L0', 'L2'), false);
  });
  it('treats unknown levels as runnable (not skipped)', () => {
    assert.equal(captureGateModule._levelIsBelowMin('foo', 'L2'), false);
    assert.equal(captureGateModule._levelIsBelowMin(null, 'L2'), false);
  });
});

describe('flow-capture-gate — normalize helper', () => {
  it('lowercases and collapses whitespace', () => {
    assert.equal(captureGateModule._normalizeForMatch('  Foo   BAR\n\nbaz  '), 'foo bar baz');
  });
  it('handles null / undefined', () => {
    assert.equal(captureGateModule._normalizeForMatch(null), '');
    assert.equal(captureGateModule._normalizeForMatch(undefined), '');
  });
});

describe('flow-capture-gate — no-api-key skip', () => {
  it('skips with reason no-api-key when enabled but key absent', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const ctx = {
        taskId: 'wf-test0001',
        config: {
          externalMemory: {
            capture: { enabled: true, blockOnMiss: true, minLevel: 'L2' },
          },
        },
        color: () => '',
        success: () => {},
        warn: () => {},
        error: () => {},
      };
      const r = captureGateModule.captureGate(ctx);
      assert.equal(r.passed, true);
      assert.equal(r.skipped, true);
      assert.equal(r.reason, 'no-api-key');
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});

describe('flow-conclusion-classifier — CONCLUSION_KINDS', () => {
  it('exposes the canonical 6 kinds with target files', () => {
    const expected = ['decision', 'rule', 'pattern', 'rejectedAlternative', 'adr', 'productStatement'];
    for (const k of expected) {
      assert.ok(classifier.CONCLUSION_KINDS[k], `missing kind: ${k}`);
      assert.ok(classifier.CONCLUSION_KINDS[k].targetFile, `missing targetFile for ${k}`);
      assert.ok(classifier.CONCLUSION_KINDS[k].suggestedCommand, `missing suggestedCommand for ${k}`);
    }
  });
});

describe('flow-conclusion-classifier — buildPrompt', () => {
  it('includes context delimiters and schema', () => {
    const p = classifier._buildPrompt({
      taskSummary: 'Task summary text here',
      requestLogExcerpt: 'Request log excerpt here',
    });
    assert.match(p, /\[CONTEXT_START\]/);
    assert.match(p, /\[CONTEXT_END\]/);
    assert.match(p, /confidence/);
    assert.match(p, /Task summary text here/);
  });
  it('truncates oversized inputs', () => {
    const big = 'x'.repeat(50000);
    const p = classifier._buildPrompt({ taskSummary: big, requestLogExcerpt: big });
    // Total prompt should be bounded — well under 50k+50k=100k
    assert.ok(p.length < 60000, `prompt too large: ${p.length}`);
  });
});

describe('flow-conclusion-classifier — input hash', () => {
  it('returns deterministic hex strings of length 16', () => {
    const a = classifier._inputHash('hello');
    const b = classifier._inputHash('hello');
    assert.equal(a, b);
    assert.equal(a.length, 16);
    assert.match(a, /^[a-f0-9]+$/);
  });
  it('different inputs → different hashes', () => {
    const a = classifier._inputHash('hello');
    const b = classifier._inputHash('world');
    assert.notEqual(a, b);
  });
});

describe('GATE_REGISTRY integration', () => {
  it('exposes captureGate as a registered handler', () => {
    assert.ok('captureGate' in doneGates.GATE_REGISTRY);
    assert.equal(typeof doneGates.GATE_REGISTRY.captureGate, 'function');
  });
  it('runGate dispatches to captureGate without throwing', () => {
    const ctx = {
      taskId: 'wf-test0001',
      config: { externalMemory: { capture: { enabled: false } } },
      color: () => '',
      success: () => {},
      warn: () => {},
      error: () => {},
    };
    const r = doneGates.runGate('captureGate', ctx);
    assert.equal(r.passed, true);
    assert.equal(r.skipped, true);
  });
});

describe('renderDirective', () => {
  it('renders empty string for no misses', () => {
    assert.equal(captureGateModule.renderDirective([]), '');
  });
  it('renders kind / target / suggestion per miss', () => {
    const out = captureGateModule.renderDirective([
      {
        kind: 'decision',
        excerpt: 'use kebab-case for file names',
        targetFile: '.workflow/state/decisions.md',
        suggestedCommand: '/wogi-decide',
      },
    ]);
    assert.match(out, /Capture gate/);
    assert.match(out, /\[decision\]/);
    assert.match(out, /kebab-case/);
    assert.match(out, /decisions\.md/);
    assert.match(out, /\/wogi-decide/);
    assert.match(out, /blockOnMiss/);
  });
});
