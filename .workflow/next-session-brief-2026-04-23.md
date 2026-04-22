# Next Session Brief — 2026-04-23

**Session goal**: produce the WogiFlow Native Runtime planning doc for Tomer to review + discuss.

## Pre-work to kick off immediately on session start

Four agent tasks, launched in this order (#1 first since it feeds #2–4):

### Task 1 — Usage audit
Read last 15 Claude Code sessions from `~/.claude/projects/*/sessions/*.jsonl` + WogiFlow `request-log.md` + `.claude/settings.json` allowlists. Inventory:
- Every tool invocation frequency (Read/Edit/Write/Bash/Task/WebSearch/etc.)
- Every MCP tool invocation (figma, Playwright, atlassian, gmail, etc.)
- Every `/wogi-*` slash command used
- Session durations, models used, estimated token cost

Rank tools by usage. Flag: what Claude Code ships that user USED vs NEVER USED.
Output: `.workflow/scratch/usage-audit-2026-04-23.md`

### Task 2 — Step-model matrix analysis
Walk WogiFlow workflow steps from `.claude/docs/phases/*.md` + gate infrastructure + IGR steps. Classify each:
- reasoning-heavy / mechanical / classification / generative
- proposed default model + fallback per provider tier
- flag steps where run-twice-and-compare viable
- flag steps with hard rules (Logic Adversary MUST be different-family)

Output: `.workflow/scratch/step-model-matrix-2026-04-23.md`

### Task 3 — Architecture design
Runtime design: agent loop, tool registry, hook integration (existing `scripts/hooks/core/*.js` plug in with zero rewrite), multi-model orchestrator, provider abstraction, MCP client, simple CLI (readline + ANSI, NOT Ink).

Output: `.workflow/scratch/architecture-2026-04-23.md`

### Task 4 — Consolidated plan doc
Merge 1-3 into single planning document, 12-15 pages, structured for discussion not approval.

Sections:
1. Usage audit summary (evidence base)
2. Architecture sketch
3. Multi-model orchestrator (step-model matrix, provider-availability tiering)
4. Benchmarking methodology (40-50 tasks, holdout set, LLM-judge panel, bias mitigation)
5. Four-tier capability evolution (REVISED 2026-04-22):
   - Phase 0: heuristic runtime + internal dogfooding (weeks 1-6)
   - Phase 1: synthetic benchmarking + prompt refinement PRE-LAUNCH (weeks 6-8, $2K budget)
   - Phase 2: production telemetry post-launch (ongoing)
   - Phase 3: community-learning step-model matrix (ongoing with user base)

   **Critical correction from Tomer 2026-04-22**: $2K benchmarking happens BEFORE public launch, not eventually. Evidence-backed step-model matrix is a v1.0 launch gate, not a future refinement.
6. Privacy architecture for Phase 3 telemetry (no customer code leakage)
7. Super-charged `/wogi-onboard` as adjacent direction
8. Phase timeline + costs
9. Open questions for user

Output: `.workflow/scratch/wogiflow-native-runtime-plan-v0.md`

## Agent work budget

~10-12 hours of focused sub-agent time total. Tomer returns to completed consolidated doc for review.

## Open questions — for discussion AFTER doc ready

- Providers for v0.1: Anthropic-only vs multi-provider
- Naming: keep `wogi` or new product identity
- Phase 1 MVP scope: what's the minimum that's genuinely usable
- Timeline: push-through 2.5-3 months vs conservative 4-6 months
- Browser/Playwright: Phase 1 or 2 (awaiting usage audit)

## Locked decisions from prior session (do not re-open)

- Multi-model orchestration IS the architecture, not an add-on mode
- Benchmarking happens BEFORE public launch ($2K budget, weeks 6-8), not after
- Launch confidence requires evidence-backed step-model matrix at v1.0
- Community-learning is Phase 3 (uses existing WogiFlow feedback-patterns infrastructure)
- Provider-availability is first-class config (user declares available keys, orchestrator selects from available)
- Session transcripts from last 15 sessions authorized for reading
- Evening constraint: tomorrow is discussion day; building starts day after if plan is approved

## Tonight's leftover

- v2.26.3 expect wrapper still failing on CC 2.1.117 TUI keyboard modes (workers blocked)
  - Workaround: user to restart workers naturally, accept any manual dialog dismissals overnight
  - If this remains an issue tomorrow, it becomes a de-facto Phase 0 deliverable: the native runtime eliminates the dialog entirely by not launching claude-with-dev-channels
- Epic wf-94cc3b72 partial completion (Wave A + 2 of Wave B done; 7 stories deferred)
- Test-pollution bug in `flow-hooks-phase-gate.test.js` captured for later
