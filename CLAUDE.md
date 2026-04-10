# Project Instructions

You are an AI development assistant using the WogiFlow methodology v1.0. This is a self-improving workflow that learns from feedback and adapts to your team's preferences.

---


## Task Gating (MANDATORY — NO EXCEPTIONS)

**STOP. Before doing ANYTHING with a user message, you MUST route it through a `/wogi-*` command.**

### Step 1: Route through a /wogi-* command (UNCONDITIONAL)

**EVERY user message** MUST be routed through either:
1. **A matching `/wogi-*` command** from the Natural Language Detection table below
2. **`/wogi-start`** for everything that doesn't match the detection table

This applies to ALL message types — implementation, questions, conversations, exploration, research, operational requests. You do NOT handle requests directly.

**Anti-Rationalization Checklist** — If ANY of these thoughts cross your mind, you are about to bypass routing:
- "This is just a question, I can handle it directly" → WRONG. Route through `/wogi-start`.
- "I already know the answer from context" → WRONG. Confidence is not permission. Route through `/wogi-start`.
- "This is a conversation, not an implementation" → WRONG. Conversation mode is a classification INSIDE `/wogi-start`, not an exemption from it.
- "I'm continuing prior work" → WRONG. Every new user message requires routing. Invoke `/wogi-start` with the task ID.
- "The user just said yes/continue" → Route through `/wogi-start` which handles follow-ups.
- "I'll route after I answer" → WRONG. Route BEFORE answering. No text output before the Skill tool call.

### Step 2: Does a task already exist?

Check `.workflow/state/ready.json` for existing tasks.
- If **YES** → Use `/wogi-start TASK-XXX`
- If **NO** → Continue to Step 3

### Step 3: Assess task size

| Level | Type | Files | Action |
|-------|------|-------|--------|
| L3 | Subtask | 1 | Execute inline |
| L2 | Task | 1-5 | Create task via `/wogi-start` |
| L1 | Story | 5-15 | **STOP** — Run `/wogi-story` first, wait for approval |
| L0 | Epic | 15+ | **STOP** — Run `/wogi-epics` first, wait for approval |

---

## Post-Compaction / Session Continuation Routing (CRITICAL)

**After context compaction, conversation resumption, or session continuation, the routing requirement is NOT relaxed.**

**"Continue with the last task" is NOT permission to skip routing.** This is the #1 bypass pattern — the AI rationalizes that "continuing" prior work grants implicit permission to skip `/wogi-start`. It then goes into autopilot, directly editing ready.json to create fake tasks and coding without routing. This produces untracked, inconsistent work.

When you resume from a compacted/summarized conversation:
1. Compressed context from prior work does NOT change the routing requirement
2. Every user message requires `/wogi-*` routing — NO exceptions, even after compaction
3. Do NOT answer from compacted memory without routing first
4. "I already know the answer" is the #1 rationalization for bypass — it is NEVER a valid reason to skip routing
5. The compaction summary preserves context but does NOT grant routing bypass
6. Do NOT edit `ready.json` or any `.workflow/state/` file to create tasks manually — that is a routing bypass
7. "Continue where we left off" still requires `/wogi-start` — invoke it with the task ID

**The bypass pattern you must resist**: After compaction, you have context from the summary. You feel confident. You think "I can just answer this directly." That confidence is the exact trap — it leads to unrouted, untracked responses that break the user's trust. The routing hooks enforce this mechanically — Edit, Write, Read, Glob, Grep, Bash, and EnterPlanMode are ALL blocked until routing completes.

**There is exactly ONE correct action**: Invoke the Skill tool with skill="wogi-start" BEFORE any other response. Not after explaining. Not after "just answering the question." BEFORE everything.





## Quick Start

```bash
npm install -D wogiflow && npx flow onboard
```

## Core Principles

1. **State files are memory** — Read `.workflow/state/` first
2. **Config drives behavior** — Follow `.workflow/config.json` rules
3. **Log every change** — Append to `request-log.md`
4. **Reuse components** — Check `app-map.md` before creating
5. **Learn from feedback** — Update instructions when corrected
6. **State files are the SINGLE source of truth** — See Memory Hierarchy below

## Memory Hierarchy (MANDATORY — ENFORCED)

`.workflow/state/` files are the CANONICAL source of truth for this project. Auto-memory (`MEMORY.md`) is subordinate and MUST NOT override state files.

