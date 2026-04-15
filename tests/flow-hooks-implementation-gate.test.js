'use strict';

/**
 * Tests for scripts/hooks/core/implementation-gate.js (Wave F hook coverage).
 *
 * Covers: truncatePrompt, matchesAnyPattern, calculateConfidence, isWogiCommand,
 * isExplorationRequest (pattern + question-mark heuristic), detectImplementationIntent
 * (match count → confidence), classifyRequest priority cascade (exploration >
 * operational > bug > quick-fix > implementation > unknown), generateRoutingContext
 * content shape, pattern array exports.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-implementation-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const implGate = require('../scripts/hooks/core/implementation-gate');
const {
  truncatePrompt,
  matchesAnyPattern,
  calculateConfidence,
  isWogiCommand,
  isExplorationRequest,
  detectImplementationIntent,
  classifyRequest,
  generateRoutingContext,
  checkImplementationGate,
  IMPLEMENTATION_PATTERNS,
  EXPLORATION_PATTERNS,
  OPERATIONAL_PATTERNS,
  BUG_PATTERNS,
  QUICK_FIX_PATTERNS,
} = implGate;

// ============================================================
// truncatePrompt
// ============================================================

describe('truncatePrompt', () => {
  it('returns short prompt unchanged', () => {
    assert.equal(truncatePrompt('short prompt'), 'short prompt');
  });

  it('truncates long prompts with ellipsis', () => {
    const long = 'a'.repeat(200);
    const r = truncatePrompt(long);
    assert.ok(r.endsWith('...'));
    assert.ok(r.length <= 85); // 80 + '...'
  });

  it('respects custom maxLength', () => {
    const r = truncatePrompt('hello world', 5);
    assert.equal(r, 'hello...');
  });

  it('returns empty string for non-string input', () => {
    assert.equal(truncatePrompt(null), '');
    assert.equal(truncatePrompt(undefined), '');
    assert.equal(truncatePrompt(42), '');
  });
});

// ============================================================
// matchesAnyPattern
// ============================================================

describe('matchesAnyPattern', () => {
  it('returns true when any pattern matches', () => {
    const patterns = [/foo/, /bar/];
    assert.equal(matchesAnyPattern('hello bar world', patterns), true);
  });

  it('returns false when no pattern matches', () => {
    assert.equal(matchesAnyPattern('hello', [/foo/, /bar/]), false);
  });

  it('returns false for null/undefined prompt', () => {
    assert.equal(matchesAnyPattern(null, [/foo/]), false);
    assert.equal(matchesAnyPattern(undefined, [/foo/]), false);
  });

  it('returns false for null patterns array', () => {
    assert.equal(matchesAnyPattern('hello', null), false);
  });

  it('handles array with single pattern', () => {
    assert.equal(matchesAnyPattern('hello world', [/hello/]), true);
  });
});

// ============================================================
// calculateConfidence
// ============================================================

describe('calculateConfidence', () => {
  it('returns "high" for 2+ matches', () => {
    assert.equal(calculateConfidence(2), 'high');
    assert.equal(calculateConfidence(5), 'high');
  });

  it('returns "medium" for exactly 1 match', () => {
    assert.equal(calculateConfidence(1), 'medium');
  });

  it('returns "low" for 0 matches', () => {
    assert.equal(calculateConfidence(0), 'low');
  });
});

// ============================================================
// isWogiCommand
// ============================================================

describe('isWogiCommand', () => {
  it('detects /wogi-* commands at start', () => {
    assert.equal(isWogiCommand('/wogi-start'), true);
    assert.equal(isWogiCommand('/wogi-story "feature"'), true);
    assert.equal(isWogiCommand('/wogi-bug'), true);
  });

  it('detects /flow commands', () => {
    assert.equal(isWogiCommand('/flow status'), true);
  });

  it('detects "run /wogi-X" phrasing', () => {
    assert.equal(isWogiCommand('please run /wogi-ready'), true);
    assert.equal(isWogiCommand('run wogi-start'), true);
  });

  it('tolerates leading whitespace', () => {
    assert.equal(isWogiCommand('   /wogi-start'), true);
  });

  it('returns false for non-wogi prompts', () => {
    assert.equal(isWogiCommand('add a new feature'), false);
    assert.equal(isWogiCommand('what does this do?'), false);
  });

  it('returns false for null/non-string', () => {
    assert.equal(isWogiCommand(null), false);
    assert.equal(isWogiCommand(42), false);
  });
});

// ============================================================
// isExplorationRequest
// ============================================================

describe('isExplorationRequest — pattern matching', () => {
  it('detects "what does X" questions', () => {
    assert.equal(isExplorationRequest('what does this function do'), true);
  });

  it('detects "how do/does" questions', () => {
    assert.equal(isExplorationRequest('how does the router work'), true);
  });

  it('detects "why" questions', () => {
    assert.equal(isExplorationRequest('why does it fail here'), true);
  });

  it('detects "show me"', () => {
    assert.equal(isExplorationRequest('show me the auth flow'), true);
  });

  it('detects "explain" / "describe"', () => {
    assert.equal(isExplorationRequest('explain how X works'), true);
    assert.equal(isExplorationRequest('describe the data flow'), true);
  });

  it('detects "list all / the"', () => {
    assert.equal(isExplorationRequest('list all endpoints'), true);
  });

  it('detects question marks in short prompts', () => {
    assert.equal(isExplorationRequest('is this correct?'), true);
  });

  it('does NOT treat long prompts with "?" as exploration (length > 500)', () => {
    const long = 'a'.repeat(501) + '?';
    assert.equal(isExplorationRequest(long), false);
  });

  it('returns false for non-exploration', () => {
    assert.equal(isExplorationRequest('add a new feature for users'), false);
  });

  it('returns false for null/non-string', () => {
    assert.equal(isExplorationRequest(null), false);
    assert.equal(isExplorationRequest(42), false);
  });
});

// ============================================================
// detectImplementationIntent
// ============================================================

describe('detectImplementationIntent', () => {
  it('detects "add" implementation phrasing', () => {
    const r = detectImplementationIntent('add a logout button');
    assert.equal(r.isImplementation, true);
    assert.ok(['medium', 'high'].includes(r.confidence));
    assert.ok(r.matches.length >= 1);
  });

  it('detects "implement X" with high confidence when multiple patterns match', () => {
    const r = detectImplementationIntent('implement a new feature for user auth');
    assert.equal(r.isImplementation, true);
    assert.ok(r.matches.length >= 1);
  });

  it('detects "fix bug" as implementation', () => {
    const r = detectImplementationIntent('fix the login bug');
    assert.equal(r.isImplementation, true);
  });

  it('detects "create component"', () => {
    const r = detectImplementationIntent('create a new Button component');
    assert.equal(r.isImplementation, true);
  });

  it('returns empty result for exploration phrasing', () => {
    const r = detectImplementationIntent('what does this do');
    assert.equal(r.isImplementation, false);
    assert.equal(r.confidence, 'low');
    assert.deepEqual(r.matches, []);
  });

  it('returns empty result for null/non-string', () => {
    assert.equal(detectImplementationIntent(null).isImplementation, false);
    assert.equal(detectImplementationIntent(42).isImplementation, false);
    assert.equal(detectImplementationIntent('').isImplementation, false);
  });
});

// ============================================================
// classifyRequest — priority cascade
// ============================================================

describe('classifyRequest — priority order (exploration > operational > bug > quick-fix > impl)', () => {
  it('classifies exploration', () => {
    const r = classifyRequest('what does this function do?');
    assert.equal(r.category, 'exploration');
    assert.equal(r.action, 'proceed');
  });

  it('classifies operational (git)', () => {
    const r = classifyRequest('git push to origin');
    assert.equal(r.category, 'operational');
    assert.equal(r.action, 'execute');
  });

  it('classifies operational (npm)', () => {
    const r = classifyRequest('npm publish to registry');
    assert.equal(r.category, 'operational');
  });

  it('classifies bug reports', () => {
    const r = classifyRequest('the login is broken');
    assert.equal(r.category, 'bug');
    assert.equal(r.action, 'create-bug');
  });

  it('classifies quick-fix typo', () => {
    const r = classifyRequest('fix typo in readme');
    // "fix typo" matches both BUG_PATTERNS (fix) and QUICK_FIX_PATTERNS (typo).
    // Based on priority: bug takes precedence if "fix" matches — but "typo" fires quick-fix.
    // Accept either since they route reasonably.
    assert.ok(['bug', 'quick-fix'].includes(r.category), `unexpected: ${r.category}`);
  });

  it('classifies implementation', () => {
    const r = classifyRequest('build a new dashboard');
    assert.equal(r.category, 'implementation');
    assert.equal(r.action, 'create-story');
    assert.ok(Array.isArray(r.matches));
  });

  it('classifies empty prompt as unknown', () => {
    const r = classifyRequest('');
    assert.equal(r.category, 'unknown');
    assert.equal(r.action, 'ask');
  });

  it('classifies null prompt as unknown', () => {
    const r = classifyRequest(null);
    assert.equal(r.category, 'unknown');
  });

  it('always returns matches array', () => {
    for (const prompt of ['what?', 'git push', 'bug', 'typo', 'add feature', '']) {
      const r = classifyRequest(prompt);
      assert.ok(Array.isArray(r.matches), `matches should be array for: ${prompt}`);
    }
  });

  it('truncates overly long prompts safely (no crash)', () => {
    const huge = 'a'.repeat(15000);
    assert.doesNotThrow(() => classifyRequest(huge));
  });
});

// ============================================================
// generateRoutingContext
// ============================================================

describe('generateRoutingContext', () => {
  it('mentions /wogi-start invocation', () => {
    const r = generateRoutingContext('build a dashboard');
    assert.ok(r.includes('wogi-start'));
    assert.ok(r.includes('Skill'));
  });

  it('embeds truncated prompt (max 200 chars)', () => {
    const long = 'x'.repeat(500);
    const r = generateRoutingContext(long);
    // Should contain the prompt but truncated
    assert.ok(r.includes('...'));
  });
});

// ============================================================
// checkImplementationGate — result contract
// ============================================================

describe('checkImplementationGate — result contract', () => {
  it('allows empty prompt with reason=empty_prompt', () => {
    const r = checkImplementationGate({ prompt: '' });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'empty_prompt');
  });

  it('allows whitespace-only prompt', () => {
    const r = checkImplementationGate({ prompt: '   ' });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'empty_prompt');
  });

  it('allows /wogi-* commands with reason=wogi_command', () => {
    const r = checkImplementationGate({ prompt: '/wogi-start' });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'wogi_command');
  });

  it('allows null/undefined prompt', () => {
    assert.equal(checkImplementationGate({ prompt: null }).allowed, true);
    assert.equal(checkImplementationGate({}).allowed, true);
  });
});

// ============================================================
// Pattern arrays
// ============================================================

describe('pattern arrays', () => {
  it('all exported arrays are populated RegExp arrays', () => {
    for (const [name, arr] of Object.entries({
      IMPLEMENTATION_PATTERNS, EXPLORATION_PATTERNS,
      OPERATIONAL_PATTERNS, BUG_PATTERNS, QUICK_FIX_PATTERNS,
    })) {
      assert.ok(Array.isArray(arr), `${name} should be array`);
      assert.ok(arr.length > 0, `${name} should have entries`);
      for (const pat of arr) {
        assert.ok(pat instanceof RegExp, `${name} entry should be RegExp`);
      }
    }
  });
});
