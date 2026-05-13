#!/usr/bin/env node

'use strict';

/**
 * Wogi Flow — Scheduled / Background Headless Runner (Phase 1A — wf-b211a076).
 *
 * Entry point invoked by `.github/workflows/wogi-scheduled.yml` (or by a
 * launchd/cron/systemd unit installed via `flow schedule install`).
 *
 * Usage:
 *   node scripts/flow-scheduled-runner.js <job-name> [--dry-run] [--repo=owner/name]
 *
 * Jobs:
 *   nightly-regression   Wraps scripts/flow-step-regression.js; skipped on empty diff.
 *   weekly-audit         Headless `claude -p` running /wogi-audit.
 *   weekly-digest        Headless `claude -p` running /wogi-debt + /wogi-gate-stats.
 *   per-pr-review        Headless `claude -p` running ultrareview on a PR.
 *
 * Read-only-by-default invariants (HARD GATES — also enforced by tests):
 *   - Runs only on the default branch (origin/HEAD).
 *   - Operates in a temp worktree created via scripts/flow-worktree.js
 *     (real `runInWorktree` wrap as of R-379 fix; failure to create worktree
 *     is a hard error — no silent fallback to the user's working dir).
 *   - Never `git push origin master` and never `gh pr merge`.
 *   - Never writes to .workflow/state/decisions.md.
 *
 * Safeguards:
 *   - --dry-run prints $/month projection and exits 0 without invoking claude.
 *   - scheduledMode.dailyTokenBudget cap — same-day jobs no-op once hit.
 *   - One persistent labelled issue per job (`wogi/scheduled-${job}`).
 *   - Silence-on-green default — nightly posts nothing when all tests pass.
 *   - Skip-on-empty-diff — nightly checks `git diff @{yesterday}..HEAD`.
 *   - 10-minute hard timeout per job via AbortController; on timeout opens a
 *     `wogi/scheduled-failure` issue with captured stderr.
 *   - Retry-1×-then-alert with 30s backoff on transient failures.
 *   - Clears routing-pending.json + pending-question.json before each invocation.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  JOB_NAMES,
  DEFAULT_JOB_TIMEOUT_MS,
  TRANSIENT_RETRY_DELAY_MS,
  clearStaleMarkers,
  loadHeadlessProfile,
  projectMonthlyCost,
  withTimeout,
  enforceTokenBudget,
  updateDedupIssue,
  validateModelName,
  isTransientError,
  DEFAULT_TOKENS_PER_INVOCATION,
} = require('../lib/scheduled-mode');

const { runInWorktree } = require('./flow-worktree');

const { PATHS, getConfig, safeJsonParse } = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const USAGE_LOG_PATH = path.join(PATHS.state, 'scheduled-usage-log.json');
const FAILURE_LABEL = 'wogi/scheduled-failure';

// ============================================================
// CLI arg parsing
// ============================================================

function parseArgs(argv) {
  const args = { job: null, dryRun: false, repo: null, _raw: argv.slice() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--repo=')) args.repo = a.slice('--repo='.length);
    else if (!a.startsWith('--') && !args.job) args.job = a;
  }
  return args;
}

// ============================================================
// Subprocess helpers (execFile only — no shell interpolation)
// ============================================================

function execSafe(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout && err.stdout.toString()) || '',
      stderr: (err.stderr && err.stderr.toString()) || err.message,
      error: err,
    };
  }
}

// ============================================================
// Default-branch detection
// ============================================================

/**
 * Detect the repo's default branch via origin/HEAD.
 * Falls back to 'master' then 'main' if origin/HEAD is unconfigured.
 */