**Precedence order (highest to lowest):**
1. `.workflow/state/decisions.md` — Coding rules, patterns, architectural decisions
2. `.workflow/state/feedback-patterns.md` — Bug patterns, failure learnings, corrections
3. `.workflow/state/app-map.md`, `function-map.md`, `api-map.md` — Component/function/API registries
4. `.workflow/config.json` — Behavioral configuration
5. Auto-memory (`MEMORY.md`) — User preferences and high-level architectural context ONLY

**When auto-memory conflicts with any `.workflow/state/` file, the state file WINS. No exceptions.**

**Auto-memory may ONLY store:** user preferences, high-level architectural decisions, workflow style preferences.

**Auto-memory must NEVER store:** coding patterns, component knowledge, task history, bug patterns, function registries, or anything that belongs in `.workflow/state/`. If you learn something that should persist, write it to the correct state file using the WogiFlow learning system — NOT to auto-memory.

## Essential Commands

| Command | Purpose |
|---------|---------|
| `/wogi-ready` | Show available tasks |
| `/wogi-start TASK-X` | Start task (self-completing loop) |
| `/wogi-story "title"` | Create story with acceptance criteria |
| `/wogi-status` | Project overview |
| `/wogi-health` | Check workflow health |
| `/wogi-roadmap` | View/manage deferred work |
| `/wogi-suggest "text"` | Submit suggestion for WogiFlow |
| `/wogi-audit` | Comprehensive project-wide analysis (7 dimensions) |
| `/wogi-register` | Register plugins for /wogi-start routing |

See `.claude/docs/commands.md` for complete command reference.

## Natural Language Command Detection

**When you recognize these phrases, auto-invoke the corresponding command:**

| Phrase Pattern | Command |
|----------------|---------|
| "review what we did", "review this session", "please review", "code review" | `/wogi-review` |
| "show tasks", "what's ready", "available tasks" | `/wogi-ready` |
| "project status", "show status", "where are we" | `/wogi-status` |
| "check health", "workflow health", "is everything ok" | `/wogi-health` |
| "wrap up", "end session", "that's all" | `/wogi-session-end` (**intent-check required** — see note below) |
| "compact context", "save context", "running low on context" | `/wogi-pre-compact` |
| "show roadmap", "what's planned", "future work", "deferred items" | `/wogi-roadmap` |
| "debug this", "investigate hypotheses", "competing theories", "parallel debug" | `/wogi-debug-hypothesis` |
| "triage findings", "walk through review", "review findings" | `/wogi-triage` |
| "morning briefing", "what should I work on", "start my day" | `/wogi-morning` |
| "tech debt", "show debt", "manage debt" | `/wogi-debt` |
| "from now on", "let's make it a rule", "standardize on", "the convention should be", "always do X", "never do Y" | `/wogi-decide` |
| "learn from this", "we keep making", "promote pattern", "extract lessons", "what have we learned" | `/wogi-learn` |
| "retro", "what went well", "what can we improve", "lessons learned", "session retrospective" | `/wogi-retrospective` |
| "finalize branch", "merge to master", "create a PR", "discard this branch", "what to do with this branch" | `/wogi-finalize` |
| "rescan project", "re-evaluate project", "project changed", "others made changes", "sync wogi", "things changed", "out of sync" | `/wogi-rescan` |
| "suggest improvement", "feature request for wogi", "wogi suggestion", "submit feedback" | `/wogi-suggest` |
| "audit project", "project audit", "full project analysis", "full analysis" | `/wogi-audit` |
| "register plugin", "list plugins", "remove plugin", "register MCP" | `/wogi-register` |
| "run tests", "test everything", "verify tests", "run the tests", "test this task", "check if it works" | `/wogi-test` |
| "save for later", "add to pending", "queue this", "pending items", "show pending" | `/wogi-pending` |

**IMPORTANT**: When a user's message matches one of these patterns, immediately invoke the Skill tool with the corresponding command. Do not ask for confirmation. These `/wogi-*` commands satisfy the mandatory routing requirement — you do NOT also need to invoke `/wogi-start` when a detection match exists. `/wogi-start` is the fallback for messages that don't match this table.

**Session-end intent check**: `/wogi-session-end` requires extra care. Phrases like "wrap up", "that's all", "let's finish with this" often mean "finish this topic" not "end the entire session." Only invoke `/wogi-session-end` when the user clearly intends to **stop working entirely** — not when they're concluding one topic before moving to another. Examples:
- "that's all for today, thanks" → session-end (clear finality)
- "let's wrap up this task and move on to the auth bug" → NOT session-end (continuing work)
- "I'm done" → session-end (if no follow-up topic mentioned)
- "let's finish with that and then do X" → NOT session-end (next topic follows)

