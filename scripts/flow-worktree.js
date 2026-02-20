#!/usr/bin/env node

/**
 * Wogi Flow - Git Worktree Isolation Module
 *
 * Provides safe task execution by running work in isolated git worktrees.
 * Inspired by Auto-Claude's approach, but available for ALL modes.
 *
 * Benefits:
 * - Parallel execution without conflicts
 * - Safe rollback on failure
 * - Clean branch history
 * - No pollution of main working directory
 *
 * Usage:
 *   const { createWorktree, commitAndMerge, discardWorktree } = require('./flow-worktree');
 *
 *   const worktree = await createWorktree({ taskId: 'TASK-123', baseBranch: 'main' });
 *   // ... do work in worktree.path ...
 *   await commitAndMerge(worktree, 'feat: implement feature');
 *   // OR on failure:
 *   await discardWorktree(worktree);
 */

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { sanitizeCommitMessage } = require('./flow-security');

// ============================================================
// Configuration
// ============================================================

const WORKTREE_PREFIX = 'wogi-task-';

/**
 * Get user-specific worktree base directory.
 * Uses UID on Unix, username on Windows, with 'default' fallback.
 * This prevents permission conflicts on shared systems (CI, multi-user machines).
 * See: Claude Code 2.1.23 per-user temp directory isolation fix.
 */
function getWorktreeBaseDir() {
  const userId = process.getuid?.() ?? process.env.USER ?? process.env.USERNAME ?? 'default';
  return path.join(os.tmpdir(), `wogi-worktrees-${userId}`);
}

const WORKTREE_BASE_DIR = getWorktreeBaseDir();

// ============================================================
// Helper Functions
// ============================================================

/**
 * Execute a git command safely and return the output.
 * Uses execFileSync with array arguments to prevent shell injection.
 *
 * @param {string[]} args - Git arguments as an array (e.g., ['status', '--porcelain'])
 * @param {Object} options - Execution options
 * @returns {string|null} Command output or null on silent failure
 */
function git(args, options = {}) {
  const { cwd = process.cwd(), silent = false } = options;
  try {
    const result = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch (err) {
    if (!silent) {
      throw new Error(`Git command failed: git ${args.join(' ')}\n${err.stderr || err.message}`);
    }
    return null;
  }
}

/**
 * Check if git is available and we're in a repo
 */
function isGitRepo(cwd = process.cwd()) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
function getCurrentBranch(cwd = process.cwd()) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, silent: true }) || 'main';
}

/**
 * Get the root of the git repository
 */
function getRepoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd, silent: true });
}

/**
 * Generate a unique worktree branch name
 */
function generateBranchName(taskId, timestamp = Date.now()) {
  const sanitizedTaskId = taskId
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();
  return `${WORKTREE_PREFIX}${sanitizedTaskId}-${timestamp}`;
}

/**
 * Generate the worktree path
 */
