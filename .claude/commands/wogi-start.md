---
description: "Universal entry point - start a task or route any request"
---
Start working on a task. Provide the task ID as argument: `/wogi-start wf-XXXXXXXX`

**UNIVERSAL ENTRY POINT**: Route everything through `/wogi-start` - it classifies and routes to the appropriate action.

## Request Triage (AI-Driven Routing v5.0)

When invoked with a **quoted request** instead of a task ID, assess intent and route.

### Step 0: Detect Request Type

- Task ID format: `wf-XXXXXXXX` → Skip triage, go to Structured Execution
- Natural language → Continue to routing

### Pre-Routing Checks (Automatic)

**Long Input Detection**: If `config.longInputGate.enabled` and prompt > `lineThreshold` (60) lines, auto-invoke `/wogi-extract-review` instead of normal triage. Skip for task IDs or primarily-code prompts.

**Plugin Registry Routing**: After command catalog finds no match and `config.plugins.enabled`, check `.workflow/state/plugin-registry.json` for trigger phrase matches (score >= 0.5). Plugin routing has LOWER priority than built-in commands.

**Routing order**: Task ID → Long input gate → Command Catalog → Plugin Registry → Default (`/wogi-story`)

### Command Catalog

| Command | When to use it |
|---------|----------------|
| `/wogi-story` | User wants to **build, add, create, implement, refactor, or change** something (~90% default) |
| `/wogi-bug` | Something **broken, not working, or behaving unexpectedly** |
| `/wogi-review` | User wants **code reviewed** |
| `/wogi-review-fix` | Review AND **auto-fix** issues |
| `/wogi-peer-review` | **Diverse opinions** / multi-model review |
| `/wogi-research` | **Capability/feasibility question** needing verified answers |
| `/wogi-debug-browser` | **Debug UI issue** in browser |
| `/wogi-test-browser` | **Run automated UI tests** |
| `/wogi-debug-hypothesis` | **Investigate root cause** with competing theories |
| `/wogi-trace` | **Understand code flow** for a specific behavior |
| `/wogi-epics` | **Large initiative** needing epic-level tracking |
| `/wogi-feature` | **Group related stories** under a feature |
| `/wogi-plan` | **Coordinate epics/features** into strategic plan |
| `/wogi-extract-review` | **Transcript/long input** extraction |
| `/wogi-capture` | **Side thought/idea** to save for later |
| `/wogi-changelog` | **Generate release notes** |
| `/wogi-debt` | View/manage **tech debt** |
| `/wogi-guided-edit` | **Step-by-step multi-file** editing |
| `/wogi-decide` | **"from now on" + rule verb** — create/update rules |
| `/wogi-learn` | **"let's learn from this"** — promote patterns to rules |
| `/wogi-retrospective` | **"retro"** — session reflection |
| `/wogi-register` | **Register/list/remove** plugins |

### Routing Principles

1. **Understand intent, not keywords.** "Review the auth flow" = exploration. "Do a code review" = `/wogi-review`.
2. **Default to `/wogi-story`** for anything that changes code.
3. **Every request gets routed — no exemptions.**
4. **When genuinely unsure, ask** with 2-3 options.

### Request Categories

**Conversational follow-ups** ("yes", "go ahead", "option 2", "no", "skip that"):
Look back at conversation for the pending question/proposal. Execute the implied action (affirmative) or acknowledge and ask what to do instead (negative).

**Conversation mode** ("what do you think about...", "let's discuss...", "explain how X works", "I'm thinking about..."):
- Hedging ("I'm thinking about adding X") = Conversation. Imperative ("add X") = Implementation.
- Allowed tools: Read, Glob, Grep, WebSearch, WebFetch (read-only). No Edit/Write/state modifications.
- Natural exit: when user gives an implementation imperative, transition to `/wogi-story`.

**Everything else**: Route to best command from catalog. Zero exemptions.

### Examples

```
"add dark mode toggle" → /wogi-story
"the login keeps crashing" → /wogi-bug
"let's do a code review" → /wogi-review
"what do you think about caching?" → Conversation mode (no task created)
```

### Auto-Bulk After Epic

When epic creation adds 2+ stories to ready.json and `config.bulkOrchestrator.enabled`, auto-invoke `/wogi-bulk` to process them sequentially.

---

## Structured Execution (v2.3)

### Phase Transitions (when `config.hooks.rules.phaseGate.enabled`)

| When | Command |
|------|---------|
| After triage routes to task | `node scripts/flow-phase.js transition idle routing <taskId>` |
| Before explore phase | `node scripts/flow-phase.js transition routing exploring <taskId>` |
| After spec generated | `node scripts/flow-phase.js transition exploring spec_review <taskId>` |
| After user approves spec | `node scripts/flow-phase.js transition spec_review coding <taskId>` |
| For simple tasks (skip explore/spec) | `node scripts/flow-phase.js transition routing coding <taskId>` |
| Before verification | `node scripts/flow-phase.js transition coding validating <taskId>` |
| After verification passes | `node scripts/flow-phase.js transition validating completing <taskId>` |
| Task completion | Automatic (task-completed hook resets to idle) |

