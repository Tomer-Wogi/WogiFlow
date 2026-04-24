#!/usr/bin/env node

/**
 * Tests for non-negotiable rules + filepath:line citation validators.
 * Story: wf-d0adca72 (A5)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  checkNonNegotiableFragment,
  checkComposedPromptHasNonNegotiables,
  checkCitationFormat,
  NON_NEGOTIABLE_FRAGMENT_PATH,
  CITATION_FORMAT_REGEX,
} = require('../scripts/flow-standards-checker');
const { composePrompt } = require('../scripts/flow-prompt-composer');

test('non-negotiable fragment file exists on disk', () => {
  const p = path.join(__dirname, '..', NON_NEGOTIABLE_FRAGMENT_PATH);
  assert.ok(fs.existsSync(p));
});

test('checkNonNegotiableFragment passes when fragment is well-formed', () => {
  const r = checkNonNegotiableFragment();
  assert.equal(r.ok, true);
});

test('checkComposedPromptHasNonNegotiables detects missing header', () => {
  const r = checkComposedPromptHasNonNegotiables('generic prompt without the rules block');
  assert.equal(r.ok, false);
  assert.match(r.reason, /Non-Negotiable Rules/);
});

test('checkComposedPromptHasNonNegotiables detects missing citation rule', () => {
  const r = checkComposedPromptHasNonNegotiables('# Non-Negotiable Rules\n\nsome other text');
  assert.equal(r.ok, false);
  assert.match(r.reason, /citation-format/);
});

test('checkComposedPromptHasNonNegotiables accepts complete block', () => {
  const ok = '# Non-Negotiable Rules\n\nUse filepath:line citations for every code reference.';
  assert.equal(checkComposedPromptHasNonNegotiables(ok).ok, true);
});

test('CITATION_FORMAT_REGEX matches valid forms', () => {
  assert.ok(CITATION_FORMAT_REGEX.test('see scripts/foo.js:42'));
  assert.ok(CITATION_FORMAT_REGEX.test('file .workflow/state/decisions.md:150'));
  assert.ok(CITATION_FORMAT_REGEX.test('range at src/a/b/c.tsx:12-18'));
});

test('CITATION_FORMAT_REGEX rejects invalid forms', () => {
  assert.equal(CITATION_FORMAT_REGEX.test('just prose no citation'), false);
  assert.equal(CITATION_FORMAT_REGEX.test('#L142'), false);
  assert.equal(CITATION_FORMAT_REGEX.test('the foo.js file'), false);
});

test('checkCitationFormat passes when claim has citation', () => {
  const r = checkCitationFormat('The function lives at scripts/flow-utils.js:142');
  assert.equal(r.ok, true);
  assert.equal(r.hasCitation, true);
});

test('checkCitationFormat fails when claim references code with no citation', () => {
  const r = checkCitationFormat('The `foo` function is broken');
  assert.equal(r.ok, false);
});

test('checkCitationFormat allows text with no code claims', () => {
  const r = checkCitationFormat('Hello world, just a sentence.');
  assert.equal(r.ok, true);
  assert.equal(r.hasCitation, false);
});

test('composePrompt includes the non-negotiable-rules fragment by default', () => {
  const result = composePrompt({ model: 'claude-opus-4-5', taskType: 'feature', includeCore: true });
  assert.ok(result.prompt.includes('Non-Negotiable Rules'));
  assert.ok(result.prompt.includes('filepath:line'));
  const check = checkComposedPromptHasNonNegotiables(result.prompt);
  assert.equal(check.ok, true);
});

test('composed fragment appears before task-context (order: 5 < 10)', () => {
  const result = composePrompt({ model: 'claude-opus-4-5', taskType: 'feature', includeCore: true });
  const nonNegIdx = result.prompt.indexOf('Non-Negotiable Rules');
  const taskCtxIdx = result.prompt.indexOf('Task Context');
  assert.ok(nonNegIdx >= 0 && taskCtxIdx >= 0);
  assert.ok(nonNegIdx < taskCtxIdx, 'non-negotiable must appear before task context');
});
