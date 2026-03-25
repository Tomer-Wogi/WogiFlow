/**
 * Wogi Flow - Shared Hook Runner
 *
 * Wraps the common boilerplate shared across hook entry files:
 * stdin reading, JSON parsing, adapter invocation, error handling, output formatting.
 *
 * Usage:
 *   const { runHook } = require('../shared/hook-runner');
 *   runHook('SessionEnd', async ({ input, parsedInput }) => {
 *     const result = handleSessionEnd(parsedInput);
 *     return result;
 *   }, { failMode: 'silent' });
 *
 * @param {string} eventName - Hook event name (e.g., 'SessionEnd', 'PostCompact')
 * @param {Function} handler - Async function receiving { input, parsedInput, raw }
 *   Must return a result object for claudeCodeAdapter.transformResult()
 * @param {object} [options]
 * @param {'silent'|'warn'|'block'} [options.failMode='silent']
 *   - 'silent': swallow errors, output { continue: true }
 *   - 'warn': log to stderr, output { continue: true }
 *   - 'block': log to stderr, output deny/block result
 * @param {boolean} [options.useStdoutWrite=false] - Use process.stdout.write instead of console.log
 * @param {boolean} [options.skipAdapter=false] - If true, handler returns raw output (no adapter transform)
 * @param {object} [options.failOutput] - Custom error output object (overrides default error response)
 */

const { readHookInput } = require('./read-stdin');
const { claudeCodeAdapter } = require('../../adapters/claude-code');

async function runHook(eventName, handler, { failMode = 'silent', useStdoutWrite = false, skipAdapter = false, failOutput = null } = {}) {
  const write = useStdoutWrite
    ? (data) => process.stdout.write(data)
    : (data) => console.log(data);

  process.stdin.setEncoding('utf8');

  try {
    const { input, raw } = await readHookInput();
    const parsedInput = input ? claudeCodeAdapter.parseInput(input) : {};

    const result = await handler({ input: input ?? {}, parsedInput, raw });

    // Handler can return { __raw: true, ...payload } to bypass adapter transform
    if (result && result.__raw) {
      const { __raw, ...payload } = result;
      write(JSON.stringify(payload));
    } else if (skipAdapter) {
      write(JSON.stringify(result));
    } else {
      const output = claudeCodeAdapter.transformResult(eventName, result);
      write(JSON.stringify(output));
    }
    process.exit(0);
  } catch (err) {
    const errorOutput = failOutput ?? { continue: true };

    if (failMode === 'silent') {
      // Swallow error, allow through
      write(JSON.stringify(errorOutput));
      process.exit(0);
    } else if (failMode === 'warn') {
      // Log error, allow through
      if (process.env.DEBUG) {
        console.error(`[${eventName}] Hook error: ${err.message}`);
      }
      try {
        const { logHookError } = require('../../../flow-hook-errors');
        logHookError(eventName, err, { failMode: 'open', operation: eventName.toLowerCase() });
      } catch (_logErr) {
        console.error(`[WogiFlow] ${eventName} hook error: ${err.message}`);
      }
      write(JSON.stringify(errorOutput));
      process.exit(0);
    } else if (failMode === 'block') {
      // Log error, deny/block
      if (process.env.DEBUG) {
        console.error(`[${eventName}] Hook error (blocking): ${err.message}`);
      } else {
        console.error(`[Wogi Flow Hook] Validation error occurred`);
      }
      const blockOutput = failOutput ?? {
        continue: true,
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: 'deny',
          permissionDecisionReason: `WogiFlow ${eventName} validation error. Please check your setup or use /wogi-start.`
        }
      };
      write(JSON.stringify(blockOutput));
      process.exit(0);
    } else {
      // Unknown failMode — default to silent behavior
      write(JSON.stringify(errorOutput));
      process.exit(0);
    }
  }
}

module.exports = { runHook };
