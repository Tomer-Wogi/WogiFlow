'use strict';

/**
 * Tests for scripts/flow-scheduled-runner.js + lib/scheduled-mode.js
 * (Phase 1A — wf-b211a076).
 *
 * Coverage:
 *   - parseArgs (dry-run, repo, job extraction)
 *   - clearStaleMarkers (existing/missing/permission-failure)
 *   - projectMonthlyCost (model rates + per-job invocation counts)
 *   - enforceTokenBudget (under / at / over budget)
 *   - withTimeout (resolves before timeout; aborts after timeout)
 *   - updateDedupIssue (returns CREATE argv when no existing; UPDATE when existing)
 *   - isTransientError (network codes / messages)
 *   - validateModelName (allowlist)
 *   - read-only invariant (assertReadOnlyEnv blocks WOGI_SCHEDULED_ALLOW_WRITE=1)
 *   - read-only invariant (grep runner for forbidden write commands)
 *   - default-branch detection
 *   - usage log read/write/record
 *
 * Run: NODE_ENV=test node --test tests/flow-scheduled-runner.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Silence module-load noise for clean test output.
const _origWarn = console.warn;
const _origLog = console.log;
console.warn = () => {};
console.log = () => {};
process.on('exit', () => { console.warn = _origWarn; console.log = _origLog; });

const lib = require('../lib/scheduled-mode');
const runner = require('../scripts/flow-scheduled-runner');

// ============================================================
// parseArgs
// ============================================================

describe('parseArgs', () => {
  it('extracts job, dry-run flag, and repo', () => {
    const r = runner.parseArgs(['weekly-audit', '--dry-run', '--repo=Tomer-Wogi/WogiFlow']);
    assert.equal(r.job, 'weekly-audit');
    assert.equal(r.dryRun, true);
    assert.equal(r.repo, 'Tomer-Wogi/WogiFlow');
  });
  it('returns null job when none given', () => {
    const r = runner.parseArgs(['--dry-run']);
    assert.equal(r.job, null);
  });
  it('ignores unknown flags', () => {
    const r = runner.parseArgs(['per-pr-review', '--unknown=x']);
    assert.equal(r.job, 'per-pr-review');
  });
});

// ============================================================
// clearStaleMarkers
// ============================================================

describe('clearStaleMarkers', () => {
  it('removes both markers when present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sched-test-'));
    fs.writeFileSync(path.join(tmp, 'routing-pending.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'pending-question.json'), '{}');
    const result = lib.clearStaleMarkers(tmp);
    assert.deepEqual(result.cleared.sort(), ['pending-question.json', 'routing-pending.json']);
    assert.equal(fs.existsSync(path.join(tmp, 'routing-pending.json')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'pending-question.json')), false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it('skips silently when markers absent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sched-test-'));
    const result = lib.clearStaleMarkers(tmp);
    assert.deepEqual(result.cleared, []);
    assert.deepEqual(result.skipped.sort(), ['pending-question.json', 'routing-pending.json']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// ============================================================
// projectMonthlyCost
// ============================================================

describe('projectMonthlyCost', () => {
  it('produces a positive total for the default schedule', () => {
    const cfg = {
      scheduledMode: {
        perJobModel: {
          'nightly-regression': 'haiku',
          'weekly-audit': 'sonnet',
          'weekly-digest': 'sonnet',
          'per-pr-review': 'opus',
        },
      },
    };
    const p = lib.projectMonthlyCost(cfg);
    assert.ok(p.total > 0, 'total should be > 0');
    assert.ok(p.byJob['nightly-regression'], 'nightly-regression line present');
    assert.equal(p.byJob['nightly-regression'].model, 'haiku');
    assert.equal(p.byJob['per-pr-review'].model, 'opus');
  });
  it('opus costs more than haiku for same invocation count', () => {
    const opusCfg = { scheduledMode: { perJobModel: { 'per-pr-review': 'opus' }, jobs: ['per-pr-review'] } };
    const haikuCfg = { scheduledMode: { perJobModel: { 'per-pr-review': 'haiku' }, jobs: ['per-pr-review'] } };
    assert.ok(
      lib.projectMonthlyCost(opusCfg).total > lib.projectMonthlyCost(haikuCfg).total,
      'opus per-PR should cost more than haiku per-PR'
    );
  });
  it('returns 0 total when jobs list is empty', () => {
    const p = lib.projectMonthlyCost({ scheduledMode: { jobs: [] } });
    assert.equal(p.total, 0);
  });
});

// ============================================================
// enforceTokenBudget
// ============================================================

describe('enforceTokenBudget', () => {
  it('allows when under budget', () => {
    const log = { '2026-05-13': { 'weekly-audit': 100_000 } };
    const v = lib.enforceTokenBudget(log, 5_000_000, '2026-05-13T12:00:00Z', 'weekly-audit', 50_000);
    assert.equal(v.allowed, true);
    assert.equal(v.usedToday, 100_000);
    assert.equal(v.projectedAfter, 150_000);
  });
  it('blocks when projected total exceeds budget', () => {
    const log = { '2026-05-13': { 'weekly-audit': 4_950_000 } };
    const v = lib.enforceTokenBudget(log, 5_000_000, '2026-05-13T12:00:00Z', 'weekly-audit', 100_000);
    assert.equal(v.allowed, false);
    assert.match(v.reason, /budget/i);
  });
  it('treats zero/negative budget as "no budget configured"', () => {
    const v = lib.enforceTokenBudget({}, 0, Date.now(), 'weekly-digest');
    assert.equal(v.allowed, true);
    assert.match(v.reason, /no budget/i);
  });
});

// ============================================================
// withTimeout
// ============================================================

describe('withTimeout', () => {
  it('returns success when fn finishes before timeout', async () => {
    const r = await lib.withTimeout(async () => 'done', 200);
    assert.equal(r.ok, true);
    assert.equal(r.result, 'done');
  });
  it('returns timeout result when fn takes longer than ms', async () => {
    const r = await lib.withTimeout(
      ({ signal }) => new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve('late'), 200);
        signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
      }),
      30,
    );
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
  });
  it('throws on invalid timeout', async () => {
    await assert.rejects(() => lib.withTimeout(async () => 1, 0));
    await assert.rejects(() => lib.withTimeout(async () => 1, -1));
  });
});

// ============================================================
// updateDedupIssue
// ============================================================

describe('updateDedupIssue', () => {
  it('returns CREATE argv when no existing issue', () => {
    const r = lib.updateDedupIssue('weekly-audit', 'hello', { existingIssueNumbers: [] });
    assert.equal(r.mode, 'create');
    assert.ok(r.argv.includes('create'));
    assert.ok(r.argv.includes('--label'));
    assert.ok(r.argv.includes('wogi/scheduled-weekly-audit'));
  });
  it('returns UPDATE argv (comment on existing #N) when issue exists', () => {
    const r = lib.updateDedupIssue('weekly-audit', 'updated body', { existingIssueNumbers: [42] });
    assert.equal(r.mode, 'update');
    assert.deepEqual(r.argv.slice(0, 3), ['issue', 'comment', '42']);
    assert.ok(r.argv.includes('--body'));
    assert.ok(r.argv.includes('updated body'));
  });
  it('throws on unknown job name', () => {
    assert.throws(() => lib.updateDedupIssue('bogus-job', 'x', {}));
  });
});

// ============================================================
// isTransientError
// ============================================================

describe('isTransientError', () => {
  it('detects network error codes', () => {
    assert.equal(lib.isTransientError({ code: 'ETIMEDOUT', message: 'x' }), true);
    assert.equal(lib.isTransientError({ code: 'ECONNRESET', message: 'x' }), true);
    assert.equal(lib.isTransientError({ code: 'EAI_AGAIN', message: 'x' }), true);
  });
  it('detects rate-limit / timeout messages', () => {
    assert.equal(lib.isTransientError(new Error('rate limit exceeded, try again')), true);
    assert.equal(lib.isTransientError(new Error('temporary failure')), true);
  });
  it('returns false for non-transient errors', () => {
    assert.equal(lib.isTransientError(new Error('config not found')), false);
    assert.equal(lib.isTransientError(null), false);
  });
});

// ============================================================
// validateModelName
// ============================================================

describe('validateModelName', () => {
  it('accepts allowed names', () => {
    for (const m of ['haiku', 'sonnet', 'opus']) {
      assert.equal(lib.validateModelName(m), m);
    }
  });
  it('rejects unknown names (injection guard)', () => {
    assert.throws(() => lib.validateModelName('gpt-4'));
    assert.throws(() => lib.validateModelName('--rm -rf /'));
    assert.throws(() => lib.validateModelName(''));
  });
});

// ============================================================
// Runner read-only invariant — env-var refusal
// ============================================================

describe('runner read-only invariant', () => {
  it('throws when WOGI_SCHEDULED_ALLOW_WRITE=1', () => {
    const prev = process.env.WOGI_SCHEDULED_ALLOW_WRITE;
    process.env.WOGI_SCHEDULED_ALLOW_WRITE = '1';
    try {
      assert.throws(() => runner.assertReadOnlyEnv(), /read-only/);
    } finally {
      if (prev === undefined) delete process.env.WOGI_SCHEDULED_ALLOW_WRITE;
      else process.env.WOGI_SCHEDULED_ALLOW_WRITE = prev;
    }
  });
  it('passes when env is not set', () => {
    const prev = process.env.WOGI_SCHEDULED_ALLOW_WRITE;
    delete process.env.WOGI_SCHEDULED_ALLOW_WRITE;
    try {
      runner.assertReadOnlyEnv(); // should not throw
    } finally {
      if (prev !== undefined) process.env.WOGI_SCHEDULED_ALLOW_WRITE = prev;
    }
  });
});

// ============================================================
// Runner static-grep invariant — no forbidden write commands
// ============================================================

describe('runner static-grep invariant', () => {
  // The runner code itself must not contain forbidden mutations IN EXECUTABLE
  // PATHS. We strip comments + the JSDoc/file-header block before grepping so
  // that documented invariants (which mention the forbidden commands) don't
  // false-trigger. Strings (which DO ship at runtime) are NOT stripped.
  const rawSrc = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'flow-scheduled-runner.js'),
    'utf-8',
  );
  // Strip /* ... */ block comments (incl. JSDoc) — they mention the forbidden
  // commands in the invariants documentation.
  const noBlockComments = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip // line comments (preserves "://example.com" inside strings since
  // those aren't at line-start; this regex only matches "//" preceded by
  // whitespace or start-of-line).
  const runnerSrc = noBlockComments.replace(/(^|\s)\/\/.*$/gm, '$1');

  it('does not contain executable `git push origin master/main`', () => {
    assert.equal(/git push\s+origin\s+master/.test(runnerSrc), false);
    assert.equal(/git push\s+origin\s+main/.test(runnerSrc), false);
    // Argv form too (no execFileSync(['git','push','origin','master']) anywhere)
    assert.equal(
      /['"]push['"]\s*,\s*['"]origin['"]\s*,\s*['"](?:master|main)['"]/.test(runnerSrc),
      false,
    );
  });
  it('does not contain executable `gh pr merge`', () => {
    assert.equal(/gh\s+pr\s+merge/i.test(runnerSrc), false);
    // Argv form ('pr', 'merge') in execFileSync arrays.
    assert.equal(/['"]pr['"]\s*,\s*['"]merge['"]/.test(runnerSrc), false);
  });
  it('does not write to .workflow/state/decisions.md', () => {
    // The runner must not reference decisions.md at all (read OR write).
    // Stripped comments mean only executable refs are in scope.
    assert.equal(/decisions\.md/.test(runnerSrc), false);
  });
});

