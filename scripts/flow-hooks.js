#!/usr/bin/env node

/**
 * Wogi Flow - CLI Hooks Manager
 *
 * Hooks manager for Claude Code.
 *
 * Usage:
 *   flow hooks setup           # Install hooks for configured targets
 *   flow hooks setup --target claude-code  # Install for specific CLI
 *   flow hooks remove          # Remove all hooks
 *   flow hooks remove --target claude-code
 *   flow hooks status          # Show hook status
 *   flow hooks test <hook>     # Test a hook with sample input
 */

const fs = require('fs');
const path = require('path');
const {
  getProjectRoot,
  getConfig,
  color,
  success,
  warn,
  error
} = require('./flow-utils');

const { getAdapter, getAllAdapters, getAvailableAdapters } = require('./hooks/adapters');

const PROJECT_ROOT = getProjectRoot();

/**
 * Get installed WogiFlow version from settings.json (set by postinstall)
 * @returns {string} Version string or 'unknown'
 */
function getInstalledVersion() {
  try {
    const settingsPath = path.join(PROJECT_ROOT, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return settings._wogiFlowVersion || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}
const HOOK_MARKER = '// WOGI_FLOW_MANAGED_HOOKS';

// ============================================================
// Configuration
// ============================================================

/**
 * Get hooks configuration
 */
function getHooksConfig() {
  const config = getConfig();
  return config.hooks || {
    enabled: true,
    targets: ['claude-code'],
    gracefulDegradation: true,
    timeout: 5000,
    rules: {
      taskGating: { enabled: true, blockWithoutTask: true },
      validation: { enabled: true, runAfterEdit: true },
      loopEnforcement: { enabled: true },
      componentReuse: { enabled: true, threshold: 80 },
      sessionContext: { enabled: true, loadSuspendedTasks: true },
      autoLogging: { enabled: true }
    }
  };
}

/**
 * Get target CLIs to install hooks for
 */
function getTargets(specificTarget = null) {
  if (specificTarget) {
    return [specificTarget];
  }
  const config = getHooksConfig();
  return config.targets || ['claude-code'];
}

// ============================================================
// Setup / Install
// ============================================================

/**
 * Install hooks for a specific target CLI
 */
function installForTarget(targetName) {
  const adapter = getAdapter(targetName);
  if (!adapter) {
    error(`Unknown target: ${targetName}`);
    return false;
  }

  if (!adapter.isAvailable()) {
    warn(`${targetName} not detected in project (skipping)`);
    return false;
  }

  console.log(`  Installing hooks for ${targetName}...`);

  const config = getHooksConfig();
  const hooksConfig = adapter.generateConfig(config.rules, PROJECT_ROOT);

  // For Claude Code, we need to merge into settings.local.json
  if (targetName === 'claude-code') {
    return installClaudeCodeHooks(adapter, hooksConfig);
  }

  // For other CLIs, implement their specific installation
  warn(`  ${targetName} installation not yet implemented`);
  return false;
}

/**
 * Install Claude Code hooks into settings.local.json
 */
function installClaudeCodeHooks(adapter, hooksConfig) {
  const configPath = adapter.getLocalConfigPath();
  const configDir = path.dirname(configPath);

  // Ensure .claude directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Read existing config
  let existingConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      existingConfig = JSON.parse(content);
    } catch (err) {
      warn(`  Could not parse existing config, will create new`);
    }
  }

  // Check if we're overwriting non-Wogi hooks
  if (existingConfig.hooks && !existingConfig._wogiFlowManaged) {
    // Backup existing
    const backupPath = configPath + '.backup';
    fs.writeFileSync(backupPath, JSON.stringify(existingConfig, null, 2));
    warn(`  Backed up existing hooks to ${path.basename(backupPath)}`);
  }

  // Merge hooks
  const newConfig = {
    ...existingConfig,
    hooks: hooksConfig.hooks,
    _wogiFlowManaged: true,
    _wogiFlowVersion: getInstalledVersion()
  };

  // Write config
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
  console.log(`  ${color('green', '✓')} Hooks written to ${path.relative(PROJECT_ROOT, configPath)}`);

  return true;
}

/**
 * Install hooks for all configured targets
 */
