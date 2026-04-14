# Phase: Spec Generation + Approval (Steps 1.55–2.5)

Instructions for the spec/approval phase. Loaded on-demand when phase transitions to `spec_review`.

## Step 1.55: Architect Pass (when `config.intentGroundedReasoning.enabled`)

**Conditional** — runs for L1+ tasks when IGR on. L3 skip. L2 runs only on ultrathink auto-bump.

Spawn a **read-only sub-agent** (Explore subagent_type, with Read/Grep/Glob only — no Edit/Write/Bash) on a model chosen per `config.intentGroundedReasoning.architectPass.modelOverride`. Input: Framing Artifact from Step 1.15 + explore findings from Step 1.3 + scope-confidence audit from Step 1.45 + the Logic Constitution v1 rubric (so the Architect anticipates the Adversary's checks).

Build the prompt via `node scripts/flow-architect-pass.js prompt <task>`. Invoke via Agent tool. Output: an 8-section plan at `.workflow/plans/{taskId}.md` (PINs: approach, data-model, journey-impact, net-new, alternatives, risks, reversibility, dependencies). Parse via `parsePlanArtifact()`; if structural FAIL, re-prompt.

Consumed by Step 1.57 (Adversary) and Step 1.5 (Spec Generator uses the plan as input).

When IGR flag is OFF: SKIPPED. Pipeline proceeds from Step 1.45 directly to Step 1.5.

## Step 1.57: Logic Adversary Pass (when `config.intentGroundedReasoning.enabled`)

**Conditional** — runs for L0/L1 tasks by default when IGR on. Also fires for L2 when ultrathink auto-bump applies.

Spawn a **separate sub-agent on a different model** than the Architect (Sonnet when Architect is Opus; Opus when Architect is Sonnet — per `modelSeparation: different-from-architect`). Per Anthropic harness research, same-model self-critique is a known rubber-stamp failure mode.

Build the prompt via `node scripts/flow-logic-adversary.js prompt .workflow/plans/{taskId}.md`. The Adversary critiques the plan against the 10-principle Logic Constitution v1 with few-shot calibration examples from `.workflow/state/adversary-calibration.json`.

Iteration loop (max 3 rounds by default):
- `overallVerdict: PASS` or `PASS_WITH_CONCERNS` → proceed to Step 1.5. Concerns surface at approval gate (Step 1.6).
- `overallVerdict: NEEDS_REVISION` → feed `criticalIssues` back to Architect (Step 1.55 re-run); Adversary re-evaluates.
- `overallVerdict: FAIL` after max rounds → block, move task to `blocked` in ready.json with `blockReason: "adversary-max-rounds-fail"`, surface to user.

Record telemetry (`gateId: logic-adversary`) on every round.

When IGR flag is OFF: SKIPPED. Pipeline proceeds from Step 1.55 (or 1.45 if 1.55 also off) to Step 1.5.

## Step 1.5: Generate Specification

For medium/large tasks (check `config.specificationMode`):

1. Generate spec to `.workflow/specs/wf-XXXXXXXX.md`:
   - Acceptance criteria (Given/When/Then), implementation steps, files to change
   - Boundary declarations (files that must NOT be modified)
   - Consumer impact plan (for refactors — MANDATORY if BREAKING consumers found; 5+ = phased approach required)
   - Test strategy, verification commands
2. Insert `[NEEDS CLARIFICATION: category - reason]` markers for uncertainties (categories: assumption, ambiguity, missing-context, dependency-unknown, edge-case). Implementation BLOCKED until all resolved (when `config.specificationMode.needsClarification.blockImplementation`).
3. Reflection: "Does this spec fully address the requirements?"

**Batch fix spec requirement**: When a task contains 3+ discrete items (e.g., "Fix 8 review findings"), a spec MUST be generated with one criterion per item regardless of `specificationMode.minTaskLevel`. Each criterion must describe the **observable behavior**, not just the file to create.

- BAD: "Create TokenBlacklistService"
- GOOD: "When an admin changes a user's role, the user's next API request returns 401 'Token has been revoked'"

Behavior-level criteria force end-to-end chain verification in Step 3.5/3.52.

## Step 1.6: Approval Gate (Stories/Epics)

**For L1/L0 tasks: STOP and WAIT for explicit user approval** before implementation.
Approval phrases: approved, proceed, looks good, lgtm, go ahead, yes, continue, start.
L2/L3 skip this gate.

## Step 1.7: Test Generation (when `config.testing.enabled` and `config.testing.generation.autoGenerate`)

When testing is enabled and auto-generation is on:
1. Run `node node_modules/wogiflow/scripts/flow-test-generate.js wf-XXXXXXXX` to parse spec and generate test scaffolds
2. Review output: number of test files created, criteria coverage, edge cases
3. If tests were generated, add "Make generated tests pass" to TodoWrite items in Step 2
4. During implementation (Step 3), verify generated tests fail before implementation and pass after
5. If `testing.generation.autoGenerate: false` or `testing.enabled: false`, skip this step entirely

## Step 2: Decompose into TodoWrite

Each acceptance criterion → TodoWrite item. Also add: update request-log, update maps, run quality gates, commit.

## Step 2.5: TDD Mode Check

When `config.tdd.enforced` is true OR `--tdd` flag is used, the execution loop switches to test-first order. Also auto-enables for task types listed in `config.tdd.defaultForTypes` (e.g., `["bugfix"]`).

**TDD Execution Loop** (replaces normal Step 3 when active):

For each acceptance criterion:
1. Mark in_progress in TodoWrite
2. **Write test** for this criterion (Given/When/Then → test assertion)
3. **Run test → MUST FAIL** (proves test is meaningful). If it passes before implementation → WARNING: test may be trivial
4. **Implement** the feature/fix following matched skill patterns
5. **Run test → MUST PASS**. If still fails → debug and fix (max 5 retries)
6. **Run full verification** (lint, typecheck, all tests)
7. **Save TDD artifact** to `.workflow/verifications/` with before/after test results
8. Mark completed only when all tests pass

Test framework auto-detected from package.json: jest, vitest, mocha, tap, or fallback `node --test`.
