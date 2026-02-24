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

/**
 * Register an extension's hook module.
 * @param {string} name - Extension name (e.g., 'teams')
 * @param {Object} hookModule - Module object with hook functions
 * @returns {boolean} True if registered, false if already exists
 */
function register(name, hookModule) {
  if (!name || typeof name !== 'string') {
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
