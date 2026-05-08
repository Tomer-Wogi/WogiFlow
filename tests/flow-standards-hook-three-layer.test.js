'use strict';

/**
 * Tests for checkHookThreeLayer in scripts/flow-standards-checker.js (wf-00c5067b).
 *
 * Per `.claude/rules/architecture/hook-three-layer.md`:
 *   - Entry files (`scripts/hooks/entry/<cli>/*.js`) must be ≤120 LOC and
 *     import from at most 2 `core/` modules.
 *
 * The 4 known pre-extraction violators (stop, session-start, user-prompt-submit,
 * post-tool-use) are listed in config.standardsCheck.hookThreeLayer.exemptions
 * with explicit Phase 2 task ID. They will be cleared as wf-c1e892fa lands.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkHookThreeLayer } = require('../scripts/flow-standards-checker');

const baseConfig = {
  enabled: true,
  maxLoc: 120,
  maxCoreImports: 2,
  exemptions: {}
};

test('checkHookThreeLayer — exempted entry file passes despite violations', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/stop.js',
      content: Array(500).fill('line').join('\n') // way over 120 LOC
    },
    {
      ...baseConfig,
      exemptions: {
        'scripts/hooks/entry/claude-code/stop.js': 'Phase 2 — wf-c1e892fa'
      }
    }
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — 200-LOC entry → must-fix LOC violation', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/new-hook.js',
      content: Array(200).fill('line').join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'must-fix');
  assert.equal(violations[0].type, 'hook-three-layer');
  assert.match(violations[0].message, /exceeds 120 LOC/);
  assert.match(violations[0].message, /200 lines/);
});

test('checkHookThreeLayer — exact 120 LOC entry passes (boundary)', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/exact.js',
      content: Array(120).fill('line').join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — 4 core/ imports → must-fix import-count violation', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/multi.js',
      content: [
        "const a = require('../../core/a');",
        "const b = require('../../core/b');",
        "const c = require('../../core/c');",
        "const d = require('../../core/d');"
      ].join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /imports from 4 core\/ modules/);
  assert.match(violations[0].message, /Modules: a, b, c, d/);
});

test('checkHookThreeLayer — exactly 2 core imports passes (boundary)', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/two.js',
      content: "require('../../core/a');\nrequire('../../core/b');"
    },
    baseConfig
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — duplicate core import counted once', () => {
  // Same module imported twice (e.g., once via let, once via destructuring)
  // should count as 1 distinct module, not 2.
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/dedup.js',
      content: [
        "const a = require('../../core/foo');",
        "const { x } = require('../../core/foo');",
        "const b = require('../../core/bar');"
      ].join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 0); // 2 distinct modules, within limit
});

test('checkHookThreeLayer — non-entry file (core/) is ignored', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/core/some-core.js',
      content: Array(500).fill('line').join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — non-hook file is ignored', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'lib/workspace.js',
      content: Array(2000).fill('line').join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — adapter file is ignored (different layer)', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/adapters/claude-code.js',
      content: Array(500).fill('line').join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — disabled config returns no violations', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/big.js',
      content: Array(500).fill('line').join('\n')
    },
    { ...baseConfig, enabled: false }
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — empty content → no false positives', () => {
  const violations = checkHookThreeLayer(
    { path: 'scripts/hooks/entry/claude-code/empty.js', content: '' },
    baseConfig
  );
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — absolute path normalized to relative', () => {
  // Files often arrive with absolute paths from the standards-check loop.
  // Exemption lookup MUST normalize to relative-to-repo-root.
  const { PATHS } = require('../scripts/flow-utils');
  const path = require('node:path');
  const absPath = path.join(PATHS.root, 'scripts/hooks/entry/claude-code/abs.js');

  const violations = checkHookThreeLayer(
    {
      path: absPath,
      content: Array(200).fill('line').join('\n')
    },
    {
      ...baseConfig,
      exemptions: { 'scripts/hooks/entry/claude-code/abs.js': 'test exemption' }
    }
  );
  // Should be exempted because the path normalizes to the relative form
  assert.equal(violations.length, 0);
});

test('checkHookThreeLayer — both LOC and import violations stack', () => {
  const violations = checkHookThreeLayer(
    {
      path: 'scripts/hooks/entry/claude-code/double.js',
      content: [
        Array(200).fill('line').join('\n'),
        "require('../../core/a');",
        "require('../../core/b');",
        "require('../../core/c');"
      ].join('\n')
    },
    baseConfig
  );
  assert.equal(violations.length, 2); // one LOC, one imports
  const types = violations.map(v => v.message);
  assert.ok(types.some(m => /exceeds 120 LOC/.test(m)));
  assert.ok(types.some(m => /imports from 3 core\/ modules/.test(m)));
});
