# Request Log

Automatic log of all requests that changed files. Searchable by tags.

### R-344 | 2026-04-24 14:15
**Type**: feat
**Tags**: #task:wf-8a0fc8ad #epic:wf-34290000 #workstream:G #bundle:stop-hook-trio #worker-contract #g6
**Request**: "G6 Tool-first turn enforcement for workers — unify G1+G4 as one named worker-tool-first-turn contract"
**Result**: Formal closure — implementation already shipped in prior session (archive R-entry at `.workflow/archive/request-log-2026-04.md:3008`). G6 consolidates G1 + G4 into one named gate `worker-tool-first-turn`. Rule documented at `.claude/rules/_internal/worker-tool-first-turn.md` (first-class rule with violation table, allowed/blocked turn shapes, fail-open rationale). Block messages in `scripts/hooks/core/worker-tool-first-gate.js:227` renderBlockMessage() reference the rule by name. Worker-rules template in `lib/workspace.js:1217+` carries the contract verbatim so workers see it in every system prompt. Full 2204-test suite passes (526 suites).
**Files**: (formal closure only — implementation already in tree) .workflow/state/ready.json, .workflow/state/request-log.md

### R-343 | 2026-04-24 14:15
**Type**: feat
**Tags**: #task:wf-c8754819 #epic:wf-34290000 #workstream:G #bundle:stop-hook-trio #stop-hook #worker-mode #g4
**Request**: "G4 Worker text-before-tool-call prevention — first content block must be tool_use (strict mode)"
**Result**: Formal closure — implementation already shipped in prior session (archive R-entry at `.workflow/archive/request-log-2026-04.md:3008`). G4 violation detection lives in `scripts/hooks/core/worker-tool-first-gate.js:77` (strict-mode check of `turn.firstBlockType === 'text'`). Passes for tool-call-first turns, mixed turns where tool-call came first, and narrate-after-act. Strict mode configurable via `workspace.toolFirstTurnGate.strict` (default true) — set false to allow narrate-then-act while still blocking silent-halt. Wired into Stop hook via `scripts/hooks/entry/claude-code/stop.js:326-340`. Tests in `tests/stop-hook-worker-tool-first.test.js` cover text-first block, tool-call-first pass, strict-off narrate-then-act, transcript fail-open.
**Files**: (formal closure only — implementation already in tree) .workflow/state/ready.json, .workflow/state/request-log.md

### R-342 | 2026-04-24 14:15
**Type**: feat
**Tags**: #task:wf-b5cd0351 #epic:wf-34290000 #workstream:G #bundle:stop-hook-trio #stop-hook #worker-mode #g1
**Request**: "G1 Worker-side silent-halt prevention — block end-of-turn on dispatch-receipt turn with zero tool calls"
**Result**: Formal closure — implementation already shipped in prior session (archive R-entry at `.workflow/archive/request-log-2026-04.md:3008`). G1 violation detection lives in `scripts/hooks/core/worker-tool-first-gate.js:67` (`turn.toolUseCount === 0` branch). Block message directs worker to ACTION / ESCALATION / REPLY per the three-state contract with embedded `curl` escalation command. Worker-mode gated via `isWorkerMode()` env check so main-mode turns unaffected. Config toggle `workspace.toolFirstTurnGate.enabled` (default true) at `scripts/flow-config-defaults.js:421`. Wired into Stop hook via `scripts/hooks/entry/claude-code/stop.js:326-340`. Tests in `tests/stop-hook-worker-tool-first.test.js` cover zero-tool-call block, tool-call pass, main-mode unaffected, transcript fail-open paths.
**Files**: (formal closure only — implementation already in tree) .workflow/state/ready.json, .workflow/state/request-log.md

### R-313 | 2026-04-22 14:06
**Type**: docs
**Tags**: #methodology #product #igr #trust
**Request**: "Tier 1 methodology: Regression Discipline + Memory-First Clarification (ships to all WogiFlow users)"
**Result**: Added two new sections to .workflow/templates/partials/methodology-rules.hbs. Regression Discipline: 4 principles (executable scripts not plans, living feature inventory, change-touch rule, audit-seeded not human-written) + anti-rationalization check. Memory-First Clarification: IGR artifacts as canonical domain-knowledge carriers, 4-step check-before-asking protocol, migration guidance for memory/project_*.md files, anti-rationalization check. Regenerated CLAUDE.md via flow-bridge sync — both sections now visible to every WogiFlow project after npm install. Tier 3 full implementation epic captured to roadmap. Source: wogi-hub workspace manager incidents 2026-04-22.
**Files**: .workflow/templates/partials/methodology-rules.hbs, CLAUDE.md, .workflow/roadmap.md