function setupHooks(options = {}) {
  const { target, force } = options;

  console.log(color('cyan', '🪝 Setting Up CLI Hooks'));
  console.log('');

  const config = getHooksConfig();

  if (!config.enabled) {
    warn('Hooks are disabled in config (hooks.enabled = false)');
    return;
  }

  const targets = getTargets(target);
  const results = [];

  for (const t of targets) {
    const success = installForTarget(t);
    results.push({ target: t, success });
  }

  console.log('');

  const successCount = results.filter(r => r.success).length;
  if (successCount > 0) {
    success(`Installed hooks for ${successCount} CLI${successCount !== 1 ? 's' : ''}`);
  } else {
    warn('No hooks were installed');
  }

  // Show what was configured
  console.log('');
  console.log(color('dim', 'Configured rules:'));
  for (const [rule, settings] of Object.entries(config.rules || {})) {
    const enabled = settings.enabled !== false;
    const icon = enabled ? color('green', '✓') : color('dim', '○');
    console.log(`  ${icon} ${rule}`);
  }
}

// ============================================================
// Remove
// ============================================================

/**
 * Remove hooks for a specific target
 */
function removeForTarget(targetName) {
  const adapter = getAdapter(targetName);
  if (!adapter) {
    warn(`Unknown target: ${targetName}`);
    return false;
  }

  console.log(`  Removing hooks for ${targetName}...`);

  if (targetName === 'claude-code') {
    return removeClaudeCodeHooks(adapter);
  }

  warn(`  ${targetName} removal not yet implemented`);
  return false;
}

/**
 * Remove Claude Code hooks from settings.local.json
 */
function removeClaudeCodeHooks(adapter) {
  const configPath = adapter.getLocalConfigPath();

  if (!fs.existsSync(configPath)) {
    console.log(`  ${color('dim', '-')} No config file found`);
    return true;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    if (!config._wogiFlowManaged) {
      warn(`  Config not managed by Wogi Flow (skipping)`);
      return false;
    }

    // Remove hooks and our marker
    delete config.hooks;
    delete config._wogiFlowManaged;
    delete config._wogiFlowVersion;

    // Check if config is now empty
    if (Object.keys(config).length === 0) {
      fs.unlinkSync(configPath);
      console.log(`  ${color('green', '✓')} Removed ${path.basename(configPath)}`);
    } else {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`  ${color('green', '✓')} Removed hooks from ${path.basename(configPath)}`);
    }

    // Restore backup if exists
    const backupPath = configPath + '.backup';
    if (fs.existsSync(backupPath)) {
      const backupContent = fs.readFileSync(backupPath, 'utf-8');
      const backupConfig = JSON.parse(backupContent);
      if (backupConfig.hooks) {
        const finalConfig = { ...config, hooks: backupConfig.hooks };
        fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));
        fs.unlinkSync(backupPath);
        console.log(`  ${color('green', '✓')} Restored original hooks from backup`);
      }
    }

    return true;
  } catch (err) {
    error(`  Failed to remove: ${err.message}`);
    return false;
  }
}

/**
 * Remove all hooks
 */
function removeHooks(options = {}) {
  const { target } = options;

  console.log(color('cyan', '🪝 Removing CLI Hooks'));
  console.log('');

  const targets = getTargets(target);
  const results = [];

  for (const t of targets) {
    const success = removeForTarget(t);
    results.push({ target: t, success });
  }

  console.log('');

  const successCount = results.filter(r => r.success).length;
  if (successCount > 0) {
    success(`Removed hooks from ${successCount} CLI${successCount !== 1 ? 's' : ''}`);
  }
}

// ============================================================
// Status
// ============================================================

/**
 * Show hook status
 */
function showStatus() {
  console.log(color('cyan', '🪝 CLI Hooks Status'));
  console.log('');

  const config = getHooksConfig();

  // Overall status
  console.log(`Hooks enabled: ${config.enabled !== false ? color('green', 'Yes') : color('red', 'No')}`);
  console.log(`Configured targets: ${(config.targets || ['claude-code']).join(', ')}`);
  console.log('');

  // Per-target status
  console.log('Target Status:');
  const allAdapters = getAllAdapters();

  for (const [name, adapter] of Object.entries(allAdapters)) {
    const available = adapter.isAvailable();
    const installed = checkIfInstalled(adapter);

    let status;
    if (!available) {
      status = color('dim', 'Not detected');
    } else if (installed) {
      status = color('green', 'Installed');
    } else {
      status = color('yellow', 'Available (not installed)');
    }

    console.log(`  ${name}: ${status}`);
  }

  console.log('');

  // Rule status
  console.log('Rules:');
  for (const [rule, settings] of Object.entries(config.rules || {})) {
    const enabled = settings?.enabled !== false;
    const icon = enabled ? color('green', '✓') : color('dim', '○');
    console.log(`  ${icon} ${rule}`);
  }
}

