#!/usr/bin/env node

/**
 * Wogi Flow - Config Set
 *
 * Sets a configuration value in config.json with proper cache invalidation.
 * Replaces jq calls in the main flow script to ensure cache consistency.
 *
 * Usage: node flow-config-set.js <key.path> <value>
 *
 * Examples:
 *   node flow-config-set.js parallel.enabled true
 *   node flow-config-set.js hybrid.model "qwen3"
 *   node flow-config-set.js worktree.autoCleanupHours 48
 */

const {
  PATHS,
  readJson,
  withLock,
  invalidateConfigCache,
  color,
  success,
  error
} = require('./flow-utils');

/**
 * Parse a value string to the appropriate type
 */
function parseValue(valueStr) {
  // Boolean
  if (valueStr === 'true') return true;
  if (valueStr === 'false') return false;

  // Null
  if (valueStr === 'null') return null;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(valueStr)) {
    return parseFloat(valueStr);
  }

  // JSON object or array
  if ((valueStr.startsWith('{') && valueStr.endsWith('}')) ||
      (valueStr.startsWith('[') && valueStr.endsWith(']'))) {
    try {
      return JSON.parse(valueStr);
    } catch {
      // Not valid JSON, treat as string
    }
  }

  // String (remove quotes if present)
  if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
      (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
    return valueStr.slice(1, -1);
  }

  return valueStr;
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;

  return obj;
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

async function main() {
  const keyPath = process.argv[2];
  const valueStr = process.argv[3];

  if (!keyPath) {
    console.log('Usage: flow-config-set <key.path> [value]');
    console.log('');
    console.log('Examples:');
    console.log('  flow-config-set parallel.enabled true');
    console.log('  flow-config-set hybrid.model "qwen3"');
    console.log('  flow-config-set worktree.autoCleanupHours 48');
    console.log('');
    console.log('If no value is provided, prints the current value.');
    process.exit(1);
  }

  // Load config (read-only, no lock needed)
  const config = readJson(PATHS.config, {});

  // If no value provided, just print current value
  if (valueStr === undefined) {
    const currentValue = getNestedValue(config, keyPath);
    if (currentValue === undefined) {
      console.log(color('yellow', `${keyPath} is not set`));
    } else {
      console.log(JSON.stringify(currentValue, null, 2));
    }
    process.exit(0);
  }

  // Parse the value
  const value = parseValue(valueStr);
  const oldValue = getNestedValue(config, keyPath);

  // Use file lock to prevent race conditions during write
  try {
    await withLock(PATHS.config, () => {
      // Re-read config after acquiring lock (may have changed)
      const freshConfig = readJson(PATHS.config, {});
      setNestedValue(freshConfig, keyPath, value);

      // Write config using fs directly (withLock handles the file)
      const fs = require('fs');
      fs.writeFileSync(PATHS.config, JSON.stringify(freshConfig, null, 2));
      invalidateConfigCache();
    });

    // Output result
    if (oldValue === undefined) {
      success(`Set ${keyPath} = ${JSON.stringify(value)}`);
    } else {
      success(`Changed ${keyPath}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
    }
  } catch (err) {
    error(`Failed to update config: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
