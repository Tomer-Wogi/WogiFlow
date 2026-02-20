#!/usr/bin/env node

/**
 * WogiFlow postinstall script
 *
 * Runs after npm install to:
 * 1. Create minimal directory structure
 * 2. Copy .claude/commands/ (slash commands) - ESSENTIAL for immediate use
 * 3. Copy scripts/ (workflow scripts) - ensures scripts are updated on npm update
 * 4. Create pending-setup.json marker for AI to detect
 * 5. Print instructions to start AI assistant
 *
 * Full setup (config, skills, etc.) is done by the AI via /wogi-init command.
 */

const fs = require('fs');
const path = require('path');

// Get project root (where npm install was run, not node_modules/wogiflow)
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

// Package root (where wogiflow is installed in node_modules)
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Directory structure (relative to project root)
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

// File permissions for security
const DIR_MODE = 0o755;  // rwxr-xr-x for directories
const FILE_MODE = 0o644; // rw-r--r-- for files

/**
 * Safely close a file descriptor, ignoring errors
 * @param {number|null} fd - File descriptor to close
 */
function safeClose(fd) {
  if (fd !== null) {
    try { fs.closeSync(fd); } catch (_err) { /* intentionally ignored */ }
  }
}

/**
 * Create minimal directory structure
 */
function createMinimalStructure() {
  const dirs = [
    WORKFLOW_DIR,
    STATE_DIR,
    path.join(WORKFLOW_DIR, 'changes'),
    path.join(WORKFLOW_DIR, 'specs')
  ];

  for (const dir of dirs) {
    // recursive:true handles existing dirs gracefully, no need for existsSync check
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  }

  // Create minimal ready.json
  const readyPath = path.join(STATE_DIR, 'ready.json');
  if (!fs.existsSync(readyPath)) {
    fs.writeFileSync(readyPath, JSON.stringify({
      lastUpdated: new Date().toISOString(),
      ready: [],
      inProgress: [],
      blocked: [],
      recentlyCompleted: []
    }, null, 2), { mode: FILE_MODE });
  }
}

/**
 * Create pending-setup.json marker for AI to detect
 * Uses exclusive write flag to prevent race conditions
 */
function createPendingSetupMarker() {
  const markerPath = path.join(STATE_DIR, 'pending-setup.json');

  // Check-then-act is non-atomic, but EEXIST handling below provides safety
  if (fs.existsSync(path.join(WORKFLOW_DIR, 'config.json'))) {
    return;
  }

  // Use 'wx' flag for atomic creation - fails if file already exists
  // This prevents race conditions when multiple npm installs run in parallel
  try {
    fs.writeFileSync(markerPath, JSON.stringify({
      status: 'pending_ai_setup',
      createdAt: new Date().toISOString(),
      projectRoot: PROJECT_ROOT,
      version: '1.0'
    }, null, 2), { flag: 'wx', mode: FILE_MODE });
  } catch (err) {
    // EEXIST means file already exists - that's fine, another process created it
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Recursively copy a directory
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @param {boolean} mergeMode - If true, only copy files that don't exist in dest
 * @param {number} depth - Current recursion depth (for infinite loop protection)
 */
function copyDir(src, dest, mergeMode = false, depth = 0) {
  // Prevent infinite recursion via symlinks
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    if (process.env.DEBUG) {
      console.error(`[postinstall] Max directory depth exceeded: ${src}`);
    }
    return;
  }

  fs.mkdirSync(dest, { recursive: true, mode: DIR_MODE });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip symbolic links (security measure - prevents traversal attacks)
    if (entry.isSymbolicLink()) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, mergeMode, depth + 1);
    } else {
      // In merge mode, skip files that already exist
      if (mergeMode && fs.existsSync(destPath)) {
        continue;
      }
      try {
        fs.copyFileSync(srcPath, destPath);
        try {
          fs.chmodSync(destPath, FILE_MODE);
        } catch (chmodErr) {
          // chmod failure is non-critical on some filesystems (e.g., Windows)
          if (process.env.DEBUG) {
            console.error(`[postinstall] chmod failed: ${chmodErr.message}`);
          }
        }
      } catch (copyErr) {
        // Log but continue - one file failure shouldn't stop the entire install
        if (process.env.DEBUG) {
          console.error(`[postinstall] Failed to copy ${entry.name}: ${copyErr.message}`);
        }
      }
    }
  }
}

