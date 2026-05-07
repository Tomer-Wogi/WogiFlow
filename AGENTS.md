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

**Anti-Rationalization Checklist** — if any of these thoughts cross your mind, you are about to bypass routing. This is the **master checklist** referenced by all anti-rationalization rules below:
- "This is just a question, I can handle it directly" → WRONG. Route through `/wogi-start`.
- "I already know the answer from context / compaction summary" → WRONG. Confidence is not permission.
- "This is a conversation, not an implementation" → WRONG. Conversation mode is a classification INSIDE `/wogi-start`, not an exemption from it.
- "I'm continuing prior work" / "user just said yes/continue" → WRONG. Every new user message requires routing. Invoke `/wogi-start` (with task ID if continuing).
- "I'll route after I answer" → WRONG. Route BEFORE answering. No text output before the Skill tool call.
- "I'll just edit `ready.json` or another state file to create the task myself" → WRONG. That is the routing bypass. Use `/wogi-start`.

Post-compaction is the #1 bypass trap: you have summary context, you feel confident, you think you can answer directly. That confidence is the trap — hooks (Edit/Write/Read/Glob/Grep/Bash/EnterPlanMode) are ALL blocked until routing completes.

### Step 2: Does a task already exist?

Check `.workflow/state/ready.json`. If YES → `/wogi-start <taskId>`. If NO → continue to Step 3.

### Step 3: Assess task size

| Level | Type | Files | Action |
|-------|------|-------|--------|
| L3 | Subtask | 1 | Execute inline |
| L2 | Task | 1-5 | Create task via `/wogi-start` |
| L1 | Story | 5-15 | **STOP** — Run `/wogi-story` first, wait for approval |
| L0 | Epic | 15+ | **STOP** — Run `/wogi-epics` first, wait for approval |





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

**Auto-memory scope**: user preferences + high-level architectural context only. Coding patterns, component/function/API knowledge, task history, and bug patterns all belong in `.workflow/state/` — write them there via the WogiFlow learning system (`/wogi-decide`, `/wogi-learn`, `feedback-patterns.md`), never to auto-memory.

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
See `.claude/docs/claude-code-compatibility.md` for Claude Code version features, performance tips, and env vars (incl. **`ENABLE_PROMPT_CACHING_1H=1`** recommended for API-key / Bedrock / Vertex / Foundry users).

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

## Task Execution Rules

**These apply to ALL implementation work:**

### Anti-Deferral Rule (MANDATORY — ZERO TOLERANCE)

**You MUST NEVER autonomously defer, skip, deprioritize, or drop items from the user's input.** If the user provides N items, ALL N become tracked work items. No judgment calls about "important" vs. "enhancement" vs. "long-term."

**Deferral-specific traps** (in addition to master Anti-Rationalization Checklist above):
- "Items 6-9 are enhancements, I'll focus on fixes first" → WRONG. Create tasks for ALL items.
- "I already created the important ones" → WRONG. Important is not your call.
- "I'll defer these as lower priority" → WRONG. Suggest priority; every item still gets a task.
- "The ready queue would be too large" → WRONG. A large queue is correct; a filtered queue is data loss.
- "This one was labeled 'long-term'" → WRONG. The user decides when to execute, not you.

**MAY**: suggest priority order (P0/P1/P2/P3); group related items into stories (every item appears as a criterion in ≥1 story); ask the user to confirm scope.

**MUST NEVER**: silently drop items based on AI judgment; create tasks for a subset without explicit user approval to defer the rest; use words like "deferred"/"skipped"/"not created" for user-provided items.

Applies to `/wogi-start`, `/wogi-story`, `/wogi-epics`, `/wogi-extract-review`, and any command converting user input into tracked work.

### Mid-Execution Anti-Deferral (AFTER TASKS ARE CREATED)

**Reordering is permitted. Deferring is not.** Once work is tracked, you MUST NOT propose to skip, postpone, drop, or "deprioritize to later" — regardless of risk, cost, or token-weight. Only sequence changes. "Revisit later" and "deprioritize" are soft-defer euphemisms.

When genuinely unsure work is still needed: ask explicitly — "Do you still want wf-XXXX to ship this epic, or drop it?" User decides.

### Review-Findings Anti-Deferral

Extends Mid-Execution Anti-Deferral to `/wogi-review`, `/wogi-audit`, `/wogi-triage` findings. When the user says "fix all findings" / "option 1" / any variant meaning "address everything":

