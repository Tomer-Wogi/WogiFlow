'use strict';

/**
 * Tests for suspension logic in scripts/flow-durable-session.js.
 *
 * Covers: checkResumeCondition dispatch (time/poll/manual/file + unknown
 * types), time condition (past/future resumeAfter), manual condition
 * (approvedAt+approvedBy vs awaiting), file condition (no watchPath /
 * path-traversal rejection / file-not-found / file-exists). Pure-function
 * tests — no session state mutation.
 *
 * Run: NODE_ENV=test node --test tests/flow-durable-session-suspension.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  checkResumeCondition,
  isSuspended,
  getSuspensionStatus,
  RESUME_CONDITION,
} = require('../scripts/flow-durable-session');

// ============================================================
// checkResumeCondition — dispatch
// ============================================================

describe('checkResumeCondition — dispatch', () => {
  it('returns canResume=true for null suspension', () => {
    const r = checkResumeCondition(null);
    assert.equal(r.canResume, true);
    assert.equal(r.reason, 'no-condition');
  });

  it('returns canResume=true for undefined suspension', () => {
    const r = checkResumeCondition(undefined);
    assert.equal(r.canResume, true);
  });

  it('returns canResume=true when no resumeCondition defined', () => {
    const r = checkResumeCondition({ type: 'manual' });
    assert.equal(r.canResume, true);
    assert.equal(r.reason, 'no-condition');
  });

  it('returns canResume=false for unknown condition type', () => {
    const r = checkResumeCondition({ resumeCondition: { type: 'unknown_type' } });
    assert.equal(r.canResume, false);
    assert.ok(r.reason.toLowerCase().includes('unknown'));
  });
});

// ============================================================
// Time condition
// ============================================================

describe('checkResumeCondition — time', () => {
  it('resumes when resumeAfter is in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.TIME, time: { resumeAfter: past } },
    });
    assert.equal(r.canResume, true);
    assert.equal(r.reason, 'time-elapsed');
  });

  it('does NOT resume when resumeAfter is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.TIME, time: { resumeAfter: future } },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.reason, 'waiting-for-time');
    assert.ok(Number.isFinite(r.remainingSeconds));
    assert.ok(r.remainingSeconds > 0);
  });

  it('resumes when no resumeAfter set (no-time-set)', () => {
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.TIME, time: {} },
    });
    assert.equal(r.canResume, true);
  });

  it('handles missing time config entirely', () => {
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.TIME },
    });
    assert.equal(r.canResume, true);
  });
});

// ============================================================
// Manual condition
// ============================================================

describe('checkResumeCondition — manual', () => {
  it('resumes when approvedAt + approvedBy present', () => {
    const r = checkResumeCondition({
      resumeCondition: {
        type: RESUME_CONDITION.MANUAL,
        manual: { approvedAt: new Date().toISOString(), approvedBy: 'tomer' },
      },
    });
    assert.equal(r.canResume, true);
    assert.equal(r.reason, 'manually-approved');
  });

  it('does NOT resume when approvedBy missing', () => {
    const r = checkResumeCondition({
      resumeCondition: {
        type: RESUME_CONDITION.MANUAL,
        manual: { approvedAt: new Date().toISOString() },
      },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.reason, 'awaiting-approval');
  });

  it('does NOT resume when approvedAt missing', () => {
    const r = checkResumeCondition({
      resumeCondition: {
        type: RESUME_CONDITION.MANUAL,
        manual: { approvedBy: 'tomer' },
      },
    });
    assert.equal(r.canResume, false);
  });

  it('includes prompt in the awaiting response when provided', () => {
    const r = checkResumeCondition({
      resumeCondition: {
        type: RESUME_CONDITION.MANUAL,
        manual: { prompt: 'Ready to deploy?' },
      },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.prompt, 'Ready to deploy?');
  });

  it('handles missing manual config', () => {
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.MANUAL },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.reason, 'no-manual-config');
  });
});

// ============================================================
// File condition
// ============================================================

describe('checkResumeCondition — file', () => {
  it('rejects when no watchPath', () => {
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.FILE, file: {} },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.reason, 'no-file-path');
  });

  it('rejects absolute path outside project (path-traversal prevention)', () => {
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.FILE, file: { watchPath: '/etc/passwd' } },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.reason, 'path-traversal-blocked');
  });

  it('returns file-not-found for non-existent path within project', () => {
    const r = checkResumeCondition({
      resumeCondition: {
        type: RESUME_CONDITION.FILE,
        file: { watchPath: 'nonexistent-file-xyz.txt' },
      },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.reason, 'file-not-found');
  });

  it('returns canResume=true when file exists (and no expected content)', () => {
    // README.md exists in project root
    const r = checkResumeCondition({
      resumeCondition: {
        type: RESUME_CONDITION.FILE,
        file: { watchPath: 'README.md' },
      },
    });
    assert.equal(r.canResume, true);
    assert.equal(r.reason, 'file-exists');
  });
});

// ============================================================
// Poll condition (security validation)
// ============================================================

describe('checkResumeCondition — poll (security)', () => {
  it('rejects when no command', () => {
    const r = checkResumeCondition({
      resumeCondition: { type: RESUME_CONDITION.POLL, poll: {} },
    });
    assert.equal(r.canResume, false);
    assert.equal(r.reason, 'no-poll-command');
  });

  it('rejects dangerous commands (injection)', () => {
    const r = checkResumeCondition({
      resumeCondition: {
        type: RESUME_CONDITION.POLL,
        poll: { command: 'rm -rf /', expectedValue: 'x' },
      },
    });
    // Validation should block this
    assert.equal(r.canResume, false);
    assert.ok(r.reason.includes('poll-command'));
  });
});

// ============================================================
// isSuspended / getSuspensionStatus — live session
// ============================================================

describe('isSuspended / getSuspensionStatus', () => {
  it('isSuspended returns a boolean', () => {
    assert.equal(typeof isSuspended(), 'boolean');
  });

  it('getSuspensionStatus returns null or valid object', () => {
    const r = getSuspensionStatus();
    assert.ok(r === null || typeof r === 'object');
    if (r !== null) {
      assert.ok('canResume' in r);
      assert.ok('type' in r);
    }
  });
});

// ============================================================
// RESUME_CONDITION constants
// ============================================================

describe('RESUME_CONDITION constants', () => {
  it('exports all condition types', () => {
    assert.ok(RESUME_CONDITION.TIME);
    assert.ok(RESUME_CONDITION.POLL);
    assert.ok(RESUME_CONDITION.MANUAL);
    assert.ok(RESUME_CONDITION.FILE);
  });

  it('each type is a distinct string', () => {
    const values = [
      RESUME_CONDITION.TIME,
      RESUME_CONDITION.POLL,
      RESUME_CONDITION.MANUAL,
      RESUME_CONDITION.FILE,
    ];
    const unique = new Set(values);
    assert.equal(unique.size, 4);
    for (const v of values) {
      assert.equal(typeof v, 'string');
    }
  });
});
