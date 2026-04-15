'use strict';

/**
 * Tests for flow-constants.js — centralized magic numbers and config constants
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-constants.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  TIMEOUTS,
  LIMITS,
  THRESHOLDS,
  BACKOFF,
  KNOWN_CONFIG_KEYS,
} = require('../scripts/flow-constants');

// ============================================================
// TIMEOUTS
// ============================================================

describe('TIMEOUTS', () => {
  it('is an object', () => {
    assert.equal(typeof TIMEOUTS, 'object');
    assert.ok(TIMEOUTS !== null);
  });

  it('all values are positive numbers', () => {
    for (const [key, value] of Object.entries(TIMEOUTS)) {
      assert.equal(typeof value, 'number', `TIMEOUTS.${key} should be a number`);
      assert.ok(value > 0, `TIMEOUTS.${key} should be positive, got ${value}`);
    }
  });

  it('DEFAULT_COMMAND is 120000ms (2 minutes)', () => {
    assert.equal(TIMEOUTS.DEFAULT_COMMAND, 120000);
  });

  it('QUICK_COMMAND is less than DEFAULT_COMMAND', () => {
    assert.ok(TIMEOUTS.QUICK_COMMAND < TIMEOUTS.DEFAULT_COMMAND);
  });

  it('LONG_COMMAND is greater than DEFAULT_COMMAND', () => {
    assert.ok(TIMEOUTS.LONG_COMMAND > TIMEOUTS.DEFAULT_COMMAND);
  });

  it('has HTTP timeout constants', () => {
    assert.equal(typeof TIMEOUTS.HTTP_DEFAULT, 'number');
    assert.equal(typeof TIMEOUTS.HTTP_QUICK, 'number');
    assert.equal(typeof TIMEOUTS.HTTP_LONG, 'number');
    assert.ok(TIMEOUTS.HTTP_QUICK < TIMEOUTS.HTTP_DEFAULT);
    assert.ok(TIMEOUTS.HTTP_DEFAULT < TIMEOUTS.HTTP_LONG);
  });

  it('has lock-related constants', () => {
    assert.equal(typeof TIMEOUTS.LOCK_STALE, 'number');
    assert.equal(typeof TIMEOUTS.LOCK_RETRY_DELAY, 'number');
  });

  it('has cache TTL', () => {
    assert.equal(typeof TIMEOUTS.CACHE_TTL, 'number');
    assert.ok(TIMEOUTS.CACHE_TTL > 0);
  });
});

// ============================================================
// LIMITS
// ============================================================

describe('LIMITS', () => {
  it('is an object', () => {
    assert.equal(typeof LIMITS, 'object');
    assert.ok(LIMITS !== null);
  });

  it('all values are positive numbers', () => {
    for (const [key, value] of Object.entries(LIMITS)) {
      assert.equal(typeof value, 'number', `LIMITS.${key} should be a number`);
      assert.ok(value > 0, `LIMITS.${key} should be positive, got ${value}`);
    }
  });

  it('has retry limits', () => {
    assert.equal(typeof LIMITS.LOCK_MAX_RETRIES, 'number');
    assert.equal(typeof LIMITS.HTTP_MAX_RETRIES, 'number');
    assert.equal(typeof LIMITS.TASK_MAX_RETRIES, 'number');
  });

  it('has history limits', () => {
    assert.equal(typeof LIMITS.MAX_SESSION_HISTORY, 'number');
    assert.equal(typeof LIMITS.MAX_RECENT_FILES, 'number');
    assert.equal(typeof LIMITS.MAX_RECENT_DECISIONS, 'number');
  });

  it('MAX_REGEX_LENGTH prevents ReDoS', () => {
    assert.ok(LIMITS.MAX_REGEX_LENGTH <= 1000, 'MAX_REGEX_LENGTH should be bounded');
    assert.ok(LIMITS.MAX_REGEX_LENGTH > 0);
  });
});

// ============================================================
// THRESHOLDS
// ============================================================

describe('THRESHOLDS', () => {
  it('is an object', () => {
    assert.equal(typeof THRESHOLDS, 'object');
    assert.ok(THRESHOLDS !== null);
  });

  it('has success rate thresholds in descending order', () => {
    assert.ok(THRESHOLDS.SUCCESS_RATE_HIGH > THRESHOLDS.SUCCESS_RATE_MEDIUM);
    assert.ok(THRESHOLDS.SUCCESS_RATE_MEDIUM > THRESHOLDS.SUCCESS_RATE_LOW);
  });

  it('has confidence thresholds between 0 and 1', () => {
    assert.ok(THRESHOLDS.CONFIDENCE_HIGH > 0 && THRESHOLDS.CONFIDENCE_HIGH <= 1);
    assert.ok(THRESHOLDS.CONFIDENCE_MEDIUM > 0 && THRESHOLDS.CONFIDENCE_MEDIUM <= 1);
    assert.ok(THRESHOLDS.CONFIDENCE_LOW > 0 && THRESHOLDS.CONFIDENCE_LOW <= 1);
    assert.ok(THRESHOLDS.CONFIDENCE_HIGH > THRESHOLDS.CONFIDENCE_MEDIUM);
    assert.ok(THRESHOLDS.CONFIDENCE_MEDIUM > THRESHOLDS.CONFIDENCE_LOW);
  });

  it('has context management thresholds', () => {
    assert.ok(THRESHOLDS.CONTEXT_WARN_PERCENT < THRESHOLDS.CONTEXT_CRITICAL_PERCENT);
    assert.ok(THRESHOLDS.CONTEXT_WARN_PERCENT > 0);
    assert.ok(THRESHOLDS.CONTEXT_CRITICAL_PERCENT <= 100);
  });

  it('SMALL_FIX_FILES is a positive integer', () => {
    assert.equal(typeof THRESHOLDS.SMALL_FIX_FILES, 'number');
    assert.ok(Number.isInteger(THRESHOLDS.SMALL_FIX_FILES));
    assert.ok(THRESHOLDS.SMALL_FIX_FILES > 0);
  });
});

// ============================================================
// BACKOFF
// ============================================================

describe('BACKOFF', () => {
  it('is an object', () => {
    assert.equal(typeof BACKOFF, 'object');
    assert.ok(BACKOFF !== null);
  });

  it('has BASE_DELAY as positive number', () => {
    assert.equal(typeof BACKOFF.BASE_DELAY, 'number');
    assert.ok(BACKOFF.BASE_DELAY > 0);
  });

  it('MAX_DELAY is greater than BASE_DELAY', () => {
    assert.ok(BACKOFF.MAX_DELAY > BACKOFF.BASE_DELAY);
  });

  it('MULTIPLIER is greater than 1', () => {
    assert.ok(BACKOFF.MULTIPLIER > 1);
  });

  it('JITTER is between 0 and 1', () => {
    assert.ok(BACKOFF.JITTER >= 0 && BACKOFF.JITTER <= 1);
  });
});

// ============================================================
// KNOWN_CONFIG_KEYS
// ============================================================

describe('KNOWN_CONFIG_KEYS', () => {
  it('is an array', () => {
    assert.ok(Array.isArray(KNOWN_CONFIG_KEYS));
  });

  it('has a reasonable number of entries', () => {
    assert.ok(KNOWN_CONFIG_KEYS.length >= 20, `Expected at least 20 keys, got ${KNOWN_CONFIG_KEYS.length}`);
    assert.ok(KNOWN_CONFIG_KEYS.length < 500, `Expected fewer than 500 keys, got ${KNOWN_CONFIG_KEYS.length}`);
  });

  it('all entries are non-empty strings', () => {
    for (const key of KNOWN_CONFIG_KEYS) {
      assert.equal(typeof key, 'string', `Expected string, got ${typeof key}`);
      assert.ok(key.length > 0, 'Config key should not be empty');
    }
  });

  it('contains core config keys', () => {
    assert.ok(KNOWN_CONFIG_KEYS.includes('version'), 'should include version');
    assert.ok(KNOWN_CONFIG_KEYS.includes('projectName'), 'should include projectName');
    assert.ok(KNOWN_CONFIG_KEYS.includes('hooks'), 'should include hooks');
    assert.ok(KNOWN_CONFIG_KEYS.includes('qualityGates'), 'should include qualityGates');
  });

  it('has no duplicate entries', () => {
    const unique = new Set(KNOWN_CONFIG_KEYS);
    assert.equal(unique.size, KNOWN_CONFIG_KEYS.length, 'KNOWN_CONFIG_KEYS should have no duplicates');
  });
});

// Legacy flat-name aliases (DEFAULT_COMMAND_TIMEOUT_MS, etc.) were removed
// 2026-04-15 per audit finding arch-010. Their 8 tests here were removed with
// the exports — callers use TIMEOUTS.X / LIMITS.X directly.
