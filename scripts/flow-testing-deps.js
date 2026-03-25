#!/usr/bin/env node

/**
 * Wogi Flow - Testing Dependency Checker & Lazy Installer
 *
 * Checks whether required testing dependencies are installed and installs
 * them on demand when testing features are actually invoked.
 *
 * This script is NEVER called during normal workflow execution.
 * It is only invoked when a user explicitly triggers a testing feature
 * and the required packages are missing.
 *
 * Usage (as library):
 *   const { checkDeps, installDeps, ensureDeps } = require('./flow-testing-deps');
 *
 *   // Check if deps for UI testing are present
 *   const status = checkDeps('ui');
 *
 *   // Install missing deps (interactive — asks user first)
 *   const result = await installDeps('ui');
 *
 *   // Check + install if missing, return status
 *   const ready = await ensureDeps('ui');
 */

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { getProjectRoot, PATHS } = require('./flow-utils');

// ============================================================
// Dependency Definitions
// ============================================================

/**
 * Testing dependency requirements per mode.
 * Each mode lists required npm packages and optional postInstall commands.
 */
const TESTING_DEPS = {
  ui: {
    required: ['@playwright/mcp'],
    postInstall: ['npx playwright install chromium'],
    description: 'UI testing via Playwright MCP'
  },
  api: {
    required: [],
    optional: [],
    postInstall: [],
    description: 'API testing via direct HTTP (no extra deps needed)'
  },
  unit: {
    required: [],
    optional: ['vitest', 'jest'],
    postInstall: [],
    description: 'Unit testing (uses project-configured test runner)'
  },
  full: {
    required: ['@playwright/mcp'],
    postInstall: ['npx playwright install chromium'],
    description: 'Full testing suite (UI + API + unit)'
  }
};

// ============================================================
// Dependency Checking
// ============================================================

/**
 * Check if a specific npm package is installed in the project.
 *
 * @param {string} packageName - npm package name
 * @param {string} [projectRoot] - Project root directory
 * @returns {boolean} true if the package is installed
 */
function isPackageInstalled(packageName, projectRoot) {
  const root = projectRoot || getProjectRoot();
  const nodeModulesPath = path.join(root, 'node_modules', ...packageName.split('/'));
  try {
    return fs.existsSync(nodeModulesPath);
  } catch (err) {
    return false;
  }
}

/**
 * Check whether all required dependencies for a testing mode are installed.
 *
 * @param {string} mode - Testing mode: 'ui', 'api', 'unit', 'full'
 * @param {string} [projectRoot] - Project root directory
 * @returns {{ ready: boolean, missing: string[], installed: string[], mode: string }}
 */
function checkDeps(mode, projectRoot) {
  const root = projectRoot || getProjectRoot();
  const depsConfig = TESTING_DEPS[mode];

  if (!depsConfig) {
    return { ready: false, missing: [], installed: [], mode, error: `Unknown testing mode: ${mode}` };
  }

  const required = depsConfig.required || [];
  const missing = [];
  const installed = [];

  for (const pkg of required) {
    if (isPackageInstalled(pkg, root)) {
      installed.push(pkg);
    } else {
      missing.push(pkg);
    }
  }

  return {
    ready: missing.length === 0,
    missing,
    installed,
    mode,
    description: depsConfig.description
  };
}

// ============================================================
// Dependency Installation
// ============================================================

/**
 * Install missing testing dependencies for a given mode.
 *
 * This function does NOT auto-install. It returns an install plan
 * that callers can present to the user for approval before executing.
 *
 * @param {string} mode - Testing mode: 'ui', 'api', 'unit', 'full'
 * @param {string} [projectRoot] - Project root directory
 * @returns {{ success: boolean, installed: string[], failed: string[], commands: string[] }}
 */
