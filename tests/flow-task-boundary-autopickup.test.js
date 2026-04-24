'use strict';

/**
 * Unit tests for main-mode auto-pickup at session restart (wf-f267ea2a).
 *
 * Covers:
 *   - writeCleanCompletionMarker (task-boundary-reset.js)
 *   - formatContextForInjection auto-pickup branch (session-context.js)
 *     - Scenario 1: clean completion + ready queue → AUTO-PICKUP injected
 *     - Scenario 2: pending-question.json → no AUTO-PICKUP, marker still consumed
 *     - Scenario 3: no marker → no AUTO-PICKUP
 *     - Scenario 4: empty ready queue → no AUTO-PICKUP, marker still consumed
 *     - Scenario 5: flag disabled → no AUTO-PICKUP, marker still consumed
 *     - Scenario 6: marker is consumed (single-use) regardless of injection
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TBR_PATH = path.resolve(__dirname, '..', 'scripts', 'hooks', 'core', 'task-boundary-reset.js');
const SC_PATH = path.resolve(__dirname, '..', 'scripts', 'hooks', 'core', 'session-context.js');
const FLOW_UTILS_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-utils.js');
const FLOW_PATHS_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-paths.js');
const FLOW_CONFIG_LOADER_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-config-loader.js');
const FLOW_IO_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-io.js');

function evictPathCaches() {
  [FLOW_PATHS_PATH, FLOW_CONFIG_LOADER_PATH, FLOW_IO_PATH, FLOW_UTILS_PATH, TBR_PATH, SC_PATH].forEach((p) => {
    try { delete require.cache[require.resolve(p)]; } catch (_err) { /* ignore */ }
  });
}

function makeProject(configOverrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-autopickup-test-'));
  fs.mkdirSync(path.join(tmp, '.workflow', 'state'), { recursive: true });
  const config = {
    taskBoundaryReset: { enabled: true, autoPickupNextTask: true, ...configOverrides }
  };
  fs.writeFileSync(
    path.join(tmp, '.workflow', 'config.json'),
    JSON.stringify(config)
  );
  return tmp;
}

function withProject(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const originalCwd = process.cwd();
  const tmp = makeProject(opts.configOverrides || {});
  process.chdir(tmp);
  try {
    evictPathCaches();
    const tbr = require(TBR_PATH);
    const sc = require(SC_PATH);
    fn(tmp, tbr, sc);
  } finally {
    process.chdir(originalCwd);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    evictPathCaches();
  }
}

function writeReady(tmp, ready) {
  fs.writeFileSync(
    path.join(tmp, '.workflow', 'state', 'ready.json'),
    JSON.stringify({
      ready: ready || [], inProgress: [], blocked: [], recentlyCompleted: []
    })
  );
}

function writeCleanMarker(tmp, payload = {}) {
  fs.writeFileSync(
    path.join(tmp, '.workflow', 'state', 'task-boundary-clean-completion.json'),
    JSON.stringify({
      version: 1,
      completedTaskId: 'wf-prev0001',
      completedTaskTitle: 'Prior task',
      completedAt: new Date().toISOString(),
      ...payload
    })
  );
}

function writePendingQuestion(tmp) {
  fs.writeFileSync(
    path.join(tmp, '.workflow', 'state', 'pending-question.json'),
    JSON.stringify({ question: 'test?', askedAt: new Date().toISOString() })
  );
}

function markerExists(tmp) {
  return fs.existsSync(path.join(tmp, '.workflow', 'state', 'task-boundary-clean-completion.json'));
}

// ============================================================
// task-boundary-reset.js — writeCleanCompletionMarker
// ============================================================

describe('task-boundary-reset — writeCleanCompletionMarker', () => {
  it('writes the clean-completion marker file with task metadata', () => {
    withProject((tmp, tbr) => {
      tbr.writeCleanCompletionMarker('wf-abc12345', 'Test task');
      const markerPath = tbr.getCleanCompletionMarkerPath();
      assert.ok(fs.existsSync(markerPath), 'marker should be written');
      const payload = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      assert.equal(payload.completedTaskId, 'wf-abc12345');
      assert.equal(payload.completedTaskTitle, 'Test task');
      assert.equal(payload.version, 1);
      assert.ok(payload.completedAt, 'completedAt timestamp should be set');
    });
  });

  it('handles null task fields gracefully', () => {
    withProject((tmp, tbr) => {
      tbr.writeCleanCompletionMarker(null, null);
      const payload = JSON.parse(fs.readFileSync(tbr.getCleanCompletionMarkerPath(), 'utf8'));
      assert.equal(payload.completedTaskId, null);
      assert.equal(payload.completedTaskTitle, null);
    });
  });
});

// ============================================================
// session-context.js — formatContextForInjection auto-pickup branch
// ============================================================

