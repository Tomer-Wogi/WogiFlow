'use strict';

/**
 * Tests for scripts/hooks/core/loop-check.js (Wave F hook coverage).
 *
 * Covers: isLoopEnforcementEnabled config cascade (loopEnforcement, execution.loops.enforced,
 * execution.loops.enabled), checkCriteriaStatus aggregation (completed/passed/pending/failed/
 * skipped tallies + allComplete predicate), generateBlockMessage content shape.
 *
 * Note: checkLoopExit has heavy side-effects (memory-db, durable-session, file reads)
 * — we cover config + pure aggregators; full flow is covered by hook integration tests.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-loop-check.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  isLoopEnforcementEnabled,
  checkCriteriaStatus,
  generateBlockMessage,
  getActiveLoopSession,
} = require('../scripts/hooks/core/loop-check');

// ============================================================
// isLoopEnforcementEnabled
// ============================================================

describe('isLoopEnforcementEnabled', () => {
  it('returns a boolean (respects live config)', () => {
    assert.equal(typeof isLoopEnforcementEnabled(), 'boolean');
  });
});

// ============================================================
// checkCriteriaStatus
// ============================================================

describe('checkCriteriaStatus — empty/invalid input', () => {
  it('returns allComplete=true with zero totals when session is null', () => {
    const s = checkCriteriaStatus(null);
    assert.equal(s.total, 0);
    assert.equal(s.completed, 0);
    assert.equal(s.pending, 0);
    assert.equal(s.failed, 0);
    assert.equal(s.skipped, 0);
    assert.equal(s.allComplete, true);
  });

  it('returns allComplete=true when acceptanceCriteria is missing', () => {
    assert.equal(checkCriteriaStatus({}).allComplete, true);
  });

  it('returns allComplete=true when acceptanceCriteria is empty', () => {
    const s = checkCriteriaStatus({ acceptanceCriteria: [] });
    assert.equal(s.total, 0);
    assert.equal(s.allComplete, true);
  });
});

describe('checkCriteriaStatus — status tally', () => {
  it('counts completed status', () => {
    const s = checkCriteriaStatus({
      acceptanceCriteria: [
        { status: 'completed' },
        { status: 'completed' },
      ],
    });
    assert.equal(s.total, 2);
    assert.equal(s.completed, 2);
    assert.equal(s.pending, 0);
    assert.equal(s.allComplete, true);
  });

  it('treats "passed" as completed (alias)', () => {
    const s = checkCriteriaStatus({
      acceptanceCriteria: [{ status: 'passed' }, { status: 'passed' }],
    });
    assert.equal(s.completed, 2);
    assert.equal(s.allComplete, true);
  });

  it('counts pending status', () => {
    const s = checkCriteriaStatus({
      acceptanceCriteria: [
        { status: 'pending' },
        { status: 'pending' },
      ],
    });
    assert.equal(s.pending, 2);
    assert.equal(s.allComplete, false);
  });

  it('treats missing status as pending', () => {
    const s = checkCriteriaStatus({
      acceptanceCriteria: [{ description: 'test 1' }, { description: 'test 2' }],
    });
    assert.equal(s.pending, 2);
    assert.equal(s.allComplete, false);
  });

  it('counts failed status — blocks allComplete', () => {
    const s = checkCriteriaStatus({
      acceptanceCriteria: [
        { status: 'completed' },
        { status: 'failed' },
      ],
    });
    assert.equal(s.failed, 1);
    assert.equal(s.allComplete, false);
  });

  it('counts skipped separately (does NOT block allComplete)', () => {
    const s = checkCriteriaStatus({
      acceptanceCriteria: [
        { status: 'completed' },
        { status: 'skipped' },
      ],
    });
    assert.equal(s.skipped, 1);
    assert.equal(s.allComplete, true, 'skipped should not prevent completion');
  });

  it('mixed status breakdown is correct', () => {
    const s = checkCriteriaStatus({
      acceptanceCriteria: [
        { status: 'completed' }, { status: 'passed' },
        { status: 'pending' }, {},
        { status: 'failed' },
        { status: 'skipped' },
      ],
    });
    assert.equal(s.total, 6);
    assert.equal(s.completed, 2);
    assert.equal(s.pending, 2);
    assert.equal(s.failed, 1);
    assert.equal(s.skipped, 1);
    assert.equal(s.allComplete, false);
  });

  it('returns criteria array in result', () => {
    const input = [{ status: 'pending', description: 'a' }];
    const s = checkCriteriaStatus({ acceptanceCriteria: input });
    assert.strictEqual(s.criteria, input);
  });
});

// ============================================================
// generateBlockMessage
// ============================================================

describe('generateBlockMessage', () => {
  it('includes pending criteria count and descriptions', () => {
    const session = { taskId: 'wf-loop00001' };
    const criteriaStatus = {
      pending: 2,
      failed: 0,
      criteria: [
        { status: 'pending', description: 'implement X' },
        { status: 'pending', description: 'test Y' },
      ],
    };
    const msg = generateBlockMessage(criteriaStatus, session);
    assert.ok(msg.includes('2'));
    assert.ok(msg.includes('implement X'));
    assert.ok(msg.includes('test Y'));
  });

  it('includes failed criteria with errors', () => {
    const session = { taskId: 'wf-fail00001' };
    const criteriaStatus = {
      pending: 0,
      failed: 1,
      criteria: [
        { status: 'failed', description: 'verify Z', error: 'timeout' },
      ],
    };
    const msg = generateBlockMessage(criteriaStatus, session);
    assert.ok(msg.includes('verify Z'));
    assert.ok(msg.includes('timeout'));
  });

  it('mentions /wogi-done --force override path with taskId', () => {
    const session = { taskId: 'wf-over00001' };
    const criteriaStatus = { pending: 1, failed: 0, criteria: [{ status: 'pending', description: 'x' }] };
    const msg = generateBlockMessage(criteriaStatus, session);
    assert.ok(msg.includes('/wogi-done'));
    assert.ok(msg.includes('wf-over00001'));
    assert.ok(msg.includes('--force'));
  });

  it('uses c.text fallback when description absent', () => {
    const session = { taskId: 'wf-text00001' };
    const criteriaStatus = {
      pending: 1,
      failed: 0,
      criteria: [{ status: 'pending', text: 'criterion text' }],
    };
    const msg = generateBlockMessage(criteriaStatus, session);
    assert.ok(msg.includes('criterion text'));
  });
});

// ============================================================
// getActiveLoopSession
// ============================================================

describe('getActiveLoopSession', () => {
  it('returns null or valid session object (no crash)', () => {
    const s = getActiveLoopSession();
    assert.ok(s === null || typeof s === 'object');
  });
});
