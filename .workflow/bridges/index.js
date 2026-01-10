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

// Lazy-load bridges to avoid circular dependencies
let bridges = null;

/**
 * Load available bridge implementations
 */
function loadBridges() {
  if (bridges) return bridges;

  bridges = {
    'claude-code': () => require('./claude-bridge'),
    // Add more bridges as they are implemented
    // 'gemini-cli': () => require('./gemini-bridge'),
    // 'opencode': () => require('./opencode-bridge'),
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
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config.cli?.type || 'claude-code';
  } catch {
    return 'claude-code';
  }
}

/**
 * Get the bridge instance for the current CLI type
 * @param {Object} options - Options to pass to bridge constructor
 * @param {string} options.projectDir - Project root directory
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {BaseBridge} Bridge instance
 */
function getBridge(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const cliType = getCliType(projectDir);

  loadBridges();

  const BridgeLoader = bridges[cliType];
  if (!BridgeLoader) {
    // If no specific bridge exists, return null (manual mode)
    console.warn(`No bridge available for CLI type: ${cliType}`);
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
 * @returns {Object} Sync result
 */
async function syncBridge(options = {}) {
  const bridge = getBridge(options);

  if (!bridge) {
    return {
      success: false,
      error: 'No bridge available for current CLI type',
      cliType: getCliType(options.projectDir)
    };
  }

  return await bridge.sync();
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
  listAvailableBridges,
  isBridgeAvailable,
  BaseBridge: require('./base-bridge')
};
