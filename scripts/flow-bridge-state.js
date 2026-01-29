#!/usr/bin/env node

/**
 * Wogi Flow - Bridge State Tracker
 *
 * Tracks CLI bridge sync state and provides auto-sync functionality.
 * Enables seamless generation of CLI instruction files on session start.
 *
 * Usage:
 *   const { autoSyncBridge, needsSync } = require('./flow-bridge-state');
 *
 *   // Auto-sync on session start (non-blocking)
 *   await autoSyncBridge('claude-code', { silent: true });
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import canonical safeJsonParse from flow-utils (consolidated per code review)
const { safeJsonParse } = require('./flow-utils');

// Project paths
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');
const SYNC_STATE_PATH = path.join(STATE_DIR, 'bridge-sync.json');

// CLI type to output file mapping
const CLI_OUTPUT_FILES = {
  'claude-code': 'CLAUDE.md',
  'gemini-cli': 'GEMINI.md',
  'cursor': '.cursor/rules/wogi-flow.mdc',
  'opencode': '.opencode/agents.md',
  'codex': 'AGENTS.md',
  'kimi': 'AGENTS.md'  // Kimi also uses AGENTS.md
};

// CLI type to template file mapping
const CLI_TEMPLATES = {
  'claude-code': 'claude-md.hbs',
  'gemini-cli': 'gemini-md.hbs',
  'cursor': 'cursor-rules.mdc.hbs',
  'opencode': 'opencode-agents-md.hbs',
  'codex': 'codex-config.hbs',
  'kimi': 'kimi-agents-md.hbs'
};

/**
 * Calculate MD5 hash of config.json for staleness detection
 * @returns {string} Hash of config content
 */
