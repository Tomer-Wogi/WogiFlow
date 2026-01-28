#!/usr/bin/env node

/**
 * Wogi Flow - Cursor sessionStart Hook Entry Point
 *
 * Called when a Cursor session starts.
 * Injects context (suspended tasks, decisions, recent activity).
 *
 * Output format: { additional_context: "...", env: {} }
 */

const { gatherSessionContext } = require('../../core/session-context');
const { cursorAdapter } = require('../../adapters/cursor');

// Maximum stdin size (100KB)
const MAX_STDIN_SIZE = 100 * 1024;

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

// Lazy-load bridge state for auto-sync
let autoSyncBridge = null;
function getAutoSyncBridge() {
  if (!autoSyncBridge) {
    try {
      autoSyncBridge = require('../../../flow-bridge-state').autoSyncBridge;
    } catch {
      autoSyncBridge = async () => ({ synced: false, reason: 'unavailable' });
    }
  }
  return autoSyncBridge;
}

/**
 * Read stdin with size limit protection
 * @returns {string} Input data, truncated if over limit
 */
async function readStdinWithLimit() {
  let inputData = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    const remainingBytes = MAX_STDIN_SIZE - inputData.length;
    if (remainingBytes <= 0) {
      break;
    }
    const toAdd = chunk.slice(0, remainingBytes);
    inputData += toAdd;
    if (inputData.length >= MAX_STDIN_SIZE) {
      break;
    }
  }

  return inputData;
}

/**
 * Handle session start event
 */
async function handleSessionStart(input) {
  // Auto-sync bridge if needed (non-blocking, silent)
  try {
    const syncFn = getAutoSyncBridge();
    await syncFn('cursor', { silent: true });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[cursor/session-start] Bridge auto-sync failed: ${err.message}`);
    }
  }

  try {
    const parsedInput = cursorAdapter.parseInput(input);

    // Store CLI session ID for tracking
    if (parsedInput.conversationId) {
      const state = getSessionState();
      try {
        await state.setCliSessionId(parsedInput.conversationId);
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[cursor/session-start] Failed to store session ID: ${err.message}`);
        }
      }
    }

    // Clear stale currentTask if it's already in recentlyCompleted
    try {
      const state = getSessionState();
      await state.clearStaleCurrentTaskAsync();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[cursor/session-start] Failed to clear stale task: ${err.message}`);
      }
    }

    // Gather session context
    const coreResult = gatherSessionContext({
      includeSuspended: true,
      includeDecisions: true,
      includeActivity: true
    });

    // Transform to Cursor format
    return cursorAdapter.transformResult('sessionStart', coreResult);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    }
    return {};
  }
}

// Cursor hooks receive JSON via stdin, output JSON to stdout
async function main() {
  const inputData = await readStdinWithLimit();

  let input = {};
  try {
    input = JSON.parse(inputData);
  } catch {
    // Invalid JSON - continue with empty input
  }

  const result = await handleSessionStart(input);
  console.log(JSON.stringify(result));
}

main().catch(err => {
  if (process.env.DEBUG) {
    console.error(`[cursor/session-start] Fatal: ${err.message}`);
  }
  console.log(JSON.stringify({}));
  process.exit(1);
});
