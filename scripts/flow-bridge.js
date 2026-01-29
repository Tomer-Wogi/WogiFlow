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
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      status: 'full',
      folder: '.gemini',
      rulesFile: 'GEMINI.md'
    },
    {
      id: 'cursor',
      name: 'Cursor',
      status: 'full',
      folder: '.cursor',
      rulesFile: '.cursor/rules/wogi-flow.mdc'
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      status: 'full',
      folder: '.opencode',
      rulesFile: '.opencode/agents.md'
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      status: 'soft',
      folder: '.codex',
      rulesFile: 'AGENTS.md'
    },
    {
      id: 'kimi',
      name: 'Kimi CLI',
      status: 'soft',
      folder: '.kimi',
      rulesFile: 'KIMI.md'
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
 * Normalize CLI type argument to standard format
 */
function normalizeCliType(input) {
  if (!input) return null;
  const normalized = input.toLowerCase().trim();
  const aliases = {
    'gemini': 'gemini-cli',
    'gemini-cli': 'gemini-cli',
    'claude': 'claude-code',
    'claude-code': 'claude-code',
    'opencode': 'opencode',
    'cursor': 'cursor',
    'codex': 'codex',
    'kimi': 'kimi'
  };
  return aliases[normalized] || null;
}

/**
 * Sync bridge
 */
async function syncBridge(options = {}) {
  const verbose = options.verbose || process.argv.includes('--verbose') || process.argv.includes('-v');
  const force = options.force || process.argv.includes('--force') || process.argv.includes('-f');

  // Check for CLI type argument (e.g., "flow bridge sync gemini")
  const cliTypeArg = process.argv[3];
  const requestedCliType = normalizeCliType(cliTypeArg);

  if (cliTypeArg && !requestedCliType) {
    console.error(`${colors.red}Error:${colors.reset} Unknown CLI type: ${cliTypeArg}`);
    console.error('Available types: claude-code, gemini-cli, cursor, opencode, codex, kimi');
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
    console.log('Usage: flow bridge [sync|status|list] [cli-type]');
    console.log('');
    console.log('Commands:');
    console.log('  sync [cli-type]  Sync .workflow/ config to CLI-specific folder');
    console.log('  status           Show current bridge configuration');
    console.log('  list             List available CLI bridges');
    console.log('');
    console.log('Options:');
    console.log('  --force, -f      Overwrite locally modified rules files (CLAUDE.md, GEMINI.md, etc.)');
    console.log('  --verbose, -v    Show detailed output');
    console.log('');
    console.log('CLI Types:');
    console.log('  claude-code, gemini-cli (or gemini), cursor, opencode, codex, kimi');
    console.log('');
    console.log('Examples:');
    console.log('  flow bridge sync           # Sync default CLI from config');
    console.log('  flow bridge sync gemini    # Sync Gemini CLI specifically');
    console.log('  flow bridge sync --force   # Force overwrite even if locally modified');
    process.exit(1);
}
