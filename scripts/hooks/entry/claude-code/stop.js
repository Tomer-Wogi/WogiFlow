#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Stop Hook
 *
 * Called when Claude is about to stop.
 * Enforces:
 * 1. Loop completion - blocks stop if acceptance criteria incomplete
 * 2. Routing enforcement - blocks stop if routing-pending flag is still set
 *    (catches text-only responses that bypassed /wogi-start routing)
 *
 * v6.2: Added routing enforcement to catch post-compaction bypass
 */

const { checkLoopExit } = require('../../core/loop-check');
const { isRoutingPending, incrementStopAttempts } = require('../../core/routing-gate');
const { runHook } = require('../shared/hook-runner');

runHook('Stop', async ({ parsedInput }) => {
  // v6.2: Routing enforcement check — catches text-only response bypass
  // If routing-pending flag is still set when the AI tries to stop, it means
  // the AI responded to the user's message without ever invoking a /wogi-* command.
  // This is the exact bypass we need to prevent (especially after context compaction).
  try {
    if (isRoutingPending()) {
      // Use counter-based approach instead of clearing immediately.
      // This gives the AI multiple chances to comply before giving up.
      // Gap 4 fix: clearing immediately made this single-shot protection.
      const { cleared, attempts } = incrementStopAttempts(10);

      if (cleared) {
        // Max attempts reached — allow stop to prevent infinite loop
        if (process.env.DEBUG) {
          console.error(`[Stop] Max routing enforcement attempts reached (${attempts}), allowing stop`);
        }
        // Fall through to normal stop logic
      } else {
        // Block the stop — force the AI to route through /wogi-start
        const routingMessage = [
          `ROUTING VIOLATION (attempt ${attempts}/10): You MUST call Skill(skill="wogi-start") before responding.`,
          '',
          'Call Skill(skill="wogi-start", args="<user\'s message>") NOW. No text. No explanation. Just the Skill tool call.'
        ].join('\n');

        // Return raw output — skip adapter transform for routing enforcement
        // (this needs { continue: true, stopReason } format directly)
        return { __raw: true, continue: true, stopReason: routingMessage };
      }
    }
  } catch (err) {
    // Fail-CLOSED for routing check — force continuation on errors.
    // Gap 5 fix: failing open here disabled the last line of defense.
    // Worst case: AI retries and hits the 3-attempt limit, which clears naturally.
    if (process.env.DEBUG) {
      console.error(`[Stop] Routing check error (fail-closed, forcing continue): ${err.message}`);
    }
    return {
      __raw: true,
      continue: true,
      stopReason: 'Routing enforcement check encountered an error. Please invoke /wogi-start with your request.'
    };
  }

  // Check if loop can exit
  return await checkLoopExit();
}, { failMode: 'warn', failOutput: { continue: false } });