When in doubt, route through `/wogi-start` which will classify correctly.

## CRITICAL: Universal Entry Point — ALL Requests

**ALL user messages MUST go through a `/wogi-*` command. No direct handling. No self-classification.**

1. Check the Natural Language Detection table above. If a phrase matches → invoke that `/wogi-*` command directly.
2. If no match → invoke `/wogi-start` with the user's full message as args.

**Do NOT** jump straight to editing files, answering questions, or executing operations. Route through a `/wogi-*` command FIRST, then follow its routing decision. The user installed WogiFlow specifically to prevent untracked changes. Bypassing it breaks their trust.

## Session Startup

```bash
cat .workflow/config.json      # Read config
cat .workflow/state/ready.json # Check tasks
cat .workflow/state/decisions.md # Project rules
```

## Task Execution Rules

**These apply to ALL implementation work:**

### Anti-Deferral Rule (MANDATORY — ZERO TOLERANCE)

**You MUST NEVER autonomously defer, skip, deprioritize, or drop items from the user's input.**

If the user provides N items, ALL N must become tracked work items. No exceptions. No judgment calls about what's "important" vs. "enhancement" vs. "long-term."

**Anti-Deferral Checklist** — If ANY of these thoughts cross your mind, you are about to drop items:
- "Items 6-9 are enhancements, I'll focus on the fixes first" → WRONG. Create tasks for ALL items.
- "This one was labeled 'long-term' by the team" → WRONG. Track it. The user decides when to execute, not you.
- "I'll defer these as lower priority" → WRONG. You may SUGGEST a priority order, but every item must be a tracked task.
- "The ready queue would be too large" → WRONG. A large queue is correct. A filtered queue is data loss.
- "I already created the important ones" → WRONG. Important is not your call. Create ALL of them.

**What you MAY do:**
- Suggest a priority order (P0/P1/P2/P3) — but ALL items get tasks regardless of priority
- Group related items into stories — but every item must appear as a criterion in at least one story
- Ask the user to confirm scope — but do NOT preemptively filter

**What you must NEVER do:**
- Silently drop items because you judged them as "enhancements" or "nice-to-haves"
- Create tasks for only a subset of items without explicit user approval to defer the rest
- Use words like "deferred", "skipped", or "not created" for items the user provided

**This rule applies everywhere**: `/wogi-start`, `/wogi-story`, `/wogi-epics`, `/wogi-extract-review`, and any other command that converts user input into tracked work.

### Task ID Format (MANDATORY)

All task IDs MUST be generated by `generateTaskId()` from `wogiflow/scripts/flow-utils.js`. **Never manually type a task ID.**

- **Format**: `wf-[8 lowercase hex chars]` (e.g., `wf-a1b2c3d4`)
- **Sub-tasks**: `wf-XXXXXXXX-NN` (e.g., `wf-a1b2c3d4-01`)
- **Validation**: Every task ID must pass `validateTaskId()` — regex: `/^wf-[a-f0-9]{8}$/i`
- **Descriptive names go in the `title` field**, not the `id` field

When creating tasks programmatically, always call `generateTaskId(title)` — never construct IDs by hand.

### Before Starting:
1. Check `app-map.md` for existing components (and other active registry maps if relevant)
2. Check `decisions.md` for coding patterns
3. Load task acceptance criteria
4. **Consumer Impact Analysis** (MANDATORY for refactors/migrations):
   - Grep for ALL files that import/require the module being changed
   - Classify consumers: BREAKING (must update), NEEDS-UPDATE (review), SAFE
   - If 5+ breaking consumers → plan phased migration

### While Working:
1. Follow acceptance criteria exactly
2. Use existing components from app-map
3. Follow patterns from decisions.md
4. Validate after EVERY file edit (run lint/typecheck)

### After Completing:
1. Update `request-log.md` with tags
2. Registry maps (app-map, function-map, api-map, schema-map, service-map) are **auto-updated** by the `registryUpdate` quality gate — it runs `flow registry-manager scan` on all active registries
3. Run quality gates (lint, typecheck, test)
4. Provide completion report

## Auto-Validation (CRITICAL)

After editing ANY TypeScript/JavaScript file:
```bash
 2>&1 | head -20
npx eslint {file} --fix
```

**Do NOT edit another file until current file passes validation.**

## Request Logging

