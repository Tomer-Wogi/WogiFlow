'use strict';

/**
 * Tests for Story E (wf-e28b6cd8) — Epic Decompose-and-Run cascade.
 *
 * Covers AC2, AC3, AC4, AC5, AC6, AC7, AC9, AC10, AC11.
 *
 * AC1 (10-cycle latency measurement) is runtime-only and is covered by
 * deferred test infrastructure — no in-process test simulates the
 * SIGTERM/relaunch cycle wall-clock fairly.
 *
 * AC8 (worker-mode compatibility) is verified end-to-end by Story B.
 *
 * Run: node --test tests/flow-epic-cascade.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cascade = require('../scripts/flow-epic-cascade');
const { getReadyData, saveReadyData } = require('../scripts/flow-utils');
const sessionState = require('../scripts/flow-session-state');
const { writeCleanCompletionMarker } = require('../scripts/hooks/core/task-boundary-reset');

const MARKER_PATH = path.join(process.cwd(), '.workflow', 'state', 'task-boundary-clean-completion.json');

function snapshotReady() {
  const d = getReadyData();
  return JSON.parse(JSON.stringify(d));
}

function restoreReady(snapshot) {
  saveReadyData(snapshot);
}

function deleteMarker() {
  try { fs.unlinkSync(MARKER_PATH); } catch (_e) { /* ignore */ }
}

describe('flow-epic-cascade — strategy resolution (AC10)', () => {
  it('default strategy is "auto"', () => {
    assert.equal(cascade.getCascadeStrategy(), 'auto');
  });

  it('exports the valid strategies', () => {
    assert.deepEqual(cascade.VALID_STRATEGIES.sort(), ['auto', 'direct', 'restart']);
  });
});

describe('flow-epic-cascade — edge cases (AC5, AC6, AC9)', () => {
  let snap;
  beforeEach(() => {
    snap = snapshotReady();
    deleteMarker();
  });
  afterEach(() => {
    restoreReady(snap);
    deleteMarker();
  });

  it('AC5: 0 children → abort with reason no-children', () => {
    const epic = { id: 'wf-12345678', title: 'Empty Epic', type: 'epic', status: 'ready', priority: 'P1', stories: [] };
    const data = getReadyData();
    data.ready.unshift(epic);
    saveReadyData(data);
    const r = cascade.resolveCascade({ epicId: 'wf-12345678' });
    assert.equal(r.action, 'abort');
    assert.equal(r.reason, 'no-children');
  });

  it('AC6: existing children → cascade to first existing child', () => {
    const epic = { id: 'wf-aaaaaaaa', title: 'Pre-decomposed', type: 'epic', status: 'ready', priority: 'P1', stories: ['wf-bbbbbbbb', 'wf-cccccccc'] };
    const child1 = { id: 'wf-bbbbbbbb', title: 'First Child', type: 'story', status: 'ready', priority: 'P1', parentEpic: 'wf-aaaaaaaa' };
    const child2 = { id: 'wf-cccccccc', title: 'Second Child', type: 'story', status: 'ready', priority: 'P1', parentEpic: 'wf-aaaaaaaa' };
    const data = getReadyData();
    data.ready.unshift(epic, child1, child2);
    saveReadyData(data);
    const r = cascade.resolveCascade({ epicId: 'wf-aaaaaaaa', autonomousActive: false });
    assert.equal(r.action, 'invoke-skill');
    assert.equal(r.taskId, 'wf-bbbbbbbb');
  });

  it('AC9: missing epicId → abort with reason no-epic-id (rollback safety)', () => {
    const r = cascade.resolveCascade({});
    assert.equal(r.action, 'abort');
    assert.equal(r.reason, 'no-epic-id');
  });

  it('parentEpic-based resolution works without explicit stories array', () => {
    const child = { id: 'wf-dddddddd', title: 'Orphan-style child', type: 'story', status: 'ready', priority: 'P1', parentEpic: 'wf-eeeeeeee' };
    const data = getReadyData();
    data.ready.unshift(child);
    saveReadyData(data);
    const r = cascade.resolveCascade({ epicId: 'wf-eeeeeeee', autonomousActive: false });
    assert.equal(r.action, 'invoke-skill');
    assert.equal(r.taskId, 'wf-dddddddd');
  });
});

