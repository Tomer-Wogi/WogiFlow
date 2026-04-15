'use strict';

/**
 * Tests for flow-memory.js (wf-e64cacd0).
 *
 * Covers: parseDuration, normalizeTag, KINDS export, loadAllMemory coverage,
 * queryMemory filter semantics (since / kind / task / tag), fetchByRef happy
 * + missing paths, memoryStats shape, addTag/removeTag round-trip, memory-tags
 * sidecar round-trip (boundary: never mutates source files).
 *
 * Run: NODE_ENV=test node --test tests/flow-memory.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

const memory = require('../scripts/flow-memory');
const { PATHS } = require('../scripts/flow-utils');

const TAGS_FILE = memory.MEMORY_TAGS_FILE;

function backupTagsFile() {
  if (fs.existsSync(TAGS_FILE)) return fs.readFileSync(TAGS_FILE, 'utf-8');
  return null;
}

function restoreTagsFile(contents) {
  if (contents === null) {
    try { fs.unlinkSync(TAGS_FILE); } catch (_err) {}
  } else {
    fs.writeFileSync(TAGS_FILE, contents);
  }
}

describe('parseDuration', () => {
  it('parses minutes/hours/days/weeks', () => {
    assert.equal(memory.parseDuration('30m'), 30 * 60_000);
    assert.equal(memory.parseDuration('2h'), 2 * 3_600_000);
    assert.equal(memory.parseDuration('7d'), 7 * 86_400_000);
    assert.equal(memory.parseDuration('2w'), 2 * 604_800_000);
  });

  it('returns null for invalid input', () => {
    assert.equal(memory.parseDuration(''), null);
    assert.equal(memory.parseDuration('bogus'), null);
    assert.equal(memory.parseDuration(null), null);
    assert.equal(memory.parseDuration(undefined), null);
    assert.equal(memory.parseDuration('1y'), null); // years not supported
  });

  it('handles decimals', () => {
    assert.equal(memory.parseDuration('1.5h'), 1.5 * 3_600_000);
  });
});

describe('normalizeTag', () => {
  it('adds # prefix and lowercases', () => {
    assert.equal(memory.normalizeTag('Important'), '#important');
    assert.equal(memory.normalizeTag('#Important'), '#important');
    assert.equal(memory.normalizeTag('urgent'), '#urgent');
  });

  it('returns empty for empty/null', () => {
    assert.equal(memory.normalizeTag(''), '');
    assert.equal(memory.normalizeTag(null), '');
    assert.equal(memory.normalizeTag(undefined), '');
  });
});

describe('KINDS export', () => {
  it('exposes all 7 memory kinds', () => {
    const expected = ['task', 'requestlog', 'correction', 'adversary', 'rule', 'pattern', 'phrase'];
    for (const k of expected) {
      assert.ok(memory.KINDS[k], `missing kind: ${k}`);
    }
  });
});

describe('loadAllMemory — non-empty on live project', () => {
  it('returns at least one task', () => {
    const tasks = memory.loadTasks();
    assert.ok(tasks.length > 0, 'expected at least 1 task in ready.json');
  });

  it('includes entries from all sources present on disk', () => {
    const all = memory.loadAllMemory();
    assert.ok(all.length > 0);
    // Each entry has the normalized shape
    for (const e of all) {
      assert.ok(typeof e.kind === 'string');
      assert.ok(typeof e.ref === 'string');
      assert.ok(Array.isArray(e.taskIds));
      assert.ok(Array.isArray(e.tags));
    }
  });
});

describe('queryMemory — filters', () => {
  it('returns error object for unknown kind', () => {
    const r = memory.queryMemory({ kind: 'bogus-kind' });
    assert.ok(r.error);
    assert.ok(Array.isArray(r.valid));
  });

  it('returns error object for unparsable duration', () => {
    const r = memory.queryMemory({ since: 'not-a-duration' });
    assert.ok(r.error);
  });

  it('filters by kind=task', () => {
    const r = memory.queryMemory({ kind: 'task', limit: 1000 });
    assert.ok(Array.isArray(r));
    for (const e of r) {
      assert.equal(e.kind, 'task');
    }
  });

  it('filters by kind=requestlog', () => {
    const r = memory.queryMemory({ kind: 'requestlog', limit: 1000 });
    assert.ok(Array.isArray(r));
    for (const e of r) {
      assert.equal(e.kind, 'requestlog');
    }
  });

  it('filters by task id (returns task itself + related)', () => {
    // Find any task that exists in ready.json to use as the needle
    const tasks = memory.loadTasks();
    if (tasks.length === 0) return; // degraded test — no tasks
    const needle = tasks[0].ref;
    const r = memory.queryMemory({ task: needle, limit: 1000 });
    assert.ok(Array.isArray(r));
    assert.ok(r.length >= 1, 'expected at least the task itself');
    // At least one entry should have matching ref or taskIds
    const hasMatch = r.some(e =>
      e.ref.toLowerCase() === needle.toLowerCase() ||
      (e.taskIds || []).some(id => id.toLowerCase() === needle.toLowerCase())
    );
    assert.ok(hasMatch);
  });

  it('limit works (cap result count)', () => {
    const r = memory.queryMemory({ limit: 3 });
    assert.ok(Array.isArray(r));
    assert.ok(r.length <= 3);
  });

  it('results are sorted newest first', () => {
    const r = memory.queryMemory({ kind: 'requestlog', limit: 100 });
    for (let i = 1; i < r.length; i++) {
      if (r[i - 1].timestamp && r[i].timestamp) {
        assert.ok(
          Date.parse(r[i - 1].timestamp) >= Date.parse(r[i].timestamp),
          `entry ${i} is newer than entry ${i - 1}`
        );
      }
    }
  });
});

describe('fetchByRef', () => {
  it('returns found=false with suggestion for unknown ref', () => {
    const r = memory.fetchByRef('nonexistent-ref-xyz');
    assert.equal(r.found, false);
    assert.ok(r.reason);
    assert.ok(r.suggestion);
  });

  it('returns found=false for empty ref', () => {
    const r = memory.fetchByRef('');
    assert.equal(r.found, false);
  });

  it('returns found=true for a known task with related entries', () => {
    const tasks = memory.loadTasks();
    if (tasks.length === 0) return;
    const needle = tasks[0].ref;
    const r = memory.fetchByRef(needle);
    assert.equal(r.found, true);
    assert.equal(r.entry.ref, needle);
    assert.ok(Array.isArray(r.related));
  });
});

describe('memoryStats', () => {
  it('returns object with expected fields', () => {
    const s = memory.memoryStats();
    assert.equal(typeof s.tasks.total, 'number');
    assert.equal(typeof s.tasks.byBucket.inProgress, 'number');
    assert.equal(typeof s.requestLog, 'number');
    assert.equal(typeof s.corrections, 'number');
    assert.equal(typeof s.adversaryRuns, 'number');
    assert.equal(typeof s.rules, 'number');
    assert.equal(typeof s.feedbackPatterns, 'number');
    assert.equal(typeof s.correctionPhrases, 'number');
    assert.equal(typeof s.tags, 'number');
  });
});

describe('tag round-trip (sidecar only — source files NOT mutated)', () => {
  let originalTags;

  beforeEach(() => { originalTags = backupTagsFile(); });
  afterEach(() => { restoreTagsFile(originalTags); });

  it('addTag then query --tag finds it; removeTag clears it', async () => {
    const ref = 'test-tag-ref-xyz';
    const tag = '#test-tag-unique';
    const r1 = await memory.addTag(ref, tag);
    assert.equal(r1.ok, true);
    assert.equal(r1.tag, tag);
    const tags = memory.loadMemoryTags();
    assert.ok(Array.isArray(tags[ref]));
    assert.ok(tags[ref].includes(tag));
    const r2 = await memory.removeTag(ref, tag);
    assert.equal(r2.ok, true);
    const tagsAfter = memory.loadMemoryTags();
    assert.equal(tagsAfter[ref], undefined);
  });

  it('addTag is idempotent (no duplicate)', async () => {
    const ref = 'test-idempotent-ref';
    const tag = '#idempotent';
    await memory.addTag(ref, tag);
    await memory.addTag(ref, tag);
    const tags = memory.loadMemoryTags();
    assert.equal(tags[ref].filter(t => t === tag).length, 1);
  });

  it('normalizes tag before storing', async () => {
    const ref = 'test-normalize-ref';
    await memory.addTag(ref, 'URGENT');  // no # prefix, uppercase
    const tags = memory.loadMemoryTags();
    assert.ok(tags[ref].includes('#urgent'));
  });

  it('rejects empty ref or tag', async () => {
    const r1 = await memory.addTag('', '#tag');
    const r2 = await memory.addTag('ref', '');
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
  });

  it('query --tag=<t> returns the tagged entry', async () => {
    const tasks = memory.loadTasks();
    if (tasks.length === 0) return;
    const needle = tasks[0].ref;
    const tag = '#query-tag-test';
    await memory.addTag(needle, tag);
    const r = memory.queryMemory({ tag });
    assert.ok(r.some(e => e.ref === needle));
    const found = r.find(e => e.ref === needle);
    assert.ok((found.tags || []).includes(tag));
  });
});

describe('boundary — source memory files are never mutated', () => {
  it('addTag writes to sidecar only, not to ready.json or decisions.md', async () => {
    const readyBefore = fs.existsSync(path.join(PATHS.state, 'ready.json'))
      ? fs.readFileSync(path.join(PATHS.state, 'ready.json'), 'utf-8')
      : '';
    const decisionsBefore = fs.existsSync(path.join(PATHS.state, 'decisions.md'))
      ? fs.readFileSync(path.join(PATHS.state, 'decisions.md'), 'utf-8')
      : '';
    const originalTags = backupTagsFile();
    try {
      await memory.addTag('boundary-test-ref', '#boundary');
      const readyAfter = fs.existsSync(path.join(PATHS.state, 'ready.json'))
        ? fs.readFileSync(path.join(PATHS.state, 'ready.json'), 'utf-8')
        : '';
      const decisionsAfter = fs.existsSync(path.join(PATHS.state, 'decisions.md'))
        ? fs.readFileSync(path.join(PATHS.state, 'decisions.md'), 'utf-8')
        : '';
      assert.equal(readyAfter, readyBefore, 'ready.json must not be mutated by addTag');
      assert.equal(decisionsAfter, decisionsBefore, 'decisions.md must not be mutated by addTag');
    } finally {
      restoreTagsFile(originalTags);
    }
  });
});
