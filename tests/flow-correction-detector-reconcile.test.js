'use strict';

/**
 * Tests for reconcileExtraction + deterministicWhatWasWrong (wf-6c58953a).
 *
 * Pure functions — no LLM mock needed. These cover the post-fix design where
 * Layer 1 (keyword) + Layer 2 (Haiku) are reconciled instead of Layer 1
 * short-circuiting with null structured fields.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reconcileExtraction,
  deterministicWhatWasWrong
} = require('../scripts/flow-correction-detector');

// ============================================================
// deterministicWhatWasWrong
// ============================================================

test('deterministicWhatWasWrong — preserves short message verbatim', () => {
  const r = deterministicWhatWasWrong('please stop doing that');
  assert.equal(r, 'please stop doing that');
});

test('deterministicWhatWasWrong — truncates to 200 chars', () => {
  const long = 'x'.repeat(500);
  const r = deterministicWhatWasWrong(long);
  assert.equal(r.length, 200);
});

test('deterministicWhatWasWrong — null on empty/whitespace/non-string', () => {
  assert.equal(deterministicWhatWasWrong(''), null);
  assert.equal(deterministicWhatWasWrong('   '), null);
  assert.equal(deterministicWhatWasWrong(null), null);
  assert.equal(deterministicWhatWasWrong(undefined), null);
  assert.equal(deterministicWhatWasWrong(42), null);
});

test('deterministicWhatWasWrong — trims surrounding whitespace', () => {
  const r = deterministicWhatWasWrong('   hello world   ');
  assert.equal(r, 'hello world');
});

// ============================================================
// reconcileExtraction — both layers ran
// ============================================================

test('reconcileExtraction — Layer 1 + Layer 2 both succeed: uses Layer 2 strings', () => {
  const layer1 = { isCorrection: true, confidence: 71, correctionType: 'behavior', method: 'keyword', matchedPattern: 'stop doing' };
  const layer2 = { isCorrection: true, confidence: 92, correctionType: 'output', whatWasWrong: 'AI made wrong assumption', whatUserWants: 'AI to follow decisions.md' };
  const r = reconcileExtraction(layer1, layer2, 'please stop doing that');

  assert.equal(r.isCorrection, true);
  assert.equal(r.confidence, 71); // Layer 1 wins binary classification
  assert.equal(r.whatWasWrong, 'AI made wrong assumption'); // Layer 2 string
  assert.equal(r.whatUserWants, 'AI to follow decisions.md'); // Layer 2 string
  assert.equal(r.method, 'keyword+ai');
  assert.equal(r.matchedPattern, 'stop doing');
  assert.equal(r.enrichmentSource, 'haiku');
  assert.equal(r.llmDisagreed, false);
});

test('reconcileExtraction — Layer 1 hit + Layer 2 disagrees on isCorrection: trust Layer 1, mark llmDisagreed', () => {
  // The "Don't do it... I'm just asking a question" scenario from the bug report
  const layer1 = { isCorrection: true, confidence: 70, correctionType: 'behavior', method: 'keyword', matchedPattern: "don't do it" };
  const layer2 = { isCorrection: false, confidence: 30, correctionType: null, whatWasWrong: null, whatUserWants: null };
  const r = reconcileExtraction(layer1, layer2, "Don't do it. I'm just asking a question.");

  assert.equal(r.isCorrection, true); // Layer 1 wins
  assert.equal(r.llmDisagreed, true);  // Telemetry flag for analysis
  assert.equal(r.whatWasWrong, "Don't do it. I'm just asking a question."); // Deterministic fallback
  assert.equal(r.enrichmentSource, 'deterministic-fallback');
});

test('reconcileExtraction — Layer 2 returns null whatWasWrong: deterministic fallback used', () => {
  const layer1 = { isCorrection: true, confidence: 80, correctionType: 'behavior', method: 'keyword', matchedPattern: 'stop' };
  const layer2 = { isCorrection: true, confidence: 80, correctionType: 'behavior', whatWasWrong: null, whatUserWants: null };
  const r = reconcileExtraction(layer1, layer2, 'this is the user message');

  assert.equal(r.whatWasWrong, 'this is the user message');
  assert.equal(r.enrichmentSource, 'deterministic-fallback');
});

// ============================================================
// reconcileExtraction — Layer 1 only (Layer 2 unavailable)
// ============================================================

test('reconcileExtraction — Layer 1 only (no API key): deterministic fallback', () => {
  const layer1 = { isCorrection: true, confidence: 71, correctionType: 'behavior', method: 'keyword', matchedPattern: 'stop doing' };
  const r = reconcileExtraction(layer1, null, 'please stop doing that');

  assert.equal(r.isCorrection, true);
  assert.equal(r.whatWasWrong, 'please stop doing that');
  assert.equal(r.whatUserWants, null); // honest null — intent inference is LLM job
  assert.equal(r.enrichmentSource, 'deterministic-fallback');
  assert.equal(r.method, 'keyword');
});

// ============================================================
// reconcileExtraction — Layer 2 only (Layer 1 missed)
// ============================================================

test('reconcileExtraction — Layer 2 only path (Layer 1 missed)', () => {
  const layer2 = { isCorrection: true, confidence: 88, correctionType: 'understanding', whatWasWrong: 'misunderstood query', whatUserWants: 'clarification' };
  const r = reconcileExtraction(null, layer2, 'I think you misunderstood');

  assert.equal(r.isCorrection, true);
  assert.equal(r.confidence, 88);
  assert.equal(r.whatWasWrong, 'misunderstood query');
  assert.equal(r.method, 'ai');
  assert.equal(r.enrichmentSource, 'haiku');
});

test('reconcileExtraction — both layers say not-correction: returns null', () => {
  const layer2 = { isCorrection: false, confidence: 10, correctionType: null, whatWasWrong: null, whatUserWants: null };
  const r = reconcileExtraction(null, layer2, 'how are you?');
  assert.equal(r, null);
});

test('reconcileExtraction — both null: returns null', () => {
  const r = reconcileExtraction(null, null, 'whatever');
  assert.equal(r, null);
});

// ============================================================
// THE original bug scenario (regression test)
// ============================================================

test('reconcileExtraction — REGRESSION: bug scenario from 2026-03-06 hub-mock record', () => {
  // The actual broken record's userMessage
  const userMessage = "Don't do it. Don't ever assume that you know what I want to do. In Wogi Flow we have decisions, patterns, we have a learning path. I just want to understand why it was not triggered.";

  // Layer 1 hits on "Don't do it" keyword
  const layer1 = { isCorrection: true, confidence: 65, correctionType: 'behavior', method: 'keyword', matchedPattern: "don't" };

  // Layer 2 fails (or returns null) — simulating the failure mode
  const r = reconcileExtraction(layer1, null, userMessage);

  // Pre-fix (broken) record had whatWasWrong: null. Post-fix: populated.
  assert.notEqual(r.whatWasWrong, null);
  assert.equal(r.whatWasWrong.length > 0, true);
  assert.equal(r.whatWasWrong, userMessage.slice(0, 200));
  assert.equal(r.isCorrection, true);
  assert.equal(r.enrichmentSource, 'deterministic-fallback');
});
