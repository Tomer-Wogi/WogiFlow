---
description: "Universal entry point - start a task or route any request"
effort: medium
---
Start working on a task. Provide the task ID as argument: `/wogi-start wf-XXXXXXXX`

**UNIVERSAL ENTRY POINT**: Route everything through `/wogi-start` - it classifies and routes to the appropriate action.

## Request Triage (AI-Driven Routing v5.0)

When invoked with a **quoted request** instead of a task ID, assess intent and route.

### Step 0: Detect Request Type

- Task ID format: `wf-XXXXXXXX` → Skip triage, go to Structured Execution
- Natural language → Continue to routing

### Pre-Routing Checks (Automatic)

**Long Input Detection**: If `config.longInputGate.enabled` and EITHER:
- Prompt > `lineThreshold` (40) lines, OR
- Prompt contains 5+ discrete items (numbered lists, bullet points, semicolon-separated requests)

→ Auto-invoke `/wogi-extract-review` instead of normal triage. This ensures zero-loss extraction of every item. Skip for task IDs or primarily-code prompts.

**Plugin Registry Routing**: After command catalog finds no match and `config.plugins.enabled`, check `.workflow/state/plugin-registry.json` for trigger phrase matches (score >= 0.5). Plugin routing has LOWER priority than built-in commands.

**Plugin Mode-Aware Routing** (when a plugin match is found):
- **Standalone** (`mode: 'standalone'`): If `config.plugins.standaloneBypassTask` is true, skip task creation. Clear routing flag, let the AI use the plugin directly. Log the action with `#plugin:<name>` tag by running `node -e "require('wogiflow/scripts/flow-plugin-registry').logPluginAction({pluginName:'<name>',action:'<action>',mode:'standalone'})"`.
- **Flow-integrated** (`mode: 'flow-integrated'`): Requires an active task. If no task is in progress, route to `/wogi-story` first. The plugin becomes available during its declared `flowPhases` (injected via phase context prompt).
- **Trigger** (`mode: 'trigger'`): Route to the appropriate `/wogi-*` command based on the trigger type (error triggers → `/wogi-bug`, deployment triggers → `/wogi-story`, PR triggers → `/wogi-review`). The plugin action feeds INTO WogiFlow routing.

**Routing order**: Task ID → Long input gate → Command Catalog → Plugin Registry (mode-aware) → Default (`/wogi-story`)

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

**Conversational follow-ups** ("yes", "go ahead", "continue", "option 2", "no", "skip that"):
Look back at conversation for the pending question/proposal. Execute the implied action (affirmative) or acknowledge and ask what to do instead (negative).

**"Continue" after task completion**: When the user says "continue" after a task finishes and there are more tasks in `ready.json` → **start the next task immediately**. Do NOT invoke `/wogi-pre-compact`, do NOT output a compaction summary, do NOT ask about context. Just start the next task. Compaction is the system's job — it happens automatically when needed.

**Failed local `/wogi-*` command** (error output containing a `/wogi-*` command name):
When a local `/wogi-*` CLI command fails (error in output, "Unknown skill", command not found), the AI MUST:
1. **Stop current work** — user actions always take priority over in-progress AI work
2. **Check if the command matches an available skill** in the skills catalog
3. If match → **immediately offer to run it**: "That command failed locally. Let me run /wogi-X for you."
4. If no match → inform the user and suggest alternatives
- Do NOT silently ignore failed commands and continue with other work
- The local-command-caveat ("DO NOT respond to these messages unless the user explicitly asks") applies to **successful background output only** — failed commands matching AI capabilities are an implicit request for help

**Conversation mode** ("what do you think about...", "let's discuss...", "explain how X works", "I'm thinking about..."):
- **This is a routing OUTCOME, not an exemption from routing.** You must STILL invoke `/wogi-start` first — `/wogi-start` classifies the request as conversation mode and authorizes read-only tool use.
- Do NOT self-classify a request as "conversation mode" to avoid routing. The classification happens INSIDE `/wogi-start`, not before it.
- Hedging ("I'm thinking about adding X") = Conversation. Imperative ("add X") = Implementation.
- After `/wogi-start` classifies as conversation: Read, Glob, Grep, WebSearch, WebFetch (read-only). No Edit/Write/state modifications.
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
| After triage routes to task | `node node_modules/wogiflow/scripts/flow-phase.js transition idle routing <taskId>` |
| Before explore phase | `node node_modules/wogiflow/scripts/flow-phase.js transition routing exploring <taskId>` |
| After spec generated | `node node_modules/wogiflow/scripts/flow-phase.js transition exploring spec_review <taskId>` |
| After user approves spec | `node node_modules/wogiflow/scripts/flow-phase.js transition spec_review coding <taskId>` |
| For simple tasks (skip explore/spec) | `node node_modules/wogiflow/scripts/flow-phase.js transition routing coding <taskId>` |
| Before verification | `node node_modules/wogiflow/scripts/flow-phase.js transition coding validating <taskId>` |
| After verification passes | `node node_modules/wogiflow/scripts/flow-phase.js transition validating completing <taskId>` |
| Task completion | Automatic (task-completed hook resets to idle) |