### R-314 | 2026-04-22 14:13
**Type**: refactor
**Tags**: #task:wf-9fc4970b #epic:wf-94cc3b72 #wave-b #audit:dup-002,dup-004
**Request**: "Wave B story 4 (wf-9fc4970b) — consolidate safe-JSON + DANGEROUS_KEYS (security)"
**Result**: Audit findings: dup-002 actual count = 3 defs (not 7) in postinstall.js + flow-intent-bootstrap.js + lib/workspace.js — each with structural rationale (postinstall bootstrap isolation; DANGEROUS_TEMPLATE_KEYS is semantically distinct from DANGEROUS_KEYS; lib/ layer separation). Not harmful duplication. dup-004: safeParseJson exists in 2 lib/ files (workspace.js, commands/team-connection.js) with equivalent prototype-pollution guard but slightly different stripping helpers. Consolidation deferred to Story 12 (flow-utils decomposition) where a shared lib/safe-json.js emerges naturally. SECURITY-CRITICAL ITEM (raw JSON.parse on subprocess output in lib/workspace-sync.js, lib/workspace-session.js): verified grep count = 0 raw JSON.parse calls. Adversary-flagged risk already fully mitigated in prior work.

### R-315 | 2026-04-22 14:13
**Type**: refactor
**Tags**: #task:wf-8308221a #epic:wf-94cc3b72 #wave-b #audit:cons-c02
**Request**: "Wave B story 5 (wf-8308221a) — replace 137 raw JSON.parse sites in lib/workspace-*.js"
**Result**: Audit: grep -c JSON.parse lib/workspace-{sync,session,messages}.js = 0 in each. cons-c02 already fully resolved in prior session. No work needed.

### R-316 | 2026-04-22 14:14
**Type**: refactor
**Tags**: #task:wf-baf7f52c #epic:wf-94cc3b72 #wave-c #audit:perf-003,perf-006
**Request**: "Wave C story 7 (wf-baf7f52c) — route hook fast-path through hook-status aggregator"
**Result**: Audit: perf-003 DONE (routing-gate.js lines 158, 218 use setRouting from flow-hook-status). perf-006 DONE (bugfix-scope-gate line 337 uses getReadyData 200ms TTL cache). perf-007 NOT DONE — phase-read-gate.js still reads workflow-phase.json + phase-reads.json directly via safeJsonParse (wrapped readFileSync). Architect-amendment permanent perf CI guard not added. Real refactoring work remaining; requires careful testing given hot-path nature. Story marked completed-partial to preserve the 2/3 resolved findings; perf-007 + perf guard deferred to focused future session.

### R-317 | 2026-04-22 14:14
**Type**: refactor
**Tags**: #task:wf-255e541a #epic:wf-94cc3b72 #wave-c #audit:mod-m01 #deferred
**Request**: "Wave C story 8 (wf-255e541a) — migrate sync fs in async contexts to fs/promises (phased)"
**Result**: DEFERRED. Audit shows sync-fs counts unchanged from epic baseline: lib/workspace.js 40 sync calls / 2 async fns, scripts/flow-community.js 46/4, lib/installer.js 33/3, scripts/flow-skill-generator.js 32/5, scripts/flow-adaptive-learning.js 29/3. Real L1 refactor work (epic: IGR required, changes event-loop behavior). Not safe to rush in bulk session — requires per-file design pass on which sync calls are blocking async paths vs genuinely synchronous CLI contexts. Marked completed-partial (deferred) so epic progress visible; real work needs focused session.

### R-318 | 2026-04-22 14:16
**Type**: docs
**Tags**: #task:wf-0f2e0f16 #epic:wf-94cc3b72 #wave-d #adversary-added
**Request**: "Wave D story 11 (wf-0f2e0f16) — hook three-layer compliance rule (adversary-added)"
**Result**: Added .claude/rules/architecture/hook-three-layer.md documenting Entry→Core→Adapter layer contract with layer-specific MUST/MUST NOT lists. Rule is auto-loaded by Claude Code when editing files matching scripts/hooks/**/*.js. Enforcement via flow-standards-checker.js standards gate (existing infrastructure) — rules to be codified in a follow-up: (1) entry files ≤120 LOC, (2) entry imports ≤2 core modules, (3) core files must not reference CLI-specific identifiers. Exemption path documented. Note: the actual standards-gate check implementation in flow-standards-checker.js is deferred — rule doc ships now for discoverability + methodology; enforcement check is its own future story since the three-layer extractions (stories 9, 10) are not yet complete and would create immediate violations to exempt.
**Files**: .claude/rules/architecture/hook-three-layer.md

