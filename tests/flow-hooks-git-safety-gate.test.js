'use strict';

/**
 * Tests for scripts/hooks/core/git-safety-gate.js (Wave F hook coverage).
 *
 * Covers: isGitSafetyEnabled config default, getGitSafetyConfig defaults,
 * parseGitCommand (reset parsing with flags, checkout ., restore ., clean -f,
 * negative cases), SAFE_GIT_REF injection prevention via getCommitDistance,
 * checkGitSafety disabled path + clean block + discard-all stash behavior.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-git-safety-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  isGitSafetyEnabled,
  getGitSafetyConfig,
  checkGitSafety,
  parseGitCommand,
  getCommitDistance,
  getCommitAgeHours,
  getAffectedFileCount,
  autoStash,
} = require('../scripts/hooks/core/git-safety-gate');

// ============================================================
// isGitSafetyEnabled
// ============================================================

describe('isGitSafetyEnabled', () => {
  it('returns true by default (empty config)', () => {
    assert.equal(isGitSafetyEnabled({}), true);
  });

  it('returns true when gitSafety is undefined', () => {
    assert.equal(isGitSafetyEnabled({ enforcement: {} }), true);
  });

  it('returns false ONLY when explicitly disabled', () => {
    assert.equal(isGitSafetyEnabled({ enforcement: { gitSafety: { enabled: false } } }), false);
  });

  it('returns true when explicitly enabled', () => {
    assert.equal(isGitSafetyEnabled({ enforcement: { gitSafety: { enabled: true } } }), true);
  });
});

// ============================================================
// getGitSafetyConfig defaults
// ============================================================

describe('getGitSafetyConfig — defaults', () => {
  it('returns sane defaults', () => {
    const cfg = getGitSafetyConfig({});
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.maxBackwardCommits, 3);
    assert.equal(cfg.ageThresholdHours, 24);
    assert.equal(cfg.autoBackup, true);
    assert.equal(cfg.maxBackupBranches, 3);
  });

  it('honors overrides', () => {
    const cfg = getGitSafetyConfig({
      enforcement: {
        gitSafety: {
          maxBackwardCommits: 10,
          ageThresholdHours: 48,
          autoBackup: false,
          maxBackupBranches: 5,
        },
      },
    });
    assert.equal(cfg.maxBackwardCommits, 10);
    assert.equal(cfg.ageThresholdHours, 48);
    assert.equal(cfg.autoBackup, false);
    assert.equal(cfg.maxBackupBranches, 5);
  });
});

// ============================================================
// parseGitCommand
// ============================================================

describe('parseGitCommand — reset parsing', () => {
  it('parses git reset HEAD~1', () => {
    const r = parseGitCommand('git reset HEAD~1');
    assert.equal(r.type, 'reset');
    assert.equal(r.target, 'HEAD~1');
    assert.deepEqual(r.flags, []);
  });

  it('parses git reset --hard abc123', () => {
    const r = parseGitCommand('git reset --hard abc123');
    assert.equal(r.type, 'reset');
    assert.equal(r.target, 'abc123');
    assert.ok(r.flags.includes('--hard'));
  });

  it('parses git reset --soft HEAD~3', () => {
    const r = parseGitCommand('git reset --soft HEAD~3');
    assert.equal(r.type, 'reset');
    assert.equal(r.target, 'HEAD~3');
    assert.ok(r.flags.includes('--soft'));
  });

  it('parses git reset with short flag', () => {
    const r = parseGitCommand('git reset -q HEAD');
    assert.equal(r.type, 'reset');
    assert.ok(r.flags.includes('-q'));
  });
});

describe('parseGitCommand — discard patterns', () => {
  it('detects git checkout .', () => {
    const r = parseGitCommand('git checkout .');
    assert.equal(r.type, 'discard-all');
  });

  it('detects git checkout -- .', () => {
    const r = parseGitCommand('git checkout -- .');
    assert.equal(r.type, 'discard-all');
  });

  it('detects git restore .', () => {
    const r = parseGitCommand('git restore .');
    assert.equal(r.type, 'discard-all');
  });

  it('detects git restore --worktree .', () => {
    const r = parseGitCommand('git restore --worktree .');
    assert.equal(r.type, 'discard-all');
  });

  it('does NOT flag git restore --source (targeted restore)', () => {
    const r = parseGitCommand('git restore --source HEAD~1 path/to/file.js');
    assert.equal(r, null);
  });
});

describe('parseGitCommand — clean detection', () => {
  it('detects git clean -f', () => {
    const r = parseGitCommand('git clean -f');
    assert.equal(r.type, 'clean');
  });

  it('detects git clean -fd', () => {
    const r = parseGitCommand('git clean -fd');
    assert.equal(r.type, 'clean');
  });

  it('detects git clean -ffd', () => {
    const r = parseGitCommand('git clean -ffd');
    assert.equal(r.type, 'clean');
  });

  it('does NOT flag git clean -n (dry run)', () => {
    const r = parseGitCommand('git clean -n');
    assert.equal(r, null);
  });
});

describe('parseGitCommand — non-destructive commands', () => {
  it('returns null for git status', () => {
    assert.equal(parseGitCommand('git status'), null);
  });

  it('returns null for git log', () => {
    assert.equal(parseGitCommand('git log -5'), null);
  });

  it('returns null for git commit', () => {
    assert.equal(parseGitCommand('git commit -m "x"'), null);
  });

  it('returns null for non-git commands', () => {
    assert.equal(parseGitCommand('npm run test'), null);
    assert.equal(parseGitCommand('ls -la'), null);
  });

  it('returns null for git checkout branch-name (no .)', () => {
    assert.equal(parseGitCommand('git checkout main'), null);
  });
});

// ============================================================
// SAFE_GIT_REF — command injection prevention
// ============================================================

describe('SAFE_GIT_REF — injection prevention', () => {
  it('getCommitDistance rejects shell metacharacters', () => {
    // These would be dangerous if passed to execFile unchecked.
    // Returns -1 without invoking git when ref is unsafe.
    assert.equal(getCommitDistance('HEAD; rm -rf /'), -1);
    assert.equal(getCommitDistance('$(whoami)'), -1);
    assert.equal(getCommitDistance('`id`'), -1);
    assert.equal(getCommitDistance('HEAD && echo hi'), -1);
    assert.equal(getCommitDistance('HEAD | cat /etc/passwd'), -1);
  });

  it('getCommitAgeHours rejects shell metacharacters', () => {
    assert.equal(getCommitAgeHours('HEAD; rm'), -1);
    assert.equal(getCommitAgeHours('$(cmd)'), -1);
  });

  it('getAffectedFileCount rejects shell metacharacters', () => {
    assert.equal(getAffectedFileCount('HEAD; exec'), -1);
  });

  it('accepts safe refs (alphanumeric, HEAD~N, branch names)', () => {
    // These don't throw — they may return valid data OR -1 (git error in test env)
    const safeRefs = ['HEAD', 'HEAD~1', 'main', 'feature/foo-bar', 'abc123', 'v1.0.0'];
    for (const ref of safeRefs) {
      const r = getCommitDistance(ref);
      assert.ok(r === -1 || r >= 0, `safe ref should not error unrecoverably: ${ref}`);
    }
  });
});

// ============================================================
// checkGitSafety — disabled path
// ============================================================

describe('checkGitSafety — disabled path', () => {
  it('allows any command when gate disabled', () => {
    const config = { enforcement: { gitSafety: { enabled: false } } };
    const r = checkGitSafety('git clean -f', config);
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
  });

  it('allows any command when gate disabled — hard reset', () => {
    const config = { enforcement: { gitSafety: { enabled: false } } };
    const r = checkGitSafety('git reset --hard HEAD~10', config);
    assert.equal(r.allowed, true);
  });
});

describe('checkGitSafety — non-git commands', () => {
  it('allows non-git commands', () => {
    assert.equal(checkGitSafety('npm test', {}).allowed, true);
    assert.equal(checkGitSafety('ls -la', {}).allowed, true);
    assert.equal(checkGitSafety('git status', {}).allowed, true);
    assert.equal(checkGitSafety('git log', {}).allowed, true);
  });
});

describe('checkGitSafety — clean -f block', () => {
  it('blocks git clean -f', () => {
    const r = checkGitSafety('git clean -f', {});
    assert.equal(r.allowed, false);
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'git-safety-clean');
    assert.ok(r.message.includes('git clean -n'));
  });

  it('blocks git clean -fd', () => {
    const r = checkGitSafety('git clean -fd', {});
    assert.equal(r.blocked, true);
  });

  it('allows git clean -n (dry run)', () => {
    const r = checkGitSafety('git clean -n', {});
    assert.equal(r.allowed, true);
  });
});

describe('checkGitSafety — subcommand splitting', () => {
  it('detects clean command chained after other commands', () => {
    const r = checkGitSafety('git status && git clean -f', {});
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'git-safety-clean');
  });

  it('detects reset command chained with ;', () => {
    const r = checkGitSafety('cd foo ; git clean -f', {});
    assert.equal(r.blocked, true);
  });
});

describe('checkGitSafety — discard-all with autoBackup disabled', () => {
  it('allows git checkout . with autoBackup off', () => {
    const config = {
      enforcement: { gitSafety: { autoBackup: false } },
    };
    const r = checkGitSafety('git checkout .', config);
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
  });
});

// ============================================================
// BUG-1 / wf-2d3d09b8 — auto-backup stash data-loss hazard
//
// Regression coverage for: a stash failure on a dirty working tree must NOT
// be silently treated as success. Pre-fix, autoStash() returned a bare boolean
// and collapsed "nothing to stash" and "stash threw an error" into the same
// `false`, so the discard-all branch returned `allowed:true` either way and
// `git checkout .` proceeded to destroy the user's uncommitted work.
// ============================================================

describe('autoStash — BUG-1 contract', () => {
  it('returns {status:"no-changes"} when working tree is clean', () => {
    const calls = [];
    const exec = (cmd) => {
      calls.push(cmd);
      if (cmd === 'git status --porcelain') return '';
      throw new Error(`unexpected exec: ${cmd}`);
    };
    const r = autoStash({ exec });
    assert.equal(r.status, 'no-changes');
    assert.deepEqual(calls, ['git status --porcelain']);
  });

  it('returns {status:"stashed"} on happy path with verification', () => {
    const calls = [];
    let lastStashMessage = null;
    const exec = (cmd) => {
      calls.push(cmd);
      if (cmd === 'git status --porcelain') return ' M foo.js\n';
      if (cmd.startsWith('git stash push -m')) {
        // Capture the timestamped message the production code generated, so the
        // verification step finds it. Mirrors what real `git stash list` returns.
        const m = cmd.match(/-m\s+"([^"]+)"/);
        lastStashMessage = m ? m[1] : null;
        return '';
      }
      if (cmd === 'git stash list') {
        return `stash@{0}: On master: ${lastStashMessage}\nstash@{1}: On master: older\n`;
      }
      throw new Error(`unexpected exec: ${cmd}`);
    };
    const r = autoStash({ exec });
    assert.equal(r.status, 'stashed');
    assert.equal(r.stashRef, 'stash@{0}');
    // status check + stash push + list verification all ran
    assert.equal(calls.length, 3);
    assert.equal(calls[0], 'git status --porcelain');
    assert.ok(calls[1].startsWith('git stash push -m "auto-backup-'));
    assert.equal(calls[2], 'git stash list');
  });

  it('returns {status:"failed"} when git stash push throws (the core BUG-1 path)', () => {
    const exec = (cmd) => {
      if (cmd === 'git status --porcelain') return ' M user-work.js\n';
      if (cmd.startsWith('git stash push')) {
        const err = new Error("error: Your local changes to the following files would be overwritten by stash");
        throw err;
      }
      throw new Error(`unexpected exec: ${cmd}`);
    };
    const r = autoStash({ exec });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /git stash push failed/);
  });

  it('returns {status:"failed"} when stash succeeds (exit 0) but verification cannot find it', () => {
    // Edge case: `git stash push` returns 0 yet leaves the working tree
    // unchanged. The verification step is the defense-in-depth that catches
    // this — without it, the discard-all branch would still see "success"
    // and proceed to destroy work.
    const exec = (cmd) => {
      if (cmd === 'git status --porcelain') return ' M user-work.js\n';
      if (cmd.startsWith('git stash push')) return ''; // pretend success
      if (cmd === 'git stash list') return ''; // but no stash was actually saved
      throw new Error(`unexpected exec: ${cmd}`);
    };
    const r = autoStash({ exec });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /verification failed/);
  });

  it('returns {status:"failed"} when git status itself errors (e.g., lock contention)', () => {
    const exec = (cmd) => {
      if (cmd === 'git status --porcelain') {
        throw new Error("fatal: Unable to create '.git/index.lock': File exists.");
      }
      throw new Error(`unexpected exec: ${cmd}`);
    };
    const r = autoStash({ exec });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /git status failed/);
  });
});

describe('checkGitSafety — BUG-1 / wf-2d3d09b8: blocks discard-all on stash failure', () => {
  it('BLOCKS git checkout . when autoBackup stash fails (was data-loss bug)', () => {
    const mockStashFailed = () => ({
      status: 'failed',
      error: 'git stash push failed: simulated lock contention'
    });
    const r = checkGitSafety('git checkout .', {}, { autoStash: mockStashFailed });
    // The core regression assertion: when stash fails, command must NOT be allowed.
    assert.equal(r.allowed, false, 'discard-all MUST be blocked on stash failure');
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'git-safety-stash-failed');
    assert.match(r.message, /Auto-backup stash FAILED/);
    assert.match(r.message, /simulated lock contention/);
    assert.match(r.message, /Refusing to proceed/);
  });

  it('BLOCKS git restore . when autoBackup stash fails', () => {
    const mockStashFailed = () => ({ status: 'failed', error: 'stash verification failed' });
    const r = checkGitSafety('git restore .', {}, { autoStash: mockStashFailed });
    assert.equal(r.allowed, false);
    assert.equal(r.blocked, true);
    assert.equal(r.reason, 'git-safety-stash-failed');
  });

  it('ALLOWS git checkout . when stash succeeds (happy path)', () => {
    const mockStashed = () => ({ status: 'stashed', stashRef: 'stash@{0}' });
    const r = checkGitSafety('git checkout .', {}, { autoStash: mockStashed });
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
    assert.equal(r.autoAction, 'stash');
    assert.match(r.message, /Auto-stashed your changes \(stash@\{0\}\)/);
  });

  it('ALLOWS git checkout . when working tree is clean (no-op path)', () => {
    const mockNoChanges = () => ({ status: 'no-changes' });
    const r = checkGitSafety('git checkout .', {}, { autoStash: mockNoChanges });
    assert.equal(r.allowed, true);
    assert.equal(r.blocked, false);
    assert.equal(r.autoAction, 'no-op');
    assert.match(r.message, /No uncommitted changes/);
  });

  it('NEVER runs the destructive command if stash failed — invariant property test', () => {
    // The fundamental property: for every "failed" stash result, no `allowed:true`
    // can be returned from the discard-all branch. Probe both verbs.
    const mockStashFailed = () => ({ status: 'failed', error: 'fuzz' });
    for (const cmd of ['git checkout .', 'git checkout -- .', 'git restore .', 'git restore --staged .']) {
      const r = checkGitSafety(cmd, {}, { autoStash: mockStashFailed });
      assert.equal(r.allowed, false, `${cmd} must be blocked on stash failure`);
      assert.equal(r.blocked, true, `${cmd} must be blocked on stash failure`);
    }
  });
});
