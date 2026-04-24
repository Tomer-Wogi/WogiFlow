#!/usr/bin/env node

/**
 * Tests for confidence-tier rubric (95/85/75).
 * Story: wf-f14dcfeb (A4)
 * Rubric: .workflow/rubrics/confidence-tiers.md
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeConfidenceTier,
  validateConfidencePct,
  CONFIDENCE_TIERS,
} = require('../scripts/flow-completion-truth-gate');

test('CONFIDENCE_TIERS exports exactly three tiers (95/85/75)', () => {
  assert.deepEqual(CONFIDENCE_TIERS, { HIGH: 95, MEDIUM: 85, LOW: 75 });
});

test('tier 4 (AUTOMATED) → 95 high confidence', () => {
  const r = computeConfidenceTier({ evidenceTier: 4 });
  assert.equal(r.confidencePct, 95);
  assert.equal(r.flagUnverified, false);
  assert.equal(r.severityCap, null);
});

test('tier 3 (INTERACTIVE) → 95 high confidence', () => {
  const r = computeConfidenceTier({ evidenceTier: 3 });
  assert.equal(r.confidencePct, 95);
});

test('tier 2 with 1 observation → 85 medium', () => {
  const r = computeConfidenceTier({ evidenceTier: 2, observationCount: 1 });
  assert.equal(r.confidencePct, 85);
  assert.equal(r.severityCap, 'HIGH');
});

test('tier 2 with 2+ observations upgrades to 95', () => {
  const r = computeConfidenceTier({ evidenceTier: 2, observationCount: 2 });
  assert.equal(r.confidencePct, 95);
});

test('tier 1 with 10+ hits across 3+ files → 95', () => {
  const r = computeConfidenceTier({ evidenceTier: 1, hitCount: 12, fileCount: 4 });
  assert.equal(r.confidencePct, 95);
});

test('tier 1 with 5-9 hits → 85', () => {
  const r = computeConfidenceTier({ evidenceTier: 1, hitCount: 7 });
  assert.equal(r.confidencePct, 85);
});

test('tier 1 with 3+ hits across 2+ files → 85', () => {
  const r = computeConfidenceTier({ evidenceTier: 1, hitCount: 4, fileCount: 2 });
  assert.equal(r.confidencePct, 85);
});

test('tier 1 with 1-4 isolated hits → 75 unverified', () => {
  const r = computeConfidenceTier({ evidenceTier: 1, hitCount: 1 });
  assert.equal(r.confidencePct, 75);
  assert.equal(r.flagUnverified, true);
  assert.equal(r.severityCap, 'LOW');
});

test('tier 0 (STATIC) → 75 unverified', () => {
  const r = computeConfidenceTier({ evidenceTier: 0 });
  assert.equal(r.confidencePct, 75);
  assert.equal(r.flagUnverified, true);
});

test('no evidence (tier -1) → 75 unverified', () => {
  const r = computeConfidenceTier({ evidenceTier: -1 });
  assert.equal(r.confidencePct, 75);
  assert.equal(r.flagUnverified, true);
});

test('missing evidenceNote forces 75', () => {
  const r = computeConfidenceTier({ evidenceTier: 0, hasEvidenceNote: false });
  assert.equal(r.confidencePct, 75);
});

test('validateConfidencePct accepts 95/85/75 only', () => {
  assert.equal(validateConfidencePct({ confidencePct: 95 }).ok, true);
  assert.equal(validateConfidencePct({ confidencePct: 85 }).ok, true);
  assert.equal(validateConfidencePct({ confidencePct: 75, flagUnverified: true }).ok, true);
  assert.equal(validateConfidencePct({ confidencePct: 80 }).ok, false);
  assert.equal(validateConfidencePct({ confidencePct: 100 }).ok, false);
  assert.equal(validateConfidencePct({}).ok, false);
});

test('validateConfidencePct rejects 75 without flagUnverified', () => {
  const r = validateConfidencePct({ confidencePct: 75, flagUnverified: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /flagUnverified=true/);
});