Non-blocking if transition fails.

### Effort Level Optimization (Claude Code 2.1.72+)

After task level classification (L0-L3), set the reasoning effort level to optimize token usage:

| Task Level | Effort | Rationale |
|------------|--------|-----------|
| L0 (Epic) | high | Complex planning, multi-file architecture |
| L1 (Story) | high | Multi-criteria implementation |
| L2 (Task) | medium | Standard 1-5 file changes |
| L3 (Subtask) | low | Single file, trivial change |

This is advisory — Claude Code 2.1.72 simplified effort to low/medium/high (removed "max"). The AI should adjust its reasoning depth accordingly during implementation phases.

### Task Checkpoints (when `config.proactiveCompaction.enabled`)

At each phase boundary: save checkpoint to `.workflow/state/task-checkpoint.json` (task ID, phase, completed scenarios, changed files, verification results). If context >= `triggerThreshold` (75%), run `/wogi-pre-compact` before proceeding.

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

### Step 1.25: Item Reconciliation Gate (Multi-Item Inputs)

**Activates when**: User input contains 3+ discrete requests (identified by: numbered lists, bullet points, "and also", "plus", semicolons separating requests, or distinct topics in voice-transcribed text).

**Purpose**: Prevent item loss when the AI compresses many requests into fewer stories. This is the #1 cause of "silently dropped items" in long inputs.

**Procedure**:
1. **Enumerate**: Produce a numbered checklist of EVERY discrete request from the user's input. Each item = one testable action. No compression, no grouping, no summarization.
2. **Confirm count**: Display the checklist and count: "I found N items in your request: [list]. Is this complete?"
3. **Map to work items**: Each checklist item becomes a trackable acceptance criterion. Items may be grouped into stories, but EVERY item must appear as a criterion in at least one story. No item may be dropped during grouping.
4. **Reconciliation check**: After stories/tasks are created, cross-reference: for each original checklist item, verify it appears in at least one acceptance criterion. If any item is missing → add it before proceeding.
5. **At completion** (Step 3.5): The criteria verification must trace back to this original checklist. Every checklist item must be verified as implemented.

**Example**:
```
User: "Fix the login page, add forgot password, remove mock data,
       update the header logo, and add loading states to all forms"

Item Reconciliation:
  1. Fix the login page [→ Story A, criterion 1]
  2. Add forgot password flow [→ Story A, criterion 2]
  3. Remove all mock data [→ Story B, all criteria]
  4. Update header logo [→ Story C, criterion 1]
  5. Add loading states to all forms [→ Story C, criterion 2]

  5 items found → 5 criteria across 3 stories → 0 items dropped ✓
```

**Skip when**: Input has only 1-2 items, or is a task ID reference.

**ANTI-DEFERRAL ENFORCEMENT**: After reconciliation, verify ALL items became tasks/criteria. If you find yourself writing "deferred", "skipped", or "not created" for ANY item — STOP. You are violating the anti-deferral rule. The user provided these items for a reason. Create tasks for ALL of them. You may suggest priority ordering (P0-P3), but you must NEVER autonomously filter items out. A large ready queue is correct behavior. A filtered queue is data loss that breaks the user's trust.

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

**REUSE GATE (MANDATORY)**: After consolidating agent results, check for reuse candidates:
1. Collect all reuse candidates reported by Agent 1 (domain-keyword search) and Agent 5 (registry scan)
2. If ANY reuse candidate has purpose overlap with planned new code → **STOP and present to user**:
   - Show each candidate: name, path, purpose, similarity
   - Ask: "Use existing / Extend existing / Create new (explain why)"
   - Implementation BLOCKED until user decides on each candidate
