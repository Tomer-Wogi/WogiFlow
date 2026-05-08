'use strict';

/**
 * Tests for scripts/flow-audit-gates.js
 *
 * Focus: parseTestErrorCount() — the parser introduced in wf-e111d850 to fix
 * the false-positive errorCount bug where the generic runProjectScript regex
 * matched "error" substrings in passing test descriptions.
 *
 * Bug context (AUDIT-INFRA-001 from 2026-05-08 audit):
 *   - Generic regex /error TS\d+|Error:|ERROR/gi matched 80 passing-test
 *     description substrings (e.g., 'trimRetryErrors', 'classifier error',
 *     'returns null on git unavailable / error')
 *   - Node test runner v22 exits 1 even on all-pass in some configs
 *   - Result: Gate 0 reported 'tests FAIL — 80 errors' when 2574/2574 passed
 *
 * Fix: parseTestErrorCount() parses the actual Node test runner summary
 * line "Results: N passed, M failed" instead of guessing from substring.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTestErrorCount } = require('../scripts/flow-audit-gates');

test('parseTestErrorCount — passing tests with "error" in names → 0 errors', () => {
  // This is the actual bug scenario: passing tests whose names contain "error"
  // substring. Old regex matched these; new parser must not.
  const output = `
TAP version 14
ok 1 - trimRetryErrors normalizes timeout
ok 2 - classifier error path returns ROUTE_BUG
ok 3 - returns null on git unavailable / error
ok 4 - safeJsonParse rejects __proto__ injection
ok 5 - logs Error: on JSON parse failure with default

Results: 5 passed, 0 failed
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 0);
  assert.equal(r.source, 'summary');
});

test('parseTestErrorCount — real failing tests counted correctly', () => {
  const output = `
ok 1 - first test passes
not ok 2 - second test fails
  ---
  message: 'Expected x to be y'
  ...
not ok 3 - third test also fails
ok 4 - fourth passes

Results: 2 passed, 2 failed
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 2);
  assert.equal(r.source, 'summary');
});

test('parseTestErrorCount — mixed pass/fail with "error" in passing names → only count real failures', () => {
  // The hardest scenario: legit failures alongside passing tests with "error"
  // in their names. Old regex would conflate. New parser must isolate.
  const output = `
ok 1 - trimRetryErrors works
ok 2 - classifier handles ERROR cases gracefully
not ok 3 - actual broken test
not ok 4 - another real failure
ok 5 - returns null on git unavailable / error

Results: 3 passed, 2 failed
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 2);
  assert.equal(r.source, 'summary');
});

test('parseTestErrorCount — multiple suites (multiple Results lines) → sum failures', () => {
  // npm test running multiple files emits one "Results:" line per file.
  // Parser must sum across them.
  const output = `
=== suite-1 ===
ok 1 - test a
Results: 1 passed, 0 failed

=== suite-2 ===
not ok 1 - test b
Results: 0 passed, 1 failed

=== suite-3 ===
ok 1 - test c
not ok 2 - test d
not ok 3 - test e
Results: 1 passed, 2 failed
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 3); // 0 + 1 + 2
  assert.equal(r.source, 'summary');
});

test('parseTestErrorCount — TAP fallback when no Results: summary present', () => {
  // Older test runners or non-Node TAP emitters may not produce Results: lines.
  // Fallback to counting "not ok N" lines.
  const output = `
TAP version 13
ok 1 - alpha
not ok 2 - beta
not ok 3 - gamma
ok 4 - delta
1..4
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 2);
  assert.equal(r.source, 'tap');
});

test('parseTestErrorCount — graceful default on empty output', () => {
  const r = parseTestErrorCount('');
  assert.equal(r.errorCount, 0);
  assert.equal(r.source, 'default');
});

test('parseTestErrorCount — graceful default on null/undefined input', () => {
  assert.equal(parseTestErrorCount(null).errorCount, 0);
  assert.equal(parseTestErrorCount(undefined).errorCount, 0);
  assert.equal(parseTestErrorCount(null).source, 'default');
});

test('parseTestErrorCount — output with no failure markers → 0 errors', () => {
  // No "Results:" line, no "not ok" lines. Parser should default to 0,
  // NOT crash, NOT match generic "error" substrings in arbitrary text.
  const output = `
Some unstructured output mentioning Error: and ERROR everywhere
but with no actual TAP or test runner summary format.
classifier error in the middle of the line
returns null on git unavailable / error - just text
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 0);
  assert.equal(r.source, 'default');
});

test('parseTestErrorCount — large passing count is parsed correctly', () => {
  // The original bug reported "80 errors" when 2574 tests passed.
  // Synthesize that scenario: large pass count, 0 failures.
  const output = `
Results: 2574 passed, 0 failed
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 0);
  assert.equal(r.source, 'summary');
});

test('parseTestErrorCount — failures-only summary (zero passes)', () => {
  const output = `
not ok 1 - test failed
not ok 2 - another failure
Results: 0 passed, 2 failed
`;
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 2);
  assert.equal(r.source, 'summary');
});

test('parseTestErrorCount — handles ANSI-stripped runner output (Forced via NO_COLOR=1 in runProjectScript)', () => {
  // runProjectScript sets FORCE_COLOR=0 and NO_COLOR=1 so we expect plain
  // ASCII output. But guard: even if some color codes leak through, the
  // regex should still match the "Results:" pattern since it's a literal.
  const output = '[2K[GResults: 100 passed, 5 failed\n';
  const r = parseTestErrorCount(output);
  assert.equal(r.errorCount, 5);
  assert.equal(r.source, 'summary');
});
