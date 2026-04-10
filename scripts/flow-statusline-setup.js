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

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline/promises');
const { colors, printHeader, safeJsonParse } = require('./flow-utils');
const { success, error: errorMsg } = require('./flow-output');

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
    description: 'Full info including skill and worktree',
    format: '{{#if workspace.git_worktree}}[WT] {{/if}}{{#if task}}[{{task.id}}] {{task.title}} | {{/if}}{{model}} | {{context_window.used_percentage}}% used{{#if skill}} | {{skill}}{{/if}}'
  }
};

// Default refresh interval (seconds) — re-runs status line every N seconds
// so live values like task.id, context_window, and skill stay current.
// Available in Claude Code 2.1.97+. 0 disables auto-refresh.
const DEFAULT_REFRESH_INTERVAL = 5;
const MAX_REFRESH_INTERVAL = 3600;

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
    errorMsg(`Could not save Claude settings: ${err.message}`);
    return false;
  }
}

/**
 * Parse and validate a refresh interval string.
 * Returns the integer value, or null if invalid.
 * Accepts 0 (disable) through MAX_REFRESH_INTERVAL.
 */
function parseRefreshInterval(arg) {
  if (arg === undefined || arg === null || arg === '') return null;
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 0 || n > MAX_REFRESH_INTERVAL) return null;
  return n;
}

/**
 * Build a statusLine config that preserves any existing fields the caller
 * isn't explicitly overriding. This prevents `--format X` from wiping out
 * a user's previously-configured refreshInterval (and vice versa).
 *
 * `refreshInterval` semantics:
 *   - undefined → don't touch existing value
 *   - 0         → delete the field (disable auto-refresh)
 *   - N > 0     → set to N seconds
 */