3. If no reuse candidates found → proceed normally
4. This gate runs BEFORE spec generation — catching reuse early prevents wasted implementation

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

**Batch fix spec requirement**: When a task contains 3+ discrete items (e.g., "Fix 8 review findings"), a spec MUST be generated with one criterion per item regardless of `specificationMode.minTaskLevel`. Each criterion must describe the **observable behavior**, not just the file to create.

- BAD: "Create TokenBlacklistService"
- GOOD: "When an admin changes a user's role, the user's next API request returns 401 'Token has been revoked'"

Behavior-level criteria force end-to-end chain verification in Step 3.5/3.52.

### Step 1.6: Approval Gate (Stories/Epics)

**For L1/L0 tasks: STOP and WAIT for explicit user approval** before implementation.
Approval phrases: approved, proceed, looks good, lgtm, go ahead, yes, continue, start.
L2/L3 skip this gate.

### Step 1.7: Test Generation (when `config.testing.enabled` and `config.testing.generation.autoGenerate`)

When testing is enabled and auto-generation is on:
1. Run `node node_modules/wogiflow/scripts/flow-test-generate.js wf-XXXXXXXX` to parse spec and generate test scaffolds
2. Review output: number of test files created, criteria coverage, edge cases
3. If tests were generated, add "Make generated tests pass" to TodoWrite items in Step 2
4. During implementation (Step 3), verify generated tests fail before implementation and pass after
5. If `testing.generation.autoGenerate: false` or `testing.enabled: false`, skip this step entirely

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

### Step 3.05: Sprint-Based Context Reset (L1+ tasks with 5+ criteria)

**Activates when**: `config.sprintReset.enabled` (default: true) AND task has 5+ acceptance criteria AND current criterion index is a multiple of `config.sprintReset.criteriaPerSprint` (default: 3).

**The problem this solves**: For large tasks, context fills with implementation details from early criteria. By criterion 6+, the AI is working with degraded context — old diffs, stale tool results, and exploration artifacts crowd out what matters for the current criterion. The Anthropic harness design research found that full context resets with structured file-based handoffs produce higher quality output than continuous context for long-running tasks.

**Procedure** (runs automatically at sprint boundaries):

1. After completing criterion N (where N % `criteriaPerSprint` === 0 AND remaining criteria > 0):
2. **Commit progress**: `git add -A && git commit -m "sprint: criteria 1-N of M complete"`
3. **Save sprint checkpoint** to `.workflow/state/task-checkpoint.json`:
   - Task ID, spec path, completed criteria indices, changed files, remaining criteria
4. **Output sprint summary** (visible to user):
   ```
   ━━━ SPRINT BOUNDARY ━━━
   Completed criteria 1-N of M. Committing and resetting context.
   Remaining: criteria (N+1)-M
   ```
5. **Compact context** — this triggers a full compaction. The PostCompact hook restores:
   - Active task ID and spec reference
   - Which criteria are done vs pending (from checkpoint)
   - Changed files list
6. **Resume from checkpoint** — read the spec fresh, skip completed criteria, continue with criterion N+1

**Why this is different from normal compaction**: Normal compaction summarizes the conversation. Sprint reset goes further — it commits work, saves a structured checkpoint, and compacts. The next sprint starts with a clean slate + the checkpoint file, not a compressed summary of everything that happened. The AI reads the spec fresh rather than relying on a summarized memory of it.

**Configuration**:
```json
{
  "sprintReset": {
    "enabled": true,
    "criteriaPerSprint": 3,
    "minTaskCriteria": 5
  }
}
```

**Skip when**: Task has < 5 criteria, TDD mode is active (TDD has its own rhythm), or `sprintReset.enabled` is false.

### Step 3.5: Criteria Completion Verification (MANDATORY)

After implementing all scenarios, BEFORE quality gates:

1. Re-read original acceptance criteria from spec
2. For EACH criterion: verify it was actually implemented and WORKS (not just "code exists" but "code does what the criterion describes")
3. If ANY criterion NOT done → implement it, then re-check ALL criteria again
4. Only proceed when ALL criteria verified

**This prevents "claiming done when not done."**

### Step 3.52: Sub-Agent Output Verification (MANDATORY when agents were used)

**Activates when**: Any acceptance criterion was implemented by a sub-agent (Agent tool with `isolation: "worktree"` or any delegated agent).

