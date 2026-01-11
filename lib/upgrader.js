#!/usr/bin/env node

/**
 * Wogi Flow Upgrader
 *
 * Handles project upgrades with `flow upgrade`.
 * Migrates projects from older versions to the current version,
 * preserving user data while updating configuration and scripts.
 *
 * @module lib/upgrader
 */

const fs = require('fs');
const path = require('path');

// Shared utilities
const { findProjectRoot, copyDir, safeReadJson } = require('./utils');

// Package info
const packageJson = require('../package.json');
const CURRENT_VERSION = packageJson.version;
const PACKAGE_ROOT = path.resolve(__dirname, '..');

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
  const options = {
    force: false,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--dry-run' || arg === '-n') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Usage: flow upgrade [options]

Upgrade Wogi Flow in the current project.

Options:
  --force, -f         Force upgrade even if versions match
  --dry-run, -n       Show what would be changed without making changes
  --help, -h          Show this help message

The upgrade process:
  1. Backs up current configuration
  2. Updates scripts to latest version
  3. Migrates configuration if needed
  4. Updates templates and agents
  5. Preserves user state files

Examples:
  flow upgrade                 # Upgrade current project
  flow upgrade --dry-run       # Preview changes
  flow upgrade --force         # Force re-upgrade
`);
}

// findProjectRoot is imported from ./utils

/**
 * Get current project version
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} Version string or null
 */
function getProjectVersion(projectRoot) {
  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  const config = safeReadJson(configPath);
  return config?.version || null;
}

/**
 * Compare versions
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
}

/**
 * Create a backup of the current configuration
 * @param {string} projectRoot - Project root directory
 * @param {boolean} dryRun - If true, only show what would be done
 * @returns {string|null} Backup directory path or null
 */
function createBackup(projectRoot, dryRun) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(projectRoot, '.workflow', 'backups', timestamp);

  if (dryRun) {
    console.log(`  Would create backup at: ${backupDir}`);
    return backupDir;
  }

  fs.mkdirSync(backupDir, { recursive: true });

  // Backup config.json
  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, path.join(backupDir, 'config.json'));
  }

  console.log(`  Created backup at: ${backupDir}`);
  return backupDir;
}

// copyDir is imported from ./utils (with dryRun support)

/**
 * Update scripts directory
 * @param {string} projectRoot - Project root directory
 * @param {boolean} dryRun - If true, only show what would be done
 */
function updateScripts(projectRoot, dryRun) {
  const packageScripts = path.join(PACKAGE_ROOT, 'scripts');
  const projectScripts = path.join(projectRoot, 'scripts');

  if (!fs.existsSync(packageScripts)) {
    console.log('  Warning: Package scripts not found');
    return;
  }

  if (dryRun) {
    console.log(`  Would update: scripts/`);
    return;
  }

  // Copy all scripts
  copyDir(packageScripts, projectScripts, false);

  // Make flow script executable
  const flowScript = path.join(projectScripts, 'flow');
  if (fs.existsSync(flowScript)) {
    fs.chmodSync(flowScript, '755');
  }

  console.log('  Updated scripts/');
}

/**
 * Update templates
 * @param {string} projectRoot - Project root directory
 * @param {boolean} dryRun - If true, only show what would be done
 */
function updateTemplates(projectRoot, dryRun) {
  const packageTemplates = path.join(PACKAGE_ROOT, '.workflow', 'templates');
  const projectTemplates = path.join(projectRoot, '.workflow', 'templates');

  if (fs.existsSync(packageTemplates)) {
    if (dryRun) {
      console.log('  Would update: .workflow/templates/');
    } else {
      copyDir(packageTemplates, projectTemplates, false);
      console.log('  Updated .workflow/templates/');
    }
  }
}

/**
 * Update agents
 * @param {string} projectRoot - Project root directory
 * @param {boolean} dryRun - If true, only show what would be done
 */
function updateAgents(projectRoot, dryRun) {
  const packageAgents = path.join(PACKAGE_ROOT, '.workflow', 'agents');
  const projectAgents = path.join(projectRoot, '.workflow', 'agents');

  if (fs.existsSync(packageAgents)) {
    if (dryRun) {
      console.log('  Would update: .workflow/agents/');
    } else {
      copyDir(packageAgents, projectAgents, false);
      console.log('  Updated .workflow/agents/');
    }
  }
}

/**
 * Update bridges
 * @param {string} projectRoot - Project root directory
 * @param {boolean} dryRun - If true, only show what would be done
 */
function updateBridges(projectRoot, dryRun) {
  const packageBridges = path.join(PACKAGE_ROOT, '.workflow', 'bridges');
  const projectBridges = path.join(projectRoot, '.workflow', 'bridges');

  if (fs.existsSync(packageBridges)) {
    if (dryRun) {
      console.log('  Would update: .workflow/bridges/');
    } else {
      copyDir(packageBridges, projectBridges, false);
      console.log('  Updated .workflow/bridges/');
    }
  }
}

/**
 * Update configuration version
 * @param {string} projectRoot - Project root directory
 * @param {boolean} dryRun - If true, only show what would be done
 */
function updateConfigVersion(projectRoot, dryRun) {
  const configPath = path.join(projectRoot, '.workflow', 'config.json');

  const config = safeReadJson(configPath);
  if (!config) {
    console.log('  Warning: config.json not found or invalid');
    return;
  }

  if (dryRun) {
    console.log(`  Would update version in config.json to ${CURRENT_VERSION}`);
    return;
  }

  try {
    config.version = CURRENT_VERSION;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`  Updated config.json version to ${CURRENT_VERSION}`);
  } catch (err) {
    console.log(`  Warning: Could not update config.json: ${err.message}`);
  }
}

/**
 * Run version-specific migrations
 * @param {string} projectRoot - Project root directory
 * @param {string} fromVersion - Current version
 * @param {string} toVersion - Target version
 * @param {boolean} dryRun - If true, only show what would be done
 */
function runMigrations(projectRoot, fromVersion, toVersion, dryRun) {
  // Define migrations for specific version ranges
  const migrations = [
    {
      from: '1.0.0',
      to: '1.5.0',
      name: 'Add state directory',
      run: (root) => {
        const stateDir = path.join(root, '.workflow', 'state');
        if (!fs.existsSync(stateDir)) {
          fs.mkdirSync(stateDir, { recursive: true });
        }
      }
    },
    {
      from: '1.5.0',
      to: '1.9.0',
      name: 'Add models directory',
      run: (root) => {
        const modelsDir = path.join(root, '.workflow', 'models');
        if (!fs.existsSync(modelsDir)) {
          fs.mkdirSync(modelsDir, { recursive: true });
        }
      }
    }
    // Add more migrations as needed
  ];

  // Find applicable migrations
  const applicable = migrations.filter(m => {
    return compareVersions(fromVersion, m.from) >= 0 &&
           compareVersions(fromVersion, m.to) < 0 &&
           compareVersions(toVersion, m.to) >= 0;
  });

  if (applicable.length === 0) {
    console.log('  No migrations needed');
    return;
  }

  console.log(`  Running ${applicable.length} migration(s):`);

  for (const migration of applicable) {
    if (dryRun) {
      console.log(`    Would run: ${migration.name}`);
    } else {
      try {
        migration.run(projectRoot);
        console.log(`    ✓ ${migration.name}`);
      } catch (err) {
        console.log(`    ✗ ${migration.name}: ${err.message}`);
      }
    }
  }
}

/**
 * Main upgrade function
 * @param {string[]} args - Command line arguments
 */
async function upgrade(args) {
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    console.error('Error: Not in a Wogi Flow project');
    console.error('Use `flow init` to initialize a new project');
    process.exit(1);
  }

  const currentVersion = getProjectVersion(projectRoot);

  if (!currentVersion) {
    console.error('Error: Could not determine project version');
    console.error('The .workflow/config.json may be missing or invalid');
    process.exit(1);
  }

  console.log('\n🔄 Wogi Flow Upgrader\n');
  console.log(`  Current version: ${currentVersion}`);
  console.log(`  Target version:  ${CURRENT_VERSION}`);

  if (options.dryRun) {
    console.log('\n  (Dry run - no changes will be made)\n');
  }

  // Check if upgrade is needed
  const comparison = compareVersions(currentVersion, CURRENT_VERSION);

  if (comparison === 0 && !options.force) {
    console.log('\n✓ Project is already at the latest version');
    return;
  }

  if (comparison > 0) {
    console.log('\n⚠ Project version is newer than package version');
    console.log('  This may indicate a development version.');
    if (!options.force) {
      console.log('  Use --force to downgrade');
      return;
    }
  }

  console.log('\nUpgrading...\n');

  // Create backup
  createBackup(projectRoot, options.dryRun);

  // Run migrations
  runMigrations(projectRoot, currentVersion, CURRENT_VERSION, options.dryRun);

  // Update components
  updateScripts(projectRoot, options.dryRun);
  updateTemplates(projectRoot, options.dryRun);
  updateAgents(projectRoot, options.dryRun);
  updateBridges(projectRoot, options.dryRun);

  // Update version in config
  updateConfigVersion(projectRoot, options.dryRun);

  if (options.dryRun) {
    console.log('\n✓ Dry run complete - no changes made');
  } else {
    console.log('\n✅ Upgrade complete!\n');
    console.log('Next steps:');
    console.log('  1. Review changes in .workflow/');
    console.log('  2. Run `./scripts/flow health` to verify installation');
    console.log('  3. Commit the upgraded files');
  }
}

module.exports = { upgrade };
