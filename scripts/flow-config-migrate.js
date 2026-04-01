#!/usr/bin/env node

/**
 * Wogi Flow - Config Migration
 *
 * Migrates existing config.json files when defaults change between versions.
 * Without this, users who update WogiFlow keep stale defaults forever because
 * deepMerge(defaults, userConfig) lets user values win — even when those
 * values are outdated defaults from a previous version.
 *
 * Migration strategy:
 * - Each migration has a version number (_configVersion)
 * - Migrations run in order from current version to latest
 * - Only keys that still match the OLD default are upgraded
 *   (user-customized values are preserved)
 * - _configVersion is written to config.json after migration
 *
 * Called from postinstall.js on every npm install/update.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Current config version — increment when adding new migrations */
const CURRENT_CONFIG_VERSION = 2;

/**
 * Migration definitions. Each migration specifies:
 * - version: the target _configVersion after this migration
 * - description: human-readable description
 * - migrate(config): function that modifies config in place
 *
 * IMPORTANT: Migrations must be SAFE for all users:
 * - Only upgrade keys that match the OLD default value
 * - Never overwrite user-customized values
 * - Use ensureKey() for additive changes (new keys)
 * - Use upgradeDefault() for changed defaults (old → new)
 */
const MIGRATIONS = [
  {
    version: 2,
    description: 'Enforcement defaults: enable standards, reuse blocking, verification proof gate, runtime verification config, gate latch',
    migrate(config) {
      // --- Standards compliance: false → true ---
      upgradeDefault(config, 'standardsCompliance.enabled', false, true);

      // --- Component reuse: blockOnSimilar false → true ---
      upgradeDefault(config, 'componentReuse.blockOnSimilar', false, true);

      // --- Add runtimeVerification config (new key) ---
      ensureKey(config, 'runtimeVerification', {
        enabled: true,
        autoGenerateTests: true,
        blockOnFailure: true,
        frontend: {
          method: 'webmcp',
          fallback: ['playwright', 'checklist'],
          devServerUrl: 'http://localhost:5173'
        },
        backend: {
          method: 'api-test',
          fallback: ['curl', 'checklist'],
          baseUrl: 'http://localhost:3000'
        },
        testOutput: 'tests/verification',
        persistTests: true
      });

      // --- Add enforcement.requireGateLatch (new key) ---
      ensureKey(config, 'enforcement.requireGateLatch', true);

      // --- Add verificationProof to quality gates ---
      addToGateList(config, 'feature', 'verificationProof');
      addToGateList(config, 'bugfix', 'verificationProof');
    }
  }
];

// ============================================================
// Migration Helpers
// ============================================================

/**
 * Get a nested value from an object using dot notation.
 * @param {Object} obj
 * @param {string} path - e.g., 'standardsCompliance.enabled'
 * @returns {*} The value, or undefined if not found
 */
function getNestedValue(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Set a nested value on an object using dot notation.
 * Creates intermediate objects if needed.
 * @param {Object} obj
 * @param {string} dotPath
 * @param {*} value
 */
function setNestedValue(obj, dotPath, value) {
  const parts = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const existing = current[parts[i]];
    if (existing == null || typeof existing !== 'object' || Array.isArray(existing)) {
      // Only overwrite non-objects (null, undefined, primitives, arrays)
      // to avoid corrupting existing nested config structures
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Upgrade a config value ONLY if it still matches the old default.
 * If the user customized it to something else, leave it alone.
 *
 * @param {Object} config
 * @param {string} dotPath - e.g., 'standardsCompliance.enabled'
 * @param {*} oldDefault - the value we're replacing
 * @param {*} newDefault - the new value to set
 * @returns {boolean} true if upgraded
 */
function upgradeDefault(config, dotPath, oldDefault, newDefault) {
  const current = getNestedValue(config, dotPath);

  // Only upgrade if value matches old default exactly
  if (current === oldDefault) {
    setNestedValue(config, dotPath, newDefault);
    return true;
  }

  // Value was customized or doesn't exist — leave it
  return false;
}

/**
 * Add a key to config if it doesn't exist.
 * Never overwrites existing values.
 *
 * @param {Object} config
 * @param {string} dotPath
 * @param {*} value
 * @returns {boolean} true if added
 */
function ensureKey(config, dotPath, value) {
  const current = getNestedValue(config, dotPath);
  if (current == null) {
    setNestedValue(config, dotPath, value);
    return true;
  }
  return false;
}

/**
 * Add a gate name to a quality gate list if not already present.
 *
 * @param {Object} config
 * @param {string} taskType - e.g., 'feature', 'bugfix'
 * @param {string} gateName - e.g., 'verificationProof'
 * @returns {boolean} true if added
 */
function addToGateList(config, taskType, gateName) {
  const gates = config.qualityGates?.[taskType]?.require;
  if (!Array.isArray(gates)) return false;
  if (gates.includes(gateName)) return false;

  // Insert before the last gate (usually standardsCompliance) for logical ordering
  const insertIndex = Math.max(0, gates.length - 1);
  gates.splice(insertIndex, 0, gateName);
  return true;
}

// ============================================================
// Public API
// ============================================================

/**
 * Run all pending migrations on a config object.
 *
 * @param {Object} config - The user's config.json content (mutated in place)
 * @returns {{ migrated: boolean, fromVersion: number, toVersion: number, applied: string[] }}
 */
function migrateConfig(config) {
  const currentVersion = config._configVersion ?? 1;
  const applied = [];

  if (currentVersion >= CURRENT_CONFIG_VERSION) {
    return { migrated: false, fromVersion: currentVersion, toVersion: currentVersion, applied };
  }

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      try {
        migration.migrate(config);
        applied.push(`v${migration.version}: ${migration.description}`);
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[config-migrate] Migration v${migration.version} failed: ${err.message}`);
        }
        // Continue with other migrations — partial upgrade is better than none
      }
    }
  }

  config._configVersion = CURRENT_CONFIG_VERSION;

  return {
    migrated: applied.length > 0,
    fromVersion: currentVersion,
    toVersion: CURRENT_CONFIG_VERSION,
    applied
  };
}

/**
 * Migrate config.json file on disk.
 * Safe to call multiple times — idempotent via _configVersion tracking.
 *
 * @param {string} configPath - Path to config.json
 * @returns {{ migrated: boolean, fromVersion: number, toVersion: number, applied: string[] }}
 */
function migrateConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return { migrated: false, fromVersion: 0, toVersion: 0, applied: [] };
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[config-migrate] Failed to read config: ${err.message}`);
    }
    return { migrated: false, fromVersion: 0, toVersion: 0, applied: [] };
  }

  const result = migrateConfig(config);

  if (result.migrated) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[config-migrate] Failed to write migrated config: ${err.message}`);
      }
    }
  }

  return result;
}

module.exports = {
  migrateConfig,
  migrateConfigFile,
  CURRENT_CONFIG_VERSION,
  // Export helpers for testing
  upgradeDefault,
  ensureKey,
  addToGateList,
  getNestedValue,
  setNestedValue
};
