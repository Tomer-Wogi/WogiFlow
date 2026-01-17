#!/usr/bin/env node

/**
 * Wogi Flow - Git Hooks Installer
 *
 * Installs WogiFlow git hooks (post-commit) to enable automatic task management.
 *
 * Usage:
 *   flow hooks install    - Install all hooks
 *   flow hooks uninstall  - Remove hooks
 *   flow hooks status     - Check hook status
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, success, warn, error, info, color, parseFlags } = require('./flow-utils');

const GIT_HOOKS_DIR = path.join(PROJECT_ROOT, '.git', 'hooks');
const FLOW_HOOKS_DIR = path.join(__dirname, 'hooks', 'git');

// Hooks we manage
const MANAGED_HOOKS = ['post-commit'];

// Marker to identify our hooks
const HOOK_MARKER = '# WOGIFLOW-MANAGED-HOOK';

/**
 * Check if git hooks directory exists
 */
function gitHooksExist() {
  return fs.existsSync(GIT_HOOKS_DIR);
}

/**
 * Create a shell wrapper that calls our Node.js hook
 * @param {string} hookName - Name of the hook (e.g., 'post-commit')
 * @returns {string} Shell script content
 */
function createHookWrapper(hookName) {
  const hookScript = path.join(FLOW_HOOKS_DIR, `${hookName}.js`);
  const relativeScript = path.relative(PROJECT_ROOT, hookScript);

  return `#!/bin/sh
${HOOK_MARKER}
# WogiFlow ${hookName} hook - auto-manages task lifecycle
# Installed by: flow hooks install
# Remove with: flow hooks uninstall

# Run the Node.js hook script
node "${relativeScript}" "$@"

# Always exit 0 to not block commits on hook errors
exit 0
`;
}

/**
 * Check if a hook is managed by WogiFlow
 * @param {string} hookPath - Path to the hook file
 * @returns {boolean}
 */
function isWogiFlowHook(hookPath) {
  if (!fs.existsSync(hookPath)) return false;
  try {
    const content = fs.readFileSync(hookPath, 'utf-8');
    return content.includes(HOOK_MARKER);
  } catch {
    return false;
  }
}

/**
 * Install a single hook
 * @param {string} hookName - Name of the hook
 * @param {Object} options - { force: boolean }
 * @returns {Object} { success: boolean, message: string }
 */
function installHook(hookName, options = {}) {
  const { force = false } = options;
  const hookPath = path.join(GIT_HOOKS_DIR, hookName);
  const hookScript = path.join(FLOW_HOOKS_DIR, `${hookName}.js`);

  // Check if our hook script exists
  if (!fs.existsSync(hookScript)) {
    return { success: false, message: `Hook script not found: ${hookScript}` };
  }

  // Check for existing hook
  if (fs.existsSync(hookPath)) {
    if (isWogiFlowHook(hookPath)) {
      // Already installed, update it
      const wrapper = createHookWrapper(hookName);
      fs.writeFileSync(hookPath, wrapper, { mode: 0o755 });
      return { success: true, message: 'updated' };
    } else if (!force) {
      // Existing non-WogiFlow hook
      return {
        success: false,
        message: 'existing hook found (use --force to overwrite)'
      };
    }
    // Force overwrite
    const backupPath = `${hookPath}.backup.${Date.now()}`;
    fs.renameSync(hookPath, backupPath);
    warn(`Backed up existing hook to: ${path.basename(backupPath)}`);
  }

  // Create the hook wrapper
  const wrapper = createHookWrapper(hookName);
  fs.writeFileSync(hookPath, wrapper, { mode: 0o755 });

  return { success: true, message: 'installed' };
}

/**
 * Uninstall a single hook
 * @param {string} hookName - Name of the hook
 * @returns {Object} { success: boolean, message: string }
 */