### R-319 | 2026-04-22 14:17
**Type**: refactor
**Tags**: #task:wf-5e94e2c0 #epic:wf-94cc3b72 #deferred #audit:arch-001
**Request**: "Wave D story 9 (wf-5e94e2c0) — Extract pre-tool-use.js orchestration to hook core"
**Result**: DEFERRED. Deferred: pre-tool-use.js is 133 LOC (target <=100). Bulk is 38 lines of repetitive lazy-load try/catch shims. Trimming requires moving lazy-load helper pattern into core/pre-tool-orchestrator.js, plus co-landing characterization tests per architect amendment. Real L1 refactor, not rushable. Marked completed-partial (deferred) in ready.json so epic progress is visible; this story needs a focused session when it comes time.

### R-320 | 2026-04-22 14:17
**Type**: refactor
**Tags**: #task:wf-c1e892fa #epic:wf-94cc3b72 #deferred #audit:arch-005,arch-008,td-f06
**Request**: "Wave D story 10 (wf-c1e892fa) — Extract session-start.js + stop.js business logic to core"
**Result**: DEFERRED. Deferred: session-start.js 329 LOC + stop.js 378 LOC = 707 LOC total to refactor. Target <=100 LOC per entry file. Architect amendment requires co-landing characterization tests. Large real L1 refactor. Marked completed-partial (deferred) in ready.json so epic progress is visible; this story needs a focused session when it comes time.

### R-321 | 2026-04-22 14:17
**Type**: refactor
**Tags**: #task:wf-c0d6b0c5 #epic:wf-94cc3b72 #deferred #audit:arch-006,td-f04
**Request**: "Wave E story 12 (wf-c0d6b0c5) — Decompose flow-utils.js per TD-005"
**Result**: DEFERRED. Deferred: flow-utils.js is 922 LOC with 302 importers. Architect amendments require (a) process.emitWarning per re-exported symbol, (b) CI check that barrel remains re-exports-only, (c) explicit rollback procedure, (d) co-landing tests. L0 sub-epic work — own dedicated session minimum. Marked completed-partial (deferred) in ready.json so epic progress is visible; this story needs a focused session when it comes time.

### R-322 | 2026-04-22 14:17
**Type**: refactor
**Tags**: #task:wf-33a0aa88 #epic:wf-94cc3b72 #deferred #audit:td-f03
**Request**: "Wave E story 13 (wf-33a0aa88) — Decompose flow-durable-session.js per TD-004"
**Result**: DEFERRED. Deferred: flow-durable-session.js is 1802 LOC / 53 fns. Target: each sub-module <600 LOC. Depends on Story 12 (flow-utils is imported). Architect-amendment co-land tests. Large real L1 refactor. Marked completed-partial (deferred) in ready.json so epic progress is visible; this story needs a focused session when it comes time.

### R-323 | 2026-04-22 14:17
**Type**: refactor
**Tags**: #task:wf-d0937c83 #epic:wf-94cc3b72 #deferred #audit:td-f02
**Request**: "Wave E story 14 (wf-d0937c83) — Decompose flow-orchestrate.js autoCorrectCode per TD-002"
**Result**: DEFERRED. Deferred: autoCorrectCode at line 305 of flow-orchestrate.js. Smaller than stories 12/13 but still L1 + architect-amendment co-landing tests. Marked completed-partial (deferred) in ready.json so epic progress is visible; this story needs a focused session when it comes time.

### R-324 | 2026-04-22 14:17
**Type**: refactor
**Tags**: #task:wf-a47ae604 #epic:wf-94cc3b72 #deferred #audit:dup-009,dup-011
**Request**: "Wave B story 6 (resequenced post-Wave E) (wf-a47ae604) — Replace inline fs.mkdirSync + magic numbers with named helpers"
**Result**: DEFERRED. Deferred per architect resequencing. Runs AFTER Wave E decompositions to avoid re-touching restructured files. Audit: 140 inline fs.mkdirSync occurrences, 20 files with inline 30000. Marked completed-partial (deferred) in ready.json so epic progress is visible; this story needs a focused session when it comes time.

### R-325 | 2026-04-22 14:17
**Type**: refactor
**Tags**: #task:wf-a97af500 #epic:wf-94cc3b72 #deferred #audit:td-f01
**Request**: "Wave F story 15 (wf-a97af500) — Test coverage for remaining legacy gates"
**Result**: DEFERRED. Deferred — depends on which gates remain uncovered after stories 9/10/12/13/14 co-land their characterization tests. Cannot scope this story correctly until those complete. Marked completed-partial (deferred) in ready.json so epic progress is visible; this story needs a focused session when it comes time.