function generateWorktreePath(branchName) {
  // Ensure base directory exists
  if (!fs.existsSync(WORKTREE_BASE_DIR)) {
    fs.mkdirSync(WORKTREE_BASE_DIR, { recursive: true });
  }
  return path.join(WORKTREE_BASE_DIR, branchName);
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Create an isolated worktree for a task
 *
 * @param {Object} options
 * @param {string} options.taskId - Task identifier (e.g., 'TASK-123')
 * @param {string} [options.baseBranch] - Branch to base work on (default: current branch)
 * @param {string} [options.repoRoot] - Repository root (default: auto-detect)
 * @returns {Object} Worktree info { path, branchName, baseBranch, repoRoot }
 */
/**
 * Detect if we're already inside a Claude Code native worktree.
 * Claude Code's --worktree flag creates worktrees under .claude/worktrees/.
 * We should not nest a WogiFlow worktree inside a native one.
 *
 * @param {string} [cwd] - Current working directory
 * @returns {{ isNative: boolean, path: string|null }}
 */
function detectNativeWorktree(cwd = process.cwd()) {
  const normalized = path.resolve(cwd);
  // Claude Code native worktrees live under .claude/worktrees/ (--worktree flag, Claude Code 1.5.0+)
  // Use path segment matching to avoid false positives on partial matches
  const segments = normalized.split(path.sep);
  const claudeIdx = segments.indexOf('.claude');
  if (claudeIdx >= 0 && segments[claudeIdx + 1] === 'worktrees') {
    return { isNative: true, path: normalized };
  }
  return { isNative: false, path: null };
}

async function createWorktree(options = {}) {
  const {
    taskId = 'unnamed-task',
    baseBranch,
    repoRoot: providedRoot
  } = options;

  // Check if already inside a Claude Code native worktree (--worktree flag)
  const nativeCheck = detectNativeWorktree();
  if (nativeCheck.isNative) {
    return {
      path: nativeCheck.path,
      branchName: getCurrentBranch(),
      baseBranch: null,
      repoRoot: getRepoRoot() || process.cwd(),
      isNativeWorktree: true,
      message: 'Using Claude Code native worktree (--worktree). Skipping nested WogiFlow worktree creation.'
    };
  }

  // Validate git repo
  const repoRoot = providedRoot || getRepoRoot();
  if (!repoRoot) {
    throw new Error('Not in a git repository');
  }

  // Determine base branch
  const base = baseBranch || getCurrentBranch(repoRoot);

  // Generate unique branch and path
  const branchName = generateBranchName(taskId);
  const worktreePath = generateWorktreePath(branchName);

  // Clean up if path already exists (shouldn't happen, but be safe)
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  // Create the worktree with a new branch
  try {
    git(['worktree', 'add', '-b', branchName, worktreePath, base], { cwd: repoRoot });
  } catch (err) {
    throw new Error(`Failed to create worktree: ${err.message}`);
  }

  const worktreeInfo = {
    path: worktreePath,
    branchName,
    baseBranch: base,
    repoRoot,
    taskId,
    createdAt: new Date().toISOString()
  };

  // Save worktree info for recovery
  const infoPath = path.join(worktreePath, '.wogi-worktree.json');
  fs.writeFileSync(infoPath, JSON.stringify(worktreeInfo, null, 2));

  return worktreeInfo;
}

/**
 * Commit changes in the worktree and merge back to base branch
 *
 * @param {Object} worktree - Worktree info from createWorktree
 * @param {string} commitMessage - Commit message
 * @param {Object} [options]
 * @param {boolean} [options.push] - Push after merge (default: false)
 * @param {boolean} [options.squash] - Squash commits on merge (default: true)
 * @param {boolean} [options.cleanup] - Remove worktree after merge (default: true)
 */
async function commitAndMerge(worktree, commitMessage, options = {}) {
  const {
    push = false,
    squash = true,
    cleanup = true
  } = options;

  const { path: worktreePath, branchName, baseBranch, repoRoot } = worktree;

  // Check for changes
  const status = git(['status', '--porcelain'], { cwd: worktreePath, silent: true });
  if (!status) {
    // No changes to commit, just cleanup
    if (cleanup) {
      await discardWorktree(worktree);
    }
    return { merged: false, reason: 'no-changes' };
  }

  // Sanitize commit message to prevent injection
  const safeMessage = sanitizeCommitMessage(commitMessage);

  // Stage and commit in worktree
  git(['add', '-A'], { cwd: worktreePath });
  git(['commit', '-m', safeMessage], { cwd: worktreePath });

  // Switch to base branch in main repo
  const originalBranch = getCurrentBranch(repoRoot);

  try {
    // Checkout base branch
    git(['checkout', baseBranch], { cwd: repoRoot });

    // Merge the worktree branch
    if (squash) {
      git(['merge', '--squash', branchName], { cwd: repoRoot });
      git(['commit', '-m', safeMessage], { cwd: repoRoot });
    } else {
      git(['merge', branchName, '-m', safeMessage], { cwd: repoRoot });
    }

    // Push if requested
    if (push) {
      git(['push', 'origin', baseBranch], { cwd: repoRoot });
    }

  } catch (err) {
    // Restore original branch on failure
    git(['checkout', originalBranch], { cwd: repoRoot, silent: true });
    throw new Error(`Merge failed: ${err.message}`);
  }

  // Cleanup
  if (cleanup) {
    await discardWorktree(worktree, { deleteBranch: true });
  }

  return { merged: true, commitMessage };
}

/**
 * Discard a worktree without merging (rollback)
 *
 * @param {Object} worktree - Worktree info from createWorktree
 * @param {Object} [options]
 * @param {boolean} [options.deleteBranch] - Also delete the branch (default: true)
 */
async function discardWorktree(worktree, options = {}) {
  const { deleteBranch = true } = options;
  const { path: worktreePath, branchName, repoRoot } = worktree;

  // Remove the worktree
  try {
    git(['worktree', 'remove', worktreePath, '--force'], { cwd: repoRoot, silent: true });
  } catch {
    // If git remove fails, try manual cleanup
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    // Prune worktree list
    git(['worktree', 'prune'], { cwd: repoRoot, silent: true });
  }

  // Delete the branch
  if (deleteBranch) {
    git(['branch', '-D', branchName], { cwd: repoRoot, silent: true });
  }

  return { discarded: true };
}

/**
 * List all active wogi worktrees
 *
 * @param {string} [repoRoot] - Repository root
 * @returns {Array} List of worktree info objects
 */
function listWorktrees(repoRoot = process.cwd()) {
  const root = getRepoRoot(repoRoot) || repoRoot;
  const output = git(['worktree', 'list', '--porcelain'], { cwd: root, silent: true });
  if (!output) return [];

  const worktrees = [];
  const entries = output.split('\n\n').filter(Boolean);

  for (const entry of entries) {
    const lines = entry.split('\n');
    const worktreePath = lines.find(l => l.startsWith('worktree '))?.replace('worktree ', '');
    const branch = lines.find(l => l.startsWith('branch '))?.replace('branch refs/heads/', '');

    if (worktreePath && branch && branch.startsWith(WORKTREE_PREFIX)) {
      // Try to load saved info
      const infoPath = path.join(worktreePath, '.wogi-worktree.json');
      let info = { path: worktreePath, branchName: branch };

      if (fs.existsSync(infoPath)) {
        try {
          info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        } catch { /* ignore */ }
      }

      worktrees.push(info);
    }
  }

  return worktrees;
}

/**
 * Cleanup all stale wogi worktrees
 *
 * @param {string} [repoRoot] - Repository root
 * @param {number} [maxAgeMs] - Max age in milliseconds (default: 24 hours)
 */
async function cleanupStaleWorktrees(repoRoot = process.cwd(), maxAgeMs = 24 * 60 * 60 * 1000) {
  const worktrees = listWorktrees(repoRoot);
  const now = Date.now();
  const cleaned = [];

  for (const worktree of worktrees) {
    const createdAt = worktree.createdAt ? new Date(worktree.createdAt).getTime() : 0;
    const age = now - createdAt;

    if (age > maxAgeMs || !worktree.createdAt) {
      try {
        await discardWorktree(worktree);
        cleaned.push(worktree.branchName);
      } catch { /* ignore cleanup errors */ }
    }
  }

  return cleaned;
}

/**
 * Run a function in an isolated worktree context
 *
 * @param {Object} options - Options for createWorktree
 * @param {Function} fn - Async function to run, receives (worktreePath, worktreeInfo)
 * @param {Object} [fnOptions]
 * @param {string} [fnOptions.commitMessage] - If provided, commit and merge on success
 * @param {boolean} [fnOptions.keepOnFailure] - Keep worktree on failure for debugging
 */
async function runInWorktree(options, fn, fnOptions = {}) {
  const { commitMessage, keepOnFailure = false } = fnOptions;
  const worktree = await createWorktree(options);

  try {
    const result = await fn(worktree.path, worktree);

    if (commitMessage) {
      await commitAndMerge(worktree, commitMessage);
    } else {
      await discardWorktree(worktree);
    }

    return { success: true, result, worktree };
  } catch (err) {
    if (!keepOnFailure) {
      await discardWorktree(worktree);
    }
    return {
      success: false,
      error: err.message,
      worktree: keepOnFailure ? worktree : null
    };
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core functions
  createWorktree,
  commitAndMerge,
  discardWorktree,

  // Utilities
  listWorktrees,
  cleanupStaleWorktrees,
  runInWorktree,

  // Helpers
  isGitRepo,
  getCurrentBranch,
  getRepoRoot,
  detectNativeWorktree,

  // Constants
  WORKTREE_PREFIX,
  WORKTREE_BASE_DIR
};

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  async function main() {
    switch (command) {
      case 'list': {
        const worktrees = listWorktrees();
        if (worktrees.length === 0) {
          console.log('No active wogi worktrees');
        } else {
          console.log('\n📁 Active Wogi Worktrees:\n');
          for (const wt of worktrees) {
            console.log(`  ${wt.branchName}`);
            console.log(`    Path: ${wt.path}`);
            console.log(`    Task: ${wt.taskId || 'unknown'}`);
            console.log(`    Created: ${wt.createdAt || 'unknown'}`);
            console.log('');
          }
        }
        break;
      }

      case 'cleanup': {
        const cleaned = await cleanupStaleWorktrees();
        if (cleaned.length === 0) {
          console.log('No stale worktrees to clean up');
        } else {
          console.log(`Cleaned up ${cleaned.length} stale worktree(s):`);
          cleaned.forEach(b => console.log(`  - ${b}`));
        }
        break;
      }

      case 'create': {
        const taskId = args[1] || 'test-task';
        const worktree = await createWorktree({ taskId });
        console.log('\n✅ Created worktree:');
        console.log(`  Branch: ${worktree.branchName}`);
        console.log(`  Path: ${worktree.path}`);
        console.log(`  Base: ${worktree.baseBranch}`);
        break;
      }

      case 'discard': {
        const branchName = args[1];
        if (!branchName) {
          console.error('Usage: flow-worktree.js discard <branch-name>');
          process.exit(1);
        }
        const worktrees = listWorktrees();
        const worktree = worktrees.find(w => w.branchName === branchName);
        if (!worktree) {
          console.error(`Worktree not found: ${branchName}`);
          process.exit(1);
        }
        await discardWorktree(worktree);
        console.log(`✅ Discarded worktree: ${branchName}`);
        break;
      }

      default:
        console.log(`
Wogi Flow - Git Worktree Isolation

Usage:
  node flow-worktree.js <command> [options]

Commands:
  list              List all active wogi worktrees
  cleanup           Remove stale worktrees (>24h old)
  create [taskId]   Create a new worktree for testing
  discard <branch>  Discard a specific worktree

Examples:
  node flow-worktree.js list
  node flow-worktree.js create TASK-123
  node flow-worktree.js cleanup
`);
    }
  }

  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
