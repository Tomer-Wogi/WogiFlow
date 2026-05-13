# Scheduled / Background Mode (Phase 1A)

Continuous, **read-only**, background-mode quality signal for WogiFlow projects.
Phase 1A of `epic-quality-loop` (task `wf-b211a076`).

WogiFlow's review/audit/regression skills produce high-quality signal *only*
when a developer is actively in a Claude Code session. Scheduled mode closes
that loop by running designated `/wogi-*` commands on a cadence and reporting
findings as GitHub Issues / PR-comments — **never auto-merges, never edits
rule files, never pushes commits**.

## The four jobs

| Job | Schedule (UTC) | What it does | Posts to |
|-----|---------------|--------------|----------|
| `nightly-regression` | `0 3 * * *` (daily 03:00) | Wraps `scripts/flow-step-regression.js`. Skipped on empty 24h diff. | `wogi/scheduled-nightly-regression` labelled issue (silent on green) |
| `weekly-audit`       | `0 9 * * 1` (Mon 09:00)  | Headless `claude -p` running `/wogi-audit`. | `wogi/scheduled-weekly-audit` labelled issue |
| `weekly-digest`      | `0 17 * * 5` (Fri 17:00) | Headless `claude -p` running `/wogi-debt` + `/wogi-gate-stats --since=7d`. | `wogi/scheduled-weekly-digest` labelled issue |
| `per-pr-review`      | on every PR event        | `claude ultrareview <PR>` headless variant. | PR comment via `gh pr comment` |

## Setup

### Option A — GitHub Actions (recommended)

The workflow lives at `.github/workflows/wogi-scheduled.yml`. To enable:

1. Set `scheduledMode.enabled: true` in `.workflow/config.json`.
2. Ensure your repo has these secrets:
   - `ANTHROPIC_API_KEY` — for headless `claude -p` invocations
   - `GITHUB_TOKEN` — auto-provided by Actions (no setup needed)
3. The workflow runs automatically on its cron schedule and on every PR.

### Option B — Local scheduler

For users who don't want GH Actions, `flow schedule install` writes
platform-native unit files:

```bash
# macOS — LaunchAgent plists in ~/Library/LaunchAgents/
flow schedule install --target=launchd

# Linux — systemd --user units in ~/.config/systemd/user/
flow schedule install --target=systemd
# then activate:
systemctl --user enable --now wogi-scheduled-nightly-regression.timer
systemctl --user enable --now wogi-scheduled-weekly-audit.timer
systemctl --user enable --now wogi-scheduled-weekly-digest.timer

# Any Unix — crontab fragment
flow schedule install --target=cron
# then activate:
(crontab -l 2>/dev/null; cat ~/.config/wogi-flow/crontab-fragment) | crontab -

# Inspect what's installed
flow schedule status

# Remove
flow schedule remove --target=launchd|cron|systemd
```

Use `--dry-run` on `install` to preview the unit files without writing them.

## Cost projection (dry-run mode)

Before enabling, run a dry-run to see projected monthly USD spend:

```bash
node scripts/flow-scheduled-runner.js weekly-audit --dry-run
```

Output:

```
scheduled-runner: DRY-RUN (job=weekly-audit, model=sonnet)
Projected monthly cost across all configured jobs: $XX.XX

Per-job:
  nightly-regression     haiku    30× 1,200,000 tok → $1.50
  weekly-audit           sonnet   4× 600,000 tok → $3.60
  weekly-digest          sonnet   4× 120,000 tok → $0.72
  per-pr-review          opus     20× 1,600,000 tok → $48.00
```

(Numbers are conservative estimates for budgeting. Actual billing varies.)

## Configuration

In `.workflow/config.json`:

```json
{
  "scheduledMode": {
    "enabled": false,
    "dailyTokenBudget": 5000000,
    "perJobModel": {
      "nightly-regression": "haiku",
      "weekly-audit": "sonnet",
      "weekly-digest": "sonnet",
      "per-pr-review": "opus"
    },
    "dryRun": false,
    "jobs": ["nightly-regression", "weekly-audit", "weekly-digest", "per-pr-review"]
  }
}
```

| Key | Meaning |
|-----|---------|
| `enabled` | Master switch. Default `false`. |
| `dailyTokenBudget` | Cap across all jobs for a single calendar day. When projected total would exceed, remaining same-day jobs no-op with a logged warning. |
| `perJobModel` | Model used per job. Allowlist: `haiku`, `sonnet`, `opus`. |
| `dryRun` | Force every invocation into dry-run mode. |
| `jobs` | Subset of jobs to include in cost projections. |

## Read-only-by-default invariants

