'use strict';

/**
 * Unit tests for task-boundary-reset state machine.
 *
 * Covers:
 *   - markRestartPending (Phase 1 primary write)
 *   - hasPendingMarker (diagnostic)
 *   - ensurePhase1MarkedIfRecentlyCompleted (Phase 1 Stop-hook fallback,
 *     added in v2.26.1 to catch the case where flow-done didn't run)
 *
 * Each test runs in an isolated temp project so we don't clobber the
 * running repo's .workflow/state.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TBR_PATH = path.resolve(__dirname, '..', 'scripts', 'hooks', 'core', 'task-boundary-reset.js');
const FLOW_UTILS_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-utils.js');
const FLOW_PATHS_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-paths.js');
const FLOW_CONFIG_LOADER_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-config-loader.js');
const FLOW_IO_PATH = path.resolve(__dirname, '..', 'scripts', 'flow-io.js');

// Evict all modules that cache PATHS / STATE_DIR derived from cwd. Without
// this, the first test's temp-dir paths get reused by subsequent tests and
// lookups fail.
function evictPathCaches() {
  [FLOW_PATHS_PATH, FLOW_CONFIG_LOADER_PATH, FLOW_IO_PATH, FLOW_UTILS_PATH, TBR_PATH].forEach((p) => {
    try { delete require.cache[require.resolve(p)]; } catch (_err) { /* ignore */ }
  });
}

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tbr-test-'));
  fs.mkdirSync(path.join(tmp, '.workflow', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.workflow', 'config.json'),
    JSON.stringify({ taskBoundaryReset: { enabled: true } })
  );
  return tmp;
}

function loadFreshModule() {
  evictPathCaches();
  return require(TBR_PATH);
}

function withProject(fn) {
  const originalCwd = process.cwd();
  const tmp = makeProject();
  process.chdir(tmp);
  try {
    const tbr = loadFreshModule();
    fn(tmp, tbr);
  } finally {
    process.chdir(originalCwd);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    evictPathCaches();
  }
}

function writeReady(tmp, recentlyCompleted) {
  fs.writeFileSync(
    path.join(tmp, '.workflow', 'state', 'ready.json'),
    JSON.stringify({
      ready: [], inProgress: [], blocked: [],
      recentlyCompleted
    })
  );
}

describe('task-boundary-reset — Phase 1 primary write', () => {
  it('markRestartPending writes the marker file', () => {
    withProject((tmp, tbr) => {
      const result = tbr.markRestartPending({ taskId: 'wf-abc12345', source: 'test' });
      assert.strictEqual(result.marked, true);
      assert.ok(tbr.hasPendingMarker(), 'marker must exist after markRestartPending');
    });
  });

  it('hasPendingMarker returns false when no marker exists', () => {
    withProject((tmp, tbr) => {
      assert.strictEqual(tbr.hasPendingMarker(), false);
    });
  });
});

describe('task-boundary-reset — Stop-hook fallback (ensurePhase1MarkedIfRecentlyCompleted)', () => {
  it('marks when a fresh completion exists and no marker is present', () => {
    withProject((tmp, tbr) => {
      writeReady(tmp, [
        { id: 'wf-fresh001', title: 'fresh task', status: 'completed', completedAt: new Date().toISOString() }
      ]);
      const result = tbr.ensurePhase1MarkedIfRecentlyCompleted();
      assert.strictEqual(result.marked, true);
      assert.strictEqual(result.taskId, 'wf-fresh001');
      assert.ok(tbr.hasPendingMarker());
    });
  });

  it('skips when a pending marker already exists (Phase 1 primary path fired)', () => {
    withProject((tmp, tbr) => {
      // Primary path wrote the marker first
      tbr.markRestartPending({ taskId: 'wf-primary1', source: 'flow-done' });
      // Fresh completion also visible
      writeReady(tmp, [
        { id: 'wf-primary1', title: 'primary task', status: 'completed', completedAt: new Date().toISOString() }
      ]);
      const result = tbr.ensurePhase1MarkedIfRecentlyCompleted();
      assert.strictEqual(result.marked, false);
      assert.strictEqual(result.reason, 'marker-already-present');
    });
  });

  it('skips same-task anti-replay across SIGTERM + wrapper restart cycle', () => {
    withProject((tmp, tbr) => {
      // Simulate: Phase 2 just ran, wrote anti-replay sentinel, SIGTERM fired,
      // wrapper restarted, new session sees same recentlyCompleted[0] still fresh
      fs.writeFileSync(
        path.join(tmp, '.workflow', 'state', 'task-boundary-last-triggered'),
        JSON.stringify({ taskId: 'wf-restart1', at: new Date().toISOString() })
      );
      writeReady(tmp, [
        { id: 'wf-restart1', title: 'already-restarted task', status: 'completed', completedAt: new Date().toISOString() }
      ]);
      const result = tbr.ensurePhase1MarkedIfRecentlyCompleted();
      assert.strictEqual(result.marked, false);
      assert.strictEqual(result.reason, 'already-triggered-for-this-task');
      assert.strictEqual(tbr.hasPendingMarker(), false);
    });
  });

  it('marks a new completion even when sentinel recorded a different prior task', () => {
    withProject((tmp, tbr) => {
      // Prior restart was for task A
      fs.writeFileSync(
        path.join(tmp, '.workflow', 'state', 'task-boundary-last-triggered'),
        JSON.stringify({ taskId: 'wf-taskA001', at: new Date(Date.now() - 2 * 60 * 1000).toISOString() })
      );
      // New session, task B just completed (different id)
      writeReady(tmp, [
        { id: 'wf-taskB001', title: 'new task B', status: 'completed', completedAt: new Date().toISOString() }
      ]);
      const result = tbr.ensurePhase1MarkedIfRecentlyCompleted();
      assert.strictEqual(result.marked, true);
      assert.strictEqual(result.taskId, 'wf-taskB001');
    });
  });

  it('skips stale completions outside the 5-minute freshness window', () => {
    withProject((tmp, tbr) => {
      const staleIso = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      writeReady(tmp, [
        { id: 'wf-stale001', title: 'stale task', status: 'completed', completedAt: staleIso }
      ]);
      const result = tbr.ensurePhase1MarkedIfRecentlyCompleted();
      assert.strictEqual(result.marked, false);
      assert.strictEqual(result.reason, 'stale-completion');
    });
  });

  it('skips when recentlyCompleted is empty', () => {
    withProject((tmp, tbr) => {
      writeReady(tmp, []);
      const result = tbr.ensurePhase1MarkedIfRecentlyCompleted();
      assert.strictEqual(result.marked, false);
      assert.strictEqual(result.reason, 'no-fresh-completion');
    });
  });

  it('skips when recentlyCompleted[0] has no completedAt (legacy entry)', () => {
    withProject((tmp, tbr) => {
      writeReady(tmp, [
        { id: 'wf-legacy01', title: 'legacy entry without completedAt', status: 'completed' }
      ]);
      const result = tbr.ensurePhase1MarkedIfRecentlyCompleted();
      assert.strictEqual(result.marked, false);
      assert.strictEqual(result.reason, 'no-fresh-completion');
    });
  });
});
