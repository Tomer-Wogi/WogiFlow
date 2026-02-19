#!/usr/bin/env node

/**
 * Wogi Flow - Hook Constants
 *
 * Shared constants used across hook modules to ensure consistency.
 */

/**
 * Tools that modify files - used for gating and validation
 */
const WRITE_TOOLS = [
  'Edit',
  'Write'
];

/**
 * Error codes for typed error handling
 */
const ERROR_CODES = {
  TASK_NOT_STARTED: 'WOGIFLOW_TASK_NOT_STARTED',
  BLOCKED: 'WOGIFLOW_BLOCKED',
  SCOPE_VIOLATION: 'WOGIFLOW_SCOPE_VIOLATION',
  COMPONENT_REUSE: 'WOGIFLOW_COMPONENT_REUSE',
  STRICT_ADHERENCE: 'WOGIFLOW_STRICT_ADHERENCE'
};

/**
 * Create a blocking error with proper code for typed error handling
 * @param {string} message - Error message
 * @param {string} code - Error code from ERROR_CODES
 * @returns {Error}
 */
function createBlockingError(message, code) {
  const err = new Error(message);
  err.code = code;
  err.name = 'BlockingError';
  return err;
}

/**
 * Check if an error is a blocking error (should be re-thrown)
 * @param {Error} err - Error to check
 * @returns {boolean}
 */
function isBlockingError(err) {
  // Check for typed error codes first (preferred)
  if (err.code && Object.values(ERROR_CODES).includes(err.code)) {
    return true;
  }
  if (err.name === 'BlockingError') {
    return true;
  }
  // Fallback to string matching for backwards compatibility
  const blockingPatterns = [
    '/wogi-start',
    'Task not started',
    'Strict adherence',
    'blocked by'
  ];
  return blockingPatterns.some(p => err.message.includes(p));
}

module.exports = {
  WRITE_TOOLS,
  ERROR_CODES,
  createBlockingError,
  isBlockingError
};