function buildStatusLine(existing, { format, refreshInterval } = {}) {
  const next = { ...(existing || {}), enabled: true };
  if (format !== undefined) next.format = format;
  if (refreshInterval !== undefined) {
    if (refreshInterval === 0) {
      delete next.refreshInterval;
    } else {
      next.refreshInterval = refreshInterval;
    }
  }
  return next;
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
    if (statusLine.refreshInterval) {
      console.log(`${colors.dim}Refresh:${colors.reset} every ${statusLine.refreshInterval}s ${colors.dim}(Claude Code 2.1.97+)${colors.reset}`);
    } else {
      console.log(`${colors.dim}Refresh:${colors.reset} ${colors.yellow}off${colors.reset} ${colors.dim}(updates on prompt only)${colors.reset}`);
    }
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

  const question = (q) => rl.question(q);

  printHeader('Status Line Setup');
  showCurrentConfig();
  showFormats();

  const format = await question(`\nChoose format (minimal/compact/standard/detailed) [standard]: `);
  const selectedFormat = format.trim() || 'standard';

  if (!FORMATS[selectedFormat]) {
    errorMsg(`Invalid format: ${selectedFormat}`);
    rl.close();
    process.exit(1);
  }

  const refreshAnswer = await question(
    `\nAuto-refresh interval in seconds (0 = off, blank = ${DEFAULT_REFRESH_INTERVAL}, requires Claude Code 2.1.97+): `
  );
  let refreshInterval;
  if (refreshAnswer.trim() === '') {
    refreshInterval = DEFAULT_REFRESH_INTERVAL;
  } else {
    refreshInterval = parseRefreshInterval(refreshAnswer.trim());
    if (refreshInterval === null) {
      errorMsg(`Refresh interval must be an integer between 0 and ${MAX_REFRESH_INTERVAL}`);
      rl.close();
      process.exit(1);
    }
  }

  const settings = loadClaudeSettings();
  settings.statusLine = buildStatusLine(settings.statusLine, {
    format: FORMATS[selectedFormat].format,
    refreshInterval
  });

  const refreshLabel = refreshInterval === 0 ? 'no auto-refresh' : `refresh every ${refreshInterval}s`;
  const confirm = await question(`\nApply "${FORMATS[selectedFormat].name}" format with ${refreshLabel}? (y/N): `);

  if (confirm.toLowerCase() === 'y') {
    if (saveClaudeSettings(settings)) {
      console.log('');
      success('Status line configured successfully!');
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
  flow statusline-setup                    Interactive setup
  flow statusline-setup --format X         Set format directly
  flow statusline-setup --refresh-interval N
                                           Set auto-refresh interval (seconds, 0 to disable)
  flow statusline-setup --show             Show current config
  flow statusline-setup --disable          Disable status line
  flow statusline-setup --formats          List available formats

Formats:
  minimal   - Model + context %
  compact   - Task ID + model + context %
  standard  - Task ID + model + labeled context (recommended)
  detailed  - Worktree + task + model + context % + skill

Refresh interval (Claude Code 2.1.97+):
  Re-runs the status line every N seconds so live values like task ID,
  context %, and active skill stay current between prompts.
  Default when configured via this tool: ${DEFAULT_REFRESH_INTERVAL}s. Range: 0–${MAX_REFRESH_INTERVAL}.
  0 disables auto-refresh (status line only updates on prompt).

Examples:
  flow statusline-setup --format standard
  flow statusline-setup --format detailed --refresh-interval 5
  flow statusline-setup --refresh-interval 10
  flow statusline-setup --refresh-interval 0
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
    settings.statusLine = { ...(settings.statusLine || {}), enabled: false };
    if (saveClaudeSettings(settings)) {
      success('Status line disabled.');
    }
    process.exit(0);
  }

  // Parse --refresh-interval (may be combined with --format, or used alone)
  const refreshIndex = args.indexOf('--refresh-interval');
  let cliRefreshInterval;
  if (refreshIndex >= 0) {
    const refreshArg = args[refreshIndex + 1];
    if (refreshArg === undefined || refreshArg.startsWith('--')) {
      errorMsg('--refresh-interval requires a value (integer between 0 and ' + MAX_REFRESH_INTERVAL + ')');
      process.exit(1);
    }
    cliRefreshInterval = parseRefreshInterval(refreshArg);
    if (cliRefreshInterval === null) {
      errorMsg(`--refresh-interval must be an integer between 0 and ${MAX_REFRESH_INTERVAL}`);
      process.exit(1);
    }
  }

  const formatIndex = args.indexOf('--format');
  if (formatIndex >= 0) {
    const format = args[formatIndex + 1];
    if (!format || !FORMATS[format]) {
      errorMsg('Invalid format. Use: minimal, compact, standard, or detailed');
      process.exit(1);
    }

    const settings = loadClaudeSettings();
    settings.statusLine = buildStatusLine(settings.statusLine, {
      format: FORMATS[format].format,
      refreshInterval: cliRefreshInterval
    });

    if (saveClaudeSettings(settings)) {
      let refreshNote;
      if (cliRefreshInterval !== undefined) {
        refreshNote = cliRefreshInterval === 0 ? ' (auto-refresh off)' : ` (refresh every ${cliRefreshInterval}s)`;
      } else if (settings.statusLine.refreshInterval) {
        refreshNote = ` (refresh every ${settings.statusLine.refreshInterval}s preserved)`;
      } else {
        refreshNote = '';
      }
      success(`Status line configured with "${format}" format${refreshNote}.`);
      console.log(`${colors.dim}Restart Claude Code to see changes.${colors.reset}`);
    }
    process.exit(0);
  }

  // Standalone --refresh-interval (no --format) — update only the interval
  if (cliRefreshInterval !== undefined) {
    const settings = loadClaudeSettings();
    if (!settings.statusLine || !settings.statusLine.format) {
      errorMsg('No status line is configured yet. Run with --format <name> first, or use interactive setup.');
      process.exit(1);
    }
    settings.statusLine = buildStatusLine(settings.statusLine, {
      refreshInterval: cliRefreshInterval
    });
    if (saveClaudeSettings(settings)) {
      success(
        cliRefreshInterval === 0
          ? 'Status line auto-refresh disabled.'
          : `Status line refresh interval set to ${cliRefreshInterval}s.`
      );
      console.log(`${colors.dim}Requires Claude Code 2.1.97+. Restart Claude Code to see changes.${colors.reset}`);
    }
    process.exit(0);
  }

  // Default: interactive mode
  await interactiveSetup();
}

main().catch(err => {
  errorMsg(err.message);
  process.exit(1);
});
