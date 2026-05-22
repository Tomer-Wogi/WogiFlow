'use strict';

/**
 * Tests for lib/workspace-subtask-state.js (epic-workspace-sustained-exec / S1).
 *
 * Covers: atomic write + read, taskId-scoped read isolation, remaining()
 * semantics (pending+in_progress only), summary(), markStatus, clear,
 * subtasksFromTodos mapping, and cross-process durability (fresh node reads it).
 *
 * Run: NODE_ENV=test node --test tests/flow-workspace-subtask-state.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

// Point PATHS at a temp project root BEFORE requiring the module.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-subtask-'));
fs.mkdirSync(path.join(TMP_ROOT, '.workflow', 'state'), { recursive: true });
process.env.WOGI_PROJECT_ROOT = TMP_ROOT;

const ss = require('../lib/workspace-subtask-state');

after(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
});

describe('workspace-subtask-state: write + read', () => {
  it('writes atomically and reads back', () => {
    const r = ss.write('wf-aaaa1111', [
      { content: 'one', status: 'completed' },
      { content: 'two', status: 'pending' }
    ]);
    assert.equal(r.written, true);
    assert.ok(fs.existsSync(ss.getLedgerPath()));
    const subs = ss.read('wf-aaaa1111');
    assert.equal(subs.length, 2);
    assert.equal(subs[0].title, 'one');
    assert.equal(subs[0].status, 'completed');
  });

  it('write with no taskId is rejected', () => {
    const r = ss.write('', [{ content: 'x' }]);
    assert.equal(r.written, false);
    assert.equal(r.reason, 'no-task-id');
  });

  it('read returns [] for a non-matching taskId (no cross-task contamination)', () => {
    ss.write('wf-bbbb2222', [{ content: 'a', status: 'pending' }]);
    assert.deepEqual(ss.read('wf-cccc3333'), []);
    assert.equal(ss.read('wf-bbbb2222').length, 1);
  });
});

describe('workspace-subtask-state: remaining() semantics', () => {
  it('counts pending + in_progress, ignores completed + blocked', () => {
    ss.write('wf-dddd4444', [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'pending' },
      { content: 'c', status: 'in_progress' },
      { content: 'd', status: 'blocked' }
    ]);
    assert.equal(ss.remaining('wf-dddd4444'), 2);
    assert.deepEqual(ss.summary('wf-dddd4444'), { total: 4, remaining: 2, completed: 1, blocked: 1 });
  });

  it('remaining is 0 for an unknown task (no durable state)', () => {
    assert.equal(ss.remaining('wf-nope0000'), 0);
  });
});

describe('workspace-subtask-state: markStatus + clear', () => {
  it('marks one sub-task without disturbing others', () => {
    ss.write('wf-eeee5555', [
      { id: '01', content: 'a', status: 'pending' },
      { id: '02', content: 'b', status: 'pending' }
    ]);
    ss.markStatus('wf-eeee5555', '01', 'completed');
    assert.equal(ss.remaining('wf-eeee5555'), 1);
    const subs = ss.read('wf-eeee5555');
    assert.equal(subs.find(s => s.id === '01').status, 'completed');
    assert.equal(subs.find(s => s.id === '02').status, 'pending');
  });

  it('markStatus no-ops on a non-matching task', () => {
    ss.write('wf-ffff6666', [{ id: '01', content: 'a', status: 'pending' }]);
    const r = ss.markStatus('wf-other999', '01', 'completed');
    assert.equal(r.written, false);
  });

  it('clear removes the ledger', () => {
    ss.write('wf-gggg7777', [{ content: 'a', status: 'pending' }]);
    ss.clear();
    assert.equal(ss.remaining('wf-gggg7777'), 0);
    assert.equal(fs.existsSync(ss.getLedgerPath()), false);
  });
});

describe('workspace-subtask-state: subtasksFromTodos', () => {
  it('maps TodoWrite todos into normalized sub-tasks', () => {
    const subs = ss.subtasksFromTodos({
      todos: [
        { content: 'first', status: 'in_progress' },
        { content: 'second', status: 'completed' },
        { content: 'third' }
      ]
    });
    assert.equal(subs.length, 3);
    assert.equal(subs[0].status, 'in_progress');
    assert.equal(subs[2].status, 'pending'); // missing status defaults to pending
    assert.equal(subs[0].id, '01');
  });

  it('returns [] for non-todo input', () => {
    assert.deepEqual(ss.subtasksFromTodos({}), []);
    assert.deepEqual(ss.subtasksFromTodos(null), []);
  });
});

describe('workspace-subtask-state: cross-process durability (S1.3)', () => {
  it('a fresh node process reads remaining() from disk', () => {
    ss.write('wf-hhhh8888', [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'pending' },
      { content: 'c', status: 'pending' }
    ]);
    const script = `
      process.env.WOGI_PROJECT_ROOT = ${JSON.stringify(TMP_ROOT)};
      const ss = require(${JSON.stringify(path.resolve(__dirname, '../lib/workspace-subtask-state'))});
      process.stdout.write(String(ss.remaining('wf-hhhh8888')));
    `;
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf-8' }).trim();
    assert.equal(out, '2');
  });
});
