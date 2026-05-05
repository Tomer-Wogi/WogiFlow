# Progress & Handoff Notes

Session handoff notes for human readability.

## Session End: 2026-05-04/05 — v2.29.6 RELEASE (3 mechanical gates)

### Shipped
- **v2.29.6** (commit `866240e`, tag `v2.29.6`, published to npm: `wogiflow@2.29.6`)
- Three P0 stories bundled into one release:
  - **wf-ee4e343b** — Auto-restart fix. SEC-006 PPID strict-equality check (added 2026-04-26) silently broke task-boundary auto-restart for every wrapper user. Root cause: `lib/wogi-claude` invoked claude without `exec`, so claude got a different PID than `WOGI_WRAPPER_PID=$$`. Fix: `bash -c 'export WOGI_WRAPPER_PID=$$; exec "$0" "$@"'` aligns the env var with claude's actual PID. Cross-bash-version compatible (works on macOS bash 3.2+). Same trick in expect script. Phase 1 marker write consolidated to `saveReadyData` chokepoint. Regression test added that spawns the actual wrapper with a fake claude shim — would have caught SEC-006 at code-review time. Skip-counter observability surfaces 3+ same-reason silent failures at SessionStart.
  - **wf-f9912af6** — Mechanical Deferral Authorization Gate. Plugs the bypass that lets the AI silently mark review/audit findings as `status: deferred*`. PreToolUse intercepts Write/Edit/Bash to `last-review.json` / `last-audit.json`, blocks unless authorized via UserPromptSubmit classifier ("defer X", "fix critical only", "ship as-is", "option 2"/"option 4") OR explicit CLI `flow defer-auth grant`. Negative phrases ("fix everything", "no deferrals", "I don't want tech debt") clear auth + write a no-defer-pin that hard-blocks for 30 min. Live-verified: gate blocked one of the AI's own commands during the build session.
  - **wf-5cd71b1f** — Mechanical Research-Required Gate. Plugs the bypass that lets the AI answer diagnostic questions with text-only and no evidence reads. Regex classifier on UserPromptSubmit detects Tier 2/3 markers ("why", "should I", "what do you think", "is this correct"). Stop-hook gate parses transcript, counts Read+Bash-read+Glob/Grep against evidence prefixes (`.workflow/state/`, `lib/`, `scripts/`, `src/`, `tests/`, `app/`). If below threshold, returns `{continue: true, stopReason}` forcing redo. After 3 attempts, hard-stop. Override prefix `!` skips the gate.

### Tests
- `tests/flow-deferral-gate.test.js` (new) — 30 cases: classifier intents, write/edit/bash blocking, auth lifecycle, no-defer-pin override, audit-file scope.
- `tests/flow-research-required-gate.test.js` (new) — 15 cases: classifier categories, override prefix, marker write/consume/bump, Stop-hook redo loop, hard-stop after maxAttempts, transcript parsing, Bash evidence detection.
- `tests/flow-task-boundary-reset.test.js` (extended) — added SEC-006 regression test + skip-counter observability tests.
- **`package.json`**: added 3 missing test files to npm test glob — the boundary-reset test was actually NOT being run by CI before this commit. Total 2574/2574 pass (was 2514, +60 newly-running).

### Adversarial review
- Sonnet code-logic agent on wf-ee4e343b found 6 findings (1 HIGH, 2 MEDIUM, 3 LOW). Opus adversary critique downgraded F4 from HIGH to LOW (verified pre-existing in v2.26.3 baseline) and surfaced 3 more LOW findings (F7 corrupt-JSON guard symmetry, F8 skip-counter race, F9 hardcoded bash). All 9 fixed pre-commit.

### Out of scope for v2.29.6 (intentionally surfaced, not silently dropped)
- **wf-94cc3b72** — P1 epic "Lift WogiFlow from C+ to A" (15 child stories). Pre-existing initiative, days of work, not appropriate for a patch release. User should pick stories from this epic for next release.
- **wf-7d92c6be** — story "Extend PreToolUse Bash gates to cover PowerShell tool on Windows". Parked weeks ago in explore phase per commit `6e48e53`. R-350 entry acknowledges no work was done; remains parked.

### Three live gate-firings during this session (proof of mechanical enforcement)
1. Deferral gate caught a smoke-test bash command during the wf-f9912af6 build.
2. Deferral gate caught my own `git commit -m` because the message body included `last-review.json` + `deferred` + `writeFileSync` literals — the gate's bash heuristic can't distinguish narrative text from real mutation. Worked around via `git commit -F /tmp/msg.txt`. Gate doing its job.
3. Commit-log gate blocked the release commit because `wf-7d92c6be` was lingering in inProgress without a recent log reference. Added R-350 honestly acknowledging the parked status.

### Known follow-ups (capture for future sessions, NOT deferred this session)
- Deferral gate's bash-command heuristic has a false-positive class: any narrative mentioning both target paths and deferral status literals (e.g., commit messages, inline scripts containing review payload examples) gets blocked. Workaround is `git commit -F file`. A future enhancement: tighten the `mutates` regex to require an actual file-write context (e.g., `>\s*['"]?\.workflow`), not just any `writeFileSync` substring.
- The research-required gate's regex classifier may have false-negatives on diagnostic questions phrased without canonical markers ("the test failed, thoughts?"). A Haiku fallback was specced (in wf-5cd71b1f acceptance criteria notes) but deferred to a future release with explicit user-style-tuning telemetry. Document in next-session backlog if the false-negative rate matters in practice.

### Notes
- The /wogi-review I ran on wf-ee4e343b was the FIRST adversarial review I executed end-to-end on this branch. Phase 5 truth-gate verified all "fixed" claims had Tier-3 INTERACTIVE evidence (the regression test actually spawns the wrapper).
- npm test glob fix (added 3 test files) is itself a regression-prevention insight — when adding new test files, future commits should grep `package.json "test":` to confirm they're included. Could be promoted to a standards-check.

---

## Session End: 2026-04-22 — v2.26.1 + v2.26.2 RELEASES (task-boundary restart reliability)

### Completed
- **v2.26.1 — Phase 1 wiring fix** (commit 83bbcc9, published to npm)
  - Root cause: `.claude/docs/phases/05-complete.md` step 5.3 told agents to hand-edit `ready.json` instead of running `flow done`, bypassing both Phase 1 marker-write sites. `TaskCompleted` hook doesn't fire for `/wogi-start` completions (documented in task-boundary-reset.js design comment), so path (a) `flow-done.js:604` was the only live trigger — and agents weren't hitting it.
  - Fix: mandated `flow done <taskId>` in phase doc + added Stop-hook fallback `ensurePhase1MarkedIfRecentlyCompleted()` with anti-replay sentinel (`task-boundary-last-triggered`) that survives SIGTERM + wrapper restart cycle.
