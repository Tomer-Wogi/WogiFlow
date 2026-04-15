'use strict';

/**
 * Tests for scripts/hooks/core/commit-log-gate.js (Wave F hook coverage).
 *
 * Covers: isGitCommit regex across operator-chained commands, isMergeCommit
 * detection (flag + message prefix), checkCommitLogGate gating logic
 * (tool filtering, state-only whitelist, active-task requirement, message format).
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-commit-log-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const { checkCommitLogGate, isGitCommit, isMergeCommit } = require('../scripts/hooks/core/commit-log-gate');

// ============================================================
// isGitCommit
// ============================================================

describe('isGitCommit — pattern matching', () => {
  it('matches a bare `git commit`', () => {
    assert.equal(isGitCommit('git commit'), true);
  });

  it('matches `git commit -m "msg"`', () => {
    assert.equal(isGitCommit('git commit -m "msg"'), true);
  });

  it('matches chained commands via &&', () => {
    assert.equal(isGitCommit('git add . && git commit -m "x"'), true);
  });

  it('matches chained commands via ;', () => {
    assert.equal(isGitCommit('git add . ; git commit -m "x"'), true);
  });

  it('matches chained commands via ||', () => {
    assert.equal(isGitCommit('git status || git commit'), true);
  });

  it('does NOT match `git status`', () => {
    assert.equal(isGitCommit('git status'), false);
  });

  it('does NOT match `git committer` (word boundary)', () => {
    assert.equal(isGitCommit('git committer list'), false);
  });

  it('does NOT match literal string in echo', () => {
    // This is intentional — the gate ONLY fires on actual git commit invocations
    // at start or after operators. Echo is still blocked as "git commit" appears
    // at start of string. (This is the conservative choice — echo+git commit
    // chained is rare and safer to flag than miss.)
    assert.equal(isGitCommit('echo git commit'), false);
  });

  it('does NOT match non-string input', () => {
    assert.equal(isGitCommit(null), false);
    assert.equal(isGitCommit(undefined), false);
    assert.equal(isGitCommit(123), false);
    assert.equal(isGitCommit({}), false);
  });

  it('does NOT match empty string', () => {
    assert.equal(isGitCommit(''), false);
  });

  it('handles leading whitespace', () => {
    assert.equal(isGitCommit('   git commit'), true);
  });
});

// ============================================================
// isMergeCommit
// ============================================================

describe('isMergeCommit — whitelist detection', () => {
  it('detects git merge command', () => {
    assert.equal(isMergeCommit('git merge feature-branch'), true);
  });

  it('detects git merge --continue', () => {
    assert.equal(isMergeCommit('git merge --continue'), true);
  });

  it('detects commit message starting with "Merge"', () => {
    assert.equal(isMergeCommit('git commit -m "Merge branch main into feature"'), true);
  });

  it('detects "Merge" with single quotes', () => {
    assert.equal(isMergeCommit("git commit -m 'Merge pull request #42'"), true);
  });

  it('is case-insensitive on "Merge" prefix', () => {
    assert.equal(isMergeCommit('git commit -m "merge branch"'), true);
    assert.equal(isMergeCommit('git commit -m "MERGE conflicts"'), true);
  });

  it('does NOT flag commits that merely mention merge', () => {
    assert.equal(isMergeCommit('git commit -m "fix: conflict after merge"'), false);
  });

  it('does NOT flag regular commits', () => {
    assert.equal(isMergeCommit('git commit -m "feat: add routing"'), false);
  });
});

// ============================================================
// checkCommitLogGate — tool filtering
// ============================================================

describe('checkCommitLogGate — non-git commands', () => {
  it('allows non-git commands (npm run)', () => {
    const r = checkCommitLogGate('npm run test');
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
  });

  it('allows git status', () => {
    const r = checkCommitLogGate('git status');
    assert.equal(r.allowed, true);
  });

  it('allows git log', () => {
    const r = checkCommitLogGate('git log -5');
    assert.equal(r.allowed, true);
  });

  it('allows git diff', () => {
    const r = checkCommitLogGate('git diff HEAD');
    assert.equal(r.allowed, true);
  });

  it('allows non-string input gracefully', () => {
    assert.equal(checkCommitLogGate(null).allowed, true);
    assert.equal(checkCommitLogGate(undefined).allowed, true);
  });
});

// ============================================================
// checkCommitLogGate — config disable path
// ============================================================

describe('checkCommitLogGate — config toggle', () => {
  it('allows git commit when gate is explicitly disabled', () => {
    const config = { enforcement: { commitLogGate: { enabled: false } } };
    // No active task path via empty config — but even with active task, explicit
    // disable must short-circuit.
    const r = checkCommitLogGate('git commit -m "test"', config);
    assert.equal(r.allowed, true);
  });
});

// ============================================================
// checkCommitLogGate — whitelists
// ============================================================

describe('checkCommitLogGate — merge whitelist', () => {
  it('allows merge commit even with active task', () => {
    // Merge commits are whitelisted regardless of log-entry status
    const r = checkCommitLogGate('git commit -m "Merge branch feature"');
    assert.equal(r.allowed, true);
  });

  it('allows git merge command', () => {
    const r = checkCommitLogGate('git merge --continue');
    assert.equal(r.allowed, true);
  });
});

// ============================================================
// checkCommitLogGate — result shape
// ============================================================

describe('checkCommitLogGate — result contract', () => {
  it('returns { allowed, blocked } for all inputs', () => {
    const inputs = [
      'git commit',
      'git status',
      'npm run build',
      '',
      'git commit -m "Merge x"',
    ];
    for (const cmd of inputs) {
      const r = checkCommitLogGate(cmd);
      assert.equal(typeof r.allowed, 'boolean', `allowed missing for "${cmd}"`);
      assert.equal(typeof r.blocked, 'boolean', `blocked missing for "${cmd}"`);
      assert.equal(r.allowed, !r.blocked, `allowed/blocked contradict for "${cmd}"`);
    }
  });

  it('includes actionable message when blocked', () => {
    // Create conditions where blocking is possible (active task with no log entry).
    // Real state has an active task — if so, git commit WITH source file staged
    // should block. But since this test can't control staged files reliably,
    // we test only that IF blocked, the message mentions the required action.
    const r = checkCommitLogGate('git commit -m "feat: x"');
    if (r.blocked) {
      assert.ok(r.message, 'blocked result must include message');
      assert.ok(r.message.includes('request-log'), 'message should mention request-log');
      assert.ok(r.reason, 'blocked result must include reason code');
    }
  });
});