function installDeps(mode, projectRoot) {
  const root = projectRoot || getProjectRoot();
  const status = checkDeps(mode, root);

  if (status.ready) {
    return { success: true, installed: [], failed: [], commands: [], message: 'All dependencies already installed' };
  }

  if (status.error) {
    return { success: false, installed: [], failed: [], commands: [], message: status.error };
  }

  const depsConfig = TESTING_DEPS[mode];
  const commands = [];
  const installed = [];
  const failed = [];

  // Build npm install command for missing packages
  if (status.missing.length > 0) {
    const installCmd = `npm install -D ${status.missing.join(' ')}`;
    commands.push(installCmd);

    try {
      execSync(installCmd, { cwd: root, stdio: 'pipe', timeout: 120000 });
      installed.push(...status.missing);
    } catch (err) {
      failed.push(...status.missing);
      return {
        success: false,
        installed,
        failed,
        commands,
        message: `Failed to install: ${failed.join(', ')}`
      };
    }
  }

  // Run postInstall commands
  const postInstallCmds = depsConfig.postInstall || [];
  for (const cmd of postInstallCmds) {
    commands.push(cmd);
    try {
      execSync(cmd, { cwd: root, stdio: 'pipe', timeout: 300000 });
    } catch (err) {
      // postInstall failures are non-fatal but worth noting
      return {
        success: true,
        installed,
        failed,
        commands,
        message: `Packages installed but postInstall command failed: ${cmd}`
      };
    }
  }

  return {
    success: true,
    installed,
    failed,
    commands,
    message: `Successfully installed: ${installed.join(', ')}`
  };
}

/**
 * Ensure all testing dependencies for a mode are available.
 *
 * Checks first, then installs if missing. Returns final status.
 * Callers should present the install plan to the user before calling
 * this with `autoInstall: true`.
 *
 * @param {string} mode - Testing mode: 'ui', 'api', 'unit', 'full'
 * @param {object} [options] - Options
 * @param {boolean} [options.autoInstall=false] - If true, install without asking
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {{ ready: boolean, status: object, installResult: object|null }}
 */
function ensureDeps(mode, options = {}) {
  const { autoInstall = false, projectRoot } = options;
  const root = projectRoot || getProjectRoot();

  const status = checkDeps(mode, root);

  if (status.ready) {
    return { ready: true, status, installResult: null };
  }

  if (!autoInstall) {
    return {
      ready: false,
      status,
      installResult: null,
      installPlan: {
        packages: status.missing,
        commands: buildInstallCommands(mode, status.missing),
        description: `To enable ${status.description}, the following packages need to be installed: ${status.missing.join(', ')}`
      }
    };
  }

  const installResult = installDeps(mode, root);
  const finalStatus = checkDeps(mode, root);

  return {
    ready: finalStatus.ready,
    status: finalStatus,
    installResult
  };
}

/**
 * Build the list of commands that would be run to install deps (for preview).
 *
 * @param {string} mode - Testing mode
 * @param {string[]} missingPkgs - Missing package names
 * @returns {string[]} Commands that would be executed
 */
function buildInstallCommands(mode, missingPkgs) {
  const commands = [];
  const depsConfig = TESTING_DEPS[mode];

  if (missingPkgs.length > 0) {
    commands.push(`npm install -D ${missingPkgs.join(' ')}`);
  }

  if (depsConfig && depsConfig.postInstall) {
    commands.push(...depsConfig.postInstall);
  }

  return commands;
}

/**
 * Get information about available testing modes and their requirements.
 *
 * @returns {object} Map of mode name to { required, optional, description }
 */
function getAvailableModes() {
  const modes = {};
  for (const [mode, config] of Object.entries(TESTING_DEPS)) {
    modes[mode] = {
      required: config.required || [],
      optional: config.optional || [],
      description: config.description,
      hasPostInstall: (config.postInstall || []).length > 0
    };
  }
  return modes;
}

// ============================================================
// CLI
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const mode = args[1] || 'ui';

  switch (command) {
    case 'status':
    case 'check': {
      const status = checkDeps(mode);
      console.log(`Testing deps status (${mode}):`);
      console.log(`  Ready: ${status.ready}`);
      if (status.installed.length > 0) {
        console.log(`  Installed: ${status.installed.join(', ')}`);
      }
      if (status.missing.length > 0) {
        console.log(`  Missing: ${status.missing.join(', ')}`);
      }
      process.exit(status.ready ? 0 : 1);
    }

    case 'modes': {
      const modes = getAvailableModes();
      console.log('Available testing modes:');
      for (const [name, info] of Object.entries(modes)) {
        console.log(`  ${name}: ${info.description}`);
        if (info.required.length > 0) {
          console.log(`    Required: ${info.required.join(', ')}`);
        }
      }
      break;
    }

    case 'install': {
      const result = installDeps(mode);
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    }

    default:
      console.log(`Usage: flow-testing-deps.js [check|install|modes] [mode]`);
      console.log('  Modes: ui, api, unit, full');
      process.exit(0);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  TESTING_DEPS,
  checkDeps,
  installDeps,
  ensureDeps,
  getAvailableModes,
  isPackageInstalled,
  buildInstallCommands
};
