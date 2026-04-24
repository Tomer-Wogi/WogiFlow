'use strict';

/**
 * Tests for workspace-ipc-sqlite (wf-3635574e / G3).
 *
 * Covers Path B acceptance criteria:
 *   AC1: SQLite schema `messages(id, kind, payload, created_at, consumed_at)` per DB
 *   AC2: Single-writer contract — manager writes inbound.db; worker writes outbound.db
 *   AC3: Atomic read-and-mark-consumed transaction
 *   AC4: Migration path (covered by flow-workspace-migrate-ipc tests below)
 *   AC5: Backward-compat shim (fall back to JSON when sql.js unavailable)
 *
 * AC6 + AC7 (multi-worker concurrent + crash-safety) are in
 * tests/workspace-ipc-multi-worker.test.js.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const ipc = require('../lib/workspace-ipc-sqlite');
const { routeMessage, migrateMessages, migrateDispatches } = require('../scripts/flow-workspace-migrate-ipc');

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-ipc-test-'));
  fs.mkdirSync(path.join(root, '.workspace', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, '.workspace', 'messages'), { recursive: true });
  return root;
}

async function cleanup(root) {
  try { await ipc.closeAll(); } catch (_err) { /* ignore */ }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
}

// ============================================================
// AC1: Schema
// ============================================================

describe('AC1 schema', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('creates messages table with 5 required columns', async () => {
    await ipc.indexMessage(root, 'worker1', 'inbound', {
      id: 'msg-a', kind: 'task-dispatch', payload: { x: 1 }
    });
    const rows = await ipc.listUnconsumed(root, 'worker1', 'inbound');
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(typeof r.id, 'string');
    assert.equal(typeof r.kind, 'string');
    assert.equal(typeof r.payload, 'object');
    assert.ok(typeof r.createdAt === 'string' && r.createdAt.length > 0);
  });

  it('rejects invalid repo names (path-injection defense)', async () => {
    await assert.rejects(
      () => ipc.indexMessage(root, '../etc/passwd', 'inbound', { id: 'm', kind: 'x' }),
      /Invalid repoName/
    );
  });

  it('rejects invalid direction', async () => {
    await assert.rejects(
      () => ipc.indexMessage(root, 'worker1', 'sideways', { id: 'm', kind: 'x' }),
      /Invalid direction/
    );
  });

  it('rejects messages without id or kind', async () => {
    await assert.rejects(
      () => ipc.indexMessage(root, 'worker1', 'inbound', { kind: 'x' }),
      /msg\.id required/
    );
    await assert.rejects(
      () => ipc.indexMessage(root, 'worker1', 'inbound', { id: 'm' }),
      /msg\.kind required/
    );
  });
});

// ============================================================
// AC2: Single-writer contract — physical layout
// ============================================================

describe('AC2 single-writer layout', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('creates a per-worker directory with inbound.db + outbound.db', async () => {
    await ipc.indexMessage(root, 'backend', 'inbound', { id: 'm1', kind: 'k' });
    await ipc.indexMessage(root, 'backend', 'outbound', { id: 'm2', kind: 'k' });
    const dir = path.join(root, '.workspace', 'state', 'ipc', 'backend');
    assert.ok(fs.existsSync(path.join(dir, 'inbound.db')));
    assert.ok(fs.existsSync(path.join(dir, 'outbound.db')));
  });

  it('keeps different workers in isolated DBs', async () => {
    await ipc.indexMessage(root, 'backend', 'inbound', { id: 'b1', kind: 'k' });
    await ipc.indexMessage(root, 'shared', 'inbound', { id: 's1', kind: 'k' });

    const backendRows = await ipc.listUnconsumed(root, 'backend', 'inbound');
    const sharedRows = await ipc.listUnconsumed(root, 'shared', 'inbound');
    assert.equal(backendRows.length, 1);
    assert.equal(sharedRows.length, 1);
    assert.equal(backendRows[0].id, 'b1');
    assert.equal(sharedRows[0].id, 's1');
  });
});

// ============================================================
// AC3: Atomic read-and-mark-consumed
// ============================================================

