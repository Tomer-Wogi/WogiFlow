#!/usr/bin/env node

/**
 * WogiFlow postinstall script
 *
 * Runs after npm install to set up project with the unified wizard.
 * In CI environments, creates minimal structure without interaction.
 */

const fs = require('fs');
const path = require('path');

// Get project root (where npm install was run, not node_modules/wogiflow)
const PROJECT_ROOT = process.env.INIT_CWD || process.cwd();

// Directory structure (relative to project root)
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');

/**
 * Create minimal directory structure (for CI or non-interactive)
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
 * Check if we should be completely silent (CI only)
 */
function shouldBeSilent() {
  // Silent in CI
  if (process.env.CI) return true;

  // Silent if explicitly requested
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

  // Silent in CI or when explicitly disabled
  if (shouldBeSilent()) {
    return;
  }

  // Try to write directly to terminal (bypasses npm output capture)
  let output = process.stderr; // Default fallback
  try {
    // Check if /dev/tty exists and is writable
    fs.accessSync('/dev/tty', fs.constants.W_OK);
    const fd = fs.openSync('/dev/tty', 'w');
    output = { write: (msg) => fs.writeSync(fd, msg) };
  } catch {
    // Fallback to stderr if /dev/tty not available (Windows, CI, non-interactive)
  }

  // Already initialized - short message
  if (isAlreadyInitialized()) {
    output.write('\x1b[36mWogiFlow:\x1b[0m Already initialized. Run \x1b[33mnpx flow status\x1b[0m to see project state.\n');
    return;
  }

  // Show setup instructions
  const msg = `
\x1b[36m╔════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m  \x1b[1mWogiFlow installed successfully!\x1b[0m                           \x1b[36m║\x1b[0m
\x1b[36m╚════════════════════════════════════════════════════════════╝\x1b[0m

  \x1b[33mNext step:\x1b[0m Run the setup wizard:

    \x1b[36mnpx flow onboard\x1b[0m    \x1b[2m# For existing projects (recommended)\x1b[0m
    \x1b[36mnpx flow init\x1b[0m       \x1b[2m# For new projects\x1b[0m

`;
  output.write(msg);
}

// Run
main().catch((err) => {
  // Don't fail npm install on postinstall errors
  process.stderr.write(`\x1b[33mWogiFlow postinstall warning:\x1b[0m ${err.message}\n`);
  createMinimalStructure();
});
