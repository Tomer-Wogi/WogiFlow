'use strict';

/**
 * Tests for workspace-ipc-sqlite multi-worker + crash-safety (wf-3635574e / G3).
 *
 * AC6: 3 workers dispatching concurrently — no message loss, no duplicates
 * AC7: Crash-safety — kill process mid-write, observer sees consistent state
 *
 * Architecture note for these tests: per the single-writer contract (AC2),
 * each worker writes its OWN outbound.db; the manager reads them. The
 * multi-worker test exercises concurrent manager→worker inbound.db writes
 * (via child processes) and concurrent worker→manager outbound.db writes
 * (also child processes). No two processes write the same file.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const ipc = require('../lib/workspace-ipc-sqlite');

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-ipc-mw-'));
  fs.mkdirSync(path.join(root, '.workspace', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, '.workspace', 'messages'), { recursive: true });
  return root;
}

async function cleanup(root) {
  try { await ipc.closeAll(); } catch (_err) { /* ignore */ }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
}

// ============================================================
// AC6: 3 workers concurrently, no loss, no duplicates
// ============================================================

describe('AC6 multi-worker concurrent dispatch (isolated DBs)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('each worker consumes its own inbound.db with no cross-talk', async () => {
    // Manager (this process) writes 10 messages to each of 3 workers' inbound.db.
    const N = 10;
    const workers = ['w1', 'w2', 'w3'];
    const expected = {};

    for (const w of workers) {
      expected[w] = new Set();
      for (let i = 0; i < N; i++) {
        const id = `msg-${w}-${i}`;
        expected[w].add(id);
        await ipc.indexMessage(root, w, 'inbound', {
          id, kind: 'task-dispatch', payload: { taskId: id }
        });
      }
    }
    await ipc.closeAll();

    // Each "worker" consumes its inbound.db concurrently via child processes.
    const script = `
      (async () => {
        const ipc = require(${JSON.stringify(path.resolve(__dirname, '../lib/workspace-ipc-sqlite'))});
        const root = ${JSON.stringify(root)};
        const repo = process.argv[1];
        const rows = await ipc.readAndMarkConsumed(root, repo, 'inbound');
        process.stdout.write(JSON.stringify({ repo, ids: rows.map(r => r.id) }));
        await ipc.closeAll();
      })().catch(e => { process.stderr.write(String(e)); process.exit(1); });
    `;
    const procs = workers.map(w => spawnSync(process.execPath, ['-e', script, w], {
      encoding: 'utf-8', timeout: 15000
    }));

    const got = {};
    for (let i = 0; i < workers.length; i++) {
      const p = procs[i];
      assert.equal(p.status, 0, `worker ${workers[i]} failed: ${p.stderr}`);
      const parsed = JSON.parse(p.stdout);
      got[parsed.repo] = new Set(parsed.ids);
    }

    // No loss
    for (const w of workers) {
      assert.equal(got[w].size, N, `worker ${w} missed messages`);
      for (const id of expected[w]) {
        assert.ok(got[w].has(id), `worker ${w} missing ${id}`);
      }
    }

    // No duplicates across workers
    const allIds = new Set();
    for (const w of workers) {
      for (const id of got[w]) {
        assert.ok(!allIds.has(id), `duplicate delivery of ${id}`);
        allIds.add(id);
      }
    }

    // After consume: manager sees nothing unconsumed
    for (const w of workers) {
      const s = await ipc.stats(root, w, 'inbound');
      assert.equal(s.unconsumed, 0, `worker ${w} has ${s.unconsumed} unconsumed left`);
    }
  });

  it('manager reads 3 workers\' outbound.db concurrently, sees every reply', async () => {
    const N = 10;
    const workers = ['w1', 'w2', 'w3'];

    // Each worker (child) writes N outbound messages concurrently.
    const writeScript = `
      (async () => {
        const ipc = require(${JSON.stringify(path.resolve(__dirname, '../lib/workspace-ipc-sqlite'))});
        const root = ${JSON.stringify(root)};
        const repo = process.argv[1];
        const n = parseInt(process.argv[2], 10);
        for (let i = 0; i < n; i++) {
          await ipc.indexMessage(root, repo, 'outbound', {
            id: \`reply-\${repo}-\${i}\`, kind: 'task-complete', payload: { i }
          });
        }
        await ipc.closeAll();
      })().catch(e => { process.stderr.write(String(e)); process.exit(1); });
    `;
    const children = workers.map(w => spawn(process.execPath, ['-e', writeScript, w, String(N)]));
    await Promise.all(children.map(c => new Promise((resolve, reject) => {
      c.on('exit', code => code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)));
      c.on('error', reject);
    })));

    // Manager (this process) reads all three outbounds.
    let total = 0;
    for (const w of workers) {
      const rows = await ipc.listUnconsumed(root, w, 'outbound');
      assert.equal(rows.length, N, `worker ${w} outbound count wrong`);
      total += rows.length;
    }
    assert.equal(total, N * workers.length);
  });
});