function detectDefaultBranch(cwd) {
  const r = execSafe('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd });
  if (r.ok && r.stdout) {
    // "refs/remotes/origin/master" → "master"
    return r.stdout.replace(/^refs\/remotes\/origin\//, '').trim();
  }
  // Fallback probes
  for (const candidate of ['master', 'main']) {
    const probe = execSafe('git', ['rev-parse', '--verify', `origin/${candidate}`], { cwd });
    if (probe.ok) return candidate;
  }
  return null;
}

// ============================================================
// Usage log (token budget tracking)
// ============================================================

function readUsageLog() {
  const parsed = safeJsonParse(USAGE_LOG_PATH, null);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeUsageLog(log) {
  try {
    fs.mkdirSync(path.dirname(USAGE_LOG_PATH), { recursive: true });
    fs.writeFileSync(USAGE_LOG_PATH, JSON.stringify(log, null, 2));
  } catch (err) {
    console.warn(`[scheduled-runner] failed to persist usage log: ${err.message}`);
  }
}

function recordUsage(jobName, tokens, now = Date.now()) {
  const key = new Date(now).toISOString().slice(0, 10);
  const log = readUsageLog();
  if (!log[key]) log[key] = {};
  log[key][jobName] = (log[key][jobName] || 0) + tokens;
  writeUsageLog(log);
  return log;
}

// ============================================================
// Empty-diff check for nightly-regression
// ============================================================

function hasDiffSinceYesterday(cwd) {
  // Use a SHA range — @{yesterday} can fail in CI where reflog is empty.
  // We anchor against the merge-base with origin/<default-branch> from ~24h ago.
  // Simpler + portable: compare HEAD vs HEAD~ at >=24h old commit if available.
  const r = execSafe('git', ['log', '--since=24 hours ago', '--oneline', '-1'], { cwd });
  if (!r.ok) {
    // Be conservative: if we can't tell, treat as "has diff" so we don't silently skip.
    return true;
  }
  return r.stdout.trim().length > 0;
}

// ============================================================
// Dedup-issue execution
// ============================================================

function listDedupIssues(jobName, repo) {
  const label = `wogi/scheduled-${jobName}`;
  const args = ['issue', 'list', '--label', label, '--state', 'open', '--json', 'number'];
  if (repo) args.push('--repo', repo);
  const r = execSafe('gh', args);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.stdout || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => x && x.number).filter((n) => Number.isFinite(n));
  } catch (_err) {
    return [];
  }
}

function postDedupIssue(jobName, body, repo) {
  const existing = listDedupIssues(jobName, repo);
  const { mode, argv } = updateDedupIssue(jobName, body, { existingIssueNumbers: existing });
  const fullArgv = repo ? [...argv, '--repo', repo] : argv;
  const r = execSafe('gh', fullArgv);
  return { mode, ok: r.ok, error: r.ok ? null : r.stderr };
}

function openFailureIssue(jobName, summary, stderr, repo) {
  const title = `[scheduled-failure] ${jobName} — ${new Date().toISOString().slice(0, 10)}`;
  const body = [
    `### Scheduled job failure`,
    `- **Job**: \`${jobName}\``,
    `- **Time**: ${new Date().toISOString()}`,
    ``,
    `### Summary`,
    summary,
    ``,
    `### stderr (last 4 KB)`,
    '```',
    (stderr || '').slice(-4096),
    '```',
  ].join('\n');
  const argv = ['issue', 'create', '--title', title, '--body', body, '--label', FAILURE_LABEL];
  const fullArgv = repo ? [...argv, '--repo', repo] : argv;
  return execSafe('gh', fullArgv);
}

// ============================================================
// Read-only invariant guard (defense-in-depth — runner self-check)
// ============================================================

function assertReadOnlyEnv() {
  // Defense-in-depth: refuse to start if env hints at write-mode operation.
  // This is belt-and-braces — the workflow YAML uses contents:read where
  // possible, but a misconfigured local cron unit could grant more.
  if (process.env.WOGI_SCHEDULED_ALLOW_WRITE === '1') {
    throw new Error(
      'scheduled-runner: refusing to run with WOGI_SCHEDULED_ALLOW_WRITE=1 — read-only invariant.'
    );
  }
}

// ============================================================
// Job implementations
// ============================================================

/**
 * Run the nightly regression job. Wraps flow-step-regression.js.
 * Silence-on-green: posts nothing if all pass.
 */
async function runNightlyRegression(ctx) {
  const { profile, cwd, repo, signal } = ctx;
  validateModelName(profile.model);

  if (signal && signal.aborted) {
    return { passed: false, message: 'aborted', skipped: false };
  }

  if (!hasDiffSinceYesterday(cwd)) {
    return { passed: true, skipped: true, message: 'no diff in last 24h — skipped' };
  }

  // Delegate to the existing step runner — do NOT rewrite it.
  // The step runner shells out via execSync internally; we capture its result.
  const scriptPath = path.join(__dirname, 'flow-step-regression.js');
  if (!fs.existsSync(scriptPath)) {
    return { passed: false, message: 'flow-step-regression.js not found', skipped: false };
  }

  const stepRunner = require(scriptPath);
  let result;
  try {
    result = await stepRunner.run({ stepConfig: { sampleSize: 3 }, mode: 'auto' });
  } catch (err) {
    return { passed: false, message: `regression runner threw: ${err.message}`, skipped: false };
  }

  if (result && result.passed) {
    // Silence-on-green: do NOT touch the dedup issue.
    return { passed: true, skipped: false, message: result.message, silent: true };
  }

  // Failure: build a markdown body and post to the dedup issue.
  const body = [
    `### Nightly regression — FAILED`,
    `- **Time**: ${new Date().toISOString()}`,
    `- **Branch**: ${ctx.defaultBranch}`,
    ``,
    `### Message`,
    result?.message || '(no message)',
    ``,
    `### Details`,
    '```json',
    JSON.stringify(result?.details || {}, null, 2),
    '```',
  ].join('\n');
  if (!profile.dryRun) {
    postDedupIssue('nightly-regression', body, repo);
  }
  return { passed: false, skipped: false, message: result?.message || 'regression failed' };
}

/**
 * Generic claude-headless invoker for audit / digest / per-pr-review jobs.
 *
 * NOTE: We do not actually shell out to `claude -p` unless the binary exists.
 * In CI we expect the GH Actions workflow to provide it; locally on a dev
 * machine, the headless runner is typically invoked in --dry-run mode.
 */
async function runClaudeHeadless(jobName, prompt, ctx) {
  const { profile, signal } = ctx;
  const model = validateModelName(profile.model);

  if (profile.dryRun) {
    return {
      passed: true,
      skipped: true,
      message: `dry-run: would invoke claude -p --model=${model} on ${jobName}`,
      silent: true,
    };
  }

  if (signal && signal.aborted) {
    return { passed: false, message: 'aborted', skipped: false };
  }

  // Probe for the `claude` binary. In environments without it, we exit
  // cleanly rather than crash — the failure-issue path covers reporting.
  const which = execSafe('which', ['claude']);
  if (!which.ok) {
    return {
      passed: false,
      skipped: false,
      message: 'claude CLI not on PATH — headless invocation not possible',
    };
  }

  const r = execSafe('claude', ['-p', '--model', model, prompt], {
    cwd: ctx.cwd,
    env: { ...process.env },
    timeout: ctx.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
  });

  // F4 / R-379: record the actual pre-flight estimate (not 0). Without this,
  // enforceTokenBudget always sees 0 spent and the daily cap is a no-op.
  recordUsage(jobName, ctx.estimatedTokens ?? 0);

  return {
    passed: r.ok,
    skipped: false,
    message: r.ok ? `${jobName} ran cleanly` : `claude exited non-zero`,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

async function runWeeklyAudit(ctx) {
  const result = await runClaudeHeadless('weekly-audit', '/wogi-audit', ctx);
  if (result.passed && !result.skipped && !ctx.profile.dryRun) {
    const body = [
      `### Weekly Audit Report`,
      `- **Time**: ${new Date().toISOString()}`,
      ``,
      '```',
      (result.stdout || '').slice(0, 8000),
      '```',
    ].join('\n');
    postDedupIssue('weekly-audit', body, ctx.repo);
  }
  return result;
}

async function runWeeklyDigest(ctx) {
  const prompt = '/wogi-debt and then /wogi-gate-stats --since=7d. Produce a single digest.';
  const result = await runClaudeHeadless('weekly-digest', prompt, ctx);
  if (result.passed && !result.skipped && !ctx.profile.dryRun) {
    const body = [
      `### Weekly Debt + Gate-stats Digest`,
      `- **Time**: ${new Date().toISOString()}`,
      ``,
      '```',
      (result.stdout || '').slice(0, 8000),
      '```',
    ].join('\n');
    postDedupIssue('weekly-digest', body, ctx.repo);
  }
  return result;
}

async function runPerPrReview(ctx) {
  const prNumber = process.env.PR_NUMBER || '0';
  // F3 / R-379: must be the slash-command form (/ultrareview …) so Claude Code
  // routes it to the ultrareview skill. The bare-string form ("ultrareview 42")
  // sends a literal text prompt that goes nowhere useful. Mirrors how
  // runWeeklyAudit invokes "/wogi-audit" above.
  const prompt = `/ultrareview ${prNumber}`;
  const result = await runClaudeHeadless('per-pr-review', prompt, ctx);
  // Per-PR review posts on the PR (gh pr comment) — handled by the GH workflow
  // step using the returned stdout. Runner doesn't auto-merge.
  return result;
}

const JOB_HANDLERS = {
  'nightly-regression': runNightlyRegression,
  'weekly-audit':       runWeeklyAudit,
  'weekly-digest':      runWeeklyDigest,
  'per-pr-review':      runPerPrReview,
};

// ============================================================
// Orchestrator — single job invocation with timeout + retry
// ============================================================

async function runOnce(jobName, ctx) {
  const handler = JOB_HANDLERS[jobName];
  if (!handler) {
    throw new Error(`scheduled-runner: unknown job "${jobName}"`);
  }
  return withTimeout(
    ({ signal }) => handler({ ...ctx, signal }),
    ctx.timeoutMs || DEFAULT_JOB_TIMEOUT_MS,
  );
}

async function runJobWithRetry(jobName, ctx) {
  const first = await runOnce(jobName, ctx);
  if (first.ok) return first;

  // Retry once on transient failures only.
  if (first.error && isTransientError(first.error)) {
    await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
    return runOnce(jobName, ctx);
  }
  return first;
}

// ============================================================
// Main entry
// ============================================================

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (!args.job) {
    console.error(
      `Usage: node scripts/flow-scheduled-runner.js <job-name> [--dry-run] [--repo=owner/name]\n` +
      `Jobs: ${JOB_NAMES.join(', ')}`
    );
    return 2;
  }
  if (!JOB_NAMES.includes(args.job)) {
    console.error(`scheduled-runner: unknown job "${args.job}". Allowed: ${JOB_NAMES.join(', ')}`);
    return 2;
  }

  assertReadOnlyEnv();

  const config = (deps.config || getConfig());
  const sm = (config && config.scheduledMode) || {};
  if (!sm.enabled && !args.dryRun) {
    console.log(`scheduled-runner: scheduledMode.enabled is false — exiting with 0`);
    return 0;
  }

  const profile = loadHeadlessProfile(config, args.job);
  profile.dryRun = profile.dryRun || args.dryRun;

  // --- Dry-run path: print projection and exit, no claude invocation. ---
  if (profile.dryRun) {
    const projection = projectMonthlyCost(config || {});
    const lines = [
      `scheduled-runner: DRY-RUN (job=${args.job}, model=${profile.model})`,
      `Projected monthly cost across all configured jobs: $${projection.total}`,
      ``,
      `Per-job:`,
    ];
    for (const [name, info] of Object.entries(projection.byJob)) {
      lines.push(`  ${name.padEnd(22)} ${info.model.padEnd(8)} ` +
                 `${info.invocations}× ${info.tokens.toLocaleString()} tok → $${info.cost}`);
    }
    console.log(lines.join('\n'));
    return 0;
  }

  // --- Token-budget check ---
  const budgetVerdict = enforceTokenBudget(
    readUsageLog(),
    profile.dailyTokenBudget,
    Date.now(),
    args.job,
  );
  if (!budgetVerdict.allowed) {
    console.warn(`scheduled-runner: ${args.job} skipped — ${budgetVerdict.reason}`);
    return 0; // no-op, exit clean
  }

  // --- Default-branch + worktree enforcement ---
  const cwd = process.cwd();
  const defaultBranch = detectDefaultBranch(cwd) || 'master';
  const currentBranch = execSafe('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).stdout;
  // We do NOT crash if the current branch isn't default — the runner itself
  // creates a worktree on the default branch. But we record it so the audit trail
  // is complete.

  // --- Clear stale markers ---
  const cleared = clearStaleMarkers(PATHS.state);
  if (cleared.cleared.length > 0) {
    console.log(`scheduled-runner: cleared ${cleared.cleared.join(', ')}`);
  }

  // --- Execute the job (with timeout + retry, in a temp worktree) ---
  // F2 / R-379: the runner MUST operate in a temp worktree on the default
  // branch — never touch the user's working dir. Failure to create the worktree
  // is a hard error (no silent fallback); the invariant matters even if Claude
  // never writes to disk, because regression scripts and tests do.
  // F4 / R-379: ctx.estimatedTokens now carries the real per-job estimate so
  // enforceTokenBudget can actually do its job.
  const buildCtx = (worktreeCwd) => ({
    profile,
    cwd: worktreeCwd ?? cwd,
    repo: args.repo,
    defaultBranch,
    currentBranch,
    estimatedTokens: DEFAULT_TOKENS_PER_INVOCATION[args.job] ?? 0,
    timeoutMs: DEFAULT_JOB_TIMEOUT_MS,
  });

  const worktreeOpts = {
    taskId: `scheduled-${args.job}-${Date.now()}`,
    baseBranch: defaultBranch,
    cwd,
  };

  let worktreeWrap;
  try {
    worktreeWrap = await (deps.runInWorktree || runInWorktree)(
      worktreeOpts,
      async (worktreePath) => runJobWithRetry(args.job, buildCtx(worktreePath)),
    );
  } catch (err) {
    // Hard-error: refuse to silently fall back to the user's working directory.
    openFailureIssue(
      args.job,
      `Worktree creation failed; refusing to run on the user's working tree (read-only invariant).`,
      String(err && err.message ? err.message : err),
      args.repo,
    );
    return 1;
  }

  if (!worktreeWrap.success) {
    // Worktree was created but the wrapped job threw; report and exit.
    openFailureIssue(
      args.job,
      `Job threw inside the temp worktree.`,
      String(worktreeWrap.error || '(no error message)'),
      args.repo,
    );
    return 1;
  }

  const verdict = worktreeWrap.result;
  if (!verdict.ok) {
    const stderr =
      (verdict.error && verdict.error.stderr) ||
      (verdict.error && verdict.error.message) ||
      '(no stderr)';
    if (verdict.timedOut) {
      openFailureIssue(
        args.job,
        `Job exceeded ${DEFAULT_JOB_TIMEOUT_MS}ms hard timeout.`,
        stderr,
        args.repo,
      );
    } else {
      openFailureIssue(args.job, `Job failed permanently after retry.`, stderr, args.repo);
    }
    return 1;
  }

  const result = verdict.result || {};
  if (result.skipped) {
    console.log(`scheduled-runner: ${args.job} skipped — ${result.message}`);
    return 0;
  }
  if (result.silent) {
    console.log(`scheduled-runner: ${args.job} green — silence-on-green`);
    return 0;
  }
  console.log(`scheduled-runner: ${args.job} → passed=${result.passed}`);
  return result.passed ? 0 : 1;
}

// ============================================================
// Exports (for tests) + CLI
// ============================================================

module.exports = {
  main,
  parseArgs,
  detectDefaultBranch,
  hasDiffSinceYesterday,
  listDedupIssues,
  postDedupIssue,
  openFailureIssue,
  readUsageLog,
  writeUsageLog,
  recordUsage,
  runOnce,
  runJobWithRetry,
  assertReadOnlyEnv,
  // Exported for R-379 fix tests:
  runPerPrReview,
  JOB_HANDLERS,
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`scheduled-runner: fatal: ${err.stack || err.message}`);
      process.exit(1);
    });
}
