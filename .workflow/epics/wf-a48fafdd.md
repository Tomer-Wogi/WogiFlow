# Epic: Autonomous Epic Execution — end-to-end walk-away mode across solo + workspace

## Overview
<!-- PIN: overview -->
User can dump N items (epic, bulk task list, 2-page product review) in either **solo** or **workspace** mode, say **"go until you finish"** in plain text, walk away, and return to a terminal summary. Quality bar is production-grade — no compromises unless marginal best-vs-very-good difference is dramatic.

**Non-negotiable quality constraint (user-stated)**: *"People who use WogiFlow use it because they're building production products for big companies with high standards. Compromises are out of the question, otherwise they will just use Cloud Code as is."* Only accept quick-win over proper fix when cost delta is dramatic AND the quick-win is solidly production-quality.

## Success Metrics
<!-- PIN: success-metrics -->
- [ ] Worker boot latency: keystrokes register within <1s of worker prompt visibility (down from 20-30s baseline)
- [ ] End-to-end solo-mode demo: user pastes multi-item product-review, says "go until you finish", all items complete without mid-run interruption (except for product-Qs auto-queued), terminal shows structured summary with all sections rendered
- [ ] End-to-end workspace-mode demo: same scenario with worker executing, manager terminal shows completion summary
- [ ] No regression: existing gate tests pass; non-autonomous mode behaves identically to pre-epic
- [ ] Standards-gate passes on all new/modified hook files (three-layer architecture per `.claude/rules/architecture/hook-three-layer.md`)

## Features
<!-- PIN: features -->
Autonomous-mode decision routing (core of Story C):

| Classifier bucket | Autonomous mode behavior |
|-------------------|--------------------------|
| productBehavior / ux / business-logic | QUEUE for batch review. No interrupt. |
| engineering / naming / implementation | agent-decides autonomously |
| infrastructure / performance | agent-decides-report-after |
| security | auto-fix-report-after (existing) |
| Low-confidence technical | Self-adversarial challenge to ≥90% confidence. If stuck below 90% → queue + skip dependent tasks + continue independent. |
| Blocking errors (typecheck/test/conflict) | Fix autonomously. Only surface if fundamentally un-fixable. |

Dependency-aware queueing: queued question stores metadata about which tasks reference its answer; those tasks are skipped/queued. Independent tasks continue.

## Stories
<!-- PIN: stories -->

| ID | Story | Size | Deps | Wave |
|----|-------|------|------|------|
| wf-8294d960 | A — Worker Boot Latency Fix | L2 | none | 1 |
| wf-ab59f0e4 | B — Workspace-Mode Epic Autonomy | L1 | A | 3 |
| wf-d712002e | C — Natural-Language Autonomous Mode | L1 | — | 2 |
| wf-e28b6cd8 | E — Epic Decompose-and-Run in One Pass | L2 | — (integrates with C) | 2 |

**Dropped**: Story D — Per-Task Autonomous Flag. User chose natural-language activation over persistent per-task field.

**Wave order**:
- **Wave 1**: Story A alone (unblocks everything; cannot validate autonomy if worker boot is broken)
- **Wave 2**: Stories C + E in parallel (mutually reinforcing, independent code paths)
- **Wave 3**: Story B (integrates A's boot fix + C's autonomous mode into workspace channel-dispatch)

## Dependencies
<!-- PIN: dependencies -->
- Story B depends on Story A (worker boot fix)
- Story E integrates with Story C (autonomous mode) — parallelizable but C's decision routing informs E's cascade-vs-prompt branch
- Prior completed epic wf-34290000 (extension-finalize) — established main-mode auto-pickup infra this epic builds on

## Evidence-grounded design constraints
<!-- PIN: design-constraints -->
1. **Rule-Placement (decisions.md 2026-04-20)**: Any new methodology rules introduced by Story C (autonomous-mode routing, question-queue mechanics) MUST be written to `.workflow/templates/partials/methodology-rules.hbs` — NOT to this repo's `decisions.md`.
2. **Visibility-as-substitute-for-action anti-pattern (feedback-patterns.md 2026-04-16)**: Story C must internalize anti-hedging watchwords ("awaiting signal", "or will proceed") so main-mode autonomous runs don't reproduce the workspace-worker anti-pattern.
3. **High-frequency hook perf (feedback-patterns.md 2026-03-24)**: Autonomous-mode active flag MUST be cached in-memory (per-process) via `flow-session-state.js`, NOT re-read from disk on every hook invocation.
4. **Empty-Collection Vanishing-Section Rule (decisions.md 2026-04-23)**: Completion-summary terminal output MUST render all sections (Queued Questions, Skipped Tasks) even when empty — "0 queued" / "0 skipped" placeholders.
5. **Hook Three-Layer Architecture (.claude/rules/architecture/hook-three-layer.md)**: Stories A, B, C all touch hooks. Entry files ≤120 LOC, dispatch only; core files contain logic and are CLI-agnostic.

## Non-goals
<!-- PIN: non-goals -->
- Slash-command autonomous-mode activation (natural language only, per user)
- Per-task persistent autonomous field (Story D dropped)
- Notifications beyond terminal summary (no bell, no macOS notification)
- Completion via webhook / external trigger
- Cross-session autonomous-run resumption (v1 is session-scoped)