function getConfigChecksum() {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Calculate MD5 hash of a template file
 * @param {string} cliType - CLI type
 * @returns {string} Hash of template content
 */
function getTemplateChecksum(cliType) {
  try {
    const templateName = CLI_TEMPLATES[cliType];
    if (!templateName) return '';

    const templatePath = path.join(WORKFLOW_DIR, 'templates', templateName);
    if (!fs.existsSync(templatePath)) return '';

    const content = fs.readFileSync(templatePath, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Get the output file path for a CLI type
 * @param {string} cliType - CLI type
 * @returns {string} Full path to output file
 */
function getOutputFilePath(cliType) {
  const filename = CLI_OUTPUT_FILES[cliType];
  if (!filename) return null;
  return path.join(PROJECT_ROOT, filename);
}

/**
 * Read current sync state
 * @returns {Object} Sync state
 */
function readSyncState() {
  return safeJsonParse(SYNC_STATE_PATH, { syncs: {}, version: 1 });
}

/**
 * Write sync state
 * @param {Object} state - State to write
 */
function writeSyncState(state) {
  try {
    // Ensure state directory exists
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[bridge-state] Failed to write sync state: ${err.message}`);
    }
  }
}

/**
 * Get last sync time for a CLI type
 * @param {string} cliType - CLI type
 * @returns {string|null} ISO timestamp or null
 */
function getLastSyncTime(cliType) {
  const state = readSyncState();
  return state.syncs?.[cliType]?.lastSync || null;
}

/**
 * Update sync time for a CLI type
 * @param {string} cliType - CLI type
 * @param {string} configHash - Current config hash
 * @param {string} templateHash - Current template hash
 */
function setLastSyncTime(cliType, configHash, templateHash = null) {
  const state = readSyncState();
  if (!state.syncs) state.syncs = {};

  state.syncs[cliType] = {
    lastSync: new Date().toISOString(),
    configHash,
    templateHash: templateHash || getTemplateChecksum(cliType)
  };

  // Also track last config hash at root level
  state.lastConfigHash = configHash;

  writeSyncState(state);
}

/**
 * Mark a CLI as synced (alias for setLastSyncTime with current hashes)
 * @param {string} cliType - CLI type that was synced
 */
function markSynced(cliType) {
  const configHash = getConfigChecksum();
  const templateHash = getTemplateChecksum(cliType);
  setLastSyncTime(cliType, configHash, templateHash);
}

/**
 * Check if a CLI bridge needs to be synced
 * @param {string} cliType - CLI type to check
 * @returns {Object} { needsSync: boolean, reason: string }
 */
function needsSync(cliType) {
  // Check if output file exists
  const outputPath = getOutputFilePath(cliType);
  if (!outputPath) {
    return { needsSync: false, reason: 'unknown-cli' };
  }

  if (!fs.existsSync(outputPath)) {
    return { needsSync: true, reason: 'file-missing' };
  }

  // Check if config has changed since last sync
  const state = readSyncState();
  const cliState = state.syncs?.[cliType];

  if (!cliState) {
    return { needsSync: true, reason: 'never-synced' };
  }

  const currentConfigHash = getConfigChecksum();
  if (cliState.configHash !== currentConfigHash) {
    return { needsSync: true, reason: 'config-changed' };
  }

  // Check if template has changed since last sync
  const currentTemplateHash = getTemplateChecksum(cliType);
  if (currentTemplateHash && cliState.templateHash !== currentTemplateHash) {
    return { needsSync: true, reason: 'template-changed' };
  }

  return { needsSync: false, reason: 'up-to-date' };
}

/**
 * Auto-sync a CLI bridge if needed
 * @param {string} cliType - CLI type to sync
 * @param {Object} options - Options
 * @param {boolean} options.silent - Suppress output
 * @param {boolean} options.force - Force sync even if up-to-date
 * @returns {Object} { synced: boolean, reason: string }
 */
async function autoSyncBridge(cliType, options = {}) {
  const { silent = false, force = false } = options;

  // Check if sync is needed
  if (!force) {
    const check = needsSync(cliType);
    if (!check.needsSync) {
      if (!silent && process.env.DEBUG) {
        console.error(`[bridge-state] ${cliType}: ${check.reason}, skipping sync`);
      }
      return { synced: false, reason: check.reason };
    }
  }

  // Load bridges module
  let bridges;
  try {
    bridges = require(path.join(PROJECT_ROOT, '.workflow', 'bridges'));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[bridge-state] Failed to load bridges: ${err.message}`);
    }
    return { synced: false, reason: 'bridges-unavailable', error: err.message };
  }

  // Get bridge for the specified CLI type
  let bridge;
  try {
    // Pass explicit cliType to override config default
    bridge = bridges.getBridge({
      projectDir: PROJECT_ROOT,
      cliType: cliType,
      verbose: !silent
    });

    // Fallback: Try loading the specific bridge directly
    if (!bridge) {
      const BridgeClass = require(path.join(PROJECT_ROOT, '.workflow', 'bridges', `${cliType}-bridge`));
      bridge = new BridgeClass({
        projectDir: PROJECT_ROOT,
        verbose: !silent
      });
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[bridge-state] Failed to get bridge for ${cliType}: ${err.message}`);
    }
    return { synced: false, reason: 'bridge-load-failed', error: err.message };
  }

  // Run sync
  try {
    await bridge.sync();

    // Update state with config and template hashes
    markSynced(cliType);

    if (!silent) {
      console.error(`[bridge-state] Synced ${cliType} bridge`);
    }

    return { synced: true, reason: 'success' };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[bridge-state] Sync failed for ${cliType}: ${err.message}`);
    }
    return { synced: false, reason: 'sync-failed', error: err.message };
  }
}

/**
 * Sync all enabled CLIs
 * @param {Object} options - Options
 * @returns {Object} Results for each CLI
 */
async function syncAllEnabledClis(options = {}) {
  const config = safeJsonParse(CONFIG_PATH, {});
  const primaryCli = config.cli?.type || 'claude-code';
  const enabledClis = config.cli?.enabled || [primaryCli];

  const results = {};
  for (const cliType of enabledClis) {
    results[cliType] = await autoSyncBridge(cliType, options);
  }

  return results;
}

/**
 * Check if config has changed since last sync of any CLI
 * @returns {boolean} True if config changed
 */
function hasConfigChanged() {
  const state = readSyncState();
  const currentHash = getConfigChecksum();
  return state.lastConfigHash !== currentHash;
}

/**
 * Get sync status for all known CLIs
 * @returns {Object} Status for each CLI
 */
function getSyncStatus() {
  const status = {};
  for (const cliType of Object.keys(CLI_OUTPUT_FILES)) {
    const check = needsSync(cliType);
    const outputPath = getOutputFilePath(cliType);
    const templateName = CLI_TEMPLATES[cliType];
    const templatePath = templateName ? path.join(WORKFLOW_DIR, 'templates', templateName) : null;

    status[cliType] = {
      ...check,
      outputExists: outputPath ? fs.existsSync(outputPath) : false,
      templateExists: templatePath ? fs.existsSync(templatePath) : false,
      outputPath,
      templatePath
    };
  }
  return status;
}

/**
 * Clear sync state (for debugging/reset)
 * @returns {void}
 */
function clearSyncState() {
  writeSyncState({ syncs: {}, version: 1 });
}

/**
 * Detect which CLI is currently running
 * Based on environment variables and caller context
 * @returns {string} CLI type
 */
function detectRunningCli() {
  // Priority 1: Environment variables
  if (process.env.CLAUDE_CODE_ENTRY_POINT) return 'claude-code';
  if (process.env.GEMINI_API_KEY && !process.env.CLAUDE_CODE_ENTRY_POINT) return 'gemini-cli';
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
  const config = safeJsonParse(CONFIG_PATH, {});
  if (config.cli?.type) return config.cli.type;

  // Default
  return 'claude-code';
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  const run = async () => {
    switch (command) {
      case 'check': {
        const cliType = args[1] || detectRunningCli();
        const result = needsSync(cliType);
        console.log(JSON.stringify({ cliType, ...result }, null, 2));
        break;
      }

      case 'sync': {
        const cliType = args[1] || detectRunningCli();
        const result = await autoSyncBridge(cliType, { silent: false, force: args.includes('--force') });
        console.log(JSON.stringify({ cliType, ...result }, null, 2));
        break;
      }

      case 'sync-all': {
        const results = await syncAllEnabledClis({ silent: false, force: args.includes('--force') });
        console.log(JSON.stringify(results, null, 2));
        break;
      }

      case 'detect': {
        const cliType = detectRunningCli();
        console.log(cliType);
        break;
      }

      case 'status': {
        const status = getSyncStatus();
        console.log(JSON.stringify(status, null, 2));
        break;
      }

      case 'clear': {
        clearSyncState();
        console.log('Sync state cleared');
        break;
      }

      default:
        console.log('Usage: flow-bridge-state <command> [options]');
        console.log('');
        console.log('Commands:');
        console.log('  check [cli-type]    Check if sync is needed');
        console.log('  sync [cli-type]     Sync a CLI bridge');
        console.log('  sync-all            Sync all enabled CLIs');
        console.log('  status              Show sync status for all CLIs');
        console.log('  detect              Detect running CLI type');
        console.log('  clear               Clear sync state (force refresh)');
        console.log('');
        console.log('Options:');
        console.log('  --force             Force sync even if up-to-date');
    }
  };

  run().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  // Core functions
  needsSync,
  autoSyncBridge,
  markSynced,

  // Multi-CLI support
  syncAllEnabledClis,
  getSyncStatus,

  // Config tracking
  getConfigChecksum,
  getTemplateChecksum,
  hasConfigChanged,

  // Utilities
  detectRunningCli,
  getLastSyncTime,
  setLastSyncTime,
  clearSyncState,

  // Constants
  CLI_OUTPUT_FILES,
  CLI_TEMPLATES
};