/**
 * Copy essential .claude/ resources from package to project
 * This ensures commands are available immediately after npm install
 *
 * Uses merge mode: new commands are added, existing ones are NOT overwritten
 * This preserves user customizations while ensuring new commands are available
 */
function copyClaudeResources() {
  const claudeDir = path.join(PROJECT_ROOT, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true, mode: DIR_MODE });

  // Copy commands (essential for slash commands to work)
  // Use merge mode to add new commands without overwriting customizations
  const packageCommands = path.join(PACKAGE_ROOT, '.claude', 'commands');
  const projectCommands = path.join(claudeDir, 'commands');
  if (fs.existsSync(packageCommands)) {
    const alreadyExists = fs.existsSync(projectCommands);
    copyDir(packageCommands, projectCommands, alreadyExists);
  }

  // Copy docs (knowledge base) - merge mode
  const packageDocs = path.join(PACKAGE_ROOT, '.claude', 'docs');
  const projectDocs = path.join(claudeDir, 'docs');
  if (fs.existsSync(packageDocs)) {
    const alreadyExists = fs.existsSync(projectDocs);
    copyDir(packageDocs, projectDocs, alreadyExists);
  }

  // Copy rules (coding patterns) - merge mode
  const packageRules = path.join(PACKAGE_ROOT, '.claude', 'rules');
  const projectRules = path.join(claudeDir, 'rules');
  if (fs.existsSync(packageRules)) {
    const alreadyExists = fs.existsSync(projectRules);
    copyDir(packageRules, projectRules, alreadyExists);
  }

  // Copy settings.json (hook configuration) - ESSENTIAL for hooks to work
  // Without this file, Claude Code has no idea hooks exist and won't run them
  const packageSettings = path.join(PACKAGE_ROOT, '.claude', 'settings.json');
  const projectSettings = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(packageSettings)) {
    if (fs.existsSync(projectSettings)) {
      // Merge: inject our hooks into existing settings without overwriting other config
      try {
        const existing = JSON.parse(fs.readFileSync(projectSettings, 'utf-8'));
        // Only merge if not already WogiFlow-managed (avoid duplicate hooks)
        if (!existing._wogiFlowManaged) {
          const ours = JSON.parse(fs.readFileSync(packageSettings, 'utf-8'));
          existing.hooks = ours.hooks;
          existing._wogiFlowManaged = true;
          existing._wogiFlowVersion = ours._wogiFlowVersion || '1.0.0';
          fs.writeFileSync(projectSettings, JSON.stringify(existing, null, 2), { mode: FILE_MODE });
        }
        // If already managed, leave as-is (user may have customized hook config)
      } catch (err) {
        // Parse error on existing file - overwrite with ours
        if (process.env.DEBUG) {
          console.error(`[postinstall] settings.json merge failed, overwriting: ${err.message}`);
        }
        fs.copyFileSync(packageSettings, projectSettings);
      }
    } else {
      // No existing settings - copy ours directly
      fs.copyFileSync(packageSettings, projectSettings);
      try {
        fs.chmodSync(projectSettings, FILE_MODE);
      } catch (_err) { /* non-critical */ }
    }
  }

  // Note: skills/ is NOT copied here - /wogi-init will set up project-specific skills
}

/**
 * Copy scripts from package to project (for npm update scenario)
 * This ensures scripts are updated on npm install/update
 *
 * Uses merge mode: new scripts are added, existing ones are NOT overwritten
 * This preserves user customizations while ensuring new scripts are available
 */