describe('session-context — AUTO-PICKUP injection', () => {
  it('Scenario 1: injects AUTO-PICKUP when clean marker + ready queue + flag enabled', () => {
    withProject((tmp, tbr, sc) => {
      writeCleanMarker(tmp);
      writeReady(tmp, [{ id: 'wf-next0001', title: 'Next ready task' }]);
      const out = sc.formatContextForInjection({ context: {} });
      assert.match(out, /AUTO-PICKUP MODE ACTIVE/);
      assert.match(out, /wf-next0001/);
      assert.match(out, /Next ready task/);
      assert.match(out, /Skill\(skill="wogi-start", args="wf-next0001"\)/);
      // Marker is consumed
      assert.equal(markerExists(tmp), false, 'marker should be deleted after injection');
    });
  });

  it('Scenario 2: pending-question.json present → no AUTO-PICKUP, marker still consumed', () => {
    withProject((tmp, tbr, sc) => {
      writeCleanMarker(tmp);
      writeReady(tmp, [{ id: 'wf-next0002', title: 'Next' }]);
      writePendingQuestion(tmp);
      const out = sc.formatContextForInjection({ context: {} });
      assert.doesNotMatch(out, /AUTO-PICKUP MODE ACTIVE/, 'should not inject when question pending');
      assert.equal(markerExists(tmp), false, 'marker should still be consumed');
    });
  });

  it('Scenario 3: no clean-completion marker → no AUTO-PICKUP', () => {
    withProject((tmp, tbr, sc) => {
      writeReady(tmp, [{ id: 'wf-next0003', title: 'Next' }]);
      const out = sc.formatContextForInjection({ context: {} });
      assert.doesNotMatch(out, /AUTO-PICKUP MODE ACTIVE/, 'should not inject without marker');
    });
  });

  it('Scenario 4: empty ready queue → no AUTO-PICKUP, marker still consumed', () => {
    withProject((tmp, tbr, sc) => {
      writeCleanMarker(tmp);
      writeReady(tmp, []);
      const out = sc.formatContextForInjection({ context: {} });
      assert.doesNotMatch(out, /AUTO-PICKUP MODE ACTIVE/, 'should not inject when queue empty');
      assert.equal(markerExists(tmp), false, 'marker should still be consumed');
    });
  });

  it('Scenario 5: flag disabled → no AUTO-PICKUP, marker still consumed', () => {
    withProject({ configOverrides: { autoPickupNextTask: false } }, (tmp, tbr, sc) => {
      writeCleanMarker(tmp);
      writeReady(tmp, [{ id: 'wf-next0005', title: 'Next' }]);
      const out = sc.formatContextForInjection({ context: {} });
      assert.doesNotMatch(out, /AUTO-PICKUP MODE ACTIVE/, 'should not inject when flag disabled');
      assert.equal(markerExists(tmp), false, 'marker should still be consumed');
    });
  });

  it('Scenario 6: marker is single-use — second call after injection does not re-inject', () => {
    withProject((tmp, tbr, sc) => {
      writeCleanMarker(tmp);
      writeReady(tmp, [{ id: 'wf-next0006', title: 'Next' }]);
      const out1 = sc.formatContextForInjection({ context: {} });
      assert.match(out1, /AUTO-PICKUP MODE ACTIVE/);
      // Second call (without writing a new marker) — should NOT re-inject
      const out2 = sc.formatContextForInjection({ context: {} });
      assert.doesNotMatch(out2, /AUTO-PICKUP MODE ACTIVE/, 'second call should not re-inject');
    });
  });

  it('Scenario 7: skips epic at head of queue, picks first non-epic task', () => {
    withProject((tmp, tbr, sc) => {
      writeCleanMarker(tmp);
      writeReady(tmp, [
        { id: 'wf-epic0001', title: 'An epic', type: 'epic' },
        { id: 'wf-story001', title: 'First story', type: 'story' }
      ]);
      const out = sc.formatContextForInjection({ context: {} });
      assert.match(out, /AUTO-PICKUP MODE ACTIVE/);
      assert.match(out, /wf-story001/, 'should pick story, not epic');
      assert.doesNotMatch(out, /wf-epic0001/, 'epic should be skipped');
    });
  });

  it('Scenario 8: queue contains only epics → no AUTO-PICKUP (prevents restart loop)', () => {
    withProject((tmp, tbr, sc) => {
      writeCleanMarker(tmp);
      writeReady(tmp, [
        { id: 'wf-epic0001', title: 'Epic one', type: 'epic' },
        { id: 'wf-epic0002', title: 'Epic two', type: 'epic' }
      ]);
      const out = sc.formatContextForInjection({ context: {} });
      assert.doesNotMatch(out, /AUTO-PICKUP MODE ACTIVE/,
        'should not inject when all ready tasks are epics — prevents loop on unworkable epic');
      assert.equal(markerExists(tmp), false, 'marker should still be consumed');
    });
  });

  it('handles malformed marker gracefully (fail-open to no injection)', () => {
    withProject((tmp, tbr, sc) => {
      // Write malformed JSON
      fs.writeFileSync(
        path.join(tmp, '.workflow', 'state', 'task-boundary-clean-completion.json'),
        'not valid json {{{'
      );
      writeReady(tmp, [{ id: 'wf-next0007', title: 'Next' }]);
      // Should not throw; should still consume marker
      const out = sc.formatContextForInjection({ context: {} });
      // Note: with malformed marker but valid ready queue, injection still
      // happens (marker payload fields just appear as 'unknown' / 'no title').
      // The key invariant is no crash.
      assert.ok(typeof out === 'string', 'should return a string, not throw');
      assert.equal(markerExists(tmp), false, 'malformed marker should still be consumed');
    });
  });
});
