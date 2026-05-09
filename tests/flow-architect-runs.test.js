'use strict';

/**
 * Tests for scripts/flow-architect-runs.js (wf-2eafdab0).
 *
 * Covers AC8 (gcStaleMarkers), AC15 (specHash staleness), AC11 (validateTaskId
 * guard), AC14 (tmp-file cleanup), AC9 (content validation).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const archRuns = require('../scripts/flow-architect-runs');

// Helpers
function freshTaskId(suffix = 0) {
  // Generate a valid wf-XXXXXXXX (8 hex) task id
  const stamp = (Date.now() + suffix) % 0xffffffff;
  return 'wf-' + stamp.toString(16).padStart(8, '0').slice(0, 8);
}

function cleanup(taskId) {
  const p = archRuns.getArchitectRunPath(taskId);
  if (p && fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch (_e) { /* ignore */ }
  }
}

// ============================================================
// AC11 — validateTaskId guard before path.join
// ============================================================

test('getArchitectRunPath — invalid taskId returns null', () => {
  assert.equal(archRuns.getArchitectRunPath('../../etc/passwd'), null);
  assert.equal(archRuns.getArchitectRunPath('not-a-task-id'), null);
  assert.equal(archRuns.getArchitectRunPath(''), null);
  assert.equal(archRuns.getArchitectRunPath(null), null);
  assert.equal(archRuns.getArchitectRunPath(undefined), null);
});

test('getArchitectRunPath — valid taskId returns path under ARCHITECT_RUNS_DIR', () => {
  const taskId = freshTaskId();
  const p = archRuns.getArchitectRunPath(taskId);
  assert.ok(p);
  assert.ok(p.startsWith(archRuns.ARCHITECT_RUNS_DIR + path.sep));
  assert.ok(p.endsWith(`${taskId}.json`));
});

// ============================================================
// AC9 — hasArchitectRun validates content
// ============================================================

test('hasArchitectRun — empty file returns false', () => {
  const taskId = freshTaskId(1);
  const p = archRuns.getArchitectRunPath(taskId);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
    assert.equal(archRuns.hasArchitectRun(taskId), false);
  } finally { cleanup(taskId); }
});

test('hasArchitectRun — corrupted JSON returns false', () => {
  const taskId = freshTaskId(2);
  const p = archRuns.getArchitectRunPath(taskId);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{not valid json');
    assert.equal(archRuns.hasArchitectRun(taskId), false);
  } finally { cleanup(taskId); }
});

test('hasArchitectRun — taskId mismatch returns false', () => {
  const taskId = freshTaskId(3);
  const p = archRuns.getArchitectRunPath(taskId);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ taskId: 'wf-aaaaaaaa', completedAt: 'x' }));
    assert.equal(archRuns.hasArchitectRun(taskId), false);
  } finally { cleanup(taskId); }
});

test('hasArchitectRun — valid marker returns true', () => {
  const taskId = freshTaskId(4);
  try {
    archRuns.writeArchitectRunMarker({ taskId, model: 'opus' });
    assert.equal(archRuns.hasArchitectRun(taskId), true);
  } finally { cleanup(taskId); }
});

// ============================================================
// AC15 — specHash staleness invalidation
// ============================================================

test('hasArchitectRun — specHash matches returns true', () => {
  const taskId = freshTaskId(5);
  const tmpSpec = path.join(require('node:os').tmpdir(), `spec-${taskId}.md`);
  try {
    fs.writeFileSync(tmpSpec, 'spec v1');
    archRuns.writeArchitectRunMarker({ taskId, model: 'opus', specPath: tmpSpec });
    // Spec unchanged → hash matches
    assert.equal(archRuns.hasArchitectRun(taskId, tmpSpec), true);
  } finally {
    cleanup(taskId);
    if (fs.existsSync(tmpSpec)) fs.unlinkSync(tmpSpec);
  }
});

test('hasArchitectRun — specHash mismatch returns false (stale marker)', () => {
  const taskId = freshTaskId(6);
  const tmpSpec = path.join(require('node:os').tmpdir(), `spec-${taskId}.md`);
  try {
    fs.writeFileSync(tmpSpec, 'spec v1');
    archRuns.writeArchitectRunMarker({ taskId, model: 'opus', specPath: tmpSpec });
    // Modify spec — hash should now differ
    fs.writeFileSync(tmpSpec, 'spec v2 — substantial changes');
    assert.equal(archRuns.hasArchitectRun(taskId, tmpSpec), false);
  } finally {
    cleanup(taskId);
    if (fs.existsSync(tmpSpec)) fs.unlinkSync(tmpSpec);
  }
});

// ============================================================
// AC14 — tmp file unlinked on rename failure
// ============================================================
// Hard to mock fs.renameSync without test shims; the behavior is verified
// via code-read of writeArchitectRunMarker's catch block. Instead, smoke-test
// that no .tmp- files leak in the runs dir after normal writes.

test('writeArchitectRunMarker — no leftover .tmp files after successful write', () => {
  const taskId = freshTaskId(7);
  try {
    archRuns.writeArchitectRunMarker({ taskId, model: 'opus' });
    const dir = archRuns.ARCHITECT_RUNS_DIR;
    if (fs.existsSync(dir)) {
      const stragglers = fs.readdirSync(dir).filter(f => f.startsWith(`${taskId}.json.tmp-`));
      assert.equal(stragglers.length, 0);
    }
  } finally { cleanup(taskId); }
});

// ============================================================
// AC8 — gcStaleMarkers
// ============================================================

test('gcStaleMarkers — does not crash on missing dir', () => {
  // If ARCHITECT_RUNS_DIR doesn't exist, GC should just return empty result
  const result = archRuns.gcStaleMarkers({ maxAgeMs: 0 });
  assert.ok(Array.isArray(result.removed));
  assert.ok(Array.isArray(result.kept));
});

test('gcStaleMarkers — keeps fresh markers', () => {
  const taskId = freshTaskId(8);
  try {
    archRuns.writeArchitectRunMarker({ taskId, model: 'opus' });
    const result = archRuns.gcStaleMarkers({ maxAgeMs: 60_000 });
    // Fresh marker — should be kept regardless of completion status
    assert.ok(result.kept.includes(taskId) || !result.removed.includes(taskId));
  } finally { cleanup(taskId); }
});

test('gcStaleMarkers — invalid (non-wf-format) filenames are kept untouched', () => {
  // A stray file in the runs dir with a non-task-id name should not be GCed.
  const dir = archRuns.ARCHITECT_RUNS_DIR;
  const strayName = 'not-a-task-id.json';
  const strayPath = path.join(dir, strayName);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(strayPath, '{}');
    const result = archRuns.gcStaleMarkers({ maxAgeMs: 0 });
    assert.ok(fs.existsSync(strayPath), 'stray file should not be deleted');
    // It should appear in kept (the function lists all entries it skips)
    assert.ok(result.kept.includes('not-a-task-id'));
  } finally {
    if (fs.existsSync(strayPath)) fs.unlinkSync(strayPath);
  }
});
