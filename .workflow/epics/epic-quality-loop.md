# Epic: Continuous Code-Quality Initiative

**ID**: `epic-quality-loop`
**Created**: 2026-05-13
**Goal**: Raise WogiFlow's code-quality output by adding (a) always-on, read-only quality signal generation without an interactive session, (b) a portable open-standard skill export, (c) pluggable execution backends for reproducible validation/regression runs, and (d) a data-driven gate-miss → rule-proposal loop. All net-additive, all human-in-loop preserved at every decision boundary.

## Overview
<!-- PIN: overview -->
WogiFlow today produces high-quality code-review and audit signal *only when a developer is actively in a Claude Code session*. The signal infrastructure exists (`/wogi-audit`, `/wogi-debt`, `/wogi-gate-stats`, the regression-suite discipline) but is purely on-demand. Between active sessions there is **no continuous quality baseline** — gate-miss rates aren't watched, regressions aren't detected until a developer notices, audit findings aren't surfaced unless someone runs the command, and rule proposals only happen when a human notices a pattern.

This epic closes that loop in four phases, each with a hard **read-only-by-default** constraint:

1. Scheduled / background mode that runs designated `/wogi-*` commands on a cadence and reports findings as Issues / PR-comments — never auto-merges, never edits rule files.
2. Portable skill export to the agentskills.io open standard *and* the Claude Code plugin format, opening our catalog to the broader ecosystem.
3. Pluggable execution backends (Local + Docker) so the scheduled regression/validation runs are reproducible across machines.
4. An offline `harness-suggest` command that turns gate-miss telemetry + feedback-patterns evidence into Markdown rule-proposals, reviewed via the existing `/wogi-decide` flow.

## Success Metrics
<!-- PIN: success-metrics -->
- [ ] Phase 1A live: weekly `/wogi-audit` + nightly regression-suite + per-PR `claude ultrareview` running on schedule, posting reports as Issues / PR-comments; zero auto-merges; token spend within `dailyTokenBudget`.
- [ ] Phase 1B live: at least 2 portable WogiFlow skills published to agentskills.io and as Claude Code plugins; portability checker prevents accidental export of non-portable skills.
- [ ] Phase 2 live: `executionBackend.scopes` config supports `["regression","scheduled"]` opt-in; Docker driver passes the same contract tests as the Local driver; `wogiflow-runner` base image published; PostToolUse lint **unchanged** (host execution, no perf regression).
- [ ] Phase 3 (only after 4-week re-eval): `flow harness-suggest --since=7d` produces a dual-model-agreed Markdown proposal report; acceptance rate ≥30% over the first 10 runs.

## Phases (sequenced — each phase is its own L1 story)
<!-- PIN: phases -->

### Phase 1A — Scheduled / background mode (read-only-by-default) — `wf-b211a076` [P1, READY]
Ship `.github/workflows/wogi-scheduled.yml` + `flow schedule install --target=launchd|cron|systemd`. Default schedule:
- **Nightly**: regression-suite (`scripts/flow-step-regression.js`); skipped if `git diff @{yesterday}..HEAD` is empty.
- **Weekly Mon 09:00**: `/wogi-audit` via headless `claude -p`.
- **Weekly Fri**: `/wogi-debt` + `/wogi-gate-stats --since=7d` digest on a pinned tracker issue.
- **Per-PR**: `claude ultrareview <PR>` (Claude Code 2.1.120 headless variant).

**Safeguards**: per-job model override (Sonnet for digests, Opus only for PR review); `scheduledMode.dailyTokenBudget` cap; first-run-as-dry-mode prints projected $/month; one persistent issue per job that gets updated (no spam); silence-on-green default; headless config profile disables interactive-only gates; runner clears `routing-pending`/`pending-question` markers before each invocation; 10-min hard timeout → kill+alert; retry-1× on transient failure then `wogi/scheduled-failure` issue; runs only on **default branch in a temp worktree** — never touches dev's working dir; **never** auto-merges, never `git push`, never edits `decisions.md`.

### Phase 1B — Skill export (agentskills.io v1 + Claude Code plugin format) — `wf-0342fc33` [P2, READY]
- Add `portable: true|false` to skill manifests; default `false`.
- Portability checker: grep skill content for WogiFlow-specific path strings; refuse export if found (fail-loud).
- `flow skills export <name> --format=agentskills@v1`.
- `flow skills export <name> --format=claude-plugin` (uses `claude plugin tag`, Claude Code 2.1.118).
- Contract test in CI validates output against agentskills.io schema.
- Identify + publish 2–3 portable skills (likely `commit`, `figma-analyzer`, one doc-gen skill) as proof.
- **Import deferred** to a follow-up post-security-model design (quarantine + content scanner + opt-in enable).