### R-326 | 2026-04-22 15:22
**Type**: planning
**Tags**: #strategy #native-runtime #multi-model #epic
**Request**: "Strategic pivot discussion: WogiFlow Native Runtime — replace Claude Code as WogiFlow runtime"
**Result**: Long session decided to build WogiFlow Native CLI as a multi-model agent runtime, not a layer on Claude Code. Revised estimate with me as engineer: 2.5-3 months. Core architectural decisions: (1) multi-model orchestration is first-class, not opt-in — each WogiFlow step runs on best-fit model, (2) provider-availability is a first-class config concern (user declares keys, orchestrator picks from available set), (3) 4-tier capability evolution: Phase 0 heuristic runtime + internal dogfood (weeks 1-6), Phase 1 K pre-launch benchmarking (weeks 6-8, 40-50 tasks, holdout discipline, LLM-judge panel bias mitigation), Phase 2 production telemetry ongoing, Phase 3 community learning via existing feedback-patterns infrastructure. K benchmarking happens BEFORE public launch — evidence-backed step-model matrix is v1.0 launch gate. Tier 1 methodology (regression discipline + memory-first clarification) already shipped in prior work tonight. Super-charged /wogi-onboard flagged as adjacent direction. Session transcripts from last 15 sessions authorized for usage audit. Next-session brief written to .workflow/scratch/next-session-brief-2026-04-23.md. Tomorrow: 4-task agent day producing 12-15 page consolidated planning doc; building starts day after if plan approved.
**Files**: .workflow/scratch/next-session-brief-2026-04-23.md, .workflow/roadmap.md

### R-327 | 2026-04-23 19:55
**Type**: feat
**Tags**: #task:wf-c3b5afab #epic:wf-34290000 #workstream:B #telemetry #igr
**Request**: "B7 missRate telemetry surfaced — /wogi-session-end + /wogi-health"
**Result**: Added `printGateTelemetryWatch()` to flow-session-end.js (top-3 gates by 7d missRate, flags ≥10% as rubber-stamping risk) and `printGateMissRateSummary()` to flow-health.js (one-line count of offending gates). Both consume existing `getGateStats({since:'7d'})` API — zero duplicated computation. Empty-log path prints "No telemetry yet (baseline)" gracefully. 13 new unit tests cover empty/populated/threshold-boundary (0.10 inclusive). 2033/2033 suite clean. Baseline visibility now in place for Workstream B gates (B1-B6) to measure against.
**Files**: scripts/flow-session-end.js, scripts/flow-health.js, tests/gate-telemetry-surface.test.js, .workflow/changes/wf-c3b5afab.md, .workflow/state/ready.json

### R-328 | 2026-04-23 20:35
**Type**: feat
**Tags**: #task:wf-a346c915 #epic:wf-34290000 #workstream:A #portability #agents-md
**Request**: "A1 AGENTS.md alias for CLAUDE.md — cross-tool instructions file"
**Result**: WogiFlow now generates both CLAUDE.md and AGENTS.md (byte-identical content) so projects work with any CLI coding agent that follows the emerging AGENTS.md standard (Codex, Cline, Crush, Aider). CLAUDE.md remains canonical for drift detection; AGENTS.md is a generated sibling. Extracted shared `writeGeneratedRulesFile()` helper in base-bridge.js so both paths reuse the manual-edit guard. New config flag `cli.generateAgentsMd` (default `true`) allows opt-out. Installer mirrors the same behavior in its simple-mode fallback. 10 new unit tests (all pass). 2055/2056 suite clean (1 pre-existing phase-gate race, confirmed unrelated via isolated run).
**Files**: .workflow/bridges/base-bridge.js, lib/installer.js, scripts/flow-config-defaults.js, tests/agents-md-alias.test.js, package.json, .workflow/changes/wf-a346c915.md, .workflow/state/ready.json

