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
      status: 'implemented',
      folder: '.claude',
      rulesFile: 'CLAUDE.md'
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      status: 'planned',
      folder: '.gemini',
      rulesFile: 'GEMINI.md'
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      status: 'planned',
      folder: '.opencode',
      rulesFile: 'OPENCODE.md'
    },
    {
      id: 'other',
      name: 'Other / Manual',
      status: 'manual',
      folder: 'N/A',
      rulesFile: 'N/A'
    }
  ];

  const currentCli = getCliType();

  for (const bridge of availableBridges) {
    const isCurrent = bridge.id === currentCli;
    const statusColor = bridge.status === 'implemented' ? colors.green :
                        bridge.status === 'planned' ? colors.yellow : colors.cyan;
    const indicator = isCurrent ? `${colors.green}→${colors.reset}` : ' ';

    console.log(`  ${indicator} ${colors.bold}${bridge.name}${colors.reset} (${bridge.id})`);
    console.log(`      Status: ${statusColor}${bridge.status}${colors.reset}`);
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
  const bridgeConfig = config.cli?.bridge || {};

  console.log(`${colors.bold}CLI Bridge Status${colors.reset}`);
  console.log('');
  console.log(`  CLI Type:        ${colors.cyan}${cliType}${colors.reset}`);
  console.log(`  Auto Sync:       ${bridgeConfig.autoSync ? colors.green + 'enabled' : colors.yellow + 'disabled'}${colors.reset}`);
  console.log(`  Sync on Change:  ${bridgeConfig.syncOnConfigChange ? colors.green + 'enabled' : colors.yellow + 'disabled'}${colors.reset}`);
  console.log('');

  // Check if bridge file exists
  const bridgePath = path.join(BRIDGES_DIR, `${cliType.replace('-', '-')}-bridge.js`);
  const bridgeFileMap = {
    'claude-code': 'claude-bridge.js',
    'gemini-cli': 'gemini-bridge.js',
    'opencode': 'opencode-bridge.js'
  };

  const bridgeFile = bridgeFileMap[cliType];
  if (bridgeFile) {
    const bridgeExists = fs.existsSync(path.join(BRIDGES_DIR, bridgeFile));
    console.log(`  Bridge File:     ${bridgeExists ? colors.green + '✓ ' + bridgeFile : colors.yellow + '○ not implemented'}${colors.reset}`);
  }

  // Check CLI folder status
  const cliFolders = {
    'claude-code': '.claude',
    'gemini-cli': '.gemini',
    'opencode': '.opencode'
  };

  const cliFolder = cliFolders[cliType];
  if (cliFolder) {
    const folderExists = fs.existsSync(path.join(PROJECT_ROOT, cliFolder));
    console.log(`  CLI Folder:      ${folderExists ? colors.green + '✓ ' + cliFolder + '/' : colors.yellow + '○ ' + cliFolder + '/ (not created)'}${colors.reset}`);
  }

  console.log('');
}

/**
 * Sync bridge
 */
async function syncBridge(options = {}) {
  const verbose = options.verbose || process.argv.includes('--verbose') || process.argv.includes('-v');

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

    const result = await bridges.syncBridge({ verbose, projectDir: PROJECT_ROOT });

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
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset} ${error.message}`);
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
    console.log('Usage: flow bridge [sync|status|list]');
    console.log('');
    console.log('Commands:');
    console.log('  sync    Sync .workflow/ config to CLI-specific folder');
    console.log('  status  Show current bridge configuration');
    console.log('  list    List available CLI bridges');
    process.exit(1);
}
