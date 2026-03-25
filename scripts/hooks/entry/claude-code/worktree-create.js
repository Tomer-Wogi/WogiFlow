#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code WorktreeCreate Hook
 *
 * Called when a new worktree is created (Claude Code 2.1.50+).
 * Copies essential .workflow/state files to the new worktree
 * so task context and decisions are available in the isolated environment.
 *
 * This hook is non-blocking (never rejects).
 */

const { handleWorktreeCreate } = require('../../core/worktree-lifecycle');
const { runHook } = require('../shared/hook-runner');

runHook('WorktreeCreate', async ({ input }) => {
  const worktreePath = input.worktree_path || input.worktreePath || '';
  const projectRoot = input.cwd || process.cwd();
  return handleWorktreeCreate({ worktreePath, projectRoot });
}, { failMode: 'silent', useStdoutWrite: true });