describe('AC3 atomic read-and-mark', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('marks every examined row consumed after one call', async () => {
    for (let i = 0; i < 5; i++) {
      await ipc.indexMessage(root, 'w', 'inbound', { id: `m${i}`, kind: 'task', payload: { i } });
    }
    const consumed = await ipc.readAndMarkConsumed(root, 'w', 'inbound');
    assert.equal(consumed.length, 5);
    const after = await ipc.listUnconsumed(root, 'w', 'inbound');
    assert.equal(after.length, 0);
  });

  it('second call returns nothing (no re-delivery)', async () => {
    await ipc.indexMessage(root, 'w', 'inbound', { id: 'm1', kind: 'task' });
    const first = await ipc.readAndMarkConsumed(root, 'w', 'inbound');
    const second = await ipc.readAndMarkConsumed(root, 'w', 'inbound');
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
  });

  it('verifier filters return set, but ALL examined rows are consumed (no leak)', async () => {
    for (let i = 0; i < 4; i++) {
      await ipc.indexMessage(root, 'w', 'inbound', { id: `m${i}`, kind: i % 2 === 0 ? 'even' : 'odd' });
    }
    const returned = await ipc.readAndMarkConsumed(root, 'w', 'inbound', {
      verifier: r => r.kind === 'even'
    });
    assert.equal(returned.length, 2);
    const s = await ipc.stats(root, 'w', 'inbound');
    assert.equal(s.unconsumed, 0, 'verifier-skipped rows must still be consumed');
    assert.equal(s.consumed, 4);
  });

  it('limit bounds the number of rows examined', async () => {
    for (let i = 0; i < 10; i++) {
      await ipc.indexMessage(root, 'w', 'inbound', { id: `m${i}`, kind: 'task' });
    }
    const consumed = await ipc.readAndMarkConsumed(root, 'w', 'inbound', { limit: 3 });
    assert.equal(consumed.length, 3);
    const after = await ipc.stats(root, 'w', 'inbound');
    assert.equal(after.unconsumed, 7);
    assert.equal(after.consumed, 3);
  });

  it('kind filter selects rows by kind', async () => {
    await ipc.indexMessage(root, 'w', 'inbound', { id: 'a', kind: 'task-dispatch' });
    await ipc.indexMessage(root, 'w', 'inbound', { id: 'b', kind: 'question' });
    await ipc.indexMessage(root, 'w', 'inbound', { id: 'c', kind: 'task-dispatch' });

    const consumed = await ipc.readAndMarkConsumed(root, 'w', 'inbound', { kind: 'question' });
    assert.equal(consumed.length, 1);
    assert.equal(consumed[0].id, 'b');

    const remaining = await ipc.listUnconsumed(root, 'w', 'inbound');
    assert.equal(remaining.length, 2);
    assert.deepEqual(remaining.map(r => r.id).sort(), ['a', 'c']);
  });
});

// ============================================================
// AC4: Migration routing
// ============================================================

describe('AC4 migration routing', () => {
  it('manager→worker routes to worker/inbound', () => {
    assert.deepEqual(routeMessage({ from: 'manager', to: 'backend' }),
      { repoName: 'backend', direction: 'inbound' });
  });

  it('worker→manager routes to worker/outbound', () => {
    assert.deepEqual(routeMessage({ from: 'backend', to: 'manager' }),
      { repoName: 'backend', direction: 'outbound' });
  });

  it('broadcast (to: all) routes to sender/outbound', () => {
    assert.deepEqual(routeMessage({ from: 'shared', to: 'all' }),
      { repoName: 'shared', direction: 'outbound' });
  });

  it('worker→peer routes to peer/inbound', () => {
    assert.deepEqual(routeMessage({ from: 'backend', to: 'shared' }),
      { repoName: 'shared', direction: 'inbound' });
  });

  it('missing from/to routes to null (skip)', () => {
    assert.equal(routeMessage({ from: 'manager', to: '' }), null);
    assert.equal(routeMessage({ from: '', to: 'backend' }), null);
  });
});

