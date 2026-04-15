'use strict';

/**
 * Tests for scripts/hooks/core/research-gate.js (Wave F hook coverage).
 *
 * Covers: checkResearchRequirement fast paths (empty prompt, invalid config),
 * generateResearchCommand (truncation + escape sequence order), detectUnverifiedClaims
 * (capability/existence/certainty/version patterns + dedupe + 10-cap), formatClaimWarning
 * (truncation at 5 items), normalizeQuery (lowercase+trim+collapse whitespace+200 cap),
 * isResearchMandatory (context-aware default).
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-research-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  checkResearchRequirement,
  generateResearchCommand,
  detectUnverifiedClaims,
  formatClaimWarning,
  normalizeQuery,
  isResearchMandatory,
} = require('../scripts/hooks/core/research-gate');

// ============================================================
// checkResearchRequirement — fast paths
// ============================================================

describe('checkResearchRequirement — fast paths', () => {
  it('allows empty prompt with reason=empty_prompt', () => {
    const r = checkResearchRequirement({ prompt: '' });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'empty_prompt');
  });

  it('allows whitespace-only prompt', () => {
    const r = checkResearchRequirement({ prompt: '   \n\t  ' });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'empty_prompt');
  });

  it('allows null/undefined prompt', () => {
    assert.equal(checkResearchRequirement({ prompt: null }).allowed, true);
    assert.equal(checkResearchRequirement({}).allowed, true);
  });

  it('returns well-formed result for typical prompt', () => {
    const r = checkResearchRequirement({ prompt: 'does feature X exist in framework Y' });
    assert.ok(typeof r.allowed === 'boolean');
    assert.ok(typeof r.blocked === 'boolean');
    assert.ok(r.reason);
  });
});

// ============================================================
// generateResearchCommand
// ============================================================

describe('generateResearchCommand', () => {
  it('produces /wogi-research command for standard depth', () => {
    const cmd = generateResearchCommand('is X supported', 'standard');
    assert.ok(cmd.startsWith('/wogi-research '));
    assert.ok(cmd.includes('is X supported'));
  });

  it('adds --<depth> flag for non-standard depths', () => {
    const cmd = generateResearchCommand('test query', 'deep');
    assert.ok(cmd.includes('--deep'));
  });

  it('truncates prompts longer than 60 chars with ellipsis', () => {
    const long = 'a'.repeat(100);
    const cmd = generateResearchCommand(long, 'standard');
    assert.ok(cmd.includes('...'));
    // Quoted portion should not exceed ~60 chars + 3 ellipsis chars
    const match = cmd.match(/"([^"]+)"/);
    if (match) {
      assert.ok(match[1].length <= 60 + 3, `quoted portion too long: ${match[1].length}`);
    }
  });

  it('escapes backslashes', () => {
    const cmd = generateResearchCommand('path\\with\\backslash', 'standard');
    assert.ok(cmd.includes('\\\\'));
  });

  it('escapes double quotes', () => {
    const cmd = generateResearchCommand('what is "X"', 'standard');
    // Should contain escaped quotes — not unbalanced
    assert.ok(cmd.includes('\\"'));
  });

  it('replaces newlines with spaces', () => {
    const cmd = generateResearchCommand('line1\nline2', 'standard');
    assert.ok(!cmd.includes('\n'));
  });

  it('removes carriage returns', () => {
    const cmd = generateResearchCommand('foo\r\nbar', 'standard');
    assert.ok(!cmd.includes('\r'));
  });

  it('replaces tabs with spaces', () => {
    const cmd = generateResearchCommand('foo\tbar', 'standard');
    assert.ok(!cmd.includes('\t'));
  });
});

// ============================================================
// detectUnverifiedClaims
// ============================================================

describe('detectUnverifiedClaims', () => {
  it('returns empty for null/non-string', () => {
    const r1 = detectUnverifiedClaims(null);
    assert.equal(r1.hasClaims, false);
    assert.deepEqual(r1.claims, []);

    assert.equal(detectUnverifiedClaims(undefined).hasClaims, false);
    assert.equal(detectUnverifiedClaims(42).hasClaims, false);
  });

  it('detects capability claims ("doesn\'t support")', () => {
    const r = detectUnverifiedClaims("It doesn't support async iterators");
    assert.equal(r.hasClaims, true);
    assert.ok(r.claims.length >= 1);
  });

  it('detects "not supported" claims', () => {
    const r = detectUnverifiedClaims('this is not supported in v2');
    assert.equal(r.hasClaims, true);
  });

  it('detects existence claims ("there is no")', () => {
    const r = detectUnverifiedClaims('there is no API for this in the framework');
    assert.equal(r.hasClaims, true);
  });

  it('detects certainty claims ("definitely", "always", "never")', () => {
    const r = detectUnverifiedClaims('this always fails silently without notice');
    assert.equal(r.hasClaims, true);
  });

  it('detects version-specific claims', () => {
    const r = detectUnverifiedClaims('as of version 2.5 this is the default');
    assert.equal(r.hasClaims, true);
  });

  it('deduplicates repeated claims', () => {
    const text = "It doesn't support X. It doesn't support X. It doesn't support X.";
    const r = detectUnverifiedClaims(text);
    // All instances hit the same capability pattern — dedupe to 1 unique
    assert.equal(r.claims.length, 1);
  });

  it('caps claims at 10', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      `there is no feature${i} for this`
    ).join(' ');
    const r = detectUnverifiedClaims(many);
    assert.ok(r.claims.length <= 10);
  });

  it('claims carry text + needsVerification + confidence', () => {
    const r = detectUnverifiedClaims('this is not supported in the library');
    if (r.claims.length > 0) {
      const claim = r.claims[0];
      assert.ok(typeof claim.text === 'string');
      assert.equal(claim.needsVerification, true);
      assert.ok('confidence' in claim);
    }
  });

  it('returns hasClaims=false for clean text', () => {
    const r = detectUnverifiedClaims('I will read the file and report back');
    assert.equal(r.hasClaims, false);
  });
});

// ============================================================
// formatClaimWarning
// ============================================================

describe('formatClaimWarning', () => {
  it('returns empty string for null/empty claims', () => {
    assert.equal(formatClaimWarning(null), '');
    assert.equal(formatClaimWarning([]), '');
    assert.equal(formatClaimWarning(undefined), '');
  });

  it('includes claim text', () => {
    const msg = formatClaimWarning([{ text: "doesn't support X" }]);
    assert.ok(msg.includes("doesn't support X"));
  });

  it('mentions /wogi-research recommendation', () => {
    const msg = formatClaimWarning([{ text: 'test claim' }]);
    assert.ok(msg.includes('/wogi-research'));
  });

  it('truncates display to first 5 claims', () => {
    const claims = Array.from({ length: 10 }, (_, i) => ({ text: `claim ${i}` }));
    const msg = formatClaimWarning(claims);
    assert.ok(msg.includes('claim 0'));
    assert.ok(msg.includes('claim 4'));
    assert.ok(!msg.includes('claim 5'));
    // Should mention the overflow
    assert.ok(msg.includes('5 more') || msg.includes('... and 5'));
  });

  it('does not show "... and N more" when exactly 5 claims', () => {
    const claims = Array.from({ length: 5 }, (_, i) => ({ text: `claim ${i}` }));
    const msg = formatClaimWarning(claims);
    assert.ok(!msg.includes('more'));
  });
});

// ============================================================
// normalizeQuery
// ============================================================

describe('normalizeQuery', () => {
  it('lowercases the query', () => {
    assert.equal(normalizeQuery('Hello World'), 'hello world');
  });

  it('trims leading/trailing whitespace', () => {
    assert.equal(normalizeQuery('  foo  '), 'foo');
  });

  it('collapses internal whitespace to single space', () => {
    assert.equal(normalizeQuery('foo    bar\t\tbaz'), 'foo bar baz');
  });

  it('collapses newlines into single space', () => {
    assert.equal(normalizeQuery('line1\nline2'), 'line1 line2');
  });

  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(300);
    const n = normalizeQuery(long);
    assert.equal(n.length, 200);
  });
});

// ============================================================
// isResearchMandatory
// ============================================================

describe('isResearchMandatory — context-aware defaults', () => {
  it('returns a boolean for explore_phase context', () => {
    assert.equal(typeof isResearchMandatory('explore_phase'), 'boolean');
  });

  it('returns a boolean for history context', () => {
    assert.equal(typeof isResearchMandatory('history'), 'boolean');
  });

  it('returns false for unknown contexts', () => {
    assert.equal(isResearchMandatory('random_context'), false);
    assert.equal(isResearchMandatory(''), false);
  });
});
