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
