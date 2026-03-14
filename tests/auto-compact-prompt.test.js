'use strict';

/**
 * Smoke tests for autoCompactPrompt() in flow-orchestrate.js
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/auto-compact-prompt.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Load test exports
process.env.NODE_ENV = 'test';
const { _test } = require('../scripts/flow-orchestrate');
const { autoCompactPrompt, getContextUsage, compactionStrategies } = _test;

// Helper: create a string of approximately N tokens (1 token ≈ 4 chars)
function makeText(approxTokens) {
  return 'x'.repeat(approxTokens * 4);
}

describe('getContextUsage', () => {
  it('returns percentage of context used', () => {
    assert.equal(getContextUsage(500, 1000), 50);
    assert.equal(getContextUsage(1000, 1000), 100);
    assert.equal(getContextUsage(0, 1000), 0);
  });

  it('handles zero context window', () => {
    // Should not throw
    const result = getContextUsage(100, 0);
    assert.equal(typeof result, 'number');
  });
});

describe('compactionStrategies', () => {
  describe('trimRetryErrors', () => {
    it('removes all but last error section when 3+ exist', () => {
      const prompt = [
        'Start',
        '## PREVIOUS ERROR',
        'Error 1 details',
        '## PREVIOUS ERROR',
        'Error 2 details',
        '## PREVIOUS ERROR',
        'Error 3 details (latest)'
      ].join('\n');

      const result = compactionStrategies.trimRetryErrors(prompt);
      // Should keep only the last error section
      assert.ok(result.includes('Error 3'));
      assert.ok(!result.includes('Error 1'));
    });

    it('keeps only last error section when 2 exist', () => {
      const prompt = [
        'Start',
        '## PREVIOUS ERROR',
        'Error 1',
        '## PREVIOUS ERROR',
        'Error 2'
      ].join('\n');

      const result = compactionStrategies.trimRetryErrors(prompt);
      assert.ok(result.includes('Error 2'));
      assert.ok(!result.includes('Error 1'));
    });

    it('leaves prompt unchanged when no error sections', () => {
      const prompt = 'Just a normal prompt with no errors';
      assert.equal(compactionStrategies.trimRetryErrors(prompt), prompt);
    });
  });

  describe('trimTemplateVerbosity', () => {
    it('removes ## Examples sections', () => {
      const prompt = [
        'Instructions here',
        '## Examples',
        'Example 1: do this',
        'Example 2: do that',
        '## Next Section',
        'Content'
      ].join('\n');

      const result = compactionStrategies.trimTemplateVerbosity(prompt);
      assert.ok(!result.includes('Example 1'));
      assert.ok(result.includes('Instructions here'));
    });
  });
});

describe('autoCompactPrompt', () => {
  // Suppress console.log during tests
  let originalLog;
  beforeEach(() => {
    originalLog = console.log;
    console.log = () => {};
  });

  it('returns unchanged prompt when it fits within budget', () => {
    const prompt = makeText(100); // ~100 tokens
    const result = autoCompactPrompt(prompt, 4096, 2048);

    assert.equal(result.wasCompacted, false);
    assert.equal(result.prompt, prompt);
    assert.ok(result.originalTokens > 0);
    assert.equal(result.originalTokens, result.finalTokens);
  });

  it('returns correct structure', () => {
    const result = autoCompactPrompt('hello', 4096);

    assert.ok('prompt' in result);
    assert.ok('wasCompacted' in result);
    assert.ok('originalTokens' in result);
    assert.ok('finalTokens' in result);
    assert.ok('usage' in result);
    assert.equal(typeof result.prompt, 'string');
    assert.equal(typeof result.wasCompacted, 'boolean');
    assert.equal(typeof result.originalTokens, 'number');
    assert.equal(typeof result.usage, 'number');
  });

  it('handles empty prompt', () => {
    const result = autoCompactPrompt('', 4096);

    assert.equal(result.wasCompacted, false);
    assert.equal(result.prompt, '');
    assert.equal(result.originalTokens, 0);
  });

  it('caps reserveForOutput when > contextWindow/2', () => {
    // With contextWindow=1000 and reserve=800, reserve should be capped to 500
    // So available = 1000 - 500 = 500 tokens
    const prompt = makeText(400); // fits in 500
    const result = autoCompactPrompt(prompt, 1000, 800);

    assert.equal(result.wasCompacted, false);
  });

  it('compacts when prompt exceeds available tokens', () => {
    // Create a prompt that's too large for the budget
    // Budget: contextWindow=500, reserve=200 → available=300
    // Prompt: ~400 tokens → must compact
    const prompt = makeText(400);
    const result = autoCompactPrompt(prompt, 500, 200);

    assert.equal(result.wasCompacted, true);
    assert.ok(result.finalTokens <= result.originalTokens);
  });

  it('applies retry error trimming (strategy 1)', () => {
    const errorBlock = makeText(50);
    const prompt = [
      makeText(100),
      '## PREVIOUS ERROR',
      errorBlock,
      '## PREVIOUS ERROR',
      errorBlock,
      '## PREVIOUS ERROR',
      errorBlock
    ].join('\n');

    // Budget that won't fit all 3 errors but will fit after trimming
    const tokens = Math.ceil(prompt.length / 4);
    const result = autoCompactPrompt(prompt, tokens - 50, 100);

    assert.equal(result.wasCompacted, true);
  });

  it('applies aggressive truncation as last resort', () => {
    // Create a massive prompt with no retry errors, no examples, no code blocks
    const prompt = makeText(10000);
    const result = autoCompactPrompt(prompt, 1000, 200);

    assert.equal(result.wasCompacted, true);
    assert.ok(result.finalTokens < result.originalTokens);
    // Aggressive truncation adds a sentinel
    assert.ok(result.prompt.includes('[TRUNCATED') || result.prompt.length < prompt.length);
  });

  it('handles code block truncation (strategy 3)', () => {
    // Create a prompt with a large code block (>100 lines)
    const codeLines = Array.from({ length: 150 }, (_, i) => `  line ${i}`).join('\n');
    const prompt = [
      'Instructions',
      '```javascript',
      codeLines,
      '```',
      'End'
    ].join('\n');

    // Budget too small for full prompt
    const tokens = Math.ceil(prompt.length / 4);
    const result = autoCompactPrompt(prompt, Math.floor(tokens * 0.7), 100);

    assert.equal(result.wasCompacted, true);
  });

  it('does not crash with zero contextWindow', () => {
    const prompt = makeText(100);
    // Should not throw
    const result = autoCompactPrompt(prompt, 0, 0);
    assert.ok(result);
    assert.equal(typeof result.prompt, 'string');
  });

  it('does not crash with very large reserveForOutput', () => {
    const prompt = makeText(100);
    const result = autoCompactPrompt(prompt, 1000, 999999);
    assert.ok(result);
  });

  // Restore console.log after each test (cleanup handled by test runner)
});
