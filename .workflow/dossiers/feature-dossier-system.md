# Feature Dossier + Logic Rules System

<!-- slug: feature-dossier-system -->
<!-- status: active -->
<!-- owners: core -->
<!-- created: 2026-04-24 -->

## Canonical Summary

Per-feature canonical knowledge docs at `.workflow/dossiers/<slug>.md` paired with cross-cutting logic rules at `.workflow/dossiers/_logic-rules.md`. Auto-injected into phase context via `feature-dossier-gate.js` during UserPromptSubmit. Captures what `app-map.md`, `function-map.md`, and commit messages do not: rejected design alternatives, removed elements the codebase must not reintroduce, cross-repo contracts, known global-state bugs. Enforcement is mechanical, not honor-system — dossier content is injected into the prompt so Claude cannot skip consulting it under token pressure.

## Match Patterns

- keyword: feature dossier
- keyword: logic rules
- keyword: dossier system
- keyword: feature-scoped memory
- file: scripts/flow-feature-dossier.js
- file: scripts/flow-logic-rules.js
- file: scripts/hooks/core/feature-dossier-gate.js
- file: .workflow/dossiers/**

## Contracts

- Dossier injection path: `user-prompt-submit.js → getDossierInjection() → getCurrentTaskInfo() → matchFeatures()`. Fail-open on any error — missing dossiers must not break existing flow.
- Spec contradiction gate: `validateSpecContradictions()` returns `{blocked, issues}`. Only blocker-severity issues block. Config `featureDossier.blockOnContradiction` can disable enforcement (still returns issues for display).
- Workspace precedence: workspace-level dossiers (`$WOGI_WORKSPACE_ROOT/.workspace/dossiers/`) shadow per-repo dossiers on slug collision. Both are scanned at match time.
- Reserved slugs: `_template`, `_logic-rules`, `README`, `index` — never used as feature slugs.
- Dossier slug format: kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). `scaffoldDossier()` rejects violations.

## Logic Rules

- Dossier content is **injected**, not linked. Referencing a dossier by path instead of including its canonical content is a regression — the user catalog documented that linked-but-not-read is the failure mode this replaces.
- Append-only change log — never rewrite existing rows in the Change Log section. `appendEvent()` inserts new rows below the table separator; existing history stays intact.
- Fail-open is mandatory. Any exception in the gate path must return `null` / `{blocked: false}`, never propagate. Test: setting `WOGI_PROJECT_ROOT` to a directory with no `.workflow/dossiers/` must not crash the hook.

## Rejected Alternatives

- 2026-04-24: Adding a 23rd feedback-patterns.md entry instead of building the dossier system → REJECTED, reason: root cause of 2026-04-24 workspace catalog was rule accretion without enforcement; another feedback file replicates the disease.
- 2026-04-24: Per-feature file named `ft-XXXXXXXX.md` sharing the existing `.workflow/features/` directory → REJECTED, reason: that directory is owned by `flow-feature.js` (hierarchical feature tracking). Dossiers live at `.workflow/dossiers/` to avoid namespace collision.
- 2026-04-24: Honor-system consultation (a reminder in CLAUDE.md to "read the dossier") → REJECTED, reason: catalog documented 22+ cases where the info existed but wasn't consulted. Mechanical injection is the point.

## Removed Elements

<!-- If we remove a component/pattern from this system, record the enforcement regex here.  -->
- <date>: <element> → removed, reason: <why>, enforcement-grep: `<regex>`

## Known Bugs / Tech Debt

- Logic rule propagation (`flow logic-rules propagate`) currently greps the full repo. For large repos this may be slow; consider scoping to `Applies to` patterns as a follow-up.
- Dossier injection fires on every UserPromptSubmit. If the active task has no matching dossier, the match step still runs. Low cost (parse index + grep), but could be cached per-task.

## Change Log

| Date | Task ID | Event | Note |
|------|---------|-------|------|
| 2026-05-11 | wf-e399bd8d | bug | Bake self-adversary-before-asking pattern into WogiFlow: AI must iterate Self... |
| 2026-05-11 | wf-4a5b7a6f | bug | deferral-gate checkBashGate over-triggers on commands that merely reference '... |
| 2026-05-11 | wf-b8839d99 | bug | Replace regex deferral-classifier with AI classifier + close architectural ga... |
| 2026-05-11 | wf-d5fcb880 | bug | Close pre-release HIGH findings H1+H2: safeJsonParse self-violation + missing... |
| 2026-05-11 | wf-6c9ed721 | bug | Verification fallout from gate-bug batch 2026-05-10 (phase-gate test isolatio... |
| 2026-05-11 | wf-c573961f | bug | Task-gating gate consults 5+ drifting state sources |
| 2026-05-11 | wf-35742353 | bug | Gate cascade: Stop hook + research-required + long-input-pending fire same tu... |
| 2026-05-11 | wf-88a08fd4 | bug | flow-phase.js transition CLI silently no-ops |
| 2026-05-11 | wf-f7d58760 | bug | long-input-pending gate misfires on sub-agent task-notifications |
| 2026-05-11 | wf-12271e82 | bug | Research-required gate false-positives on the word 'recommend' |
| 2026-04-24 | wf-557cf08a | implemented | Full v1 ship: library + gate + hook + tests + CLAUDE.md rule |
| 2026-04-24 | wf-557cf08a | system-created | Initial scaffold: library + gate + template + CLAUDE.md rule + tests |
