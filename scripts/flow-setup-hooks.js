#!/usr/bin/env node

/**
 * Wogi Flow - Git Hooks Setup
 *
 * Installs git hooks for automatic workflow integration:
 * - pre-commit: Optionally runs component index scan
 * - post-commit: Optionally syncs rules from decisions.md
 *
 * Usage:
 *   node scripts/flow-setup-hooks.js           # Install hooks
 *   node scripts/flow-setup-hooks.js --remove  # Remove hooks
 *   node scripts/flow-setup-hooks.js --status  # Check hook status
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

const PROJECT_ROOT = getProjectRoot();
const GIT_DIR = path.join(PROJECT_ROOT, '.git');
const HOOKS_DIR = path.join(GIT_DIR, 'hooks');

// Hook marker to identify our managed hooks
const HOOK_MARKER = '# WOGI_FLOW_MANAGED_HOOK';

// ============================================================
// Hook Templates
// ============================================================

const PRE_COMMIT_HOOK = `#!/bin/sh
${HOOK_MARKER}
# Wogi Flow Pre-commit Hook
# Auto-generated - do not edit manually

# Check config for what to run
CONFIG_FILE=".workflow/config.json"

# Function to check if a feature is enabled in config
check_config() {
  local key="$1"
  local default="$2"
  if [ -f "$CONFIG_FILE" ]; then
    python3 -c "
import json
try:
    with open('$CONFIG_FILE', 'r') as f:
        config = json.load(f)
    keys = '$key'.split('.')
    val = config
    for k in keys:
        val = val.get(k, {}) if isinstance(val, dict) else {}
    result = val if val != {} else '$default'
    print('true' if result == True or result == 'true' else 'false' if result == False or result == 'false' else result)
except Exception as e:
    print('$default')
" 2>/dev/null
  else
    echo "$default"
  fi
}

# Run component index scan if configured
SCAN_ON_COMMIT=$(check_config "componentIndex.scanOn" "[]" | grep -q "preCommit" && echo "true" || echo "false")
if [ "$SCAN_ON_COMMIT" = "true" ]; then
  echo "🔄 Updating component index..."
  bash scripts/flow-map-index scan --quiet 2>/dev/null || true
fi

# Sync rules if decisions.md was modified
if git diff --cached --name-only | grep -q "decisions.md"; then
  echo "📋 Syncing rules from decisions.md..."
  node scripts/flow-rules-sync.js 2>/dev/null || true
  git add .claude/rules/*.md 2>/dev/null || true
fi

# Continue with commit
exit 0
`;

const POST_COMMIT_HOOK = `#!/bin/sh
${HOOK_MARKER}
# Wogi Flow Post-commit Hook
# Auto-generated - do not edit manually

# Optional: Log commit to request log
# This is disabled by default as it can be noisy

exit 0
`;

// ============================================================
// Hook Management
// ============================================================

/**
 * Check if .git directory exists
 */
function isGitRepo() {
  return fs.existsSync(GIT_DIR);
}

/**
 * Check if a hook is managed by Wogi Flow
 */
function isOurHook(hookPath) {
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, 'utf-8');
  return content.includes(HOOK_MARKER);
}

/**
 * Install a hook
 */
function installHook(name, content) {
  const hookPath = path.join(HOOKS_DIR, name);

  // Create hooks directory if it doesn't exist
  if (!fs.existsSync(HOOKS_DIR)) {
    fs.mkdirSync(HOOKS_DIR, { recursive: true });
  }

  // Check if there's an existing hook
  if (fs.existsSync(hookPath) && !isOurHook(hookPath)) {
    const existingContent = fs.readFileSync(hookPath, 'utf-8');
    // Backup existing hook
    const backupPath = `${hookPath}.backup`;
    fs.writeFileSync(backupPath, existingContent);
    warn(`Backed up existing ${name} hook to ${name}.backup`);
  }

  // Write new hook
  fs.writeFileSync(hookPath, content);
  fs.chmodSync(hookPath, '755');

  return true;
}

/**
 * Remove a hook
 */
function removeHook(name) {
  const hookPath = path.join(HOOKS_DIR, name);

  if (!fs.existsSync(hookPath)) {
    return { existed: false };
  }

  if (!isOurHook(hookPath)) {
    return { existed: true, skipped: true, reason: 'Not a Wogi Flow hook' };
  }

  fs.unlinkSync(hookPath);

  // Restore backup if exists
  const backupPath = `${hookPath}.backup`;
  if (fs.existsSync(backupPath)) {
    fs.renameSync(backupPath, hookPath);
    return { existed: true, restored: true };
  }

  return { existed: true, removed: true };
}

/**
 * Get hook status
 */
