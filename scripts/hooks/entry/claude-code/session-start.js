#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code SessionStart Hook
 *
 * Called when a Claude Code session starts.
 * Injects context (suspended tasks, decisions, recent activity).
 */

const { gatherSessionContext } = require('../../core/session-context');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { setCliSessionId, clearStaleCurrentTaskAsync } = require('../../../flow-session-state');

// Lazy-load bridge state to avoid circular dependencies
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

async function main() {
  try {
    // Auto-sync bridge if needed (non-blocking, silent)
    try {
      const syncFn = getAutoSyncBridge();
      await syncFn('claude-code', { silent: true });
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Bridge auto-sync failed: ${err.message}`);
      }
    }
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

    // Clear stale currentTask if it's already in recentlyCompleted
    // Fixes bug where completed tasks show as "in progress" in morning briefing
    // Uses async version with locking for concurrent safety
    try {
      await clearStaleCurrentTaskAsync();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Failed to clear stale task: ${err.message}`);
      }
    }

    // Gather session context
    const coreResult = await gatherSessionContext({
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
