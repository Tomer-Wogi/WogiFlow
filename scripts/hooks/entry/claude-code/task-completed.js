#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code TaskCompleted Hook
 *
 * Called when a sub-agent task completes (Claude Code 2.1.33+).
 * Moves completed tasks in ready.json and logs completion.
 */

const { handleTaskCompleted } = require('../../core/task-completed');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { safeJsonParseString } = require('../../flow-utils');

async function main() {
  try {
    // Read input from stdin
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? safeJsonParseString(inputData, {}) : {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    // Handle task completion
    const coreResult = await handleTaskCompleted(parsedInput);

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('TaskCompleted', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - don't prevent task completion
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
