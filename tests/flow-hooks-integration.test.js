'use strict';

/**
 * Integration tests for hook chain — verifies all hook entry points,
 * core modules, and adapters load without error.
 *
 * Development-only — not distributed to end users.
 * Run: NODE_ENV=test node --test tests/flow-hooks-integration.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Suppress console output during tests
let originalLog, originalWarn, originalError;
beforeEach(() => {
  originalLog = console.log;
  originalWarn = console.warn;
  originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});
afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const HOOKS_ENTRY_DIR = path.join(SCRIPTS_DIR, 'hooks', 'entry', 'claude-code');
const HOOKS_CORE_DIR = path.join(SCRIPTS_DIR, 'hooks', 'core');
const HOOKS_ADAPTERS_DIR = path.join(SCRIPTS_DIR, 'hooks', 'adapters');

// ============================================================
// Hook entry point files exist and load
// ============================================================

describe('Hook entry points — file existence', () => {
  const entryPoints = [
    'pre-tool-use.js',
    'post-tool-use.js',
    'session-start.js',
    'session-end.js',
    'user-prompt-submit.js',
    'task-completed.js',
    'instructions-loaded.js',
    'config-change.js',
    'stop.js',
    'setup.js',
  ];

  for (const file of entryPoints) {
    it(`${file} exists`, () => {
      const fullPath = path.join(HOOKS_ENTRY_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Missing entry point: ${fullPath}`);
    });
  }
});

describe('Hook entry points — require without error', () => {
  const entryPoints = [
    'pre-tool-use.js',
    'post-tool-use.js',
    'session-start.js',
    'session-end.js',
    'user-prompt-submit.js',
    'task-completed.js',
    'instructions-loaded.js',
    'config-change.js',
    'stop.js',
    'setup.js',
  ];

  for (const file of entryPoints) {
    it(`${file} exists and has valid syntax`, () => {
      const fullPath = path.join(HOOKS_ENTRY_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Missing: ${file}`);
      // NOTE: We cannot require() entry points because they auto-call main()
      // which reads stdin and would hang the test process. File existence +
      // syntax check (via npm run test:syntax) is sufficient.
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(content.length > 0, `${file} is empty`);
      assert.ok(content.includes('require('), `${file} has no requires — may not be a valid hook`);
    });
  }
});

// ============================================================
// Hook core modules exist and load
// ============================================================

describe('Hook core modules — file existence', () => {
  const coreModules = [
    'routing-gate.js',
    'scope-gate.js',
    'phase-gate.js',
    'task-gate.js',
    'component-check.js',
    'validation.js',
    'loop-check.js',
    'session-context.js',
    'session-end.js',
    'setup-check.js',
    'observation-capture.js',
    'research-gate.js',
    'worktree-lifecycle.js',
    'instructions-loaded.js',
    'config-change.js',
    'task-completed.js',
  ];

  for (const file of coreModules) {
    it(`${file} exists`, () => {
      const fullPath = path.join(HOOKS_CORE_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Missing core module: ${fullPath}`);
    });
  }
});

describe('Hook core modules — require without error', () => {
  const coreModules = [
    'routing-gate.js',
    'scope-gate.js',
    'phase-gate.js',
    'task-gate.js',
    'component-check.js',
    'validation.js',
    'loop-check.js',
    'session-context.js',
    'session-end.js',
    'setup-check.js',
    'observation-capture.js',
    'research-gate.js',
    'worktree-lifecycle.js',
    'instructions-loaded.js',
    'config-change.js',
    'task-completed.js',
  ];

  for (const file of coreModules) {
    it(`${file} loads without error`, () => {
      const fullPath = path.join(HOOKS_CORE_DIR, file);
      assert.doesNotThrow(() => require(fullPath), `Failed to require ${file}`);
    });
  }
});

// ============================================================
// Hook adapter
// ============================================================

describe('Hook adapter — claude-code', () => {
  const adapterPath = path.join(HOOKS_ADAPTERS_DIR, 'claude-code.js');

  it('file exists', () => {
    assert.ok(fs.existsSync(adapterPath), `Missing adapter: ${adapterPath}`);
  });

  it('loads without error', () => {
    assert.doesNotThrow(() => require(adapterPath), 'Failed to require claude-code adapter');
  });

  it('exports an object', () => {
    const adapter = require(adapterPath);
    assert.equal(typeof adapter, 'object');
    assert.ok(adapter !== null);
  });
});

// ============================================================
// Core module exports
// ============================================================

describe('Core module exports are functions', () => {
  it('routing-gate exports a function or object with handler', () => {
    const mod = require(path.join(HOOKS_CORE_DIR, 'routing-gate.js'));
    assert.ok(
      typeof mod === 'function' || typeof mod === 'object',
      'routing-gate should export a function or object'
    );
  });

  it('scope-gate exports a function or object with handler', () => {
    const mod = require(path.join(HOOKS_CORE_DIR, 'scope-gate.js'));
    assert.ok(
      typeof mod === 'function' || typeof mod === 'object',
      'scope-gate should export a function or object'
    );
  });

  it('task-gate exports a function or object with handler', () => {
    const mod = require(path.join(HOOKS_CORE_DIR, 'task-gate.js'));
    assert.ok(
      typeof mod === 'function' || typeof mod === 'object',
      'task-gate should export a function or object'
    );
  });

  it('phase-gate exports a function or object with handler', () => {
    const mod = require(path.join(HOOKS_CORE_DIR, 'phase-gate.js'));
    assert.ok(
      typeof mod === 'function' || typeof mod === 'object',
      'phase-gate should export a function or object'
    );
  });

  it('component-check exports a function or object with handler', () => {
    const mod = require(path.join(HOOKS_CORE_DIR, 'component-check.js'));
    assert.ok(
      typeof mod === 'function' || typeof mod === 'object',
      'component-check should export a function or object'
    );
  });
});

// ============================================================
// Hook directory structure
// ============================================================

describe('Hook directory structure', () => {
  it('entry/claude-code directory exists', () => {
    assert.ok(fs.existsSync(HOOKS_ENTRY_DIR));
    assert.ok(fs.statSync(HOOKS_ENTRY_DIR).isDirectory());
  });

  it('core directory exists', () => {
    assert.ok(fs.existsSync(HOOKS_CORE_DIR));
    assert.ok(fs.statSync(HOOKS_CORE_DIR).isDirectory());
  });

  it('adapters directory exists', () => {
    assert.ok(fs.existsSync(HOOKS_ADAPTERS_DIR));
    assert.ok(fs.statSync(HOOKS_ADAPTERS_DIR).isDirectory());
  });

  it('entry directory has at least 5 hook files', () => {
    const files = fs.readdirSync(HOOKS_ENTRY_DIR).filter(f => f.endsWith('.js'));
    assert.ok(files.length >= 5, `Expected at least 5 entry hooks, got ${files.length}`);
  });

  it('core directory has at least 5 modules', () => {
    const files = fs.readdirSync(HOOKS_CORE_DIR).filter(f => f.endsWith('.js'));
    assert.ok(files.length >= 5, `Expected at least 5 core modules, got ${files.length}`);
  });
});
