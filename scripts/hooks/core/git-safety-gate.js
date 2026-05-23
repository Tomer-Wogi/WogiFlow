#!/usr/bin/env node

/**
 * Wogi Flow - Destructive Git Safety Net (Core Module)
 *
 * Automatically creates backup branches/stashes before destructive git operations.
 * Part of the Mechanical Enforcement Gates v3.0 initiative.
 *
 * Rules:
 *   - git reset moving HEAD backward 3+ commits → auto-backup branch + confirmation
 *   - git reset targeting a commit >24h old → auto-backup branch + confirmation
 *   - git checkout . / git restore . → auto git stash before executing
 *   - git clean -f → block unless confirmed
 *   - Rotating: keeps last 3 backup/* branches
 *
 * All checks are time-based (agnostic — no session tracking dependency).
 */

'use strict';

const _path = require('node:path');
const { getConfig, PATHS } = require('../../flow-utils');

// ============================================================
// Configuration
// ============================================================

function isGitSafetyEnabled(config) {
  if (!config) config = getConfig();
  return config.enforcement?.gitSafety?.enabled !== false;
}

function getGitSafetyConfig(config) {
  if (!config) config = getConfig();
  const gate = config.enforcement?.gitSafety ?? {};
  return {
    enabled: gate.enabled !== false,
    maxBackwardCommits: gate.maxBackwardCommits ?? 3,
    ageThresholdHours: gate.ageThresholdHours ?? 24,
    autoBackup: gate.autoBackup !== false,
    maxBackupBranches: gate.maxBackupBranches ?? 3
  };
}

// ============================================================
// Git Helpers
// ============================================================

/**
 * Get the number of commits between current HEAD and a target ref.
 * Positive = target is behind HEAD (backward reset).
 * @param {string} targetRef
 * @returns {number} Number of commits HEAD is ahead of target. -1 on error.
 */
/** Validate git ref to prevent command injection (F1-security) */
const SAFE_GIT_REF = /^[a-zA-Z0-9_.\-\/~^{}@:]+$/;