function getHookStatus(name) {
  const hookPath = path.join(HOOKS_DIR, name);

  if (!fs.existsSync(hookPath)) {
    return { installed: false };
  }

  const isManaged = isOurHook(hookPath);
  const stats = fs.statSync(hookPath);
  const isExecutable = (stats.mode & 0o111) !== 0;

  return {
    installed: true,
    managed: isManaged,
    executable: isExecutable,
    path: hookPath
  };
}

// ============================================================
// Main Commands
// ============================================================

function installHooks() {
  if (!isGitRepo()) {
    error('Not a git repository. Run this from the project root.');
    process.exit(1);
  }

  console.log(color('cyan', '🪝 Installing Git Hooks'));
  console.log('');

  const results = [];

  // Install pre-commit hook
  try {
    installHook('pre-commit', PRE_COMMIT_HOOK);
    results.push({ name: 'pre-commit', success: true });
    console.log(`  ${color('green', '✓')} pre-commit hook installed`);
  } catch (err) {
    results.push({ name: 'pre-commit', success: false, error: err.message });
    console.log(`  ${color('red', '✗')} pre-commit: ${err.message}`);
  }

  // Install post-commit hook
  try {
    installHook('post-commit', POST_COMMIT_HOOK);
    results.push({ name: 'post-commit', success: true });
    console.log(`  ${color('green', '✓')} post-commit hook installed`);
  } catch (err) {
    results.push({ name: 'post-commit', success: false, error: err.message });
    console.log(`  ${color('red', '✗')} post-commit: ${err.message}`);
  }

  console.log('');

  const allSuccess = results.every(r => r.success);
  if (allSuccess) {
    success('Git hooks installed successfully');
    console.log('');
    console.log(color('dim', 'Configure in .workflow/config.json:'));
    console.log(color('dim', '  componentIndex.scanOn: ["preCommit", "afterTask", "sessionStart"]'));
  } else {
    warn('Some hooks failed to install');
  }

  return results;
}

function removeHooks() {
  if (!isGitRepo()) {
    error('Not a git repository');
    process.exit(1);
  }

  console.log(color('cyan', '🪝 Removing Git Hooks'));
  console.log('');

  const hooks = ['pre-commit', 'post-commit'];

  for (const hook of hooks) {
    const result = removeHook(hook);
    if (result.skipped) {
      console.log(`  ${color('yellow', '○')} ${hook}: ${result.reason}`);
    } else if (result.restored) {
      console.log(`  ${color('green', '✓')} ${hook} removed (backup restored)`);
    } else if (result.removed) {
      console.log(`  ${color('green', '✓')} ${hook} removed`);
    } else {
      console.log(`  ${color('dim', '-')} ${hook}: not installed`);
    }
  }

  console.log('');
  success('Git hooks removed');
}

function showStatus() {
  if (!isGitRepo()) {
    error('Not a git repository');
    process.exit(1);
  }

  console.log(color('cyan', '🪝 Git Hook Status'));
  console.log('');

  const hooks = ['pre-commit', 'post-commit', 'pre-push', 'commit-msg'];

  for (const hook of hooks) {
    const status = getHookStatus(hook);

    if (!status.installed) {
      console.log(`  ${color('dim', '-')} ${hook}: not installed`);
    } else if (status.managed) {
      console.log(`  ${color('green', '✓')} ${hook}: installed (Wogi Flow managed)`);
    } else {
      console.log(`  ${color('yellow', '○')} ${hook}: installed (external)`);
    }
  }

  console.log('');

  // Show config
  try {
    const config = getConfig();
    const scanOn = config.componentIndex?.scanOn || [];
    console.log(color('dim', 'Config: componentIndex.scanOn = ' + JSON.stringify(scanOn)));
  } catch {
    console.log(color('dim', 'Config: Unable to read'));
  }
}

function showHelp() {
  console.log(`
Wogi Flow - Git Hooks Setup

Install git hooks for automatic workflow integration.

Usage:
  node scripts/flow-setup-hooks.js           # Install hooks
  node scripts/flow-setup-hooks.js --remove  # Remove hooks
  node scripts/flow-setup-hooks.js --status  # Check status
  node scripts/flow-setup-hooks.js --help    # Show this help

Hooks installed:
  pre-commit    - Sync rules, optionally scan component index
  post-commit   - (Reserved for future use)

Configuration:
  In .workflow/config.json, set componentIndex.scanOn to include "preCommit":

  {
    "componentIndex": {
      "scanOn": ["sessionStart", "afterTask", "preCommit"]
    }
  }
`);
}

// ============================================================
// CLI
// ============================================================

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--remove') || args.includes('--uninstall')) {
    removeHooks();
    process.exit(0);
  }

  if (args.includes('--status')) {
    showStatus();
    process.exit(0);
  }

  // Default: install hooks
  installHooks();
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  installHook,
  removeHook,
  getHookStatus,
  isOurHook,
  installHooks,
  removeHooks,
  showStatus,
  HOOK_MARKER
};

if (require.main === module) {
  main();
}
