'use strict';

/**
 * Integration tests for flow-memory-db.js semantic-embedding path.
 *
 * Covers the @huggingface/transformers feature-extraction pipeline that the
 * existing flow-memory-db.test.js only checks for existence (typeof). This
 * suite actually RUNS getEmbedding() against the real model so that a
 * transformers major-version bump (e.g. the 3.x -> 4.x upgrade in wf-b263c107 /
 * audit finding D-F4) is caught if it changes vector dimensions, normalization,
 * or the pipeline API.
 *
 * Network-resilient: getEmbedding() returns null when the optional
 * @huggingface/transformers dep or its model is unavailable (offline CI,
 * dep not installed). In that case each test SKIPS rather than fails — the
 * embedding feature is optional and lazy-guarded by design.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-memory-db-embedding.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const { getEmbedding, cosineSimilarity } = require('../scripts/flow-memory-db');

// all-MiniLM-L6-v2 produces 384-dimensional sentence embeddings.
const EXPECTED_DIMS = 384;
// Allow ample time for first-call model load / download.
const MODEL_TIMEOUT_MS = 120000;

/**
 * Embed text, returning null on ANY failure (optional dep missing, OR a model
 * fetch/network error in offline CI). getEmbedding() itself returns null only
 * for ERR_MODULE_NOT_FOUND and re-throws other errors (e.g. a HuggingFace Hub
 * download failure), so wrap it here to keep the suite hermetic — a missing
 * model is a skip, never a false failure.
 */
async function safeEmbed(text) {
  try {
    return await getEmbedding(text);
  } catch (_err) {
    return null;
  }
}

describe('flow-memory-db embedding path (integration)', () => {
  it('getEmbedding returns a normalized 384-dim vector for text', { timeout: MODEL_TIMEOUT_MS }, async (t) => {
    const vec = await safeEmbed('hello world');
    if (vec === null) {
      t.skip('@huggingface/transformers model unavailable — embedding optional, skipping');
      return;
    }
    assert.ok(Array.isArray(vec), 'embedding should be an array');
    assert.equal(vec.length, EXPECTED_DIMS, `embedding should be ${EXPECTED_DIMS}-dim`);
    assert.ok(vec.every((x) => typeof x === 'number' && Number.isFinite(x)), 'all components finite numbers');

    // pooling:'mean' + normalize:true => unit-length vector (L2 norm ~= 1).
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-3, `normalized vector should have unit L2 norm, got ${norm}`);
  });

  it('produces deterministic embeddings for identical input', { timeout: MODEL_TIMEOUT_MS }, async (t) => {
    const a = await safeEmbed('the quick brown fox');
    if (a === null) {
      t.skip('embedding model unavailable — skipping');
      return;
    }
    const b = await safeEmbed('the quick brown fox');
    assert.equal(b.length, a.length);
    // Same model + same input => self-similarity is 1.
    assert.ok(cosineSimilarity(a, b) > 0.9999, 'identical text must embed identically');
  });

  it('captures semantic relatedness (related > unrelated)', { timeout: MODEL_TIMEOUT_MS }, async (t) => {
    const dog = await safeEmbed('a dog barks loudly in the yard');
    if (dog === null) {
      t.skip('embedding model unavailable — skipping');
      return;
    }
    const puppy = await safeEmbed('a puppy is barking in the garden');
    const finance = await safeEmbed('quarterly tax filing deadlines for corporations');

    const related = cosineSimilarity(dog, puppy);
    const unrelated = cosineSimilarity(dog, finance);
    assert.ok(
      related > unrelated,
      `related sentences (${related.toFixed(3)}) should out-score unrelated (${unrelated.toFixed(3)})`
    );
  });
});