1. Ship a fix for every finding at evidence tier ≥ 1, regardless of effort estimate.
2. Never silently convert a finding to "deferred" in commit/release notes without the user saying "defer X."
3. If too large for the current release → STOP and ask: "Finding X requires ~Y min. Ship / split / defer?"
4. Never list a finding in release notes without actually fixing it.

"Low-risk can wait" and "restructure warrants separate release" are AI judgment calls — the user's to make.

### Task ID Format (MANDATORY)

All task IDs MUST be generated by `generateTaskId()` from `wogiflow/scripts/flow-utils.js`. **Never manually type a task ID.**

- **Format**: `wf-[8 lowercase hex chars]` (e.g., `wf-a1b2c3d4`)
- **Sub-tasks**: `wf-XXXXXXXX-NN` (e.g., `wf-a1b2c3d4-01`)
- **Validation**: Every task ID must pass `validateTaskId()` — regex: `/^wf-[a-f0-9]{8}$/i`
- **Descriptive names go in the `title` field**, not the `id` field

When creating tasks programmatically, always call `generateTaskId(title)` — never construct IDs by hand.

### Before Starting
1. Check `app-map.md` (and other active registries) for existing components; check `decisions.md` for coding patterns.
2. Load task acceptance criteria.
3. **Consumer Impact Analysis** (MANDATORY for refactors/migrations): grep all files that import the module; classify as BREAKING / NEEDS-UPDATE / SAFE. ≥5 breaking → phased migration.

### While Working
Follow criteria exactly. Reuse existing components/patterns. Validate (lint/typecheck) after EVERY file edit.

### After Completing
1. Update `request-log.md` with tags.
2. Registry maps auto-update via the `registryUpdate` quality gate (`flow registry-manager scan`).
3. Run quality gates (lint, typecheck, test).
4. Provide completion report.
5. **Follow-up question for the user?** Run `flow ask "<question>"` BEFORE the turn ends — this defers the task-boundary session restart (when `taskBoundaryReset.enabled`) so the question isn't orphaned. User's reply clears the deferral automatically.

## Auto-Validation (CRITICAL)