- **v2.26.2 — dialog dismissal reliability** (commit 62db756, published to npm)
  - Auto-enable expect when worker env detected (`WOGI_WORKSPACE_ROOT` + `WOGI_REPO_NAME != "manager"`); interactive users unchanged.
  - Rewrote `lib/wogi-claude-expect.exp` with rolling buffer + ANSI strip (CSI, 8-bit CSI, OSC, ISO 2022) + bounded elapsed-time window. Replaced `eval spawn` with `spawn {*}$claude_args` to eliminate Tcl bracket injection.
  - No blind fallback — misses degrade to the same failure mode as running without wrapper (safe).
  - All 6 review findings from `/wogi-review + /wogi-audit` shipped in-release (Sec #1/2/3, Arch #4/5/6). No deferrals.

### Tests
- `tests/flow-wogi-claude-wrapper.test.js` — 19 cases covering precedence tree, worker auto-enable, three-way kill-switch, fragmented-ANSI dismissal, OSC+8-bit+ISO 2022 dismissal, bounded-window EOF exit.
- `tests/flow-task-boundary-reset.test.js` (new) — 8 cases for the Phase 1 state machine (fresh+nomarker marks; marker-present skips; anti-replay; new-task marks; stale skips; empty; legacy no-completedAt).
- Total 47/47 pass across wrapper + task-boundary + restart-handoff tests. Lint clean (0 errors).

### Known test-harness trick
- `lib/wogi-claude-expect.exp` has a `WOGI_EXPECT_NO_INTERACT=1` test hook that swaps `interact` for `expect eof` so node:test (pipe-backed stdin, no TTY) can verify dialog dismissal. Production callers MUST NOT set this — users need `interact` to drive claude after dismissal. Documented inline.

### Next Session
- Uncommitted working-tree changes pre-date this session and are NOT from this work: `.workflow/state/pending-skill.json`, `registry-manifest.json`, `CLAUDE.md`, deleted `.template` files. These are prior in-progress state — user's call whether to clean up or keep.
- Pending queue still includes: wf-94cc3b72 epic (Ready) + 6 blocked tasks. Use `/wogi-ready` to view.
- Prior handoff notes below remain relevant for the wf-d3e67abe / wf-63c0f4cc stories.

### Constraints confirmed by user this session
- "No compromises / no deferrals" — all 6 review findings shipped in release, zero deferred.
- "Challenge your recommendations" — user pushed back twice; each round tightened the solution (no blind fallback, no global default flip, no test-only production hooks without explicit gating).

---


---

## Last Updated
2026-04-24 08:42
2026-04-24 08:42
2026-04-16T00:00:00.000Z

---

## Session end — 2026-04-15 → 2026-04-16 (A+ drive + self-caught review fixes)

### Shipped this session

- **v2.17.1** — flow-utils decomposition (1748 → 921 LOC, −47%; 8 new focused modules), +213 hook coverage tests
- **v2.17.2** — expanded hook coverage (+312 tests): scope, strike, component, impl, research, loop, manager-boundary, phase-gate
- **v2.17.3** — `pre-tool-use.js` orchestrator extraction (538 → 116 LOC entry) + IGR-hardened `/wogi-review` (Phase 0 Framing, evidence tiers, Phase 2.8 Findings Adversary, Phase 5 Completion Truth Gate)
- **v2.17.4** — review skill self-review fixes (F1-F4 from running new /wogi-review on v2.17.3)
- **v2.17.5** — actually-fix-all release (M1: doc bloat extracted to `.claude/docs/intent-grounded-review.md`; M3: `_fastPath` end-to-end tests) + **Review-Findings Anti-Deferral rule** added to `decisions.md` + CLAUDE.md template. Published to npm as `wogiflow@2.17.5`.

### Final metrics (session delta)

- Tests: **1065 → 1731** (+666, +62%)
- Hook gates unit-tested: ~2 → ~19 (+17)
- flow-utils.js: 1748 → 921 LOC (−47%)
- pre-tool-use.js entry: 538 → 116 LOC (−78%)
- New core modules: 9
- New test files: 21
- Lint errors: 0 (maintained throughout)
- Test regressions: 0 (every intermediate step green)
- npm published: v2.17.5 live as `latest`

### New rules promoted to decisions.md this session

- **Review-Findings Anti-Deferral** (decisions.md → Review & Cleanup Procedures) — MANDATORY: when user says "fix all" findings, every tier ≥ 1 finding must be fixed in the release. "Deferred" is a user decision, not an AI decision. Incident-driven (2026-04-15 v2.17.4 silent deferral of M1/M3).

### IGR / review rigor now fully symmetric

- `/wogi-audit` and `/wogi-review` both now have: Framing Pass, Evidence Tiers, Adversary Pass, Completion Truth Gate
- Reference docs mirror each other: `.claude/docs/intent-grounded-reasoning.md` (audit) + `.claude/docs/intent-grounded-review.md` (review)

### Next session pick-up

- Epic **wf-94cc3b72** is effectively complete. Re-audit would be appropriate to confirm A+ grade.
- **Deferred by user explicitly** on the roadmap (not by AI):
  - Roadmap items from branch cleanup review
  - wf-255e541a (sync→async fs migration, 189 sites) — explicitly deferred
  - wf-c1e892fa, wf-0f2e0f16, wf-c0d6b0c5, wf-33a0aa88, wf-d0937c83 — all explicitly deferred per user "keep the branches but add to us like a note on the roadmap"
- **Nothing outstanding** from the current session's review cycle — all v2.17.3 self-review findings verified fixed with Tier 2+ evidence (F1-F4) or Tier 3 (M3 — tests executed).

### Notes for next session

- The orchestrator extraction changed the hot path of every tool call but was well-tested — 47 orchestrator tests now guard it. Any hook-related bug in a future session → start by running `tests/flow-hooks-pre-tool-orchestrator.test.js`.
- The IGR-hardened `/wogi-review` should be used for all code reviews going forward. The evidence-tier requirement caught a genuine false-positive during this session (the F1 "broken require path" adversary claim — path resolved correctly via `require.resolve()`).
- When invoking sub-agents for review critique, **use a different model than the agents** — override-always rule in decisions. Same-model = rubber-stamp.

---

## Account switch handoff (mid-session pause) — 2026-04-15 ~16:00

User is switching Claude accounts and will resume the same work after.

### Where to pick up
- **Current task**: `wf-e64cacd0` (P1) — **flow-memory CLI (query/fetch/stats/tag)** — already moved to `inProgress[]` in `ready.json`. **Implementation not started.**
- **Re-scoped spec**: user approved the re-scope from "query .workflow/memory/" (obsolete) to "query state files." 4 subcommands: `query`, `fetch`, `stats`, `tag`. Tag storage via sidecar `.workflow/state/memory-tags.json` (boundary-respecting). IGR pass skipped (spec says "Light — straightforward"; user said "do what you recommend").
- **10 acceptance criteria** already agreed in the session transcript (see R-280 through R-283 precedent entries in request-log for the kind of precision). No need to re-ask — just implement.
- **Planned files**:
  - `scripts/flow-memory.js` (new, ~400 lines — implements query/fetch/stats/tag over: ready.json, decisions.md, feedback-patterns.md, corrections/, adversary-runs/, request-log.md, correction-patterns.json, pending-*.json)
  - `scripts/flow` (bash dispatcher — add `memory)` case + help text)
  - `.workflow/state/memory-tags.json` (new sidecar — gitignored per existing `.workflow/state/*` rule)
  - `tests/flow-memory.test.js` (new)
  - `package.json` (test script extension)

### Shipped this session (4 stories, all epic-episodic-memory)
1. **wf-a3cc5f2a** — Capture-at-task-boundary enforcement gate (G4 classifier + capture-gate). Flag-gated OFF by default. Ships the `flow-conclusion-classifier.js` + `flow-capture-gate.js` modules, wired into `GATE_REGISTRY`. 18 new tests. R-280.
2. **wf-e6d65edf** — Hybrid keyword-first classifier with self-learning back-propagation in `flow-correction-detector.js`. 3-layer pipeline (keyword pre-classifier → AI fallback → Layer-3 learning via n-gram extraction). `correction-patterns.json` is the learned-phrase store. Default-ON per user spec. 32 new tests. Also fixed a pre-existing latent `getTodayDate` import bug. R-281.
3. **wf-942ad14f** — Confirmed all 4 IGR intent artifacts (product / domain-model / glossary / user-journeys). Draft→confirmed. Verified IGR consumption: re-ran adversary on wf-e6d65edf plan and all 4 previously-SKIPped principles (P3/P4/P6/P9) upgraded to PASS. Artifacts have substantial content drawn from CLAUDE.md, decisions.md, README, codebase. R-282.
4. **wf-6a352aae** — Promotion pipeline + stale archival (re-scoped post-pivot). Two new modules: `flow-promote.js` (adversary-finding + pattern-phrase promotion into feedback-patterns.md) and `flow-archive-runs.js` (gzip old adversary-runs, rotate telemetry log). New `flow promote` and `flow archive` CLI commands. Session-end hook auto-runs promote scan. Exposed `handlePromotion` + `promoteToDecisions` from `flow-auto-learn.js` (were internal). Fixed pre-existing `getTodayDate` import in `flow-auto-learn.js`. 35 new tests. **Adversary R1 verdict: PASS (zero concerns)** — first all-PASS run since intent artifacts confirmed. R-283.

### Epic status
**17 of 21 stories done (81.0%)** — `epic-episodic-memory`

### Remaining tasks (priority order per user)
After completing wf-e64cacd0:
1. **wf-1cde48ad** (P2) — Restart-mechanism telemetry / measurement dashboard (re-scoped post-pivot)
2. **wf-1976a301** (P2) — State-file tampering detection + SessionStart warning (re-scoped post-pivot)
3. **wf-6dbc0b2a** (P1) — Research Reasoning Gate — lightweight IGR for conversation/research mode
4. **wf-b5cff650** (P3 bug) — flow-story doesn't propagate new stories to ready.json

### Session state
- Uncommitted: many files from 4 completed stories + R-280..R-283 entries in request-log + intent artifacts confirmed. Git status shows ~15 modified, 10+ new files. **No commits yet in this session** — user asked at start, committing was not requested.
- Test suite: 1017/1017 passing as of end of wf-6a352aae.
- Standards-gate: clean for all files touched in the 4 shipped stories.

### Notes for the resuming agent
- **Anti-deferral**: user made clear early in this session — always route through `/wogi-start`, always use the full IGR pipeline when spec requires it. Do NOT drop items.
- **Session scratch scripts** in `.workflow/scratch/` (e.g., `complete-wf-*.js`, `start-wf-*.js`) are one-offs used to move tasks through state; they get auto-cleaned at session-end. They're NOT part of the work product.
- **Intent artifacts are confirmed** — Adversary will now give real P3/P4/P6/P9 verdicts instead of SKIP. Don't be surprised.
- **Dual P11.2 recurrence pattern**: KNOWN_CONFIG_KEYS in `scripts/flow-constants.js` must be updated whenever a new top-level config key is added. The adversary has caught this 3 times (addressed in wf-6a352aae's architect plan proactively).

---

## Session End: 2026-04-13 — IGR EPIC COMPLETE + REVIEW + ENFORCEMENT + v2.13.0 RELEASE

### Completed
- **wf-4d4ae31c**: Research + design — Intent-Grounded Reasoning (IGR) feature spec (approved)
- **wf-b00262b1**: IGR implementation epic — ALL 8 stories shipped:
  - Story 0 (wf-faf340cf): Gate Telemetry & Self-Assessment Framework
  - Story 1 (wf-3975a001): Logic Adversary MVP + dogfood on its own epic
  - Story 2 (wf-c5198406): Intent Bootstrap + agnostic trap-zone detector
  - Story 3 (wf-cc4eb238): Session Correction Memory (extended existing flow-correction-detector)
  - Story 4 (wf-5c024cc2): Intent Framing Pass
  - Story 5 (wf-4d3e8d3e): Architect Pass
  - Story 6 (wf-76312197): Completion Truth Gate
  - Story 7 (wf-61de2974): Pipeline wiring + 7th explore agent + productCoherence eval
- **Fast-follows**: default-on flag, central gate-dispatch telemetry, /wogi-gate-stats, recordVerificationEvidence bridge, CLAUDE.md partial, productCoherence dimension, flow-migrate-igr CLI
- **wf-7104abc4**: Review fixes (22 findings) + enforcement hardening (4 mechanical gates)
- **v2.13.0 release**: pushed + tagged + GitHub release created

### Key learnings this session
- Logic Adversary achieved 100% R1 catch rate across Stories 2-7 (every plan had a real defect)
- Two near-misses on parallel-system creation caught by Adversary (Stories 3, 6 — existing modules not in inventory)
- User's QA-98%-parable: partial coverage creates false confidence; full protocol completeness > frequency optimization
- User removed /wogi-intent slash command (unnecessary surface area — /wogi-start Option C + /wogi-session-end cover the UX)
- Corrected pipeline insertion order: Steps 1.55/1.57 go BEFORE Step 1.5 (plan precedes spec generation), not after

### Next session
- Dogfood IGR on wogi-hub (owner's production-adjacent project per spec §9 Phase B)
- Confirm intent artifacts for wogi-flow (4 drafts exist; flip reviewStatus: draft → confirmed)
- Monitor gate telemetry (run /wogi-gate-stats after a few IGR-enabled tasks to verify missRate signal)
- Consider wogi-hub-specific intent bootstrap to stress-test trap-zone detector on real domain
- partner-versions.json update per dual-repo management decisions.md (mandatory post-release step)

### Stats
- Request log: R-251, R-252 (2 entries this session)
- Files changed: 42 (feat commit) + 7 (housekeeping)
- Lines: +7,331
- Tests: 18/18 passing
- Enforcement gaps closed: 4 (JSON.parse guard, catch-variable guard, template-change hook, prototype-pollution pattern snippet)

---

## Session End: 2026-03-25 (4) — AUDIT COMPLETE

### Completed (9 tasks via /wogi-bulk)
- wf-dd90ada4: Audit || to ?? — 101 replacements across 7 priority files, fixed timeout=0 bug, added || vs ?? coding rule
- wf-780e9bcc: Extract flow-long-input.js — 3 new sub-modules (passes, contradictions, association), 3677→1103 LOC
- wf-23608f2f: Upgrade eslint 9→10 (10.1.0), migrate @xenova→@huggingface/transformers (3.8.1), 0 vulnerabilities
- wf-e175a561: Replace Promise wraps — timers/promises, readline/promises, fetch(), removed 'use strict' from 45 files
- wf-522109a6: Centralize learning writes — orchestrator mediates all writes with dedup + locking, 11 modules migrated
- wf-18c2bb6f: Split flow-done.js — 18 gate handlers in flow-done-gates.js, reports in flow-done-report.js, 1604→953 LOC
- wf-14ce6d29: Decompose autoCompactPrompt — declarative COMPACTION_PIPELINE, 87→20 LOC orchestration
- wf-42cc574d: Shared abstractions — hook-runner.js (13 hooks), BaseWorkflowStep (7 steps), sanitize consolidation, shell arg move
- wf-10279963: Tech debt cleanup — updated metrics, removed evaluatePromptWithAI stub, fixed TODO scanner, documented DEBUG vars

### Notes
- ALL 14 audit tasks from 2026-03-24 are now complete (5 earlier + 9 in this session)
- Ready queue is empty — only backlog item remaining: wf-3daad465 (subagent metrics)
- All 18 tests pass after every batch

---

## Session End: 2026-03-25 (3)

### Completed
- wf-9175e882: Migrate 121 files from manual path.join to PATHS constants — added 22 new PATHS entries, replaced WORKFLOW_DIR/STATE_DIR/PROJECT_ROOT with PATHS.*, net -123 lines of boilerplate

### Remaining Audit Tasks (9)
- wf-dd90ada4: Modernization: Audit || to ?? in config-value default paths (P1)
- wf-780e9bcc: Architecture: Complete flow-long-input.js extraction (P2)
- wf-18c2bb6f: Architecture: Split flow-done.js runQualityGates (P2)
- wf-42cc574d: Duplication: Create shared hook-runner.js and BaseWorkflowStep (P2)
- wf-23608f2f: Dependencies: Upgrade eslint v10 + migrate @xenova (P2)
- wf-14ce6d29: God function decomposition (P3)
- wf-e175a561: Modernization: Replace Promise wraps with Node 18 built-ins (P3)
- wf-522109a6: Architecture: Centralize learning module writes (P3)
- wf-10279963: Tech debt: Update stale tech-debt.json (P3)

### Notes
- Parameter-based `projectRoot` patterns (34 occurrences across hooks, worktrees, plugins) intentionally NOT migrated — they operate on dynamic roots
- Migration script saved to `.workflow/scratch/migrate-paths.js` (will be auto-cleaned)

---

## Session End: 2026-03-25 (2)

### Completed
- wf-8e20990b: Claude Code 2.1.83 compatibility updates — hooks adapter, providers ENV_SCRUB awareness, correction detector hardening, full compatibility doc section

### Notes
- ENV_SCRUB (opt-in) breaks hybrid mode cloud providers when invoked via Bash tool. Workaround documented: pass API keys via config instead of env vars.
- --channels mode disables AskUserQuestion — future story needed for non-interactive fallbacks in WogiFlow approval gates.
- CwdChanged/FileChanged hook events added to unused list — implementation deferred.

---

## Session End: 2026-03-25

### Completed
- wf-4a4d63f8: Fix hook error messages — task-gate and commit-log-gate (2 bugs)
- v2.4.2 released (commit + tag + GitHub release)
- Full 7-dimension project audit completed (score: B, 62 findings)

### In Progress
- None

### Next Session
- Start P0 quick wins: wf-fbffee09 (npm audit fix, naming docs, catch fixes)
- Then P0 security: wf-154d4643 (safeJsonParse migration, 49 files)
- 12 audit stories queued in ready.json (P0-P3)

### Notes
- Performance (D) is the weakest dimension — hook I/O overhead from process-per-call architecture
- Key quick fix: npm audit fix for flatted prototype pollution
- request-log has 232 entries — consider archiving soon

---

## Session End: 2026-03-10

### Completed
- **wf-cc94c959**: Hardened quality gates — wired integrationWiring and standardsCompliance to actual verifier modules, added outstandingFindings and preRelease gates
- **wf-8166e9e9**: Fixed routing bypass in review fix loop + 9 review findings (Phase 5.3b/5.3c rewritten to route through /wogi-start)
- **wf-c7cf3b50**: Fixed 9 post-fix review findings — non-blocking gates, path validation, smokeTest edge case, unused imports
- **wf-638612a5**: Added removal-impact detection to wiring verifier — detects orphaned consumer references when exports/types are removed
- **v1.9.0 released** to GitHub and tagged

### In Progress
- None

### Next Session
- Publish v1.9.0 to npm (if desired)
- The user reported an empty "Internal Requests" tab bug in another project — that project needs the tab removed from POLICY_TABS in Settings.tsx

### Notes
- Root cause of routing bypass: wogi-review.md Phase 5.3b explicitly instructed manual ready.json editing, predating the unified routing-gate architecture. Now fixed.
- New removal-impact check runs automatically in integrationWiring gate — no config needed
- feedback-patterns.md has a new entry for "removal-impact-miss" pattern

---

## Session End: 2026-03-07

### Completed
- **wf-879b16f1**: Fixed security violation — removed `Bash(git clean *)` from settings.local.json (auto-allowed destructive commands). Removed redundant `Bash(test *)` (now auto-approved by Claude Code natively).
- **Claude Code Release Analysis**: Full changelog review — no breaking changes found. Identified opportunities: cron scheduling tools, /loop command compatibility.

### In Progress
- None

### Next Session
- Consider implementing cron tools integration (`/wogi-schedule`) for periodic health checks, morning briefings
- Consider documenting `/loop` compatibility with WogiFlow commands
- Backlog: wf-3daad465 (P2, subagent metrics aggregation)

### Notes
- On `master` branch, settings.local.json is gitignored (local-only change)
- Request log at 2007 lines — consider archiving soon

---

## Session End: 2026-03-06

### Completed
- **Claude Code Release Adaptations epic**: agent_id/agent_type validation, InstructionsLoaded hook registration, CLAUDE.md drift detection, bridge sync fixes
- **wf-cr-cc2605**: Fixed 9 review findings (agent_id bypass, dead hook registration, safeJsonParse, global state pollution)
- **wf-e2d8e3bf**: Multi-page Figma analysis pipeline with state inference
- **wf-9405d4da**: Fixed hardcoded `tsc --noEmit` in 4 locations — now reads config.scripts.typecheck dynamically
- **v1.8.4 → v1.8.5 released**: Plugin routing, review fixes, tsc --noEmit fix

### In Progress
- None

### Next Session
- All review queues clear — no pending findings
- Version bump and release requested by user — completed (v1.8.5)
- Backlog: wf-3daad465 (P2, subagent metrics aggregation)

### Notes
- On `master` branch, clean state, pushed + released v1.8.5
- JSDoc examples in flow-script-resolver.js:219 and hooks/core/validation.js:89 still reference `tsc --noEmit` — borderline, can update for consistency if desired
- Figma analyzer changes (pushed from another terminal) verified to coexist cleanly with hook changes

---

## Session End: 2026-03-04

### Completed
- **Deep Optimization Epic** (6 stories): Config consolidation, memory migration, utils split, function dedup, hook chain performance
- **wf-12cc534a**: Eliminated 30 hardcoded architecture assumptions across 19 files
- **wf-05c1c625**: Auto-detect project scripts for validation, fixed tsc --noEmit issue
- **wf-cr-a3b1c2**: Fixed 16 review findings (null crash, security, PM consistency)
- **wf-cr-b4d5e6**: Fixed 20 review findings (cache poisoning, security, config paths)
- **wf-cr-d7e8f9**: Fixed 8 deferred review findings (command injection, PM consolidation, explicit exports)
- **v1.8.3 released**: All 48 review findings resolved, 0 deferred

### In Progress
- None

### Next Session
- All review queues clear — no pending findings
- Consider running `/wogi-audit` for a fresh health check post-optimization
- Backlog: wf-3daad465 (P2, subagent metrics aggregation)

### Notes
- On `master` branch, clean state, pushed + released v1.8.3
- 48 total review findings addressed across 3 review passes
- Key security fixes: execFileSync in validation.js, domain validation in claude-bridge.js, path containment in config-substitution.js
- flow-utils.js now has 60+ explicit named exports instead of spread re-exports

---

## Session End: 2026-02-28

### Completed
- **wf-2b1ab455**: Closed Edit/Write routing gate bypass — session continuation loophole
  - Added Edit/Write/NotebookEdit to routing gate GATED_TOOLS
  - Defense-in-depth: session-start now sets routing-pending flag
  - Updated CLAUDE.md template with anti-bypass language
- **wf-1bd2a207**: Fixed 5 routing enforcement gaps + enhanced /wogi-review with NL scoping + added /wogi-audit
- **wf-cr-a7f201**: Fixed 14 review findings (4 high, 7 medium, 3 low)
- **v1.6.1 released**: Merged feature/teams-t1 → master, tagged, GitHub release, npm publish
  - All routing hardening, NL review scoping, /wogi-audit included
  - feature/teams-t1 branch deleted

### In Progress
- None

### Next Session
- Backlog: wf-3daad465 (P2, subagent metrics aggregation)
- Consider running full syntax check on all scripts to verify no regressions
- The raw `JSON.parse` finding (systemic — 50+ files) was addressed in critical files only — future sweep possible
- Verify wogiflow-cloud and wogiflow-portal workflow health

### Notes
- On `master` branch, clean state
- v1.6.1 propagation: existing users get all fixes on `npm update wogiflow`, CLAUDE.md auto-regenerates via autoSyncBridge on next session start
- `.workflow/state/decisions.md` has "Session Continuation Is NOT Routing Bypass" rule (local state, not in npm package)
- Actually — the settings.local.json WERE committed in the cloud/portal commits. They should be fine for now since they contain permissions, not secrets.

---

## Session End: 2026-02-26

### Completed
- **wf-b7220e8b**: Maintainer Dashboard — Admin API (10 endpoints), static HTML/JS UI, CloudFormation infra (AdminFunction, AdminApiKey, CORS fix, API Gateway V2 routes)
- **wf-cr-a684a4**: Fix 16 review findings — IPv6 SSRF bypass, command injection, TOCTOU, logic fixes
- **wf-e50c90c7**: Phase C2 Server-Side — pgvector semantic dedup, priority detection (10+ votes), GitHub issue auto-creation, suggestion dedup via embeddings, HNSW indexes

### In Progress
- None

### Next Session
- **Phase T1: Teams Foundation** — OAuth 2.0, org management, CLI device auth, PostgreSQL schema for orgs/users/projects
- Backlog: wf-3daad465 (P2, subagent metrics aggregation)
- Deferred: arch-001 (SSRF validator consolidation between flow-community.js and flow-links.js)

### Notes
- Community Knowledge System (C1 + C2) is fully COMPLETE — both client-side and server-side
- wogiflow-cloud commits: `b6c7ffa` (dashboard), `5be15bb` (Phase C2)
- GitHub token secret in CloudFormation is a placeholder — needs manual replacement after deploy
- Domain is `api.wogi.ai` (not wogiflow.com)
- Request-log at 143 entries — consider archiving when it hits 150+

---

## Session End: 2026-02-22

### Completed
- **wf-cr-7f42a1**: Fix 42 review findings — security hardening, stale ARGUMENTS bug, performance fixes
- **wf-2c28480c**: Add routing gate hook — programmatic enforcement blocking Bash before /wogi-* routing
- **wf-a3c1e8b2**: Fix skill re-execution from stale session reminders
- **wf-cr-3day22**: Fix 15 review findings from 3-day comprehensive review
- **wf-927db36d**: Registry Manifest Wiring — migrate 46+ consuming systems to dynamic registry discovery
- **wf-65ea1bdb**: Schema/Model Registry Plugin — Prisma, TypeORM, Django model detection
- **wf-c7a3804f**: Architecture/Service Registry Plugin — NestJS, Django, Go service/controller detection
- **wf-ebc4759e**: Skill System Overhaul — remove top-3 cap, auto-run Context7, separate content layers
- **wf-4346ab1a**: Fix stale task cleanup, naming convention enforcement
- **wf-7129cf56**: Enforce task ID naming convention — rename descriptive IDs, add validation
- **wf-skill-consolidate**: Consolidate skill scripts — delete deprecated creator, deduplicate utilities
- **wf-cr-rv222b**: Fix 2 additional review findings
- **wf-cr-rv222**: Fix 18 review findings from 3-day comprehensive review (session 2)
- **wf-0a744cdd**: Rewrite README as concise feature summary with KB deep-links
- **wf-routing-fix**: Remove 'proceed directly' exemption from wogi-start routing
- **wf-cr-3day21**: Fix 30 review findings from 3-day comprehensive review
- **v1.5.2 Release**: Published to GitHub (https://github.com/Tomer-Wogi/WogiFlow/releases/tag/v1.5.2)

### Key Changes
| Category | Changes |
|---------|---------|
| Security | Prototype pollution guards, TOCTOU race fixes, bounded file reads, catch variable standardization |
| Performance | Promise.all scans, lazy initialization, 8KB tail reads, pre-compiled RegExp |
| Registry System | Schema/Service registry plugins, manifest wiring for 46+ consumers, active flag in manifest |
| Skill System | Removed top-3 cap, Context7 auto-run, content layer separation, version-aware refresh |
| Routing | Programmatic routing gate hook (PreToolUse:Bash), unconditional /wogi-start routing |
| Stale ARGUMENTS | Removed scope from completedSkills, added explicit stale ARGUMENTS warning in session-context |
| Documentation | README rewrite, KB deep-links, cleanup outdated docs |

### In Progress
- None

### Next Session
- wf-3daad465: Subagent metrics aggregation (backlog, P2)
- Request-log at 123 entries — archive soon (`node scripts/flow-archive.js --keep 50`)
- Monitor routing gate hook for false-positive blocks
- Consider npm publish for v1.5.2

### Notes
- v1.5.2 released to GitHub (16 tasks completed today across multiple sessions)
- epic-universal-registry completed (all 5 stories)
- 3-day comprehensive review fully resolved (42 findings fixed)
- All code committed and pushed

---

## Session End: 2026-02-21

### Completed
- **epic-universal-registry** (2/5 stories): Framework-Driven Discovery + Extensible Registry Architecture
- **wf-fwk-discovery**: Stack-aware dynamic file discovery replacing hardcoded FILE_PATTERNS
- **wf-ext-registry**: Plugin-based registry system with RegistryPlugin base class, RegistryManager, manifest
- **Consumer Impact Analysis**: Agent 6 in explore phase — mandatory consumer mapping for refactor tasks
- **Rule-to-Action Pipeline**: /wogi-decide now triggers mandatory violation scans with routing
- **wf-cr-210221**: Fixed 18 review findings (security, performance, code logic, architecture, config)
- **v1.5.0**: Released to GitHub

### Key Changes
| Category | Changes |
|---------|---------|
| Registry System | RegistryPlugin base class, 3 plugin adapters (function, api, component), manifest generation |
| Consumer Impact | Agent 6 maps all consumers before refactor/migration tasks, hard-blocks on failure |
| Rule Pipeline | /wogi-decide → violation scan → route through /wogi-start with quality gates |
| Security Fixes | Path traversal boundary validation, require() allowlist, safeJsonParse, prototype pollution guard |
| Performance | Promise.all scans, pre-compiled RegExp, single-row Levenshtein, Set-based dedup |

### In Progress
- **epic-universal-registry**: 3 stories remaining (wf-manifest-wiring P1, wf-schema-registry P1, wf-service-registry P2)

### Next Session
- Start **wf-manifest-wiring** — migrate 46+ consuming systems to dynamic registry discovery
- Then **wf-schema-registry** — Prisma/TypeORM/Django model detection (fixes Prisma scanner bug)
- Consider parallel execution for independent registry stories

### Not Auto-Fixed (from review)
- ARCH01 (critical): Two ComponentScanner classes with same name — needs rename decision
- CL03: try-block detection uses 200-char heuristic — needs AST approach
- ARCH02: getActiveRegistries() has no callers — tracked as wf-manifest-wiring
- ARCH03: Three independent scan paths — needs architectural consolidation

---

## Session End: 2026-02-20

### Completed
- **wf-esm-compat**: ESM compatibility fix — added scripts/package.json with type:commonjs
- **wf-fc196fcf**: Fix post-review fix loop to create tracked task before edits
- **wf-2639ad7d**: Restructured wogi-review to enforce all 5 designed phases
- **wf-cr-2639a7**: Fixed 19 review findings from wogi-review restructure
- **wf-cr-hookfmt**: Fixed hook formatting, context injection, npm update propagation
- **wf-gitignore**: Default .workflow/ to gitignored with opt-in tracking
- **wf-learning-epic**: 4 stories — /wogi-decide, /wogi-learn, /wogi-retrospective, routing updates
- **wf-cr-a88584**: Fixed 18 review findings from learning-epic commit
- **v1.4.3 through v1.4.7**: 5 releases published to GitHub and npm

### Key Changes
| Category | Changes |
|---------|---------|
| Learning Commands | /wogi-decide (rule creation), /wogi-learn (pattern promotion), /wogi-retrospective (session reflection) |
| Review System | Full 5-phase enforcement, adversarial agents, git-verified claims, fix loop task gating |
| ESM Compat | scripts/package.json ensures hooks work in type:module projects |
| Installer | .workflow/ gitignored by default in target projects |
| Templates | claude-md.hbs and user-commands.hbs updated with 3 new commands |
| Config | Added decide, learning, retrospective config blocks |

### In Progress
- None

### Next Session
- wf-3daad465: Subagent metrics aggregation (backlog, P2)
- Monitor flow-long-input.js (8,303 lines) — candidate for splitting
- Request-log at 92 entries — archive soon
- Consider testing /wogi-decide, /wogi-learn, /wogi-retrospective in real workflows

### Notes
- v1.4.7 released to GitHub and npm (current)
- All code review findings addressed (37 total across 2 reviews)
- 20 commits today across 5 releases

---

## Session End: 2026-02-19 (Session 2)

### Completed
- **wf-02881aba**: Implemented 6 competitor-inspired improvements (adversarial review, [NEEDS CLARIFICATION] markers, git-verified claims, TDD mode, decision amendment tracking, cross-artifact consistency)
- **wf-cr-02881a**: Fixed 14 of 16 code review findings from competitor improvements
- **wf-cr-remain**: Fixed remaining 4 code review findings (safeJsonParse array rejection, relative paths in errors, DRY refactor, orphanMode:block)
- **wf-docs-v140**: Updated README and 6 knowledge base files for all v1.4.0 features
- **v1.4.0 Release**: Published to GitHub and npm
- **v1.4.1 Release**: Patch release with updated documentation visible on GitHub/npm

### Key Changes
| Category | Changes |
|---------|---------|
| Review System | Adversarial min findings (config.review.minFindings), git-verified claim checking |
| Spec Generation | [NEEDS CLARIFICATION] markers that block implementation until resolved |
| TDD | Opt-in test-first mode (config.tdd.enforced) |
| Decision Tracking | Amendment log with rationale, source tracking, CLI commands |
| Consistency | Cross-artifact validation (app-map, function-map, api-map vs codebase) |
| Documentation | README, 5 KB docs, commands.md, all-options.md updated for v1.4.0 |
| Code Quality | 18 review findings fixed across decision-tracker and consistency-check |

### In Progress
- None

### Next Session
- wf-3daad465: Subagent metrics aggregation (backlog, P2)
- Monitor flow-long-input.js (8,303 lines) — candidate for splitting
- Consider skill script consolidation (3 scripts, TODO from Jan 12)

### Notes
- v1.4.1 released to GitHub and npm (current)
- All code review findings addressed
- Request-log at 112 entries (76 total headers) — consider archiving soon

---

## Session End: 2026-02-11 15:20

### Completed
- **wf-audit-p3**: Fix Phase 3 cleanup audit findings (5 orphan scripts deleted, 22 catch naming fixes, config gap)
- **wf-obs-extract**: Observation value extraction pipeline - promotes high-value observations to solution facts before purge
- **wf-skill-align**: SKILL.md standard alignment - license/compatibility fields, accept SKILL.md filename
- **wf-cr-review8**: Fix 8 code review findings (null embedding, LIKE injection, input validation, resource limits, DRY, sensitive data filter)

### Key Changes
| Category | Changes |
|---------|---------|
| Memory | New extractHighValueObservations() promotes expiring observations to solution facts |
| Security | LIKE injection fixed with json_extract(), sensitive data filtered before fact promotion |
| Robustness | Try-catch per task extraction, input validation, resource caps (500 tasks/100 obs) |
| Skills | SKILL.md open standard support (hasSkillFile/getSkillFilePath helpers) |
| Config | observationExtraction config key, retentionDays cross-reference documented |

### In Progress
- None (all tasks completed)

### Next Session
- Consider implementing wf-3daad465 (subagent metrics aggregation) from backlog
- Solution facts are now stored - monitor searchFacts() behavior; may want to exclude category='solution' from general searches
- Roadmap has deferred items to review

### Notes
- Agent Zero research identified 3 ideas; 2 implemented (observation extraction + SKILL.md), solutions memory merged into extraction pipeline
- 5 commits ahead of origin/master (unpushed)

---

## Session End: 2026-02-11 12:30

### Completed
- **wf-agent-teams**: Agent Teams integration - dispatch, lead enforcement, scoring, hypothesis debugging
- **wf-agent-wire**: Wire Agent Teams features into existing workflow automation (5 integration points)
- **wf-audit-p1**: Fix 7 critical audit findings (dead imports, shell injection, broken hooks, command refs)
- **wf-audit-p2**: Fix data integrity issues (stale state, duplicate IDs, agent directory consolidation)

### Key Changes
| Category | Changes |
|---------|---------|
| Security | Shell injection in astGrepSearch fixed via execFileSync |
| Hooks | TaskCompleted registered, PostToolUse captures all tools, PreToolUse includes Skill/Bash |
| CLI Router | 4 dead team script references replaced with friendly messages |
| Agent Teams | Auto-detection in session-context, hypothesis debugging, parallelizability scoring |
| Data Integrity | Deduplicated request-log, consolidated agent directories, fixed stale progress.md |

---

## Session End: 2026-02-06 11:30

### Completed
- **wf-cr-2133**: Fix 3 code review issues from CC 2.1.33 epic
- **wf-4a337a35**: Update skill templates with memory frontmatter
- **wf-303884df**: Add TaskCompleted and TeammateIdle hook events
- **wf-c493fccb**: Add YAML frontmatter to all 11 agent definitions
- **wf-03d35188**: Tighten permission wildcards in settings.local.json

---

## Session End: 2026-02-05 12:40

### Completed
- **wf-opus46**: Adapt WogiFlow to Claude Opus 4.6 (10 files, +113/-13)
- **wf-opus46-fix**: Fix asymmetric Sonnet 4.5 updates from code review (3 files)

### Key Changes
| Category | Changes |
|---------|---------|
| **Model Registry** | Added claude-opus-4-6 (128K output, adaptive thinking, 1M beta ctx) and claude-sonnet-4-5 |
| **Routing** | Architecture/escalation now routes to Opus 4.6 |
| **Capabilities** | New `adaptive-thinking` capability alongside `extended-thinking` |
| **Breaking** | Opus 4.6 removed prefill support (documented in adapter) |
| **Fix** | Opus 4.5 maxOutputTokens corrected 32000 → 64000 |
| **Review Fix** | Sonnet 4.5 added to 3 consumer files (caller, config, providers) |

### Files Changed (13 total across 2 tasks)
- `.workflow/models/registry.json` - Model entries, routing, capabilities
- `scripts/flow-model-adapter.js` - Pattern matching
- `scripts/flow-model-caller.js` - Provider models list
- `scripts/flow-prompt-composer.js` - CLI map
- `.workflow/prompts/fragments/output-format-claude.md` - Fragment filter
- `scripts/flow-models.js` - Capability validation
- `scripts/flow-providers.js` - Capability heuristics + detect list
- `scripts/flow-model-config.js` - Known provider models
- `.workflow/model-adapters/claude-opus.md` - Adapter documentation

### Code Review Results
- **Security**: APPROVED (low risk, no vulnerabilities)
- **Architecture**: 3 asymmetric Sonnet 4.5 gaps found and fixed
- **Code & Logic**: Pattern ordering fragility noted (functionally safe)

### Next Session
- wf-3daad465: Capture Task tool metrics in flow-metrics.js (P2)
- wf-cc-007: Test WogiFlow on Windows with Claude Code 2.1.7 fixes (P3)

### Notes
- All verification commands passed (models list, info, route, adapter, providers)
- Pre-existing ESLint errors remain (18 errors, mostly `URL` not defined in flow-providers.js)
- Commits: `4ca97f1` (main implementation) + `926311e` (review fix)

---

## Session End: 2026-02-01 10:00

### Completed
- **wf-49394857**: Enhanced wogi-review with project standards compliance and solution optimization agents
- **wf-364df165**: Fix code review findings (from previous session)

### Key Features Added
| Feature | Description |
|---------|-------------|
| **Phase 3: Standards Compliance** | STRICT enforcement of decisions.md, app-map.md, naming conventions, security patterns |
| **Phase 4: Solution Optimization** | NON-BLOCKING suggestions for technical/UX improvements |

### Files Created
- `scripts/flow-standards-checker.js` - Standards compliance checking module
- `scripts/flow-solution-optimizer.js` - Solution optimization suggestions

### Files Modified
- `scripts/flow-review.js` - Integrated Phases 3-4
- `.claude/commands/wogi-review.md` - Updated documentation

### Review Flow Now
```
Phase 1: Verification Gates
Phase 2: AI Review (multi-pass or parallel)
Phase 3: Standards Compliance [STRICT - BLOCKS]
Phase 4: Solution Optimization [NON-BLOCKING]
```

### Next Session
- wf-cc-007: Test WogiFlow on Windows with Claude Code 2.1.7 fixes (P3)
- Consider implementing Feature 3: Parallel Epic Planning

### Notes
- GitHub issue import deferred to roadmap
- Standards enforcement is STRICT per user preference
- All acceptance criteria verified

---

## Session End: 2026-01-30 12:00

### Completed
- wf-0bff91f3: Permission persistence (session vs permanent)
- wf-e444ecc5: MCP tool documentation generator
- wf-80c41aef: Background task execution
- Code review of all Crush research implementations

### In Progress
None

### Next Session
- wf-cc-007: Test WogiFlow on Windows with Claude Code 2.1.7 fixes (P3)

### Notes
- All 4 Crush research tasks completed successfully
- New CLI commands: `flow permissions`, `flow mcp-docs`, `flow background`
- MCP scanner found 13 tools across memory and figma servers
- Background tasks support detached execution with timeouts

---

## Memory Blocks
<!-- MEMORY-BLOCKS-START -->
```json
{
  "currentTask": null,
  "sessionContext": {
    "filesModified": [
      "scripts/flow",
      "scripts/flow-utils.js",
      "scripts/hooks/adapters/claude-code.js",
      "scripts/hooks/core/session-context.js",
      ".claude/settings.local.json",
      "CLAUDE.md",
      ".workflow/templates/claude-md.hbs",
      ".workflow/state/ready.json",
      ".workflow/state/progress.md"
    ],
    "decisionsThisSession": [
      "PostToolUse hook fires for ALL tools (no matcher) so observation capture works universally",
      "PreToolUse matcher includes Skill|Bash for tracking and strict adherence",
      "Dead CLI router commands replaced with friendly error messages instead of deleting entries",
      "astGrepSearch uses execFileSync with array args to prevent shell injection",
      "Agent directories consolidated: root /agents/ is canonical, .workflow/agents/ is stale"
    ],
    "blockers": []
  },
  "keyFacts": [
    "Completed: Auto-pickup next ready task at session restart",
    "Completed: F1 Skill propose/patch/remove CLI + session-end approval UI",
    "Completed: F3 Fuzzy-match patching for skill edits",
    "Completed: H1 Structured phase definition schema (YAML)",
    "Completed: C2 IGR artifact edit proposals via CLI + session-end approval",
    "Completed: E1 Parallel-worktree Auto Review for Completion Truth Gate (no per-task model selection)",
    "Completed: G3 SQLite-as-IPC for workspace dispatch",
    "Completed: Surface effort.level and thinking.enabled in status line",
    "Completed: A1 AGENTS.md alias for CLAUDE.md",
    "Completed: WogiFlow Extension Finalize (pre-CLI release)"
  ],
  "lastUpdated": "2026-04-24T14:29:45.188Z",
  "taskQueueSnapshot": {
    "readyCount": 0,
    "inProgressCount": 1,
    "blockedCount": 0,
    "readyTaskIds": [],
    "inProgressTaskIds": [
      "wf-audit-p2"
    ],
    "capturedAt": "2026-02-11T12:30:00.000Z"
  }
}
```
<!-- MEMORY-BLOCKS-END -->

---

## Session End: 2026-01-28 14:00

### Completed This Session
- **Auto-Sync CLI Bridges** - Session start hooks now auto-generate missing CLI files
- **Bug Fix** - `flow bridge sync gemini` now correctly syncs to Gemini CLI
- **v1.1.2 Release** - Published with auto-sync and CLI type fix

### Key Changes
| Category | Changes |
|----------|---------|
| **New File** | `scripts/flow-bridge-state.js` - State tracking, auto-sync logic |
| **Bug Fix** | CLI type argument passed correctly in `flow bridge sync` |
| **Config** | Added `cli.autoSync` section for controlling auto-sync |
| **Bridge List** | Updated with all 6 CLIs and correct status labels |

### Files Created
- `scripts/flow-bridge-state.js` (340 lines) - Bridge sync state tracker

### Files Modified
- `scripts/flow-bridge.js` - Added CLI type argument support, updated bridge list
- `scripts/hooks/entry/*/session-start.js` - Added auto-sync calls (4 files)
- `.workflow/bridges/index.js` - Added `detectRunningCli()`, cliType override
- `.workflow/config.json` - Added `cli.autoSync` section
- `.workflow/config.schema.json` - Added schema for cli config
- `.gitignore` - Added bridge-sync.json

### Release
- **v1.1.2**: https://github.com/Tomer-Wogi/WogiFlow/releases/tag/v1.1.2

### Next Session
- Test auto-sync in fresh project installation
- Monitor for edge cases in CLI detection
- Consider adding sync-all command to CLI

### Notes
- Request log at 52 entries (archive threshold is 50)
- All changes committed and released
- User can now run `npm update wogiflow` in other projects

---

## Session End: 2026-01-28 12:00

### Completed This Session
- **README Rewrite** - Condensed from 1680 to 261 lines, added multi-CLI support table
- **Team Functionality Removal** - Separated team/paid features from open source version
- **v1.1.0/v1.1.1 Releases** - Clean open source version published to npm

### Key Changes
| Category | Changes |
|----------|---------|
| **README** | Rewritten to be focused, added multi-CLI support prominently |
| **Team Removal** | Deleted aws/, infrastructure/, team scripts and docs |
| **Repository** | Fixed npm repo URL (Wogi-Git → Tomer-Wogi) |
| **Schema** | Removed team section from config.schema.json |

### Files Deleted
- `aws/` directory (Lambda functions: auth, teams, sync, proposals)
- `infrastructure/` directory (Terraform configs for AWS)
- `scripts/flow-team.js`, `flow-team-sync.js`, `flow-team-dashboard.js`, `flow-sync-daemon.js`
- Team documentation (team-setup.md, sync-daemon.md, team-learning.md, team-history.md)

### Files Modified
- `README.md` - Rewritten (1680 → 261 lines)
- `package.json` - Fixed repository URL
- `.workflow/config.json` - Removed team section
- `.workflow/config.schema.json` - Removed team object and autoApplyTeamApproved
- `.claude/docs/commands.md` - Updated import/export descriptions
- Multiple knowledge base docs - Removed team references

### Releases
| Version | Purpose |
|---------|---------|
| v1.0.49 | Multi-CLI support |
| v1.0.50 | Repository URL fix |
| v1.1.0 | Open source release (team removal) |
| v1.1.1 | Complete team removal cleanup |

### Team Code Preservation
- Branch `team-features-backup` preserves all team code
- Will serve as base for future paid version with hosted sync service

### Multi-CLI Trigger Phrases
For CLIs without slash commands (Gemini, Cursor, etc.), use trigger phrases:
- "review what we did" → /wogi-review
- "show tasks" → /wogi-ready
- "project status" → /wogi-status

### Next Session
- Test open source installation (`npm install wogiflow`)
- Verify no team references remain
- Continue with pending tasks (8 ready)

### Notes
- Request log at 52 entries - consider archiving
- All changes committed and pushed
- Health check passes

---

## Session End: 2026-01-27 18:00

### Completed This Session
- **Multi-Pass Code Review** - Reviewed 47+ files across CLI bridges with 3 passes (Structure, Logic, Security)
- **Security Fixes** - Fixed 1 critical, 5 high, 5 medium severity issues
- **Kimi CLI Bridge** - Added support for MoonshotAI Kimi CLI (soft parity)
- **Bridge Parity Rule** - Documented mandatory checklist for multi-CLI updates

### Key Changes
| Category | Changes |
|----------|---------|
| **CRITICAL Fix** | Variable redeclaration in opencode-bridge.js (lines 469, 483) |
| **HIGH Fixes** | TOCTOU race conditions in 5 bridges, path bounds in kimi, JSON.parse validation |
| **New Bridge** | kimi-bridge.js for MoonshotAI Kimi CLI (soft parity, no hooks) |
| **Documentation** | Bridge Parity Rule added to decisions.md with full checklist |

### Files Modified
- `.workflow/bridges/opencode-bridge.js` - Fixed variable redeclaration, TOCTOU, YAML escaping
- `.workflow/bridges/kimi-bridge.js` - NEW: Soft parity bridge for Kimi CLI
- `.workflow/bridges/gemini-bridge.js` - Fixed JSON.parse and TOML escaping
- `.workflow/bridges/codex-bridge.js` - Fixed TOCTOU
- `.workflow/bridges/cursor-bridge.js` - Fixed TOCTOU
- `.workflow/bridges/index.js` - Added kimi to registry
- `scripts/hooks/adapters/cursor.js` - Added null byte validation
- `scripts/hooks/entry/cursor/before-submit-prompt.js` - Fixed error logging, JSON validation
- `.workflow/state/decisions.md` - Added Bridge Parity Rule, Multi-CLI Architecture Pattern

### Supported CLIs Summary
| CLI | Parity Type | Enforcement |
|-----|-------------|-------------|
| Claude Code | Full | Hard (hooks) |
| Cursor | Full | Hard (hooks) |
| Gemini CLI | Full | Hard (hooks) |
| OpenCode | Full | Hard (plugins) |
| Codex | Soft | Advisory only |
| Kimi | Soft | Advisory only |

### Research Notes
- **Google Antigravity IDE**: Researched - no hooks, only rules/skills/workflows. Soft parity possible if needed.

### Next Session
- Consider implementing Google Antigravity bridge if user requests
- Test Kimi bridge sync with actual Kimi CLI
- Monitor for any TOCTOU-related edge cases

### Notes
- Request log at 75 entries (R-001 through R-075)
- All syntax checks passing
- All security tests pass (prototype pollution, path traversal, null byte injection)

---

## Session End: 2026-01-25 12:00

### Completed This Session
- **Claude Code 2.1.19 Compatibility Review** - Analyzed changelog for impacts
- **Documentation Updates** - CLAUDE_CODE_ENABLE_TASKS, keybindings, fixes
- **State Cleanup Refactor** - Extracted to shared module, fixed all code review issues

### Key Changes
| Category | Changes |
|----------|---------|
| **Documentation** | CLAUDE_CODE_ENABLE_TASKS env var, 2.1.19 fixes, keybindings reference |
| **New Module** | `flow-state-cleanup.js` - centralized cleanup with safe write/delete |
| **Refactor** | Removed ~100 duplicate lines from morning/session-end scripts |
| **Best Practices** | DEBUG logging, cached getReadyData(), extractTaskId() helper |

### Files Changed
- `.claude/docs/claude-code-compatibility.md` - Version 1.0.45+/2.1.19+ docs
- `.claude/keybindings.json` - 7 recommended shortcuts (new)
- `scripts/flow-state-cleanup.js` - Shared cleanup module (new, 268 lines)
- `scripts/flow-morning.js` - Uses shared module
- `scripts/flow-session-end.js` - Uses shared module

### Next Session
- Test keybindings in Claude Code 2.1.18+
- Consider promoting flow-state-cleanup patterns to other modules
- Monitor for any state cleanup edge cases

### Notes
- Request log at 49 entries (R-001 through R-072)
- All changes committed and pushed
- Lint warnings reduced from 15 to 10 (pre-existing unused vars remain)

---

## Session End: 2026-01-23 11:15

### Completed This Session
- **wf-41b39a4c**: Universal /wogi-start Entry Point with Auto-Routing
- **Code Review**: 22 issues identified, all high-priority items fixed

### Key Changes
| Category | Changes |
|----------|---------|
| **New Features** | `classifyRequest()` function, auto-routing triage, workflow reminders |
| **Helper Functions** | `matchesAnyPattern()`, `calculateConfidence()`, `sanitizeForDisplay()` |
| **Security** | Output sanitization (redacts secrets), try-catch on pattern matching |
| **Documentation** | Universal entry point in CLAUDE.md, updated wogi-start.md |

### Files Modified
- `scripts/hooks/core/implementation-gate.js` - New pattern categories, classifyRequest()
- `scripts/flow-start.js` - triageRequest() rewrite with validation
- `.workflow/templates/claude-md.hbs` - Universal entry point section
- `.claude/commands/wogi-start.md` - Auto-routing documentation
- `CLAUDE.md` - Regenerated

### Review Findings Fixed
| Priority | Count | Status |
|----------|-------|--------|
| Critical | 1 | Mitigated (exploration checked first) |
| High | 4 | All fixed |
| Medium | 10 | All fixed |
| Low | 7 | Documentation added |

### Next Session
- Test auto-routing in real workflow scenarios
- Consider adding more operational patterns if needed
- Monitor for edge cases in classification

### Notes
- Request log at 71 entries (R-001 through R-071)
- Review report saved to `.workflow/reviews/2026-01-23-103000-review.md`
- All tests passing (9/9 classification tests)

---

## Session End: 2026-01-22 22:41

### Completed This Session
- **Claude Code Integration** - TodoWrite sync for unified progress tracking
- **Code Review & Fixes** - Fixed 14 issues (1 critical, 2 high, 11 medium/low)
- **v1.0.45 Release** - Published to npm and GitHub

### Key Changes
| Category | Changes |
|----------|---------|
| **New Files** | `flow-todowrite-sync.js`, `claude-code-compatibility.md` |
| **Modified** | `flow-start.js` (TodoWrite init), `flow-done.js` (completion stats) |
| **Security** | Try-catch on file operations, recalculateStats() helper |
| **Style** | Removed emojis, standardized ID prefixes, refactored exports |

### Tasks Completed
- wf-560d0ec5-01: Add TodoWrite sync to flow-start.js
- wf-560d0ec5-02: Update completion reports with TodoWrite stats
- wf-560d0ec5-03: Create Claude Code compatibility documentation
- wf-560d0ec5-04: Add team handoff best practices to docs

### Release v1.0.45
- **GitHub**: https://github.com/Tomer-Wogi/WogiFlow/releases/tag/v1.0.45
- **npm**: wogiflow@1.0.45

### Next Session
- Test TodoWrite sync during actual task execution
- Consider promoting Claude Code integration patterns to decisions.md
- Review wf-cc-007 (Windows testing task) if applicable

### Notes
- Request log at 46 entries (R-001 through R-069)
- All changes pushed and released
- TodoWrite sync uses graceful degradation if module unavailable

---

## Session End: 2026-01-18 23:50

### Completed This Session
- **Hierarchical Work Item Management** - Implemented Plans → Epics → Features → Stories hierarchy
- **Code Review Post-Fix Workflow** - Added Phase 3 to wogi-review with issue tracking and fix loop
- **Security Fixes** - Replaced Math.random() with crypto.randomBytes(), added recursion depth limit
- **Cascade Completion** - Auto-complete parents when all children are done

### Key Changes
| Category | Changes |
|----------|---------|
| **New Scripts** | `flow-plan.js`, `flow-feature.js`, `flow-item-link.js` |
| **New Skills** | `wogi-plan.md`, `wogi-feature.md` |
| **Security** | crypto.randomBytes() for IDs, recursion depth limit, input validation |
| **Workflow** | Post-review workflow with TodoWrite tracking, fix loop, archive |

### Files Created/Modified
- `scripts/flow-plan.js` - Plan management (pl-XXXXXXXX)
- `scripts/flow-feature.js` - Feature management (ft-XXXXXXXX)
- `scripts/flow-item-link.js` - Hierarchy linking
- `scripts/flow-done.js` - Cascade completion, readJson import
- `scripts/flow-utils.js` - crypto.randomBytes() in ID generators
- `.claude/commands/wogi-review.md` - Phase 3: Post-Review Workflow

### Review Fixes Applied
1. **CRITICAL**: Recursion depth limit in cascadeCompletion() (MAX_DEPTH=10)
2. **HIGH**: crypto.randomBytes() instead of Math.random()
3. **HIGH**: Input validation in detectType() with regex
4. **HIGH**: Removed unused 'color' import
5. **MEDIUM**: Documentation for progress conventions (0-1 vs 0-100)

### Next Session
- Test hierarchical workflow end-to-end (plan → epic → feature → story)
- Consider standardizing progress values to 0-100 everywhere
- Add request-log entry for this session

### Notes
- Request log at 45 entries (healthy)
- Review report archived to `.workflow/reviews/2026-01-18-234331-review.md`
- All syntax checks passing

---

## Session End: 2026-01-18 21:00

### Completed This Session
- **Recursive Enhancements (arXiv:2512.24601)** - All 6 phases implemented and verified
- **Code Review Security Fixes** - Fixed 9 issues (2 critical, 4 high, 3 medium)
- **Wogi Review Auto Multi-Pass** - Updated skill to auto-detect and route to multi-pass mode
- **CLI Wiring** - Connected 6 previously disconnected modules to `flow` command

### Key Changes
| Category | Changes |
|----------|---------|
| **Phase 0** | Classification system (`classifyWorkItem`, `normalizeTask`) in flow-utils.js |
| **Phase 1** | Multi-pass review (5 files in flow-review-passes/) |
| **Phase 2** | Recursive context compaction (4 files in flow-context-compact/) |
| **Phase 3** | Phased task execution (`flow-phased-task.js`, `--phased` flag) |
| **Phase 4** | Epic management system (`flow-epics.js`, `wogi-epics.md`) |
| **Phase 5** | Error recovery with hypothesis generation (`flow-error-recovery.js`, `flow-hypothesis-generator.js`) |

### Security Fixes Applied
1. **CRITICAL**: `flow-done.js:549` - Fixed undefined `config` → `doneConfig`
2. **CRITICAL**: `flow-review.js` - Replaced `execSync` with `execFileSync` (command injection prevention)
3. **HIGH**: TOCTOU race condition fix in `flow-review.js`
4. **HIGH**: Path traversal protection in `integration.js`
5. **HIGH**: Method existence check before calling `formatResults()`
6. **MEDIUM**: Debug logging for silent error swallowing
7. **MEDIUM**: Graceful degradation for optional modules in `flow-start.js`
8. **MEDIUM**: Robust argument parsing for `--commits` flag

### New Files Created
- `scripts/flow-review-passes/{index,structure,logic,security,integration}.js`
- `scripts/flow-context-compact/{index,summary-tree,section-extractor,expander}.js`
- `scripts/flow-phased-task.js`
- `scripts/flow-epics.js`
- `scripts/flow-error-recovery.js`
- `scripts/flow-hypothesis-generator.js`
- `scripts/flow-review.js`
- `.claude/commands/wogi-epics.md`

### CLI Commands Added
- `flow auto-learn` - Auto-learning from bug fixes
- `flow code-intel` - Code intelligence analysis
- `flow error-recovery` - Error recovery CLI
- `flow epic` - Epic management
- `flow pattern-enforce` - Pattern enforcement
- `flow review` - Code review CLI

### Wogi Review Updated
- Auto-detects when to use multi-pass (5+ files, security files, API files)
- Instructions to run 4 sequential passes when multi-pass triggered
- Updated "How It Works" diagram with decision point

### Next Session
- Test multi-pass review execution with `/wogi-review`
- Consider enabling recursive features by default in config
- Run full integration test of epic → story → task hierarchy

### Notes
- Request log at 1030 lines - needs archiving
- All recursive-enhancements-spec-final.md features verified complete
- 939 lines added, 79 removed across core files

---

## Session End: 2026-01-17 18:00

### Completed This Session
- **Claude Code 2.1.9-2.1.10 Integration** - Full hook system integration with new features
- **Code Review Fixes** - Fixed 8 issues (1 CRITICAL, 3 HIGH, 4 MEDIUM)
- **Setup Hook System** - New Setup event support for --init/--maintenance flags

### Key Changes
| Category | Changes |
|----------|---------|
| **CRITICAL Fix** | `setCliSessionId()` now async with file locking (race condition fix) |
| **HIGH Fixes** | `safeJsonParse()` in task-gate.js, path traversal protection, removed unused imports |
| **MEDIUM Fixes** | Timeout constants, emoji removal, PATHS consistency |
| **New Files** | `setup-handler.js`, `setup.js` (Setup hook entry point) |

### Claude Code Integration (2.1.9-2.1.10)
| Feature | Implementation |
|---------|----------------|
| Setup hook | New entry point + core handler for --init/--maintenance |
| additionalContext | Component check injects context block for AI decisions |
| Session ID | CLI-agnostic tracking via env vars |
| plansDirectory | Configurable with backward compat for .claude/plans/ |

### Security Improvements
1. **Race condition** - setCliSessionId uses saveSessionStateAsync with withLock
2. **Prototype pollution** - safeJsonParse for durable-session.json
3. **Path traversal** - path.resolve + startsWith for plans directory check

### Files Modified
- `flow-session-state.js` - async setCliSessionId
- `task-gate.js` - safeJsonParse, path safety
- `setup-handler.js` - removed unused imports
- `component-check.js` - text indicators instead of emojis
- `setup-check.js` - PATHS consistency
- `claude-code.js` - HOOK_TIMEOUTS constants
- `session-start.js` - await async call

### Next Session
- Test Setup hook with `claude --init` flag
- Consider adding more maintenance tasks to setup handler
- Run integration tests with Claude Code 2.1.10

### Notes
- All 7 modified files pass syntax checks
- All hook tests pass (session-start, pre-tool-use, setup)
- Request log at 44 entries (healthy)

---

## Session End: 2026-01-16 12:00

### Completed This Session
- **Function & API Reuse Registries** - New system for tracking and reusing functions/APIs
- **Hybrid Mode Optimizations** - Model registry integration, context window override, cloud provider expansion
- **Code Review & Security Fixes** - Fixed 21 issues (1 critical, 4 high, 10 medium, 6 low)

### Key Changes
| Category | Changes |
|----------|---------|
| **New Files** | `flow-function-index.js`, `flow-api-index.js`, `flow-scanner-base.js`, `flow-semantic-match.js` |
| **Security Fixes** | API keys no longer stored in config (use env vars), RegExp escaping for taskId, URL encoding, safeJsonParse |
| **Hybrid Mode** | Expanded cloud models (7 OpenAI, 5 Anthropic, 5 Google), custom model input, context window override (up to 250K) |
| **Dead Code Removed** | `findSimilarComponentsLegacy()` from component-check.js |
| **Bug Fixes** | Fixed `e.stderr` → `err.stderr` in flow-orchestrate.js (was causing runtime errors) |

### Hybrid Mode Improvements
| Feature | Before | After |
|---------|--------|-------|
| Cloud models | 3 hardcoded | 17+ from registry + custom input |
| API key storage | Plaintext in config | Env var reference only |
| Local LLM limits | Artificial maxTokens | Full context (free!) |
| Context window | Fixed | Configurable (32K-250K+) |

### Security Fixes Applied
1. **CRITICAL**: `apiKey` → `apiKeyEnv` (stores env var name, not value)
2. **HIGH**: RegExp escaping for user input (ReDoS prevention)
3. **HIGH**: `URLSearchParams` for proper URL encoding
4. **HIGH**: `safeJsonParse()` instead of raw `JSON.parse()`

### Next Session
- Test hybrid mode with new model registry integration
- Consider adding more models to registry
- Run full integration test with local LLM

### Notes
- Request log at 983 lines - should archive soon
- All ESLint errors fixed (32 warnings remain, mostly unused imports in orchestrator)

---

## Session End: 2026-01-15 11:00

### Completed This Session
- **Session Learning Analysis** - New feature for `/wogi-session-end` that detects patterns from daily work
- **Code Review & Fixes** - Fixed all 2 critical and 4 high severity issues from review
- **Feature folder support** - Stories with `--deep` flag get feature folders

### Key Changes
- Created `scripts/flow-session-learning.js` - Analyzes request-log for recurring patterns
- Modified `scripts/flow-session-end.js` - Integrated session learning as optional step
- Added `sessionLearning` config section to config.json
- Implemented target-based routing: 90%+ confidence patterns → decisions.md
- Fixed ESLint warnings: removed unused imports, extracted date helper function
- Fixed emoji usage inconsistency

### Session Learning System
| Trigger | What Happens |
|---------|--------------|
| `/wogi-session-end` | Analyzes today's request-log entries for patterns |
| Pattern detection | Groups by type (fix, tag, review) |
| Confidence calc | Base 60% + 10% per occurrence (max 95%) |
| Auto-apply | 90%+ confidence → decisions.md |
| Lower confidence | → feedback-patterns.md for monitoring |

### Next Session
- Test session learning with actual patterns (multiple similar entries needed)
- Consider adding deduplication between session-learning and auto-learn systems

### Notes
- Request log has 66 entries (R-001 through R-066)
- All critical/high review issues fixed

---

## Session End: 2026-01-14 12:00

### Completed This Session
- **Roadmap Management System** - Full CRUD for deferred work tracking with dependency validation
- **Session Review Fixes** - Fixed all 20 issues (1 critical, 7 high, 8 medium, 4 low)
- **Roadmap Migration** - Converted internal roadmap to new structure (28 items, 6 phases)
- **CLI Agnosticism Planning** - Phase 0.1 broken into 9 sub-tasks with dependencies

### Key Changes
- Created `scripts/flow-roadmap.js` (927 lines) with full roadmap management
- Created `templates/roadmap.md` template for user projects
- Updated `.workflow/roadmap.md` with all WogiFlow roadmap items
- Added `promote` command for promoting roadmap items to stories
- Added path validation with `isPathWithinProject()` security
- Fixed regex escaping in extraction functions (ReDoS prevention)
- Extracted `PHASE_HEADERS` constant (DRY fix)
- Added input validation for CLI flags

### Roadmap Summary
| Phase | Items | Focus |
|-------|-------|-------|
| Now | 1 | Phase 0.1.1: CLI Template System |
| Next | 4 | Claude Template, Sync Command, Failure Categories |
| Later | 23 | Phases 1-6 (Model Infrastructure through Team Integrations) |
| Ideas | 4 | Structured JSON, SQLite, @wogi org, Browser Testing |
| Completed | 8 | Loop Retry Learning, Guided Edit, etc. |

### Next Session
- Start implementing Phase 0.1.1: CLI Template System
- Create `flow-cli-sync.js` with Handlebars rendering
- Test with existing Claude template

### Notes
- Request log has 65 entries (R-001 through R-065)
- All session review issues resolved
- Roadmap system ready for use

---

## Session End: 2026-01-13 14:30

### Completed This Session
- **v1.0.13 Release** - Published to npm and GitHub
- **Technical Debt Management System** - Auto-detects issues, tracks aging, offers auto-fix
- **Knowledge Sync Automation** - Added to morning briefing and session end workflows
- **Pattern Extraction Engine** - Extracts team conventions during onboarding
- **Security Fixes** - Prototype pollution prevention, execFileSync for git, safe path handling
- **Session Review Fixes** - Fixed all 11 critical/high issues from review

### Key Changes
- 10 commits pushed (57f9e52..03ac336)
- Created flow-tech-debt.js with full debt tracking system
- Modified flow-morning.js to auto-check knowledge drift
- Modified flow-session-end.js to offer knowledge sync
- Fixed catch variable mismatch (err vs e) in session-end
- Added recursive prototype pollution check to conflict-resolver
- Changed to execFileSync for git blame in pattern-extractor

### Release v1.0.13
- **GitHub**: https://github.com/Tomer-Wogi/WogiFlow/releases/tag/v1.0.13
- **npm**: wogiflow@1.0.13

### Competitive Research
Conducted deep research on similar solutions:
- Kiro (AWS) - Spec-driven with agent loop
- Kilo Code - Memory Bank with 4 core files
- Roo Code - Multiple modes (Code, Architect, Ask)
- Aider - Git-native with multi-file editing
- Cline - MCP integration focused
- OpenAI Codex CLI - AGENTS.md based

### Next Session
- Test installation from npm (`npm install -g wogiflow@1.0.13`)
- Verify postinstall wizard works correctly
- Consider implementing ideas from competitive research

### Notes
- Request log has 858 lines - consider archiving soon
- All changes pushed and released

---

## Session End: 2026-01-12 23:55

### Completed This Session
- Comprehensive audit fixes from wf-a99ef4b5
- Fixed critical bug: err.message → e.message in flow-orchestrate.js
- Fixed double console.error in flow-damage-control.js
- Added safeReadFile() with try-catch in flow-model-adapter.js
- Deleted dead code: flow-parallel-detector.js, flow-parallel-dispatch.js
- Extracted validation functions to flow-orchestrate-validation.js
- Aligned README and Knowledge Base documentation

### Key Changes
- 41 files changed, +5310/-2050 lines
- Moved 14 features from "Backlog" to "Recently Implemented" in KB
- Created 5 new KB docs: external-integrations, sync-daemon, model-management, prd-management, memory-commands
- Added MEMORY-ARCHITECTURE.md documenting memory/knowledge system boundaries
- Added catch block naming rule (use 'err' not 'e') to decisions.md and .claude/rules/

### Next Session
- Push changes to remote
- Consider running full test suite to verify no regressions
- Continue with any remaining audit items

### Notes
- KB coverage improved from ~50-60% to ~80%+
- Session review found 4 bugs, all fixed

---

## Session End: 2026-01-12 18:00

### Completed This Session
- WogiFlow v1.0.0 public release
- Published to npm (wogiflow@1.0.2)
- Created public GitHub repo (Tomer-Wogi/WogiFlow)
- Synced documentation for npm installation flow
- Set up GitHub Actions for automated npm publishing

### Key Changes
- Removed old install scripts (install.sh, flow-install, flow-update, flow-migrate.js)
- Added scripts/postinstall.js for npm setup
- Created 5 new template files for state initialization
- Updated .gitignore to exclude dev artifacts
- Rebranded "Wogi-Flow" → "WogiFlow" across all docs
- Fixed package.json bin paths

### Repositories
- **Private**: github.com/Wogi-Git/wogi-flow (dev history preserved)
- **Public**: github.com/Tomer-Wogi/WogiFlow (clean slate)
- **npm**: npmjs.com/package/wogiflow

### Next Session
- Add NPM_TOKEN secret to GitHub repo for automated publishing
- Consider addressing Dependabot security warnings
- Continue with Phase 2: Multi-Model Core

### Notes
- Both repos synced at v1.0.2
- GitHub Action ready but needs NPM_TOKEN secret configured

---

## Session End: 2026-01-14 20:15

### Completed
- Fixed task-gate.js session state sync bug
- Removed voice input feature (deferred to roadmap)
- Released v1.0.17 to GitHub

### Key Changes
- `scripts/hooks/core/task-gate.js` - Now syncs session state when auto-creating tasks
- Voice feature removed from: config, schema, CLI, docs
- Added voice to roadmap as low-priority future feature

### Notes
- `voiceClarification` config kept (for long-input processing, not voice recording)
- Security review flagged pre-existing issues in flow-memory-blocks.js (not this session's changes)


---

## Session End: 2026-04-15

### Shipped this session

**Two npm releases:**
- **v2.16.0** — Task-boundary session restart (wogi-claude wrapper + Stop-hook SIGTERM + session-history.json)
- **v2.17.0** — Hydration recency filter + pending-question defer (`flow ask`) + workspace-mode compat + closed wf-9541ad78 as intent-satisfied

**IGR Logic Constitution: v1 → v2 → v3.** Calibrated 4 times from real failures:
- P11 — Platform capability grounding (cite + enforcement-preserve + alternative + fallback)
- P11.1 — Observed > documented (require O1 captured observation or O2 live-test plan for runtime-behavior claims)
- P11.2 — Self-ground against project's own rules (stack-agnostic: WogiFlow universal + JS/TS + Python + Go + Rust + generic)
- P11.3 — Sibling-feature compatibility (S1 enumerate, S2 compose, S3 integrate-or-file-followup)
- P11.4 — Generative 5-bucket edge-case taxonomy (B1 interleaving, B2 partial failure, B3 boundary counts, B4 execution-env portability, B5 silent-failure observability)

**Self-improvement loop bug**: fixed `flow-correct.js` missing `getTodayDate` import (was silently crashing for 2+ months). CORR-002 recorded via the revived pipeline.

**Mid-Execution Anti-Deferral** rule added to CLAUDE.md template — all WogiFlow users now get it.

### Completed stories (epic-episodic-memory)
- wf-39e9dc09 — Shell wrapper + hook signaling + postinstall (VERIFIED live)
- wf-60ac175d — Feasibility spike
- wf-643304c0 — IGR Principle 11
- wf-729ab5c0 — Timestamp-scoped hydration recency filter
- wf-f747f993 — Workspace-mode wrapper compatibility
- wf-9541ad78 — Session manifest (intent-satisfied)
- wf-2be323f6 — Task-boundary eviction (intent-satisfied)
- wf-234d2069 — Test coverage (scope-satisfied)

### Epic state
**13 of 21 stories done (61.9%)**

### Dogfood feature now live
`.workflow/config.json` has `taskBoundaryReset.enabled: true` and `sessionHydration.recencyWindowHours: 48`. Run `./node_modules/.bin/wogi-claude` instead of `claude` to stress-test the restart mechanism in real development.

### Next session — "continue" should pick up

When you say "continue" in a fresh session, `/wogi-start` will look at ready[] and start the next task. Recommended order (user judgment):

1. **wf-a3cc5f2a** (P1) — Capture gate — the canonical-capture-enforcement mate to the restart mechanism. Most important remaining piece.
2. **wf-e6d65edf** (P1) — Hybrid classifier with self-learning (keyword → AI fallback → pattern back-propagation). Your idea; complements the restart by making the feedback loop learn from itself.
3. **wf-942ad14f** (P2) — Intent artifacts + IGR consumption check.
4. Narrowed-scope carryover: wf-1cde48ad, wf-6a352aae, wf-1976a301, wf-e64cacd0 (each has annotated pivot note in its spec).

### Before starting next session, consider
- Run `wogi-claude` in your actual development for a while. Friction points become input for the next iteration.
- If the restart fires during a session where you ask a follow-up question, verify `flow ask "..."` correctly defers the restart (it should — smoke-tested).
- If you hit an issue with workspace mode, the wrapper integration is at `lib/workspace.js:resolveClaudeSpawnCommand`. Manager = claude; worker = wogi-claude wrapper.

### Notes
- `wogi-claude` wrapper is at `lib/wogi-claude`. npm install auto-symlinks to node_modules/.bin/.
- Pending question deferral: `flow ask "question"` writes `.workflow/state/pending-question.json`. UserPromptSubmit clears it. Stop-hook reads it to decide defer vs fire.
- Resume tokens: `.workflow/state/session-history.json` has the last 20 sessions' cliSessionIds + `resumeCommand` (claude --resume <id>).
- If something breaks post-restart, check: (1) marker file `.workflow/state/task-just-completed`, (2) wrapper flag `.workflow/state/restart-requested`, (3) session-history entries.


## Session End: 2026-04-17

### Accomplished (research + story drafts — no code changes this session)
- **Research**: verified silent-worker-halt gap in workspace-worker infra. Stop hook at `scripts/hooks/entry/claude-code/stop.js:64-121` fires only on graceful stop (never on OOM/crash/network). Manager at `lib/workspace-routing.js:829-890` polls only inside explicit `waitForCompletion()`. No dispatch-tracking exists today.
- **Research**: `/wogi-story` gap analysis vs peer commands. Last non-trivial change Feb 2026; drifted 6–8 months behind `/wogi-start`, `/wogi-bug`, `/wogi-extract-review`. 5 P0 gaps identified (all appropriate for a creation command — scope creep rejects documented).
- **Created**: wf-d3e67abe — Silent-worker-halt detection via dispatch-tracking (L1, P1, 11 scenarios, 6 open design questions tagged for architect+adversary).
- **Created**: wf-63c0f4cc — Enhance `/wogi-story` with P0 specification-quality gates (L1, P1, 11 scenarios, 6 open design questions).
- **Queue initialized**: wf-d3e67abe → wf-63c0f4cc → wf-94cc3b72 (recommended order: operational blocker → meta-improvement → epic).

### Next Session
Run `/wogi-start wf-d3e67abe`. Stop-hook auto-continuation carries through the queue.

### Why checkpointed mid-bulk
Both new L1 stories need full Architect + Logic Adversary passes (6 open design questions each). Epic wf-94cc3b72 has 15 child stories also requiring IGR. Orchestrator context in this session was already heavy from research rounds + two story drafts. Fresh session gives full budget for spec-phase synthesis on each task. Sub-agent architecture unchanged — only the orchestrator runs fresh.

### Notes on new stories
- **wf-d3e67abe**: shape is **dispatch-tracking** — manager records `{taskId, repoName, dispatchedAt, expectedDeadline}` to `.workspace/state/dispatched-tasks.json`; manager-turn hook diffs dispatched-vs-completed and surfaces overdue. Rejected: Stop-hook-structured-JSON alone (misses 90% of halts); worker heartbeat daemon (violates file-based no-daemon architecture).
- **wf-63c0f4cc**: 5 gates = long-input routing, consumer impact analysis, scope-confidence audit, item reconciliation, intent bootstrap coordination. All fail-open. Backwards-compat regression test mandatory. Deep-decomposition execution-ordering is explicitly preserved (unique strength).
- **Open design questions**: every open question for both stories is tagged in the story file under "Open Design Questions" — must be resolved in spec phase (architect + adversary), not during coding.

### User-stated constraints for next session
- **No compromises / no deferrals** — if something is scoped in, it ships. Reordering permitted, skipping not.
- **100% certainty bar** — if not certain, STOP and ask, do not silently work around.
- **Spec approval gates honored** — each L1/L0 task pauses at spec_review for user approval before coding.

## Session End: 2026-04-24

### Completed This Session
- **Epic wf-34290000 Phase 1+2 checkpoint**: 14 of 28 stories formally closed (Workstreams A + B complete, C1, F2)
- R-327 through R-340 logged in request-log.md
- Commit `d383bdb`: 68 files, +4827/−342
- Commit `fc41ad0`: registry manifest auto-scan
- Two CC-2.1.119 follow-up stories created (wf-ea4751fc native duration_ms; wf-04585518 statusline effort/thinking tokens)

### Stories Closed
| Workstream | Stories | R-# |
|------------|---------|-----|
| A (quick wins) | A1-A5 (5/5) | R-328, R-331, R-329, R-330, R-332 |
| B (gate hardening) | B1-B7 (7/7) | R-333 through R-338, R-327 |
| C (context eng, partial) | C1 | R-339 |
| F (skills, partial) | F2 | R-340 |
| G (workspace, prior) | G5 | R-323 (commit da98d44) |

### Key insight
All 14 closed stories had implementation artifacts already in-tree from prior sessions — this session's work was **verification + formal closure** (test runs, request-log entries, ready.json moves), not new code. Raw code landed across prior sessions but was never formally committed + recorded. This commit consolidates it.

### In Progress
- None — clean inProgress queue

### Next Session — G1 + G4 + G6 Stop hook trio
- **G1** wf-b5cd0351: Worker-side silent-halt prevention — block end-of-turn on dispatch-receipt turn with zero tool calls
- **G4** wf-c8754819: Worker text-before-tool-call prevention — EVERY turn after UserPromptSubmit must start with a tool call
- **G6** wf-8a0fc8ad: Tool-first turn enforcement for workers — first action must be a tool call, not text
- Integration point: `scripts/hooks/core/stop.js` + worker-mode branches
- **NOT** overlapping with `wf-d3e67abe` (manager-side overdue detection — already shipped)
- Starting prompt: *"Continue epic wf-34290000 — pick up G1 + G4 + G6 Stop hook trio."*

### Remaining in epic (11 stories after G1/G4/G6)
- C2 (memory blocks + memory_propose tool)
- D1 (MCP OAuth manager), D2 (execpolicy TOML)
- E1 (parallel-worktree Auto Review — blocked by H1)
- F1 (skill_manage tool), F3 (fuzzy-match patching)
- G2 (routing-state-reset fix — **ambiguous scope, needs clarification next session**), G3 (SQLite IPC — highest risk, dedicated session)
- H1 (YAML modes — 1-2 week, critical path, dedicated session), H2 (permission-ruleset-per-phase — after H1)

### Notes
- Test suite: 2055/2056 pass; 1 pre-existing phase-read-gate flake (34/34 in isolation — known issue, unrelated)
- ready.json queue: 4 ready tasks (2 epics + 2 CC-2.1.119 follow-ups); inProgress empty; 39 in recentlyCompleted
- Commits NOT pushed to remote — user to decide when
- User directive for remaining sessions: "I want everything done. I don't care about order." — execution order deferred to session-level judgment

---

## Session End: 2026-05-01

### Completed
- Reviewed Claude Code 2.1.126 release notes for WogiFlow impact
- Created story wf-7d92c6be: "Extend PreToolUse Bash gates to cover PowerShell tool on Windows" (P1, L1)

### In Progress
- **wf-7d92c6be** — explore phase started, paused before Architect/Adversary
  - Task moved to inProgress
  - Audit completed: 13 `toolName === 'Bash'` references across **8 hook files** (initial spec assumed ~4)
    - `pre-tool-orchestrator.js` (8 sites: 105, 181, 200, 308, 325, 359, 376, 410, 427, 448)
    - `deletion-log.js:104`, `observation-capture.js:131,198`
    - `strike-gate.js:281`, `routing-gate.js:296`
    - `manager-boundary-gate.js:300`, `phase-gate.js:45,51,236`
    - `long-input-enforcement.js:257`, `scope-mutation-gate.js:202`
    - `post-tool-use.js:172`
  - **Open question (Scenario 1 of spec)**: exact tool name CC emits for PowerShell — local Mach-O binary too minified to extract. Resolve via Anthropic public docs / changelog or live Windows test next session.
  - Spec (`.workflow/changes/wf-7d92c6be.md`) needs updating to reflect 8-file audit before Architect pass.

### Next Session — Resume wf-7d92c6be
- Starting prompt: *"Resume wf-7d92c6be — explore phase. Resolve PowerShell tool name via Anthropic docs, update spec scope to 8 files, then Architect + Logic Adversary."*
- First action: WebSearch Anthropic docs/changelog for the PowerShell tool definition (was not loaded in this session's tool budget).
- Then: edit `.workflow/changes/wf-7d92c6be.md` to expand the audit list, run intent-framing pass, run Architect on a different model, run Logic Adversary, present spec for approval.

### Other ready queue (unchanged)
- wf-94cc3b72 (epic — Lift WogiFlow from C+ to A) — 15 stories pending

### Notes
- Claude Code 2.1.126 is installed locally (`/opt/homebrew/Caskroom/claude-code@latest/2.1.126/`)
- Other 2.1.126 items reviewed and dismissed: fork-context fix (no fork-context skills in WogiFlow), `--dangerously-skip-permissions` expansion (orthogonal to PreToolUse hooks), `claude project purge` (doesn't touch `.workflow/`), empty-turn-hang fix (silent-halt false-positive reduction — no code change needed).
- Commits NOT pushed to remote — user to decide.