function getCommitDistance(targetRef) {
  if (!SAFE_GIT_REF.test(targetRef)) return -1;
  const { execFileSync } = require('node:child_process');
  try {
    const count = execFileSync('git', ['rev-list', '--count', `${targetRef}..HEAD`], {
      encoding: 'utf-8', cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return parseInt(count, 10) || 0;
  } catch (_err) {
    return -1;
  }
}

/**
 * Get the age of a commit in hours.
 * @param {string} ref
 * @returns {number} Age in hours. -1 on error.
 */
function getCommitAgeHours(ref) {
  if (!SAFE_GIT_REF.test(ref)) return -1;
  const { execFileSync } = require('node:child_process');
  try {
    const timestamp = execFileSync('git', ['log', '-1', '--format=%ct', ref], {
      encoding: 'utf-8', cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const commitTime = parseInt(timestamp, 10) * 1000;
    const ageMs = Date.now() - commitTime;
    return Math.floor(ageMs / (1000 * 60 * 60));
  } catch (_err) {
    return -1;
  }
}

/**
 * Get file count that would be affected by a reset.
 * @param {string} targetRef
 * @returns {number}
 */
function getAffectedFileCount(targetRef) {
  if (!SAFE_GIT_REF.test(targetRef)) return -1;
  const { execFileSync } = require('node:child_process');
  try {
    const diff = execFileSync('git', ['diff', '--name-only', targetRef, 'HEAD'], {
      encoding: 'utf-8', cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return diff ? diff.split('\n').length : 0;
  } catch (_err) {
    return -1;
  }
}

/**
 * Create a backup branch at current HEAD.
 *
 * Uses `execFileSync` (no shell) per `security-patterns.md §8` — the branch
 * name is timestamp-derived and currently safe, but going through the shell
 * with template-string interpolation is the wrong-by-default pattern.
 *
 * @returns {string|null} Branch name or null on failure.
 */
function createBackupBranch() {
  const { execFileSync } = require('node:child_process');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const branchName = `backup/pre-reset-${timestamp}`;
  try {
    execFileSync('git', ['branch', branchName], {
      encoding: 'utf-8', cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe']
    });
    return branchName;
  } catch (_err) {
    return null;
  }
}

/**
 * Clean up old backup branches, keeping only the most recent N.
 *
 * Uses `execFileSync` (no shell) per `security-patterns.md §8`. Branch names
 * pulled from `git branch --list` output and passed back to `git branch -D`
 * never touch a shell.
 *
 * @param {number} keep
 */
function rotateBackupBranches(keep) {
  const { execFileSync } = require('node:child_process');
  try {
    const branches = execFileSync(
      'git',
      ['branch', '--list', 'backup/pre-reset-*', '--sort=-creatordate'],
      { encoding: 'utf-8', cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().split('\n').map(b => b.trim()).filter(Boolean);

    if (branches.length > keep) {
      const toDelete = branches.slice(keep);
      for (const branch of toDelete) {
        try {
          execFileSync('git', ['branch', '-D', branch], {
            cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe']
          });
        } catch (_err) {
          // Non-critical
        }
      }
    }
  } catch (_err) {
    // Non-critical
  }
}

/**
 * Auto-stash current changes with verification.
 *
 * Returns a discriminated result so callers can distinguish:
 *   - `no-changes` — working tree was clean; nothing to stash. Safe to proceed.
 *   - `stashed`    — stash created AND verified present at stash@{0}. Safe to proceed.
 *   - `failed`     — something went wrong (git error, lock contention, or stash
 *                    silently no-op'd). Caller MUST NOT proceed with destructive
 *                    operations — the user's uncommitted work is still in the
 *                    working tree and would be lost.
 *
 * Historically (pre wf-2d3d09b8) this returned a bare boolean, which collapsed
 * `no-changes` and `failed` into the same `false`. Callers couldn't tell the
 * difference, so a stash failure on a dirty working tree was indistinguishable
 * from a no-op on a clean one — and the discard-all branch let the destructive
 * `git checkout .` / `git restore .` through either way. This was BUG-1.
 *
 * @param {Object} [opts]
 * @param {Function} [opts.exec] - execFileSync-shaped replacement for testing.
 *   Signature: `(file, args, opts) → stdout`. Throws on non-zero exit. Default
 *   uses `child_process.execFileSync` so no shell layer is involved — closes
 *   the security-patterns.md §8 violation that earlier versions had.
 * @returns {{ status: 'no-changes' | 'stashed' | 'failed', error?: string, stashRef?: string }}
 */
function autoStash(opts = {}) {
  const exec = opts.exec || require('node:child_process').execFileSync;
  const runOpts = { encoding: 'utf-8', cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe'] };

  // 1. Anything to stash?
  let status;
  try {
    status = exec('git', ['status', '--porcelain'], runOpts).trim();
  } catch (err) {
    return { status: 'failed', error: `git status failed: ${err.message || err}` };
  }
  if (!status) return { status: 'no-changes' };

  // 2. Attempt the stash. TOCTOU-resistant message (F18): include a random
  //    UUID-style suffix so two parallel runs can't collide on the stash@{0}
  //    verification step and so substring matches can't be forged by an
  //    attacker-controlled stash with the same timestamp prefix.
  const timestamp = new Date().toISOString().slice(0, 19);
  const nonce = require('node:crypto').randomBytes(6).toString('hex');
  const stashMessage = `auto-backup-${timestamp}-${nonce}`;
  try {
    exec('git', ['stash', 'push', '-m', stashMessage], runOpts);
  } catch (err) {
    return { status: 'failed', error: `git stash push failed: ${err.message || err}` };
  }

  // 3. VERIFY the stash actually saved (BUG-1 / wf-2d3d09b8). A zero exit code
  //    from `git stash push` is NOT proof: lock contention, broken hooks, or
  //    edge cases can leave the working tree unchanged with status 0. Confirm
  //    by reading `git stash list` and matching our nonce-suffixed message at
  //    stash@{0}.
  let stashList;
  try {
    stashList = exec('git', ['stash', 'list'], runOpts);
  } catch (err) {
    return { status: 'failed', error: `stash verification (git stash list) failed: ${err.message || err}` };
  }
  const firstLine = (stashList || '').split('\n')[0] || '';
  if (!firstLine.includes(stashMessage)) {
    return {
      status: 'failed',
      error: `stash verification failed: expected "${stashMessage}" at stash@{0}, found: ${firstLine || '(empty)'}`
    };
  }

  return { status: 'stashed', stashRef: 'stash@{0}' };
}

// ============================================================
// Command Parsing
// ============================================================

/**
 * Parse a git command to extract the operation type and target.
 * @param {string} command
 * @returns {{ type: string, target?: string, flags?: string[] } | null}
 */
function parseGitCommand(command) {
  const trimmed = command.trim();

  // git reset [--soft|--mixed|--hard] [target]
  const resetMatch = trimmed.match(/^git\s+reset\s+(.*)/);
  if (resetMatch) {
    const args = resetMatch[1].trim();
    const flags = [];
    let target = null;

    const parts = args.split(/\s+/);
    for (const part of parts) {
      if (part.startsWith('--') || part.startsWith('-')) {
        flags.push(part);
      } else {
        target = part;
      }
    }
    return { type: 'reset', target, flags };
  }

  // git checkout . or git checkout -- .
  if (/^git\s+checkout\s+(--\s+)?\./.test(trimmed)) {
    return { type: 'discard-all' };
  }

  // git restore . with optional flags (F11: handle --worktree, --staged, -W, etc.)
  if (/^git\s+restore\s+.*\./.test(trimmed) && !trimmed.includes('--source')) {
    return { type: 'discard-all' };
  }

  // git clean -f
  if (/^git\s+clean\s+.*-f/.test(trimmed)) {
    return { type: 'clean' };
  }

  return null;
}

// ============================================================
// Gate Check
// ============================================================

/**
 * Check git safety for Bash commands (PreToolUse).
 * @param {string} command - Bash command
 * @param {Object} [config]
 * @param {Object} [_deps] - Dependency injection seam (test-only).
 * @param {Function} [_deps.autoStash] - Override the autoStash helper (test-only).
 * @returns {{ allowed: boolean, blocked: boolean, reason?: string, message?: string, autoAction?: string, warning?: boolean }}
 */
function checkGitSafety(command, config, _deps) {
  const autoStashFn = (_deps && _deps.autoStash) || autoStash;

  if (!isGitSafetyEnabled(config)) {
    return { allowed: true, blocked: false };
  }

  // F4: Split compound commands and check each sub-command
  const subCommands = command.split(/\s*(?:&&|\|\||;)\s*/);
  let parsed = null;
  for (const sub of subCommands) {
    const result = parseGitCommand(sub.trim());
    if (result) { parsed = result; break; }
  }
  if (!parsed) {
    return { allowed: true, blocked: false };
  }

  const gitConfig = getGitSafetyConfig(config);

  // Handle: git checkout . / git restore .
  if (parsed.type === 'discard-all') {
    if (gitConfig.autoBackup) {
      const stashResult = autoStashFn();

      // BUG-1 / wf-2d3d09b8: previously this branch returned `allowed:true`
      // unconditionally — letting the destructive `git checkout .` /
      // `git restore .` proceed even when the auto-backup stash silently
      // failed, which destroyed the user's uncommitted work. Now we block on
      // stash failure so the user can recover their work manually first.
      if (stashResult && stashResult.status === 'failed') {
        return {
          allowed: false,
          blocked: true,
          reason: 'git-safety-stash-failed',
          message:
            `GIT SAFETY NET: Auto-backup stash FAILED.\n\n` +
            `${stashResult.error || 'Unknown stash failure.'}\n\n` +
            `Refusing to proceed with the discard operation — your uncommitted ` +
            `work would be lost with no recovery path.\n\n` +
            `Recover with one of:\n` +
            `  - Commit your work first:    git add -A && git commit -m "WIP"\n` +
            `  - Stash manually + verify:   git stash push -u -m "manual"; git stash list\n` +
            `  - Checkpoint to a branch:    git checkout -b backup-WIP && git add -A && git commit -m "snapshot"\n\n` +
            `Then re-run the discard command.`
        };
      }

      const stashed = stashResult && stashResult.status === 'stashed';
      const stashMsg = stashed
        ? `Auto-stashed your changes (${stashResult.stashRef}). Recover with: git stash pop`
        : 'No uncommitted changes to stash.';

      return {
        allowed: true,
        blocked: false,
        warning: true,
        autoAction: stashed ? 'stash' : 'no-op',
        message: `GIT SAFETY NET: ${stashMsg}\n\nProceeding with discard operation.`
      };
    }
    return { allowed: true, blocked: false };
  }

  // Handle: git clean -f
  if (parsed.type === 'clean') {
    return {
      allowed: false,
      blocked: true,
      reason: 'git-safety-clean',
      message: `GIT SAFETY NET: \`git clean -f\` permanently deletes untracked files.\n\n` +
        `This cannot be undone. If you need to clean, review first with:\n` +
        `  git clean -n  (dry run — shows what would be deleted)\n\n` +
        `Then confirm explicitly that deletion is intended.`
    };
  }

  // Handle: git reset
  if (parsed.type === 'reset' && parsed.target) {
    const target = parsed.target;
    const isHard = parsed.flags?.includes('--hard');
    const distance = getCommitDistance(target);
    const ageHours = getCommitAgeHours(target);
    const affectedFiles = getAffectedFileCount(target);

    const needsBackup =
      (distance >= gitConfig.maxBackwardCommits) ||
      (ageHours >= gitConfig.ageThresholdHours) ||
      isHard;

    if (needsBackup) {
      // F20: Create backup as part of the block message — the user must acknowledge
      // before proceeding. Backup is created here so it exists if the user retries.
      let backupMsg = '';
      let backupBranch = null;
      if (gitConfig.autoBackup) {
        backupBranch = createBackupBranch();
        if (backupBranch) {
          rotateBackupBranches(gitConfig.maxBackupBranches);
          backupMsg = `Auto-created backup branch: ${backupBranch}\n` +
            `  Recover with: git checkout ${backupBranch}\n\n`;
        } else {
          backupMsg = 'WARNING: Failed to create backup branch.\n\n';
        }
      }

      const reasons = [];
      if (distance >= gitConfig.maxBackwardCommits) {
        reasons.push(`moves HEAD backward ${distance} commits (threshold: ${gitConfig.maxBackwardCommits})`);
      }
      if (ageHours >= gitConfig.ageThresholdHours) {
        const ageDays = Math.floor(ageHours / 24);
        reasons.push(`target commit is ${ageDays > 0 ? ageDays + ' days' : ageHours + ' hours'} old (threshold: ${gitConfig.ageThresholdHours}h)`);
      }
      if (isHard) {
        reasons.push('--hard flag discards all uncommitted changes');
      }

      return {
        allowed: false,
        blocked: true,
        reason: 'git-safety-reset',
        message: `GIT SAFETY NET: This reset requires confirmation.\n\n` +
          `${backupMsg}` +
          `Reasons:\n${reasons.map(r => `  - ${r}`).join('\n')}\n\n` +
          `Impact: ${affectedFiles >= 0 ? affectedFiles + ' files affected' : 'unknown impact'}\n\n` +
          `This reset could destroy work from prior sessions.\n` +
          `If you're sure, acknowledge the backup and proceed.`
      };
    }
  }

  return { allowed: true, blocked: false };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  isGitSafetyEnabled,
  getGitSafetyConfig,
  checkGitSafety,
  parseGitCommand,
  createBackupBranch,
  rotateBackupBranches,
  autoStash,
  getCommitDistance,
  getCommitAgeHours,
  getAffectedFileCount
};
