#!/usr/bin/env node

/**
 * Wogi Flow - Setup Handler (Core Module)
 *
 * CLI-agnostic setup and maintenance logic.
 * Called when CLIs trigger setup events (e.g., Claude Code --init).
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

// Import from parent scripts directory
const { getConfig, PATHS, fileExists } = require('../../flow-utils');
const { getSetupContext } = require('./setup-check');

/**
 * Check if setup handling is enabled
 * @returns {boolean}
 */
function isSetupEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.setup?.enabled !== false;
}

/**
 * Get setup configuration
 * @returns {Object}
 */
function getSetupConfig() {
  const config = getConfig();
  return {
    enabled: true,
    autoOnboard: false,  // Default to false - show instructions rather than auto-run
    maintenanceTasks: ['healthCheck'],
    ...(config.hooks?.rules?.setup || {})
  };
}

/**
 * Handle setup event (triggered by CLI --init or similar)
 *
 * @param {Object} options
 * @param {string} options.trigger - What triggered setup ('init', 'init-only', 'maintenance')
 * @param {string} options.cwd - Current working directory
 * @returns {Object} Result: { needsSetup, message, action, context }
 */
function handleSetup(options = {}) {
  const { trigger = 'init' } = options;

  if (!isSetupEnabled()) {
    return {
      needsSetup: false,
      message: null,
      action: 'none',
      reason: 'setup_disabled'
    };
  }

  // Check if setup is actually needed
  const setupContext = getSetupContext();

  if (!setupContext || !setupContext.needsSetup) {
    // Already configured - provide status message
    return {
      needsSetup: false,
      message: 'Wogi Flow is already configured for this project.',
      action: 'none',
      reason: 'already_configured',
      context: {
        configExists: fileExists(PATHS.config),
        projectRoot: PATHS.root
      }
    };
  }

  const setupConfig = getSetupConfig();

  // Return setup context for the AI to act on
  // The actual setup is done by /wogi-init or flow onboard commands
  return {
    needsSetup: true,
    message: formatSetupInstructions(setupContext, setupConfig),
    action: setupConfig.autoOnboard ? 'auto_onboard' : 'show_instructions',
    suggestedCommand: '/wogi-init',
    context: setupContext,
    reason: 'setup_pending'
  };
}

/**
 * Handle maintenance event (triggered by CLI --maintenance)
 *
 * @param {Object} options
 * @returns {Object} Result: { tasks, message, results }
 */
function handleMaintenance(options = {}) {
  if (!isSetupEnabled()) {
    return {
      tasks: [],
      message: null,
      reason: 'setup_disabled'
    };
  }

  const config = getSetupConfig();
  const tasks = config.maintenanceTasks || ['healthCheck'];
  const results = [];

  // Run configured maintenance tasks
  for (const task of tasks) {
    switch (task) {
      case 'healthCheck':
        results.push({
          task: 'healthCheck',
          status: 'suggest',
          message: 'Run /wogi-health to check workflow health'
        });
        break;

      case 'archiveOldLogs':
        results.push({
          task: 'archiveOldLogs',
          status: 'suggest',
          message: 'Run flow log archive to archive old request log entries'
        });
        break;

      case 'cleanupLocks':
        // Actually clean up stale locks
        try {
          const { cleanupStaleLocks } = require('../../flow-utils');
          const cleaned = cleanupStaleLocks();
          results.push({
            task: 'cleanupLocks',
            status: 'completed',
            message: `Cleaned up ${cleaned} stale lock files`
          });
        } catch (err) {
          results.push({
            task: 'cleanupLocks',
            status: 'error',
            message: `Failed to clean locks: ${err.message}`
          });
        }
        break;

      default:
        results.push({
          task,
          status: 'unknown',
          message: `Unknown maintenance task: ${task}`
        });
    }
  }

  return {
    tasks,
    results,
    message: formatMaintenanceResults(results),
    reason: 'maintenance_complete'
  };
}

/**
 * Format setup instructions for display
 */
function formatSetupInstructions(context, config) {
  let msg = '## Wogi Flow Setup Required\n\n';
  msg += 'Wogi Flow has been installed but needs configuration.\n\n';

  if (context.projectName) {
    msg += `Detected project: **${context.projectName}**\n\n`;
  }

  if (config.autoOnboard) {
    msg += 'Auto-onboard is enabled. Running setup automatically...\n';
  } else {
    msg += 'To complete setup, run `/wogi-init` or say "setup wogiflow".\n\n';
    msg += 'The setup wizard will:\n';
    msg += '- Confirm your project name\n';
    msg += '- Ask about importing patterns from other projects\n';
    msg += '- Guide you through tech stack selection\n';
    msg += '- Generate skills and rules for your stack\n';
  }

  return msg;
}

/**
 * Format maintenance results for display
 */
function formatMaintenanceResults(results) {
  if (results.length === 0) {
    return 'No maintenance tasks configured.';
  }

  let msg = '## Maintenance Results\n\n';

  for (const result of results) {
    const icon = result.status === 'completed' ? '✓' :
                 result.status === 'suggest' ? '→' :
                 result.status === 'error' ? '✗' : '?';
    msg += `${icon} **${result.task}**: ${result.message}\n`;
  }

  return msg;
}

module.exports = {
  isSetupEnabled,
  getSetupConfig,
  handleSetup,
  handleMaintenance,
  formatSetupInstructions,
  formatMaintenanceResults
};
