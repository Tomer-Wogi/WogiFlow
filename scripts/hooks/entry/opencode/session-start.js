#!/usr/bin/env node

/**
 * Wogi Flow - OpenCode session.start Hook Entry Point
 *
 * Called when an OpenCode session starts.
 * Injects context (suspended tasks, decisions, recent activity).
 */

const { gatherSessionContext } = require('../../core/session-context');
const { opencodeAdapter } = require('../../adapters/opencode');

// Lazy-load session state to avoid startup cost
let sessionState = null;
function getSessionState() {
  if (!sessionState) {
    try {
      sessionState = require('../../../flow-session-state');
    } catch {
      sessionState = {
        setCliSessionId: async () => {},
        clearStaleCurrentTaskAsync: async () => {}
      };
    }
  }
  return sessionState;
}

/**
 * Handle session start event
 * @param {Object} ctx - OpenCode plugin context
 * @returns {Object} Plugin result with additionalContext
 */
async function handleSessionStart(ctx) {
  try {
    const input = ctx || {};
    const parsedInput = opencodeAdapter.parseInput(input);

    // Store CLI session ID for tracking
    if (parsedInput.sessionId) {
      const state = getSessionState();
      try {
        await state.setCliSessionId(parsedInput.sessionId);
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[opencode/session-start] Failed to store session ID: ${err.message}`);
        }
      }
    }

    // Clear stale currentTask if it's already in recentlyCompleted
    try {
      const state = getSessionState();
      await state.clearStaleCurrentTaskAsync();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[opencode/session-start] Failed to clear stale task: ${err.message}`);
      }
    }

    // Gather session context
    const coreResult = gatherSessionContext({
      includeSuspended: true,
      includeDecisions: true,
      includeActivity: true
    });

    // Transform to OpenCode format
    return opencodeAdapter.transformResult('session.start', coreResult);
  } catch (err) {
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    return {};
  }
}

// Export for plugin use
module.exports = handleSessionStart;

// CLI interface if run directly (for testing)
if (require.main === module) {
  const runTest = async () => {
    const result = await handleSessionStart({});
    console.log(JSON.stringify(result, null, 2));
  };
  runTest();
}
