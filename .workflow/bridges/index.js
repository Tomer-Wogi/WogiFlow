/**
 * CLI Bridges - Entry Point
 *
 * Provides a unified interface for loading and using CLI bridges.
 *
 * Usage:
 *   const { getBridge, syncBridge } = require('./.workflow/bridges');
 *
 *   // Get the bridge for current CLI type
 *   const bridge = getBridge();
 *
 *   // Sync files from .workflow/ to CLI-specific folder
 *   await syncBridge();
 */

const fs = require('fs');
const path = require('path');

// Import canonical safeJsonParseString from flow-utils (consolidated per code review)
const { safeJsonParseString } = require('../../scripts/flow-utils');

// Lazy-load bridges to avoid circular dependencies
let bridges = null;

/**
 * Load available bridge implementations
 */
function loadBridges() {
  if (bridges) return bridges;

  bridges = {
    'claude-code': () => require('./claude-bridge'),
    'gemini-cli': () => require('./gemini-bridge'),
    'codex': () => require('./codex-bridge'),
    'opencode': () => require('./opencode-bridge'),
    'cursor': () => require('./cursor-bridge'),
    'kimi': () => require('./kimi-bridge'),
  };

  return bridges;
}

/**
 * Read CLI type from config
 * @param {string} projectDir - Project root directory
 * @returns {string} CLI type (defaults to 'claude-code')
 */
function getCliType(projectDir = process.cwd()) {
  const configPath = path.join(projectDir, '.workflow', 'config.json');

  if (!fs.existsSync(configPath)) {
    return 'claude-code'; // Default
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = safeJsonParseString(configContent, {});
    return config.cli?.type || 'claude-code';
  } catch {
    return 'claude-code';
  }
}

/**
 * Detect which CLI is currently running based on environment
 * @param {string} projectDir - Project root directory
 * @returns {string} Detected CLI type
 */
function detectRunningCli(projectDir = process.cwd()) {
  // Priority 1: Environment variables set by CLI tools
  if (process.env.CLAUDE_CODE_ENTRY_POINT) return 'claude-code';
  if (process.env.CURSOR_SESSION_ID) return 'cursor';
  if (process.env.OPENCODE_SESSION) return 'opencode';

  // Priority 2: Check caller stack for hook path hints
  try {
    const stack = new Error().stack || '';
    if (stack.includes('/claude-code/')) return 'claude-code';
    if (stack.includes('/gemini-cli/')) return 'gemini-cli';
    if (stack.includes('/cursor/')) return 'cursor';
    if (stack.includes('/opencode/')) return 'opencode';
  } catch {
    // Ignore stack parsing errors
  }

  // Priority 3: Config file setting
  return getCliType(projectDir);
}

/**
 * Get the bridge instance for the current CLI type
 * @param {Object} options - Options to pass to bridge constructor
 * @param {string} options.projectDir - Project root directory
 * @param {string} options.cliType - Override CLI type (optional)
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {BaseBridge} Bridge instance
 */
function getBridge(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  // Allow explicit CLI type override, otherwise detect from config
  const cliType = options.cliType || getCliType(projectDir);

  loadBridges();

  const BridgeLoader = bridges[cliType];
  if (!BridgeLoader) {
    // If no specific bridge exists, return null (manual mode)
    if (options.verbose) {
      console.warn(`No bridge available for CLI type: ${cliType}`);
    }
    return null;
  }

  const BridgeClass = BridgeLoader();
  return new BridgeClass({
    projectDir,
    verbose: options.verbose || false
  });
}

/**
 * Sync the current CLI bridge
 * @param {Object} options - Options
 * @param {string} options.cliType - Override CLI type (optional)
 * @returns {Object} Sync result
 */
async function syncBridge(options = {}) {
  const bridge = getBridge(options);
  const cliType = options.cliType || getCliType(options.projectDir);

  if (!bridge) {
    return {
      success: false,
      error: 'No bridge available for current CLI type',
      cliType
    };
  }

  // Pass through sync options (e.g., force: true to overwrite locally modified files)
  return await bridge.sync({ force: options.force });
}

/**
 * List available bridge types
 * @returns {string[]} Array of available CLI types
 */
function listAvailableBridges() {
  loadBridges();
  return Object.keys(bridges);
}

/**
 * Check if a bridge is available for the given CLI type
 * @param {string} cliType - CLI type to check
 * @returns {boolean}
 */
function isBridgeAvailable(cliType) {
  loadBridges();
  return cliType in bridges;
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
