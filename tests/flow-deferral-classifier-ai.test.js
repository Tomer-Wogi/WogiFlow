'use strict';

/**
 * Tests for scripts/flow-deferral-classifier-ai.js (wf-b8839d99).
 *
 * Covers the fail-open paths + prompt-building + response-parsing.
 * Live model calls are NOT made — like flow-worker-question-classifier,
 * the test relies on fail-open contract for the no-credentials path.
 *
 * Run: NODE_ENV=test node --test tests/flow-deferral-classifier-ai.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyUserDeferralIntent,
  buildDeferralPrompt,
  hasDangerousKeys,
  DEFAULT_MIN_CONFIDENCE
} = require('../scripts/flow-deferral-classifier-ai');

describe('flow-deferral-classifier-ai — buildDeferralPrompt', () => {
  it('embeds the user message verbatim inside markers', () => {
    const p = buildDeferralPrompt('fix all');
    assert.match(p, /\[USER_MESSAGE_START\][\s\S]*fix all[\s\S]*\[USER_MESSAGE_END\]/);
  });

  it('truncates very long messages to MAX_PROMPT_CHARS', () => {
    const big = 'x'.repeat(10000);
    const p = buildDeferralPrompt(big);
    // The embedded user message must be capped (we slice to MAX_PROMPT_CHARS=4000).
    const match = p.match(/\[USER_MESSAGE_START\]\n([\s\S]*?)\n\[USER_MESSAGE_END\]/);
    assert.ok(match, 'prompt should contain user-message section');
    assert.ok(match[1].length <= 4000, `embedded message length ${match[1].length} should be <= 4000`);
  });

  it('handles non-string input defensively', () => {
    const p = buildDeferralPrompt(undefined);
    assert.match(p, /\[USER_MESSAGE_START\]\n\n\[USER_MESSAGE_END\]/);
  });

  it('documents NEGATIVE/POSITIVE/NONE categories in prompt', () => {
    const p = buildDeferralPrompt('test');
    assert.match(p, /NEGATIVE/);
    assert.match(p, /POSITIVE/);
    assert.match(p, /NONE/);
  });

  it('instructs classifier to default to NONE on ambiguity', () => {
    const p = buildDeferralPrompt('test');
    assert.match(p, /When ambiguous, return NONE/);
  });
});

describe('flow-deferral-classifier-ai — hasDangerousKeys', () => {
  it('detects __proto__ as own property (JSON-parsed payload)', () => {
    // Object literal { __proto__: {} } sets the prototype, doesn't create an
    // own property — Object.keys returns []. The real attack vector is
    // JSON.parse, which creates __proto__ as an own enumerable property.
    const parsed = JSON.parse('{"__proto__": {"polluted": true}}');
    assert.equal(hasDangerousKeys(parsed), true);
  });
  it('detects constructor as own property', () => {
    const parsed = JSON.parse('{"constructor": {}}');
    assert.equal(hasDangerousKeys(parsed), true);
  });
  it('detects prototype nested (JSON-parsed)', () => {
    const parsed = JSON.parse('{"inner": {"prototype": {}}}');
    assert.equal(hasDangerousKeys(parsed), true);
  });
  it('allows safe objects', () => {
    assert.equal(hasDangerousKeys({ intent: 'negative', confidence: 95 }), false);
  });
  it('returns false for null/string/array primitives', () => {
    assert.equal(hasDangerousKeys(null), false);
    assert.equal(hasDangerousKeys('str'), false);
    assert.equal(hasDangerousKeys([{ x: 1 }]), false);
  });
});

describe('flow-deferral-classifier-ai — fail-open paths', () => {
  const origKey = process.env.ANTHROPIC_API_KEY;

  it('returns classified:false with reason:empty-prompt for empty input', async () => {
    const result = await classifyUserDeferralIntent('');
    assert.equal(result.classified, false);
    assert.equal(result.reason, 'empty-prompt');
  });

  it('returns classified:false with reason:empty-prompt for whitespace-only', async () => {
    const result = await classifyUserDeferralIntent('   \n\t  ');
    assert.equal(result.classified, false);
    assert.equal(result.reason, 'empty-prompt');
  });

  it('returns classified:false with reason:empty-prompt for non-string input', async () => {
    const result = await classifyUserDeferralIntent(null);
    assert.equal(result.classified, false);
    assert.equal(result.reason, 'empty-prompt');
  });

  it('returns classified:false with reason:no-credentials when API key missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await classifyUserDeferralIntent('fix all');
      assert.equal(result.classified, false);
      assert.equal(result.reason, 'no-credentials');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it('exports DEFAULT_MIN_CONFIDENCE as a sane threshold', () => {
    assert.ok(Number.isFinite(DEFAULT_MIN_CONFIDENCE));
    assert.ok(DEFAULT_MIN_CONFIDENCE >= 50 && DEFAULT_MIN_CONFIDENCE <= 95,
      `DEFAULT_MIN_CONFIDENCE=${DEFAULT_MIN_CONFIDENCE} should be in [50, 95]`);
  });
});

describe('flow-deferral-classifier-ai — regression contracts', () => {
  it('prompt mentions all key user phrases that the old regex missed (audit trail)', () => {
    // These were the failure cases from wf-b8839d99 + earlier sessions.
    // The AI classifier should be PROMPTED to handle them; we don't verify
    // the AI's actual output (that needs live calls) but we verify the
    // examples are present in the prompt so the model has the context.
    const p = buildDeferralPrompt('test');
    assert.match(p, /"fix all"/, 'prompt must include "fix all" example');
    assert.match(p, /"I don't like tech debt"/, 'prompt must include tech-debt example');
    assert.match(p, /"option 2"/, 'prompt must include option-N example');
  });

  it('prompt explicitly tells classifier NEGATIVE takes precedence', () => {
    const p = buildDeferralPrompt('test');
    assert.match(p, /NEGATIVE takes precedence/);
  });

  it('prompt tells classifier to detect "standing" preferences', () => {
    const p = buildDeferralPrompt('test');
    assert.match(p, /standing|always|from now on/i);
  });
});
