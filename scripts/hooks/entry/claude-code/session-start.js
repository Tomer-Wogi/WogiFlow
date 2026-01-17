#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code SessionStart Hook
 *
 * Called when a Claude Code session starts.
 * Injects context (suspended tasks, decisions, recent activity).
 */

const { gatherSessionContext } = require('../../core/session-context');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { setCliSessionId } = require('../../../flow-session-state');

async function main() {
  try {
    // Read input from stdin
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? JSON.parse(inputData) : {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    // Store CLI session ID for tracking (CLI-agnostic via session-state)
    // Uses async with locking to prevent race conditions
    if (parsedInput.sessionId) {
      try {
        await setCliSessionId(parsedInput.sessionId);
      } catch (err) {
        // Non-blocking - session ID storage is best-effort
        if (process.env.DEBUG) {
          console.error(`[session-start] Failed to store session ID: ${err.message}`);
        }
      }
    }

    // Gather session context
    const coreResult = gatherSessionContext({
      includeSuspended: true,
      includeDecisions: true,
      includeActivity: true
    });

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('SessionStart', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - log to stderr, exit 1
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    process.exit(1);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
