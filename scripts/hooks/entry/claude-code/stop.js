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
const { isRoutingPending, clearRoutingPending } = require('../../core/routing-gate');
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

    // v6.2: Routing enforcement check — catches text-only response bypass
    // If routing-pending flag is still set when the AI tries to stop, it means
    // the AI responded to the user's message without ever invoking a /wogi-* command.
    // This is the exact bypass we need to prevent (especially after context compaction).
    try {
      if (isRoutingPending()) {
        // Clear the flag to prevent infinite loops on retry
        clearRoutingPending();

        // Block the stop — force the AI to route through /wogi-start
        const routingMessage = [
          'ROUTING VIOLATION DETECTED: You responded to the user without invoking a /wogi-* command first.',
          'This is a mandatory WogiFlow workflow requirement that applies to ALL user messages — including after context compaction.',
          '',
          'ACTION REQUIRED: You must invoke the Skill tool with skill="wogi-start" and pass the user\'s original request as args.',
          'Example: Skill(skill="wogi-start", args="<the user\'s original request>")',
          '',
          'Do NOT apologize and stop. Do NOT explain why you skipped routing.',
          'Instead: invoke /wogi-start NOW with the user\'s most recent message.'
        ].join('\n');

        console.log(JSON.stringify({
          continue: true, // Force continue — don't let the AI stop
          stopReason: routingMessage
        }));
        process.exit(0);
        return;
      }
    } catch (err) {
      // Fail-open for routing check in Stop hook — don't trap users in unexitable sessions
      if (process.env.DEBUG) {
        console.error(`[Stop] Routing check error (fail-open): ${err.message}`);
      }
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
