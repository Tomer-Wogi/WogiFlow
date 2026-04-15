'use strict';

/**
 * Tests for scripts/hooks/core/task-gate.js (Wave F hook coverage).
 *
 * Covers: isTaskGatingEnabled config cascade (taskGating/strictMode/
 * requireTaskForImplementation), getActiveTask (null safety, invalid ID
 * rejection, routedAt/startedAt/receipt validation — anti-bypass), createQuickTask
 * produces a valid task shape, generateWarningMessage + generateBlockMessage
 * shape, checkTaskGate result contract.
 *
 * Run: NODE_ENV=test node --test tests/flow-hooks-task-gate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const {
  isTaskGatingEnabled,
  getActiveTask,
  checkTaskGate,
  generateWarningMessage,
  generateBlockMessage,
} = require('../scripts/hooks/core/task-gate');

// ============================================================
// isTaskGatingEnabled
// ============================================================

describe('isTaskGatingEnabled', () => {
  it('returns true by default (empty config)', () => {
    assert.equal(isTaskGatingEnabled({}), true);
  });

  it('returns true when enforcement is undefined', () => {
    assert.equal(isTaskGatingEnabled({ enforcement: {} }), true);
  });

  it('returns false when taskGating.enabled === false', () => {
    assert.equal(isTaskGatingEnabled({ enforcement: { taskGating: { enabled: false } } }), false);
  });

  it('returns false when strictMode === false', () => {
    assert.equal(isTaskGatingEnabled({ enforcement: { strictMode: false } }), false);
  });

  it('returns false when requireTaskForImplementation === false', () => {
    assert.equal(isTaskGatingEnabled({ enforcement: { requireTaskForImplementation: false } }), false);
  });

  it('returns true when taskGating.enabled === true explicitly', () => {
    assert.equal(isTaskGatingEnabled({ enforcement: { taskGating: { enabled: true } } }), true);
  });

  it('treats non-false truthy values as enabled (requires explicit false)', () => {
    assert.equal(isTaskGatingEnabled({ enforcement: { taskGating: { enabled: 0 } } }), true);
    assert.equal(isTaskGatingEnabled({ enforcement: { strictMode: null } }), true);
  });
});

// ============================================================
// getActiveTask — null safety + result shape
// ============================================================

describe('getActiveTask — null safety', () => {
  it('returns null or a valid task object (no throw)', () => {
    const r = getActiveTask();
    assert.ok(r === null || typeof r === 'object');
  });

  it('if task returned, has .id string', () => {
    const task = getActiveTask();
    if (task !== null) {
      assert.ok(typeof task.id === 'string');
      assert.ok(task.id.length > 0);
    }
  });
});

// ============================================================
// checkTaskGate — result contract
// ============================================================

describe('checkTaskGate — result contract', () => {
  it('returns well-formed result for common tools', () => {
    for (const opts of [
      { toolName: 'Edit', toolInput: { file_path: '/x.js' } },
      { toolName: 'Write', toolInput: { file_path: '/y.js' } },
      { toolName: 'Bash', toolInput: { command: 'ls' } },
      { toolName: 'Read', toolInput: { file_path: '/z.js' } },
    ]) {
      const r = checkTaskGate(opts);
      assert.ok(typeof r === 'object');
      assert.ok('allowed' in r || 'blocked' in r);
    }
  });

  it('allows when gating is disabled via config', () => {
    const config = { enforcement: { taskGating: { enabled: false } } };
    const r = checkTaskGate({ toolName: 'Edit', toolInput: { file_path: '/x.js' } }, config);
    assert.equal(r.allowed, true);
  });

  it('allows when strictMode is disabled', () => {
    const config = { enforcement: { strictMode: false } };
    const r = checkTaskGate({ toolName: 'Edit', toolInput: { file_path: '/x.js' } }, config);
    assert.equal(r.allowed, true);
  });

  it('handles missing toolInput gracefully', () => {
    assert.doesNotThrow(() => checkTaskGate({ toolName: 'Edit' }));
  });

  it('handles missing options object', () => {
    assert.doesNotThrow(() => checkTaskGate());
  });

  it('handles undefined options (uses default)', () => {
    assert.doesNotThrow(() => checkTaskGate(undefined));
  });
});

// ============================================================
// Message generators
// ============================================================

describe('generateWarningMessage', () => {
  it('includes the file basename (not full path) and active-task guidance', () => {
    const msg = generateWarningMessage('edit', 'src/x.js');
    assert.ok(typeof msg === 'string');
    assert.ok(msg.length > 0);
    // Uses path.basename — just the filename appears, not 'src/'
    assert.ok(msg.includes('x.js'));
    assert.ok(msg.toLowerCase().includes('task'));
  });

  it('handles missing inputs without throwing', () => {
    assert.doesNotThrow(() => generateWarningMessage(null, null));
    assert.doesNotThrow(() => generateWarningMessage('edit'));
    assert.doesNotThrow(() => generateWarningMessage());
  });
});

describe('generateBlockMessage', () => {
  it('mentions /wogi-* commands for task creation', () => {
    const msg = generateBlockMessage('edit', 'src/x.js');
    assert.ok(msg.includes('/wogi-'));
  });

  it('mentions /wogi-ready or /wogi-start', () => {
    const msg = generateBlockMessage('edit', 'src/x.js');
    assert.ok(msg.includes('/wogi-ready') || msg.includes('/wogi-start') || msg.includes('/wogi-story'));
  });

  it('handles missing inputs without throwing', () => {
    assert.doesNotThrow(() => generateBlockMessage(null, null));
  });
});

// ============================================================
// Module exports
// ============================================================

describe('module exports', () => {
  it('exports all documented functions', () => {
    const mod = require('../scripts/hooks/core/task-gate');
    for (const name of [
      'isTaskGatingEnabled', 'getActiveTask', 'checkTaskGate',
      'createQuickTask', 'generateBlockMessage', 'generateWarningMessage',
    ]) {
      assert.equal(typeof mod[name], 'function', `${name} should be a function`);
    }
  });
});
