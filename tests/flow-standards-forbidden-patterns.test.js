'use strict';

/**
 * Tests for checkForbiddenPatterns + globMatch (wf-037f8d66 Fix 2).
 *
 * Declarative pattern enforcement for project-specific rules
 * (agnosticism, no-hardcoding, etc.).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkForbiddenPatterns,
  globMatch
} = require('../scripts/flow-standards-checker');

// ============================================================
// globMatch
// ============================================================

test('globMatch — exact match', () => {
  assert.equal(globMatch('docs/intro.md', 'docs/intro.md'), true);
  assert.equal(globMatch('src/foo.go', 'docs/intro.md'), false);
});

test('globMatch — single * matches within directory', () => {
  assert.equal(globMatch('docs/intro.md', 'docs/*.md'), true);
  assert.equal(globMatch('docs/sub/intro.md', 'docs/*.md'), false); // * doesn't cross /
});

test('globMatch — ** crosses directories', () => {
  assert.equal(globMatch('docs/sub/intro.md', 'docs/**'), true);
  assert.equal(globMatch('docs/intro.md', 'docs/**'), true);
  assert.equal(globMatch('src/foo.go', 'docs/**'), false);
});

test('globMatch — *.md matches all md files in cwd', () => {
  assert.equal(globMatch('intro.md', '*.md'), true);
  assert.equal(globMatch('docs/intro.md', '*.md'), false);
});

test('globMatch — escapes regex metacharacters', () => {
  assert.equal(globMatch('a.b.c', 'a.b.c'), true);
  assert.equal(globMatch('aXbYc', 'a.b.c'), false); // dot is literal
});

// ============================================================
// checkForbiddenPatterns
// ============================================================

const baseFile = (path, content) => ({ path, content });

test('checkForbiddenPatterns — empty patterns array → no violations', () => {
  const v = checkForbiddenPatterns(baseFile('src/foo.go', 'claude-code is forbidden'), []);
  assert.equal(v.length, 0);
});

test('checkForbiddenPatterns — pattern matches → violation reported', () => {
  const patterns = [
    { id: 'no-claude-code', pattern: 'claude-code', severity: 'must-fix', message: 'forbidden' }
  ];
  const v = checkForbiddenPatterns(baseFile('src/foo.go', 'const x = "claude-code";'), patterns);
  assert.equal(v.length, 1);
  assert.equal(v[0].type, 'forbidden-pattern');
  assert.equal(v[0].severity, 'must-fix');
  assert.equal(v[0].rule, 'forbidden-patterns.json: no-claude-code');
  assert.match(v[0].message, /forbidden/);
});

test('checkForbiddenPatterns — exempted file → no violation', () => {
  const patterns = [
    { id: 'no-claude', pattern: 'claude-code', exemptions: ['docs/**', '*.md'], severity: 'must-fix' }
  ];
  // Exempted by docs/**
  const v1 = checkForbiddenPatterns(baseFile('docs/foo.md', 'claude-code'), patterns);
  assert.equal(v1.length, 0);
  // Exempted by *.md
  const v2 = checkForbiddenPatterns(baseFile('README.md', 'claude-code'), patterns);
  assert.equal(v2.length, 0);
  // NOT exempted (different path)
  const v3 = checkForbiddenPatterns(baseFile('src/foo.go', 'claude-code'), patterns);
  assert.equal(v3.length, 1);
});

test('checkForbiddenPatterns — multiple matches in one file → multiple violations with line numbers', () => {
  const content = "line1\nconst a = 'claude-code';\nline3\nconst b = 'claude-code';";
  const patterns = [
    { id: 'no-claude', pattern: 'claude-code', severity: 'must-fix' }
  ];
  const v = checkForbiddenPatterns(baseFile('src/foo.go', content), patterns);
  assert.equal(v.length, 2);
  assert.equal(v[0].line, 2);
  assert.equal(v[1].line, 4);
});

test('checkForbiddenPatterns — severity warning vs must-fix', () => {
  const patterns = [
    { id: 'soft', pattern: 'TODO', severity: 'warning' },
    { id: 'hard', pattern: 'XXX', severity: 'must-fix' }
  ];
  const v = checkForbiddenPatterns(baseFile('src/foo.go', 'TODO XXX'), patterns);
  assert.equal(v.length, 2);
  const soft = v.find(x => x.rule.includes('soft'));
  const hard = v.find(x => x.rule.includes('hard'));
  assert.equal(soft.severity, 'warning');
  assert.equal(hard.severity, 'must-fix');
});

test('checkForbiddenPatterns — invalid regex skipped, no crash', () => {
  const patterns = [
    { id: 'broken', pattern: '[invalid(', severity: 'must-fix' }, // unclosed bracket
    { id: 'good', pattern: 'good', severity: 'must-fix' }
  ];
  const v = checkForbiddenPatterns(baseFile('src/foo.go', 'good'), patterns);
  // Should still match the good pattern despite the broken one
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, 'forbidden-patterns.json: good');
});

test('checkForbiddenPatterns — empty content → no violations', () => {
  const v = checkForbiddenPatterns(baseFile('src/foo.go', ''), [
    { id: 'x', pattern: 'anything', severity: 'must-fix' }
  ]);
  assert.equal(v.length, 0);
});

test('checkForbiddenPatterns — model-name regex (agnosticism scenario)', () => {
  // Real-world pattern: catch hardcoded model names outside provider config
  const patterns = [
    {
      id: 'no-hardcoded-models',
      pattern: 'claude-(opus|sonnet|haiku)-[\\d.]+',
      exemptions: ['internal/provider/**', '*.md'],
      severity: 'must-fix',
      message: 'Hardcoded model name; use provider.Request.Model field'
    }
  ];

  // Violation: model name in agent code
  const v1 = checkForbiddenPatterns(baseFile('internal/agent/loop.go', 'model: "claude-opus-4-7"'), patterns);
  assert.equal(v1.length, 1);

  // Exempted: same in provider/
  const v2 = checkForbiddenPatterns(baseFile('internal/provider/anthropic.go', 'model: "claude-opus-4-7"'), patterns);
  assert.equal(v2.length, 0);
});

test('checkForbiddenPatterns — absolute path detection (agnosticism scenario)', () => {
  const patterns = [
    {
      id: 'no-hardcoded-paths',
      pattern: '/Users/[a-z]+/',
      exemptions: ['*.md', 'docs/**'],
      severity: 'must-fix',
      message: 'Hardcoded user path; use relative or env-derived path'
    }
  ];
  const v = checkForbiddenPatterns(baseFile('cmd/wogi/main.go', 'const path = "/Users/tomergilboa/.cache"'), patterns);
  assert.equal(v.length, 1);
});

// AC3 — ReDoS guard: nested-quantifier patterns rejected pre-compile, completes fast
test('checkForbiddenPatterns — nested-quantifier rejected pre-compile, completes fast', () => {
  const patterns = [
    {
      id: 'evil-redos',
      pattern: '^(a+)+$',
      severity: 'must-fix',
      message: 'should never run'
    }
  ];
  // 30+ a's would lock a vulnerable matcher for ~50s. Pre-compile reject = fast.
  const evilContent = 'a'.repeat(30) + 'b';
  const start = Date.now();
  const v = checkForbiddenPatterns(baseFile('src/foo.js', evilContent), patterns);
  const elapsed = Date.now() - start;
  assert.equal(v.length, 1);
  assert.equal(v[0].type, 'forbidden-pattern-malformed');
  assert.ok(elapsed < 1000, `expected <1000ms, got ${elapsed}ms`);
});

// AC3 — content over 1MB cap is skipped silently
test('checkForbiddenPatterns — content over 1MB cap is skipped', () => {
  const patterns = [
    {
      id: 'find-foo',
      pattern: 'foo',
      severity: 'must-fix',
      message: 'foo found'
    }
  ];
  const huge = 'foo'.repeat(400_000); // ~1.2MB
  const v = checkForbiddenPatterns(baseFile('src/huge.js', huge), patterns);
  assert.equal(v.length, 0); // skipped due to size cap
});