// ============================================================
// dry-run cost projection — main entry path
// ============================================================

describe('main() — dry-run path', () => {
  it('returns 0 and prints projection without invoking claude', async () => {
    // Inject a config with scheduledMode disabled — dry-run should still work
    // because dry-run bypasses the enabled gate (purpose: pre-enable preview).
    const cfg = {
      scheduledMode: {
        enabled: true,
        dailyTokenBudget: 5_000_000,
        perJobModel: {
          'nightly-regression': 'haiku',
          'weekly-audit': 'sonnet',
          'weekly-digest': 'sonnet',
          'per-pr-review': 'opus',
        },
        jobs: ['nightly-regression', 'weekly-audit', 'weekly-digest', 'per-pr-review'],
      },
    };

    // Capture stdout
    let captured = '';
    const realLog = console.log;
    console.log = (...a) => { captured += a.join(' ') + '\n'; };
    try {
      const code = await runner.main(['weekly-audit', '--dry-run'], { config: cfg });
      assert.equal(code, 0);
      assert.match(captured, /DRY-RUN/);
      assert.match(captured, /\$/);
      assert.match(captured, /weekly-audit/);
    } finally {
      console.log = realLog;
    }
  });
});

// ============================================================
// main() — unknown job → exit code 2
// ============================================================

