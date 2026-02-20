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

  // Early return for empty/missing file path (no file to check)
  if (!filePath) {
    return {
      enabled: true,
      needsSync: false,
      message: null
    };
  }

  const configPath = path.join(projectRoot, '.workflow', 'config.json');
  const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
  const settingsSharedPath = path.join(projectRoot, '.claude', 'settings.json');

  // Validate filePath is within projectRoot (defense-in-depth per security rules §4)
  const normalizedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(projectRoot);
  if (!normalizedPath.startsWith(resolvedRoot + path.sep) && normalizedPath !== resolvedRoot) {
    return {
      enabled: true,
      needsSync: false,
      message: null
    };
  }

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
    // Load bridge state module once (fixes double-require)
    let bridgeState = null;
    try {
      bridgeState = require('../../flow-bridge-state');
    } catch {
      // Bridge state module unavailable
    }

    let needsSync = false;
    if (bridgeState) {
      try {
        needsSync = bridgeState.hasConfigChanged();
      } catch {
        needsSync = true;
      }
    } else {
      // Module unavailable - assume sync needed
      needsSync = true;
    }

    if (needsSync) {
      // Attempt non-blocking bridge sync
      let syncAttempted = false;
      if (bridgeState) {
        try {
          bridgeState.autoSyncBridge('claude-code', { silent: true }).catch(() => {});
          syncAttempted = true;
        } catch {
          // Sync failed
        }
      }

      return {
        enabled: true,
        needsSync: true,
        message: syncAttempted
          ? 'WogiFlow config changed mid-session. Bridge re-synced to update CLAUDE.md.'
          : 'WogiFlow config changed mid-session. Bridge sync unavailable - CLAUDE.md may be stale.'
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