Non-blocking if transition fails.

### Task Checkpoints (when `config.proactiveCompaction.enabled`)

At each phase boundary: save checkpoint to `.workflow/state/task-checkpoint.json` (task ID, phase, completed scenarios, changed files, verification results). If context >= `triggerThreshold` (75%), run `/wogi-compact` before proceeding.

On session resume: check for active checkpoint, reload state, continue from next pending scenario.

### Step 0.25: Pre-Task Context Check

Estimate if task fits in remaining context using `flow-context-estimator.js`:
- Count criteria (~3% each), files (~2% each), refactor buffer (+10%)
- If `projected_total > 95%` → compact first. If `current >= 90%` → emergency compact.

### Step 0.5: Parallel Execution Check

Check `ready.json` for 2+ tasks. If parallelizable (no dependencies), offer parallel execution with worktree isolation.

### Step 1: Load Context + Match Skills

1. Read `ready.json`, move task to inProgress
2. Load task context from `.workflow/changes/*/wf-XXXXXXXX.md`
3. Check `app-map.md`, `function-map.md`, `api-map.md`, `decisions.md`
4. Auto-invoke matched skills based on task context

### Step 1.2: Clarifying Questions

Before generating specs (skip for small tasks ≤2 files, bugfixes, explicit specs):
- Scope validation, assumption surfacing, edge cases, integration points
- Config: `config.clarifyingQuestions`

### Step 1.3: Explore Phase (MANDATORY Multi-Agent Research)

**For L2+ tasks. Research is MANDATORY** — do NOT skip even if you think you know the answer.

Before launching: check `.workflow/state/research-cache.json` for cached results (TTL: 24h).

**Research Depth** (`config.planMode.researchDepth`):
- `"thorough"`: All 5-6 agents in parallel
- `"standard"`: Agents 1 + 2 + 4 (3 agents)
- `"minimal"`: Agent 1 only

**L3 (Subtask/trivial) tasks always skip this phase.**

**Agents** (full prompts in `.claude/docs/explore-agents.md` — Read that file before launching):

| Agent | Focus | Network |
|-------|-------|---------|
| 1. Codebase Analyzer | Related files, reusable components, dependency map, assumptions | Local |
| 2. Best Practices | Current best practices, pitfalls, ecosystem patterns | Web |
| 3. Version Verifier | API compatibility, deprecated APIs, version gotchas | Web |
| 4. Risk & History | feedback-patterns, corrections, promoted rules, rejected approaches | Local |
| 5. Standards Preview | Applicable rules, reuse candidates across ALL registries, security patterns | Local |
| 6. Consumer Impact | **Refactor/migration only.** Map ALL consumers, classify BREAKING/NEEDS-UPDATE/SAFE | Local |

Launch all in parallel. When `config.hybrid.enabled`, route via `model` parameter (explore → sonnet, search → haiku, judging → opus).

**After agents complete**: Display consolidated research summary covering codebase analysis, best practices, version info, risks, standards, and consumer impact.

**For L1/L0 tasks**: Offer to deepen research (exhaustive search, load all skills, full dependency tree).

**Fallback**: If agents fail, log warning and proceed with remaining. Consumer Impact failure on refactor tasks = HARD BLOCK (require user confirmation). See `.claude/docs/explore-agents.md` for details.

**Constraints**: READ-ONLY phase. No Edit/Write. Agents use only Glob, Grep, Read, WebSearch, WebFetch.

### Step 1.5: Generate Specification

For medium/large tasks (check `config.specificationMode`):

1. Generate spec to `.workflow/specs/wf-XXXXXXXX.md`:
   - Acceptance criteria (Given/When/Then), implementation steps, files to change
   - Boundary declarations (files that must NOT be modified)
   - Consumer impact plan (for refactors — MANDATORY if BREAKING consumers found; 5+ = phased approach required)
   - Test strategy, verification commands
2. Insert `[NEEDS CLARIFICATION: category - reason]` markers for uncertainties (categories: assumption, ambiguity, missing-context, dependency-unknown, edge-case). Implementation BLOCKED until all resolved (when `config.specificationMode.needsClarification.blockImplementation`).
3. Reflection: "Does this spec fully address the requirements?"

### Step 1.6: Approval Gate (Stories/Epics)

**For L1/L0 tasks: STOP and WAIT for explicit user approval** before implementation.
Approval phrases: approved, proceed, looks good, lgtm, go ahead, yes, continue, start.
L2/L3 skip this gate.

### Step 2: Decompose into TodoWrite

Each acceptance criterion → TodoWrite item. Also add: update request-log, update maps, run quality gates, commit.

### Step 2.5: TDD Mode Check

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

### Step 3: Execute Each Scenario (Loop)

