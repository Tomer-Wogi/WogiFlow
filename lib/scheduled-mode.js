'use strict';

/**
 * Scheduled-mode shared helpers (Phase 1A of epic-quality-loop, wf-b211a076).
 *
 * Pure business-logic helpers consumed by `scripts/flow-scheduled-runner.js`.
 * CLI-agnostic per the hook three-layer principle — no stdin parsing, no exit
 * codes, no `gh`/`claude` invocation here. Entry/runner files orchestrate; this
 * module computes, classifies, and reads state.
 *
 * Exports:
 *   - JOB_NAMES, MODEL_RATES (constants)
 *   - clearStaleMarkers(stateDir): remove routing-pending.json + pending-question.json
 *   - loadHeadlessProfile(config, jobName): per-job model + cost projection inputs
 *   - projectMonthlyCost(jobsConfig): $/month estimate for the configured schedule
 *   - withTimeout(fn, ms, opts): wraps an async fn with AbortController + hard kill
 *   - enforceTokenBudget(usageLog, budget, now, jobName): { allowed, reason, usedToday }
 *   - updateDedupIssue(jobName, body, opts): build the `gh` argv to update/create
 *   - validateModelName(name): allowlist guard for subprocess args
 *
 * Read-only-by-default invariants (enforced by the runner, documented here):
 *   - No `git push` to non-bot refs
 *   - No `gh pr merge`
 *   - No writes to `.workflow/state/decisions.md`
 *   - Operates only on the default branch
 *   - All work in a temp worktree from `scripts/flow-worktree.js`
 */

const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// Constants
// ============================================================

/** Canonical job names — used by the workflow YAML, runner, and dedup labels. */
const JOB_NAMES = Object.freeze([
  'nightly-regression',
  'weekly-audit',
  'weekly-digest',
  'per-pr-review',
]);

/**
 * Token-cost estimates per million tokens (USD), used only for $/month
 * projection in --dry-run mode. Numbers are deliberately conservative
 * (input+output blended) and meant for budgeting, not billing.
 */
const MODEL_RATES = Object.freeze({
  haiku: 1.25,
  sonnet: 6.00,
  opus: 30.00,
});

/** Hard timeout for a single headless job invocation. */
const DEFAULT_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Backoff before single retry on transient failure. */
const TRANSIENT_RETRY_DELAY_MS = 30 * 1000;

/** Allowed model names for the `--model=...` CLI arg (subprocess injection guard). */
const ALLOWED_MODELS = new Set(['haiku', 'sonnet', 'opus']);

/** Average tokens per invocation used in monthly projection (per-job). */
const DEFAULT_TOKENS_PER_INVOCATION = Object.freeze({
  'nightly-regression': 40_000,
  'weekly-audit':       150_000,
  'weekly-digest':      30_000,
  'per-pr-review':      80_000,
});

/** Default invocations-per-month per job (matching the cron schedule). */
const DEFAULT_INVOCATIONS_PER_MONTH = Object.freeze({
  'nightly-regression': 30, // daily
  'weekly-audit':       4,  // weekly
  'weekly-digest':      4,  // weekly
  'per-pr-review':      20, // ~weekday PRs
});

// ============================================================
// Helpers
// ============================================================

/**
 * Remove stale routing / pending-question markers before each headless invocation.
 *
 * The runner clears these so that a headless Claude session starts clean and
 * does not inherit interactive-session state from the developer's working tree.
 *
 * @param {string} stateDir - Path to `.workflow/state/`
 * @returns {{ cleared: string[], skipped: string[] }}
 */
function clearStaleMarkers(stateDir) {
  const targets = ['routing-pending.json', 'pending-question.json'];
  const cleared = [];
  const skipped = [];
  for (const name of targets) {
    const p = path.join(stateDir, name);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        cleared.push(name);
      } else {
        skipped.push(name);
      }
    } catch (_err) {
      // Fail-open: a stuck marker is recoverable next cycle.
      skipped.push(name);
    }
  }
  return { cleared, skipped };
}

/**
 * Validate a model name against the subprocess allowlist.
 * Throws if invalid. Use BEFORE passing to execFileSync.
 *
 * @param {string} name
 * @returns {string} validated name
 */
function validateModelName(name) {
  if (!ALLOWED_MODELS.has(name)) {
    throw new Error(
      `scheduled-mode: invalid model "${name}". Allowed: ${[...ALLOWED_MODELS].join(', ')}`
    );
  }
  return name;
}

