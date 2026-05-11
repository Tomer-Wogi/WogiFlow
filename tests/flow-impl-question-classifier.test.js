'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyImplementationQuestion,
  buildClassifierPrompt,
  hasDangerousKeys,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MODEL
} = require('../scripts/flow-impl-question-classifier');

describe('flow-impl-question-classifier — buildClassifierPrompt', () => {
  it('embeds question text verbatim', () => {
    const p = buildClassifierPrompt('Should I use map() or for-loop?');
    assert.match(p, /Should I use map\(\) or for-loop\?/);
  });

  it('documents all four categories', () => {
    const p = buildClassifierPrompt('q');
    assert.match(p, /IMPLEMENTATION/);
    assert.match(p, /PRODUCT/);
    assert.match(p, /ARCHITECTURE/);
    assert.match(p, /SENSITIVE/);
  });

  it('instructs classifier to default to PRODUCT on ambiguity (safe direction)', () => {
    const p = buildClassifierPrompt('q');
    assert.match(p, /When ambiguous, return PRODUCT/);
  });

  it('includes concrete examples for each category', () => {
    const p = buildClassifierPrompt('q');
    assert.match(p, /"Should this be a map\(\) or for-loop\?"/);
    assert.match(p, /"OK to delete the migration table\?"/);
  });
});

describe('flow-impl-question-classifier — hasDangerousKeys', () => {
  it('detects __proto__ via JSON.parse', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}');
    assert.equal(hasDangerousKeys(parsed), true);
  });
  it('passes through safe objects', () => {
    assert.equal(hasDangerousKeys({ category: 'implementation', confidence: 95 }), false);
  });
});

describe('flow-impl-question-classifier — fail-open paths', () => {
  const origKey = process.env.ANTHROPIC_API_KEY;

  it('returns classified:false with reason:empty-question on empty input', async () => {
    const r = await classifyImplementationQuestion('');
    assert.equal(r.classified, false);
    assert.equal(r.reason, 'empty-question');
  });

  it('returns classified:false with reason:no-credentials when API key missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await classifyImplementationQuestion('Should I use map?');
      assert.equal(r.classified, false);
      assert.equal(r.reason, 'no-credentials');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it('exports DEFAULTS in sane ranges', () => {
    assert.ok(DEFAULT_MIN_CONFIDENCE >= 50 && DEFAULT_MIN_CONFIDENCE <= 95);
    assert.ok(typeof DEFAULT_MODEL === 'string' && DEFAULT_MODEL.includes('haiku'),
      'classifier should default to a fast/cheap model');
  });
});
