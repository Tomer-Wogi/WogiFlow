'use strict';

/**
 * Tests for the hybrid keyword-first classifier extension to
 * flow-correction-detector.js (wf-e6d65edf).
 *
 * Covers: getHybridConfig defaults + overrides, loadPatterns + demotion,
 * findKeywordMatch, patternConfidence, extractCandidatePhrases (n-gram filter),
 * upsertPatterns, recordPatternHit, end-to-end Layer 1 hit returning before AI.
 *
 * Run: NODE_ENV=test node --test tests/flow-correction-detector-hybrid.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const cd = require('../scripts/flow-correction-detector');

// We'll write/read the real patterns file in `.workflow/state/` for these tests
// (to exercise withLock + readRawPatterns). Each test cleans up after itself.
const patternsPath = cd.getPatternsPath();

function writePatterns(arr) {
  fs.mkdirSync(path.dirname(patternsPath), { recursive: true });
  fs.writeFileSync(patternsPath, JSON.stringify(arr, null, 2));
  cd._invalidatePatternCache();
}

function clearPatterns() {
  if (fs.existsSync(patternsPath)) fs.unlinkSync(patternsPath);
  cd._invalidatePatternCache();
}

describe('getHybridConfig — defaults', () => {
  it('returns sane defaults when correctionDetector block is absent', () => {
    // Note: this reads the real config file. wogi-flow's config.json HAS the block,
    // so we can't fully test "absent" path here without intrusive mocking. Instead
    // we verify the fields exist and have expected types.
    const cfg = cd.getHybridConfig();
    assert.equal(typeof cfg.hybridEnabled, 'boolean');
    assert.equal(typeof cfg.learningEnabled, 'boolean');
    assert.equal(typeof cfg.learningThreshold, 'number');
    assert.equal(typeof cfg.demotionThreshold, 'number');
    assert.equal(typeof cfg.demotionMinHits, 'number');
  });

  it('exposes HYBRID_DEFAULTS as a frozen object', () => {
    assert.equal(typeof cd.HYBRID_DEFAULTS, 'object');
    assert.equal(Object.isFrozen(cd.HYBRID_DEFAULTS), true);
    assert.equal(cd.HYBRID_DEFAULTS.learningThreshold, 85);
    assert.equal(cd.HYBRID_DEFAULTS.demotionThreshold, 0.5);
    assert.equal(cd.HYBRID_DEFAULTS.demotionMinHits, 10);
  });
});

describe('loadPatterns — file states', () => {
  beforeEach(() => clearPatterns());
  afterEach(() => clearPatterns());

  it('returns [] when file is absent (graceful bootstrap)', () => {
    assert.deepEqual(cd.loadPatterns(), []);
  });

  it('returns [] when file is malformed', () => {
    fs.mkdirSync(path.dirname(patternsPath), { recursive: true });
    fs.writeFileSync(patternsPath, '{not valid json');
    cd._invalidatePatternCache();
    assert.deepEqual(cd.loadPatterns(), []);
  });

  it('returns [] when file is not an array', () => {
    fs.mkdirSync(path.dirname(patternsPath), { recursive: true });
    fs.writeFileSync(patternsPath, '{"phrase": "wrong shape"}');
    cd._invalidatePatternCache();
    assert.deepEqual(cd.loadPatterns(), []);
  });

  it('rejects entries with __proto__ keys (prototype pollution guard)', () => {
    fs.mkdirSync(path.dirname(patternsPath), { recursive: true });
    fs.writeFileSync(patternsPath, '[{"phrase": "x", "__proto__": {"polluted": true}}]');
    cd._invalidatePatternCache();
    assert.deepEqual(cd.loadPatterns(), []);
  });

  it('keeps valid entries and filters out items missing phrase', () => {
    writePatterns([
      { phrase: 'good one', hits: 0, confirmedHits: 1, falsePositives: 0 },
      { phrase: '', hits: 0 },
      { hits: 5 }, // no phrase
      { phrase: 'another good', hits: 2, confirmedHits: 1, falsePositives: 0 },
    ]);
    const loaded = cd.loadPatterns();
    assert.equal(loaded.length, 2);
    assert.deepEqual(loaded.map(p => p.phrase), ['good one', 'another good']);
  });
});

describe('loadPatterns — demotion filter', () => {
  beforeEach(() => clearPatterns());
  afterEach(() => clearPatterns());

  it('keeps patterns under demotionMinHits regardless of FP ratio', () => {
    writePatterns([
      { phrase: 'young', hits: 5, confirmedHits: 0, falsePositives: 5 }, // FP=100% but only 5 hits
    ]);
    const loaded = cd.loadPatterns();
    assert.equal(loaded.length, 1);
  });

  it('removes patterns with hits >= demotionMinHits AND FP ratio > demotionThreshold', () => {
    writePatterns([
      { phrase: 'noisy', hits: 20, confirmedHits: 5, falsePositives: 15 }, // 75% FP
      { phrase: 'clean', hits: 20, confirmedHits: 18, falsePositives: 2 }, // 10% FP
    ]);
    const loaded = cd.loadPatterns();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].phrase, 'clean');
  });

  it('keeps patterns at exactly the threshold (FP ratio = 0.5)', () => {
    writePatterns([
      { phrase: 'borderline', hits: 10, confirmedHits: 5, falsePositives: 5 }, // exactly 0.5
    ]);
    assert.equal(cd.loadPatterns().length, 1);
  });
});

describe('findKeywordMatch', () => {
  beforeEach(() => clearPatterns());
  afterEach(() => clearPatterns());

  it('returns null with no patterns', () => {
    assert.equal(cd.findKeywordMatch('any message'), null);
  });

  it('matches case-insensitively', () => {
    writePatterns([{ phrase: 'STOP DOING', hits: 0, confirmedHits: 1, falsePositives: 0 }]);
    const m = cd.findKeywordMatch('please stop doing that');
    assert.ok(m);
    assert.equal(m.phrase, 'STOP DOING');
  });

  it('returns null when no pattern matches', () => {
    writePatterns([{ phrase: 'banana', hits: 0, confirmedHits: 1, falsePositives: 0 }]);
    assert.equal(cd.findKeywordMatch('stop doing that'), null);
  });
});

describe('patternConfidence', () => {
  it('returns floor (66) for 1 confirmed hit', () => {
    assert.equal(cd.patternConfidence({ confirmedHits: 1 }), 66);
  });

  it('returns ramp at 5 confirmed hits', () => {
    assert.equal(cd.patternConfidence({ confirmedHits: 5 }), 71);
  });

  it('caps at 90 for 20+ confirmed hits', () => {
    assert.equal(cd.patternConfidence({ confirmedHits: 20 }), 90);
    assert.equal(cd.patternConfidence({ confirmedHits: 100 }), 90);
  });

  it('handles missing or invalid confirmedHits gracefully', () => {
    assert.equal(cd.patternConfidence({}), 66);
    assert.equal(cd.patternConfidence(null), 66);
    assert.equal(cd.patternConfidence({ confirmedHits: 'bogus' }), 66);
  });
});

describe('extractCandidatePhrases — n-gram filter', () => {
  it('extracts 2-4 word n-grams from a normal correction message', () => {
    const phrases = cd.extractCandidatePhrases('do not use raw JSON.parse here');
    assert.ok(phrases.length > 0);
    assert.ok(phrases.every(p => p.length >= 8 && p.length <= 60));
  });

  it('rejects file paths and IDs', () => {
    const phrases = cd.extractCandidatePhrases('the issue is in src/foo.js wf-12345678 and 0xdeadbeef');
    // All phrases must NOT contain the path or ID tokens
    for (const p of phrases) {
      assert.ok(!p.includes('src/foo.js'), `phrase contains path: ${p}`);
      assert.ok(!p.includes('wf-12345678'), `phrase contains task id: ${p}`);
      assert.ok(!p.includes('0xdeadbeef'), `phrase contains hex: ${p}`);
    }
  });

  it('returns [] for empty / whitespace input', () => {
    assert.deepEqual(cd.extractCandidatePhrases(''), []);
    assert.deepEqual(cd.extractCandidatePhrases('   '), []);
    assert.deepEqual(cd.extractCandidatePhrases(null), []);
  });

  it('produces unique normalized phrases', () => {
    const phrases = cd.extractCandidatePhrases('please stop doing please stop doing');
    const set = new Set(phrases);
    assert.equal(set.size, phrases.length);
  });

  it('respects min/max char bounds (8 to 60)', () => {
    const phrases = cd.extractCandidatePhrases('a b c d e f g'); // all single-letter
    // After filter: each n-gram is too short
    assert.equal(phrases.length, 0);
  });
});

describe('upsertPatterns', () => {
  beforeEach(() => clearPatterns());
  afterEach(() => clearPatterns());

  it('creates new pattern entries on first upsert', async () => {
    const result = await cd.upsertPatterns(['stop doing this', 'please change that']);
    assert.equal(result.added, 2);
    assert.equal(result.updated, 0);
    const arr = cd.loadPatterns();
    assert.equal(arr.length, 2);
    for (const p of arr) {
      assert.equal(p.confirmedHits, 1);
      assert.equal(p.hits, 0);
      assert.equal(p.falsePositives, 0);
      assert.equal(p.source, 'ai-confirmation');
      assert.ok(p.addedAt);
    }
  });

  it('increments confirmedHits on duplicate upsert', async () => {
    await cd.upsertPatterns(['stop doing this']);
    await cd.upsertPatterns(['stop doing this']);
    const arr = cd.loadPatterns();
    assert.equal(arr.length, 1);
    assert.equal(arr[0].confirmedHits, 2);
  });

  it('returns {added: 0, updated: 0} for empty input', async () => {
    const r = await cd.upsertPatterns([]);
    assert.equal(r.added, 0);
    assert.equal(r.updated, 0);
  });
});

describe('recordPatternHit', () => {
  beforeEach(() => clearPatterns());
  afterEach(() => clearPatterns());

  it('no-ops when patterns file is absent', async () => {
    await cd.recordPatternHit('anything');
    assert.equal(fs.existsSync(patternsPath), false);
  });

  it('increments hits counter on existing pattern', async () => {
    writePatterns([{ phrase: 'foo bar baz', hits: 3, confirmedHits: 1, falsePositives: 0 }]);
    await cd.recordPatternHit('foo bar baz');
    const arr = cd.loadPatterns();
    assert.equal(arr[0].hits, 4);
    assert.equal(arr[0].confirmedHits, 1);
  });

  it('increments confirmedHits when opts.confirmed=true', async () => {
    writePatterns([{ phrase: 'foo', hits: 0, confirmedHits: 0, falsePositives: 0 }]);
    await cd.recordPatternHit('foo', { confirmed: true });
    const arr = cd.loadPatterns();
    assert.equal(arr[0].confirmedHits, 1);
  });

  it('increments falsePositives when opts.falsePositive=true', async () => {
    writePatterns([{ phrase: 'foo', hits: 5, confirmedHits: 1, falsePositives: 0 }]);
    await cd.recordPatternHit('foo', { falsePositive: true });
    const arr = cd.loadPatterns();
    assert.equal(arr[0].falsePositives, 1);
  });
});

describe('detectCorrection — Layer 1 keyword path', () => {
  beforeEach(() => clearPatterns());
  afterEach(() => clearPatterns());

  it('returns immediately with method:keyword when a pattern matches (no AI call)', async () => {
    writePatterns([{ phrase: 'stop doing', hits: 0, confirmedHits: 5, falsePositives: 0 }]);
    // No ANTHROPIC_API_KEY needed — Layer 1 fires before the API check.
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await cd.detectCorrection('please stop doing that — it broke the build');
      assert.equal(r.isCorrection, true);
      assert.equal(r.method, 'keyword');
      assert.equal(r.matchedPattern, 'stop doing');
      assert.equal(r.confidence, 71); // floor 65 + 25*5/20 = 71
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('falls through to API key check when no pattern matches', async () => {
    writePatterns([{ phrase: 'banana', hits: 0, confirmedHits: 1, falsePositives: 0 }]);
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await cd.detectCorrection('please review the diff');
      assert.equal(r.isCorrection, false);
      assert.equal(r.method, 'skipped');
      assert.equal(r.reason, 'no-api-key');
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('respects the length pre-filter (skip-too-short) before any layer fires', async () => {
    writePatterns([{ phrase: 'stop doing', hits: 0, confirmedHits: 5, falsePositives: 0 }]);
    const r = await cd.detectCorrection('hi');
    assert.equal(r.method, 'skipped');
    assert.equal(r.reason, 'length-filter');
  });
});
