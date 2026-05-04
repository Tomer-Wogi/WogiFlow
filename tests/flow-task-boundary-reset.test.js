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

// F1 fix: async-aware variant of withProject. The sync version above tears
// down the tmp directory in `finally` BEFORE awaited operations inside `fn`
// resolve, which on Linux tmpfs (or fast APFS flushes) causes test FS
// operations to land on a deleted directory. Use this for any test whose
// callback contains `await`.
async function withProjectAsync(fn) {
  const originalCwd = process.cwd();
  const tmp = makeProject();
  process.chdir(tmp);
  let tbr;
  try {
    tbr = loadFreshModule();
    await fn(tmp, tbr);
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

describe('task-boundary-reset — wf-ee4e343b: SEC-006 PPID alignment in real wrapper→child→hook chain', () => {
  // This test exists to prevent regressions like the silent-disable that SEC-006
  // introduced (2026-04-26). The bug: lib/wogi-claude exported WOGI_WRAPPER_PID=$$
  // (the bash wrapper's PID) but invoked claude WITHOUT exec, so claude got a
  // new PID. Hooks running under claude saw process.ppid = claude PID, which
  // never matched WOGI_WRAPPER_PID. checkPreconditions() returned
  // parent-pid-mismatch and auto-restart silently failed for every user. The
  // existing tests only verified the no-wrapper-pid early-return path; nobody
  // tested the populated-env PPID-match path in a real spawn chain.
  //
  // Fix: lib/wogi-claude run_claude() now spawns claude inside a subshell
  // ( export WOGI_WRAPPER_PID=$BASHPID; exec "$CLAUDE_BIN" ... ) so the
  // subshell's PID becomes claude's PID after exec, and WOGI_WRAPPER_PID
  // equals that value. This test simulates that chain end-to-end.
  it('checkPreconditions returns ready:true when called by a child of a process spawned via the wrapper', () => {
    const { spawnSync } = require('node:child_process');
    const wrapperPath = path.resolve(__dirname, '..', 'lib', 'wogi-claude');
    const tmp = makeProject();
    const originalCwd = process.cwd();
    process.chdir(tmp);
    try {
      // Fake claude shim: a bash script that runs node and prints the
      // checkPreconditions result as JSON. The shim itself plays the role of
      // claude — its child node process is the "hook" whose process.ppid we
      // care about.
      const shimPath = path.join(tmp, 'fake-claude.sh');
      const tbrAbs = TBR_PATH.replace(/\\/g, '/');
      fs.writeFileSync(shimPath, [
        '#!/usr/bin/env bash',
        'set -e',
        // Print env so the test can confirm the alignment trick worked.
        'echo "SHIM_PID=$$"',
        'echo "WOGI_WRAPPER_PID=$WOGI_WRAPPER_PID"',
        // Run the precondition check as a child of the shim. The node
        // process's process.ppid will equal $$ (this shim's PID).
        `node -e "const t=require('${tbrAbs}'); const r=t.checkPreconditions(); console.log('PRECHECK='+JSON.stringify(r));"`
      ].join('\n'), { mode: 0o755 });

      // Invoke the wrapper with --no-wogi-restart so it exec's once and
      // exits cleanly (the loop is not what we're testing here; we're
      // testing PID alignment of the spawn). The opt-out path uses
      // `exec "$CLAUDE_BIN"` which already preserves PID — but the SAME
      // alignment property must hold in the main-loop path. To exercise
      // that path, drop --no-wogi-restart and let one iteration run with
      // a shim that exits 0.
      // F3 hardening: explicitly unset workspace env vars so the wrapper
      // routes through the non-expect bash-c-exec path under test, even when
      // the developer's shell has WOGI_WORKSPACE_ROOT set. WOGI_NO_EXPECT=1
      // already forces this, but unsetting is defense-in-depth.
      const cleanEnv = { ...process.env };
      delete cleanEnv.WOGI_WORKSPACE_ROOT;
      delete cleanEnv.WOGI_REPO_NAME;
      delete cleanEnv.WOGI_USE_EXPECT;
      cleanEnv.WOGI_CLAUDE_BIN = shimPath;
      cleanEnv.WOGI_NO_EXPECT = '1';
      cleanEnv.WOGI_MAX_RESTARTS = '1';

      const result = spawnSync(wrapperPath, [], {
        env: cleanEnv,
        encoding: 'utf-8',
        timeout: 15000
      });

      const stdout = result.stdout || '';
      // Fail loudly if the wrapper itself errored — without this assert, a
      // missing shim or bash error would leave stdout empty and the later
      // regex-match assertions would mask the real failure.
      assert.strictEqual(
        result.status,
        0,
        `wrapper exited non-zero (status=${result.status}). stderr:\n${result.stderr || '(empty)'}`
      );
      const shimPidMatch = stdout.match(/SHIM_PID=(\d+)/);
      const wrapperPidMatch = stdout.match(/WOGI_WRAPPER_PID=(\d+)/);
      const precheckMatch = stdout.match(/PRECHECK=(\{[^\n]+\})/);

      assert.ok(shimPidMatch, `expected SHIM_PID in output, got: ${stdout}`);
      assert.ok(wrapperPidMatch, `expected WOGI_WRAPPER_PID in output, got: ${stdout}`);
      assert.ok(precheckMatch, `expected PRECHECK in output, got: ${stdout}`);

      const shimPid = parseInt(shimPidMatch[1], 10);
      const wrapperPid = parseInt(wrapperPidMatch[1], 10);
      let precheck;
      try {
        precheck = JSON.parse(precheckMatch[1]);
      } catch (err) {
        assert.fail(`failed to parse PRECHECK JSON: ${err.message}\nstdout: ${stdout}`);
      }

      // The core assertion: the wrapper aligned WOGI_WRAPPER_PID with the
      // process the hook sees as its parent. Without the subshell-exec
      // trick (the SEC-006 regression), wrapperPid would be the bash
      // wrapper's outer PID — different from shimPid.
      assert.strictEqual(
        wrapperPid,
        shimPid,
        `WOGI_WRAPPER_PID (${wrapperPid}) should equal shim PID (${shimPid}) — PID alignment trick broken`
      );

      // And checkPreconditions should be ready:true. If this fails with
      // parent-pid-mismatch, the SEC-006 regression has reappeared.
      assert.strictEqual(
        precheck.ready,
        true,
        `checkPreconditions should return ready:true, got: ${JSON.stringify(precheck)}`
      );
    } finally {
      process.chdir(originalCwd);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
      evictPathCaches();
    }
  });
});

describe('task-boundary-reset — wf-ee4e343b: skip-counter observability', () => {
  it('bumps the counter on tracked skip reasons and clears it on success', async () => {
    await withProjectAsync(async (_tmp, tbr) => {
      // Force a tracked skip reason by writing a marker but no wrapper env.
      delete process.env.WOGI_WRAPPER_PID;
      delete process.env.WOGI_RESTART_FLAG;
      tbr.markRestartPending({ taskId: 'wf-c0unter1', source: 'test' });
      await tbr.consumeAndTriggerRestart();
      let counter = tbr.readSkipCounter();
      assert.ok(counter, 'counter should exist after first skip');
      assert.strictEqual(counter.lastReason, 'no-wrapper-pid');
      assert.strictEqual(counter.count, 1);

      // Same reason again → count = 2
      tbr.markRestartPending({ taskId: 'wf-c0unter2', source: 'test' });
      await tbr.consumeAndTriggerRestart();
      counter = tbr.readSkipCounter();
      assert.strictEqual(counter.count, 2);

      // Successful clear (manual call mirrors what triggered:true does)
      tbr.clearSkipCounter();
      counter = tbr.readSkipCounter();
      assert.strictEqual(counter, null);
    });
  });

  it('does NOT bump for benign idle reasons (no-pending-marker, pending-question-deferred)', async () => {
    await withProjectAsync(async (_tmp, tbr) => {
      tbr.clearSkipCounter();
      // No marker present — should return no-pending-marker, not bump
      await tbr.consumeAndTriggerRestart();
      const counter = tbr.readSkipCounter();
      assert.strictEqual(counter, null, 'idle no-pending-marker must not bump counter');
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

