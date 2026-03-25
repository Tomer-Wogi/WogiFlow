#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code WorktreeRemove Hook
 *
 * Called when a worktree is removed (Claude Code 2.1.50+).
 * Cleans up session state from the removed worktree to prevent
 * stale data from accumulating.
 *
 * This hook is non-blocking (never rejects).
 */

const { handleWorktreeRemove } = require('../../core/worktree-lifecycle');
const { runHook } = require('../shared/hook-runner');

runHook('WorktreeRemove', async ({ input }) => {
  const worktreePath = input.worktree_path || input.worktreePath || '';
  const projectRoot = input.cwd || process.cwd();
  return handleWorktreeRemove({ worktreePath, projectRoot });
}, { failMode: 'silent', useStdoutWrite: true });
