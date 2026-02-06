#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code TeammateIdle Hook
 *
 * Called when a teammate agent becomes idle (Claude Code 2.1.33+).
 * Suggests next available task for parallel execution.
 *
 * EXPERIMENTAL: Disabled by default. Enable via config:
 *   hooks.rules.teammateIdle.enabled = true
 */

const { handleTeammateIdle } = require('../../core/teammate-idle');
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

    // Handle teammate idle
    const coreResult = handleTeammateIdle(parsedInput);

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('TeammateIdle', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - don't prevent idle handling
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