/**
 * Check if hooks are installed for an adapter
 */
function checkIfInstalled(adapter) {
  if (adapter.name === 'claude-code') {
    const configPath = adapter.getLocalConfigPath();
    if (!fs.existsSync(configPath)) {
      return false;
    }
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config._wogiFlowManaged === true;
    } catch {
      return false;
    }
  }
  return false;
}

// ============================================================
// Test
// ============================================================

/**
 * Test a hook with sample input
 */
async function testHook(hookName) {
  console.log(color('cyan', `🧪 Testing Hook: ${hookName}`));
  console.log('');

  const testInputs = {
    'session-start': { hook_event_name: 'SessionStart', source: 'startup' },
    'setup': { hook_event_name: 'Setup', source: 'init' },  // Claude Code 2.1.10+
    'pre-tool-use': {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/test.ts' }
    },
    'post-tool-use': {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/test.ts' },
      tool_response: { success: true }
    },
    'stop': { hook_event_name: 'Stop' },
    'session-end': { hook_event_name: 'SessionEnd', reason: 'manual' }
  };

  const input = testInputs[hookName];
  if (!input) {
    error(`Unknown hook: ${hookName}`);
    console.log('Available hooks: ' + Object.keys(testInputs).join(', '));
    return;
  }

  console.log('Input:', JSON.stringify(input, null, 2));
  console.log('');

  // Run the hook
  const hookPath = path.join(__dirname, 'hooks', 'entry', 'claude-code', `${hookName}.js`);
  if (!fs.existsSync(hookPath)) {
    error(`Hook script not found: ${hookPath}`);
    return;
  }

  const { spawn } = require('child_process');
  const proc = spawn('node', [hookPath], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => { stdout += data; });
  proc.stderr.on('data', (data) => { stderr += data; });

  proc.on('close', (code) => {
    console.log(`Exit code: ${code}`);
    if (stderr) {
      console.log('Stderr:', stderr);
    }
    if (stdout) {
      console.log('Output:');
      try {
        const output = JSON.parse(stdout);
        console.log(JSON.stringify(output, null, 2));
      } catch {
        console.log(stdout);
      }
    }
  });
}

// ============================================================
// Help
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - CLI Hooks Manager

Manage hooks for Claude Code CLI

Usage:
  flow hooks setup              Install hooks for configured targets
  flow hooks setup --target X   Install for specific CLI
  flow hooks remove             Remove all hooks
  flow hooks remove --target X  Remove for specific CLI
  flow hooks status             Show hook status
  flow hooks test <hook>        Test a hook

Available targets:
  claude-code    Claude Code CLI

Configuration:
  Configure hooks in .workflow/config.json under "hooks":

  {
    "hooks": {
      "enabled": true,
      "targets": ["claude-code"],
      "rules": {
        "taskGating": { "enabled": true },
        "validation": { "enabled": true },
        "loopEnforcement": { "enabled": true },
        "componentReuse": { "enabled": true },
        "sessionContext": { "enabled": true },
        "autoLogging": { "enabled": true }
      }
    }
  }

Test hooks:
  flow hooks test session-start
  flow hooks test pre-tool-use
  flow hooks test post-tool-use
  flow hooks test stop
  flow hooks test session-end
`);
}

// ============================================================
// CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Parse options
  const options = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      options.target = args[i + 1];
      i++;
    } else if (args[i] === '--force') {
      options.force = true;
    }
  }

  switch (command) {
    case 'setup':
    case 'install':
      setupHooks(options);
      break;
    case 'remove':
    case 'uninstall':
      removeHooks(options);
      break;
    case 'status':
      showStatus();
      break;
    case 'test':
      testHook(args[1]);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      if (command) {
        error(`Unknown command: ${command}`);
      }
      showHelp();
      process.exit(command ? 1 : 0);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getHooksConfig,
  setupHooks,
  removeHooks,
  showStatus,
  testHook,
  installForTarget,
  removeForTarget,
  checkIfInstalled
};

if (require.main === module) {
  main();
}
