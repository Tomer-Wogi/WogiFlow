#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code SessionEnd Hook
 *
 * Called when a Claude Code session ends.
 * Auto-logs to request-log.md and warns about uncommitted work.
 */

const { handleSessionEnd } = require('../../core/session-end');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { readHookInput } = require('../shared/read-stdin');

async function main() {
  try {
    const { input: parsedStdin } = await readHookInput();
    const input = parsedStdin || {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    // Handle session end
    const coreResult = handleSessionEnd(parsedInput);

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('SessionEnd', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
