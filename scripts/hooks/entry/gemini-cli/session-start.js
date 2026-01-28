#!/usr/bin/env node

/**
 * Wogi Flow - Gemini CLI SessionStart Hook
 *
 * Called when a Gemini CLI session starts.
 * Injects context (suspended tasks, decisions, recent activity).
 */

const { gatherSessionContext } = require('../../core/session-context');
const { geminiAdapter } = require('../../adapters/gemini');

// Lazy-load session state to avoid circular dependencies
let setCliSessionId, clearStaleCurrentTaskAsync;
try {
  const sessionState = require('../../../flow-session-state');
  setCliSessionId = sessionState.setCliSessionId;
  clearStaleCurrentTaskAsync = sessionState.clearStaleCurrentTaskAsync;
} catch (err) {
  // Module not available - provide no-op fallbacks
  setCliSessionId = async () => {};
  clearStaleCurrentTaskAsync = async () => {};
}

async function main() {
  try {
    // Read input from stdin
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? JSON.parse(inputData) : {};
    const parsedInput = geminiAdapter.parseInput(input);

    // Store CLI session ID for tracking
    if (parsedInput.sessionId) {
      try {
        await setCliSessionId(parsedInput.sessionId);
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[session-start] Failed to store session ID: ${err.message}`);
        }
      }
    }

    // Clear stale currentTask if it's already in recentlyCompleted
    try {
      await clearStaleCurrentTaskAsync();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Failed to clear stale task: ${err.message}`);
      }
    }

    // Gather session context
    const coreResult = gatherSessionContext({
      includeSuspended: true,
      includeDecisions: true,
      includeActivity: true
    });

    // Transform to Gemini CLI format
    const output = geminiAdapter.transformResult('SessionStart', coreResult);

    // Output JSON (must be only output to stdout)
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - log to stderr, exit 1
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    // Return allow response to not block session
    console.log(JSON.stringify({ continue: true, decision: 'allow' }));
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
