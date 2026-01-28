#!/usr/bin/env node

/**
 * Wogi Flow - Cursor afterFileEdit Hook Entry Point
 *
 * Runs validation after file edits.
 *
 * IMPORTANT: This hook CANNOT block operations.
 * It is informational only - Cursor does not support blocking from afterFileEdit.
 * We log validation results for user visibility.
 *
 * Output: Empty object (Cursor ignores afterFileEdit output)
 */

const { runValidation } = require('../../core/validation');
const { cursorAdapter } = require('../../adapters/cursor');

// Validation timeout (30 seconds)
const VALIDATION_TIMEOUT_MS = 30000;
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
 * Run validation with timeout and proper cleanup
 * Wraps in Promise.resolve to ensure synchronous errors become async rejections
 */
async function runValidationWithTimeout(options) {
  let timeoutId = null;

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => runValidation(options)),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Validation timed out')), VALIDATION_TIMEOUT_MS);
      })
    ]);

    // Clear timeout if validation completed first
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return result;
  } catch (err) {
    // Clear timeout on error too
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    throw err;
  }
}

/**
 * Handle afterFileEdit event
 */
async function handleAfterFileEdit(input) {
  try {
    const parsedInput = cursorAdapter.parseInput(input);

    // SECURITY: Validate filePath exists and has reasonable length
    const filePath = parsedInput.filePath;
    if (!filePath || typeof filePath !== 'string' || filePath.length > 5000) {
      return {};
    }

    // Run validation (results logged, cannot block)
    const result = await runValidationWithTimeout({ filePath });

    // Transform to Cursor format (logs to stderr if validation failed)
    return cursorAdapter.transformResult('afterFileEdit', result);
  } catch (err) {
    // Log error but continue - this hook is informational only
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

  const result = await handleAfterFileEdit(input);
  console.log(JSON.stringify(result));
}

main().catch(err => {
  if (process.env.DEBUG) {
    console.error(`[cursor/after-file-edit] Fatal: ${err.message}`);
  }
  console.log(JSON.stringify({}));
  process.exit(1);
});
