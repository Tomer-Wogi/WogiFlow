#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Setup Hook
 *
 * Called when Claude Code is started with --init, --init-only, or --maintenance flags.
 * Triggers project setup or maintenance operations.
 *
 * Claude Code 2.1.10+ feature.
 */

const { handleSetup, handleMaintenance } = require('../../core/setup-handler');
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

    // Determine what type of setup event this is
    // Claude Code passes the trigger via source or a specific field
    const trigger = parsedInput.source || 'init';
    const isMaintenance = trigger === 'maintenance' || trigger === '--maintenance';

    let coreResult;

    if (isMaintenance) {
      // Run maintenance tasks
      coreResult = handleMaintenance({
        cwd: parsedInput.cwd
      });
    } else {
      // Run setup check
      coreResult = handleSetup({
        trigger,
        cwd: parsedInput.cwd
      });
    }

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('Setup', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - log to stderr, exit with allow
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    // Exit 0 with allow to not block on hook errors (graceful degradation)
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'Setup'
      }
    }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
