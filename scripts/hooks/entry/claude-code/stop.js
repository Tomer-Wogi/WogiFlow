#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Stop Hook
 *
 * Called when Claude is about to stop.
 * Enforces loop completion - blocks stop if acceptance criteria incomplete.
 */

const { checkLoopExit } = require('../../core/loop-check');
const { claudeCodeAdapter } = require('../../adapters/claude-code');

async function main() {
  try {
    // Read input from stdin
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? JSON.parse(inputData) : {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    // Check if loop can exit
    const coreResult = await checkLoopExit();

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('Stop', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // On error, allow stop (don't block user)
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    console.log(JSON.stringify({ continue: false })); // Allow stop
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