/**
 * Resolve the headless config profile for a given job.
 *
 * @param {object} config - The merged WogiFlow config (config.scheduledMode subtree)
 * @param {string} jobName
 * @returns {{ model: string, dryRun: boolean, enabled: boolean, dailyTokenBudget: number }}
 */
function loadHeadlessProfile(config, jobName) {
  const sm = (config && config.scheduledMode) || {};
  const perJob = sm.perJobModel || {};
  const rawModel = perJob[jobName] || 'sonnet';
  const model = ALLOWED_MODELS.has(rawModel) ? rawModel : 'sonnet';
  return {
    model,
    dryRun: Boolean(sm.dryRun),
    enabled: Boolean(sm.enabled),
    dailyTokenBudget: Number.isFinite(sm.dailyTokenBudget) ? sm.dailyTokenBudget : 5_000_000,
  };
}

/**
 * Project monthly USD cost for a set of jobs.
 *
 * @param {object} jobsConfig - { perJobModel: { [name]: model } }
 * @param {object} [opts]
 * @param {string[]} [opts.jobs] - Subset of jobs to include (defaults to all enabled)
 * @returns {{ total: number, byJob: object<string, {invocations:number, tokens:number, model:string, cost:number}> }}
 */
function projectMonthlyCost(jobsConfig, opts = {}) {
  const sm = (jobsConfig && jobsConfig.scheduledMode) || jobsConfig || {};
  const perJobModel = sm.perJobModel || {};
  const jobs = opts.jobs || sm.jobs || JOB_NAMES;
  const byJob = {};
  let total = 0;

  for (const name of jobs) {
    if (!JOB_NAMES.includes(name)) continue;
    const model = perJobModel[name] || 'sonnet';
    const rate = MODEL_RATES[model] ?? MODEL_RATES.sonnet;
    const invocations = DEFAULT_INVOCATIONS_PER_MONTH[name] ?? 0;
    const tokensEach = DEFAULT_TOKENS_PER_INVOCATION[name] ?? 0;
    const monthlyTokens = invocations * tokensEach;
    const cost = (monthlyTokens / 1_000_000) * rate;
    byJob[name] = {
      invocations,
      tokens: monthlyTokens,
      model,
      cost: Number(cost.toFixed(2)),
    };
    total += cost;
  }
  return { total: Number(total.toFixed(2)), byJob };
}

/**
 * Wrap an async function with a hard timeout that aborts via AbortController.
 *
 * The wrapped function MUST accept `{ signal }` as its first arg and forward it
 * to any child-process or fetch call so abort actually propagates.
 *
 * @param {(args: { signal: AbortSignal }) => Promise<any>} fn
 * @param {number} ms
 * @param {object} [opts]
 * @param {() => void} [opts.onTimeout]
 * @returns {Promise<{ ok: true, result: any } | { ok: false, timedOut: boolean, error: Error }>}
 */
async function withTimeout(fn, ms, opts = {}) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`withTimeout: invalid timeout ${ms}`);
  }
  const controller = new AbortController();
  let timerId;
  const timeoutPromise = new Promise((resolve) => {
    timerId = setTimeout(() => {
      try { if (typeof opts.onTimeout === 'function') opts.onTimeout(); } catch (_err) { /* */ }
      controller.abort(new Error(`scheduled-mode: job timed out after ${ms}ms`));
      resolve({ ok: false, timedOut: true, error: new Error(`Job timed out after ${ms}ms`) });
    }, ms);
  });

  try {
    const work = (async () => {
      try {
        const result = await fn({ signal: controller.signal });
        return { ok: true, result };
      } catch (err) {
        // If the abort fired, mark as timeout; otherwise it's a regular error.
        if (controller.signal.aborted) {
          return { ok: false, timedOut: true, error: err };
        }
        return { ok: false, timedOut: false, error: err };
      }
    })();
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

/**
 * Token-budget enforcement. Reads a per-day usage log and decides whether the
 * current job is allowed to run.
 *
 * @param {object} usageLog - { [YYYY-MM-DD]: { [jobName]: tokens } }
 * @param {number} dailyBudget - Total tokens allowed per day across all jobs
 * @param {Date|number|string} now - Current time (for testability)
 * @param {string} jobName - Job about to run
 * @param {number} [estimatedTokens] - Pre-flight estimate; defaults from table
 * @returns {{ allowed: boolean, reason: string, usedToday: number, estimated: number, projectedAfter: number }}
 */
function enforceTokenBudget(usageLog, dailyBudget, now, jobName, estimatedTokens) {
  const d = new Date(now);
  if (Number.isNaN(d.getTime())) {
    throw new Error('enforceTokenBudget: invalid "now"');
  }
  const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
  const dayLog = (usageLog && usageLog[key]) || {};
  // F17 (R-379): use explicit Number.isFinite guard so a legitimate 0 isn't
  // collapsed by `|| 0` falsy-fallthrough (per naming-conventions.md).
  const usedToday = Object.values(dayLog).reduce(
    (a, b) => a + (Number.isFinite(Number(b)) ? Number(b) : 0),
    0
  );
  const estimated = Number.isFinite(estimatedTokens)
    ? estimatedTokens
    : (DEFAULT_TOKENS_PER_INVOCATION[jobName] ?? 0);
  const projectedAfter = usedToday + estimated;
  if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
    return {
      allowed: true,
      reason: 'no budget configured',
      usedToday,
      estimated,
      projectedAfter,
    };
  }
  if (projectedAfter > dailyBudget) {
    return {
      allowed: false,
      reason: `daily token budget exceeded (would be ${projectedAfter}/${dailyBudget})`,
      usedToday,
      estimated,
      projectedAfter,
    };
  }
  return {
    allowed: true,
    reason: 'within budget',
    usedToday,
    estimated,
    projectedAfter,
  };
}