These are non-negotiable. Enforced both by the runner code and by static-grep
tests in `tests/flow-scheduled-runner.test.js`:

1. **No `git push` to non-bot refs.** The runner never calls
   `git push origin master`/`main`.
2. **No `gh pr merge`.** The PR-review job posts comments only.
3. **No edits to `.workflow/state/decisions.md`.** Rule files are sacrosanct.
4. **Default-branch only.** The runner detects `origin/HEAD` and records the
   current branch in the audit trail. The temp worktree (invariant #5) is
   created on the default branch regardless, so accidental developer-branch
   leakage cannot reach scheduled execution.
5. **Temp worktree (real, hard-enforced).** All work happens in an isolated
   worktree created via `scripts/flow-worktree.js → runInWorktree()`. If
   worktree creation fails, the runner opens a `wogi/scheduled-failure` issue
   and exits non-zero — it does NOT silently fall back to the user's working
   dir. (Fixed in R-379 / F2; prior versions had the claim in the JSDoc only.)

## Safeguards in detail

| Safeguard | Where |
|-----------|-------|
| 10-minute hard timeout per job | `lib/scheduled-mode.js → withTimeout()` + `AbortController` |
| Retry-1×-then-alert with 30s backoff | `scripts/flow-scheduled-runner.js → runJobWithRetry()` |
| Token-budget cap | `lib/scheduled-mode.js → enforceTokenBudget()` |
| Dedup labelled issue (no spam) | `lib/scheduled-mode.js → updateDedupIssue()` |
| Silence on green | `runNightlyRegression()` exits without posting if all pass |
| Skip on empty 24h diff | `hasDiffSinceYesterday()` uses `git log --since=24 hours ago` |
| Stale-marker clearing | `clearStaleMarkers()` removes `routing-pending.json` + `pending-question.json` before each invocation |
| Failure alerts | `openFailureIssue()` creates a `wogi/scheduled-failure` issue with captured stderr |

## Kill-switch

```json
{ "scheduledMode": { "enabled": false } }
```

Or, for the GH Actions path: disable the workflow in **Actions → Workflows →
"Wogi Scheduled Quality Loop" → Disable workflow**.

Local schedulers: `flow schedule remove --target=<target>`.

## Troubleshooting

**Q: The nightly-regression job posts every night even though tests pass.**
A: Check the dedup label `wogi/scheduled-nightly-regression`. Silence-on-green
   only suppresses posts when `result.passed === true`. Check the issue body
   to see what failed.

**Q: My GH workflow is hitting the 10-min timeout.**
A: Per-job timeout is set in `lib/scheduled-mode.js` as
   `DEFAULT_JOB_TIMEOUT_MS`. Either raise it (caveat: cost), or split the
   job (e.g. run audit on a subset of files via `--scope=`).

**Q: How do I see what's currently scheduled locally?**
A: `flow schedule status` returns a JSON blob with all installed units across
   launchd / cron / systemd.

**Q: How does `--dry-run` differ from `enabled: false`?**
A: `enabled: false` makes the runner exit 0 immediately without any output.
   `--dry-run` runs the projection logic and prints `$/month` — useful for
   previewing before flipping `enabled` to `true`.

**Q: What about non-GitHub repos (GitLab, Bitbucket)?**
A: Phase 1A is GitHub-specific (uses `gh` CLI for dedup issues). Multi-host
   support is out-of-scope; can be added in a future phase if needed.

## Architecture

```
.github/workflows/wogi-scheduled.yml   ← cron triggers + permissions matrix
        │
        ▼
scripts/flow-scheduled-runner.js       ← entry point (timeout, retry, budget)
        │
        ▼
lib/scheduled-mode.js                  ← pure helpers (CLI-agnostic)
        │
        ▼
scripts/flow-step-regression.js        ← existing nightly-regression target
        │     (UNMODIFIED — runner wraps it)
        ▼
claude -p --model=<X> /wogi-audit      ← for weekly-audit / weekly-digest / PR-review
```

The runner follows the hook three-layer pattern: business logic in
`lib/scheduled-mode.js` (CLI-agnostic, exhaustively unit-tested), thin entry
point in `scripts/flow-scheduled-runner.js`, no transformation needed for
its single consumer (CLI / GH workflow).

## Out of scope (Phase 1A)

- **Auto-fix / auto-merge** — by design. Phase 1A is read-only.
- **Multi-repo aggregation** — single repo per workflow file.
- **Cross-runner state** — each job is independent. The usage log is the only
  shared state and is keyed by day, not by run.
- **Custom job definitions** — the four jobs are fixed. Adding a fifth
  requires code + a new entry in `JOB_NAMES`.
