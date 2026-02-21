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

    const result = handleWorktreeCreate({ worktreePath, projectRoot });
    const output = claudeCodeAdapter.transformResult('WorktreeCreate', result);

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Never block on worktree lifecycle errors
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
