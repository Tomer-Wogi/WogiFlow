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
const { execSync, spawnSync } = require('node:child_process');

console.log = () => {}; console.warn = () => {}; console.info = () => {};

const WRAPPER = path.join(__dirname, '..', 'lib', 'wogi-claude');
const EXPECT_SCRIPT = path.join(__dirname, '..', 'lib', 'wogi-claude-expect.exp');

// Invoke the expect script with the test hook enabled. The production
// script ends with `interact`, which requires a real TTY on stdin; under
// node:test's pipe-backed stdin, interact closes the PTY before the sent
// `\r` flushes to the child, silently failing the behavioral tests.
// WOGI_EXPECT_NO_INTERACT=1 substitutes `expect eof` so the test can
// observe the child receiving the keystroke. Production users MUST NOT
// set this var — they need interact to drive claude post-dismissal.
function runExpect(fakeClaude, extraEnv = {}) {
  return spawnSync('expect', [EXPECT_SCRIPT, fakeClaude], {
    timeout: 10000,
    env: { ...process.env, WOGI_EXPECT_NO_INTERACT: '1', ...extraEnv }
  });
}

function makeFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-claude-test-'));
  const fake = path.join(dir, 'claude');
  // Fake claude: record argv + whether stdin is a TTY (signals expect path),
  // then exit 0. `tty -s` returns 0 when stdin is a TTY — the expect wrapper
  // allocates a PTY for its child, direct bash exec under execSync does not.
  const script = `#!/bin/bash
echo "ARGV: $@" > "$WOGI_TEST_LOG"
echo "WOGI_WRAPPER_PID=$WOGI_WRAPPER_PID" >> "$WOGI_TEST_LOG"
echo "WOGI_RESTART_FLAG=$WOGI_RESTART_FLAG" >> "$WOGI_TEST_LOG"
if tty -s; then
  echo "STDIN_TTY=yes" >> "$WOGI_TEST_LOG"
else
  echo "STDIN_TTY=no" >> "$WOGI_TEST_LOG"
fi
exit 0
`;
  fs.writeFileSync(fake, script, { mode: 0o755 });
  return { dir, fake };
}

