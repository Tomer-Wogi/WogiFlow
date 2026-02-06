#!/usr/bin/env node

/**
 * Wogi Flow - Session End (Core Module)
 *
 * CLI-agnostic session end logic.
 * Called when a session ends.
 *
 * Handles:
 * - Checking for uncommitted work
 * - Auto-logging status
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const { execSync } = require('child_process');
const { getConfig, PATHS } = require('../../flow-utils');

/**
 * Check if auto-logging is enabled
 * @returns {boolean}
 */
function isAutoLoggingEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.autoLogging?.enabled !== false;
}

/**
 * Get uncommitted file count
 * @returns {number}
 */
function getUncommittedCount() {
  try {
    const output = execSync('git status --porcelain', {
      cwd: PATHS.root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim().split('\n').filter(line => line.trim()).length;
  } catch (err) {
    return 0;
  }
}

/**
 * Handle session end event
 * @param {Object} input - Parsed hook input
 * @returns {Object} Core result
 */
function handleSessionEnd(input) {
  const result = {
    logged: false,
    warning: null
  };

  try {
    // Check for uncommitted work
    const uncommitted = getUncommittedCount();
    if (uncommitted > 0) {
      result.warning = `${uncommitted} uncommitted file${uncommitted !== 1 ? 's' : ''}. Consider committing before ending session.`;
    }

    // Auto-logging would go here but requires more session context
    // For now, just warn about uncommitted work
    if (isAutoLoggingEnabled()) {
      // Could integrate with flow-session-end.js in the future
      result.logged = false;
    }
  } catch (err) {
    result.warning = `Session end handler error: ${err.message}`;
  }

  return result;
}

module.exports = { handleSessionEnd, isAutoLoggingEnabled, getUncommittedCount };
