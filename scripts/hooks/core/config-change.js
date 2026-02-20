#!/usr/bin/env node

/**
 * Wogi Flow - ConfigChange Hook Core Logic
 *
 * Handles the ConfigChange event fired when configuration files
 * change during a session (Claude Code latest release feature).
 *
 * Detects changes to .workflow/config.json and re-syncs the bridge
 * if needed, ensuring CLAUDE.md stays current mid-session.
 */

const path = require('path');
const fs = require('fs');

/**
 * Handle a config change event.
 *
 * @param {Object} options
 * @param {string} options.filePath - Path of the changed config file
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} Result with message and whether bridge sync is needed
 */
function handleConfigChange(options = {}) {
  const { filePath = '', projectRoot = process.cwd() } = options;

  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
  const settingsSharedPath = path.join(projectRoot, '.claude', 'settings.json');

  // Determine which config file changed
  const normalizedPath = path.resolve(filePath);
  const isWorkflowConfig = normalizedPath === path.resolve(configPath);
  const isClaudeSettings = normalizedPath === path.resolve(settingsPath)
    || normalizedPath === path.resolve(settingsSharedPath);

  if (!isWorkflowConfig && !isClaudeSettings) {
    // Not a config file we care about
    return {
      enabled: true,
      needsSync: false,
      message: null
    };
  }

  if (isWorkflowConfig) {
    // Workflow config changed - check if bridge needs re-sync
    let needsSync = false;
    try {
      const { hasConfigChanged } = require('../../flow-bridge-state');
      needsSync = hasConfigChanged();
    } catch {
      // Bridge state module unavailable - assume sync needed
      needsSync = true;
    }

    if (needsSync) {
      // Attempt non-blocking bridge sync
      try {
        const { autoSyncBridge } = require('../../flow-bridge-state');
        autoSyncBridge('claude-code', { silent: true }).catch(() => {});
      } catch {
        // Sync unavailable - warn only
      }

      return {
        enabled: true,
        needsSync: true,
        message: 'WogiFlow config changed mid-session. Bridge re-synced to update CLAUDE.md.'
      };
    }

    return {
      enabled: true,
      needsSync: false,
      message: null
    };
  }

  // Claude settings changed - informational only
  return {
    enabled: true,
    needsSync: false,
    message: 'Claude Code settings changed. Changes will take effect on next hook invocation.'
  };
}

module.exports = { handleConfigChange };
