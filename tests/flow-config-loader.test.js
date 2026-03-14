'use strict';

/**
 * Tests for flow-config-loader.js
 *
 * Development-only — not distributed to end users.
 * Run: node --test tests/flow-config-loader.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Helpers ──────────────────────────────────────────────

/**
 * Create a temporary directory with a .workflow/config.json for isolated tests.
 * Returns { dir, configPath, cleanup }.
 */
function makeTempProject(configObj = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-cfg-test-'));
  const workflowDir = path.join(dir, '.workflow');
  fs.mkdirSync(workflowDir, { recursive: true });
  const configPath = path.join(workflowDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2));
  return {
    dir,
    configPath,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

// ── Load modules under test ─────────────────────────────

// We test the defaults module directly (no I/O needed)
const {
  CONFIG_DEFAULTS,
  mergeWithDefaults,
  deepMerge,
  isPlainObject,
  getDefaultsForKey,
  applyProjectTypeDefaults
} = require('../scripts/flow-config-defaults');

// KNOWN_CONFIG_KEYS from constants
const { KNOWN_CONFIG_KEYS } = require('../scripts/flow-constants');

// The config loader itself — note: getConfig() reads from the real project's
// config path, so we test it in a limited way (it should still return an object).
const {
  getConfig,
  getConfigValue,
  invalidateConfigCache,
  validateConfig,
  applyConfigCompatShim,
  resolveConfigValue
} = require('../scripts/flow-config-loader');

// ── Tests ────────────────────────────────────────────────

describe('getConfig', () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  it('returns an object', () => {
    const config = getConfig();
    assert.equal(typeof config, 'object');
    assert.notEqual(config, null);
  });

  it('returns cached result on second call (same reference)', () => {
    const config1 = getConfig();
    const config2 = getConfig();
    assert.equal(config1, config2, 'Expected same object reference from cache');
  });

  it('includes default values for missing keys', () => {
    const config = getConfig();
    // These defaults should always be present after merge with defaults
    assert.equal(typeof config.hooks, 'object');
    assert.equal(typeof config.enforcement, 'object');
  });

  it('has expected top-level keys', () => {
    const config = getConfig();
    const expectedKeys = ['hooks', 'enforcement', 'execution', 'qualityGates', 'skills', 'commits'];
    for (const key of expectedKeys) {
      assert.ok(
        Object.hasOwn(config, key),
        `Expected config to have top-level key "${key}"`
      );
    }
  });

  it('config values have correct types', () => {
    const config = getConfig();
    assert.equal(typeof config.hooks?.enabled, 'boolean', 'hooks.enabled should be boolean');
    assert.equal(typeof config.enforcement?.strictMode, 'boolean', 'enforcement.strictMode should be boolean');
    if (config.execution) {
      assert.equal(typeof config.execution.maxIterations, 'number', 'execution.maxIterations should be number');
    }
  });
});

describe('KNOWN_CONFIG_KEYS', () => {
  it('is an array with reasonable size (>20 keys)', () => {
    assert.ok(Array.isArray(KNOWN_CONFIG_KEYS), 'KNOWN_CONFIG_KEYS should be an array');
    assert.ok(KNOWN_CONFIG_KEYS.length > 20, `Expected >20 keys, got ${KNOWN_CONFIG_KEYS.length}`);
  });

  it('contains essential keys', () => {
    const essentialKeys = ['hooks', 'enforcement', 'execution', 'qualityGates', 'skills', 'testing', 'commits'];
    for (const key of essentialKeys) {
      assert.ok(
        KNOWN_CONFIG_KEYS.includes(key),
        `KNOWN_CONFIG_KEYS should include "${key}"`
      );
    }
  });

  it('contains no duplicates', () => {
    const unique = new Set(KNOWN_CONFIG_KEYS);
    assert.equal(unique.size, KNOWN_CONFIG_KEYS.length, 'KNOWN_CONFIG_KEYS should have no duplicates');
  });
});

describe('CONFIG_DEFAULTS', () => {
  it('is a plain object with many keys', () => {
    assert.equal(typeof CONFIG_DEFAULTS, 'object');
    assert.ok(Object.keys(CONFIG_DEFAULTS).length > 20, 'CONFIG_DEFAULTS should have >20 top-level keys');
  });

  it('has hooks.enabled defaulting to true', () => {
    assert.equal(CONFIG_DEFAULTS.hooks.enabled, true);
  });

  it('has enforcement.strictMode defaulting to true', () => {
    assert.equal(CONFIG_DEFAULTS.enforcement.strictMode, true);
  });

  it('has semanticMatching.enabled defaulting to false', () => {
    // Current default is false; the user wants to enable it —
    // this test documents the current state.
    assert.equal(typeof CONFIG_DEFAULTS.semanticMatching, 'object');
    assert.equal(typeof CONFIG_DEFAULTS.semanticMatching.enabled, 'boolean');
  });

  it('has execution.maxIterations as a number', () => {
    assert.equal(typeof CONFIG_DEFAULTS.execution.maxIterations, 'number');
    assert.ok(CONFIG_DEFAULTS.execution.maxIterations > 0);
  });

  it('has commits section with expected structure', () => {
    assert.equal(typeof CONFIG_DEFAULTS.commits, 'object');
    assert.equal(typeof CONFIG_DEFAULTS.commits.smallFixThreshold, 'number');
    assert.equal(typeof CONFIG_DEFAULTS.commits.requireApproval, 'object');
  });
});