## Context links
<!-- PIN: context -->
- Prior pending-item origin: `.workflow/state/pending-prompts.json` item #4 (deferred 2026-04-24)
- Related completed epic: wf-34290000 (extension-finalize)
- Worker boot root cause: `lib/wogi-claude-expect.exp:142-148` (research confirmed via Explore agent in creation session)

## Logic Adversary critique — Round 1 (ran 2026-04-24)
<!-- PIN: adversary -->

**Summary**: 5 blockers + 4 majors found. All blockers addressed via spec revision before user approval.

**Blockers fixed in revised specs**:
1. **Story A root-cause diagnosis was wrong** — original Explore-agent finding ("500ms sleep blocks keystrokes") contradicted by `wogi-claude-expect.exp:134-151` which uses `interact` (stdin forwarded from second zero, never captured). Story A rewritten as **investigation-first** — mandatory instrumentation spike (Phase 1) before any code change. No fix until root cause is measured.
2. **Autonomous-mode flag evaporates across SIGTERM** — `flow-session-state.js` in-memory cache dies at each task-boundary-reset. Fix: dual-layer persistence (disk canonical + cache read-hot) + SessionStart re-hydration. Spec revised in Story C.
3. **New `autonomous-mode-gate.js` duplicates `flow-decision-authority.js`** — two parallel gatekeepers would be brittle. Fix: integrate autonomous routing INTO decision-authority.js, add `queue-for-review` + `adversary-loop` buckets. Spec revised in Story C.
4. **Question-queue TOCTOU writes** — `fs.writeFileSync` is not atomic; Ctrl-C mid-write corrupts. Fix: new `flow-utils.atomicWriteJson()` helper (tmp-file + rename) used for all queue + session-state writes. Spec revised in Story C.
5. **`## COMPLETION-SUMMARY:` message format ambiguity** — multi-line payloads break channel-dispatch line-prefix parser. Fix: single-line `## COMPLETION-SUMMARY: <base64-JSON>` framing with `CHUNK-<n>/<total>` fallback for >64KB. Spec revised in Story B.

**Majors fixed in revised specs**:
- **M1 (Story C)**: `batchClassify` overflow composition. Fix: autonomous routing applied FIRST, then overflow fallback only for unmatched decisions.
- **M2 (Story E)**: ungrounded restart-latency claim + marker-loss race. Fix: mandatory latency-measurement spike (Phase 1) + fsync + atomic-rename-with-dir-fsync on marker writes.
- **M3 (Story C)**: shared adversary counter between IGR Architect-Adversary and autonomous low-confidence loop. Single `adversaryInvocations` counter, default cap 30 per run.
- **M4 (Story C)**: cross-session interruption (laptop sleep mid-run). Fix: SessionStart detects stale `autonomousMode`, notifies user, does NOT auto-resume.

**Additional findings integrated**:
- Dependency classification: conservative over-flag instead of best-effort. Classifier-unavailable → all pending tasks marked dependent.
- Classifier-failure path for NL trigger detection: fail-closed to NOT autonomous (safer default).
- `session-start.js` pre-existing three-layer violation (329 LOC vs 120 LOC rule): fix as part of Story A Phase 4.

## Logic Adversary critique — Round 2 (ran 2026-04-24)

**Verdict**: SHIP WITH ADDENDA. All 9 Round 1 findings ✅ RESOLVED. Round 2 caught 3 new addenda (all integrated into revised specs before user approval):

- **NG-1 (critical)**: Staleness threshold inconsistency (24h vs 1h) — fixed. Single canonical value `config.autonomousMode.stalenessThresholdMs` (default 1h) drives both SessionStart re-hydration and cross-session recovery paths.
- **NG-2 (major)**: Multi-process writes in workspace mode — `atomicWriteJson` is single-writer-only; manager and workers are separate processes. Fixed in Story B with explicit state-file ownership contract (manager writes only manager paths; each worker writes only its own member-repo paths; cross-process comm is channel-dispatch HTTP only). Enforcement via path-discipline gate in `worker-boundary-gate.js`. Concurrency stress test added to AC.
- **NG-3 (moderate)**: `/wogi-challenge` vs autonomous adversary cap — clarified in Story C. Manual challenges DO count against cap (single budget, same adversary pool). Cap-exhausted manual challenges return with an explicit notice. Completion summary breaks down invocations by source (autonomous / IGR / manual).
- **NG-4 (moderate)**: Story A Phase 1→2 scenario-confirmation gate — fixed. New Phase 1.5 presents Phase 1 findings to user; user confirms scenario before Phase 2 implementation begins. Prevents silent refactor beyond confirmed scope.

**NG-5 (minor, benign)**: Base64 encoding CPU cost on 200-story epics — adversary confirmed this is not a real risk (<1ms in Node). No change needed.

**Ship status**: ready for wave execution. Story A first (independent). Stories C + E parallel (no cross-wave dependency issues identified). Story B last (depends on A; also inherits Round 2 NG-2 fix).

## Status: ready
## Progress: 0%
## Created: 2026-04-24T15:20:26.866Z
## Updated: 2026-04-24T15:20:26.866Z
