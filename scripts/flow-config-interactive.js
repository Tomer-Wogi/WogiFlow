#!/usr/bin/env node

/**
 * flow-config-interactive.js
 *
 * Interactive configuration viewer for WogiFlow.
 * Shows the 15 most important options with descriptions,
 * current values, and simple toggle/set commands.
 *
 * Usage:
 *   flow config              # Show all important options
 *   flow config show         # Same as above
 *   flow config set <key> <value>  # Set a value (delegates to flow-config-set.js)
 *   flow config reset        # Reset to defaults
 *   flow config export       # Export current overrides as JSON
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  PATHS,
  getConfig,
  color,
  success,
  warn,
  error,
  parseFlags,
  outputJson,
  safeJsonParse
} = require('./flow-utils');

// ============================================================
// Top 15 User-Facing Config Options
// ============================================================

const IMPORTANT_OPTIONS = [
  {
    key: 'enforcement.taskGating.enabled',
    label: 'Task Gating',
    description: 'Require /wogi-start before any code changes',
    type: 'boolean',
    default: true
  },
  {
    key: 'enforcement.routingGate.enabled',
    label: 'Routing Gate',
    description: 'Enforce /wogi-* routing for all requests',
    type: 'boolean',
    default: true
  },
  {
    key: 'hooks.rules.validation.enabled',
    label: 'Auto-Validation',
    description: 'Run lint/typecheck after every file edit',
    type: 'boolean',
    default: true
  },
  {
    key: 'hooks.rules.phaseGate.enabled',
    label: 'Phase Gate',
    description: 'Track task phases (routing → exploring → coding → validating)',
    type: 'boolean',
    default: false
  },
  {
    key: 'testing.enabled',
    label: 'Testing',
    description: 'Enable test running as part of quality gates',
    type: 'boolean',
    default: false
  },
  {
    key: 'testing.generation.autoGenerate',
    label: 'Auto Test Generation',
    description: 'Generate test scaffolds from acceptance criteria',
    type: 'boolean',
    default: false
  },
  {
    key: 'communitySync.enabled',
    label: 'Community Sync',
    description: 'Share anonymous usage patterns with the community',
    type: 'boolean',
    default: false
  },
  {
    key: 'plugins.enabled',
    label: 'Plugins',
    description: 'Enable third-party plugin system',
    type: 'boolean',
    default: true
  },
  {
    key: 'componentReuse.semanticThreshold',
    label: 'Reuse Threshold',
    description: 'Minimum similarity score for component reuse suggestions (0-1)',
    type: 'number',
    default: 0.7
  },
  {
    key: 'enforcement.scopeGating.mode',
    label: 'Scope Gating Mode',
    description: 'How to handle out-of-scope file edits: warn or block',
    type: 'string',
    values: ['warn', 'block', 'off'],
    default: 'warn'
  },
  {
    key: 'skills.installed',
    label: 'Installed Skills',
    description: 'Active skill packages for specialized workflows',
    type: 'array',
    default: []
  },
  {
    key: 'projectName',
    label: 'Project Name',
    description: 'Name shown in status and logs',
    type: 'string',
    default: ''
  },
  {
    key: 'cli.primary',
    label: 'Primary CLI',
    description: 'Which AI CLI is being used (claude-code, cursor, windsurf)',
    type: 'string',
    default: 'claude-code'
  }
];

// ============================================================
// Helpers
// ============================================================

/**
 * Get a nested value from an object by dot-separated key path.
 */
