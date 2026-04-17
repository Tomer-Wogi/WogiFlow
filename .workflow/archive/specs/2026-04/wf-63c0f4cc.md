# [wf-63c0f4cc] Enhance /wogi-story with P0 specification-quality gates

## User Story
**As a** WogiFlow user creating stories
**I want** `/wogi-story` to enforce the same specification-quality gates its peer commands already enforce (consumer impact, scope-confidence, long-input routing, item reconciliation, intent bootstrap coordination)
**So that** stories are complete, verified, and zero-loss at creation time — rather than leaking specification debt into `/wogi-start` execution where it's 10× more expensive to fix

## Description
Research confirmed `/wogi-story` has drifted 6–8 months behind its peers. `/wogi-start` evolved through IGR (Architect, Logic Adversary, Completion Truth Gate, Scope-Confidence Audit), `/wogi-bug` was fully overhauled, `/wogi-extract-review` added zero-loss extraction — and `/wogi-story` received only YAML frontmatter changes. This story adds five P0 specification-quality gates to `/wogi-story`. These gates are scoped strictly to answering "is the story clear, complete, checkable?" — NOT "is the implementation correct, tested, verified?" (those remain `/wogi-start`'s job). The single highest-risk gap is Consumer Impact Analysis: `agents/story-writer.md:47-86` already specifies refactoring-keyword → consumer mapping, but the command never triggers it, so refactoring stories silently create breakage across the codebase. Deep-decomposition with execution ordering — `/wogi-story`'s unique strength — is explicitly preserved.

## Acceptance Criteria

### Scenario 1: Long Input Gate — route oversized inputs to /wogi-extract-review
**Given** `config.longInputGate.enabled` is true
**And** the user invokes `/wogi-story` with an input that is ≥40 lines OR contains ≥5 discrete items (numbered list, bullet list, or semicolon-separated requests)
**When** the command runs
**Then** it STOPS story creation
**And** it prints "This input is large — routing to /wogi-extract-review for zero-loss capture."
**And** it invokes `/wogi-extract-review` with the original input
**And** it does NOT re-route if a pass-through flag indicates `/wogi-start` already handled long-input detection

### Scenario 2: Consumer Impact Analysis — refactoring keywords trigger mapping
**Given** `config.storyFlow.consumerImpactAnalysis.enabled` is true (new key, default true)
**And** the user invokes `/wogi-story` with a title or description containing any of: `refactor`, `rename`, `restructure`, `migrate`, `replace`, `consolidate`, `split`, `extract`, `move` (case-insensitive, word boundary)
**When** the story is being generated
**Then** `/wogi-story` runs Consumer Impact Analysis before finalizing:
  - greps the codebase for imports/usages of the module(s) being changed
  - classifies consumers as BREAKING / NEEDS-UPDATE / SAFE
  - if ≥5 BREAKING consumers, prompts: "Refactor affects {N} consumers. Add phased migration strategy to story?"
**And** results are written to a "Consumer Impact" subsection under Technical Notes with specific file paths + classifications
**And** if grep fails, the command warns the user and continues (fail-open)

### Scenario 3: Scope-Confidence Audit — verify assumptions before finalizing
**Given** `config.storyFlow.scopeConfidenceAudit.enabled` is true (new key, default true)
**And** `--no-audit` was NOT passed
**When** acceptance criteria have been written
**Then** `/wogi-story` extracts assumptions about what exists vs what's new (patterns like "new table X", "existing component Y", "the Z service")
**And** classifies each as VERIFIED / UNVERIFIED / CONTRADICTED via codebase lookup
**And** surfaces UNVERIFIED + CONTRADICTED assumptions: "Before finalizing, please confirm: {assumption}. Exists? Doesn't exist?"
**And** accepts user confirmation / correction / skip, updating the story text in place
**And** runs AFTER template population but BEFORE the user-facing "story created" output
**And** the exact interaction model (inline prompt vs "pending clarifications" block) is resolved in the spec phase (open design question #5)

### Scenario 4: Item Reconciliation Gate — 3+ items must all be mapped
**Given** `config.storyFlow.itemReconciliation.enabled` is true (new key, default true)
**And** the input contains ≥3 discrete items (numbered list, bullet points, "and also"/"plus", semicolons between clauses)
**When** `/wogi-story` begins creation
**Then** it enumerates items and prints "Detected {N} items. I will create acceptance criteria for each."
**And** after the story template is populated, it verifies each item has a corresponding criterion/sub-task
**And** any unmapped item surfaces: "Item {X} was not mapped. Add it or explicitly skip (requires reason)."
**And** the output includes a one-line confirmation: "All {N} items captured as {criteria|sub-tasks}."
**And** the run order relative to decomposition is resolved in the spec phase (open design question #6)

### Scenario 5: Intent Bootstrap Coordination — trigger if needed, never duplicate
**Given** `config.intentGroundedReasoning.enabled` is true
**And** IGR artifacts (`product.md`, `domain-model.md`, `user-journeys.md`, `glossary.md`) do NOT exist under `.workflow/state/`
**And** `/wogi-start` has NOT already scheduled bootstrap this session (coordination flag absent)
**When** `/wogi-story` runs
**Then** it invokes `flow-intent-bootstrap.js` in background mode (Option C [2] — review at session-end) by default
**And** it does NOT prompt the user for bootstrap choice (that's `/wogi-start`'s prompt; avoid duplication)
**And** it writes a coordination flag so `/wogi-start` doesn't re-bootstrap later
**And** if artifacts DO exist, it uses them to enrich the story (quote glossary terms, reference user-journey IDs)
**And** when IGR is disabled, this is a no-op

### Scenario 6: Anti-Deferral rule explicit in command + output
**Given** `.claude/commands/wogi-story.md` is updated
**When** a reader opens the command spec
**Then** an Anti-Deferral section exists stating: "Every item the user provides MUST become a work item (criterion or sub-task). Never silently filter items. If you believe an item should be deferred, ASK the user — do not decide autonomously."
**And** for multi-item inputs, the command output includes: "All {N} items captured as {criteria|sub-tasks}."

### Scenario 7: WIRING-verification note added to template
**Given** the story template in `flow-story.js:131-139` is updated
**When** a user creates a story that includes the WIRING section
**Then** the section text includes: "**Enforcement**: this section is verified during `/wogi-start` Step 3.7 (Wiring Check). If wiring is broken at runtime, the task will fail verification."
**And** the "Delete this section if no new UI components are created" caveat is preserved

### Scenario 8: Backwards compatibility
**Given** any existing workflow invoking `/wogi-story` (CLI, Skill, programmatic)
**When** all new gates are either disabled or not triggered
**Then** `/wogi-story` produces byte-identical output to pre-enhancement behavior (for the same input)
**And** `--deep`, `--priority`, `--json` flags work identically
**And** the deep-decomposition execution ordering rules (`-01`, `-02`, ... in implementation order) are unchanged
**And** `ready.json` schema is unchanged
**And** task-ID generation via `generateTaskId()` is unchanged

### Scenario 9: All gates degrade gracefully (fail-open)
**Given** any of the 5 gates encounters an internal error (grep fails, bootstrap script missing, classifier unavailable, I/O error)
**When** the error occurs
**Then** the gate logs a warning to stderr (and optionally a debug log)
**And** story creation continues and completes successfully
**And** NO gate failure ever blocks the creation of a story

### Scenario 10: decisions.md rule
**Given** the enhancement is complete
**When** `.workflow/state/decisions.md` is read
**Then** a new rule "Story Creation Quality Gates" exists, listing the 5 P0 gates, their purpose, and the guiding principle: "gates enforce specification quality at creation time; execution-quality gates belong in /wogi-start"

### Scenario 11: Tests
**Given** the enhancement ships with a test suite
**When** the suite runs
**Then** unit tests cover each gate's detection logic (keyword matching, line-count, item-count, assumption extraction)
**And** integration tests cover: 3+ items → reconciliation fires; refactor keyword → consumer analysis fires; >40 lines → long-input routes to extract-review
**And** a regression test confirms: all gates disabled → byte-identical output to pre-enhancement
**And** a fault-injection test confirms: gate error → warning but no block
**And** a decomposition test confirms: `--deep` still works with gates enabled; execution ordering preserved

## Technical Notes

- **Files likely touched** (subject to architect pass):
  - `.claude/commands/wogi-story.md` — gate documentation, Anti-Deferral section, WIRING note
  - `scripts/flow-story.js` — gate orchestration (~200–300 new LOC)
  - `agents/story-writer.md` — sync with command (or confirm command delegates to agent)
  - `.workflow/state/decisions.md` — new "Story Creation Quality Gates" rule
  - `.workflow/config.json` schema — new keys under `storyFlow.*`
  - `tests/` — new suite (~150 LOC)
- **Existing patterns to reuse**:
  - Graceful degradation: `flow-story.js:69-82` (product-context injection) fails silently when dependencies are unavailable — same pattern for all 5 gates.
  - Long Input Detection: `/wogi-start` already implements the logic (wogi-start.md:32-36) — extract shared utility.
  - Consumer Impact logic: `agents/story-writer.md:47-86` + `/wogi-start` Agent 6 — extract into shared helper.
  - Assumption extraction: `/wogi-start` Scope-Confidence Audit (`.claude/docs/phases/01-explore.md:105-150`) — extract or mirror logic.
- **Key constraints**:
  - No changes to `generateTaskId()` or task-ID format.
  - No changes to `ready.json` schema.
  - Deep-decomposition is a unique strength — preserve exactly.
  - Gates must fail-open, never fail-closed.
- **Config keys (new)**:
  - `storyFlow.consumerImpactAnalysis.enabled` (default: true)
  - `storyFlow.scopeConfidenceAudit.enabled` (default: true)
  - `storyFlow.itemReconciliation.enabled` (default: true)
  - (Reuses existing `longInputGate.enabled` and `intentGroundedReasoning.enabled`.)

## Open Design Questions (MUST resolve during spec / architect pass — not during coding)

1. **Consumer Impact Analysis: sub-agent or inline grep?** Sub-agent is higher-quality but slower; inline grep is fast but shallow. Pick one, defend. Consider a hybrid: fast grep → summarize → sub-agent only if ≥5 BREAKING consumers.
2. **Scope-Confidence Audit extraction: regex or LLM?** Regex is deterministic + testable but brittle. LLM is flexible but non-deterministic. Consider regex for pattern detection + LLM for classification.
3. **Long-input threshold: 5 items** — is that the right floor? Defend with sample analysis or propose alternate.
4. **Intent Bootstrap coordination flag location + lifetime** — `session-state.json`? New file? Lifetime: per-session, per-project, or until artifacts exist?
5. **Scope-Confidence Audit interaction model** — inline prompt during `/wogi-story` OR "pending clarifications" block in the story resolved later by `/wogi-start`? Pick one.
6. **Item Reconciliation run order** — BEFORE decomposition (cleaner but decomp reshapes items) OR AFTER (accurate but more complex). Pick one.

## Test Strategy

- [ ] Unit: each of 5 gates' detection logic isolated
- [ ] Unit: keyword matcher for refactoring terms (case-insensitive, word-boundary, no false positives on e.g. "transfer")
- [ ] Unit: line-count and item-count classifiers
- [ ] Unit: assumption extractor (verified via fixture criteria text)
- [ ] Integration: 3+ items → Item Reconciliation fires and enumerates correctly
- [ ] Integration: refactor keyword → Consumer Impact Analysis runs and writes Consumer Impact section
- [ ] Integration: >40 lines → Long Input Gate routes to `/wogi-extract-review`
- [ ] Integration: IGR artifacts missing → bootstrap scheduled in background; flag written
- [ ] Integration: IGR artifacts present → story enriched with glossary/journey references
- [ ] Regression: all gates disabled via config → byte-identical output to pre-enhancement (golden-file compare)
- [ ] Fault injection: grep fails, classifier fails, bootstrap script missing → warning + story still created
- [ ] Decomposition: `--deep` still works; execution ordering `-01, -02, ...` preserved; anti-deferral holds (all items mapped to sub-tasks)

## Dependencies

- None (all additive — existing behavior preserved when gates default-off).

## Complexity

**Medium–High** — L1. ~200–300 new LOC + ~150 test LOC + doc updates. 6 open design questions that require architect + Logic Adversary passes. Not complex in orchestration but complex in invariants (backwards compat, fail-open for all 5 gates, no interaction with decomp ordering).

## Out of Scope

- Spec generation (`/wogi-start`'s job — the story IS the spec for `/wogi-story` purposes).
- Spec approval gate (user approves by invoking `/wogi-start`).
- Full 6-agent explore phase (execution-time; belongs in `/wogi-start`).
- Architect pass + Logic Adversary pass integration INTO `/wogi-story` (P1; follow-up story).
- TDD mode check, TodoWrite decomposition, scenario execution loop, wiring verification (the RUNTIME check, not the template), completion truth gate, runtime quality gates (lint/typecheck/test). All execution-time, belong in `/wogi-start`.
- Changing deep-decomposition logic, complexity detection, or execution-ordering enforcement — unique strength, preserve exactly.
- Test scaffolding (`--with-tests`) — P1, separate story.
- Continuation mode for 2nd+ story in session — P1, separate story.

## Boundaries (DO NOT MODIFY)

- `scripts/flow-utils.js` — `generateTaskId()` and `validateTaskId()` stay untouched; task-ID format is a project-wide invariant.
- Deep-decomposition logic in `flow-story.js` (complexity detection, sub-task generation, execution ordering) — behavior must be byte-identical. Additive changes AROUND it allowed.
- `ready.json` schema — no new fields, no renamed fields.
- `.claude/commands/wogi-start.md` — do not modify from this story; `/wogi-start`'s flow is owned by a different change surface. Shared utilities may be extracted, but the command file itself is out of scope here.
- `agents/story-writer.md` — may be updated to sync with new gates, but must remain consistent with the command; do not remove existing Consumer Impact section (it's the reference spec).