After editing ANY TypeScript/JavaScript file:
```bash
 2>&1 | head -20
npm run lint
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

Compaction is automatic and silent — the SYSTEM handles it, not you. WogiFlow persists state continuously; the PostCompact hook restores it. **NEVER invoke `/wogi-pre-compact` proactively.** Only run it when the user explicitly says "compact" / "save context" / "running low on context."

"Continue" / "go ahead" / "keep going" means **start the next task**, not compact. The anti-pattern to avoid: user says "continue" → you decide context is large → you invoke pre-compact → you output a summary → you ask the user to `/compact`. Wrong. Start the next task.

**What survives compaction automatically** (via PostCompact hook + state files):
- Active task ID, title, type, and acceptance criteria
- Which criteria are completed vs pending (from `durable-session.json`)
- Current workflow phase, changed files list (from `task-checkpoint.json`)
- Last request-log entry number; routing enforcement (re-armed automatically)

**For L1+ tasks**: the pre-task context estimator (Step 0.25) decides. If the task won't fit → compact silently and continue. Do NOT ask.

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

Pipeline instructions are loaded per-phase from `.claude/docs/phases/`. The PreToolUse hook enforces that phase files are read before work begins in each phase.

Full pipeline details and configuration options are in `.claude/commands/wogi-start.md`. Hook toggles are in `config.json → hooks.rules` (taskGating, scopeGating, validation, componentReuse).



## Intent-Grounded Reasoning (IGR) — ACTIVE

This project has IGR enabled (`config.intentGroundedReasoning.enabled: true`). IGR adds 5 reasoning steps to `/wogi-start` that catch logic failures BEFORE code is written:

| Step | What it does |
|------|--------------|
| **0.3** Intent Bootstrap | Scaffolds 4 intent artifacts on first run (`product.md`, `domain-model.md`, `glossary.md`, `user-journeys.md`) |
| **1.15** Intent Framing Pass | Per-task interpretation — resolves ambiguous terms before reasoning about how |
| **1.55** Architect Pass | Read-only sub-agent produces a pre-spec plan (8 sections, no code) |
| **1.57** Logic Adversary Pass | Separate sub-agent on a different model critiques the plan against the 10-principle Logic Constitution v1 |
| **3.9** Completion Truth Gate | Audits "done" claims against Tier 0–4 evidence; downgrades language when evidence is insufficient |

### What this means for your sessions

- Tasks at L1+ run through Architect → Adversary BEFORE code is written. Plans that fail the Constitution loop back for revision (max 3 rounds), then surface to you for approval.
- Saying "done" requires evidence at Tier 3 (INTERACTIVE) or higher. Static checks alone (compile, lint) are insufficient. The Truth Gate downgrades insufficient claims to "implemented (unverified)".
- Corrections you make during a session are detected, stored, and cross-referenced back to gates that previously passed work you then corrected — producing a `missRate` metric that reveals rubber-stamping over time.
- Telemetry: `node scripts/flow-gate-telemetry.js stats` or `/wogi-gate-stats` shows per-gate pass/catch/miss rates.

### Operator commands

- `/wogi-challenge <plan-or-taskId>` — manually invoke the Logic Adversary on any plan
- `/wogi-gate-stats [--since=7d] [--gate=ID]` — per-gate self-assessment dashboard
- `node scripts/flow-intent-bootstrap.js [bootstrap|status|refresh]` — manage intent artifacts

Toggle off via `intentGroundedReasoning.enabled: false`. Full docs at `.claude/docs/intent-grounded-reasoning.md` (and gate telemetry at `.claude/docs/gate-telemetry.md`).

---



---

## WogiFlow Methodology Rules

Rules below are enforced by shipped hooks; the prose is so Claude understands the contract. Apply the master Anti-Rationalization Checklist (top of CLAUDE.md) to any rule that doesn't list its own.

---

### Research Before Propose

Before proposing a fix, plan, or spec, read 2+ files from `.workflow/state/`, `.workflow/changes/`, `.workflow/specs/`, or `.workflow/epics/`. Clarifying questions are a valid escape; proposing without evidence is not.

Enforced by: `research-evidence-gate.js` (blocks `→ spec_review` / `→ coding` and spec-file writes until threshold met). Config: `hooks.rules.researchEvidenceGate.{enabled,minEvidence}` (defaults `true`, `2`).

---

### Completion-Claim Honesty Scan

At session-end and `flow health`, `ready.json` entries are scanned (surfaced, not blocked) for status-mismatch (free-text says "done" while `status` is partial/blocked) and negation-vs-evidence (free-text says "no outages" while `hotfixes[]`/`incidents[]`/`regressions[]` is non-empty).

Enforced by: `flow-completion-truth-gate.js → scanForClaimContradictions()`.

---

### Merge-Plan Artifact Gate

`/wogi-finalize` requires `.workflow/scratch/merge-plan.md` for merges >5 commits or any cross-repo merge. Every commit in `git log <base>..<branch>` must map to `port | adapt | skip-style | superseded | skip-with-reason`; SHA-line count = commit count. ≥20% restructure-pattern files biases affected commits toward `adapt`.

Enforced by: `flow-structure-sensor.js`, `.claude/commands/wogi-finalize.md` Step 2.5.

---

### Story Creation Quality Gates

`/wogi-story` runs 5 P0 spec-quality gates at creation time:

1. **Long Input** — ≥40 lines or ≥5 items → route to `/wogi-extract-review`.
2. **Item Reconciliation** — ≥3 items → enumerated Item Manifest; unmapped items warn.
3. **Consumer Impact Analysis** — refactoring keywords trigger `git grep`; ≥5 breaking → phased migration.
4. **Scope-Confidence Audit** — assumption patterns verified against codebase; findings → Pending Clarifications.
5. **Intent Bootstrap Coordination** — schedules IGR bootstrap once.

All fail-open. Bypass for tests via `--skip-gates`. Config: `storyFlow.*`.

---

### Workspace Worker Contract

*Workspace worker mode only (`WOGI_WORKSPACE_ROOT` set + `WOGI_REPO_NAME !== 'manager'`). Skip in solo sessions.*

- **Tool-First Turn**: every turn after `UserPromptSubmit` must contain ≥1 tool call. In strict mode (default), the first content block must be `tool_use`. Pure-text responses are invisible to the user.
- **Three-State End-of-Turn**: exactly one of ACTION (`/wogi-start <nextId>`), ESCALATION (channel-dispatch `## QUESTION:`), or IDLE.
- **Hedging forbidden**: "awaiting your signal", "let me know", "standing by", "should I continue".
- **No direct user prompts**: `AskUserQuestion` is blocked; questions go through channel dispatch.