function copyScriptsFromPackage() {
  const packageScripts = path.join(PACKAGE_ROOT, 'scripts');
  const projectScripts = path.join(PROJECT_ROOT, 'scripts');

  if (!fs.existsSync(packageScripts)) {
    if (process.env.DEBUG) {
      console.error('[postinstall] Package scripts not found');
    }
    return;
  }

  // Use merge mode to add new scripts without overwriting customizations
  const alreadyExists = fs.existsSync(projectScripts);
  copyDir(packageScripts, projectScripts, alreadyExists);

  // Make flow script executable
  const flowScript = path.join(projectScripts, 'flow');
  if (fs.existsSync(flowScript)) {
    try {
      fs.chmodSync(flowScript, 0o755);
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[postinstall] chmod flow script failed: ${err.message}`);
      }
    }
  }
}

/**
 * Check if we should be completely silent (CI only)
 */
function shouldBeSilent() {
  if (process.env.CI) return true;
  if (process.env.WOGIFLOW_SKIP_POSTINSTALL) return true;
  return false;
}

/**
 * Check if already initialized
 */
function isAlreadyInitialized() {
  return fs.existsSync(path.join(WORKFLOW_DIR, 'config.json'));
}

/**
 * Main entry point (sync - no async operations needed)
 */
function main() {
  // Always create minimal structure first
  createMinimalStructure();

  // Copy essential .claude/ resources (commands, docs, rules)
  // This ensures slash commands are available immediately
  copyClaudeResources();

  // Copy scripts (for npm update scenario)
  // This ensures scripts are updated when running npm install/update
  copyScriptsFromPackage();

  // Create marker for AI to detect (unless already initialized)
  createPendingSetupMarker();

  // Silent in CI or when explicitly disabled
  if (shouldBeSilent()) {
    return;
  }

  // Try to write directly to terminal, bypassing npm output capture
  // /dev/tty is Unix-specific; npm normally captures postinstall output
  // On Windows or in environments without TTY, fallback to stderr
  let output = process.stderr;
  let ttyFd = null;

  if (process.platform !== 'win32') {
    try {
      // Combine access check and open into single try-catch to avoid TOCTOU
      ttyFd = fs.openSync('/dev/tty', 'w');
      output = { write: (msg) => fs.writeSync(ttyFd, msg) };
    } catch (_err) {
      // /dev/tty not available (no terminal, CI, etc.) - fallback to stderr
      ttyFd = null;
    }
  }

  try {
    // Already initialized - short message
    if (isAlreadyInitialized()) {
      output.write('\x1b[36mWogiFlow:\x1b[0m Already initialized. Run \x1b[33mnpx flow status\x1b[0m to see project state.\n');
      return;
    }

    // Show setup instructions - point to AI assistant
    const msg = `
\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m             \x1b[1mWogiFlow Installed Successfully!\x1b[0m               \x1b[36m║\x1b[0m
\x1b[36m╠══════════════════════════════════════════════════════════════╣\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  \x1b[33mTo complete setup, start Claude Code:\x1b[0m                     \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    \x1b[32mclaude\x1b[0m      \x1b[2m(Claude Code - the official Anthropic CLI)\x1b[0m  \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  Then say: \x1b[33m"setup wogiflow"\x1b[0m or run \x1b[33m/wogi-init\x1b[0m               \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m

`;
    output.write(msg);
  } finally {
    // Always close TTY file descriptor if opened
    safeClose(ttyFd);
  }
}

// Run
try {
  main();
} catch (err) {
  // Don't fail npm install on postinstall errors
  const errorInfo = process.env.DEBUG ? ` (${err.code || 'unknown'})` : '';
  process.stderr.write(`\x1b[33mWogiFlow postinstall warning:\x1b[0m ${err.message}${errorInfo}\n`);
  createMinimalStructure();
}
