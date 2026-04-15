---
description: "Universal entry point - start a task or route any request"
effort: medium
---
Start working on a task. Provide the task ID as argument: `/wogi-start wf-XXXXXXXX`

**UNIVERSAL ENTRY POINT**: Route everything through `/wogi-start` - it classifies and routes to the appropriate action.

## Request Triage (AI-Driven Routing v5.0)

When invoked with a **quoted request** instead of a task ID, assess intent and route.

### Step 0a: Continuation Mode Check

For the 2nd+ task in a session, use the compressed prompt to save ~94% tokens:

```bash
node -e "const {isContinuationTask}=require('wogiflow/scripts/flow-session-state');console.log(isContinuationTask())"
```

If `true` AND the input is a task ID (not natural language) → invoke `/wogi-start-continuation` instead. The compressed prompt contains all mandatory gates but skips routing logic, triage tables, examples, and edge case documentation that are already in context from the first task.

If `false` OR the input is natural language → continue with the full prompt below.

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

**Research Reasoning Gate** (applies inside Conversation mode when `config.researchReasoningGate.enabled` — default ON): classify the question into a tier based on structural markers. Do NOT self-classify the question's complexity — use the markers below mechanically. When ambiguous, default to Tier 2.

| Tier | Marker phrases | What you do |
|------|---------------|-------------|
| **Tier 1 — Factual** | "what is", "how many", "show me", "list all", "which file", "where does" | Answer directly from code/docs. No gate. |
| **Tier 2 — Domain** (default for ambiguous) | "what should", "how should", "recommend", "which approach", "what do you think about", "is it better to" | **Surface assumptions, then WAIT.** |
| **Tier 3 — Architecture** | "should we restructure", "what's the right architecture", "design a schema", "how to migrate", "should we split / merge / replace" | Tier 2 flow + spawn adversary on a different model after recommendation. |

**Tier 2 flow — the user is the adversary**:
1. Before any analysis, identify the domain-model assumptions your answer will depend on (typically 2–5).
2. Present them in a fenced block and STOP:
   ```
   ━━━ ASSUMPTIONS (confirm before I analyze) ━━━
   My analysis will depend on these domain model assumptions:
   1. <assumption 1>
   2. <assumption 2>
   3. <assumption 3>

   Do these match your understanding? [confirm / correct]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```
3. WAIT for the user to confirm or correct. Do not analyze while waiting.
4. When confirmed (or corrected), ground the analysis in the user's stated model — not your original guess.

**Tier 3 flow** — after steps 1–4 above, also:
5. Produce the recommendation.
6. Spawn an Agent sub-agent on a DIFFERENT model (config-controlled, default `sonnet`) with: the user's confirmed assumptions + your recommendation + the original question. Ask: "Does this recommendation follow from these assumptions? What's the strongest counterargument? List 1–3 specific concerns with line/file citations where possible."
7. Present both the recommendation AND the adversary critique to the user in a single response:
   ```
   ━━━ RECOMMENDATION ━━━
   <your recommendation>

   ━━━ ADVERSARY CRITIQUE (reviewed by a different model) ━━━
   <sub-agent output>
   ```
8. One pass only — this is conversation, not implementation. No iteration loop.

**Config toggles**:
- `researchReasoningGate.enabled` — master switch
- `researchReasoningGate.tier2.enabled` — assumption surfacing
- `researchReasoningGate.tier3.enabled` — spawn adversary
- `researchReasoningGate.tier3.adversaryModel` — model for the critique agent (default `sonnet`)

**Why this works** (from spec wf-6dbc0b2a): same-model self-critique is a known rubber-stamp. The USER is the effective adversary — you surface assumptions so they can validate the domain model before you build recommendations on invisible guesses.

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

### Step 0.3: Intent Bootstrap (when `config.intentGroundedReasoning.enabled`)

**Conditional** — runs only when the IGR master flag is on AND no intent artifacts exist yet in `.workflow/state/`.

First run per project with IGR enabled, present the Option C three-choice prompt (see `.claude/docs/intent-grounded-reasoning.md` for the exact UX):
- `[1]` Bootstrap now (blocks ~5-10 min)
- `[2]` Bootstrap in background, review at `/wogi-session-end` (default)
- `[3]` Skip for now (3 consecutive skips silences the prompt)