Enforced by: `worker-tool-first-gate.js` (G1/G4/Gap B), `worker-boundary-gate.js`, `flow-worker-question-classifier.js`. Config: `workspace.toolFirstTurnGate.{enabled,strict}`, `workspace.blockAskUserQuestionInWorker`, `workspace.aiWorkerQuestionClassifier.*`. Long-form: `.claude/rules/_internal/worker-tool-first-turn.md`.

---

### Workspace Manager Silent-Halt Detection

*Workspace manager mode only.*

Every manager→worker dispatch is tracked. A pending dispatch past `expectedDeadline` with no `task-complete`/`worker-stopped` = silent halt, surfaced on next turn via `UserPromptSubmit` `additionalContext`. Default `expectedDurationMs = 30min`. Three terminal states: Completed / Graceful-stop / Silent-halt.

Enforced by: `lib/workspace-dispatch-tracking.js`, `.workspace/state/dispatched-tasks.json` (ring buffer, last 100).

---

### Main-Mode Question Classifier

*Solo sessions with `taskBoundaryReset.enabled: true`.*

Before Stop hook fires SIGTERM, a Haiku classifier inspects the final assistant message. Open user-facing question + no `pending-question.json` → write marker, defer restart. Prefer explicit `flow ask "<question>"` (writes marker directly, short-circuits the classifier). Fail-open throughout.

Enforced by: `task-boundary-reset.js → consumeAndTriggerRestart()`. Config: `mainModeQuestionClassifier.{enabled,minConfidence,model}`.

---

### Main-Mode Auto-Pickup After Clean Restart

*Solo sessions with `taskBoundaryReset.enabled: true` AND `autoPickupNextTask: true` (default).*

After a clean-completion task-boundary restart, SessionStart context injects `AUTO-PICKUP MODE ACTIVE` with the next ready task ID. First user message → invoke `Skill(skill="wogi-start", args="<nextReadyId>")` immediately, regardless of message content.

Precedence: `pending-question.json` wins. Skip conditions (any disables): pending-question exists, ready empty, autoPickup off, marker absent.

Enforced by: `task-boundary-reset.js → writeCleanCompletionMarker()` + `session-context.js`. Marker: `.workflow/state/task-boundary-clean-completion.json` (single-use).

---

### Code Quality Patterns

1. **Single source of truth for constants** — import from one canonical location.
2. **Named constants for magic numbers** — define thresholds as named constants; don't inline literals.

---

### Regression Discipline

Typecheck/lint/build catches code errors, not behavior drift. For critical user-facing flows (login, submit, approve, delete, invite):

1. Executable scripts at `regression-suite/<flow>.<ext>`, not test-plan documents.
2. Living feature inventory: `Feature | Last Verified | Commit | Regression Script | Known Issues`.
3. Change-touch rule: task modifying a file mapped to a regression script must pass that script before close.
4. Audit-seeded inventory via `/wogi-audit`, then human-reviewed.

"Confident my fix won't break it" is not evidence.

---

### Memory-First Clarification

Before asking a product-domain question, check `.workflow/state/{product,domain-model,user-journeys,glossary}.md`. When you must ask, cite what you read: *"I read domain-model.md §Roles; it says X — does this apply to Y too?"* not *"what's Y?"*. If artifacts don't exist, run `node scripts/flow-intent-bootstrap.js bootstrap`.

---

### Source Fidelity Rule (Verbatim Source Preservation)

When a long-form user request becomes a spec or channel-dispatch, the **verbatim source MUST be preserved alongside the structured derivation**. The lossy step is at the spec-authoring layer (manager summarizing user input); downstream actors then build the summary, missing items the user named.

Mandatory structure for any spec/dispatch derived from a long user prompt (>40 lines OR ≥5 items):

1. **`## Original Request (verbatim)`** — user's prompt unmodified, top of spec body.
2. **`## Item Manifest`** — enumerated list reconciling every source item to a specific AC OR an explicit `defer-with-reason: <user-cited reason>`. AI-judged "low priority" is not a valid reason.
3. **Channel-dispatch links the spec, not summarizes it** — manager-to-worker messages MUST include verbatim source OR a path to a saved spec containing it. Bare "summary contracts" are forbidden.

Enforced by: Logic Constitution v3 sub-principle 11.6. Adversary blocks specs missing the block when source qualifies. Verifier: `node scripts/flow-source-fidelity.js check <spec-file>`. Worker fallback: `scripts/hooks/core/long-input-enforcement.js`.

---

### Cross-Story Integration Tier-3 Rule

