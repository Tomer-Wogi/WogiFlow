#!/usr/bin/env node

/**
 * Wogi Flow - Setup Check (Core Hook)
 *
 * Checks if WogiFlow needs initial setup and returns
 * context for the AI to act on.
 *
 * This hook detects the pending-setup.json marker file
 * created by postinstall and prompts the AI to run setup.
 */

const path = require('path');
const fs = require('fs');

// Import from flow-utils for consistent paths and safe JSON parsing
const { safeJsonParse, PATHS } = require('../../flow-utils');

// State paths using PATHS for consistency across the codebase
const PENDING_SETUP_PATH = path.join(PATHS.state, 'pending-setup.json');
const CONFIG_PATH = PATHS.config;

/**
 * Check if setup is pending
 * @returns {boolean}
 */
function isSetupPending() {
  // If config.json exists, setup is complete
  if (fs.existsSync(CONFIG_PATH)) {
    return false;
  }

  // Check for pending-setup marker
  if (fs.existsSync(PENDING_SETUP_PATH)) {
    const marker = safeJsonParse(PENDING_SETUP_PATH, { status: 'pending_ai_setup' });
    return marker.status === 'pending_ai_setup';
  }

  // No config and no marker - still needs setup
  return true;
}

/**
 * Get pending setup info
 * @returns {Object|null}
 */
function getPendingSetupInfo() {
  if (!isSetupPending()) {
    return null;
  }

  if (fs.existsSync(PENDING_SETUP_PATH)) {
    return safeJsonParse(PENDING_SETUP_PATH, {
      status: 'pending_ai_setup',
      projectRoot: process.cwd()
    });
  }

  // Return default info if marker doesn't exist
  return {
    status: 'pending_ai_setup',
    projectRoot: process.cwd()
  };
}

/**
 * Get setup context for AI injection
 * Returns null if setup is not needed, otherwise returns context object
 *
 * @returns {Object|null} Setup context or null
 */
function getSetupContext() {
  const pendingInfo = getPendingSetupInfo();

  if (!pendingInfo) {
    return null;
  }

  // Detect project name from package.json if available
  let projectName = null;
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = safeJsonParse(pkgPath, {});
    projectName = pkg.name || null;
  }

  return {
    needsSetup: true,
    pendingInfo,
    projectName,
    suggestedCommand: '/wogi-init',
    message: 'WogiFlow needs initial setup. Run /wogi-init or say "setup wogiflow" to configure.',
    priority: 'high'
  };
}

/**
 * Clear pending setup marker (called after setup completes)
 * @returns {boolean} Success
 */
function clearPendingSetup() {
  try {
    if (fs.existsSync(PENDING_SETUP_PATH)) {
      fs.unlinkSync(PENDING_SETUP_PATH);
    }
    return true;
  } catch (err) {
    // Log but don't throw - setup marker removal is best-effort
    console.error(`[clearPendingSetup] Failed to remove marker: ${err.message}`);
    return false;
  }
}

/**
 * Format setup context for display/injection
 * @param {Object} context - Setup context from getSetupContext()
 * @returns {string} Formatted message
 */
function formatSetupMessage(context) {
  if (!context || !context.needsSetup) {
    return '';
  }

  let message = '## WogiFlow Setup Required\n\n';
  message += 'WogiFlow has been installed but needs configuration.\n\n';

  if (context.projectName) {
    message += `Detected project: **${context.projectName}**\n\n`;
  }

  message += 'To complete setup, run `/wogi-init` or say "setup wogiflow".\n\n';
  message += 'The setup wizard will:\n';
  message += '- Confirm your project name\n';
  message += '- Ask about importing patterns from other projects\n';
  message += '- Guide you through tech stack selection\n';
  message += '- Generate skills and rules for your stack\n';

  return message;
}

module.exports = {
  isSetupPending,
  getPendingSetupInfo,
  getSetupContext,
  clearPendingSetup,
  formatSetupMessage,

  // Paths for external use
  PENDING_SETUP_PATH,
  CONFIG_PATH
};
