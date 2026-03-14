#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code InstructionsLoaded Hook
 *
 * Called when CLAUDE.md or .claude/rules/*.md files are loaded into context.
 *
 * Responsibilities:
 * 1. Package-check: detect new dependencies, suggest /wogi-rescan
 * 2. Rule conflict detection: find contradictions between rules
 * 3. Auto-onboard: detect missing .workflow/state/, ask if setup should run
 *
 * This hook is non-blocking (never rejects).
 */

const { handleInstructionsLoaded } = require('../../core/instructions-loaded');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { readHookInput } = require('../shared/read-stdin');

process.stdin.setEncoding('utf8');

async function main() {
  try {
    const { input: parsedStdin } = await readHookInput();
    const input = parsedStdin || {};
    const parsedInput = claudeCodeAdapter.parseInput(input);
    const projectRoot = parsedInput.cwd || process.cwd();

    // Handle the instructions loaded event
    const result = handleInstructionsLoaded({ projectRoot });

    // Transform to Claude Code format via adapter
    const output = claudeCodeAdapter.transformResult('InstructionsLoaded', result);

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Never block on errors
    if (process.env.DEBUG) {
      console.error(`[instructions-loaded] Error: ${err.message}`);
    }
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

main();