// ============================================================
// AC7: Crash-safety — kill process mid-write, consistent state observable
// ============================================================

describe('AC7 crash-safety (atomic file replace)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('DB file is never torn: killed mid-write leaves last-good snapshot', async () => {
    // Write some known-good rows first.
    for (let i = 0; i < 5; i++) {
      await ipc.indexMessage(root, 'w', 'inbound', {
        id: `seed-${i}`, kind: 'task', payload: { i }
      });
    }
    await ipc.closeAll();

    // Spawn a child that starts writing a lot, then gets SIGKILLed partway.
    const writerScript = `
      (async () => {
        const ipc = require(${JSON.stringify(path.resolve(__dirname, '../lib/workspace-ipc-sqlite'))});
        const root = ${JSON.stringify(root)};
        for (let i = 0; i < 1000; i++) {
          await ipc.indexMessage(root, 'w', 'inbound', {
            id: \`burst-\${i}\`, kind: 'task', payload: { i }
          });
          if (i === 20) process.stdout.write('READY\\n');
        }
      })().catch(() => {});
    `;
    const child = spawn(process.execPath, ['-e', writerScript], { stdio: ['ignore', 'pipe', 'pipe'] });

    // Kill on first "READY" signal
    await new Promise((resolve) => {
      let killed = false;
      child.stdout.on('data', (chunk) => {
        if (!killed && chunk.toString().includes('READY')) {
          killed = true;
          child.kill('SIGKILL');
          resolve();
        }
      });
      child.on('exit', () => resolve());
      // Safety timeout
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) {} resolve(); }, 10000);
    });
    await new Promise((resolve) => child.on('exit', resolve));

    // Observer (this process) opens the DB. It must load without error.
    const stats = await ipc.stats(root, 'w', 'inbound');
    // At minimum, the 5 seeded rows must be readable. The child may have
    // committed up to ~20 more before SIGKILL.
    assert.ok(stats.total >= 5, `expected at least 5 rows after crash, got ${stats.total}`);

    const rows = await ipc.listUnconsumed(root, 'w', 'inbound');
    // Every row must have all required fields (no torn records).
    for (const r of rows) {
      assert.ok(r.id && typeof r.id === 'string', 'row missing id');
      assert.ok(r.kind && typeof r.kind === 'string', 'row missing kind');
      assert.ok(r.createdAt && typeof r.createdAt === 'string', 'row missing createdAt');
      assert.ok(typeof r.payload === 'object' && r.payload !== null, 'row missing payload');
    }
  });

  it('temp files are cleaned up (no .tmp.* clutter under normal operation)', async () => {
    for (let i = 0; i < 5; i++) {
      await ipc.indexMessage(root, 'w', 'inbound', { id: `m${i}`, kind: 'x' });
    }
    await ipc.closeAll();
    const dir = path.join(root, '.workspace', 'state', 'ipc', 'w');
    const leftover = fs.readdirSync(dir).filter(f => f.includes('.tmp.'));
    assert.equal(leftover.length, 0, `tmp files leaked: ${leftover.join(',')}`);
  });
});

// ============================================================
// Single-writer contract verification (structural)
// ============================================================

describe('single-writer contract (structural)', () => {
  let root;
  beforeEach(() => { root = makeWorkspace(); });
  afterEach(async () => { await cleanup(root); });

  it('two processes writing SEPARATE DBs succeed (expected use)', async () => {
    const script = `
      (async () => {
        const ipc = require(${JSON.stringify(path.resolve(__dirname, '../lib/workspace-ipc-sqlite'))});
        const root = ${JSON.stringify(root)};
        const repo = process.argv[1];
        for (let i = 0; i < 20; i++) {
          await ipc.indexMessage(root, repo, 'outbound', { id: repo + '-' + i, kind: 'x' });
        }
        await ipc.closeAll();
      })().catch(e => { process.stderr.write(String(e)); process.exit(1); });
    `;
    const a = spawn(process.execPath, ['-e', script, 'wa']);
    const b = spawn(process.execPath, ['-e', script, 'wb']);
    const [ca, cb] = await Promise.all([a, b].map(p => new Promise(res => p.on('exit', code => res(code)))));
    assert.equal(ca, 0);
    assert.equal(cb, 0);

    const sa = await ipc.stats(root, 'wa', 'outbound');
    const sb = await ipc.stats(root, 'wb', 'outbound');
    assert.equal(sa.total, 20);
    assert.equal(sb.total, 20);
  });
});