### R-329 | 2026-04-23 20:50
**Type**: feat
**Tags**: #task:wf-f64f58b0 #epic:wf-34290000 #workstream:A #prompt #investigation
**Request**: "A3 Reflect-on-5-7-sources pattern — broader evidence breadth before conclusion"
**Result**: Inserted "Reflect on 5-7 Independent Sources" section at Step 0.5 of /wogi-debug-hypothesis and "Evidence Inventory" subsection in Phase 2 of /wogi-bug. Both surfaces require 5 of 7 source categories (code read, grep, git log, test, log/telemetry, types, user assumption) before moving to conclusion. Downgrade clause: if N<5 sources consulted, conclusion language softens ("likely cause" vs "root cause") pending A4's 95/85/75 tier rubric. Skippable for typos / single-line obvious fixes. Prompt-only change — no code, no tests.
**Files**: .claude/commands/wogi-debug-hypothesis.md, .claude/commands/wogi-bug.md, .workflow/changes/wf-f64f58b0.md, .workflow/state/ready.json

### R-323 | 2026-04-23 21:10
**Type**: feat
**Tags**: #task:wf-2f49b292 #epic:wf-34290000 #workstream:G #workspace #manager-dispatch
**Request**: "G5 Manager-side task-ID injection into worker ready.json"
**Result**: New `lib/workspace-task-injector.js` with `injectTask()` and `injectAndDispatch()`. Writes task records into a worker's `.workflow/state/ready.json` so the manager can dispatch `/wogi-start <taskId>` for brand-new tasks. Atomic via write-to-temp + rename; idempotent on re-inject (reports `alreadyPresent`); validates task ID format, repo name, manifest membership, and path-traversal; creates `ready.json` if absent. 14 unit tests covering happy path, idempotency, validation, missing file, path traversal, concurrent writes. Design deviation from thin spec: used atomic filesystem rename instead of `workspace-locks.js` (which is task-interface-based, not file-level) — simpler and sufficient for the serialization needed. HTTP endpoint on `workspace-channel-server.js` NOT added — the injector works filesystem-direct since manager has access to worker repos via `WOGI_WORKSPACE_ROOT`; remote-worker endpoint can be added later if needed. E2E with actual channel server not unit-tested (same pattern as existing `workspace-routing` tests).
**Files**: lib/workspace-task-injector.js (new), tests/flow-workspace-task-injector.test.js (new)

### R-340 | 2026-04-24 07:40
**Type**: feat
**Tags**: #task:wf-4351400c #epic:wf-34290000 #workstream:F #skills #directory-per-skill
**Request**: "F2 Directory-per-skill with YAML frontmatter — migrate flat skills to SKILL.md"
**Result**: All user skills in `.claude/skills/` now use directory-per-skill structure with `SKILL.md` at the root: `_template/SKILL.md` (template for new skills) and `figma-analyzer/SKILL.md` (example skill).

### R-339 | 2026-04-24 07:38
**Type**: feat
**Tags**: #task:wf-f3707d2f #epic:wf-34290000 #workstream:C #repo-map #context
**Request**: "C1 Aider-style repo map — task-aware, bounded token budget, refreshed per turn"
**Result**: New `scripts/flow-repo-map.js` generates a compact repo map with three sections: TOUCHED (files the current task modifies, summary + top-level symbols), ADJACENT (files that import or are imported by the touched set), SHAPE (compressed tree of the rest of the project, names only). Bounded token budget (default 16KB ≈ 4K tokens) via `config.repoMap.budgetBytes`. Skips cleanly when output empty (no touched files yet). Wired into `.claude/docs/phases/01-explore.md:10` (Step 1 Load Context) and `.claude/docs/phases/03-implement.md:7` (regenerate at start of each coding turn). Config flags: `repoMap.enabled` (default true), `repoMap.budgetBytes`. Tests pass. Complements manual registry maps (app-map, function-map, api-map) — repo map is cheap, disposable, always-fresh.
**Files**: scripts/flow-repo-map.js (new), tests/flow-repo-map.test.js (new), .claude/docs/phases/01-explore.md (Step 1 wiring), .claude/docs/phases/03-implement.md (per-turn refresh)

### R-338 | 2026-04-24 07:35
**Type**: feat
**Tags**: #task:wf-9c9ba324 #epic:wf-34290000 #workstream:B #rule #decisions
**Request**: "B6 Empty-collection vanishing-section rule — UI/API sections must render empty state, never disappear"
**Result**: New rule "Empty-Collection Vanishing-Section Rule" added to `.workflow/state/decisions.md` with PIN `empty-collection-vanishing-section`. Rule: any UI section / list / table / report section / API response field that renders a collection MUST NOT disappear when the collection is empty — it MUST render an explicit empty state (placeholder, "No items", "0 records", `null`-with-key, `[]`) that preserves the section's presence in the output. Source-tagged to wf-9c9ba324 (B6). Read at Step 1 Load Context per the Memory Hierarchy precedence order.
**Files**: .workflow/state/decisions.md (new rule section)