### Phase 2 — Pluggable execution backends (Local + Docker driver) — `wf-f251e94b` [P2, BLOCKED on 1A]
- Add `RunnerBackend` interface; refactor `scripts/hooks/core/validation.js runValidationCommand` and `scripts/flow-step-regression.js` behind it. Local driver = current `execFileSync` behavior (contract-test-verified faithful).
- Docker driver: warm `docker exec` pool (NOT `docker run` per call); RW bind-mount + separate writable cache volume; non-root container user; `--rm` cleanup.
- **`executionBackend.scopes` config**: opt-in per scope. Default `[]` (zero behavior change). Allowed: `regression`, `scheduled`, `wogi-test`. **PostToolUse lint is NOT in the scopes list and MUST NOT be containerized by default** — container-startup overhead × per-edit-frequency = unacceptable perf regression.
- Capability detection: if `docker info` fails → fall back to `local` with logged warning. Non-fatal.
- Ship `wogiflow-runner` base image (claude + gh + node + npm + git), version-tagged. Users extend via Dockerfile.
- `flow doctor --check=runners` for stale-container cleanup (parallels `cleanupStaleWorktrees`).

### Phase 3 — Offline `harness-suggest` (gate-miss → rule-proposal loop) — `wf-1780240a` [P3, BLOCKED on 4-week data]
- `flow harness-suggest --since=7d`.
- Algorithm: gate-telemetry stats → for each gate with `miss_rate > 10%`, pull miss instances → grep `feedback-patterns.md` for same-period entries → feed *that specific bundle* (not the whole files) to an LLM with structured-output prompt requesting either a specific rule-change (with cited evidence) or explicit "no actionable pattern."
- **Dual-model adversarial pass**: run on two different models; surface only proposals both agree on.
- Suggestions may **delete/modify/loosen** existing rules, including over-firing gates. (The `research-required-gate` over-fire on "why are" in forward-justification context, observed during this initiative's planning session, is exactly the class of issue this loop should catch.)
- Output: Markdown report with citations; reviewed via `/wogi-decide`.
- Acceptance-rate metric in `.workflow/state/harness-suggest-history.json`; <30% over 10 runs → ship `harness-suggest tune` mode.
- **Re-evaluation checkpoint**: after Phase 1A+2 produce 4+ weeks of clean signal, decide proceed-or-defer.

## Adversarial-pass results (2026-05-13)
<!-- PIN: adversarial-pass -->

Each phase ran 7–8 sharp challenges focused on regression-introduction + "is this the best way?":

| Phase | Confidence | Key adjustments forced by the challenges |
|---|---|---|
| 1A | **92%** | Token-budget cap, dedup, silence-on-green, headless config profile, default-branch-only |
| 1B | **88%** | Import deferred, `portable:` field + checker, Claude Code plugin path folded in |
| 2  | **86%** | `executionBackend.scopes` opt-in; **never containerize PostToolUse lint**; warm exec pool; base image |
| 3  | **83%** | Dual-model adversarial; optimizer may critique gates themselves; explicit acceptance-rate metric |

All four pass the regression-introduction check. All four are net-additive in code-quality terms.

## Cross-cutting invariants
<!-- PIN: invariants -->

1. **Read-only-by-default**: no phase auto-merges, auto-edits rule files, or pushes commits.
2. **Human-in-loop preserved at every decision boundary**: scheduled-mode reports → human review; `harness-suggest` proposals → `/wogi-decide` review.
3. **No interface contract breakage**: all phases add NEW config keys / commands / state files. Zero changes to exports, hook payload shapes, `ready.json` / `config.json` / `decisions.md` formats. **No `partner-versions.json` bump. No `wogiflow-cloud` impact.**
4. **Cheap rollback per phase**: workflow disable / CLI subcommand removal / config flip to default.

## Out of scope
<!-- PIN: out-of-scope -->

- **Model-agnosticism** — WogiFlow lives inside Claude Code; hybrid mode is as far as we go.
- **agentskills.io *import*** — deferred post-security-model.
- **Full automated harness optimizer** (DSPy-style) — deferred until Phase 3 demonstrates ≥30% acceptance rate on its lighter `harness-suggest` form.

## Sequencing
<!-- PIN: sequencing -->

```
Phase 1A ─┬─→ Phase 1B (parallel-OK with 1A)
          └─→ Phase 2 ─→ [4-week data window] ─→ Phase 3 (or defer indefinitely)
```

## Evidence anchors
<!-- PIN: evidence -->

- `scripts/hooks/core/validation.js:120` (current `execFileSync` validation — the seam Phase 2 refactors behind `RunnerBackend`)
- `scripts/flow-worktree.js:195,398,427` (`createWorktree`, `cleanupStaleWorktrees`, `runInWorktree` — pattern for the Docker driver's lifecycle)
- `lib/skill-registry.js:27-32` (current `Wogi-Git/wogi-flow-skills` registry — Phase 1B adds export *alongside*, doesn't replace)
- `.workflow/state/feedback-patterns.md` (324 lines) + `decisions.md` (161 lines) — Phase 3 input corpus
- `scripts/flow-gate-telemetry.js` — Phase 3 miss-rate signal source
- `.github/workflows/publish.yml` — currently the *only* GH workflow; Phase 1A adds `wogi-scheduled.yml` alongside
- `scripts/flow-step-regression.js` — Phase 1A nightly runner; Phase 2 wraps it in `RunnerBackend`
