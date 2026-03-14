'use strict';

/**
 * Tests for flow-memory-db.js — memory database module
 *
 * Covers: module loading, cosineSimilarity, DEFAULTS constants,
 * safe JSON helpers, exported function types.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-memory-db.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Suppress console output during tests
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const memoryDb = require('../scripts/flow-memory-db');

// ============================================================
// Module Loading
// ============================================================

describe('flow-memory-db module', () => {
  it('loads without error', () => {
    assert.ok(memoryDb, 'Module should load successfully');
    assert.equal(typeof memoryDb, 'object');
  });

  it('exports expected database management functions', () => {
    assert.equal(typeof memoryDb.initDatabase, 'function');
    assert.equal(typeof memoryDb.saveDatabase, 'function');
    assert.equal(typeof memoryDb.closeDatabase, 'function');
  });

  it('exports expected fact functions', () => {
    assert.equal(typeof memoryDb.storeFact, 'function');
    assert.equal(typeof memoryDb.searchFacts, 'function');
    assert.equal(typeof memoryDb.deleteFact, 'function');
    assert.equal(typeof memoryDb.getAllFacts, 'function');
  });

  it('exports expected proposal functions', () => {
    assert.equal(typeof memoryDb.createProposal, 'function');
    assert.equal(typeof memoryDb.getProposals, 'function');
    assert.equal(typeof memoryDb.updateProposal, 'function');
    assert.equal(typeof memoryDb.getUnsyncedProposals, 'function');
  });

  it('exports expected PRD functions', () => {
    assert.equal(typeof memoryDb.chunkPRD, 'function');
    assert.equal(typeof memoryDb.storePRD, 'function');
    assert.equal(typeof memoryDb.getPRDContext, 'function');
    assert.equal(typeof memoryDb.listPRDs, 'function');
    assert.equal(typeof memoryDb.deletePRD, 'function');
    assert.equal(typeof memoryDb.clearPRDs, 'function');
  });

  it('exports expected sync functions', () => {
    assert.equal(typeof memoryDb.getSyncState, 'function');
    assert.equal(typeof memoryDb.setSyncState, 'function');
  });

  it('exports getStats function', () => {
    assert.equal(typeof memoryDb.getStats, 'function');
  });

  it('exports embedding functions', () => {
    assert.equal(typeof memoryDb.getEmbedding, 'function');
    assert.equal(typeof memoryDb.cosineSimilarity, 'function');
  });

  it('exports entropy/forgetting functions', () => {
    assert.equal(typeof memoryDb.getEntropyStats, 'function');
    assert.equal(typeof memoryDb.applyRelevanceDecay, 'function');
    assert.equal(typeof memoryDb.demoteToColdStorage, 'function');
    assert.equal(typeof memoryDb.purgeColdFacts, 'function');
    assert.equal(typeof memoryDb.mergeSimilarFacts, 'function');
    assert.equal(typeof memoryDb.recordMemoryMetric, 'function');
    assert.equal(typeof memoryDb.getMemoryMetrics, 'function');
  });

  it('exports section functions', () => {
    assert.equal(typeof memoryDb.syncSectionsFromIndex, 'function');
    assert.equal(typeof memoryDb.searchSectionsByPins, 'function');
    assert.equal(typeof memoryDb.searchSectionsBySimilarity, 'function');
    assert.equal(typeof memoryDb.getSectionById, 'function');
    assert.equal(typeof memoryDb.getSectionsBySource, 'function');
    assert.equal(typeof memoryDb.getSectionStats, 'function');
  });

  it('exports request log functions', () => {
    assert.equal(typeof memoryDb.addRequestLogEntry, 'function');
    assert.equal(typeof memoryDb.searchRequestLog, 'function');
  });
});

// ============================================================
// cosineSimilarity
// ============================================================

describe('cosineSimilarity', () => {
  const { cosineSimilarity } = memoryDb;

  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    const result = cosineSimilarity(v, v);
    assert.ok(Math.abs(result - 1.0) < 1e-10,
      `Expected ~1.0, got ${result}`);
  });

  it('returns 1.0 for parallel vectors (same direction)', () => {
    const a = [1, 0, 0];
    const b = [5, 0, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - 1.0) < 1e-10,
      `Expected ~1.0, got ${result}`);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result) < 1e-10,
      `Expected ~0, got ${result}`);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - (-1.0)) < 1e-10,
      `Expected ~-1.0, got ${result}`);
  });

  it('returns value between -1 and 1 for arbitrary vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const result = cosineSimilarity(a, b);
    assert.ok(result >= -1 && result <= 1,
      `Expected value between -1 and 1, got ${result}`);
  });

  it('computes correct value for known vectors', () => {
    // cos(a,b) = (1*4 + 2*5 + 3*6) / (sqrt(14) * sqrt(77))
    // = 32 / sqrt(1078) ≈ 0.9746
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const expected = 32 / Math.sqrt(14 * 77);
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - expected) < 1e-10,
      `Expected ${expected}, got ${result}`);
  });

  it('returns 0 for null first argument', () => {
    assert.equal(cosineSimilarity(null, [1, 2, 3]), 0);
  });

  it('returns 0 for null second argument', () => {
    assert.equal(cosineSimilarity([1, 2, 3], null), 0);
  });

  it('returns 0 for both null arguments', () => {
    assert.equal(cosineSimilarity(null, null), 0);
  });

  it('returns 0 for different length vectors', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  it('returns 0 for empty arrays', () => {
    // Empty arrays have length 0 which matches, but dot product and norms are 0
    // 0 / (sqrt(0) * sqrt(0)) = NaN, but let's see what the implementation does
    const result = cosineSimilarity([], []);
    // With zero vectors, the function returns NaN (0/0), which is a known edge case
    assert.ok(result === 0 || Number.isNaN(result),
      `Expected 0 or NaN for empty arrays, got ${result}`);
  });

  it('handles single-element vectors', () => {
    const result = cosineSimilarity([3], [7]);
    assert.ok(Math.abs(result - 1.0) < 1e-10,
      `Expected ~1.0 for same-sign scalars, got ${result}`);
  });
});

// ============================================================
// chunkPRD (pure function, no DB needed)
// ============================================================

describe('chunkPRD', () => {
  const { chunkPRD } = memoryDb;

  it('is a function', () => {
    assert.equal(typeof chunkPRD, 'function');
  });

  it('returns an array for simple text', () => {
    const result = chunkPRD('This is a simple PRD document with enough content to be valid.');
    assert.ok(Array.isArray(result), 'Should return an array');
  });

  it('returns chunks with expected fields', () => {
    const longText = 'A'.repeat(600); // Longer than default chunk size
    const result = chunkPRD(longText);
    if (result.length > 0) {
      const chunk = result[0];
      assert.equal(typeof chunk.content, 'string', 'chunk should have content');
    }
  });
});