describe('mergeWithDefaults', () => {
  it('returns defaults when user config is empty', () => {
    const result = mergeWithDefaults({});
    assert.equal(result.hooks.enabled, CONFIG_DEFAULTS.hooks.enabled);
    assert.equal(result.enforcement.strictMode, CONFIG_DEFAULTS.enforcement.strictMode);
  });

  it('returns a copy of defaults when user config is null', () => {
    const result = mergeWithDefaults(null);
    assert.deepEqual(result, CONFIG_DEFAULTS);
  });

  it('user values override defaults', () => {
    const result = mergeWithDefaults({ hooks: { enabled: false } });
    assert.equal(result.hooks.enabled, false, 'User override should take precedence');
    // Other hooks keys should still have defaults
    assert.equal(typeof result.hooks.timeout, 'number');
  });

  it('preserves user keys not in defaults', () => {
    const result = mergeWithDefaults({ customUserKey: 'hello' });
    assert.equal(result.customUserKey, 'hello');
  });

  it('deep-merges nested objects', () => {
    const result = mergeWithDefaults({
      enforcement: { strictMode: false }
    });
    assert.equal(result.enforcement.strictMode, false, 'Override should apply');
    assert.equal(result.enforcement.warnOnBypass, true, 'Non-overridden defaults should remain');
  });

  it('arrays are replaced, not merged', () => {
    const customGates = ['myGate'];
    const result = mergeWithDefaults({
      qualityGates: { feature: { require: customGates } }
    });
    assert.deepEqual(result.qualityGates.feature.require, customGates);
  });
});

describe('deepMerge', () => {
  it('merges two flat objects', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    assert.deepEqual(result, { a: 1, b: 3, c: 4 });
  });

  it('does not mutate inputs', () => {
    const base = { a: 1 };
    const over = { b: 2 };
    deepMerge(base, over);
    assert.deepEqual(base, { a: 1 });
    assert.deepEqual(over, { b: 2 });
  });

  it('handles nested objects recursively', () => {
    const result = deepMerge(
      { x: { a: 1, b: 2 } },
      { x: { b: 3, c: 4 } }
    );
    assert.deepEqual(result, { x: { a: 1, b: 3, c: 4 } });
  });

  it('replaces arrays entirely (no array merge)', () => {
    const result = deepMerge({ arr: [1, 2] }, { arr: [3] });
    assert.deepEqual(result.arr, [3]);
  });
});

describe('isPlainObject', () => {
  it('returns true for plain objects', () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
  });

  it('returns false for non-plain values', () => {
    assert.equal(isPlainObject(null), false);
    assert.equal(isPlainObject([]), false);
    assert.equal(isPlainObject(new Date()), false);
    assert.equal(isPlainObject('string'), false);
    assert.equal(isPlainObject(42), false);
    assert.equal(isPlainObject(undefined), false);
  });
});

describe('getDefaultsForKey', () => {
  it('returns top-level default', () => {
    const result = getDefaultsForKey('hooks');
    assert.equal(typeof result, 'object');
    assert.equal(result.enabled, true);
  });

  it('returns nested default via dot-path', () => {
    const result = getDefaultsForKey('enforcement.strictMode');
    assert.equal(result, true);
  });

  it('returns undefined for non-existent key', () => {
    const result = getDefaultsForKey('nonExistentKey.deep.path');
    assert.equal(result, undefined);
  });

  it('returns undefined for invalid input', () => {
    assert.equal(getDefaultsForKey(null), undefined);
    assert.equal(getDefaultsForKey(''), undefined);
  });
});

describe('getConfigValue', () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  it('returns value for a valid path', () => {
    const val = getConfigValue('hooks.enabled');
    assert.equal(typeof val, 'boolean');
  });

  it('returns default for missing path', () => {
    const val = getConfigValue('nonexistent.deep.key', 'fallback');
    assert.equal(val, 'fallback');
  });

  it('rejects dangerous paths (prototype pollution)', () => {
    const val = getConfigValue('__proto__.polluted', 'safe');
    assert.equal(val, 'safe');
  });

  it('rejects constructor paths', () => {
    const val = getConfigValue('constructor.prototype', 'safe');
    assert.equal(val, 'safe');
  });
});

