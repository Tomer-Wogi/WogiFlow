'use strict';

/**
 * Tests for lib/fuzzy-patch.js.
 *
 * AC4 coverage:
 *   - exact match
 *   - whitespace-drift match (CRLF↔LF, trailing whitespace, tabs↔spaces)
 *   - reordering-drift rejection
 *   - low-confidence rejection
 *
 * Also covers configurable threshold (AC3) and atomicity (AC2 — applied=false
 * returns no result field, caller must not write anything).
 *
 * Run: node --test tests/fuzzy-patch.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { applyFuzzyPatch, DEFAULT_THRESHOLD, _internal } = require('../lib/fuzzy-patch');

// ============================================================
// AC1 + AC4: exact match
// ============================================================

describe('applyFuzzyPatch — exact match', () => {
  it('replaces exact substring at confidence 1.0', () => {
    const src = '# Skill\n\nHello world\n\nFooter\n';
    const r = applyFuzzyPatch(src, 'Hello world', 'Goodbye world');
    assert.equal(r.applied, true);
    assert.equal(r.mode, 'exact');
    assert.equal(r.confidence, 1.0);
    assert.equal(r.result, '# Skill\n\nGoodbye world\n\nFooter\n');
  });

  it('replaces first occurrence only', () => {
    const src = 'foo bar foo';
    const r = applyFuzzyPatch(src, 'foo', 'baz');
    assert.equal(r.applied, true);
    assert.equal(r.result, 'baz bar foo');
  });

  it('handles multi-line exact blocks', () => {
    const src = 'line1\nline2\nline3\n';
    const r = applyFuzzyPatch(src, 'line1\nline2', 'replaced');
    assert.equal(r.applied, true);
    assert.equal(r.result, 'replaced\nline3\n');
  });
});

// ============================================================
// AC1 + AC4: whitespace-drift match
// ============================================================

describe('applyFuzzyPatch — whitespace-drift match', () => {
  it('matches across CRLF → LF difference', () => {
    const src = 'header\r\nHello world\r\nfooter\r\n';
    const r = applyFuzzyPatch(src, 'Hello world', 'Goodbye');
    assert.equal(r.applied, true);
    // Either exact path or normalized path — both acceptable here.
    assert.ok(r.mode === 'exact' || r.mode === 'normalized');
    assert.equal(r.confidence, 1.0);
    assert.ok(r.result.includes('Goodbye'));
    assert.ok(!r.result.includes('Hello world'));
  });

  it('matches when find has trailing whitespace that haystack lacks', () => {
    const src = '# Header\n\nparagraph one\n\n## Section\n';
    const find = 'paragraph one   \n'; // trailing spaces
    const r = applyFuzzyPatch(src, find, 'paragraph two\n');
    assert.equal(r.applied, true);
    assert.equal(r.mode, 'normalized');
    assert.equal(r.confidence, 1.0);
    assert.ok(r.result.includes('paragraph two'));
  });

  it('matches tabs-vs-spaces drift inside a line', () => {
    const src = 'before\nif (x) {\treturn 1; }\nafter\n';
    const find = 'if (x) { return 1; }';
    const r = applyFuzzyPatch(src, find, 'if (x) return 2;');
    assert.equal(r.applied, true);
    assert.equal(r.mode, 'normalized');
    assert.equal(r.confidence, 1.0);
    assert.ok(r.result.includes('if (x) return 2;'));
    assert.ok(!r.result.includes('return 1'));
  });
});

// ============================================================
// AC4: reordering-drift rejection
// ============================================================

describe('applyFuzzyPatch — reordering-drift rejection', () => {
  it('rejects when lines are reordered (not semantically equivalent)', () => {
    const src = [
      '# Top',
      '',
      'alpha beta gamma',
      'delta epsilon zeta',
      'eta theta iota',
      '',
      '# Bottom',
    ].join('\n');

    // find expects a different line order than src contains
    const find = [
      'eta theta iota',
      'alpha beta gamma',
      'delta epsilon zeta',
    ].join('\n');

    const r = applyFuzzyPatch(src, find, 'REPLACED');
    assert.equal(r.applied, false, 'reordered lines must not silently match');
    assert.ok(r.confidence < DEFAULT_THRESHOLD, `confidence ${r.confidence} should be below ${DEFAULT_THRESHOLD}`);
    assert.match(r.reason, /below threshold/);
  });
});

// ============================================================
// AC4: low-confidence rejection
// ============================================================

describe('applyFuzzyPatch — low-confidence rejection', () => {
  it('rejects completely unrelated find text', () => {
    const src = '# Skill about React hooks\n\nUse useEffect for side effects.\n';
    const r = applyFuzzyPatch(src, 'completely different content about Django migrations', 'new text');
    assert.equal(r.applied, false);
    assert.ok(r.confidence < DEFAULT_THRESHOLD);
  });

  it('atomicity: rejected patch returns no result field', () => {
    const src = 'hello world';
    const r = applyFuzzyPatch(src, 'totally unrelated nonsense xyz qqq', 'x');
    assert.equal(r.applied, false);
    assert.equal(r.result, undefined,
      'rejected patch must not expose a result — caller must not write anything');
  });

  it('rejects when confidence is just below threshold', () => {
    // Construct a haystack where the best fuzzy window scores ~0.6
    const src = 'the quick brown fox jumps over the lazy dog';
    const find = 'the slow purple cat sleeps under the angry cow';
    const r = applyFuzzyPatch(src, find, 'x', { threshold: 0.85 });
    assert.equal(r.applied, false);
    assert.ok(r.confidence < 0.85);
  });
});

// ============================================================
// AC3: configurable threshold
// ============================================================

describe('applyFuzzyPatch — configurable threshold', () => {
  it('default threshold is 0.85', () => {
    assert.equal(DEFAULT_THRESHOLD, 0.85);
  });

  it('lower threshold accepts looser matches', () => {
    // A match that scores around 0.7 — rejected at 0.85, accepted at 0.5.
    const src = 'function handleClick(event) { return event.target.value; }';
    const find = 'function handleClick(evt) { return evt.target.value; }';

    const strict = applyFuzzyPatch(src, find, 'REPLACED', { threshold: 0.95 });
    assert.equal(strict.applied, false);

    const loose = applyFuzzyPatch(src, find, 'REPLACED', { threshold: 0.5 });
    // The fuzzy window should find the similar function definition.
    assert.equal(loose.applied, true);
    assert.ok(loose.confidence >= 0.5);
  });

  it('rejects threshold outside [0,1]', () => {
    assert.throws(() => applyFuzzyPatch('x', 'y', 'z', { threshold: 1.5 }), /threshold/);
    assert.throws(() => applyFuzzyPatch('x', 'y', 'z', { threshold: -0.1 }), /threshold/);
  });
});

// ============================================================
// Argument validation
// ============================================================

describe('applyFuzzyPatch — argument validation', () => {
  it('rejects non-string haystack', () => {
    assert.throws(() => applyFuzzyPatch(123, 'a', 'b'), /haystack/);
  });
  it('rejects non-string find', () => {
    assert.throws(() => applyFuzzyPatch('x', null, 'b'), /find must be a string/);
  });
  it('rejects non-string replace', () => {
    assert.throws(() => applyFuzzyPatch('x', 'a', undefined), /replace/);
  });
  it('rejects empty find', () => {
    assert.throws(() => applyFuzzyPatch('x', '', 'b'), /find must not be empty/);
  });
});

// ============================================================
// Internal helpers — spot checks
// ============================================================

describe('internal — normalize', () => {
  const { normalize } = _internal;

  it('collapses CRLF to LF', () => {
    assert.equal(normalize('a\r\nb\r\nc'), 'a\nb\nc');
  });
  it('strips trailing whitespace per line', () => {
    assert.equal(normalize('a   \nb\t\t\n'), 'a\nb');
  });
  it('collapses internal tab runs to single space', () => {
    assert.equal(normalize('a\t\tb'), 'a b');
  });
  it('trims leading/trailing blank lines', () => {
    assert.equal(normalize('\n\na\nb\n\n'), 'a\nb');
  });
});

describe('internal — levenshtein', () => {
  const { levenshtein } = _internal;

  it('equal strings → 0', () => {
    assert.equal(levenshtein('abc', 'abc'), 0);
  });
  it('empty → length of other', () => {
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('abc', ''), 3);
  });
  it('single substitution → 1', () => {
    assert.equal(levenshtein('abc', 'abd'), 1);
  });
  it('single insertion → 1', () => {
    assert.equal(levenshtein('abc', 'abcd'), 1);
  });
});