function getNestedValue(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Format a value for display.
 */
function formatValue(value) {
  if (value === undefined) return color('dim', '(not set)');
  if (value === true) return color('green', 'true');
  if (value === false) return color('red', 'false');
  if (Array.isArray(value)) {
    return value.length === 0 ? color('dim', '[]') : JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format whether a value is default or custom.
 */
function isDefault(value, defaultValue) {
  return JSON.stringify(value) === JSON.stringify(defaultValue);
}

// ============================================================
// Commands
// ============================================================

function showConfig() {
  const config = getConfig();

  console.log('');
  console.log(color('cyan', 'WogiFlow Configuration'));
  console.log(color('cyan', '======================'));
  console.log('');
  console.log(color('dim', `Config file: .workflow/config.json`));
  console.log(color('dim', `Defaults are in code — config.json contains only your overrides.`));
  console.log('');

  const maxLabelLen = Math.max(...IMPORTANT_OPTIONS.map(o => o.label.length));

  for (const opt of IMPORTANT_OPTIONS) {
    const value = getNestedValue(config, opt.key);
    const displayValue = formatValue(value);
    const label = opt.label.padEnd(maxLabelLen + 2);
    const marker = isDefault(value, opt.default) ? ' ' : color('yellow', '*');

    console.log(`  ${marker} ${color('white', label)} ${displayValue}`);
    console.log(`    ${color('dim', opt.description)}`);

    if (opt.values) {
      console.log(`    ${color('dim', 'Options: ' + opt.values.join(', '))}`);
    }

    console.log(`    ${color('dim', 'Set: flow config set ' + opt.key + ' <value>')}`);
    console.log('');
  }

  console.log(color('dim', '  * = custom override (differs from default)'));
  console.log('');
  console.log(color('dim', '  Full config reference: .claude/docs/configuration/'));
  console.log(color('dim', '  Reset all: flow config reset'));
  console.log('');
}

function exportConfig() {
  const config = getConfig();
  const overrides = {};

  for (const opt of IMPORTANT_OPTIONS) {
    const value = getNestedValue(config, opt.key);
    if (!isDefault(value, opt.default)) {
      overrides[opt.key] = value;
    }
  }

  console.log(JSON.stringify(overrides, null, 2));
}

function resetConfig() {
  const configPath = path.join(PATHS.root, '.workflow', 'config.json');
  const config = safeJsonParse(configPath, null);
  if (!config) {
    error('Failed to read config.json');
    return;
  }

  try {
    // Keep only structural keys, remove user overrides
    const minimal = {
      $schema: config.$schema,
      version: config.version,
      projectName: config.projectName
    };

    fs.writeFileSync(configPath, JSON.stringify(minimal, null, 2));
    success('Config reset to defaults. Only project name and version preserved.');
  } catch (err) {
    error(`Failed to reset config: ${err.message}`);
  }
}

// ============================================================
// Main
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'show';

  const { flags } = parseFlags(args);

  if (flags.json) {
    const config = getConfig();
    const result = {};
    for (const opt of IMPORTANT_OPTIONS) {
      result[opt.key] = {
        value: getNestedValue(config, opt.key),
        default: opt.default,
        description: opt.description
      };
    }
    outputJson(result);
    return;
  }

  switch (command) {
    case 'show':
    case 'list':
      showConfig();
      break;

    case 'set': {
      // Delegate to flow-config-set.js
      const key = args[1];
      const value = args[2];
      if (!key || value === undefined) {
        error('Usage: flow config set <key> <value>');
        process.exit(1);
      }
      const { execFileSync } = require('node:child_process');
      try {
        execFileSync(process.execPath, [path.join(__dirname, 'flow-config-set.js'), key, value], {
          stdio: 'inherit'
        });
      } catch (err) {
        process.exit(1);
      }
      break;
    }

    case 'export':
      exportConfig();
      break;

    case 'reset':
      resetConfig();
      break;

    default:
      // If first arg looks like a key, treat as "show" with that key highlighted
      if (command.includes('.')) {
        const config = getConfig();
        const value = getNestedValue(config, command);
        if (value !== undefined) {
          console.log(formatValue(value));
        } else {
          error(`Unknown config key: ${command}`);
        }
      } else {
        error(`Unknown config command: ${command}`);
        console.log('Usage: flow config [show|set|export|reset]');
      }
  }
}

main();
