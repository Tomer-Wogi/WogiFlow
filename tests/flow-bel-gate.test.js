#!/usr/bin/env node

/**
 * Tests for BEL (Bulleted-Expectation List) grep gate.
 * Story: wf-10c452f7 (B2)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseBELItems,
  verifyBELAgainstDelivery,
  formatBELResult,
} = require('../scripts/flow-completion-truth-gate');

const SPEC = `# Story

## Description
Some description.

## Acceptance Criteria
- User can upload a profile photo
- Photo is automatically resized to 200x200
- Invalid file types show an error toast

## Technical Notes
- Use the existing AuthProvider for session context
`;

test('parseBELItems extracts items from Acceptance Criteria section', () => {
  const items = parseBELItems(SPEC);
  assert.equal(items.length, 3);
  assert.equal(items[0].heading, 'Acceptance Criteria');
  assert.match(items[0].text, /upload a profile photo/);
});

test('parseBELItems skips items from non-BEL sections', () => {
  const items = parseBELItems(SPEC);
  const textJoin = items.map((i) => i.text).join('\n');
  assert.equal(textJoin.includes('AuthProvider'), false);
});

test('parseBELItems returns empty for spec without BEL sections', () => {
  assert.deepEqual(parseBELItems('# Plain doc\nno bullets here'), []);
});

test('parseBELItems handles Success Criteria / Requirements headings', () => {
  const spec = '## Success Criteria\n- First\n- Second\n## Requirements\n- Third';
  const items = parseBELItems(spec);
  assert.equal(items.length, 3);
});

test('verifyBELAgainstDelivery passes when all items covered', () => {
  const v = verifyBELAgainstDelivery({
    specMarkdown: SPEC,
    diffText: 'uploaded photo to profile resized automatically to 200 pixels, invalid file types show toast error',
    changedFiles: ['src/profile.tsx'],
    commitMessage: 'feat(profile): photo upload',
  });
  assert.equal(v.ok, true);
  assert.equal(v.coveredItems.length, 3);
  assert.equal(v.uncoveredItems.length, 0);
});

test('verifyBELAgainstDelivery flags uncovered items', () => {
  const v = verifyBELAgainstDelivery({
    specMarkdown: SPEC,
    diffText: 'uploaded photo and resized it to 200x200',
    changedFiles: ['src/profile.tsx'],
    commitMessage: 'feat: upload and resize',
  });
  assert.equal(v.ok, false);
  assert.equal(v.uncoveredItems.length, 1);
  assert.match(v.uncoveredItems[0].text, /Invalid file types/);
});

test('verifyBELAgainstDelivery returns ok=true for spec with no BEL items', () => {
  const v = verifyBELAgainstDelivery({
    specMarkdown: '# Plain doc\nno bullets',
    diffText: 'anything',
  });
  assert.equal(v.ok, true);
  assert.equal(v.totalItems, 0);
});

test('formatBELResult returns null when no items', () => {
  const r = { totalItems: 0 };
  assert.equal(formatBELResult(r), null);
});

test('formatBELResult renders OK message when all covered', () => {
  const v = verifyBELAgainstDelivery({
    specMarkdown: SPEC,
    diffText: 'uploaded photo resized 200x200 invalid toast error types profile automatically',
  });
  const s = formatBELResult(v, 'spec.md');
  assert.match(s, /BEL gate OK/);
  assert.match(s, /3 expectation/);
});

test('formatBELResult renders FAIL with missing keywords when uncovered', () => {
  const v = verifyBELAgainstDelivery({
    specMarkdown: SPEC,
    diffText: 'nothing relevant here',
  });
  const s = formatBELResult(v);
  assert.match(s, /BEL gate FAIL/);
  assert.match(s, /missing:/);
});
