'use strict';

/**
 * Tests for workspace-task-injector — manager-side task-ID injection (wf-2f49b292 / G5).
 *
 * Covers:
 *   1. Happy path — task injected into worker's ready.json
 *   2. Idempotent — re-injecting same ID reports alreadyPresent without duplicate
 *   3. Invalid task record — rejected with clear message
 *   4. Invalid repo name — rejected
 *   5. Unknown repo (not in manifest) — rejected
 *   6. Missing ready.json — created from scratch
 *   7. Path traversal guard — rejected if member.path escapes workspace root
 *   8. Concurrent injects — both end up in ready[] (serialized via rename)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const {
  injectTask,
  getWorkerReadyPath,
  validateTaskRecord
} = require('../lib/workspace-task-injector');

function makeWorkspace(repoName = 'worker-a', repoPath = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-injector-test-'));
  const memberPath = repoPath || `./${repoName}`;
  const repoAbsPath = path.resolve(root, memberPath);
  fs.mkdirSync(path.join(repoAbsPath, '.workflow', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'wogi-workspace.json'),
    JSON.stringify({
      members: { [repoName]: { path: memberPath } }
    })
  );
  return { root, repoAbsPath };
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
}

function sampleTask(overrides = {}) {
  return {
    id: 'wf-12345678',
    title: 'Test task',
    type: 'story',
    priority: 'P2',
    ...overrides
  };
}

// ============================================================
// Scenario 1: Happy path
// ============================================================

describe('injectTask — happy path', () => {
  let root, repoAbsPath;
  beforeEach(() => { ({ root, repoAbsPath } = makeWorkspace()); });
  afterEach(() => cleanup(root));

  it('writes task into worker ready.json ready[]', () => {
    const result = injectTask(root, 'worker-a', sampleTask());
    assert.equal(result.ok, true);
    assert.equal(result.taskId, 'wf-12345678');

    const readyPath = path.join(repoAbsPath, '.workflow', 'state', 'ready.json');
    const data = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
    assert.equal(data.ready.length, 1);
    assert.equal(data.ready[0].id, 'wf-12345678');
    assert.equal(data.ready[0].status, 'ready');
    assert.ok(data.ready[0].injectedAt);
    assert.ok(data.lastUpdated);
  });

  it('preserves existing entries in ready.json', () => {
    const readyPath = path.join(repoAbsPath, '.workflow', 'state', 'ready.json');
    fs.writeFileSync(readyPath, JSON.stringify({
      inProgress: [],
      ready: [{ id: 'wf-aaaaaaaa', title: 'existing', type: 'story' }],
      blocked: [],
      recentlyCompleted: []
    }));

    const result = injectTask(root, 'worker-a', sampleTask({ id: 'wf-bbbbbbbb' }));
    assert.equal(result.ok, true);

    const data = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
    assert.equal(data.ready.length, 2);
    assert.deepEqual(data.ready.map(t => t.id).sort(), ['wf-aaaaaaaa', 'wf-bbbbbbbb']);
  });
});

// ============================================================
// Scenario 2: Idempotent
// ============================================================

describe('injectTask — idempotent', () => {
  let root;
  beforeEach(() => { ({ root } = makeWorkspace()); });
  afterEach(() => cleanup(root));

  it('re-injecting same id reports alreadyPresent and does not duplicate', () => {
    const first = injectTask(root, 'worker-a', sampleTask());
    assert.equal(first.ok, true);

    const second = injectTask(root, 'worker-a', sampleTask());
    assert.equal(second.ok, true);
    assert.equal(second.alreadyPresent, 'ready');

    const readyPath = getWorkerReadyPath(root, 'worker-a');
    const data = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
    assert.equal(data.ready.length, 1);
  });

  it('detects task already in inProgress', () => {
    const readyPath = getWorkerReadyPath(root, 'worker-a');
    fs.writeFileSync(readyPath, JSON.stringify({
      inProgress: [{ id: 'wf-12345678', title: 'running', type: 'story' }],
      ready: [], blocked: [], recentlyCompleted: []
    }));

    const result = injectTask(root, 'worker-a', sampleTask());
    assert.equal(result.ok, true);
    assert.equal(result.alreadyPresent, 'inProgress');
  });
});

// ============================================================
// Scenario 3: Invalid task record
// ============================================================

describe('injectTask — validation', () => {
  let root;
  beforeEach(() => { ({ root } = makeWorkspace()); });
  afterEach(() => cleanup(root));

  it('rejects missing id', () => {
    const result = injectTask(root, 'worker-a', { title: 't', type: 'story' });
    assert.equal(result.ok, false);
    assert.match(result.message, /id is required/);
  });

  it('rejects invalid task ID format', () => {
    const result = injectTask(root, 'worker-a', sampleTask({ id: 'TASK-001' }));
    assert.equal(result.ok, false);
    assert.match(result.message, /Invalid task ID/);
  });

  it('rejects non-object taskRecord', () => {
    const result = injectTask(root, 'worker-a', null);
    assert.equal(result.ok, false);
    assert.match(result.message, /plain object/);
  });

  it('rejects invalid repo name', () => {
    const result = injectTask(root, 'bad name with spaces!', sampleTask());
    assert.equal(result.ok, false);
    assert.match(result.message, /Invalid repoName/);
  });

  it('rejects repo not in manifest', () => {
    const result = injectTask(root, 'nonexistent', sampleTask());
    assert.equal(result.ok, false);
    assert.match(result.message, /Unknown repo/);
  });
});

// ============================================================
// Scenario 4: Missing ready.json — created from scratch
// ============================================================

describe('injectTask — missing ready.json', () => {
  let root, repoAbsPath;
  beforeEach(() => { ({ root, repoAbsPath } = makeWorkspace()); });
  afterEach(() => cleanup(root));

  it('creates ready.json if absent', () => {
    const readyPath = path.join(repoAbsPath, '.workflow', 'state', 'ready.json');
    assert.equal(fs.existsSync(readyPath), false);

    const result = injectTask(root, 'worker-a', sampleTask());
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(readyPath), true);

    const data = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
    assert.equal(data.ready.length, 1);
  });
});

// ============================================================
// Scenario 5: Path traversal guard
// ============================================================

describe('injectTask — path traversal', () => {
  it('rejects member.path that escapes workspace root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-injector-trav-'));
    fs.writeFileSync(
      path.join(root, 'wogi-workspace.json'),
      JSON.stringify({ members: { evil: { path: '../../../etc' } } })
    );

    try {
      assert.throws(
        () => getWorkerReadyPath(root, 'evil'),
        /escapes workspace root/
      );
    } finally {
      cleanup(root);
    }
  });
});

// ============================================================
// Scenario 6: Concurrent injects
// ============================================================

describe('injectTask — concurrent writes', () => {
  let root;
  beforeEach(() => { ({ root } = makeWorkspace()); });
  afterEach(() => cleanup(root));

  it('two sequential injects both land in ready[]', () => {
    // Note: true concurrent injects in Node are serialized by the event loop
    // at the fs.renameSync call. This test exercises the read-modify-write
    // cycle and asserts no data loss.
    const r1 = injectTask(root, 'worker-a', sampleTask({ id: 'wf-11111111' }));
    const r2 = injectTask(root, 'worker-a', sampleTask({ id: 'wf-22222222' }));
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    const readyPath = getWorkerReadyPath(root, 'worker-a');
    const data = JSON.parse(fs.readFileSync(readyPath, 'utf-8'));
    assert.equal(data.ready.length, 2);
    const ids = data.ready.map(t => t.id).sort();
    assert.deepEqual(ids, ['wf-11111111', 'wf-22222222']);
  });
});

// ============================================================
// Scenario 7: validateTaskRecord unit
// ============================================================

describe('validateTaskRecord', () => {
  it('accepts valid record', () => {
    assert.doesNotThrow(() => validateTaskRecord(sampleTask()));
  });

  it('rejects title over 500 chars', () => {
    assert.throws(
      () => validateTaskRecord(sampleTask({ title: 'x'.repeat(501) })),
      /exceeds 500/
    );
  });
});
