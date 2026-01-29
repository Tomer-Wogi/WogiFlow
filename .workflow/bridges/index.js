/**
 * CLI Bridges - Entry Point
 *
 * Provides a unified interface for loading and using CLI bridges.
 * Only Claude Code is supported.
 *
 * Usage:
 *   const { getBridge, syncBridge } = require('./.workflow/bridges');
 *
 *   // Get the bridge for Claude Code
 *   const bridge = getBridge();
 *
 *   // Sync files from .workflow/ to CLAUDE.md
 *   await syncBridge();
 */

const path = require('path');

// Claude Code is the only supported CLI
const ClaudeBridge = require('./claude-bridge');

/**
 * Get CLI type - always returns 'claude-code'
 * @returns {string} CLI type
 */
function getCliType() {
  return 'claude-code';
}

/**
 * Detect which CLI is currently running - always returns 'claude-code'
 * @returns {string} CLI type
 */
function detectRunningCli() {
  return 'claude-code';
}

/**
 * Get the bridge instance for Claude Code
 * @param {Object} options - Options to pass to bridge constructor
 * @param {string} options.projectDir - Project root directory
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {ClaudeBridge} Bridge instance
 */
function getBridge(options = {}) {
  const projectDir = options.projectDir || process.cwd();

  return new ClaudeBridge({
    projectDir,
    verbose: options.verbose || false
  });
}

/**
 * Sync the Claude Code bridge
 * @param {Object} options - Options
 * @returns {Object} Sync result
 */
async function syncBridge(options = {}) {
  const bridge = getBridge(options);
  // Pass through sync options (e.g., force: true to overwrite locally modified files)
  return await bridge.sync({ force: options.force });
}

/**
 * List available bridge types
 * @returns {string[]} Array of available CLI types (only claude-code)
 */
function listAvailableBridges() {
  return ['claude-code'];
}

/**
 * Check if a bridge is available for the given CLI type
 * @param {string} cliType - CLI type to check
 * @returns {boolean}
 */
function isBridgeAvailable(cliType) {
  return cliType === 'claude-code';
}

module.exports = {
  getBridge,
  syncBridge,
  getCliType,
  detectRunningCli,
  listAvailableBridges,
  isBridgeAvailable,
  BaseBridge: require('./base-bridge')
};