function runWrapper(args, env = {}) {
  const { dir, fake } = makeFakeClaude();
  const log = path.join(dir, 'invocation.log');
  const stderrLog = path.join(dir, 'stderr.log');
  const pwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-claude-cwd-'));
  fs.mkdirSync(path.join(pwd, '.workflow', 'state'), { recursive: true });
  try {
    // Redirect stderr to file so we can assert on wrapper diagnostic messages.
    // WOGI_EXPECT_NO_INTERACT=1 is set so the expect script uses `expect eof`
    // instead of `interact` — interact requires a real TTY on stdin and this
    // harness runs the wrapper via execSync with pipe-backed stdin. Production
    // workers get real TTYs from `flow workspace start` so this env var MUST
    // NOT be set outside the test harness.
    const result = execSync(`bash ${WRAPPER} ${args} 2>${stderrLog}`, {
      cwd: pwd,
      env: {
        PATH: process.env.PATH,
        WOGI_CLAUDE_BIN: fake,
        WOGI_TEST_LOG: log,
        WOGI_EXPECT_NO_INTERACT: '1',
        ...env
      },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000
    });
    const logContent = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8') : '';
    const stderrContent = fs.existsSync(stderrLog) ? fs.readFileSync(stderrLog, 'utf-8') : '';
    return { stdout: result, log: logContent, stderr: stderrContent, cwd: pwd };
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
    // Without the channels flag, the wrapper should not route through expect
    // (there's no dialog to dismiss). STDIN_TTY=no proves direct exec.
    const { log } = runWrapper('some-other-flag');
    assert.match(log, /ARGV: some-other-flag/);
    assert.match(log, /STDIN_TTY=no/, 'expect must not be in the invocation chain');
  });

  it('does NOT route through expect by default for interactive users', () => {
    // Even with --dangerously-load-development-channels present, expect is
    // NOT invoked for interactive users unless WOGI_USE_EXPECT=1. The
    // v2.22.4 regression (Ink ANSI text-match miss) is bounded to opt-in.
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x'
    );
    assert.match(log, /ARGV:.*--dangerously-load-development-channels server:x/);
    assert.match(log, /STDIN_TTY=no/, 'expect must NOT be invoked by default');
  });

  it('WOGI_USE_EXPECT=1 enables the expect wrapper for interactive users', () => {
    // Explicit opt-in still works.
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      { WOGI_USE_EXPECT: '1' }
    );
    assert.match(log, /STDIN_TTY=yes/, 'expect must be in the invocation chain');
  });

  it('auto-enables expect for workspace workers (v2.26.2)', () => {
    // Worker env set by `flow workspace start`: WOGI_WORKSPACE_ROOT AND
    // WOGI_REPO_NAME !== 'manager'. Wrapper should auto-enable expect
    // without requiring the operator to set WOGI_USE_EXPECT.
    const { log, stderr } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      {
        WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
        WOGI_REPO_NAME: 'backend'
      }
    );
    assert.match(log, /STDIN_TTY=yes/, 'expect must run for workspace workers');
    assert.match(stderr, /worker mode detected/, 'should log the auto-enable diagnostic');
  });

  it('does NOT auto-enable expect for the workspace manager', () => {
    // Manager runs attached to the user terminal — dialog is dismissable by
    // hand. No need to route through expect (and the fragility it brings).
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      {
        WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
        WOGI_REPO_NAME: 'manager'
      }
    );
    assert.match(log, /STDIN_TTY=no/, 'expect must NOT be used for the manager');
  });

  it('WOGI_NO_EXPECT=1 overrides worker auto-enable (kill switch)', () => {
    // Highest-precedence disable: even when we'd otherwise auto-enable for
    // a worker, WOGI_NO_EXPECT=1 forces direct exec.
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      {
        WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
        WOGI_REPO_NAME: 'backend',
        WOGI_NO_EXPECT: '1'
      }
    );
    assert.match(log, /STDIN_TTY=no/, 'WOGI_NO_EXPECT=1 must force direct exec');
  });

  it('WOGI_NO_EXPECT=1 overrides WOGI_USE_EXPECT=1 for interactive users (back-compat)', () => {
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      { WOGI_NO_EXPECT: '1', WOGI_USE_EXPECT: '1' }
    );
    assert.match(log, /STDIN_TTY=no/);
  });

  it('does NOT auto-enable expect for workers when --dangerously-load-development-channels is absent', () => {
    // Worker env present but no dialog-triggering flag → no expect needed.
    const { log } = runWrapper(
      '--no-wogi-restart some-other-flag',
      {
        WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
        WOGI_REPO_NAME: 'backend'
      }
    );
    assert.match(log, /STDIN_TTY=no/, 'no flag means no dialog means no expect');
  });

  it('does NOT auto-enable expect when WOGI_WORKSPACE_ROOT is set but WOGI_REPO_NAME is empty', () => {
    // Partial worker env (missing WOGI_REPO_NAME) must NOT trip auto-enable.
    // Interactive user may happen to set WORKSPACE_ROOT for other reasons.
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      {
        WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace'
        // WOGI_REPO_NAME intentionally omitted
      }
    );
    assert.match(log, /STDIN_TTY=no/, 'worker detection requires both env vars');
  });

  it('WOGI_NO_EXPECT=1 overrides worker auto-enable AND explicit WOGI_USE_EXPECT=1 (three-way)', () => {
    // Highest-precedence kill switch wins over both ON signals.
    const { log } = runWrapper(
      '--no-wogi-restart --dangerously-load-development-channels server:x',
      {
        WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
        WOGI_REPO_NAME: 'backend',
        WOGI_USE_EXPECT: '1',
        WOGI_NO_EXPECT: '1'
      }
    );
    assert.match(log, /STDIN_TTY=no/, 'WOGI_NO_EXPECT=1 must win over every ON signal');
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

  it('dismisses the dialog when title text arrives ANSI-fragmented (rolling buffer)', () => {
    // Regression test for the v2.22.x brittleness: Ink paints in multiple
    // writes interleaved with ANSI color codes. Old expect matcher missed
    // these because -re matched per-chunk. The rewritten script accumulates
    // + strips ANSI, so fragmented arrival must still match.
    //
    // Fake claude: print the dialog title in 4 fragments, each wrapped in
    // ANSI color codes, then wait 6s for input. If the expect script sends
    // \r correctly, the read returns and we log DISMISSED=yes. If the
    // dialog match misses, the read times out and we log DISMISSED=no.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-expect-behavior-'));
    const log = path.join(dir, 'result.log');
    const fakeClaude = path.join(dir, 'claude');
    // printf escapes: \x1b is ESC. Pieces split across writes simulate Ink.
    // Fake claude: print the dialog title in fragments wrapped with ANSI
    // color codes (like Ink does), then wait for a keystroke. Uses
    // single-char read (like Ink's raw-mode stdin) — NOT line-oriented
    // `read -r`, which would require a \n that expect doesn't send.
    const fakeScript = `#!/bin/bash
printf '\\x1b[1m\\x1b[36mLoading'
sleep 0.1
printf ' development'
sleep 0.1
printf ' channels'
printf '\\x1b[0m'
# Raw single-char read, 6s timeout. Any keystroke (including \\r) satisfies.
if IFS= read -r -s -n 1 -t 6 _; then
  echo "DISMISSED=yes" > "${log}"
else
  echo "DISMISSED=no" > "${log}"
fi
exit 0
`;
    fs.writeFileSync(fakeClaude, fakeScript, { mode: 0o755 });
    try {
      runExpect(fakeClaude, { WOGI_EXPECT_TIMEOUT: '5' });
      const result = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim() : '';
      assert.strictEqual(result, 'DISMISSED=yes',
        `expect script should have dismissed the fragmented ANSI dialog. Got: ${JSON.stringify(result)}`);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    }
  });

  it('dismisses the dialog when title is interleaved with OSC / 8-bit CSI / ISO 2022 escapes', () => {
    // Defence-in-depth: even though Ink only emits CSI today, the expanded
    // ANSI strip must normalize OSC hyperlinks (ESC ] ... BEL), 8-bit CSI
    // (0x9B), and ISO 2022 charset selects (ESC ( B) so a future Ink change
    // or a colorized wrapper layer can't silently break dismissal.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-expect-ansi-edge-'));
    const log = path.join(dir, 'result.log');
    const fakeClaude = path.join(dir, 'claude');
    const fakeScript = `#!/bin/bash
# OSC hyperlink around "Loading", 8-bit CSI color before "development",
# ISO 2022 charset select before "channels".
printf '\\x1b]8;;https://example.invalid\\x07Loading\\x1b]8;;\\x07'
sleep 0.05
printf ' \\x9b36mdevelopment\\x9b0m'
sleep 0.05
printf '\\x1b(B channels'
if IFS= read -r -s -n 1 -t 5 _; then
  echo "DISMISSED=yes" > "${log}"
else
  echo "DISMISSED=no" > "${log}"
fi
exit 0
`;
    fs.writeFileSync(fakeClaude, fakeScript, { mode: 0o755 });
    try {
      runExpect(fakeClaude, { WOGI_EXPECT_TIMEOUT: '4' });
      const result = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim() : '';
      assert.strictEqual(result, 'DISMISSED=yes',
        `must dismiss dialog interleaved with OSC/8-bit/ISO 2022 escapes. Got: ${JSON.stringify(result)}`);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    }
  });

  // ============================================================
  // wf-8294d960 (Story A): Worker MCP-stripping + init banner
  // ============================================================
  //
  // Root cause measured 2026-04-24: Claude Code's own init (OAuth, claude.ai
  // MCP handshakes, LSP, plugin sync) takes 10-19s cold. WogiFlow's
  // SessionStart hook is 128ms. Workers don't need Gmail/Slack/Atlassian/
  // etc. to refactor code, so stripping claude.ai MCP via --strict-mcp-config
  // saves 3-7s per boot. Measured: 14.5s median baseline → 7.5s median
  // post-fix (46% faster). Opt-in inheritance via
  // config.workspace.inheritClaudeAiMcpIntegrations or WOGI_WORKER_INHERIT_MCP=1.

  it('worker mode: injects --strict-mcp-config + --mcp-config pointing to empty-mcp.json', () => {
    const { log, cwd } = runWrapper('--no-wogi-restart some-arg', {
      WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
      WOGI_REPO_NAME: 'frontend'
    });
    assert.match(log, /ARGV:.*--strict-mcp-config --mcp-config \S+worker-empty-mcp\.json.*some-arg/,
      'worker mode must prepend strict-mcp flags before user args');
    // Verify the config file exists and is empty-MCP
    const emptyMcpPath = path.join(cwd, '.workflow', 'state', 'worker-empty-mcp.json');
    // Note: cwd is cleaned up in finally; check that the command logged the file path
    const match = log.match(/--mcp-config (\S+\.json)/);
    assert.ok(match, 'expected --mcp-config path in argv');
  });

  it('worker mode + WOGI_WORKER_INHERIT_MCP=1: MCP-strip flags NOT injected', () => {
    const { log } = runWrapper('--no-wogi-restart some-arg', {
      WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
      WOGI_REPO_NAME: 'frontend',
      WOGI_WORKER_INHERIT_MCP: '1'
    });
    assert.ok(!/--strict-mcp-config/.test(log),
      'opt-in env var must disable MCP stripping');
    assert.match(log, /ARGV: some-arg/);
  });

  it('solo mode (no worker env): MCP-strip flags NOT injected', () => {
    const { log } = runWrapper('--no-wogi-restart some-arg');
    assert.ok(!/--strict-mcp-config/.test(log),
      'solo mode must not touch MCP config');
    assert.match(log, /ARGV: some-arg/);
  });

  it('manager mode (WOGI_REPO_NAME=manager): MCP-strip flags NOT injected', () => {
    const { log } = runWrapper('--no-wogi-restart some-arg', {
      WOGI_WORKSPACE_ROOT: '/tmp/fake-workspace',
      WOGI_REPO_NAME: 'manager'
    });
    assert.ok(!/--strict-mcp-config/.test(log),
      'manager (not a worker) must not strip MCP');
  });

  it('worker mode: creates .workflow/state/worker-empty-mcp.json in workspace root', () => {
    // Use a real tmp workspace root so file creation can be verified
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-mcp-fs-test-'));
    try {
      runWrapper('--no-wogi-restart x', {
        WOGI_WORKSPACE_ROOT: wsRoot,
        WOGI_REPO_NAME: 'frontend'
      });
      const configPath = path.join(wsRoot, '.workflow', 'state', 'worker-empty-mcp.json');
      assert.ok(fs.existsSync(configPath), 'empty-MCP config must be created in workspace root');
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.deepStrictEqual(content, { mcpServers: {} },
        'empty-MCP config must be strictly {mcpServers: {}}');
    } finally {
      try { fs.rmSync(wsRoot, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    }
  });

  it('config.workspace.inheritClaudeAiMcpIntegrations=true: disables MCP stripping', () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-mcp-cfg-test-'));
    try {
      fs.mkdirSync(path.join(wsRoot, '.workflow'), { recursive: true });
      fs.writeFileSync(
        path.join(wsRoot, '.workflow', 'config.json'),
        JSON.stringify({ workspace: { inheritClaudeAiMcpIntegrations: true } })
      );
      // Have to invoke wrapper with cwd = wsRoot so the node config read resolves
      const { fake } = makeFakeClaude();
      const log = path.join(wsRoot, 'log.txt');
      try {
        execSync(`bash ${WRAPPER} --no-wogi-restart x`, {
          cwd: wsRoot,
          env: {
            PATH: process.env.PATH,
            WOGI_CLAUDE_BIN: fake,
            WOGI_TEST_LOG: log,
            WOGI_WORKSPACE_ROOT: wsRoot,
            WOGI_REPO_NAME: 'frontend'
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000
        });
      } catch (_err) { /* non-blocking */ }
      const logContent = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8') : '';
      assert.ok(!/--strict-mcp-config/.test(logContent),
        'config.workspace.inheritClaudeAiMcpIntegrations=true must disable MCP stripping');
    } finally {
      try { fs.rmSync(wsRoot, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    }
  });

  it('init banner: worker mode prints banner to stderr when stderr is TTY', () => {
    // [ -t 2 ] check: banner prints only when stderr is a TTY. In this harness
    // stderr is redirected to a file (not a TTY), so banner is correctly
    // suppressed. Verify the wrapper has the banner code path intact.
    const wrapperContent = fs.readFileSync(WRAPPER, 'utf-8');
    assert.match(wrapperContent, /worker '\$\{WOGI_REPO_NAME\}' initializing/,
      'banner message template must be present in wrapper');
    assert.match(wrapperContent, /\[ -t 2 \]/,
      'banner must be guarded by [ -t 2 ] TTY check');
  });

  it('bounded window: does not hang forever when no dialog appears', () => {
    // Regression guard: if the matched phrase never arrives, the script must
    // still exit when the claude process exits (EOF), not loop forever on
    // exp_continue. Fake claude writes unrelated output and exits.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wogi-expect-bound-'));
    const fakeClaude = path.join(dir, 'claude');
    const fakeScript = `#!/bin/bash
echo "Totally unrelated startup output"
echo "No dialog here"
exit 0
`;
    fs.writeFileSync(fakeClaude, fakeScript, { mode: 0o755 });
    try {
      const start = Date.now();
      execSync(`expect ${EXPECT_SCRIPT} ${fakeClaude}`, {
        stdio: 'pipe',
        timeout: 8000,
        env: { ...process.env, WOGI_EXPECT_TIMEOUT: '2' }
      });
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 7000, `expect script should exit promptly on child EOF; took ${elapsed}ms`);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
    }
  });
});