### R-337 | 2026-04-24 07:34
**Type**: feat
**Tags**: #task:wf-15175dbc #epic:wf-34290000 #workstream:B #skeptical-evaluator #field-enumeration
**Request**: "B5 Skeptical-evaluator field-enumeration prompt — 3 enumeration passes before 'done' stands"
**Result**: `scripts/flow-skeptical-evaluator.js` composes a prompt with three enumeration passes: (1) **UI-field enumeration** — for every modified UI surface, list every field the spec promises and verify each appears in the implementation; (2) **API-parameter enumeration** — for every touched endpoint, list every parameter in the spec and verify handler consumption; (3) **State-key enumeration** — for every touched state file or config key, list every key the spec introduces and verify persistence. Output schema includes `uiFieldPass`, `apiParameterPass`, `stateKeyPass` with per-pass `ran` / `passed` / `failures` fields. Validating phase invocation already wired. Confidence tier + evidence tier required on every claim (A4 integration). 14/14 skeptical-evaluator tests pass.
**Files**: scripts/flow-skeptical-evaluator.js (new), tests/flow-skeptical-evaluator.test.js (new), .workflow/templates/tier3-dom-field-inventory.md (template referenced by prompt)

### R-336 | 2026-04-24 07:33
**Type**: feat
**Tags**: #task:wf-07046456 #epic:wf-34290000 #workstream:B #truth-gate #spec-bundle
**Request**: "B4 Full spec-string bundle grep rule — verify every spec-promised file/key actually ships"
**Result**: `extractSpecStrings()` + `verifySpecBundleCoverage()` + `formatSpecBundleResult()` added to `flow-completion-truth-gate.js` (lines 764, 808, 841). Extracts file paths, keys, state references from spec markdown and greps the changed file bundle to verify coverage. Per-category thresholds configurable (default: 100% file paths, 100% state keys, ≥80% prose mentions). FAIL result surfaces missing items with file:line citations. Invoked at Tier-3 verification + Skeptical Evaluator. 4/4 spec-bundle tests pass (happy path, missing files, threshold respect, formatted output).
**Files**: scripts/flow-completion-truth-gate.js (added extractSpecStrings + verifySpecBundleCoverage + formatSpecBundleResult), tests/flow-spec-bundle-grep.test.js (new)

### R-335 | 2026-04-24 07:32
**Type**: feat
**Tags**: #task:wf-f9431ef6 #epic:wf-34290000 #workstream:B #tier3 #verification-template
**Request**: "B3 Tier-3 field-inventory DOM snapshot template"
**Result**: New template `.workflow/templates/tier3-dom-field-inventory.md` codifies the Tier-3 verification artifact format for UI tasks: enumerate every DOM field the spec promises, capture the snapshot (selector + rendered value + data-testid), and attach to the task evidence bundle. Consumed by `flow-skeptical-evaluator.js` (via `TEMPLATE_PATH = path.join(PATHS.workflow, 'templates', 'tier3-dom-field-inventory.md')`) during validating phase. Satisfies Tier-3 evidence requirement for UI completion claims.
**Files**: .workflow/templates/tier3-dom-field-inventory.md (new)

### R-334 | 2026-04-24 07:31
**Type**: feat
**Tags**: #task:wf-10c452f7 #epic:wf-34290000 #workstream:B #truth-gate #bel-gate
**Request**: "B2 Completion-Truth-Gate BEL-file grep — verify spec's BEL items (Behavior/Evidence/Location) ship before status→completed"
**Result**: `parseBELItems()` added to `flow-completion-truth-gate.js` (line 868). Parses the spec's "Behavior / Evidence / Location" bundle and greps the changed-file set to verify each BEL item has landed before allowing `status→completed` transition. Blocks completion on silent drops — a BEL item in the spec but absent from the diff triggers FAIL with per-item citation. Unit-tested via `tests/flow-bel-gate.test.js`. Complements A4's confidence-tier audit (B2 verifies implementation existed; A4 grades the confidence of claims about it).
**Files**: scripts/flow-completion-truth-gate.js (added parseBELItems), tests/flow-bel-gate.test.js (new)

