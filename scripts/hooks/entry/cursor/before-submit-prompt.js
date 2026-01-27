#!/usr/bin/env node

/**
 * Wogi Flow - Cursor beforeSubmitPrompt Hook Entry Point
 *
 * PRIMARY ENFORCEMENT MECHANISM for Cursor.
 *
 * Gates implementation requests - blocks if no active task.
 * This is critical because Cursor cannot block file edits after the prompt is accepted.
 *
 * Output format:
 * - { continue: false, user_message: "..." } to block
 * - { continue: true } to allow
 */

const { checkImplementationGate } = require('../../core/implementation-gate');
const { cursorAdapter } = require('../../adapters/cursor');

// Maximum stdin size (100KB)
const MAX_STDIN_SIZE = 100 * 1024;

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
 * Handle beforeSubmitPrompt event
 */
async function handleBeforeSubmitPrompt(input) {
  try {
    const parsedInput = cursorAdapter.parseInput(input);

    // SECURITY: Validate prompt exists and has reasonable length
    if (!parsedInput.prompt || typeof parsedInput.prompt !== 'string') {
      return { continue: true };
    }

    // Check if this is an implementation request without active task
    const coreResult = checkImplementationGate({
      prompt: parsedInput.prompt,
      source: 'user'
    });

    // Transform to Cursor format
    return cursorAdapter.transformResult('beforeSubmitPrompt', coreResult);
  } catch (err) {
    // On error, allow the prompt to continue (fail open for UX)
    // Log to stderr (not stdout) so it doesn't interfere with JSON output
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    return { continue: true };
  }
}

// Cursor hooks receive JSON via stdin, output JSON to stdout
async function main() {
  const inputData = await readStdinWithLimit();

  let input = {};
  try {
    const parsed = JSON.parse(inputData);
    // Validate that parsed JSON is an object (not primitive or array)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      input = parsed;
    }
  } catch {
    // Invalid JSON - allow prompt (fail open)
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const result = await handleBeforeSubmitPrompt(input);
  console.log(JSON.stringify(result));
}

main().catch(err => {
  if (process.env.DEBUG) {
    console.error(`[cursor/before-submit-prompt] Fatal: ${err.message}`);
  }
  // Fail open on fatal error
  console.log(JSON.stringify({ continue: true }));
  process.exit(1);
});
