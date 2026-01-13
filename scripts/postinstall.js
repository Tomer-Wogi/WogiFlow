#!/usr/bin/env node

/**
 * WogiFlow postinstall script
 *
 * Runs after npm install to:
 * 1. Create minimal directory structure
 * 2. Create pending-setup.json marker for AI to detect
 * 3. Print instructions to start AI assistant
 *
 * All actual setup is done by the AI via /wogi-init command.
 */

const fs = require('fs');
const path = require('path');

// Get project root (where npm install was run, not node_modules/wogiflow)
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

// Directory structure (relative to project root)
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

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
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
    }, null, 2));
  }
}

/**
 * Create pending-setup.json marker for AI to detect
 * Uses exclusive write flag to prevent race conditions
 */
function createPendingSetupMarker() {
  const markerPath = path.join(STATE_DIR, 'pending-setup.json');

  // Don't create if already fully initialized
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
    }, null, 2), { flag: 'wx' });
  } catch (err) {
    // EEXIST means file already exists - that's fine, another process created it
    if (err.code !== 'EEXIST') {
      throw err;
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
 * Main entry point
 */
async function main() {
  // Always create minimal structure first
  createMinimalStructure();

  // Create marker for AI to detect (unless already initialized)
  createPendingSetupMarker();

  // Silent in CI or when explicitly disabled
  if (shouldBeSilent()) {
    return;
  }

  // Try to write directly to terminal (bypasses npm output capture)
  // Note: /dev/tty is Unix-specific, will use stderr fallback on Windows
  let output = process.stderr;
  let ttyFd = null;
  try {
    if (process.platform !== 'win32') {
      fs.accessSync('/dev/tty', fs.constants.W_OK);
      ttyFd = fs.openSync('/dev/tty', 'w');
      output = { write: (msg) => fs.writeSync(ttyFd, msg) };
    }
  } catch (err) {
    // Fallback to stderr if /dev/tty not available
    ttyFd = null;
  }

  // Already initialized - short message
  if (isAlreadyInitialized()) {
    output.write('\x1b[36mWogiFlow:\x1b[0m Already initialized. Run \x1b[33mnpx flow status\x1b[0m to see project state.\n');
    // Close TTY file descriptor if opened
    if (ttyFd !== null) {
      try { fs.closeSync(ttyFd); } catch (err) { /* ignore */ }
    }
    return;
  }

  // Show setup instructions - point to AI assistant
  const msg = `
\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m             \x1b[1mWogiFlow Installed Successfully!\x1b[0m               \x1b[36m║\x1b[0m
\x1b[36m╠══════════════════════════════════════════════════════════════╣\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  \x1b[33mTo complete setup, start your AI assistant:\x1b[0m                \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    \x1b[32mclaude\x1b[0m      \x1b[2m(Claude Code)\x1b[0m                               \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    \x1b[32mgemini\x1b[0m      \x1b[2m(Gemini CLI)\x1b[0m                                \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m    \x1b[32mopencode\x1b[0m    \x1b[2m(OpenCode)\x1b[0m                                  \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  Then say: \x1b[33m"setup wogiflow"\x1b[0m or run \x1b[33m/wogi-init\x1b[0m               \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m                                                              \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m

`;
  output.write(msg);

  // Close TTY file descriptor if opened
  if (ttyFd !== null) {
    try { fs.closeSync(ttyFd); } catch (err) { /* ignore */ }
  }
}

// Run
main().catch((err) => {
  // Don't fail npm install on postinstall errors
  process.stderr.write(`\x1b[33mWogiFlow postinstall warning:\x1b[0m ${err.message}\n`);
  createMinimalStructure();
});
