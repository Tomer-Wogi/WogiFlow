#!/usr/bin/env node

/**
 * Tests for Skeptical Evaluator.
 * Story: wf-15175dbc (B5)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildSkepticalPrompt, parseSkepticalOutput } = require('../scripts/flow-skeptical-evaluator');

const SPEC = `# Story\n\n## Acceptance Criteria\n- User can upload a profile photo\n- Photo is resized to 200x200\n`;

test('buildSkepticalPrompt requires opts', () => {
  assert.throws(() => buildSkepticalPrompt(), /opts required/);
});

test('buildSkepticalPrompt requires specMarkdown', () => {
  assert.throws(() => buildSkepticalPrompt({}), /specMarkdown required/);
});

test('buildSkepticalPrompt returns system+user prompts with pre-checks', () => {
  const built = buildSkepticalPrompt({
    specMarkdown: SPEC,
    diffText: '+photo upload resized',
    changedFiles: ['src/profile.tsx'],
    taskId: 'wf-test0002',
  });
  assert.ok(built.systemPrompt.length > 100);
  assert.ok(built.userPrompt.length > 50);
  assert.ok(built.preChecks.bel);
  assert.ok(built.preChecks.bundle);
  assert.equal(built.metadata.taskId, 'wf-test0002');
});

test('buildSkepticalPrompt system prompt contains the three enumeration passes', () => {
  const built = buildSkepticalPrompt({ specMarkdown: SPEC });
  assert.match(built.systemPrompt, /UI-field enumeration/);
  assert.match(built.systemPrompt, /API-parameter enumeration/);
  assert.match(built.systemPrompt, /State-key enumeration/);
});

test('buildSkepticalPrompt requires evidence + confidence on every claim', () => {
  const built = buildSkepticalPrompt({ specMarkdown: SPEC });
  assert.match(built.systemPrompt, /evidenceTier/);
  assert.match(built.systemPrompt, /confidencePct/);
  assert.match(built.systemPrompt, /95.*85.*75/);
});

test('parseSkepticalOutput returns FAIL for empty response', () => {
  const r = parseSkepticalOutput('');
  assert.equal(r.ok, false);
  assert.equal(r.overallVerdict, 'FAIL');
});

test('parseSkepticalOutput returns FAIL for non-JSON', () => {
  const r = parseSkepticalOutput('just some text');
  assert.equal(r.ok, false);
});

test('parseSkepticalOutput accepts well-formed PASS', () => {
  const r = parseSkepticalOutput(JSON.stringify({
    taskId: 'x',
    overallVerdict: 'PASS',
    uiFieldPass: { ran: true, findings: [] },
    apiParameterPass: { ran: false },
    stateKeyPass: { ran: false },
    blockers: [],
    unverifiedClaims: [],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.overallVerdict, 'PASS');
});

test('parseSkepticalOutput extracts JSON from wrapped prose', () => {
  const wrapped = 'Here is my verdict:\n\n{ "overallVerdict": "FAIL", "blockers": ["missing field X"] }\n\nThanks';
  const r = parseSkepticalOutput(wrapped);
  assert.equal(r.overallVerdict, 'FAIL');
  assert.equal(r.blockers.length, 1);
});

test('parseSkepticalOutput defaults unverifiedClaims to empty array', () => {
  const r = parseSkepticalOutput('{"overallVerdict": "PASS"}');
  assert.deepEqual(r.unverifiedClaims, []);
});
