#!/usr/bin/env node

/**
 * WogiFlow postinstall script
 *
 * Runs after npm install to set up project with the unified wizard.
 * In CI environments, creates minimal structure without interaction.
 */

const fs = require('fs');
const path = require('path');

// Directory structure
const WORKFLOW_DIR = '.workflow';
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

  // Already initialized - short message
  if (isAlreadyInitialized()) {
    console.log('\x1b[36mWogiFlow:\x1b[0m Already initialized. Run \x1b[33mnpx flow status\x1b[0m to see project state.');
    return;
  }

  // Show setup instructions (always show, even without TTY)
  console.log('');
  console.log('\x1b[36m╔════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[1mWogiFlow installed successfully!\x1b[0m                           \x1b[36m║\x1b[0m');
  console.log('\x1b[36m╚════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  \x1b[33mNext step:\x1b[0m Run the setup wizard:');
  console.log('');
  console.log('    \x1b[36mnpx flow onboard\x1b[0m    \x1b[2m# For existing projects (recommended)\x1b[0m');
  console.log('    \x1b[36mnpx flow init\x1b[0m       \x1b[2m# For new projects\x1b[0m');
  console.log('');
}

// Run
main().catch((err) => {
  // Don't fail npm install on postinstall errors
  console.log(`\x1b[33mWogiFlow postinstall warning:\x1b[0m ${err.message}`);
  createMinimalStructure();
});
