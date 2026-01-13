#!/usr/bin/env node

/**
 * Wogi Flow - Status Line Setup
 *
 * Configures Claude Code's status line to show WogiFlow task information.
 * Uses the new context_window.used_percentage field from Claude Code v1.0.52+.
 *
 * Usage:
 *   flow statusline-setup           # Interactive setup
 *   flow statusline-setup --format compact
 *   flow statusline-setup --format detailed
 *   flow statusline-setup --show    # Show current config
 *   flow statusline-setup --disable # Disable status line
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { colors, printHeader, safeJsonParse } = require('./flow-utils');

// Status line format presets
const FORMATS = {
  minimal: {
    name: 'Minimal',
    description: 'Just model and context percentage',
    format: '{{model}} | {{context_window.used_percentage}}%'
  },
  compact: {
    name: 'Compact',
    description: 'Task ID + model + context',
    format: '{{#if task}}[{{task.id}}] {{/if}}{{model}} | {{context_window.used_percentage}}%'
  },
  standard: {
    name: 'Standard (Recommended)',
    description: 'Task + model + labeled context',
    format: '{{#if task}}[{{task.id}}] {{/if}}{{model}} | Ctx: {{context_window.used_percentage}}%'
  },
  detailed: {
    name: 'Detailed',
    description: 'Full info including skill',
    format: '{{#if task}}[{{task.id}}] {{task.title}} | {{/if}}{{model}} | {{context_window.used_percentage}}% used{{#if skill}} | {{skill}}{{/if}}'
  }
};

// Claude settings file location
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function loadClaudeSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    return {};
  }
  // Use safeJsonParse for prototype pollution protection
  return safeJsonParse(CLAUDE_SETTINGS_PATH, {});
}

function saveClaudeSettings(settings) {
  try {
    // Ensure directory exists
    const dir = path.dirname(CLAUDE_SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return true;
  } catch (err) {
    console.error(`${colors.red}Error: Could not save Claude settings: ${err.message}${colors.reset}`);
    return false;
  }
}

function showCurrentConfig() {
  const settings = loadClaudeSettings();
  const statusLine = settings.statusLine || {};

  printHeader('Current Status Line Configuration');

  if (!statusLine.enabled && statusLine.enabled !== undefined) {
    console.log(`${colors.dim}Status: ${colors.yellow}Disabled${colors.reset}`);
  } else if (statusLine.format) {
    console.log(`${colors.dim}Status: ${colors.green}Enabled${colors.reset}`);
    console.log(`${colors.dim}Format:${colors.reset} ${statusLine.format}`);
  } else {
    console.log(`${colors.dim}Status: ${colors.yellow}Not configured${colors.reset}`);
  }
  console.log('');
}

function showFormats() {
  console.log(`${colors.bold}Available Formats:${colors.reset}\n`);

  for (const [key, preset] of Object.entries(FORMATS)) {
    console.log(`  ${colors.cyan}${key}${colors.reset} - ${preset.name}`);
    console.log(`    ${colors.dim}${preset.description}${colors.reset}`);
    console.log(`    ${colors.dim}Preview: ${preset.format}${colors.reset}`);
    console.log('');
  }
}

async function interactiveSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  printHeader('Status Line Setup');
  showCurrentConfig();
  showFormats();

  const format = await question(`\nChoose format (minimal/compact/standard/detailed) [standard]: `);
  const selectedFormat = format.trim() || 'standard';

  if (!FORMATS[selectedFormat]) {
    console.log(`${colors.red}Invalid format: ${selectedFormat}${colors.reset}`);
    rl.close();
    process.exit(1);
  }

  const settings = loadClaudeSettings();
  settings.statusLine = {
    enabled: true,
    format: FORMATS[selectedFormat].format
  };

  const confirm = await question(`\nApply "${FORMATS[selectedFormat].name}" format? (y/N): `);

  if (confirm.toLowerCase() === 'y') {
    if (saveClaudeSettings(settings)) {
      console.log(`\n${colors.green}✓ Status line configured successfully!${colors.reset}`);
      console.log(`${colors.dim}Restart Claude Code to see changes.${colors.reset}`);
    }
  } else {
    console.log(`${colors.dim}Setup cancelled.${colors.reset}`);
  }

  rl.close();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Status Line Setup

Configure Claude Code's status line to show task and context info.

Usage:
  flow statusline-setup             Interactive setup
  flow statusline-setup --format X  Set format directly
  flow statusline-setup --show      Show current config
  flow statusline-setup --disable   Disable status line
  flow statusline-setup --formats   List available formats

Formats:
  minimal   - Model + context %
  compact   - Task ID + model + context %
  standard  - Task ID + model + labeled context (recommended)
  detailed  - Full info including skill name

Examples:
  flow statusline-setup --format standard
  flow statusline-setup --format detailed
`);
    process.exit(0);
  }

  if (args.includes('--show')) {
    showCurrentConfig();
    process.exit(0);
  }

  if (args.includes('--formats')) {
    showFormats();
    process.exit(0);
  }

  if (args.includes('--disable')) {
    const settings = loadClaudeSettings();
    settings.statusLine = { enabled: false };
    if (saveClaudeSettings(settings)) {
      console.log(`${colors.green}✓ Status line disabled.${colors.reset}`);
    }
    process.exit(0);
  }

  const formatIndex = args.indexOf('--format');
  if (formatIndex >= 0) {
    const format = args[formatIndex + 1];
    if (!format || !FORMATS[format]) {
      console.log(`${colors.red}Invalid format. Use: minimal, compact, standard, or detailed${colors.reset}`);
      process.exit(1);
    }

    const settings = loadClaudeSettings();
    settings.statusLine = {
      enabled: true,
      format: FORMATS[format].format
    };

    if (saveClaudeSettings(settings)) {
      console.log(`${colors.green}✓ Status line configured with "${format}" format.${colors.reset}`);
      console.log(`${colors.dim}Restart Claude Code to see changes.${colors.reset}`);
    }
    process.exit(0);
  }

  // Default: interactive mode
  await interactiveSetup();
}

main().catch(err => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
