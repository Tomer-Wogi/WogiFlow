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
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { safeJsonParseString } = require('../../../flow-utils');

process.stdin.setEncoding('utf8');

async function main() {
  try {
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? safeJsonParseString(inputData, {}) : {};

    const worktreePath = input.worktree_path || input.worktreePath || '';
    const projectRoot = input.cwd || process.cwd();

    const result = handleWorktreeRemove({ worktreePath, projectRoot });
    const output = claudeCodeAdapter.transformResult('WorktreeRemove', result);

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Never block on worktree lifecycle errors
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