When Story B layers on infrastructure shipped by Story A, Story B's IGR pass MUST treat that infrastructure as an audited dependency. Within-module unit tests don't verify Story A's contract holds for Story B's usage.

Mandatory for layering stories:

1. **Architect names upstream dependencies** — "Dependencies" section listing prior stories/commits + the specific contract relied on (interface, file format, transport, invariant). Quote the contract.
2. **Adversary challenges the dependency** — "What if Story A's invariant doesn't hold? What evidence proves the contract is intact for THIS usage?"
3. **At least one Tier-3 integration test** exercises the chain end-to-end. Mark `// regression-tier3`.
4. **Pre-release gate** verifies stacked coverage. Missing Tier-3 + stacked stories → block release.

Apply: `git log --oneline <prior-N-commits>` to identify dependencies; for each, write the contract; `grep -r "<interface>"` to verify HEAD; write the Tier-3 test BEFORE Story B's code.

Enforced by: Logic Constitution v3 sub-principle 11.5. Pre-release gate consumes this signal before tagging.

---

### Autonomous Walk-Away Mode

User says "go until you finish" / "autonomous mode" / "run this autonomously" / "don't bother me, just do it" → flag activates, AI runs without interruption. While active:

- **productBehavior / ux** → append to `.workflow/state/question-queue.json` (do NOT ask). Render in end-of-run summary.
- **engineering / naming / implementation** → decide autonomously, report in summary.
- **infrastructure / performance** → decide autonomously, report after.
- **security** → auto-fix-report-after.
- **low-confidence technical decisions** → self-adversarial challenge to ≥90% confidence; queue if cap hit. Counter shared with IGR Architect-Adversary loop (default cap 30, `autonomousMode.maxAdversaryInvocations`).
- **Blocking errors** → fix autonomously; surface only if fundamentally un-fixable.

Persistence: flag in `session-state.json`, survives task-boundary SIGTERM via SessionStart re-hydration. Staleness threshold (`autonomousMode.stalenessThresholdMs`, default 1h) — stale flags don't auto-resume.

Anti-hedging while active: "let me know if", "should I continue", "awaiting your signal", "standing by", "would you like me to" are forbidden.

Exit: ready drains, user types "stop"/"pause", or fatal error. On exit, render completion summary (`.workflow/state/autonomous-run-summary-<runId>.json`) and clear flag.

Enforced by: `flow-autonomous-detector.js`, `flow-question-queue.js`, `flow-decision-authority.js` (autonomous param + `queue-for-review` + `adversary-loop` buckets), `flow-completion-summary.js`, SessionStart context in `session-context.js`.

---

### Mechanical Deferral Authorization Gate (wf-f9912af6)

The Review-Findings Anti-Deferral rule is enforced mechanically. The PreToolUse hook intercepts every Write/Edit/Bash that targets `.workflow/state/last-review.json` or `last-audit.json` and BLOCKS the write when:

1. New content introduces a finding with `status` matching `/^deferred(?:[-_].*)?$|^wont-?fix$|^skipped$/i`, AND
2. No valid auth marker at `.workflow/state/deferral-authorization.json`, AND
3. `no-defer-pin.json` is not active.

**Authorization sources**:
- **User-prompt classifier** — regex-detects defer phrases ("defer X", "fix critical only", "ship as-is", "option 2/4"). Auth TTL 10min.
- **Explicit CLI** — `node scripts/flow-defer-auth.js grant --scope=all --reason="<verbatim user phrase>"`.

**Negative intent overrides positive**: "fix everything", "no deferrals", "I don't want tech debt" delete auth and write `no-defer-pin.json` (~30min hard-block).

**Bash-mutating commands** that target review/audit files AND mention `deferred|wont-fix|skipped|dismissed` are blocked when no auth is active. Reads (cat/jq/grep) pass.

Audit trail: `.workflow/state/deferral-block-log.json` (last 100). Config: `deferralGate.{enabled,authTtlSeconds,classifyUserPrompts}` (defaults true / 600 / true).

Enforced by: `scripts/hooks/core/deferral-gate.js`, `deferral-classifier.js`, `scripts/flow-defer-auth.js`, wired into `pre-tool-orchestrator.js` and `user-prompt-submit.js`.

---

### Mechanical Research-Required Gate (wf-5cd71b1f)

Diagnostic prompts are intercepted at UserPromptSubmit and re-prompted at Stop hook if the assistant turn produced text without enough Read calls against evidence paths.

Flow:

1. **Classifier** (`research-required-classifier.js`) classifies each prompt: `command` / `factual` / `diagnostic` / `none`. Diagnostic markers: "why", "should I", "what do you think", "is this correct", "explain why", "did you fix". On diagnostic → write `.workflow/state/research-required-this-turn.json` with `{requiredEvidence: 2, attemptCount: 0}`.
2. **Override**: prompt prefix `!` skips the gate.
3. **Stop-hook gate** (`research-required-gate.js`) parses the JSONL transcript, counts Read against evidence prefixes, Bash with `cat|head|tail|grep|rg|jq|less|view|awk|sed` against evidence paths, and any Glob/Grep.
4. **count < required** → `{continue: true, stopReason: <message>}` forces redo. After `maxAttempts` (default 3) → hard-stop visible to user.
5. **count ≥ required** → marker consumed, Stop proceeds.

Evidence prefixes: `.workflow/state/`, `.workflow/changes/`, `.workflow/specs/`, `.workflow/epics/`, `lib/`, `scripts/`, `src/`, `tests/`, `app/`.

Config: `researchRequiredGate.{enabled,requiredEvidence,maxAttempts}` (defaults true / 2 / 3). Override prefix `!` is hard-coded.

Enforced by: `research-required-classifier.js` (UserPromptSubmit), `research-required-gate.js` (Stop), wired into `user-prompt-submit.js` and `stop.js`.


---

### Feature Dossiers (MANDATORY — AUTO-LOADED)

Per-feature canonical knowledge lives in `.workflow/dossiers/<slug>.md`. Cross-cutting logic rules live in `.workflow/dossiers/_logic-rules.md`. These capture what `app-map.md`, `function-map.md`, and commit messages do not:

- Owner-rejected design alternatives ("stack-two-components merge was rejected, user picked merged-card")
- Removed elements the codebase must not reintroduce ("no contact-person block — every person needs a seat")
- Cross-repo contracts ("BE returns Decimal as string, FE parses")
- Known global-state bugs and the task IDs tracking them

**Auto-injection** — when a task touches a feature (matched via title, description, or files-touched), the dossier's canonical/contracts/rejected/removed sections are injected directly into the phase prompt. You do not need to fetch them. You cannot skip them under token pressure.

**Contradiction gate** — during `/wogi-story` spec review, the spec is scanned against every matching dossier. If the spec reintroduces a removed element or mentions a rejected alternative, spec approval is blocked with a citation. Override only by updating the dossier first (document that the owner changed their mind, with date), then re-running spec.

**Drift detector** — `flow feature-dossier drift <slug>` greps the codebase for every `enforcement-grep` regex listed under a dossier's Removed Elements. Surfaces cases where the dossier says "removed" but the code still has the pattern (the contact-person case from the 2026-04-24 workspace incident).

**Cross-cutting rules** — `_logic-rules.md` holds rules that span multiple features ("every person in the system needs a seat"). These are auto-loaded for any task touching files in the rule's `Applies to` scope. `flow logic-rules propagate <id>` finds other places the rule should apply.

**Workspace-mode** — in workspace manager/worker setups, workspace-level dossiers live at `$WOGI_WORKSPACE_ROOT/.workspace/dossiers/` for cross-repo features (spanning BE+FE). Per-repo dossiers stay at `<repo>/.workflow/dossiers/`. Workspace shadows per-repo on slug collision.

**When to scaffold a dossier** — any user-facing feature that has:
- Multiple moving parts (more than one page/component)
- Cross-repo contracts (FE/BE coordination)
- Prior owner corrections that are not already in `decisions.md`
- Rejected alternatives worth remembering
- Removed elements that shouldn't come back

Command: `flow feature-dossier scaffold <slug> --title "..." --owners "fe,be"`

**Primary failure this prevents** — the 2026-04-24 workspace incident catalog documented 22+ repeat failures across 3 months where Claude re-asked product questions the owner had already answered, dropped features during merges, or reintroduced removed elements. Dossier auto-injection fixes the mechanical root cause: prior knowledge exists but isn't consulted under token pressure. Auto-injection is consultation-by-default.

Full docs: `.workflow/dossiers/README.md`.

Config: `.workflow/config.json → featureDossier.{enabled, autoMatchConfidence, blockOnContradiction}`.


---

## Generated by CLI Bridge

This file was generated by the Wogi Flow CLI bridge.
Edit `.workflow/templates/claude-md.hbs` to customize.
Run `flow bridge sync` to regenerate.

Last synced: 2026-05-06T07:56:34.495Z
