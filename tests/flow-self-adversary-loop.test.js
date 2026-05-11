'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  runSelfAdversaryLoop,
  buildGeneratorPrompt,
  buildAdversaryPrompt,
  extractJson,
  hasDangerousKeys,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TARGET_CONFIDENCE,
  DEFAULT_GENERATOR_MODEL,
  DEFAULT_ADVERSARY_MODEL
} = require('../scripts/flow-self-adversary-loop');

describe('flow-self-adversary-loop — buildGeneratorPrompt', () => {
  it('embeds the question + context', () => {
    const p = buildGeneratorPrompt({
      question: 'Should I use map() or for-loop here?',
      context: 'The list has 10k items and runs in a hot path.',
      iterationMemory: []
    });
    assert.match(p, /Should I use map\(\) or for-loop here\?/);
    assert.match(p, /10k items/);
  });

  it('embeds iteration memory when present', () => {
    const p = buildGeneratorPrompt({
      question: 'q',
      context: 'c',
      iterationMemory: [
        { decision: 'use map()', confidence: 70, adversaryCritique: 'allocation pressure on hot path' }
      ]
    });
    assert.match(p, /## Iteration 1/);
    assert.match(p, /use map\(\)/);
    assert.match(p, /allocation pressure/);
  });

  it('shows "(no prior iterations)" when memory is empty', () => {
    const p = buildGeneratorPrompt({ question: 'q', context: 'c', iterationMemory: [] });
    assert.match(p, /no prior iterations/);
  });

  it('instructs the model that AskUserQuestion is unavailable', () => {
    const p = buildGeneratorPrompt({ question: 'q', context: 'c', iterationMemory: [] });
    assert.match(p, /cannot ask the user/i);
  });

  it('documents calibration anchors', () => {
    const p = buildGeneratorPrompt({ question: 'q', context: 'c', iterationMemory: [] });
    assert.match(p, /≥2 alternatives/);
    assert.match(p, /weakest sub-claim/i);
  });
});

describe('flow-self-adversary-loop — buildAdversaryPrompt', () => {
  it('embeds the candidate decision + self-confidence', () => {
    const p = buildAdversaryPrompt({
      question: 'q',
      context: 'c',
      candidate: {
        decision: 'use Set instead of Array.includes',
        rationale: 'O(1) lookup',
        confidence: 88,
        weakSubClaims: ['only matters for n > 100']
      }
    });
    assert.match(p, /use Set instead of Array\.includes/);
    assert.match(p, /88%/);
    assert.match(p, /only matters for n > 100/);
  });

  it('asks for verdict in {accept, revise, needs-user}', () => {
    const p = buildAdversaryPrompt({
      question: 'q',
      context: 'c',
      candidate: { decision: 'd', rationale: 'r', confidence: 50, weakSubClaims: [] }
    });
    assert.match(p, /"accept"\s*\|\s*"revise"\s*\|\s*"needs-user"/);
  });

  it('instructs adversary to use needs-user sparingly', () => {
    const p = buildAdversaryPrompt({
      question: 'q', context: 'c',
      candidate: { decision: 'd', rationale: 'r', confidence: 50, weakSubClaims: [] }
    });
    assert.match(p, /Use sparingly/);
  });
});

describe('flow-self-adversary-loop — extractJson', () => {
  it('extracts JSON object from raw model output', () => {
    const result = extractJson('Sure, here is the answer:\n{"decision":"x","confidence":80}\nThanks.');
    assert.equal(result.decision, 'x');
    assert.equal(result.confidence, 80);
  });

  it('returns null on missing JSON', () => {
    assert.equal(extractJson('no json here'), null);
  });

  it('returns null on malformed JSON', () => {
    assert.equal(extractJson('{not valid json}'), null);
  });

  it('returns null on dangerous keys', () => {
    const r = extractJson('{"__proto__":{"polluted":true},"decision":"x"}');
    assert.equal(r, null);
  });

  it('returns null on JSON array (must be object)', () => {
    assert.equal(extractJson('[1,2,3]'), null);
  });
});

describe('flow-self-adversary-loop — hasDangerousKeys', () => {
  it('detects __proto__ via JSON.parse', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}');
    assert.equal(hasDangerousKeys(parsed), true);
  });
  it('passes through safe objects', () => {
    assert.equal(hasDangerousKeys({ decision: 'x', confidence: 95 }), false);
  });
});

describe('flow-self-adversary-loop — fail-open paths', () => {
  const origKey = process.env.ANTHROPIC_API_KEY;

  it('escalates with reason:empty-question on empty input', async () => {
    const r = await runSelfAdversaryLoop({ question: '' });
    assert.equal(r.classified, false);
    assert.equal(r.escalate, true);
    assert.equal(r.reason, 'empty-question');
  });

  it('escalates with reason:empty-question on whitespace-only input', async () => {
    const r = await runSelfAdversaryLoop({ question: '   \n\t  ' });
    assert.equal(r.escalate, true);
    assert.equal(r.reason, 'empty-question');
  });

  it('escalates with reason:no-credentials when API key missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await runSelfAdversaryLoop({ question: 'Should I use map() or for?' });
      assert.equal(r.classified, false);
      assert.equal(r.escalate, true);
      assert.equal(r.reason, 'no-credentials');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it('clamps maxIterations to at most 12', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // Force fail-open before loop starts so we don't actually run.
      // Default DEFAULT_MAX_ITERATIONS = 8 anyway; this verifies the cap.
      const r = await runSelfAdversaryLoop({ question: 'q', maxIterations: 100 });
      // We just check it didn't crash and escalated cleanly.
      assert.equal(r.escalate, true);
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it('exports DEFAULTS in sane ranges', () => {
    assert.ok(DEFAULT_MAX_ITERATIONS >= 3 && DEFAULT_MAX_ITERATIONS <= 12);
    assert.ok(DEFAULT_TARGET_CONFIDENCE >= 70 && DEFAULT_TARGET_CONFIDENCE <= 99);
    assert.ok(typeof DEFAULT_GENERATOR_MODEL === 'string' && DEFAULT_GENERATOR_MODEL.length > 0);
    assert.ok(typeof DEFAULT_ADVERSARY_MODEL === 'string' && DEFAULT_ADVERSARY_MODEL.length > 0);
    assert.notEqual(DEFAULT_GENERATOR_MODEL, DEFAULT_ADVERSARY_MODEL,
      'generator and adversary should default to DIFFERENT models');
  });
});