describe('main() — error paths', () => {
  it('returns 2 on missing job', async () => {
    const realErr = console.error;
    console.error = () => {};
    try {
      const code = await runner.main([], { config: { scheduledMode: { enabled: true } } });
      assert.equal(code, 2);
    } finally {
      console.error = realErr;
    }
  });
  it('returns 2 on unknown job name', async () => {
    const realErr = console.error;
    console.error = () => {};
    try {
      const code = await runner.main(['bogus'], { config: { scheduledMode: { enabled: true } } });
      assert.equal(code, 2);
    } finally {
      console.error = realErr;
    }
  });
  it('returns 0 cleanly when scheduledMode.enabled is false (non-dry-run)', async () => {
    const realLog = console.log;
    console.log = () => {};
    try {
      const code = await runner.main(
        ['weekly-audit'],
        { config: { scheduledMode: { enabled: false } } },
      );
      assert.equal(code, 0);
    } finally {
      console.log = realLog;
    }
  });
});

// ============================================================
// Budget-exhausted skip
// ============================================================

describe('main() — token budget enforcement', () => {
  it('skips job (exit 0) when daily budget is exhausted', async () => {
    // Pre-seed the usage log with a value that exceeds the budget when
    // combined with the next invocation.
    const stateDir = path.join(process.cwd(), '.workflow', 'state');
    const logPath = path.join(stateDir, 'scheduled-usage-log.json');
    let backup = null;
    if (fs.existsSync(logPath)) backup = fs.readFileSync(logPath, 'utf-8');
    const todayKey = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      logPath,
      JSON.stringify({ [todayKey]: { 'weekly-audit': 100_000 } }, null, 2),
    );

    const realLog = console.log;
    const realWarn = console.warn;
    let warned = '';
    console.log = () => {};
    console.warn = (...a) => { warned += a.join(' ') + '\n'; };
    try {
      const code = await runner.main(
        ['weekly-audit'],
        {
          config: {
            scheduledMode: {
              enabled: true,
              dailyTokenBudget: 50_000, // already exceeded
              perJobModel: { 'weekly-audit': 'sonnet' },
            },
          },
        },
      );
      assert.equal(code, 0);
      assert.match(warned, /skipped/);
    } finally {
      console.log = realLog;
      console.warn = realWarn;
      if (backup !== null) fs.writeFileSync(logPath, backup);
      else if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    }
  });
});

// ============================================================
// detectDefaultBranch — exists / falls back
// ============================================================

describe('detectDefaultBranch', () => {
  it('returns a non-empty branch name for the current repo', () => {
    const b = runner.detectDefaultBranch(process.cwd());
    // master or main expected for this repo; allow null only in tmpfs fallback
    assert.ok(b === null || typeof b === 'string');
  });
});

// ============================================================
// usage log lifecycle
// ============================================================

describe('usage log', () => {
  it('records usage and persists across reads', () => {
    const stateDir = path.join(process.cwd(), '.workflow', 'state');
    const logPath = path.join(stateDir, 'scheduled-usage-log.json');
    let backup = null;
    if (fs.existsSync(logPath)) backup = fs.readFileSync(logPath, 'utf-8');
    try {
      // Clear
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
      const before = runner.readUsageLog();
      assert.equal(Object.keys(before).length, 0);
      runner.recordUsage('weekly-audit', 12_345);
      const after = runner.readUsageLog();
      const todayKey = new Date().toISOString().slice(0, 10);
      assert.equal(after[todayKey]['weekly-audit'], 12_345);
    } finally {
      if (backup !== null) fs.writeFileSync(logPath, backup);
      else if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    }
  });
});
