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

describe('task-boundary-reset — consumeAndTriggerRestart async + main-mode classifier safety net', () => {
  it('consumeAndTriggerRestart is async and returns a Promise', () => {
    withProject((_tmp, tbr) => {
      const ret = tbr.consumeAndTriggerRestart();
      assert.ok(ret && typeof ret.then === 'function', 'must return a thenable (Promise)');
      return ret.then((r) => {
        // No marker present → returns no-pending-marker sync-resolved.
        assert.strictEqual(r.triggered, false);
        assert.strictEqual(r.reason, 'no-pending-marker');
      });
    });
  });

  it('returns no-pending-marker when marker absent (no classifier call)', async () => {
    await new Promise((resolve) => {
      withProject(async (_tmp, tbr) => {
        const r = await tbr.consumeAndTriggerRestart({ transcriptPath: '/tmp/anything' });
        assert.strictEqual(r.triggered, false);
        assert.strictEqual(r.reason, 'no-pending-marker');
        resolve();
      });
    });
  });

  it('classifier path fails open when ANTHROPIC_API_KEY absent (no wrapper env) — restart still skipped due to no-wrapper-pid', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevPid = process.env.WOGI_WRAPPER_PID;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.WOGI_WRAPPER_PID;
    try {
      await new Promise((resolve) => {
        withProject(async (_tmp, tbr) => {
          // Write the marker so the classifier path is reachable.
          tbr.markRestartPending({ taskId: 'wf-test0001', source: 'test' });
          const r = await tbr.consumeAndTriggerRestart({ transcriptPath: '/tmp/nosuch' });
          // Classifier short-circuits on no-credentials; wrapper preconditions then fail.
          // Either reason is acceptable; the key assertion is no throw and triggered:false.
          assert.strictEqual(r.triggered, false);
          assert.ok(
            ['no-wrapper-pid', 'no-flag-path', 'auto-deferred-question-detected'].includes(r.reason) ||
              r.reason.startsWith('config-error') || r.reason === 'disabled-by-config',
            `unexpected reason: ${r.reason}`
          );
          resolve();
        });
      });
    } finally {
      if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevPid) process.env.WOGI_WRAPPER_PID = prevPid;
    }
  });
});

