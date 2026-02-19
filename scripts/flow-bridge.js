#!/usr/bin/env node

/**
 * flow-bridge.js - CLI Bridge Management
 *
 * Commands:
 *   flow bridge sync     - Sync .workflow/ to CLI-specific folder
 *   flow bridge status   - Show current bridge configuration
 *   flow bridge list     - List available CLI bridges
 */

const fs = require('fs');
const path = require('path');

// Colors
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

const PROJECT_ROOT = process.cwd();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const BRIDGES_DIR = path.join(WORKFLOW_DIR, 'bridges');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');

/**
 * Read config file
 */
function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`${colors.red}Error:${colors.reset} Config not found. Run 'flow install' first.`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset} Invalid JSON in config.json: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Get CLI type from config
 */
function getCliType() {
  const config = getConfig();
  return config.cli?.type || 'claude-code';
}

/**
 * List available bridges
 */
function listBridges() {
  console.log(`${colors.bold}Available CLI Bridges:${colors.reset}`);
  console.log('');

  const availableBridges = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'full',
      folder: '.claude',
      rulesFile: 'CLAUDE.md'
    }
  ];

  const currentCli = getCliType();

  for (const bridge of availableBridges) {
    const isCurrent = bridge.id === currentCli;
    const statusColor = bridge.status === 'full' ? colors.green :
                        bridge.status === 'soft' ? colors.yellow : colors.cyan;
    const statusLabel = bridge.status === 'full' ? 'full parity (hooks)' :
                        bridge.status === 'soft' ? 'soft parity (rules only)' : bridge.status;
    const indicator = isCurrent ? `${colors.green}→${colors.reset}` : ' ';

    console.log(`  ${indicator} ${colors.bold}${bridge.name}${colors.reset} (${bridge.id})`);
    console.log(`      Status: ${statusColor}${statusLabel}${colors.reset}`);
    console.log(`      Folder: ${bridge.folder}`);
    console.log(`      Rules:  ${bridge.rulesFile}`);
    console.log('');
  }
}

/**
 * Show bridge status
 */
function showStatus() {
  const config = getConfig();
  const cliType = config.cli?.type || 'claude-code';
  const autoSyncConfig = config.cli?.autoSync || {};

  console.log(`${colors.bold}CLI Bridge Status${colors.reset}`);
  console.log('');
  console.log(`  CLI Type:        ${colors.cyan}${cliType}${colors.reset}`);
  console.log(`  Auto Sync:       ${autoSyncConfig.enabled ? colors.green + 'enabled' : colors.yellow + 'disabled'}${colors.reset}`);
  console.log(`  Sync on Start:   ${autoSyncConfig.onSessionStart ? colors.green + 'enabled' : colors.yellow + 'disabled'}${colors.reset}`);
  console.log('');

  // Check bridge file (Claude Code only)
  const bridgeFile = 'claude-bridge.js';
  const bridgeExists = fs.existsSync(path.join(BRIDGES_DIR, bridgeFile));
  console.log(`  Bridge File:     ${bridgeExists ? colors.green + '✓ ' + bridgeFile : colors.yellow + '○ not found'}${colors.reset}`);

  // Check CLI folder status
  const cliFolder = '.claude';
  const folderExists = fs.existsSync(path.join(PROJECT_ROOT, cliFolder));
  console.log(`  CLI Folder:      ${folderExists ? colors.green + '✓ ' + cliFolder + '/' : colors.yellow + '○ ' + cliFolder + '/ (not created)'}${colors.reset}`);

  console.log('');
}

/**
 * Normalize CLI type argument to standard format
 */
function normalizeCliType(input) {
  if (!input) return null;
  const normalized = input.toLowerCase().trim();
  // Only Claude Code is supported
  if (normalized === 'claude' || normalized === 'claude-code') {
    return 'claude-code';
  }
  return null;
}

/**
 * Sync bridge
 */
async function syncBridge(options = {}) {
  const verbose = options.verbose || process.argv.includes('--verbose') || process.argv.includes('-v');
  const force = options.force || process.argv.includes('--force') || process.argv.includes('-f');

  // Check for CLI type argument (e.g., "flow bridge sync claude-code")
  // Skip flags (--force, -f, --verbose, -v) when looking for CLI type
  const cliTypeArg = process.argv.slice(3).find(arg => !arg.startsWith('-'));
  const requestedCliType = cliTypeArg ? normalizeCliType(cliTypeArg) : null;

  if (cliTypeArg && !requestedCliType) {
    console.error(`${colors.red}Error:${colors.reset} Unknown CLI type: ${cliTypeArg}`);
    console.error('Only claude-code is supported.');
    process.exit(1);
  }

  const targetCliType = requestedCliType || getCliType();

  console.log(`${colors.cyan}Syncing CLI bridge...${colors.reset}`);
  console.log('');

  try {
    // Try to load the bridges module
    let bridges;
    try {
      bridges = require(path.join(BRIDGES_DIR, 'index.js'));
    } catch (err) {
      console.error(`${colors.red}Error:${colors.reset} Bridges module not found.`);
      console.error('Make sure .workflow/bridges/index.js exists.');
      process.exit(1);
    }

    const result = await bridges.syncBridge({
      verbose,
      force,
      projectDir: PROJECT_ROOT,
      cliType: targetCliType
    });

    if (result.success) {
      console.log(`${colors.green}✓ Bridge sync complete${colors.reset}`);
      console.log('');
      console.log(`  CLI Type: ${result.cliType}`);
      console.log(`  Folder:   ${result.cliFolder}`);
      console.log(`  Synced:   ${result.synced.join(', ')}`);
      console.log(`  Duration: ${result.duration}ms`);
    } else {
      console.log(`${colors.yellow}⚠ Bridge sync completed with issues${colors.reset}`);
      console.log('');
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      if (result.errors && result.errors.length > 0) {
        for (const err of result.errors) {
          console.log(`  ${colors.yellow}○${colors.reset} ${err.step}: ${err.error}`);
        }
      }
    }
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset} ${err.message}`);
    process.exit(1);
  }

  console.log('');
}

// Main
const command = process.argv[2] || 'status';

switch (command) {
  case 'sync':
    syncBridge();
    break;
  case 'status':
    showStatus();
    break;
  case 'list':
    listBridges();
    break;
  default:
    console.log('Usage: flow bridge [sync|status|list] [cli-type]');
    console.log('');
    console.log('Commands:');
    console.log('  sync             Sync .workflow/ config to CLAUDE.md');
    console.log('  status           Show current bridge configuration');
    console.log('  list             List available CLI bridges');
    console.log('');
    console.log('Options:');
    console.log('  --force, -f      Overwrite locally modified CLAUDE.md');
    console.log('  --verbose, -v    Show detailed output');
    console.log('');
    console.log('Note: Only Claude Code is supported.');
    console.log('');
    console.log('Examples:');
    console.log('  flow bridge sync           # Sync Claude Code bridge');
    console.log('  flow bridge sync --force   # Force overwrite even if locally modified');
    process.exit(1);
}
