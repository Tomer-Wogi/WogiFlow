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
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { safeJsonParseString } = require('../../../flow-utils');

// Maximum stdin size to prevent DoS (100KB — consistent with pre-tool-use.js)
const MAX_STDIN_SIZE = 100 * 1024;

async function main() {
  try {
    // Read input from stdin with size limit
    let inputData = '';
    let totalSize = 0;
    for await (const chunk of process.stdin) {
      totalSize += chunk.length;
      if (totalSize > MAX_STDIN_SIZE) {
        inputData += chunk.slice(0, MAX_STDIN_SIZE - (totalSize - chunk.length));
        break;
      }
      inputData += chunk;
    }

    const input = inputData ? safeJsonParseString(inputData, {}) : {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    // v6.2: Routing enforcement check — catches text-only response bypass
    // If routing-pending flag is still set when the AI tries to stop, it means
    // the AI responded to the user's message without ever invoking a /wogi-* command.
    // This is the exact bypass we need to prevent (especially after context compaction).
    try {
      if (isRoutingPending()) {
        // Use counter-based approach instead of clearing immediately.
        // This gives the AI multiple chances to comply before giving up.
        // Gap 4 fix: clearing immediately made this single-shot protection.
        const { cleared, attempts } = incrementStopAttempts(3);

        if (cleared) {
          // Max attempts reached — allow stop to prevent infinite loop
          if (process.env.DEBUG) {
            console.error(`[Stop] Max routing enforcement attempts reached (${attempts}), allowing stop`);
          }
          // Fall through to normal stop logic
        } else {
          // Block the stop — force the AI to route through /wogi-start
          const routingMessage = [
            `ROUTING VIOLATION (${attempts}/3): You skipped /wogi-start routing.`,
            '',
            'You just rationalized answering directly. This is the exact bypass pattern WogiFlow exists to prevent.',
            'Having context or "knowing the answer" is NEVER a reason to skip routing.',
            '',
            'YOUR ONLY OPTION: Invoke Skill(skill="wogi-start", args="<user\'s message>") RIGHT NOW.',
            '',
            'Do NOT output any text first. Do NOT apologize. Do NOT explain.',
            'The NEXT thing you do must be a Skill tool call to wogi-start. Nothing else.'
          ].join('\n');

          console.log(JSON.stringify({
            continue: true, // Force continue — don't let the AI stop
            stopReason: routingMessage
          }));
          process.exit(0);
          return;
        }
      }
    } catch (err) {
      // Fail-CLOSED for routing check — force continuation on errors.
      // Gap 5 fix: failing open here disabled the last line of defense.
      // Worst case: AI retries and hits the 3-attempt limit, which clears naturally.
      if (process.env.DEBUG) {
        console.error(`[Stop] Routing check error (fail-closed, forcing continue): ${err.message}`);
      }
      console.log(JSON.stringify({
        continue: true,
        stopReason: 'Routing enforcement check encountered an error. Please invoke /wogi-start with your request.'
      }));
      process.exit(0);
      return;
    }

    // Check if loop can exit
    const coreResult = await checkLoopExit();

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('Stop', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // On error, allow stop (don't block user)
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    console.log(JSON.stringify({ continue: false })); // Allow stop
    process.exit(0);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