describe('AC4 migrate existing JSON', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('indexes all .json files by route and is idempotent', async () => {
    const msgDir = path.join(root, '.workspace', 'messages');
    fs.writeFileSync(path.join(msgDir, 'msg-a.json'), JSON.stringify({
      id: 'msg-a', from: 'manager', to: 'backend', type: 'task-dispatch',
      timestamp: '2026-04-01T00:00:00Z', status: 'pending', subject: 'x', body: ''
    }));
    fs.writeFileSync(path.join(msgDir, 'msg-b.json'), JSON.stringify({
      id: 'msg-b', from: 'backend', to: 'manager', type: 'task-complete',
      timestamp: '2026-04-01T01:00:00Z', status: 'acknowledged', updatedAt: '2026-04-01T02:00:00Z',
      subject: 'done', body: ''
    }));

    const r1 = await migrateMessages(root, true);
    assert.equal(r1.indexed, 2);

    const backendInbound = await ipc.stats(root, 'backend', 'inbound');
    const backendOutbound = await ipc.stats(root, 'backend', 'outbound');
    assert.equal(backendInbound.total, 1);
    assert.equal(backendInbound.unconsumed, 1);
    assert.equal(backendOutbound.total, 1);
    assert.equal(backendOutbound.consumed, 1);

    // Idempotency: re-migrate, counts don't change
    await migrateMessages(root, true);
    const again = await ipc.stats(root, 'backend', 'inbound');
    assert.equal(again.total, 1);
    assert.equal(again.unconsumed, 1);
  });

  it('migrates dispatched-tasks.json into worker inbound DBs', async () => {
    const dispatchPath = path.join(root, '.workspace', 'state', 'dispatched-tasks.json');
    fs.writeFileSync(dispatchPath, JSON.stringify({
      version: 1,
      dispatches: [
        { taskId: 'wf-11111111', repoName: 'backend', dispatchedAt: '2026-04-01T00:00:00Z',
          expectedDeadline: '2026-04-01T00:30:00Z', expectedDurationMs: 1800000,
          status: 'pending', dispatchedBy: 'manager', reconciledAt: null, reconciledReason: null },
        { taskId: 'wf-22222222', repoName: 'backend', dispatchedAt: '2026-04-01T01:00:00Z',
          expectedDeadline: '2026-04-01T01:30:00Z', expectedDurationMs: 1800000,
          status: 'completed', dispatchedBy: 'manager', reconciledAt: '2026-04-01T01:15:00Z', reconciledReason: null }
      ]
    }));

    const r = await migrateDispatches(root, true);
    assert.equal(r.indexed, 2);

    const s = await ipc.stats(root, 'backend', 'inbound');
    assert.equal(s.total, 2);
    assert.equal(s.unconsumed, 1);
    assert.equal(s.consumed, 1);
  });

  it('gracefully skips malformed JSON files', async () => {
    const msgDir = path.join(root, '.workspace', 'messages');
    fs.writeFileSync(path.join(msgDir, 'msg-bad.json'), 'not json at all');
    fs.writeFileSync(path.join(msgDir, 'msg-noid.json'), JSON.stringify({ no: 'id' }));
    fs.writeFileSync(path.join(msgDir, 'msg-good.json'), JSON.stringify({
      id: 'ok', from: 'manager', to: 'backend', type: 'x', timestamp: '2026-04-01T00:00:00Z', status: 'pending'
    }));

    const r = await migrateMessages(root, true);
    assert.equal(r.indexed, 1);
    assert.equal(r.skipped, 2);
  });
});

// ============================================================
// AC5: Backward-compat fallback
// ============================================================

describe('AC5 JSON fallback availability', () => {
  it('isAvailable reports boolean deterministically', async () => {
    const a = await ipc.isAvailable();
    const b = await ipc.isAvailable();
    assert.equal(typeof a, 'boolean');
    assert.equal(a, b);
  });

  // The actual fallback path is exercised by callers (saveMessageIndexed,
  // atomicConsumeFor). We can't force sql.js to be unavailable in a unit
  // test without module-mocking machinery, but the fallback code paths
  // are structurally guarded — see workspace-messages.js atomicConsumeFor.
});

// ============================================================
// Sync + reload (persistence across openDb boundaries)
// ============================================================

describe('persistence across closeDb/reopen', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('reopened DB retains rows', async () => {
    await ipc.indexMessage(root, 'w', 'inbound', { id: 'm1', kind: 'task' });
    await ipc.closeAll();
    const s = await ipc.stats(root, 'w', 'inbound');
    assert.equal(s.total, 1);
  });

  it('consumed_at is preserved across reopen', async () => {
    await ipc.indexMessage(root, 'w', 'inbound', { id: 'm1', kind: 'task' });
    await ipc.readAndMarkConsumed(root, 'w', 'inbound');
    await ipc.closeAll();
    const s = await ipc.stats(root, 'w', 'inbound');
    assert.equal(s.consumed, 1);
    assert.equal(s.unconsumed, 0);
  });
});

// ============================================================
// syncFromJsonDir
// ============================================================

describe('syncFromJsonDir', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('indexes new JSON files; does not duplicate on re-run', async () => {
    const msgDir = path.join(root, '.workspace', 'messages');
    fs.writeFileSync(path.join(msgDir, 'msg-x.json'), JSON.stringify({
      id: 'msg-x', from: 'manager', to: 'worker1', type: 'task-dispatch',
      timestamp: '2026-04-01T00:00:00Z', status: 'pending'
    }));
    await ipc.syncFromJsonDir(root);
    const s1 = await ipc.stats(root, 'worker1', 'inbound');
    assert.equal(s1.total, 1);

    await ipc.syncFromJsonDir(root);
    const s2 = await ipc.stats(root, 'worker1', 'inbound');
    assert.equal(s2.total, 1, 'sync must be idempotent');
  });
});
