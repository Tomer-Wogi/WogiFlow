# Phase: Explore (Steps 1–1.45)

Instructions for the explore phase of task execution. Loaded on-demand when phase transitions to `exploring`.

## Step 1: Load Context + Match Skills

1. Read `ready.json`, move task to inProgress
2. Load task context from `.workflow/changes/*/wf-XXXXXXXX.md`
3. Check `app-map.md`, `function-map.md`, `api-map.md`, `decisions.md`
4. **Generate repo map** (wf-f3707d2f / C1) — auto-generated per task, refreshed per turn: `node scripts/flow-repo-map.js generate --task=<taskId>`. The map surfaces TOUCHED + ADJACENT + SHAPE sections within a bounded token budget (default 16KB ≈ 4K tokens). Config: `repoMap.enabled` (default true), `repoMap.budgetBytes`. Skip if output is empty (no touched files yet).
5. Auto-invoke matched skills based on task context

## Step 1.15: Intent Framing Pass (when `config.intentGroundedReasoning.enabled`)

**Conditional** — runs for L1+ tasks when IGR is on. L3 skip. L2 runs only when user's message contains `ultrathink`.

Self-reflective reasoning pass (NOT a sub-agent). Produces a Framing Artifact at `.workflow/state/framing/{taskId}.md` with 9 PIN-structured sections: Ask, Interpretation, Concepts touched, Ambiguities resolved, Remaining ambiguities, Journeys affected, Prior-session corrections, Scope, Questions.

Run via `node scripts/flow-intent-framing.js prompt <task-input> --task=<taskId>`. Reflect against it; save via `saveFramingArtifact()`; evaluate via `evaluateFramingGate()`. CONCERN when `remainingAmbiguities` is non-empty — surface to user at approval gate. FAIL when interpretation is missing or trivially short.

Consumed downstream by Architect Pass (Step 1.55) and Logic Adversary (Step 1.57).

When IGR flag is OFF: SKIPPED entirely.

## Step 1.2: Clarifying Questions

Before generating specs (skip for small tasks ≤2 files, bugfixes, explicit specs):
- Scope validation, assumption surfacing, edge cases, integration points
- Config: `config.clarifyingQuestions`

## Step 1.25: Item Reconciliation Gate (Multi-Item Inputs)

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

## Step 1.3: Explore Phase (MANDATORY Multi-Agent Research)

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
| 6. Consumer Impact | **ALL L1+ tasks.** Map ALL consumers, classify BREAKING/NEEDS-UPDATE/SAFE. Write results to `.workflow/state/blast-radius-{taskId}.json` | Local |

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

**Fallback**: If agents fail, log warning and proceed with remaining. Consumer Impact failure on L1+ tasks = HARD BLOCK (require user confirmation). See `.claude/docs/explore-agents.md` for details.

**Constraints**: READ-ONLY phase. No Edit/Write. Agents use only Glob, Grep, Read, WebSearch, WebFetch.

## Step 1.45: Scope-Confidence Gate (L0/L1 tasks only)

**Activates when**: Task level is L0 or L1. Skip for L2/L3 tasks.

**The problem this solves**: Multi-day plans often depend on assumptions about what exists (new tables, new models, new APIs, new services). Without verification, a 7-10 day plan can collapse to 1 day when a single question reveals the assumption was wrong. This gate audits scope-inflating assumptions BEFORE the spec is generated — not the same as clarifying questions (Step 1.2) which target user intent.

**Procedure**:

1. **Extract assumptions**: From the explore phase results and task description, list every assumption the plan depends on:
   - New database tables/schemas needed
   - New API endpoints or services to create
   - New models or data structures
   - External integrations assumed not to exist
   - Infrastructure components (queues, caches, workers)

2. **Verify each assumption against the codebase**:
   - For each assumption, grep/glob for existing implementations
   - Check schema files, migration files, service directories, API routes
   - Check `app-map.md`, `function-map.md`, `api-map.md`, `schema-map.md` for registered components

3. **Classify results**:
   | Status | Meaning | Action |
   |--------|---------|--------|
   | VERIFIED | Assumption confirmed by codebase evidence | Proceed — scope is accurate |
   | EXISTS | Assumed-new thing already exists | **Scope reduction** — remove from plan |
   | UNVERIFIABLE | Cannot confirm or deny from codebase | **Ask user** before proceeding |
   | CONTRADICTED | Codebase shows opposite of assumption | **Scope change** — replan required |

4. **Present findings to user** (MANDATORY when any UNVERIFIABLE or CONTRADICTED found):
   ```
   ━━━ SCOPE-CONFIDENCE AUDIT ━━━
   Task: [title]

   Assumptions verified:
     ✓ [assumption] — found at [file:line]

   Scope reductions (already exists):
     ↓ [assumption] — exists at [file:line], removing from plan

   Needs confirmation:
     ? [assumption] — does [X] already exist? Could not find in codebase.

   Contradictions:
     ✗ [assumption] — codebase shows [opposite evidence]

   Revised estimate: [original] → [adjusted based on findings]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

5. **Wait for user response** on UNVERIFIABLE items before proceeding to spec generation. Spec MUST reflect verified scope, not assumed scope.

**This is NOT the same as Step 1.2 (Clarifying Questions)**:
- Step 1.2 targets **user intent** ("what do you want?")
- Step 1.45 targets **scope assumptions** ("what does the codebase already have?")
- Step 1.2 runs before explore; Step 1.45 runs after explore (uses explore results)
