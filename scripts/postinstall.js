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
 * Check if we should skip the wizard
 */
function shouldSkipWizard() {
  // Skip in CI
  if (process.env.CI) return true;

  // Skip if explicitly requested
  if (process.env.WOGIFLOW_SKIP_POSTINSTALL) return true;

  // Skip if already initialized
  if (fs.existsSync(path.join(WORKFLOW_DIR, 'config.json'))) return true;

  // Skip if not a TTY (non-interactive)
  if (!process.stdin.isTTY) return true;

  return false;
}

/**
 * Run the unified wizard
 */
async function runWizard() {
  try {
    const { runUnifiedWizard } = require('../lib/unified-wizard');
    await runUnifiedWizard();
  } catch (err) {
    console.log(`\n\x1b[33mWogiFlow:\x1b[0m Wizard unavailable, creating minimal structure.`);
    console.log(`\x1b[2m  ${err.message}\x1b[0m\n`);
    createMinimalStructure();
    console.log(`\x1b[36mWogiFlow:\x1b[0m Run \x1b[33mflow init\x1b[0m to complete setup.\n`);
  }
}

/**
 * Main entry point
 */
async function main() {
  if (shouldSkipWizard()) {
    // Silent minimal setup for CI/non-interactive
    createMinimalStructure();
    return;
  }

  // Run the full wizard
  await runWizard();
}

// Run
main().catch((err) => {
  // Don't fail npm install on postinstall errors
  console.log(`\x1b[33mWogiFlow postinstall warning:\x1b[0m ${err.message}`);
  createMinimalStructure();
});
