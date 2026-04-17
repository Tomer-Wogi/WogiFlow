'use strict';

/**
 * Tests for the wogi-claude bash wrapper (2.22.3+).
 *
 * Exercises the expect-wrapper decision logic via a fake CLAUDE_BIN that
 * records its invocation environment, plus env-var opt-outs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const WRAPPER = path.join(__dirname, '..', 'lib', 'wogi-claude');
const EXPECT_SCRIPT = path.join(__dirname, '..', 'lib', 'wogi-claude-expect.exp');

function makeFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-claude-test-'));
  const fake = path.join(dir, 'claude');
  // Fake claude: record argv + env, exit 0
  const script = `#!/bin/bash
# Fake claude — records invocation then exits quickly
echo "ARGV: $@" > "$WOGI_TEST_LOG"
echo "WOGI_WRAPPER_PID=$WOGI_WRAPPER_PID" >> "$WOGI_TEST_LOG"
echo "WOGI_RESTART_FLAG=$WOGI_RESTART_FLAG" >> "$WOGI_TEST_LOG"
exit 0
`;
  fs.writeFileSync(fake, script, { mode: 0o755 });
  return { dir, fake };
}

function runWrapper(args, env = {}) {
  const { dir, fake } = makeFakeClaude();
  const log = path.join(dir, 'invocation.log');
  const pwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-claude-cwd-'));
  fs.mkdirSync(path.join(pwd, '.workflow', 'state'), { recursive: true });
  try {
    const result = execSync(`bash ${WRAPPER} ${args}`, {
      cwd: pwd,
      env: {
        PATH: process.env.PATH,
        WOGI_CLAUDE_BIN: fake,
        WOGI_TEST_LOG: log,
        ...env
      },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000
    });
    const logContent = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8') : '';
    return { stdout: result, log: logContent, cwd: pwd };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    try { fs.rmSync(pwd, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
  }
}

describe('wogi-claude wrapper', () => {
  it('wrapper file exists and is executable', () => {
    const stat = fs.statSync(WRAPPER);
    assert.ok(stat.isFile());
    // mode 0o100 is the owner execute bit
    assert.ok((stat.mode & 0o100) !== 0, 'wrapper must be executable by owner');
  });

  it('expect script exists and is executable', () => {
    const stat = fs.statSync(EXPECT_SCRIPT);
    assert.ok(stat.isFile());
    assert.ok((stat.mode & 0o100) !== 0);
  });

  it('bash syntax is valid', () => {
    execSync(`bash -n ${WRAPPER}`, { stdio: 'pipe' });
  });

  it('opt-out path (--no-wogi-restart) strips the flag and execs claude', () => {
    // --no-wogi-restart is a wrapper flag: it's stripped from argv before
    // claude is exec'd, and the restart loop is not entered. The wrapper
    // env vars are also not set under opt-out (by design).
    const { log } = runWrapper('--no-wogi-restart some-other-flag');
    assert.match(log, /ARGV: some-other-flag/);
    assert.ok(!/--no-wogi-restart/.test(log), 'wrapper flag must be stripped');
  });

  it('restart loop exports WOGI_WRAPPER_PID/WOGI_RESTART_FLAG', () => {
    // Without --no-wogi-restart, the loop runs and sets wrapper env vars.
    // Our fake claude exits immediately so the loop ends after one iteration
    // (no restart flag written).
    const { log } = runWrapper('');
    assert.match(log, /WOGI_WRAPPER_PID=\d+/);
    assert.match(log, /WOGI_RESTART_FLAG=/);
  });

  it('does NOT use expect when --dangerously-load-development-channels is absent', () => {
    // Without the channels flag, the wrapper should not route through expect.
    // Our fake claude logs its argv; we verify it ran directly.
    const { log } = runWrapper('some-other-flag');
    assert.match(log, /ARGV: some-other-flag/);
    assert.ok(!log.includes('wogi-claude-expect.exp'), 'expect should not be in the invocation trace');
  });

  it('does NOT route through expect by default (v2.22.4: opt-in only)', () => {
    // Even with --dangerously-load-development-channels present, expect is
    // NOT invoked unless WOGI_USE_EXPECT=1 is explicitly set. This is the
    // 2.22.4 behavior change: default-opt-in burned us when Ink's ANSI
    // output deadlocked the text match.
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x'
    );
    assert.match(log, /ARGV:.*--dangerously-load-development-channels server:x/);
    assert.ok(!log.includes('wogi-claude-expect.exp'), 'expect must NOT be invoked by default');
  });

  it('WOGI_NO_EXPECT=1 disables the expect wrapper (legacy escape hatch)', () => {
    // Backwards-compat: the old opt-out env var still works.
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      { WOGI_NO_EXPECT: '1', WOGI_USE_EXPECT: '1' }
    );
    // WOGI_NO_EXPECT takes precedence over WOGI_USE_EXPECT
    assert.match(log, /ARGV:.*--dangerously-load-development-channels server:x/);
  });
});

describe('wogi-claude-expect.exp', () => {
  it('errors cleanly when no claude binary path is supplied', () => {
    try {
      execSync(`expect ${EXPECT_SCRIPT}`, { stdio: 'pipe', timeout: 3000 });
      assert.fail('expected non-zero exit');
    } catch (err) {
      // expected — script errors with status 2
      assert.ok(err.status === 2 || /missing claude binary/.test(err.stderr?.toString() || ''));
    }
  });
});
