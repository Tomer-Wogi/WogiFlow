'use strict';

/**
 * Tests for the lean-config feature (v2.19.0+).
 *
 * Covers:
 *   - computeLeanConfig() strips keys matching defaults
 *   - mergeWithDefaults(computeLeanConfig(full)) == mergeWithDefaults(full)
 *     (the round-trip guarantee — compacting never changes runtime behavior)
 *   - buildLeanInstallConfig() writes what `flow init` writes
 *   - taskBoundaryReset.enabled default is now true (v2.19.0 flip)
 *   - Identity keys ($schema, version, projectName, cli) always preserved
 *   - Comment fields (_comment*) are stripped from lean output
 *
 * Run: NODE_ENV=test node --test tests/flow-lean-config.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIG_DEFAULTS,
  mergeWithDefaults,
  computeLeanConfig
} = require('../scripts/flow-config-defaults');

const { buildLeanInstallConfig } = require('../lib/installer');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

describe('taskBoundaryReset default (v2.19.0 flip)', () => {
  it('is enabled by default', () => {
    assert.equal(CONFIG_DEFAULTS.taskBoundaryReset.enabled, true,
      'After v2.19.0 the default should be true so workspace workers restart on task completion');
  });
});

describe('computeLeanConfig', () => {
  it('returns empty object (or just identity keys) when input equals defaults', () => {
    // A full copy of defaults should lean-reduce to nothing meaningful
    // (no overrides). Identity keys that exist in defaults with non-zero
    // values may remain, but NO behavioral keys should appear.
    const lean = computeLeanConfig({ ...CONFIG_DEFAULTS });
    // version is an identity key, but its default is '2.0.0' — equal to itself,
    // so it gets preserved. What we care about is: no random behavioral keys.
    assert.ok(!('enforcement' in lean), 'enforcement should not appear when it matches defaults');
    assert.ok(!('hooks' in lean), 'hooks should not appear when it matches defaults');
    assert.ok(!('taskBoundaryReset' in lean), 'taskBoundaryReset should not appear when it matches defaults');
  });

  it('preserves values that differ from defaults', () => {
    const input = {
      ...CONFIG_DEFAULTS,
      projectName: 'my-project',
      enforcement: { ...CONFIG_DEFAULTS.enforcement, strictMode: false }
    };
    const lean = computeLeanConfig(input);
    assert.equal(lean.projectName, 'my-project');
    assert.deepEqual(lean.enforcement, { strictMode: false },
      'only the diverging subkey should appear, not the whole enforcement block');
  });

  it('strips _comment* fields at the root level', () => {
    // These are metadata from the defaults file — stripping them keeps lean
    // output focused on actual values. User-authored comments inside nested
    // objects with no default counterpart are preserved as-is (user's own data).
    const input = {
      projectName: 'x',
      _comment: 'a comment',
      _comment_foo: 'another comment'
    };
    const lean = computeLeanConfig(input);
    assert.ok(!('_comment' in lean));
    assert.ok(!('_comment_foo' in lean));
    assert.equal(lean.projectName, 'x');
  });

  it('strips _comment* fields in nested objects when the parent exists in defaults', () => {
    // taskBoundaryReset exists in CONFIG_DEFAULTS and includes _comment fields
    // there. Merging then lean-compacting should strip those on the way out.
    const input = {
      ...CONFIG_DEFAULTS,
      projectName: 'x',
      taskBoundaryReset: {
        ...CONFIG_DEFAULTS.taskBoundaryReset,
        _comment: 'user-added comment — should still be stripped for consistency',
        enabled: false  // an actual override so taskBoundaryReset survives
      }
    };
    const lean = computeLeanConfig(input);
    if (lean.taskBoundaryReset) {
      assert.ok(!('_comment' in lean.taskBoundaryReset),
        '_comment in a nested defaults-recognized object should be stripped');
    }
  });

  it('preserves user-defined keys absent from defaults', () => {
    const input = { projectName: 'x', customKey: 'customValue' };
    const lean = computeLeanConfig(input);
    assert.equal(lean.customKey, 'customValue');
  });

  it('returns {} for non-object input', () => {
    assert.deepEqual(computeLeanConfig(null), {});
    assert.deepEqual(computeLeanConfig(undefined), {});
    assert.deepEqual(computeLeanConfig('string'), {});
  });
});

describe('round-trip guarantee — mergeWithDefaults(computeLeanConfig(full)) == mergeWithDefaults(full)', () => {
  function roundTrip(input) {
    const lean = computeLeanConfig(input);
    const fromLean = mergeWithDefaults(lean);
    const fromFull = mergeWithDefaults(input);
    return { fromLean, fromFull };
  }

  it('holds for a config equal to defaults', () => {
    const { fromLean, fromFull } = roundTrip({ ...CONFIG_DEFAULTS });
    assert.deepEqual(fromLean, fromFull);
  });

  it('holds for a config with simple overrides', () => {
    const input = {
      projectName: 'my-project',
      enforcement: { strictMode: false },
      taskBoundaryReset: { enabled: false }
    };
    const { fromLean, fromFull } = roundTrip(input);
    assert.deepEqual(fromLean, fromFull);
    // Spot-check the overrides actually made it through.
    assert.equal(fromLean.projectName, 'my-project');
    assert.equal(fromLean.enforcement.strictMode, false);
    assert.equal(fromLean.taskBoundaryReset.enabled, false);
  });

  it('holds for a config with nested overrides at multiple levels', () => {
    const input = {
      projectName: 'complex',
      hooks: { rules: { taskGating: { enabled: false, mode: 'warn' } } }
    };
    const { fromLean, fromFull } = roundTrip(input);
    assert.deepEqual(fromLean, fromFull);
  });

  it('holds for a fully-specified fat config (what pre-v2.19.0 `flow init` wrote)', () => {
    // Simulate the old behavior: dump the whole default tree with a project name.
    const fat = {
      $schema: './config.schema.json',
      version: '2.19.0',
      projectName: 'legacy',
      ...CONFIG_DEFAULTS
    };
    const { fromLean, fromFull } = roundTrip(fat);
    assert.deepEqual(fromLean, fromFull,
      'legacy fat configs must produce identical runtime state after compaction');
  });
});

describe('buildLeanInstallConfig (what `flow init` writes)', () => {
  function makeFull(overrides = {}) {
    return {
      ...CONFIG_DEFAULTS,
      $schema: './config.schema.json',
      version: '2.19.0',
      projectName: overrides.projectName || 'test-proj',
      cli: { type: 'claude-code' },
      ...overrides
    };
  }

  it('includes all identity keys ($schema, version, projectName, cli)', () => {
    const lean = buildLeanInstallConfig(makeFull(), { version: '2.19.0', projectName: 'test-proj' });
    assert.ok('$schema' in lean);
    assert.ok('version' in lean);
    assert.ok('projectName' in lean);
    assert.ok('cli' in lean);
  });

  it('produces a lean output (≤15 top-level keys for a default install)', () => {
    const full = makeFull();
    const lean = buildLeanInstallConfig(full, { version: '2.19.0', projectName: 'test-proj' });
    const keys = Object.keys(lean);
    assert.ok(keys.length <= 15,
      `lean install config should have <=15 top-level keys, got ${keys.length}: ${keys.join(', ')}`);
  });

  it('round-trips: mergeWithDefaults(buildLeanInstallConfig(full)) equals mergeWithDefaults(full)', () => {
    const full = makeFull({ projectName: 'rt-test' });
    const lean = buildLeanInstallConfig(full, { version: '2.19.0', projectName: 'rt-test' });
    const fromLean = mergeWithDefaults(lean);
    const fromFull = mergeWithDefaults(full);
    assert.deepEqual(fromLean, fromFull);
  });

  it('preserves interactive overrides (e.g., user disabled strictMode)', () => {
    const full = makeFull();
    full.enforcement = { ...full.enforcement, strictMode: false };
    const lean = buildLeanInstallConfig(full, { version: '2.19.0', projectName: 'test-proj' });
    assert.deepEqual(lean.enforcement, { strictMode: false },
      'user override should appear in lean output');
  });
});
