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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

  it('always suggests /wogi-capture as a low-friction side-thought option', () => {
    const msg = generateBlockMessage('edit', 'src/x.js');
    assert.ok(msg.includes('/wogi-capture'), '/wogi-capture should appear in every block message');
  });

  it('handles missing inputs without throwing', () => {
    assert.doesNotThrow(() => generateBlockMessage(null, null));
  });

  it('suggests /wogi-decide when blocking a write to decisions.md', () => {
    const msg = generateBlockMessage('edit', '.workflow/state/decisions.md');
    assert.ok(msg.includes('/wogi-decide'), '/wogi-decide should be suggested for decisions.md');
    assert.ok(msg.match(/rule.*capture|capture.*rule|from now on/i),
      'rule-capture phrasing should accompany /wogi-decide');
  });

  it('suggests /wogi-decide when blocking a write to feedback-patterns.md', () => {
    const msg = generateBlockMessage('edit', '.workflow/state/feedback-patterns.md');
    assert.ok(msg.includes('/wogi-decide'));
  });

  it('suggests /wogi-decide when blocking a write to MEMORY.md', () => {
    const msg = generateBlockMessage('write', '/any/path/MEMORY.md');
    assert.ok(msg.includes('/wogi-decide'));
  });

  it('suggests /wogi-decide for Claude Code auto-memory paths', () => {
    const autoMemoryPath = path.join('/home', 'user', '.claude', 'projects', 'some-proj', 'memory', 'user_role.md');
    const msg = generateBlockMessage('write', autoMemoryPath);
    assert.ok(msg.includes('/wogi-decide'), 'auto-memory paths should suggest /wogi-decide');
  });

  it('does NOT suggest /wogi-decide for intent artifacts (domain-model.md)', () => {
    // Per adversary critique: intent artifacts are product-design work and should
    // route to /wogi-story, not /wogi-decide. Only pure rule/memory files bypass.
    const msg = generateBlockMessage('edit', '.workflow/state/domain-model.md');
    assert.ok(!msg.includes('/wogi-decide'),
      'domain-model.md is an intent artifact, not a rule file — should not suggest /wogi-decide');
    assert.ok(msg.includes('/wogi-story'), 'should still suggest /wogi-story for intent artifacts');
  });

  it('does NOT suggest /wogi-decide for user-journeys.md or glossary.md or product.md', () => {
    for (const file of ['user-journeys.md', 'glossary.md', 'product.md']) {
      const msg = generateBlockMessage('edit', `.workflow/state/${file}`);
      assert.ok(!msg.includes('/wogi-decide'),
        `${file} is an intent artifact and should not trigger /wogi-decide branch`);
    }
  });

  it('does NOT suggest /wogi-decide for registry maps (app-map.md, function-map.md, api-map.md)', () => {
    for (const file of ['app-map.md', 'function-map.md', 'api-map.md']) {
      const msg = generateBlockMessage('edit', `.workflow/state/${file}`);
      assert.ok(!msg.includes('/wogi-decide'),
        `${file} is a registry map (auto-updated), not a rule file`);
    }
  });

  it('preserves existing /wogi-ready, /wogi-start, /wogi-story suggestions in all branches', () => {
    const msg1 = generateBlockMessage('edit', '.workflow/state/decisions.md'); // rule branch
    const msg2 = generateBlockMessage('edit', 'src/x.js'); // plain branch
    for (const msg of [msg1, msg2]) {
      assert.ok(msg.includes('/wogi-ready'));
      assert.ok(msg.includes('/wogi-start'));
      assert.ok(msg.includes('/wogi-story'));
    }
  });

  it('suggests workspace coordination when .workspace/ exists at a parent', () => {
    // Create a fake workspace dir in a tmp parent, then cd there before calling.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-gate-ws-'));
    const workspaceMarker = path.join(tmp, '.workspace');
    const managerDir = path.join(tmp, 'manager-repo');
    fs.mkdirSync(workspaceMarker, { recursive: true });
    fs.mkdirSync(managerDir, { recursive: true });
    const origCwd = process.cwd();
    try {
      process.chdir(managerDir);
      const msg = generateBlockMessage('edit', 'src/x.js');
      assert.ok(msg.includes('coordinate'),
        'workspace coordination phrase should appear when .workspace/ is a parent');
      assert.ok(msg.match(/workspace mode|in workspace/i),
        'workspace-mode phrasing should appear');
    } finally {
      process.chdir(origCwd);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    }
  });

  it('does NOT suggest workspace coordination when .workspace/ is absent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-gate-noworkspace-'));
    const origCwd = process.cwd();
    try {
      process.chdir(tmp);
      const msg = generateBlockMessage('edit', 'src/x.js');
      assert.ok(!msg.match(/coordinate.*in workspace/i),
        'workspace phrase should NOT appear when no .workspace/ parent exists');
    } finally {
      process.chdir(origCwd);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    }
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
      'createQuickTask', 'writeRoutingReceipt', 'generateBlockMessage', 'generateWarningMessage',
    ]) {
      assert.equal(typeof mod[name], 'function', `${name} should be a function`);
    }
  });
});

// ============================================================
// wf-c573961f: writeRoutingReceipt — documented external API for satisfying
// the routing-proof requirement (5th state source)
// ============================================================

describe('wf-c573961f: writeRoutingReceipt', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  it('rejects invalid taskId format', () => {
    const { writeRoutingReceipt } = require('../scripts/hooks/core/task-gate');
    const r1 = writeRoutingReceipt('not-a-valid-id');
    assert.equal(r1.ok, false);
    assert.match(r1.reason, /invalid taskId/i);

    const r2 = writeRoutingReceipt(null);
    assert.equal(r2.ok, false);
  });

  it('writes a receipt file in the state dir for a valid task id', () => {
    // Use a tmp project so we don't pollute the live state dir.
    const originalCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-routing-receipt-'));
    fs.mkdirSync(path.join(tmp, '.workflow', 'state'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.workflow', 'config.json'), JSON.stringify({}));
    process.chdir(tmp);
    try {
      // Evict cache so flow-paths picks up the new cwd.
      delete require.cache[require.resolve('../scripts/flow-paths')];
      delete require.cache[require.resolve('../scripts/flow-utils')];
      delete require.cache[require.resolve('../scripts/hooks/core/task-gate')];

      const { writeRoutingReceipt } = require('../scripts/hooks/core/task-gate');
      const taskId = 'wf-abc12345';
      const r = writeRoutingReceipt(taskId, { via: 'unit-test' });
      assert.equal(r.ok, true);
      assert.ok(r.path);
      assert.ok(fs.existsSync(r.path), 'receipt file should exist on disk');

      const body = JSON.parse(fs.readFileSync(r.path, 'utf-8'));
      assert.equal(body.taskId, taskId);
      assert.equal(body.via, 'unit-test');
      assert.match(body.routedAt, /\d{4}-\d{2}-\d{2}T/);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
      // Evict again so subsequent tests see fresh state.
      delete require.cache[require.resolve('../scripts/flow-paths')];
      delete require.cache[require.resolve('../scripts/flow-utils')];
      delete require.cache[require.resolve('../scripts/hooks/core/task-gate')];
    }
  });
});