/**
 * Build the `gh` CLI argv to update an existing dedup issue (label-scoped) or
 * create a new one if none exists. Pure function — does NOT execute. Caller
 * runs this via execFileSync with explicit env scrubbing.
 *
 * Strategy:
 *   1. List issues with label `wogi/scheduled-${jobName}` (state:open)
 *   2. If one or more exist, UPDATE the most-recent one (`gh issue comment`)
 *   3. If none, CREATE one (`gh issue create`)
 *
 * @param {string} jobName
 * @param {string} body - Markdown body to post
 * @param {object} [opts]
 * @param {string[]} [opts.existingIssueNumbers] - Pre-fetched issue numbers; if
 *   non-empty, returns the UPDATE argv; otherwise the CREATE argv.
 * @param {string} [opts.title] - Title for the create branch
 * @returns {{ mode: 'update'|'create', argv: string[] }}
 */
function updateDedupIssue(jobName, body, opts = {}) {
  if (!JOB_NAMES.includes(jobName)) {
    throw new Error(`updateDedupIssue: unknown job "${jobName}"`);
  }
  const label = `wogi/scheduled-${jobName}`;
  const existing = Array.isArray(opts.existingIssueNumbers) ? opts.existingIssueNumbers : [];

  if (existing.length > 0) {
    // Update path: comment on the most-recent existing labelled issue.
    const issueNumber = String(existing[0]);
    return {
      mode: 'update',
      argv: ['issue', 'comment', issueNumber, '--body', body],
    };
  }

  const title = opts.title || `[scheduled] ${jobName} — tracker`;
  return {
    mode: 'create',
    argv: [
      'issue', 'create',
      '--title', title,
      '--body', body,
      '--label', label,
    ],
  };
}

/**
 * Classify an error as transient (worth retrying once) vs permanent.
 *
 * Transient: network blip, gh rate-limit, ETIMEDOUT, ECONNRESET, EAI_AGAIN.
 * Permanent: anything else — config error, auth fail, file not found.
 *
 * @param {Error|null|undefined} err
 * @returns {boolean}
 */
function isTransientError(err) {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  const code = (err.code || '').toString();
  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE'].includes(code)) {
    return true;
  }
  if (/rate.?limit|temporar(y|ily)|timeout|network|reset by peer/i.test(msg)) {
    return true;
  }
  return false;
}

// F20 (R-379): removed `yesterdayIsoDate(now)` — exported but never imported
// anywhere in scope. The runner uses `git log --since="24 hours ago"` for
// CI-portability reasons (shallow checkouts don't have reflog state for
// `@{yesterday}`), and no other consumer wants the ISO-date form. Removed
// to avoid a maintenance-trap export. Re-add if a real consumer materializes.

module.exports = {
  JOB_NAMES,
  MODEL_RATES,
  ALLOWED_MODELS,
  DEFAULT_JOB_TIMEOUT_MS,
  TRANSIENT_RETRY_DELAY_MS,
  DEFAULT_TOKENS_PER_INVOCATION,
  DEFAULT_INVOCATIONS_PER_MONTH,
  clearStaleMarkers,
  loadHeadlessProfile,
  projectMonthlyCost,
  withTimeout,
  enforceTokenBudget,
  updateDedupIssue,
  validateModelName,
  isTransientError,
};