### R-333 | 2026-04-24 07:30
**Type**: feat
**Tags**: #task:wf-fe8ef64d #epic:wf-34290000 #workstream:B #ac-scope #story-creation
**Request**: "B1 AC Scope-Preservation Checklist — prevent silent AC drops + 2-into-1 collapses"
**Result**: New `scripts/flow-ac-scope-preservation.js` snapshots original acceptance criteria to `.workflow/state/ac-snapshots/<taskId>.json` at story creation time. At `/wogi-done`, re-verifies the snapshot against final implementation and surfaces a PRESERVED / MODIFIED / DROPPED / ADDED checklist. Blocks completion on silent drops or when two original criteria get silently collapsed into one. Invoked by /wogi-story and /wogi-bug creation flow as the 6th P0 quality gate (joining longInput, itemReconciliation, consumerImpact, scopeConfidence, intentBootstrap). 31/31 tests pass covering snapshot creation, diff computation, collapse detection, happy-path preservation.
**Files**: scripts/flow-ac-scope-preservation.js (new), tests/flow-ac-scope-preservation.test.js (new), .claude/commands/wogi-story.md (gate integration), .claude/commands/wogi-bug.md (gate integration)

### R-336 | 2026-04-24 09:10
**Type**: feat
**Tags**: #task:wf-191d5f6e #module:task-boundary-reset #module:worker-question-classifier #config:mainModeQuestionClassifier #safety-net
**Request**: "Extend Haiku question-classifier (worker-only) to also run in main mode — auto-defer task-boundary restart when AI ends turn with open question but forgot to call `flow ask`"
**Result**: Added `buildMainModePrompt()` + generalized `classifyQuestion({mode})` in `flow-worker-question-classifier.js` (worker-mode `classifyWorkerQuestion` preserved as thin wrapper — zero signature break). New `mainModeQuestionClassifier: {enabled, minConfidence, model}` config key at top level of `flow-config-defaults.js` (mirrors `workspace.aiWorkerQuestionClassifier` shape). `consumeAndTriggerRestart()` in `task-boundary-reset.js` refactored to async; new classifier block runs AFTER existing `hasPendingQuestion()` short-circuit but BEFORE wrapper preconditions. On `result.blocked: true`, auto-writes pending-question marker via `markQuestionPending()` and returns `{triggered:false, reason:'auto-deferred-question-detected'}`. Mode detection gates the new path — worker-mode behavior unchanged. Fail-open throughout (missing API key / transcript / classifier error → restart proceeds). `stop.js` entry updated to `await` the now-async call and pass `parsedInput?.transcriptPath`. New methodology-rule entry in `.workflow/templates/partials/methodology-rules.hbs` documents the contract for end users; `flow bridge sync` regenerated CLAUDE.md. 45/45 tests in the two touched suites pass (added 9 new tests for `buildMainModePrompt` + `classifyQuestion` main-mode + `consumeAndTriggerRestart` async). Full test suite 2056 passing, 0 failures. Lint clean (17 pre-existing warnings unchanged).
**Files**: scripts/flow-worker-question-classifier.js, scripts/flow-config-defaults.js, scripts/hooks/core/task-boundary-reset.js, scripts/hooks/entry/claude-code/stop.js, .workflow/templates/partials/methodology-rules.hbs, tests/flow-worker-question-classifier.test.js, tests/flow-task-boundary-reset.test.js, CLAUDE.md (regenerated), .workflow/changes/wf-191d5f6e.md (spec)

### R-332 | 2026-04-24 07:25
**Type**: feat
**Tags**: #task:wf-d0adca72 #epic:wf-34290000 #workstream:A #prompt-composer #standards #citation
**Request**: "A5 Non-negotiable-rules + filepath:line citation format — appear in every system prompt + validated"
**Result**: New fragment `.workflow/prompts/fragments/non-negotiable-rules.md` enumerates the six non-negotiables (Evidence before claim, No silent scope changes, Route every request, filepath:line citation, Destructive operations require approval, Do not invent artifacts). `flow-prompt-composer.js` loads the fragment by default with order < 10 so it appears BEFORE task-context in every composed prompt. `flow-standards-checker.js` exports three validators at line 1222+: `validateNonNegotiableFragment()` (fragment loadable + contains required tokens), `validateComposedPromptIncludesRules()` (rejects prompts without the fragment block / missing `filepath:line`), `validateHasFilepathCitation()` (regex-checks text bodies that reference code for at least one `path/to/file:line` citation). `CITATION_FORMAT_REGEX` matches `foo.js:42`, rejects bare mentions without line numbers. 12/12 tests pass (fragment loading, ordering, citation regex happy + sad paths, composed-prompt round-trip).
**Files**: .workflow/prompts/fragments/non-negotiable-rules.md (new), scripts/flow-prompt-composer.js (fragment loading order), scripts/flow-standards-checker.js (added NON_NEGOTIABLE_FRAGMENT_ID + validators at line 1222+), tests/flow-non-negotiable-rules.test.js (new)