function uninstallHook(hookName) {
  const hookPath = path.join(GIT_HOOKS_DIR, hookName);

  if (!fs.existsSync(hookPath)) {
    return { success: true, message: 'not installed' };
  }

  if (!isWogiFlowHook(hookPath)) {
    return { success: false, message: 'not a WogiFlow hook (skipped)' };
  }

  fs.unlinkSync(hookPath);
  return { success: true, message: 'removed' };
}

/**
 * Get status of all managed hooks
 * @returns {Object[]} Array of { name, status, path }
 */
function getHooksStatus() {
  return MANAGED_HOOKS.map(hookName => {
    const hookPath = path.join(GIT_HOOKS_DIR, hookName);
    let status = 'not installed';

    if (fs.existsSync(hookPath)) {
      if (isWogiFlowHook(hookPath)) {
        status = 'installed';
      } else {
        status = 'external hook present';
      }
    }

    return { name: hookName, status, path: hookPath };
  });
}

/**
 * Install all managed hooks
 */
function installAllHooks(options = {}) {
  if (!gitHooksExist()) {
    error('Not a git repository (no .git/hooks directory)');
    return false;
  }

  console.log(color('cyan', 'Installing WogiFlow git hooks...'));
  console.log('');

  let allSuccess = true;

  for (const hookName of MANAGED_HOOKS) {
    const result = installHook(hookName, options);
    if (result.success) {
      success(`${hookName}: ${result.message}`);
    } else {
      warn(`${hookName}: ${result.message}`);
      allSuccess = false;
    }
  }

  console.log('');

  if (allSuccess) {
    success('All hooks installed successfully');
    console.log('');
    info('Auto-created tasks will now close automatically when committed');
  }

  return allSuccess;
}

/**
 * Uninstall all managed hooks
 */
function uninstallAllHooks() {
  if (!gitHooksExist()) {
    error('Not a git repository');
    return false;
  }

  console.log(color('cyan', 'Uninstalling WogiFlow git hooks...'));
  console.log('');

  for (const hookName of MANAGED_HOOKS) {
    const result = uninstallHook(hookName);
    if (result.success) {
      success(`${hookName}: ${result.message}`);
    } else {
      warn(`${hookName}: ${result.message}`);
    }
  }

  console.log('');
  success('Hooks uninstalled');

  return true;
}

/**
 * Show status of all hooks
 */
function showStatus() {
  if (!gitHooksExist()) {
    error('Not a git repository');
    return;
  }

  console.log(color('cyan', 'WogiFlow Git Hooks Status'));
  console.log('');

  const statuses = getHooksStatus();

  for (const hook of statuses) {
    const statusColor = hook.status === 'installed' ? 'green'
      : hook.status === 'not installed' ? 'yellow' : 'red';
    console.log(`  ${hook.name}: ${color(statusColor, hook.status)}`);
  }

  console.log('');

  const installed = statuses.filter(h => h.status === 'installed').length;
  if (installed === MANAGED_HOOKS.length) {
    success('All hooks installed');
  } else if (installed > 0) {
    warn(`${installed}/${MANAGED_HOOKS.length} hooks installed`);
  } else {
    info('No hooks installed. Run: flow hooks install');
  }
}

// CLI
function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);
  const command = positional[0] || 'status';

  switch (command) {
    case 'install':
      installAllHooks({ force: flags.force });
      break;
    case 'uninstall':
      uninstallAllHooks();
      break;
    case 'status':
      showStatus();
      break;
    default:
      console.log('Usage: flow hooks [install|uninstall|status]');
      console.log('');
      console.log('Commands:');
      console.log('  install     Install WogiFlow git hooks');
      console.log('  uninstall   Remove WogiFlow git hooks');
      console.log('  status      Show hook installation status');
      console.log('');
      console.log('Options:');
      console.log('  --force     Overwrite existing non-WogiFlow hooks');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  installAllHooks,
  uninstallAllHooks,
  getHooksStatus,
  installHook,
  uninstallHook,
  isWogiFlowHook,
  MANAGED_HOOKS
};