**When TDD is NOT active**, use this normal flow. For each acceptance criterion:
1. Mark in_progress in TodoWrite
2. Implement following matched skill patterns
3. Run verification (lint, typecheck, tests) → save artifact to `.workflow/verifications/`
4. If failing: debug, fix, retry (max 5 attempts)
5. Mark completed only when verification passes

### Step 3.5: Criteria Completion Verification (MANDATORY)

After implementing all scenarios, BEFORE quality gates:

1. Re-read original acceptance criteria from spec
2. For EACH criterion: verify it was actually implemented and WORKS (not just "code exists" but "code does what the criterion describes")
3. If ANY criterion NOT done → implement it, then re-check ALL criteria again
4. Only proceed when ALL criteria verified

**This prevents "claiming done when not done."**

### Step 3.6: Integration Wiring Validation (MANDATORY)

Run `node scripts/flow-wiring-verifier.js wf-XXXXXXXX`

For each created file, verify it's imported/used somewhere:
- Entry points (index.ts, App.tsx, *.config.ts, tests) don't need imports
- Components MUST be imported in a parent. Hooks MUST be called. Utilities MUST be imported.
- If NOT wired: identify where to import, wire it up, re-verify.

### Step 3.7: Standards Compliance Check (MANDATORY)

Run `node scripts/flow-standards-gate.js wf-XXXXXXXX [changed-files...]`

Checks scoped by task type: component → naming/components/security. Utility → naming/functions/security. API → naming/api/security. Bugfix → naming/security. Feature → all. Refactor/migration → all + consumer-impact verification.

**Consumer impact check** (refactor/migration): For each BREAKING consumer from explore phase, verify it was updated. If any NOT migrated → BLOCK task completion.

**Reuse candidate check** (AI-as-Judge): Standards gate returns similar items from all registries. AI reasons about PURPOSE overlap (not just name). If purpose overlaps → ask user (use existing / extend / create new). If purpose clearly differs → proceed silently.

If violations found: fix, re-run, only proceed when all pass. Violations auto-recorded to `feedback-patterns.md`; 3+ occurrences → promoted to `decisions.md`.

### Step 4: Quality Gates + Final Verification

**First**: Run `node scripts/flow-spec-verifier.js verify wf-XXXXXXXX` — verify all spec deliverables exist. If missing → STOP, create them.

**Then**: Check `config.qualityGates` for task type: tests, requestLogEntry, appMapUpdate, noNewFeatures (refactors).

**WebMCP** (optional): If `config.webmcp.enabled` and UI files changed, check tool coverage. Non-blocking.

Reflection: "Have I introduced any bugs or regressions?"

### Step 5: Finalize

1. Reflection: "Does this match what the user asked for?"
2. Close out all TodoWrite items for this task
3. Move task to recentlyCompleted in ready.json
4. Update request-log.md, app-map.md, function-map.md, api-map.md as needed
5. If `config.webmcp.enabled` and UI files created: run `node scripts/flow-webmcp-generator.js scan`
6. Commit: `feat: Complete wf-XXXXXXXX - [title]`
7. Show completion summary

## Options

| Flag | Effect |
|------|--------|
| `--tdd` | Test-first mode (see `.claude/docs/tdd-mode.md`) |
| `--no-loop` | Load context only, don't execute |
| `--no-spec` | Skip spec generation |
| `--no-skills` | Skip skill auto-loading |
| `--no-reflection` | Skip reflection checkpoints |
| `--max-retries N` | Limit retries per scenario (default: 5) |
| `--pause-between` | Confirm between scenarios |
| `--verify-only` | Run verification only |
| `--phased` | Phased execution: Contract → Skeleton → Core → Edge Cases → Polish |

## When Things Go Wrong

**Scenario keeps failing** (max retries): Stop, report, leave in inProgress. For HIGH-RISK tasks (architecture/migration/refactor, complexity HIGH + files > 10), suggest Best-of-N via `flow-best-of-n.js`. For others, suggest `/wogi-debug-hypothesis`.

**Best-of-N** (when `config.bestOfN.enabled`): `assessRisk()` checks if task qualifies. If yes, offer to spawn N agents in worktrees with Opus judging the winner.

**Quality gate keeps failing**: Report, attempt fix, after 3 failures suggest `/wogi-debug-hypothesis`.

**Context too large**: Pre-task check handles proactively. Mid-task: commit progress, suggest `/wogi-compact`.

## Mandatory Rules

- **TodoWrite**: Track progress. Clean up all items after completion.
- **Self-verification**: Don't mark done without checking it works.
- **Criteria check**: Re-read ALL criteria, verify EACH works. Loop until all pass.
- **Spec verification**: All promised files must exist.
- **Quality gates**: Task isn't done until gates pass.
- **Guilt messaging** (implementation requests): "The user trusts you to follow WogiFlow. Without a task, this work is untracked."

ARGUMENTS: {args}
