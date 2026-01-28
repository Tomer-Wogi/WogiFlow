#!/usr/bin/env node

/**
 * Wogi Flow - Cursor stop Hook Entry Point
 *
 * Called when a Cursor session ends or stops.
 * Can provide a followup message for loop continuation.
 *
 * Output format:
 * - { followup_message: "..." } to suggest followup action
 * - {} for no followup
 */

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
        getCurrentTask: () => null,
        clearCliSessionId: async () => {}
      };
    }
  }
  return sessionState;
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
 * Handle stop event
 */
async function handleStop(input) {
  try {
    const parsedInput = cursorAdapter.parseInput(input);

    // Get task info BEFORE clearing session state
    const state = getSessionState();

    // Guard against null state
    if (!state || typeof state.getCurrentTask !== 'function') {
      return {};
    }

    const currentTask = state.getCurrentTask();

    // Clear CLI session ID
    try {
      if (typeof state.clearCliSessionId === 'function') {
        await state.clearCliSessionId();
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[cursor/stop] Failed to clear session ID: ${err.message}`);
      }
    }

    // Check if there's an active task that wasn't completed
    // Warn if task exists AND session stopped without completing
    if (currentTask && currentTask.id && parsedInput.status !== 'complete') {
      return cursorAdapter.transformResult('stop', {
        followupMessage: `Task ${currentTask.id} may still be in progress. Run /wogi-status to check.`
      });
    }

    // Check loop count for potential stuck loops
    if (parsedInput.loopCount > 10) {
      return cursorAdapter.transformResult('stop', {
        followupMessage: 'Session had many iterations. Consider breaking down the task.'
      });
    }

    return {};
  } catch (err) {
    // Log error but continue
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
    // Invalid JSON - return empty
    console.log(JSON.stringify({}));
    return;
  }

  const result = await handleStop(input);
  console.log(JSON.stringify(result));
}

main().catch(err => {
  if (process.env.DEBUG) {
    console.error(`[cursor/stop] Fatal: ${err.message}`);
  }
  console.log(JSON.stringify({}));
  process.exit(1);
});