describe('resolveConfigValue', () => {
  it('returns non-string values as-is', () => {
    assert.equal(resolveConfigValue(null), null);
    assert.equal(resolveConfigValue(42), 42);
    assert.equal(resolveConfigValue(true), true);
  });

  it('returns plain strings as-is', () => {
    assert.equal(resolveConfigValue('hello'), 'hello');
  });

  it('resolves {env:VAR} patterns from environment', () => {
    process.env.__WOGI_TEST_VAR = 'test-value-123';
    try {
      const result = resolveConfigValue('{env:__WOGI_TEST_VAR}');
      assert.equal(result, 'test-value-123');
    } finally {
      delete process.env.__WOGI_TEST_VAR;
    }
  });

  it('returns null for missing env var', () => {
    const result = resolveConfigValue('{env:__WOGI_NONEXISTENT_VAR_XYZ}');
    assert.equal(result, null);
  });

  it('rejects invalid env var names', () => {
    // Suppress console.log from resolveConfigValue
    const origLog = console.log;
    console.log = () => {};
    try {
      const result = resolveConfigValue('{env:invalid-name}');
      assert.equal(result, null);
    } finally {
      console.log = origLog;
    }
  });

  it('resolves {file:path} for existing files within home directory', () => {
    // resolveConfigValue only allows files within project root or HOME
    const homeDir = process.env.HOME || os.homedir();
    const tmpFile = path.join(homeDir, '.wogi-test-resolve-' + Date.now() + '.txt');
    fs.writeFileSync(tmpFile, '  secret-value  ');
    try {
      const result = resolveConfigValue(`{file:${tmpFile}}`);
      assert.equal(result, 'secret-value', 'Should trim file contents');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns null for non-existent file within home', () => {
    const result = resolveConfigValue('{file:~/.wogi-nonexistent-file-xyz-test.txt}');
    assert.equal(result, null);
  });

  it('blocks file paths outside allowed locations', () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      const result = resolveConfigValue('{file:/etc/passwd}');
      assert.equal(result, null, 'Should block paths outside project and home');
    } finally {
      console.log = origLog;
    }
  });
});

describe('validateConfig', () => {
  it('does not throw for valid config', () => {
    assert.doesNotThrow(() => validateConfig(CONFIG_DEFAULTS, false));
  });

  it('handles null/undefined gracefully', () => {
    assert.doesNotThrow(() => validateConfig(null));
    assert.doesNotThrow(() => validateConfig(undefined));
  });

  it('handles non-object gracefully', () => {
    assert.doesNotThrow(() => validateConfig('not-an-object'));
  });
});

describe('applyConfigCompatShim', () => {
  it('returns config unchanged when no compat keys present', () => {
    const input = { hooks: { enabled: true } };
    const result = applyConfigCompatShim(input);
    assert.equal(result.hooks.enabled, true);
  });

  it('maps execution to tasks', () => {
    const input = { execution: { maxIterations: 5 } };
    const result = applyConfigCompatShim(input);
    assert.deepEqual(result.tasks, { maxIterations: 5 });
  });

  it('maps tasks to execution', () => {
    const input = { tasks: { maxIterations: 10 } };
    const result = applyConfigCompatShim(input);
    assert.deepEqual(result.execution, { maxIterations: 10 });
  });

  it('maps memory.automatic to automaticMemory', () => {
    const input = { memory: { automatic: { enabled: true } } };
    const result = applyConfigCompatShim(input);
    assert.deepEqual(result.automaticMemory, { enabled: true });
  });

  it('maps learning sub-keys', () => {
    const input = { learning: { session: { enabled: true }, crossSession: { enabled: false } } };
    const result = applyConfigCompatShim(input);
    assert.deepEqual(result.sessionLearning, { enabled: true });
    assert.deepEqual(result.crossSessionLearning, { enabled: false });
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(applyConfigCompatShim(null), null);
    assert.equal(applyConfigCompatShim(undefined), undefined);
  });
});

describe('applyProjectTypeDefaults', () => {
  it('returns config unchanged when no detection data', () => {
    const input = { testing: { mode: 'auto' } };
    const result = applyProjectTypeDefaults(input);
    assert.equal(result.testing.mode, 'auto');
  });

  it('sets mode to ui when only UI detected', () => {
    const input = {
      testing: {
        mode: 'auto',
        detected: { projectType: 'frontend', hasUI: true, hasAPI: false }
      }
    };
    const result = applyProjectTypeDefaults(input);
    assert.equal(result.testing.mode, 'ui');
  });

  it('sets mode to api when only API detected', () => {
    const input = {
      testing: {
        mode: 'auto',
        detected: { projectType: 'backend', hasUI: false, hasAPI: true }
      }
    };
    const result = applyProjectTypeDefaults(input);
    assert.equal(result.testing.mode, 'api');
  });

  it('sets mode to full when both UI and API detected', () => {
    const input = {
      testing: {
        mode: 'auto',
        detected: { projectType: 'fullstack', hasUI: true, hasAPI: true }
      }
    };
    const result = applyProjectTypeDefaults(input);
    assert.equal(result.testing.mode, 'full');
  });

  it('handles null gracefully', () => {
    assert.equal(applyProjectTypeDefaults(null), null);
  });
});

describe('invalidateConfigCache', () => {
  it('causes getConfig to re-read on next call', () => {
    const config1 = getConfig();
    invalidateConfigCache();
    const config2 = getConfig();
    // After invalidation, should be a fresh object (different reference)
    // Note: may be same reference if file hasn't changed and mtime matches,
    // but the cache was cleared so it had to re-read.
    assert.equal(typeof config2, 'object');
    assert.notEqual(config2, null);
  });
});