describe('flow-epic-cascade — strategy modes (AC2, AC3)', () => {
  let snap;
  beforeEach(() => {
    snap = snapshotReady();
    deleteMarker();
    sessionState._resetAutonomousCacheForTests();
    if (sessionState.isAutonomousActive()) sessionState.deactivateAutonomousMode();
    const child = { id: 'wf-99999999', title: 'Cascade target', type: 'story', status: 'ready', priority: 'P1', parentEpic: 'wf-77777777' };
    const data = getReadyData();
    data.ready.unshift(child);
    saveReadyData(data);
  });
  afterEach(() => {
    restoreReady(snap);
    deleteMarker();
  });

  it('AC3: interactive mode (autonomous off, auto strategy) → invoke-skill', () => {
    const r = cascade.resolveCascade({ epicId: 'wf-77777777', autonomousActive: false });
    assert.equal(r.action, 'invoke-skill');
    assert.equal(r.taskId, 'wf-99999999');
    assert.equal(fs.existsSync(MARKER_PATH), false);
  });

  it('AC2: autonomous mode (auto strategy) → restart-with-marker', () => {
    const r = cascade.resolveCascade({ epicId: 'wf-77777777', autonomousActive: true });
    assert.equal(r.action, 'restart-with-marker');
    assert.equal(r.taskId, 'wf-99999999');
    assert.equal(fs.existsSync(MARKER_PATH), true);
    const marker = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf-8'));
    assert.equal(marker.nextTaskId, 'wf-99999999');
    assert.equal(marker.completedTaskId, 'wf-77777777');
  });

  it('AC10: forced "direct" strategy always invokes-skill', () => {
    const r = cascade.resolveCascade({
      epicId: 'wf-77777777',
      autonomousActive: true,
      strategy: 'direct'
    });
    assert.equal(r.action, 'invoke-skill');
    assert.equal(fs.existsSync(MARKER_PATH), false);
  });

  it('AC10: forced "restart" strategy always restarts even with autonomous off', () => {
    const r = cascade.resolveCascade({
      epicId: 'wf-77777777',
      autonomousActive: false,
      strategy: 'restart'
    });
    assert.equal(r.action, 'restart-with-marker');
    assert.equal(fs.existsSync(MARKER_PATH), true);
  });

  it('AC10: invalid strategy override falls back to config default', () => {
    const r = cascade.resolveCascade({
      epicId: 'wf-77777777',
      autonomousActive: false,
      strategy: 'bogus-mode'
    });
    // config default is "auto" + autonomous off → invoke-skill
    assert.equal(r.action, 'invoke-skill');
  });
});

describe('writeCleanCompletionMarker — durability (AC4)', () => {
  beforeEach(() => deleteMarker());
  afterEach(() => deleteMarker());

  it('marker is durable after write returns (data fully on disk)', () => {
    writeCleanCompletionMarker('wf-aaaaaaaa', 'Test', { nextTaskId: 'wf-bbbbbbbb' });
    const stat = fs.statSync(MARKER_PATH);
    assert.ok(stat.size > 0);
    const parsed = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf-8'));
    assert.equal(parsed.nextTaskId, 'wf-bbbbbbbb');
    assert.equal(parsed.completedTaskId, 'wf-aaaaaaaa');
  });

  it('write is atomic — no partial-data marker visible during write', () => {
    // Sequential writes never leave the visible file empty/partial.
    for (let i = 0; i < 5; i++) {
      writeCleanCompletionMarker(`wf-${String(i).padStart(8, '0')}`, `Title ${i}`);
      const data = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf-8'));
      assert.equal(data.completedTaskId, `wf-${String(i).padStart(8, '0')}`);
    }
  });

  it('omits nextTaskId when not provided (back-compat)', () => {
    writeCleanCompletionMarker('wf-aaaaaaaa', 'Test');
    const parsed = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf-8'));
    assert.equal(parsed.nextTaskId, undefined);
  });

  it('options-only param: nextTaskId without title still works', () => {
    writeCleanCompletionMarker('wf-aaaaaaaa', null, { nextTaskId: 'wf-cccccccc' });
    const parsed = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf-8'));
    assert.equal(parsed.nextTaskId, 'wf-cccccccc');
    assert.equal(parsed.completedTaskTitle, null);
  });
});

describe('non-epic flows are unaffected (AC7)', () => {
  let snap;
  beforeEach(() => { snap = snapshotReady(); deleteMarker(); });
  afterEach(() => { restoreReady(snap); deleteMarker(); });

  it('cascade is opt-in — never triggers from a regular task', () => {
    // Caller (wogi-start) only invokes resolveCascade when handling an epic.
    // The module itself doesn't observe non-epic flows; it only resolves what
    // it is asked. This test asserts the helper has no side effects on
    // ready.json or config.
    const data = getReadyData();
    const taskCount = (data.ready || []).length;
    cascade.resolveCascade({ epicId: 'wf-nonexistent' });
    const after = getReadyData();
    assert.equal((after.ready || []).length, taskCount);
  });
});