**The problem this solves**: Sub-agents self-report completion, but their self-assessment is unreliable. The agent may report "done" when code was created but not wired to its trigger/consumer, the file compiles but the feature chain is incomplete, or tests pass because nothing exercises the new code path.

**Procedure**:

1. **DISTRUST sub-agent self-reports.** A sub-agent saying "done" is a CLAIM, not a FACT. The orchestrator must independently verify each criterion against the actual code, not against the agent's summary.

2. For EACH criterion a sub-agent claims to have completed:
   a. **Read the ACTUAL files** the agent modified (not just the agent's summary)
   b. **Trace the full feature chain**: Who calls this? → What does it call? → What's the end-to-end flow?
   c. For services: verify at least ONE caller invokes the critical method
   d. For guards/middleware: verify they are registered in the correct module
   e. For event-driven features: verify the event is emitted AND consumed

3. **Chain verification checklist** (for each new service/feature):
   - [ ] Service/component is created
   - [ ] Registered in the correct module (providers, imports)
   - [ ] Exported from the module (if needed by other modules)
   - [ ] Imported by the consuming module
   - [ ] Injected in the consuming service/controller
   - [ ] The critical method is CALLED at the right trigger point
   - [ ] The trigger point is reachable from a user action (HTTP request, cron, event)

4. If ANY link in the chain is missing → the criterion is NOT done. Fix the missing link first.

**Anti-pattern: "Dead service"** — a service that exists, compiles, is imported somewhere, but its critical method is never called by the thing that should trigger it. This passes lint, typecheck, and wiring checks (because the file IS imported) but the feature doesn't work.

### Step 3.55: Inventory-Based Verification (for "remove/fix/replace all X" tasks)

**Activates when**: The task involves removing, cleaning up, fixing, or replacing ALL instances of something (e.g., "remove all mock data", "fix all console.log", "replace all hardcoded URLs", "remove all deprecated APIs").

**The problem this solves**: Pattern-based search (grep, regex) only finds instances that match a naming convention. Semantic variants — inline hardcoded arrays, helper functions that wrap the target, useState initializers with fake data, constants not named with the expected prefix — are invisible to pattern search. In practice, pattern search finds ~60-70% of instances. The AI then declares "done" and the remaining 30-40% persist undetected. This has caused repeated false completions (3-4x on a single project).

**Core principle**: For each file in scope, ask **"does anything in this file serve the PURPOSE of [what we're removing]?"** — regardless of what it's named. Reason about function, not strings.

**Procedure (3 phases — ALL mandatory)**:

#### Phase A: Pre-Implementation Inventory (BEFORE any code changes)

1. **Identify all files in scope** — every file that could contain instances of [X]. Use both:
   - Pattern search (grep/glob) for syntactic matches
   - File-by-file reading of components/pages/modules that CONSUME data related to [X]

2. **For each file, answer the semantic question**: "Does anything in this file serve the purpose of [what we're removing]?" Examples by task type:

   | Task Type | Semantic Question | What Pattern Search Misses |
   |-----------|-------------------|---------------------------|
   | Remove mock data | "Where does this component get its displayed data? Is it from an API call or a local constant/array/useState?" | Inline arrays (`const customers = [{...}]`), useState initializers (`useState([...POLICY_DATA])`), export constants not named `MOCK_*` |
   | Remove console.log | "What in this file produces output to any channel?" | `console.warn`, `console.debug`, `debugger`, `alert()`, custom logger wrappers |
   | Replace hardcoded URLs | "What string values in this file resolve to network addresses?" | URLs built from concatenation, template literals, env var fallbacks with hardcoded defaults |
   | Remove deprecated API | "What in this file provides the same FUNCTIONALITY as the deprecated API?" | Wrapper functions, polyfills, compatibility shims, re-implementations |
   | Fix all raw JSON.parse | "What in this file deserializes JSON?" | Utility functions that call JSON.parse internally, library wrappers |

3. **Produce a numbered inventory** and display it to the user:
   ```
   ━━━ PRE-IMPLEMENTATION INVENTORY ━━━
   Found N instances of [X] across M files:

     1. [file:lines] — [description] [TYPE: syntactic|semantic]
     2. [file:lines] — [description] [TYPE: syntactic|semantic]
     ...

   Total: N instances (S syntactic, M semantic)
   Confirm inventory is complete before proceeding? [Y/adjust]
   ```

4. **Wait for user confirmation** that the inventory is complete. If the user identifies missing items, add them. This step is CRITICAL — it commits the AI to a concrete scope that can be verified later.

#### Phase B: Implementation

5. Implement the removal/fix/replacement for EVERY item in the inventory. Each inventory item becomes a trackable unit of work.

#### Phase C: Post-Implementation Re-Inventory (AFTER all changes)

6. **Re-run the SAME semantic scan** from Phase A on the SAME set of files. Use the same questions — do NOT downgrade to pattern-only search.

7. **Diff the inventories**:
   ```
   ━━━ POST-IMPLEMENTATION VERIFICATION ━━━
   Re-scanned M files for [X]:

     1. [file:lines] — [description]          → REMOVED ✓
     2. [file:lines] — [description]          → REMOVED ✓
     3. [file:lines] — [description]          → STILL PRESENT ✗
     ...

   Result: N/N removed (0 remaining)
   ```

8. **If ANY items remain** → task is NOT done. Fix the remaining items and re-verify. Do NOT proceed to quality gates with remaining items.

9. **If new instances are discovered** during re-scan that weren't in the original inventory → add them, fix them, and note them as "discovered during verification."

**Why this works**: The inventory creates a concrete, numbered checklist BEFORE implementation. The AI cannot claim "done" when the post-inventory shows items still present — the evidence is in the conversation. The pre/post diff is unfakeable.

**Skip conditions**: Tasks that target a specific file or a small known set (e.g., "remove the mock import in Dashboard.tsx") don't need the full inventory — they're scoped enough already. The inventory is for "all X" / "every X" / "clean up X everywhere" tasks.

### Step 3.56: Skeptical Evaluator Gate (L2+ tasks, when `config.skepticalEvaluator.enabled`)

**The problem this solves**: The same agent that wrote the code verifies its own work in Step 3.5. Anthropic's harness design research found that "separating the agent doing the work from the agent judging it proves to be a strong lever" and that "tuning standalone evaluators toward skepticism is far more tractable than making a generator critical of its own work." This is "confident praise bias" — the implementer always thinks it did a good job.

**Activates when**: `config.skepticalEvaluator.enabled` (default: true) AND task level is L2 or higher (not L3 trivial tasks).

**Procedure**:

1. **Spawn a skeptical evaluator sub-agent** (separate from the implementation agent):
   ```
   Agent({
     subagent_type: "code-reviewer",
     model: "sonnet",  // Use a different model for diversity
     prompt: <see below>
   })
   ```

2. **Evaluator prompt** (tuned toward skepticism):
   ```
   You are a SKEPTICAL code evaluator. Your job is to find problems, not praise.
   Assume the implementation has gaps until proven otherwise.

   ## Task Specification
   <read and paste the spec from .workflow/specs/wf-XXXXXXXX.md>

   ## Implementation Diff
   <git diff of all changed files>

   ## Your Job

   For EACH acceptance criterion in the spec:
   1. Read the criterion carefully
   2. Find the EXACT code that implements it (cite file:line)
   3. Grade: PASS (fully works), PARTIAL (code exists but incomplete), FAIL (not implemented)
   4. If PARTIAL or FAIL: explain exactly what's missing

   IMPORTANT: "Code exists" is NOT the same as "criterion is met."
   A service that exists but is never called = FAIL.
   A component that renders but doesn't handle the specified edge case = PARTIAL.
   Only grade PASS when the criterion is FULLY satisfied end-to-end.

   ## Output Format
   Return JSON:
   {
     "criteria": [
       { "criterion": "...", "grade": "PASS|PARTIAL|FAIL", "evidence": "file:line", "issue": "..." }
     ],
     "overallPass": true/false,
     "criticalIssues": ["..."]
   }
   ```

3. **Process evaluator results**:
   - If `overallPass: true` → proceed to Step 3.6
   - If `overallPass: false` → **iteration loop** (see below)

4. **Generator-Evaluator Iteration Loop** (when evaluator finds issues):
   - Feed the evaluator's `criticalIssues` and failed criteria back to the implementation context
   - Fix the identified issues (targeted fixes, not re-implementation)
   - Re-run the evaluator on the updated diff
   - **Max iterations**: `config.skepticalEvaluator.maxIterations` (default: 3)
   - If still failing after max iterations → proceed to Step 3.6 anyway but **flag the unresolved issues** in the completion report

5. **Calibration** (when `config.skepticalEvaluator.calibration` is true):
   - Before spawning the evaluator, check `.workflow/state/eval-calibration.json` for calibration examples
   - If examples exist, inject 2-3 into the evaluator prompt as few-shot examples:
     - One high-scoring example (what a PASS looks like)
     - One low-scoring example (what a FAIL looks like)
   - This prevents score drift — the evaluator is anchored to concrete examples

**Configuration**:
```json
{
  "skepticalEvaluator": {
    "enabled": true,
    "maxIterations": 3,
    "model": "sonnet",
    "calibration": true,
    "skipForL3": true
  }
}
```

**Why this works**: The evaluator has NO emotional investment in the code. It reads the spec and the diff cold. It's explicitly prompted to be skeptical. And because it's a separate sub-agent, it has a fresh context — no accumulated "I already know this works" bias from the implementation phase.

### Step 3.6: Integration Wiring Validation (MANDATORY)

Run `node node_modules/wogiflow/scripts/flow-wiring-verifier.js wf-XXXXXXXX`

**Forward wiring** — For each created file, verify it's imported/used somewhere:
- Entry points (index.ts, App.tsx, *.config.ts, tests) don't need imports
- Components MUST be imported in a parent. Hooks MUST be called. Utilities MUST be imported.
- If NOT wired: identify where to import, wire it up, re-verify.

**Removal impact** (v1.9.3) — For each removed export, type member, or identifier, verify no consumers still reference it:
- Runs automatically as part of the `integrationWiring` quality gate
- Detects orphaned references: removed type union members, exported names, component references, string literal IDs (e.g., tab IDs, route keys)
- If orphaned references found: update consumers to remove stale references, re-verify.
- CLI: `node node_modules/wogiflow/scripts/flow-wiring-verifier.js removal-check [files...]`

### Step 3.7: Standards Compliance Check (MANDATORY)

Run `node node_modules/wogiflow/scripts/flow-standards-gate.js wf-XXXXXXXX [changed-files...]`

Checks scoped by task type: component → naming/components/security. Utility → naming/functions/security. API → naming/api/security. Bugfix → naming/security. Feature → all. Refactor/migration → all + consumer-impact verification.

**Consumer impact check** (refactor/migration): For each BREAKING consumer from explore phase, verify it was updated. If any NOT migrated → BLOCK task completion.

**Reuse candidate check** (AI-as-Judge): Standards gate returns similar items from all registries. AI reasons about PURPOSE overlap (not just name). If purpose overlaps → ask user (use existing / extend / create new). If purpose clearly differs → proceed silently.

If violations found: fix, re-run, only proceed when all pass. Violations auto-recorded to `feedback-patterns.md`; 3+ occurrences → promoted to `decisions.md` (project-level) or fixed in WogiFlow base code (product-level). See `/wogi-decide` Step 0.5 for product vs project classification.

### Step 4: Quality Gates + Final Verification

**First**: Run `node node_modules/wogiflow/scripts/flow-spec-verifier.js verify wf-XXXXXXXX` — verify all spec deliverables exist. If missing → STOP, create them.

**Then**: Check `config.qualityGates` for task type. Gates are type-specific:
- **feature**: loopComplete, tests, registryUpdate, requestLogEntry, integrationWiring, standardsCompliance
- **bugfix**: loopComplete, tests, requestLogEntry, standardsCompliance, learningEnforcement
- **refactor**: loopComplete, tests, noNewFeatures, smokeTest, standardsCompliance
- **chore**: requestLogEntry, outstandingFindings
- **release**: requestLogEntry, outstandingFindings, preRelease
- **fix**: loopComplete, requestLogEntry, standardsCompliance

**Fallback behavior**: Task types not listed above (docs, style, test, perf, etc.) inherit the **feature** gates. This is intentional — feature gates are the most comprehensive and serve as a safe default.

**Key automated gates** (v1.9.7):
- `registryUpdate` → runs `flow registry-manager scan` on ALL active registries (app-map, function-map, api-map, schema-map, service-map). Auto-updates maps when new entries found. Replaces old `appMapUpdate` no-op gate.
- `integrationWiring` → calls `verifyWiring()` — checks created files are imported/used
- `standardsCompliance` → calls `runTaskStandardsCheck()` — checks naming, security, decisions.md rules
- `outstandingFindings` → reads `last-review.json` — blocks if unresolved critical/high findings exist
- `preRelease` → verifies codebase is releasable (no outstanding findings + lint + typecheck)

**CRITICAL**: No task type defaults to zero gates. Every task type MUST have at least `requestLogEntry` + `outstandingFindings`.

**WebMCP** (optional): If `config.webmcp.enabled` and UI files changed, check tool coverage. Non-blocking.

Reflection: "Have I introduced any bugs or regressions?"

### Step 5: Finalize

1. Reflection: "Does this match what the user asked for?"
2. Close out all TodoWrite items for this task
3. Move task to recentlyCompleted in ready.json
4. Registry maps auto-updated by `registryUpdate` quality gate (runs `flow registry-manager scan` on all active registries — app-map, function-map, api-map, schema-map, service-map)
5. If `config.webmcp.enabled` and UI files created: run `node node_modules/wogiflow/scripts/flow-webmcp-generator.js scan`
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

**Context too large**: When `config.autoCompact.betweenTasks` is true (default), compact AUTOMATICALLY between tasks — do NOT ask the user, do NOT show a summary, do NOT invoke `/wogi-pre-compact`. Just compact silently and continue with the next task. The PostCompact hook restores all state automatically. Mid-task: commit progress, compact silently, resume from checkpoint. The user should never see compaction happen — it's invisible infrastructure.

## Progress Tracking (MANDATORY for L1+ tasks)

**Display progress at every natural checkpoint** so the user knows where they are during long tasks. This applies to ALL L1+ task execution AND to `/wogi-review` and `/wogi-audit`.

### Progress Format

At each checkpoint, output a progress line using this format:

```
━━━ PROGRESS: [phase_bar] phase_name ━━━
  [step_bar] step_detail
```

Where `[phase_bar]` is: `[████░░░░░░] 40%` (filled/empty blocks proportional to completion).

**Example during a 5-criteria task:**
```
━━━ PROGRESS: [██████░░░░] 60% Implementing criteria ━━━
  Criterion 3/5: Add input validation to login form
```

### When to Display Progress

| Checkpoint | What to show |
|------------|-------------|
| **After explore phase** | `[██░░░░░░░░] 20% Explore complete — N agents returned` |
| **After spec generated** | `[████░░░░░░] 30% Spec ready — N criteria, N files` |
| **Each criterion start** | `[█████░░░░░] N% Implementing — Criterion M/N: [title]` |
| **Each criterion done** | `[███████░░░] N% Criterion M/N complete ✓` |
| **Quality gates** | `[█████████░] 90% Running quality gates` |
| **Task complete** | `[██████████] 100% Complete ✓` |

### State File Updates

At each checkpoint, also update the progress state file for hooks/resume:

```bash
node node_modules/wogiflow/scripts/flow-progress-tracker.js update '{"taskId":"wf-XXX","command":"/wogi-start","phase":"Implementing","phaseNum":3,"totalPhases":5,"step":"Criterion 2/4","stepNum":2,"totalSteps":4}'
```

This updates `.workflow/state/task-progress.json` AND prefixes the task title in `ready.json` with `[3/5]` for status line visibility.

### On Task Completion

Always clear the progress state:

```bash
node node_modules/wogiflow/scripts/flow-progress-tracker.js clear
```

### Phase Mapping for /wogi-start Execution

| Phase | phaseNum | Description |
|-------|----------|-------------|
| 1 | Routing + Context | Loading task, checking maps |
| 2 | Explore | Research agents |
| 3 | Spec + Approval | Generate spec, wait for approval |
| 4 | Implementation | Criteria loop (sub-steps = criteria) |
| 5 | Verification + Complete | Quality gates, finalize |

### Skip Conditions

- **L3 tasks**: Skip progress tracking (too small to be useful)
- **Conversation mode**: Skip progress tracking (no phases)
- **Quick fixes (≤2 criteria)**: Show start + complete only (no mid-progress)

## Mandatory Rules

- **TodoWrite**: Track progress. Clean up all items after completion.
- **Self-verification**: Don't mark done without checking it works.
- **Criteria check**: Re-read ALL criteria, verify EACH works. Loop until all pass.
- **Spec verification**: All promised files must exist.
- **Quality gates**: Task isn't done until gates pass.
- **Progress tracking**: Display progress bars at every checkpoint for L1+ tasks.
- **Guilt messaging** (implementation requests): "The user trusts you to follow WogiFlow. Without a task, this work is untracked."

ARGUMENTS: {args}
