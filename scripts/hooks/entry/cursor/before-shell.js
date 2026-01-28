#!/usr/bin/env node

/**
 * Wogi Flow - Cursor beforeShellExecution Hook Entry Point
 *
 * Enforces strict adherence for shell commands.
 * Validates package manager usage, port numbers, etc.
 *
 * Output format:
 * - { permission: "deny", userMessage: "...", agentMessage: "..." } to block
 * - { permission: "allow" } to allow
 */

const { cursorAdapter } = require('../../adapters/cursor');

// Maximum stdin size (100KB)
const MAX_STDIN_SIZE = 100 * 1024;

// Lazy-load strict adherence to avoid circular deps and startup cost
let _strictAdherence = null;
function getStrictAdherence() {
  if (!_strictAdherence) {
    try {
      _strictAdherence = require('../../../flow-strict-adherence');
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND' && process.env.DEBUG) {
        console.error(`[before-shell] Failed to load strict adherence: ${err.message}`);
      }
      _strictAdherence = { isEnabled: () => false, validateCommand: () => ({ valid: true }) };
    }
  }
  return _strictAdherence;
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
 * Handle beforeShellExecution event
 */
async function handleBeforeShellExecution(input) {
  try {
    const parsedInput = cursorAdapter.parseInput(input);

    // SECURITY: Validate command exists and has reasonable length
    if (!parsedInput.command || typeof parsedInput.command !== 'string') {
      return { permission: 'allow' };
    }

    // Check strict adherence rules
    const strictAdherence = getStrictAdherence();

    if (!strictAdherence.isEnabled()) {
      return { permission: 'allow' };
    }

    const validationResult = strictAdherence.validateCommand(parsedInput.command, {
      cwd: parsedInput.cwd
    });

    // Guard against null/undefined validation result
    if (!validationResult || typeof validationResult.valid === 'undefined') {
      return { permission: 'allow' };
    }

    if (!validationResult.valid) {
      // Transform to Cursor format
      const coreResult = {
        blocked: true,
        message: validationResult.reason || 'Command blocked by strict adherence',
        agentMessage: validationResult.suggestion || validationResult.reason || 'This command violates project standards.'
      };
      return cursorAdapter.transformResult('beforeShellExecution', coreResult);
    }

    return { permission: 'allow' };
  } catch (err) {
    // On error, allow the command to continue (fail open for UX)
    if (process.env.DEBUG) {
      console.error(`[Wogi Flow Hook Error] ${err.message}`);
    }
    return { permission: 'allow' };
  }
}

// Cursor hooks receive JSON via stdin, output JSON to stdout
async function main() {
  const inputData = await readStdinWithLimit();

  let input = {};
  try {
    input = JSON.parse(inputData);
  } catch {
    // Invalid JSON - allow command (fail open)
    console.log(JSON.stringify({ permission: 'allow' }));
    return;
  }

  const result = await handleBeforeShellExecution(input);
  console.log(JSON.stringify(result));
}

main().catch(err => {
  if (process.env.DEBUG) {
    console.error(`[cursor/before-shell] Fatal: ${err.message}`);
  }
  // Fail open on fatal error
  console.log(JSON.stringify({ permission: 'allow' }));
  process.exit(1);
});
