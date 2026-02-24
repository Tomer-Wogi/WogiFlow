'use strict';

/**
 * Extension Hook Registry
 *
 * Allows third-party packages (e.g., @wogiflow/teams) to register custom
 * hook modules that integrate with WogiFlow's core hook system.
 *
 * Extensions register via:
 *   const { extensionRegistry } = require('wogiflow/scripts/hooks/core');
 *   extensionRegistry.register('teams', myHookModule);
 *
 * Core code queries via:
 *   extensionRegistry.getExtension('teams');
 *   extensionRegistry.getAllExtensions();
 */

const registeredExtensions = new Map();

// Extension names must be DNS-label-like: lowercase alphanumeric + hyphens, no trailing hyphens, max 64 chars
const VALID_EXTENSION_NAME = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Register an extension's hook module.
 * Note: This registry is in-process only — each hook invocation runs in a fresh
 * Node.js process, so registrations do not persist across hook calls.
 * For cross-invocation extension state, use settings.json (as postinstall.js does).
 *
 * @param {string} name - Extension name (e.g., 'teams')
 * @param {Object} hookModule - Module object with hook functions
 * @returns {boolean} True if registered, false if already exists
 */
function register(name, hookModule) {
  if (!name || typeof name !== 'string' || !VALID_EXTENSION_NAME.test(name)) {
    if (process.env.DEBUG) {
      console.error(`[extension-registry] Invalid extension name: ${name}`);
    }
    return false;
  }

  if (!hookModule || typeof hookModule !== 'object') {
    if (process.env.DEBUG) {
      console.error(`[extension-registry] Invalid hook module for: ${name}`);
    }
    return false;
  }

  if (registeredExtensions.has(name)) {
    if (process.env.DEBUG) {
      console.error(`[extension-registry] Extension already registered: ${name}`);
    }
    return false;
  }

  registeredExtensions.set(name, hookModule);
  return true;
}

/**
 * Get a registered extension by name.
 * @param {string} name - Extension name
 * @returns {Object|null} Hook module or null if not registered
 */
function getExtension(name) {
  return registeredExtensions.get(name) || null;
}

/**
 * Get all registered extensions.
 * @returns {Array<[string, Object]>} Array of [name, module] pairs
 */
function getAllExtensions() {
  return Array.from(registeredExtensions.entries());
}

/**
 * Check if an extension is registered.
 * @param {string} name - Extension name
 * @returns {boolean}
 */
function isRegistered(name) {
  return registeredExtensions.has(name);
}

module.exports = {
  register,
  getExtension,
  getAllExtensions,
  isRegistered
};