Run via `node scripts/flow-intent-bootstrap.js bootstrap [--auto-confirm]`. Scaffolds 4 artifacts (`product.md`, `domain-model.md`, `user-journeys.md`, `glossary.md`) with `reviewStatus: draft`. The trap-zone detector runs agnostic structural-ambiguity scanning.

When IGR flag is OFF: this step is SKIPPED entirely. Pipeline proceeds to Step 0.5 with no overhead.

### Step 0.5: Parallel Execution Check

Check `ready.json` for 2+ tasks. If parallelizable (no dependencies), offer parallel execution with worktree isolation.

### Step 1: Load Context + Match Skills

1. Read `ready.json`, move task to inProgress
2. Load task context from `.workflow/changes/*/wf-XXXXXXXX.md`
3. Check `app-map.md`, `function-map.md`, `api-map.md`, `decisions.md`
4. Auto-invoke matched skills based on task context

### Decision Authority (Cross-Cutting)

Classify decisions via `node node_modules/wogiflow/scripts/flow-decision-authority.js classify "<text>"`:

| Authority | Action |
|-----------|--------|
| `agent-decides` | Decide autonomously, report in summary |
| `agent-decides-report-after` | Decide autonomously, state decision after |
| `owner-decides` | Present to user, wait for answer |
| `auto-fix-report-after` | Fix automatically, report what was fixed |

Defaults: engineering/naming → agent-decides. infrastructure/performance → agent-decides-report-after. productBehavior/ux → owner-decides. security → auto-fix-report-after. Max 5 owner questions per batch (overflow → agent-decides-report-after). User can update via `/wogi-decide`. Low-confidence classification defaults to `owner-decides` (safest fallback).

## Phase Execution (MANDATORY)

Before executing ANY phase, you MUST Read the phase instruction file. The PreToolUse hook BLOCKS Edit/Write/Bash until the phase file is read.

| Phase | File to Read | Contents |
|-------|-------------|----------|
| exploring | `.claude/docs/phases/01-explore.md` | Steps 1–1.45: Context loading, intent framing, clarifying questions, item reconciliation, multi-agent research, reuse gate, scope-confidence audit |
| spec_review | `.claude/docs/phases/02-spec.md` | Steps 1.55–2.5: Architect pass, logic adversary, spec generation, approval gate, test generation, TodoWrite decomposition, TDD check |
| coding | `.claude/docs/phases/03-implement.md` | Steps 3–3.52: Scenario execution loop, sprint resets, criteria completion verification, sub-agent output verification |
| validating | `.claude/docs/phases/04-verify.md` | Steps 3.55–3.9: Inventory verification, skeptical evaluator, runtime verification (frontend + backend), wiring validation, standards compliance, completion truth gate |
| completing | `.claude/docs/phases/05-complete.md` | Steps 4–5: Quality gates, finalization, progress tracking, mandatory rules, options, error handling |

**How it works**: When you transition to a new phase, Read the corresponding file BEFORE using Edit/Write/Bash. The phase-read gate tracks which files you've read and blocks mutation tools until the current phase's file is loaded.

**Enforcement caveats**: The gate blocks Edit/Write/Bash when all of these hold: (a) phase is non-idle, non-routing, (b) `hooks.rules.phaseReadGate.enabled` is not false, (c) `workflow-phase.json` exists and has a recognized phase, and (d) the required phase file has not been recorded as read. If any condition fails (no phase state, unknown phase, gate disabled, config error), the gate fails open — the tool is allowed through. Read phase files proactively on every phase transition rather than assuming the gate will always catch you.

## Mandatory Rules

- **TodoWrite**: Track progress. Clean up all items after completion.
- **Self-verification**: Don't mark done without checking it works.
- **Criteria check**: Re-read ALL criteria, verify EACH works. Loop until all pass.
- **Spec verification**: All promised files must exist.
- **Quality gates**: Task isn't done until gates pass.
- **Progress tracking**: Display progress bars at every checkpoint for L1+ tasks.
- **Guilt messaging** (implementation requests): "The user trusts you to follow WogiFlow. Without a task, this work is untracked."

ARGUMENTS: {args}