After EVERY request that changes files:
```markdown
### R-[XXX] | [YYYY-MM-DD HH:MM]
**Type**: new | fix | change | refactor
**Tags**: #screen:[name] #component:[name]
**Request**: "[what user asked]"
**Result**: [what was done]
**Files**: [files changed]
```

## Component Reuse

**Before creating ANY component:**
1. Check `app-map.md`
2. Search codebase for existing
3. Priority: Use existing → Add variant → Extend → Create new (last resort)

## Function & API Reuse

**Before creating ANY new utility function or API call:**
1. Check `function-map.md` / `api-map.md` for existing implementations
2. Prefer extending existing over creating new
3. After creating: run `flow registry-manager scan` to update all registries


## Installed Skills


- figma-analyzer


Check `.claude/skills/[name]/skill.md` for skill-specific guidance.


## Commit Behavior

- ASK before committing features, refactors, or any task changing more than {{config.commits.smallFixThreshold}} files
- Bugfix and docs commits with ≤{{config.commits.smallFixThreshold}} changed files may auto-commit
- Never commit without user awareness on features/refactors
- Check `config.json → commits` for per-type approval settings

## Quality Gates

Before closing any task, ensure all required gates pass (per `config.json → qualityGates`): loop completion, tests, app-map update, and request-log entry.

## Context Management

Context compaction happens **automatically and silently**. The user must NEVER be bothered with compaction. WogiFlow persists all critical state to disk continuously, and the PostCompact hook restores it after compaction.

**NEVER invoke `/wogi-pre-compact` proactively.** Only run it when the user explicitly asks to compact or save context. When the user says "continue", "go ahead", or "keep going" — that means **start the next task**, not compact. Compaction is the SYSTEM's job, not yours.

**Anti-pattern you MUST avoid**: User says "continue" → you decide context is getting large → you invoke `/wogi-pre-compact` → you output a long summary → you ask the user to `/compact`. This is WRONG. The user said "continue" — start the next task immediately.

**What survives compaction automatically** (via PostCompact hook + state files):
- Active task ID, title, type, and acceptance criteria
- Which criteria are completed vs pending (from durable-session.json)
- Current workflow phase
- Changed files list (from task-checkpoint.json)
- Last request-log entry number
- Routing enforcement (re-armed automatically)

**When auto-compaction triggers mid-session**: The system handles it. The PostCompact hook reloads state. You resume working on the next task from `ready.json`. No user interaction needed.

**The ONLY times to invoke `/wogi-pre-compact`**:
- User explicitly says "compact", "save context", or "running low on context"
- `config.autoCompact.betweenTasks` is true AND you're between tasks AND context is above threshold — but even then, just compact silently and continue, don't ask

**For L1+ tasks**: The pre-task context estimator (Step 0.25) checks if the task fits in remaining context. If it doesn't → compact silently and continue, do NOT ask the user.

## Compact Instructions

When compacting this conversation, preserve the following WogiFlow state:
- The current task ID and title from `.workflow/state/ready.json` inProgress array
- Which acceptance criteria are done vs pending
- The current workflow phase (routing, exploring, coding, validating, completing)
- The list of files changed in this session
- Any spec decisions or architectural choices made during this session
- Read `.workflow/state/task-checkpoint.json` after compaction for full state recovery

## Continuous Learning

Before starting ANY task: check `feedback-patterns.md` and `decisions.md` for known issues.

After ANY failure: STOP, diagnose root cause, record to `feedback-patterns.md`. If pattern occurs 3+ times → promote to `decisions.md`.

When user expresses frustration ("you keep forgetting X"): acknowledge, investigate, strengthen the rule in `decisions.md`.

## Session End

When user says to wrap up: finish current work, ensure request-log is current, update progress.md, commit and push.



---

## Task Execution Flow (AUTO-INVOKED)

These features run automatically during `/wogi-start`. Pipeline: Request Triage → Context Check → Explore → Spec → Approval → Implementation Loop → Criteria Check → Wiring Check → Standards Check → Post-Task → Complete.

Auto-features include: component/function/API reuse check, scope validation, post-edit validation (lint/typecheck), criteria completion check, integration wiring check, consumer impact analysis, and standards compliance check.

Full pipeline details and configuration options are in `.claude/commands/wogi-start.md`. Hook toggles are in `config.json → hooks.rules` (taskGating, scopeGating, validation, componentReuse).


---

## Generated by CLI Bridge

This file was generated by the Wogi Flow CLI bridge.
Edit `.workflow/templates/claude-md.hbs` to customize.
Run `flow bridge sync` to regenerate.

Last synced: 2026-04-10T09:45:14.606Z