### R-331 | 2026-04-24 07:20
**Type**: feat
**Tags**: #task:wf-258f558c #epic:wf-34290000 #workstream:A #igr #persona #logic-adversary
**Request**: "A2 Persona library at IGR Logic Adversary — amplifier stack on top of base persona"
**Result**: 5 persona amplifiers live in `.workflow/agents/personas/` (scale-skeptic, security-hawk, simplicity-champion, platform-rigor, user-advocate) + README. `PERSONA_LIBRARY` + `PERSONA_TRIGGERS` regex table in `scripts/flow-logic-adversary.js:62-71` auto-pick the amplifier at prompt-build time based on plan/title/taskId content (security keywords → security-hawk, hook/MCP → platform-rigor, concurrency/worktree → scale-skeptic, UI/onboarding → user-advocate, framework/refactor → simplicity-champion). No-trigger-match falls back to deterministic rotation by taskId hash so every taskId consistently gets the same persona (reproducible). Amplifier stacks on top of base Logic Adversary persona — does NOT change output JSON schema, honesty requirement, or degraded-mode behavior. `.workflow/agents/logic-adversary.md` documents the amplifier layering. 12/12 persona tests pass (trigger matching, rotation distribution, library integrity).
**Files**: .workflow/agents/personas/{README,platform-rigor,scale-skeptic,security-hawk,simplicity-champion,user-advocate}.md (new), .workflow/agents/logic-adversary.md (amplifier docs), scripts/flow-logic-adversary.js (PERSONA_LIBRARY + PERSONA_TRIGGERS + pickPersona), tests/flow-logic-adversary-personas.test.js (new)

### R-330 | 2026-04-24 07:15
**Type**: feat
**Tags**: #task:wf-f14dcfeb #epic:wf-34290000 #workstream:A #rubric #igr #confidence-tier
**Request**: "A4 Confidence-tier rubric (95/85/75) — reconciled with evidence tiers 0-4"
**Result**: New rubric at `.workflow/rubrics/confidence-tiers.md` defines three confidence buckets that consume the existing evidence-tier scale from `flow-runtime-verification.js`. Mapping: tier ≥3 → 95; tier 2 with 2+ obs → 95; tier 2 single obs → 85; tier 1 with ≥10 hits across ≥3 files → 95; tier 1 with 5-9 hits → 85; tier 1 with 3+ hits across 2+ files → 85; tier 1 with 1-4 isolated hits → 75 (unverified); tier 0 → 75 (unverified). 75-tier findings auto-set `flagUnverified=true` and cap severity at LOW. `computeConfidenceTier()` + `validateFindingConfidence()` exported from `flow-completion-truth-gate.js`. `/wogi-review` §2.3 appends the confidence requirement to every agent prompt (language rules: 95 assertive, 85 hedged, 75 speculative). `flow-skeptical-evaluator.js` prompt requires confidencePct on every claim and emits `unverifiedClaims[]`. Closes the A3 downgrade-clause loop ("pending A4's tier rubric"). Config toggle: `review.confidenceTiers.enabled` (default true). 24/24 confidence-tier + skeptical-evaluator tests pass. Lint clean. Documented in rubric with full reconciliation table, severity caps, and consumer-wiring diagram.
**Files**: .workflow/rubrics/confidence-tiers.md (new), scripts/flow-completion-truth-gate.js (added computeConfidenceTier + validateFindingConfidence), scripts/flow-skeptical-evaluator.js (new), .claude/commands/wogi-review.md (appended §2.3 confidence-tier block), tests/flow-confidence-tier-rubric.test.js (new), tests/flow-skeptical-evaluator.test.js (new)

### R-341 | 2026-04-24 12:55
**Type**: feat
**Tags**: #task:wf-04585518 #epic:wf-34290000 #statusline #claude-code-2.1.119
**Request**: "Surface effort.level and thinking.enabled in status line"
**Result**: Added `advanced` FORMATS preset in `flow-statusline-setup.js` that surfaces `{{effort.level}}` and `{{thinking.enabled}}` (CC 2.1.119+ stdin fields), wrapped in `{{#if}}` guards so they render empty on older CC without breaking surrounding punctuation. Extended CLI interactive prompt, `--help` text, and `--format` error message to include the new preset. Existing presets (minimal/compact/standard/detailed) untouched — users with saved configs keep theirs. Docs (`wogi-statusline-setup.md`) add the two tokens to the variable table, list CC 2.1.119+ as an optional prerequisite, and include a new "With Effort + Thinking" example format with guidance on why conditional guards matter.
**Files**: scripts/flow-statusline-setup.js, .claude/commands/wogi-statusline-setup.md
