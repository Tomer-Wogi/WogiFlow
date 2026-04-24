#!/usr/bin/env node

/**
 * Tests for Spec-String Bundle Grep.
 * Story: wf-07046456 (B4)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractSpecStrings,
  verifySpecBundleCoverage,
  formatSpecBundleResult,
} = require('../scripts/flow-completion-truth-gate');

const SPEC = `# Story wf-xxx

## Description
Integrate with \`POST /api/v1/users\` endpoint.
Touch files: src/api/users.js and src/lib/cache.ts.
Error message shown to user: "Invalid credentials".
Export constant: MAX_LOGIN_ATTEMPTS.
`;

test('extractSpecStrings captures backtick IDs', () => {
  const b = extractSpecStrings(SPEC);
  assert.ok(b.backtickIds.includes('POST /api/v1/users'));
});

test('extractSpecStrings captures quoted strings', () => {
  const b = extractSpecStrings(SPEC);
  assert.ok(b.quotedStrings.includes('Invalid credentials'));
});

test('extractSpecStrings captures file paths', () => {
  const b = extractSpecStrings(SPEC);
  assert.ok(b.filePaths.includes('src/api/users.js'));
  assert.ok(b.filePaths.includes('src/lib/cache.ts'));
});

test('extractSpecStrings captures constants (with underscore/digit) but not bare HTTP verbs', () => {
  const b = extractSpecStrings(SPEC);
  assert.ok(b.constants.includes('MAX_LOGIN_ATTEMPTS'));
  assert.equal(b.constants.includes('POST'), false);
});

test('extractSpecStrings captures route paths', () => {
  const b = extractSpecStrings(SPEC);
  assert.ok(b.routes.includes('/api/v1/users'));
});

test('extractSpecStrings ignores content inside code fences', () => {
  const spec = '# Story\n\n```js\nconst POST = "from code block";\n```\n\nBody mentions `onlyThis`.';
  const b = extractSpecStrings(spec);
  assert.ok(b.backtickIds.includes('onlyThis'));
  // constants from code fence should not appear; POST was excluded anyway
  assert.equal(b.quotedStrings.includes('from code block'), false);
});

test('extractSpecStrings returns empty bundle for empty input', () => {
  const b = extractSpecStrings('');
  assert.equal(b.all.length, 0);
});

test('verifySpecBundleCoverage passes when everything is present', () => {
  const diff = 'src/api/users.js src/lib/cache.ts MAX_LOGIN_ATTEMPTS /api/v1/users POST /api/v1/users Invalid credentials';
  const v = verifySpecBundleCoverage({ specMarkdown: SPEC, diffText: diff });
  assert.equal(v.ok, true);
});

test('verifySpecBundleCoverage fails when file paths are missing', () => {
  const diff = 'MAX_LOGIN_ATTEMPTS /api/v1/users POST /api/v1/users Invalid credentials';
  const v = verifySpecBundleCoverage({ specMarkdown: SPEC, diffText: diff, changedFiles: [] });
  assert.equal(v.ok, false);
  assert.ok(v.missingByCategory.filePaths.length > 0);
});

test('verifySpecBundleCoverage respects per-category thresholds', () => {
  const spec = '# s\nFiles: a.js, b.js, c.js';
  const v = verifySpecBundleCoverage({
    specMarkdown: spec,
    diffText: 'a.js b.js',
    categoryMins: { filePaths: 0.5 },
  });
  assert.equal(v.ok, true); // 2/3 = 0.67, threshold 0.5
});

test('formatSpecBundleResult shows missing items on FAIL', () => {
  const v = verifySpecBundleCoverage({
    specMarkdown: SPEC,
    diffText: '',
    changedFiles: [],
  });
  const s = formatSpecBundleResult(v);
  assert.match(s, /FAIL/);
  assert.match(s, /missing:/);
});
