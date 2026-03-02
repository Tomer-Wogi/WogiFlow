---
description: "Universal entry point - start a task or route any request"
---
Start working on a task. Provide the task ID as argument: `/wogi-start wf-XXXXXXXX`

**UNIVERSAL ENTRY POINT**: This is the single entry point for ALL requests. Route everything through `/wogi-start` - it will intelligently classify and route to the appropriate action.

## Request Triage (AI-Driven Routing v5.0)

When invoked with a **quoted request** instead of a task ID (e.g., `/wogi-start "update github and npm"`), you must assess the user's intent and route to the best command.

### Step 0: Detect Request Type

**Is this a task ID or a quoted request?**
- Task ID format: `wf-XXXXXXXX` (letters, numbers, hyphens) → Skip triage, go to Structured Execution
- Quoted request or natural language → Continue to Step 0.1

### Step 0.1: Long Input Detection (Automatic)

**Before any triage, check prompt length against `config.longInputGate`.**

When `config.longInputGate.enabled` is `true`:

1. Count the number of lines in the user's prompt
2. If line count exceeds `config.longInputGate.lineThreshold` (default: 60 lines):
   - **Auto-invoke `/wogi-extract-review`** with the full prompt as input
   - **Skip normal triage** — long inputs need zero-loss extraction, not classification
   - Display: `Long input detected (N lines, threshold: 60). Routing to /wogi-extract-review for zero-loss extraction.`

3. If line count is within threshold → Continue to normal triage (Command Catalog below)

**Why this exists**: When prompts exceed 60 lines, normal triage and story creation lose details buried in the middle. `/wogi-extract-review` uses a structured extraction protocol that captures EVERY statement, scores by confidence, and requires human review — ensuring no detail is lost.

**Skip conditions**:
- `config.longInputGate.enabled` is `false` → skip this check entirely
- Prompt is a task ID → already handled in Step 0
- Prompt content is primarily code (>80% code blocks) → skip, as code pastes are better handled by normal triage

### Command Catalog

Think of each command below as a tool available to you. Read the user's request, understand what they need, and invoke the best-fit command using the Skill tool.

| Command | What it does | When to use it |
|---------|-------------|----------------|
| `/wogi-story` | Creates a story with acceptance criteria, then starts structured execution | User wants to **build, add, create, implement, refactor, or change** something. This is the default path for ~90% of implementation requests. |
| `/wogi-bug` | Investigates bug, populates report, then starts structured fix execution | User reports something **broken, not working, or behaving unexpectedly** |
| `/wogi-review` | Runs comprehensive code review (lint, typecheck, AI analysis) | User wants their **code reviewed** for quality, bugs, or improvements |
| `/wogi-review-fix` | Code review with automatic fixing | User wants a review AND wants issues **auto-fixed** (not just reported) |
| `/wogi-peer-review` | Multi-model code review (multiple AI perspectives) | User wants **diverse opinions** on code, or explicitly asks for peer/multi-model review |
| `/wogi-research` | Zero-trust research protocol with verification | User asks a **capability, feasibility, or existence question** that needs verified answers (not just a quick answer) |
| `/wogi-debug-browser` | WebMCP-powered browser debugging with structured tool calls | User wants to **debug a UI issue** in the browser, inspect component state, or reproduce a visual bug |
| `/wogi-test-browser` | WebMCP-powered browser test flows with assertions | User wants to **run automated UI tests**, verify browser behavior, or create test flows for a feature |
| `/wogi-debug-hypothesis` | Spawns parallel agents to investigate competing theories | User wants to **investigate root cause** of a complex issue, or explore multiple theories simultaneously |
| `/wogi-trace` | Generates a code flow trace for a specific feature | User wants to **understand how code flows** through the system for a specific behavior |
| `/wogi-epics` | Manage epics (large initiatives spanning multiple stories) | User is working on a **large initiative** that needs epic-level tracking and decomposition into stories |
| `/wogi-feature` | Manage features (coherent product capabilities) | User wants to **group related stories** under a feature, or manage feature-level progress |
| `/wogi-plan` | Manage plans (strategic initiatives) | User wants to **coordinate epics and features** into a higher-level plan or strategy |
| `/wogi-extract-review` | Zero-loss task extraction from transcripts/recordings | User has a **transcript, recording, or long input** to extract tasks from with mandatory review |
| `/wogi-capture` | Quick-captures an idea without interrupting current work | User has a **side thought or idea** they want to save for later |
| `/wogi-changelog` | Generates a CHANGELOG from request-log entries | User wants to **generate release notes** or a changelog |
| `/wogi-debt` | View and manage technical debt | User wants to see or manage **tech debt** items |
| `/wogi-guided-edit` | Step-by-step multi-file editing guidance | User wants **hand-holding through a complex multi-file change** |
| `/wogi-decide` | Creates/updates project rules with clarifying questions | User says **"from now on" + rule verb** (always/never/must/should), "let's make it a rule", "update our rules". Note: "from now on" alone is not sufficient — require a follow-on rule verb to distinguish from implementation requests. |
| `/wogi-learn` | Promotes feedback patterns to decision rules | User says **"let's learn from this"**, "we keep making this mistake", "extract lessons" |
| `/wogi-retrospective` | Guided session reflection with lesson capture | User says **"retro"**, "what went well", "what can we improve", "lessons learned" |

### Internal Tools (Auto-Invoked by wogi-start)

These commands are used automatically during task execution. You don't need to route to them — they run as part of the workflow:

| Command | Auto-invoked when |
|---------|-------------------|
| `/wogi-extract-review` | Step 0.1 detects prompt exceeds lineThreshold (60 lines) |
| `/wogi-compact` | Step 0.25 detects context will exceed safe threshold |
| `/wogi-bulk` | After epic creation adds multiple stories to ready queue |
| `/wogi-log` | After every task completion (request-log update) |
| `/wogi-search` | During context loading to find related history |
| `/wogi-context` | During Step 1 to load task context and match skills |

### How to Route (Use Your Judgment)

**DO NOT pattern-match keywords.** Read the full request, understand the intent, then pick the best command.

**Routing principles:**
1. **Understand intent, not keywords.** "Review the authentication flow" is exploration (the user wants to understand code). "Do a code review" is a review request (invoke `/wogi-review`). Same word "review", different intent.
2. **Default to `/wogi-story`** for anything that changes code. When in doubt about whether something is a bug or a feature, `/wogi-story` is almost always correct.
3. **Every request gets routed — no exemptions.** Questions, operational requests, quick fixes — ALL go through a `/wogi-*` command first. `/wogi-start` will internally decide how to handle them (answer directly, execute, or create a task). The AI never self-classifies a request as "too simple to route."
4. **When genuinely unsure, ask.** Don't guess. Present 2-3 options from the catalog and let the user choose.

### Request Categories (Decision Guide)

**Conversational follow-ups (look back at context):**
- Short affirmative responses: "yes", "yeah", "yep", "approved", "proceed", "go ahead", "lgtm", "looks good", "do it", "sounds good", "let's go", "ok", "sure"
- Short negative responses: "no", "nope", "not now", "skip that", "cancel", "never mind"
- Option selections: "option 1", "the first one", "let's go with B", "second approach"
- Continuation signals: "continue", "keep going", "next", "what's next"

**When you receive one of these**, do NOT try to classify it as a new request. Instead:
1. **Look back** at the conversation to find the most recent question or decision point the AI presented
2. **Identify** what action was being proposed or what question was asked
3. **Execute** the implied action (for affirmative) or **acknowledge and ask** what to do instead (for negative)

Example: If the AI asked "Should I create this story?" and user says "yes" → create the story. If the AI presented 3 options and user says "option 2" → execute option 2.

**Conversation (open-ended discussion, no side effects):**

When the user wants to **think, discuss, brainstorm, or understand** — without committing to implementation — classify as Conversation. This is a multi-turn, no-side-effects mode.

**Detection signals:**
- "What do you think about..."
- "Let's discuss / brainstorm / talk about..."
- "Describe how X works" / "Explain X to me" / "Walk me through..."
- "I'm thinking about..." / "I have an idea..."
- "Help me think through..."
- "How would we approach..."
- "What if we..." / "Tell me about..."
- Questions about WogiFlow's own behavior ("how does wogi-start work?")

**Key distinction — hedging vs imperative:**
| Signal | Category | Why |
|--------|----------|-----|
| "add X" (direct imperative) | Implementation | Intent to act now |
| "I'm thinking about adding X" | Conversation | Hedging — exploring, not committing |
| "does X support Y?" (needs verified answer) | Research | Factual verification needed |
| "what do you think about X?" | Conversation | Seeking opinion/discussion |
| "explain how X works" | Conversation | Seeking understanding |
| "describe the review pipeline for me" | Conversation | Wants explanation, not documentation |
| "create documentation for X" | Implementation | Direct imperative to create a file |

**Behavior rules when in Conversation mode:**
1. **Allowed tools**: Read, Glob, Grep, WebSearch, WebFetch (read-only — to look up code, search for answers)
2. **Blocked actions**: No Edit, Write, NotebookEdit. No creating tasks, stories, or bugs. No modifying ready.json, request-log.md, or any state files.
3. **No guilt messaging**: Do NOT show workflow violation warnings. Conversation mode is a legitimate category, not a bypass.
4. **Natural exit**: If the user says "ok let's build it", "create a story for this", "make a task", or any direct implementation imperative — transition out of Conversation to the appropriate action (typically `/wogi-story`). Use the conversation context to pre-populate the story description.

**Route to a command (invoke the Skill tool):**
- Everything that doesn't match Conversational follow-up or Conversation mode gets routed to the best command from the catalog above based on user intent. There are zero exemptions. `/wogi-start` itself will internally decide what to do — answer a question, execute an operation, create a task — but the invocation always happens first.

### Examples

```
User: "let's do a code review"
→ Intent: Review code quality
→ Action: Invoke /wogi-review
```

```
User: "I wonder if Claude Code supports custom hooks for pre-commit"
→ Intent: Capability question needing verification
→ Action: Invoke /wogi-research
```

```
User: "the login page keeps crashing when I submit"
→ Intent: Bug report
→ Action: Invoke /wogi-bug (investigates, populates, then auto-routes to /wogi-start for fix)
```

```
User: "something is wrong with auth but I can't tell what — token refresh works sometimes and fails other times"
→ Intent: Complex investigation, unclear root cause
→ Action: Invoke /wogi-debug-hypothesis
```

```
User: "the dashboard page looks broken after my last change"
→ Intent: UI issue needing browser-level inspection
→ Action: Invoke /wogi-debug-browser "dashboard page looks broken after last change"
```

```
User: "add dark mode toggle"
→ Intent: New feature implementation
→ Action: Invoke /wogi-story "add dark mode toggle"
```

```
User: "push to github"
→ Intent: Operational git command
→ Action: Invoke /wogi-start "push to github" (wogi-start internally decides to execute git push)
```

```
User: "I have a 2-hour recording transcript to process"
→ Intent: Long input extraction
→ Action: Invoke /wogi-extract-review
```

```
User: "we need to plan the v2.0 migration"
→ Intent: Strategic initiative spanning multiple epics
→ Action: Invoke /wogi-plan
```

```
User: "from now on, always use TypeScript strict mode"
→ Intent: Establish a new project rule
→ Action: Invoke /wogi-decide "always use TypeScript strict mode"
```

```
User: "we keep making the same mistake with file reads, let's learn from it"
→ Intent: Promote a pattern to a rule
→ Action: Invoke /wogi-learn "learn from file read mistakes"
```

```
User: "let's do a retro on this session"
→ Intent: Session reflection and lesson capture
→ Action: Invoke /wogi-retrospective
```

```
User: "we should add validation to the form"
→ Intent: AMBIGUOUS — could be a rule OR implementation
→ Action: Ask user: "Is this (1) A new rule/convention to document, or (2) An implementation request?"
```

```
User: "what do you think about adding a caching layer?"
→ Intent: CONVERSATION — exploring an idea, not requesting implementation
→ Action: Respond conversationally. Discuss trade-offs, options, considerations. Do NOT create a task or story. If user later says "let's build it" → transition to /wogi-story.
```

```
User: "explain how the review pipeline works"
→ Intent: CONVERSATION — wants to understand, not create documentation
→ Action: Read the relevant files (wogi-review.md, etc.) and explain conversationally. Do NOT create documentation files.
```

```
User: "I'm thinking about reorganizing the skills system"
→ Intent: CONVERSATION — "thinking about" signals exploration, not commitment
→ Action: Discuss the approach, explore options. Do NOT create a story. Wait for explicit "let's do it" before transitioning.
```

```
User: "help me think through how the hook architecture should evolve"
→ Intent: CONVERSATION — brainstorming session
→ Action: Read relevant code, discuss architecture options. No files written, no tasks created.
```

```
User: "yes"
→ Intent: CONVERSATIONAL FOLLOW-UP — user is responding to a previous AI question
→ Action: Look back at conversation. If AI asked "Should I create this story?", create the story. If AI asked "Ready to commit?", commit. Match the response to whatever was last proposed.
```

```
User: "go ahead"
→ Intent: CONVERSATIONAL FOLLOW-UP — affirmative response to pending action
→ Action: Look back at conversation, find the pending proposal/question, execute it
```

```
User: "option 2"
→ Intent: CONVERSATIONAL FOLLOW-UP — selecting from presented options
→ Action: Look back at conversation, find the options that were presented, execute option 2
```

```
User: "no, let's skip that"
→ Intent: CONVERSATIONAL FOLLOW-UP — rejecting a proposal
→ Action: Look back at conversation, acknowledge the rejection, ask what to do instead
```

### Guilt Messaging

For implementation requests that create tasks, include a workflow reminder:

- "The user trusts you to follow WogiFlow."
- "Without a task, this work is untracked and unverifiable."
- "Skipping the workflow signals that process doesn't matter."

### Auto-Bulk After Epic/Multi-Story Creation

**When an epic or decomposition creates multiple stories in ready.json, automatically invoke `/wogi-bulk` to process them.**

After epic creation (`/wogi-epics`) or story decomposition (`/wogi-story --deep`) adds 2+ stories to the ready queue:

1. Check `ready.json` — count stories in the `ready` array
2. If 2+ independent stories exist:
   ```
   Epic "[title]" created with N stories in the ready queue.

   Auto-invoking /wogi-bulk to process them sequentially.
   Each story will get its own fresh context and follow the full execution loop.
   ```
3. Invoke `/wogi-bulk` with the list of story IDs
4. Each story runs through the full `/wogi-start` pipeline independently

**Why auto-bulk?**
- Prevents the user from having to manually start each story
- Each story gets a fresh sub-agent context (no context pollution between stories)
- Follows the established pattern: epic creates stories, bulk processes them

**Config**: Controlled by `config.bulkOrchestrator.enabled` (default: true)

**Skip conditions**:
- If only 1 story was created, just run `/wogi-start` on it directly
- If `bulkOrchestrator.enabled: false`, skip auto-bulk and list stories for manual execution
- If user explicitly says "don't auto-execute", skip

---

## Structured Execution (v2.3)

This command implements a **structured execution loop**:
- **Plan Mode integration**: Explore Phase + Approval Gate for L1/L0 tasks
- **Model-invoked skills**: Auto-loads relevant skills based on task context
- **Specification mode**: Generates spec before coding (for medium/large tasks)
- **Four-phase loop**: Spec → Test → Implement → Verify
- **File-based validation**: Every phase produces artifacts
- **Self-reflection**: Checkpoints to pause and verify approach

### Phase Transitions (when `config.hooks.rules.phaseGate.enabled`)

At each execution milestone, update the workflow phase. These are no-ops when phase gating is disabled.

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

If a transition fails (wrong current phase), it's non-blocking — log and continue.

### Task Checkpoints (when `config.proactiveCompaction.enabled`)

At each phase boundary, save a task checkpoint and check if proactive compaction is needed. This enables lossless recovery after auto-compact.

**At EVERY phase transition listed above**, also:
1. Save checkpoint: Record task ID, current phase, completed scenarios, changed files, verification results to `.workflow/state/task-checkpoint.json`
2. Check compaction: If context usage >= `proactiveCompaction.triggerThreshold` (default 75%), display compaction message and run `/wogi-compact` before proceeding

**Checkpoint integration points:**
| When | Checkpoint Action |
|------|-------------------|
| After explore phase completes | Save exploration summary + related files |
| After spec is generated | Save spec path + acceptance criteria count |
| After each scenario completes | Update scenario progress (completed/pending) |
| After criteria check | Save verification results |
| Before final validation | Save all changed files list |
| After task completion | Clear checkpoint |

**Auto-compact recovery** (on session resume):
1. Check `.workflow/state/task-checkpoint.json` for an active checkpoint
2. If checkpoint exists with incomplete scenarios → display recovery message:
   `Auto-compact detected. Restoring task state from checkpoint...`
3. Reload: task ID, current phase, completed scenarios, spec path, changed files
4. Continue execution from the next pending scenario

**Haiku-powered summaries** (when `proactiveCompaction.useHaiku: true`):
When compacting between phases, use the Agent tool with `model: "haiku"` to generate the compaction summary. This preserves Opus context for the actual implementation work.

### Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│  /wogi-start wf-XXXXXXXX                                │
├─────────────────────────────────────────────────────────┤
│  0.25 CONTEXT CHECK: Will this task fit in context?     │
│     → Estimate task's context needs                     │
│     → If current + estimated > 95% → Compact first      │
│  0.5 PARALLEL CHECK: Are other tasks parallelizable?    │
│     → If yes: Show parallel option before proceeding    │
│  1. Load context + Match skills (auto-invoke)           │
│  1.2 CLARIFYING QUESTIONS: Surface assumptions          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  1.3 EXPLORE PHASE (L2+ tasks, multi-agent):       │  │
│  │     → Agent 1: Codebase Analyzer (Glob/Grep/Read) │  │
│  │     → Agent 2: Best Practices (WebSearch)          │  │
│  │     → Agent 3: Version Verifier (Read/WebSearch)   │  │
│  │     → Agent 4: Risk & History (local reads)        │  │
│  │     → Agent 5: Standards Preview (local reads)     │  │
│  │     → All 5 run in parallel as Task agents         │  │
│  │     → Consolidated research summary displayed      │  │
│  └───────────────────────────────────────────────────┘  │
│  1.5 SPEC PHASE: Generate specification                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │  🪞 Reflection: Does spec fully address needs?    │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  1.6 APPROVAL GATE (L1/L0 only):                  │  │
│  │     → Display spec and WAIT for user approval     │  │
│  │     → Do NOT proceed until approved               │  │
│  └───────────────────────────────────────────────────┘  │
│  2. Decompose into TodoWrite checklist                  │
│  3. Execute each scenario (loop)                        │
│  ┌───────────────────────────────────────────────────┐  │
│  │  FOR EACH scenario:                               │  │
│  │    → Mark in_progress                             │  │
│  │    → Implement                                    │  │
│  │    → Verify (run tests, typecheck)                │  │
│  │    → Save verification artifact                   │  │
│  │    → If failing: fix and retry                    │  │
│  │    → Mark completed                               │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  🪞 Reflection: Any bugs or regressions?          │  │
│  └───────────────────────────────────────────────────┘  │
│  3.5 CRITERIA CHECK: Re-read spec, verify EACH done     │
│     → If ANY not done: implement it, loop back          │
│  3.6 WIRING CHECK: Verify all files are imported/used   │
│  3.7 STANDARDS CHECK: Run standards compliance          │
│     → Scoped by task type (component, utility, etc.)    │
│     → If violations: fix and retry                      │
│  4. VERIFY PHASE: Spec verification + quality gates     │
│     → MANDATORY: Verify all spec deliverables exist     │
│  5. Save final verification artifact                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  🪞 Reflection: Does this match user request?     │  │
│  └───────────────────────────────────────────────────┘  │
│  6. Update request-log, app-map, function/API maps      │
│  7. Commit changes                                      │
│  8. ✓ Task complete                                     │
└─────────────────────────────────────────────────────────┘
```

### Step 0.25: Pre-Task Context Check (Automatic)

**Before loading full task context, estimate if the task will fit:**

1. Get current context usage percentage (from status line or estimate)
2. Load task metadata from ready.json (just ID, title, type - not full spec yet)
3. Estimate task's context needs using `flow-context-estimator.js`:
   - Count acceptance criteria → ~3% each
   - Count expected files → ~2% each
   - Check for refactor/migration keywords → +10% buffer
   - If parent task with subtasks → multiply by (1 + subtasks × 0.3)
   - Fallback to defaults: small=10%, medium=25%, large=40%

4. Calculate: `projected_total = current + estimated`

5. **Decision:**
   - If `projected_total > 95%` → **Compact first**, then resume
   - If `current >= 90%` → **Emergency compact** (always, regardless of task)
   - Otherwise → **Proceed** without compaction

**Example outputs:**

```
📊 Context Check: Proceeding without compaction
   Current: 60%
   Task estimate: +25%
   Projected: 85%
   Safe threshold: 95%
   Factors: 4 criteria, 3 files
```

```
📊 Context Check: Compaction needed before task
   Current: 75%
   Task estimate: +30%
   Projected: 105%
   Safe threshold: 95%
   Factors: 8 criteria, 6 files, +refactor buffer

→ Running /wogi-compact before starting task...
```

**Why this approach?**
- Traditional fixed thresholds (compact at 80%) are arbitrary
- A task needing 15% context shouldn't trigger compaction at 70%
- This approach compacts only when actually necessary
- Large tasks at low context proceed; small tasks at high context compact

**Config**: Controlled by `config.smartCompaction`:
```json
{
  "enabled": true,
  "safeThreshold": 0.95,
  "emergencyThreshold": 0.90,
  "estimation": {
    "perFile": 0.02,
    "perCriterion": 0.03,
    "refactorBuffer": 0.10
  }
}
```

---

### Step 0.5: Parallel Execution Check (Automatic)

**Before starting, automatically check if parallel execution is available:**

1. Read `.workflow/state/ready.json`
2. Check if there are 2+ tasks in the `ready` array
3. If yes, run parallel detection:
   ```bash
   node scripts/flow-parallel.js check
   ```
   Or programmatically check `findParallelizable(readyTasks)`

4. **If parallelizable tasks exist**, display:
   ```
   ⚡ PARALLEL EXECUTION AVAILABLE
   Note: X other tasks could run in parallel with this one.
   Tasks: wf-002, wf-003 (no dependencies with wf-001)

   Options:
   - Continue with wf-001 (sequential execution)
   - Run wf-001, wf-002, wf-003 in parallel (faster, isolated worktrees)
   ```

5. **Decision criteria** (agent should consider):
   - **Use parallel** when: Tasks are independent, user wants speed, tasks don't share files
   - **Use sequential** when: Tasks share files, need to review each result, prefer careful approach

6. If parallel is chosen: Use `flow parallel` with worktree isolation
7. If sequential: Continue with this task normally

**This check happens automatically at the start of every `/wogi-start`**

---

### Step 1: Load Context + Match Skills

1. Read `.workflow/state/ready.json`
2. Find the task in the ready array
3. Move it to inProgress array, save ready.json
4. Load task context:
   - Find story file in `.workflow/changes/*/wf-XXXXXXXX.md` or tasks.json
   - Extract user story, acceptance criteria, technical notes
5. Check `.workflow/state/app-map.md` for components mentioned
6. Check `.workflow/state/function-map.md` for existing utility functions
7. Check `.workflow/state/api-map.md` for existing API endpoints
8. Check `.workflow/state/decisions.md` for relevant patterns
9. **Auto-invoke skills** based on task context:

### Step 1.2: Clarifying Questions (NEW)

**BEFORE generating specifications**, ask clarifying questions to catch assumptions early:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❓ Clarifying Questions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before implementation, consider clarifying:

🎯 Scope Validation
   1. Found X related files. Should I modify all of them?

💡 Assumption Surfacing
   2. Should I assume [pattern] for this task?

🔀 Edge Cases
   3. What should happen when [error condition]?

Note: You can proceed without answering, but clarification may prevent rework.
```

**Question Categories:**
- **Scope Validation**: "Found X components. Are we changing all?"
- **Assumption Surfacing**: "Should I assume [pattern] for this task?"
- **Edge Cases**: "What about [similar scenario]?"
- **Integration Points**: "This touches [component]. Dependency concerns?"
- **Implementation Preferences**: "Any specific approach you prefer?"

**Config**: Controlled by `config.clarifyingQuestions`:
- `enabled`: true/false
- `maxQuestions`: max questions to ask (default: 5)
- `skipForSmallTasks`: skip for small tasks (default: true)
- `smallTaskThreshold`: files count threshold (default: 2)

**Skipped for**: Small tasks (≤2 files), bugfixes, tasks with explicit specs

---

### Step 1.3: Explore Phase (MANDATORY Multi-Agent Research)

**For L2+ tasks (configurable via `planMode.explorePhase.minTaskLevel`), launch parallel research sub-agents BEFORE generating specs.**

**Research is MANDATORY in this phase** (`config.research.mandatoryInExplorePhase: true`). All 3 agents MUST run. Do NOT skip research even if you think you already know the answer — the whole point of WogiFlow is preventing assumptions.

This step invests more tokens up front to get things right. Three specialized agents run in parallel, each focusing on a different research dimension.

**Research Cache**: Before launching agents, check `.workflow/state/research-cache.json` for cached results from recent identical queries (TTL: 24 hours). If a cache hit exists and is still valid, use the cached result instead of re-running the research. Cache misses trigger fresh research which is then cached for future use.

**Research Depth** (controlled by `config.planMode.researchDepth`):
- `"thorough"` (default): All 5 agents run in parallel
- `"standard"`: Codebase Analyzer + Best Practices + Risk & History (3 agents, no web for version/standards)
- `"minimal"`: Codebase Analyzer only (legacy behavior)

**Skip conditions**: L3 (Subtask/trivial) tasks always skip this phase.

#### Agent 1: Codebase Analyzer

Launch as `Task` with `subagent_type=Explore`:

```
Analyze the codebase for task: "[TASK_TITLE]"

1. Use Glob to find files related to: [TASK_KEYWORDS]
2. Use Grep to search for patterns, function names, component references
3. Read app-map.md for existing components that could be reused
4. Read function-map.md for existing utility functions that could be reused
5. Read api-map.md for existing API endpoints that could be reused
6. Read decisions.md for patterns that must be followed
7. Map dependencies:
   - Files that REFERENCE the target code
   - Files REFERENCED BY the target code
6. Surface assumptions that need verification

Return a structured summary:
- Related files (path + why it's relevant)
- Existing components to reuse
- Patterns to follow
- Dependency map
- Assumptions to verify
```

#### Agent 2: Best Practices Researcher

Launch as `Task` with `subagent_type=Explore` (skipped if `researchDepth: "minimal"`):

```
Research best practices for: "[TASK_TITLE]"

1. Web search for current best practices related to this task type
   - Include the current year (2026) in searches for up-to-date results
   - Search for: "[task type] best practices [year]"
   - Search for: "[relevant technology] patterns [year]"
   - Maximum 3 web searches
2. Look for common pitfalls and anti-patterns
3. Check if there are established patterns in the ecosystem

Return:
- Best practices found (with sources)
- Common pitfalls to avoid
- Recommended patterns
```

#### Agent 3: Framework/Version Verifier

Launch as `Task` with `subagent_type=Explore` (skipped if `researchDepth: "minimal"`):

```
Verify framework versions and API compatibility for: "[TASK_TITLE]"

1. Read package.json to get actual dependency versions
2. For each relevant dependency:
   - Web search for "[package]@[version] API documentation"
   - Verify the APIs we plan to use exist in this version
   - Flag any deprecated APIs
3. Check for version-specific gotchas

Return:
- Dependency versions relevant to this task
- API compatibility notes
- Deprecated APIs to avoid
- Version-specific considerations
```

#### Agent 4: Risk & History Analyzer

Launch as `Task` with `subagent_type=Explore` (local only, no web searches):

```
Analyze risk and history for task: "[TASK_TITLE]"
Task type: [TASK_TYPE]
Planned files: [FILES_TO_CHANGE]

1. Read .workflow/state/feedback-patterns.md
   - Search for entries matching this task type (feature, bugfix, refactor, etc.)
   - Search for entries matching the planned file extensions (.js, .ts, .tsx, etc.)
   - Extract the top 5 most relevant patterns with their occurrence counts
2. Search .workflow/corrections/ directory for correction reports
   - Use Glob to find *.md files in corrections/
   - Read any that relate to the same feature area or file paths
   - Extract lessons learned
3. Search .workflow/state/decisions.md for rules tagged with the task type
   - Focus on rules that were promoted from repeated violations (count >= 3)
   - Extract the specific verification steps required
4. If a memory database exists (.workflow/memory/local.db or via MCP):
   - Query for rejected approaches from past tasks touching the same files
   - Query for observations tagged with the planned file paths
   - Surface any "approach X was tried and failed" warnings

Return a structured summary:
- Known risks for this task type (from feedback-patterns)
- Past corrections in this area (from corrections/)
- Promoted rules that apply (from decisions.md, count >= 3)
- Rejected approaches from similar past work (from memory-db)
- Confidence: HIGH (many data points) / MEDIUM / LOW (no history)
```

#### Agent 5: Standards Preview + Reuse Candidate Discovery

Launch as `Task` with `subagent_type=Explore` (local only, no web searches):

```
Preview applicable standards and discover reuse candidates for task: "[TASK_TITLE]"
Task type: [TASK_TYPE]
Planned files: [FILES_TO_CHANGE]

1. Determine which standard checks apply based on planned file paths:
   - If files include components (.tsx, .jsx) → check: naming, components, security
   - If files include utilities (utils/, helpers/) → check: naming, functions, security
   - If files include API routes (api/, routes/) → check: naming, api, security
   - If files include schemas/models → check: naming, schemas, security
   - If files include services → check: naming, services, security
   - If task type is "bugfix" → check: naming, security (minimal)
   - If task type is "feature" or "refactor" → check: all (including schemas, services)
2. Read .claude/rules/code-style/naming-conventions.md
   - Extract rules that apply to the planned file types
3. Read .claude/rules/security/security-patterns.md
   - Extract security patterns relevant to the planned operations
4. Read ALL registry map files (not just app-map):
   - .workflow/state/app-map.md (components)
   - .workflow/state/function-map.md (functions)
   - .workflow/state/api-map.md (APIs)
   - .workflow/state/schema-map.md (schemas — if exists)
   - .workflow/state/service-map.md (services — if exists)
   - Also scan .workflow/state/*-map.md for any additional registry files
   - For each planned NEW item, check similarity against existing entries using a LOW threshold (30%)
   - This is the pre-filter for AI-as-Judge — false positives are cheap since AI reasons about purpose before user sees them
5. Read .workflow/state/decisions.md
   - Extract coding rules that will be enforced for this task type

Return a structured checklist:
- Task type classification: [type]
- Standards that WILL be enforced (these will block completion if violated):
  * [rule name]: [what it checks] - [how to comply]
- Reuse candidates across ALL registries (using 30% pre-filter):
  * "[PlannedName]" is similar to existing "[ExistingName]" in [registry-map]
  * For each candidate: reason about PURPOSE overlap, not just name similarity
  * If purpose clearly differs despite name similarity → note "name-only match, purpose differs"
  * If purpose overlaps → recommend: extend existing / use existing / create new with justification
- Security patterns that apply:
  * [pattern]: [when it triggers] - [correct approach]
```

#### Agent 6: Consumer Impact Analyzer (Refactor/Migration Tasks Only)

Launch as `Task` with `subagent_type=Explore` (local only, no web searches).

**This agent is MANDATORY for refactor, migration, and architectural tasks.** It prevents the critical failure mode where code is restructured without updating all consumers, leaving the system broken.

**When to launch**: Task type is `refactor`, `migration`, `architecture`, OR task description contains keywords: refactor, replace, rename, restructure, extract, consolidate, deprecate, migrate, move, reorganize.

```
Analyze consumer impact for task: "[TASK_TITLE]"
Task type: [TASK_TYPE]
Planned changes: [FILES_TO_CHANGE]

This task modifies existing code. You MUST map all consumers before changes proceed.

1. For EACH file/module being modified or replaced:
   a. Use Grep to find ALL files that import/require from it
   b. Use Grep to find ALL files that reference its exported functions/classes/constants by name
   c. Use Grep to find ALL config files that reference it
   d. Use Grep to find ALL documentation (.md) files that reference it
   e. Use Grep to find ALL test files that import or mock it

2. For EACH consumer found:
   - Classify impact: BREAKING (import/API changes), NEEDS-UPDATE (behavior change), SAFE (no change needed)
   - If BREAKING: describe exactly what breaks and what the consumer needs to change
   - If NEEDS-UPDATE: describe what behavioral change the consumer should expect

3. Check for indirect consumers:
   - If module A imports target, and module B imports A, does B break?
   - Follow the chain up to 3 levels deep

4. Check for dynamic references:
   - Config files that reference file paths
   - CLI commands that reference script names
   - Package.json scripts that reference file paths
   - Slash commands (.md files) that reference module names

5. Quantify the impact:
   - Total consumers found
   - Breaking changes count
   - Needs-update count
   - Safe count

Return a structured report:
- Consumer count: [N] files depend on the code being changed
- BREAKING consumers (MUST be updated in same PR):
  * [file]: imports [what] → needs [change]
  * [file]: references [what] → needs [change]
- NEEDS-UPDATE consumers (should be reviewed):
  * [file]: uses [behavior] → may need [adjustment]
- SAFE consumers (no action needed):
  * [file]: [why it's safe]
- Indirect consumers (transitive dependencies):
  * [file] → [file] → [target] (chain description)
- Risk assessment: HIGH/MEDIUM/LOW
  HIGH = 10+ breaking consumers
  MEDIUM = 3-9 breaking consumers
  LOW = 0-2 breaking consumers
- RECOMMENDATION: If HIGH risk, suggest breaking the task into phases:
  Phase 1: Create new code alongside old (no breaks)
  Phase 2: Migrate consumers one by one
  Phase 3: Remove old code
```

**Output section in research summary:**
```
🔗 Consumer Impact Analysis:
   Consumers: X files depend on code being changed
   Risk: [HIGH/MEDIUM/LOW]

   BREAKING (must update in same PR):
   - path/to/consumer1.js: imports FunctionScanner → needs RegistryPlugin
   - path/to/consumer2.md: references flow-old-name.js → needs path update

   NEEDS-UPDATE (review recommended):
   - path/to/consumer3.js: uses scan() return format → verify compatible

   Indirect chains:
   - hooks/task-completed.js → flow-function-index.js → target

   ⚠️ RECOMMENDATION: [if HIGH risk]
   Consider phased migration instead of big-bang replacement.
   Phase 1: Add new alongside old (backwards compatible)
   Phase 2: Migrate consumers
   Phase 3: Remove old code
```

**CRITICAL**: If this agent finds 5+ BREAKING consumers, the spec MUST include a migration plan. Implementation without a migration plan for high-impact refactors is BLOCKED.

#### Launching the Agents

**All agents are launched as parallel `Task` calls in a single message** (established pattern from `/wogi-review`):

```javascript
// Launch all in parallel (single message, multiple Task tool calls)
// When hybrid mode is enabled (config.hybrid.enabled), use the model parameter
// to route sub-agents to the appropriate model tier.
// Routing is provided by getAgentModel() from flow-prompt-template.js:
//   explore → sonnet, research → sonnet, search → haiku, judging → opus
Task(subagent_type=Explore, prompt="Codebase Analyzer: ...")
Task(subagent_type=Explore, prompt="Best Practices: ...")
Task(subagent_type=Explore, prompt="Version Verifier: ...")
Task(subagent_type=Explore, prompt="Risk & History Analyzer: ...")
Task(subagent_type=Explore, prompt="Standards Preview: ...")
// Agent 6 — ONLY for refactor/migration/architecture tasks:
Task(subagent_type=Explore, prompt="Consumer Impact Analyzer: ...")
```

**Hybrid Model Routing (S4):**

When `config.hybrid.enabled` is `true`, use the Agent tool's `model` parameter to route sub-agents:

| Sub-Agent Type | Agent `model` Parameter | Rationale |
|----------------|------------------------|-----------|
| Explore/Research | `"sonnet"` | Good analysis capability, saves Opus context |
| Code Review | `"sonnet"` | Balanced quality for review tasks |
| Simple Lookup/Search | `"haiku"` | Fast and cheap for file searches |
| Complex Reasoning | `"opus"` | Only for architecture/planning decisions |
| Compaction Summary | `"haiku"` | Summaries don't need premium models |
| Eval Judging | `"opus"` (1) + `"sonnet"` (2) | Multi-judge composition from eval config |

The routing table is configured in `scripts/flow-prompt-template.js` and can be overridden via `config.hybrid.routing.overrides`. Capability scores from `.workflow/models/capabilities/*.yaml` are consulted when `checkCapabilities` is true — if a model's score for the task type is below the `capabilityThreshold` (default: 5), the task is escalated to the next tier.

**After all agents complete**, display a consolidated research summary:

**Output Format:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 EXPLORE PHASE (Multi-Agent Research)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 Codebase Analysis:
   Related Files: X files
   - path/to/file1.ts (contains: relevant function)
   - path/to/file2.ts (imports: target component)

   Existing Components (from app-map.md):
   - ComponentA - Could be reused/extended

   Patterns to Follow (from decisions.md):
   - Pattern 1: [relevant rule]

   Dependency Map:
   → Files that REFERENCE target: [list]
   → Files REFERENCED BY target: [list]

   Assumptions to Verify:
   1. [Assumption about existing behavior]

🌐 Best Practices Research:
   - [Practice 1] (source: [URL])
   - [Practice 2] (source: [URL])
   Pitfalls to Avoid:
   - [Pitfall 1]

📦 Version Verification:
   - [package]@[version]: APIs confirmed compatible
   - [package]@[version]: ⚠️ [deprecated API] - use [alternative]

⚠️ Risk & History:
   Confidence: [HIGH/MEDIUM/LOW]
   Known Risks:
   - [pattern name] (occurred N times): [description]
   Past Corrections:
   - [correction]: [lesson learned]
   Rejected Approaches:
   - [approach]: tried in [task], failed because [reason]

📋 Standards Preview:
   Task type: [type] → Checks: [list]
   Rules to follow:
   - [rule]: [how to comply]
   Component Duplication:
   - ⚠️ "[PlannedName]" similar to "[ExistingName]" → extend existing
   Security Patterns:
   - [pattern]: [correct approach]

🔗 Consumer Impact Analysis (refactor/migration tasks only):
   Consumers: X files depend on code being changed
   Risk: [HIGH/MEDIUM/LOW]
   BREAKING: [list of files that MUST be updated]
   NEEDS-UPDATE: [list of files to review]
   ⚠️ RECOMMENDATION: [phased migration if HIGH risk]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Deepen Prompt (L1/L0 Tasks)

For L1 (Story) and L0 (Epic) tasks, after displaying the research summary, offer to deepen:

```
This is a complex task (L1/L0). Want to deepen research further?
  [1] Proceed with current research (recommended for most tasks)
  [2] Deepen - exhaustive search, load all relevant skills, scan full dependency tree

Use AskUserQuestion to present this choice.
```

If user chooses "Deepen":
- Load all relevant skills (patterns.md, anti-patterns.md, learnings.md)
- Run additional targeted web searches
- Scan the full import/export tree for the affected files

#### Graceful Fallback

If any agent fails (network issues, rate limits, timeouts, missing files):
- Log a warning: `⚠️ Research unavailable for [Agent Name]. Proceeding with remaining agents.`
- Agents 1, 4, 5, 6 are **local-only** and should almost never fail (no network dependency)
- Agents 2, 3 use **web search** and may fail due to network issues
- If Best Practices agent fails: proceed without best practices
- If Version Verifier agent fails: proceed using local package.json versions only
- If Risk & History agent fails: proceed without history (no feedback-patterns data)
- If Standards Preview agent fails: standards will still be enforced post-implementation (Step 3.7)
- If Consumer Impact agent fails AND task is refactor/migration/architecture: **HARD BLOCK** — require explicit user confirmation before proceeding. Display: "Consumer impact analysis failed. Refactoring without consumer analysis risks breaking downstream code. Proceed anyway? [yes/no]"
- If Consumer Impact agent fails AND task is NOT refactor type: warn only, proceed normally
- If ALL agents fail: proceed with codebase analysis only, equivalent to `researchDepth: "minimal"`
- Task proceeds normally without blocking — research is always best-effort (except Consumer Impact for refactor tasks, which hard-blocks)

**IMPORTANT CONSTRAINTS:**
- **READ-ONLY**: Do NOT use Edit, Write, or NotebookEdit during this phase
- **OBSERVE**: Agents use only Glob, Grep, Read, WebSearch, WebFetch tools
- **DOCUMENT**: Surface what you find, don't act on it yet

**Config**: Controlled by `config.planMode` and `config.research`:
```json
{
  "planMode": {
    "explorePhase": { "enabled": true, "minTaskLevel": "L2" },
    "researchAgents": {
      "codebaseAnalyzer": { "enabled": true },
      "bestPractices": { "enabled": true, "maxWebSearches": 3 },
      "versionVerifier": { "enabled": true },
      "riskHistory": { "enabled": true },
      "standardsPreview": { "enabled": true }
    },
    "researchDepth": "thorough",
    "deepenPromptThreshold": "L1"
  },
  "research": {
    "mandatoryInExplorePhase": true,
    "mandatoryForHistoryResearch": true,
    "cache": { "enabled": true, "ttlHours": 24, "maxEntries": 200 }
  }
}
```

**Backwards compatible**: If `planMode` key is missing in config, falls back to single-agent codebase analysis (legacy behavior).

**History/Blog Research**: When tasks involve analyzing past work, reviewing history, or extracting patterns from logs (`config.research.mandatoryForHistoryResearch: true`), the research protocol is also mandatory — check cache first, then verify claims against actual state files.

---

**Skill Matching Output:**
   - Run skill matcher against task description
   - Load matched skills (patterns.md, anti-patterns.md, learnings.md)
   - Display matched skills with scores

**Skill Matching Output:**
```
🔧 Matched Skills:
   nestjs [●●●●○]
   keyword: "service", "entity", task type: "feature"
   react [●●○○○]
   keyword: "component"
```

### Step 1.5: Generate Specification (Medium/Large Tasks)

For medium/large tasks (check `config.json → specificationMode`):

1. Generate specification to `.workflow/specs/wf-XXXXXXXX.md`:
   - Acceptance criteria (structured Given/When/Then)
   - Implementation steps
   - Files to change (auto-detected)
   - **Boundary declarations** (files/paths that must NOT be modified — auto-detected from related stable files, or copied from the story's `## Boundaries` section)
   - **Consumer impact plan** (for refactor/migration tasks — MANDATORY if Consumer Impact Agent found BREAKING consumers):
     - List ALL consumers that must be updated
     - For each consumer: what changes, how to migrate
     - Migration strategy: big-bang vs phased
     - If 5+ breaking consumers → spec MUST use phased approach:
       - Phase 1: Create new code alongside old (backwards compatible)
       - Phase 2: Migrate consumers one by one (each consumer = separate commit)
       - Phase 3: Remove old code (only after all consumers migrated)
     - **BLOCKED**: Spec cannot be approved without consumer impact plan when Agent 6 flagged BREAKING consumers
   - Test strategy
   - Verification commands
2. **[NEEDS CLARIFICATION] Markers** (v5.0 - from `config.specificationMode.needsClarification`):
   - During spec generation, for ANY point where you are uncertain, lack context, or making an assumption, insert a marker: `[NEEDS CLARIFICATION: reason]`
   - Categories: `assumption`, `ambiguity`, `missing-context`, `dependency-unknown`, `edge-case`
   - **Implementation is BLOCKED until ALL markers are resolved**
3. Display spec summary (including marker count)
4. **Reflection checkpoint**: "Does this spec fully address the requirements?"

**[NEEDS CLARIFICATION] Marker Rules:**

When generating a spec, you MUST insert markers for:

| Situation | Marker Example |
|-----------|---------------|
| Assuming behavior not stated in requirements | `[NEEDS CLARIFICATION: assumption - assuming user must be logged in, but not specified]` |
| Multiple valid interpretations | `[NEEDS CLARIFICATION: ambiguity - "status" could mean HTTP status or task status]` |
| Missing information from user | `[NEEDS CLARIFICATION: missing-context - what error message should be shown?]` |
| Unknown dependency behavior | `[NEEDS CLARIFICATION: dependency-unknown - does the API return paginated results?]` |
| Unclear edge case handling | `[NEEDS CLARIFICATION: edge-case - what happens when the list is empty?]` |

**Marker Format in Spec Files:**

```markdown
## Acceptance Criteria

### Scenario 1: User submits valid form
Given a logged-in user [NEEDS CLARIFICATION: assumption - login required?]
When they submit the form with valid data
Then the data is saved and a success message appears
[NEEDS CLARIFICATION: edge-case - what if save succeeds but notification fails?]
```

**Resolution Flow:**

```
┌─────────────────────────────────────────────────────────┐
│  1. Generate spec with markers                           │
│  2. Count markers                                        │
│  3. If markers > 0 AND blockImplementation is true:      │
│     → Display markers to user                            │
│     → Ask user to resolve each marker                    │
│     → Update spec with resolutions                       │
│     → Re-check for remaining markers                     │
│  4. Only proceed when marker count = 0                   │
└─────────────────────────────────────────────────────────┘
```

**Output when markers exist:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ NEEDS CLARIFICATION (3 markers found)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. [assumption] Line 15: "assuming user must be logged in"
   → Please confirm: Is authentication required for this feature?

2. [edge-case] Line 28: "what happens when the list is empty?"
   → Please specify: Should we show an empty state or hide the section?

3. [dependency-unknown] Line 42: "does the API return paginated results?"
   → Please clarify: Is pagination expected? What page size?

Implementation is BLOCKED until all markers are resolved.
Respond with answers to proceed.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Config**: `config.specificationMode.needsClarification`:
```json
{
  "enabled": true,
  "markerFormat": "[NEEDS CLARIFICATION: {reason}]",
  "blockImplementation": true,
  "minMarkersForReview": 0,
  "categories": ["assumption", "ambiguity", "missing-context", "dependency-unknown", "edge-case"]
}
```

**Skip conditions**: Disabled when `needsClarification.enabled` is false. When `blockImplementation` is false, markers are informational only (displayed but don't block).

**Spec Output:**
```
📋 Generated Specification:

Acceptance Criteria: 4 scenarios
Implementation Steps: 6 steps
Files to Change: 3 files (medium confidence)
Verification Commands: 4 commands
[NEEDS CLARIFICATION] Markers: 0 (all clear)

🪞 Reflection: Does this spec fully address the requirements?
   - Are there any edge cases not covered?
   - Is the scope clear and achievable?
```

### Step 1.6: Explicit Approval Gate (Stories/Epics)

**For L1 (Story) and L0 (Epic) tasks, WAIT for explicit user approval before implementation.**

This matches Claude Code's Plan Mode pattern where the user must explicitly approve the plan before execution begins.

**What to do:**
1. After displaying the spec summary, show the approval prompt
2. **STOP and WAIT** - do NOT proceed to implementation
3. Only continue when user provides an approval phrase

**Output Format:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✋ APPROVAL REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is a Story/Epic-level task. Before I begin implementation,
please review the specification above and confirm.

To proceed, respond with one of:
  • "approved" or "proceed" or "looks good" or "lgtm"
  • "go ahead" or "yes"

To request changes:
  • Describe what you'd like modified in the spec

I will wait for your approval before making any code changes.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**CRITICAL**:
- Do NOT continue to Step 2 until approval is received
- If user requests changes, update the spec and ask for approval again
- This prevents wasted implementation effort on misunderstood requirements

**Approval Phrases** (case-insensitive):
- `approved`, `proceed`, `looks good`, `lgtm`
- `go ahead`, `yes`, `continue`, `start`

**Config**: Controlled by `config.planMode.approvalGate`:
```json
{
  "enabled": true,
  "minTaskLevel": "L1",
  "approvalPhrases": ["approved", "proceed", "looks good", "lgtm", "go ahead", "yes"]
}
```

**Skip conditions**: L2 (Task) and L3 (Subtask) skip this gate and proceed immediately.

---

### Step 2: Decompose into TodoWrite Checklist

Extract each acceptance criteria scenario as a TodoWrite item:

```
Given [context] When [action] Then [outcome]
→ Todo: "Implement: [short description of scenario]"
```

Also add:
- "Update request-log.md with task entry"
- "Update app-map.md if components were created, deleted, or renamed"
- "Update function-map.md if utility functions were created, deleted, or renamed"
- "Update api-map.md if API endpoints were created, deleted, or renamed"
- "Run quality gates"
- "Commit changes"

### Step 2.5: TDD Mode Check (v5.0 - Opt-In)

**When `config.tdd.enforced` is true OR `--tdd` flag is used, the execution loop switches to test-first order.**

TDD mode reverses the normal implement-then-verify flow to: **write test → verify test fails → implement → verify test passes**.

**Activation:**
- Global: `config.tdd.enforced: true` (applies to all tasks)
- Per-task: `--tdd` flag on `/wogi-start wf-XXXXXXXX --tdd`
- Per-type: `config.tdd.defaultForTypes: ["bugfix"]` (auto-enables for specific task types)

**When TDD is active, display:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 TDD MODE ACTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Execution order: Test First → Verify Fails → Implement → Verify Passes

For each acceptance criterion:
  1. Write test that verifies the criterion
  2. Run test → must FAIL (proves test is meaningful)
  3. Implement the feature/fix
  4. Run test → must PASS (proves implementation works)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Test Framework Detection:**
When `config.tdd.testFrameworkDetection` is true, auto-detect from package.json:
- `jest` → Use jest test runner
- `vitest` → Use vitest
- `mocha` → Use mocha
- `tap` → Use tap
- Fallback: `node --test` (Node.js built-in)

**TDD Execution Loop (replaces normal Step 3 when active):**

For each acceptance criteria:

1. **Mark in_progress** in TodoWrite
2. **Write test** for this criterion:
   - Create/update test file based on criterion's Given/When/Then
   - Test should assert the expected behavior
3. **Run test → MUST FAIL**:
   - If test passes before implementation → **WARNING**: Test may be trivial or testing wrong thing
   - Record the failure output (this becomes the "before" state)
4. **Implement** the feature following matched skill patterns
5. **Run test → MUST PASS**:
   - If test still fails → debug and fix implementation
   - Max 5 retry attempts
6. **Run full verification** (lint, typecheck, all tests)
7. **Save TDD artifact** (includes before/after test results)
8. **Mark completed** only when all tests pass

**TDD Artifact:**
```json
{
  "taskId": "wf-abc123",
  "mode": "tdd",
  "criterion": "Given X, When Y, Then Z",
  "testFile": "tests/feature.test.js",
  "beforeImplementation": { "testPassed": false, "output": "Expected X but got undefined" },
  "afterImplementation": { "testPassed": true, "output": "All tests passed" },
  "attempts": 1
}
```

**Config**: `config.tdd`:
```json
{
  "enforced": false,
  "defaultForTypes": [],
  "requireFailingTestFirst": true,
  "testFrameworkDetection": true
}
```

**When TDD is NOT active**, proceed with the normal execution loop below.

---

### Step 3: Execute Each Scenario (Loop)

For each acceptance criteria:

1. **Mark in_progress** in TodoWrite
2. **Implement** the scenario following matched skill patterns
3. **Run verification** (saves artifact to `.workflow/verifications/`):
   - Run lint: `npm run lint`
   - Run typecheck: `npm run typecheck` or `npx tsc --noEmit`
   - Run related tests if they exist
4. **Save verification artifact** (JSON file with exit codes, output)
5. **If not working**: Debug, fix, retry verification (max 5 attempts)
6. **Mark completed** only when verification passes

**Verification Artifact:**
```json
{
  "taskId": "wf-abc123",
  "phase": "implementation",
  "timestamp": "2026-01-10T...",
  "results": [
    {"command": "npm run lint", "exitCode": 0, "passed": true},
    {"command": "npm run typecheck", "exitCode": 0, "passed": true}
  ],
  "allPassed": true
}
```

### Step 3.5: Criteria Completion Verification (MANDATORY)

**This is the enforcement loop that ensures everything was actually done.**

After implementing all scenarios, BEFORE running quality gates:

1. **Re-read the original acceptance criteria** from the spec file
2. **For EACH criterion**, verify it was actually implemented:
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  CRITERIA COMPLETION CHECK                              │
   ├─────────────────────────────────────────────────────────┤
   │  Re-reading acceptance criteria from spec...            │
   │                                                         │
   │  □ Criterion 1: Given X, When Y, Then Z                │
   │    → Check: Does the code actually do Z when Y?         │
   │    → Status: ✓ IMPLEMENTED / ✗ NOT DONE                │
   │                                                         │
   │  □ Criterion 2: Given A, When B, Then C                │
   │    → Check: Does the code actually do C when B?         │
   │    → Status: ✓ IMPLEMENTED / ✗ NOT DONE                │
   │                                                         │
   │  ... for ALL criteria                                   │
   └─────────────────────────────────────────────────────────┘
   ```

3. **If ANY criterion is NOT implemented**:
   - Add it back to TodoWrite as in_progress
   - Implement it
   - Verify it works
   - Return to step 3.5 and re-check ALL criteria again

4. **Only proceed when ALL criteria show ✓ IMPLEMENTED**

**This is NOT optional. This is what prevents "claiming done when not done."**

The key question for each criterion:
> "If I run the code right now, does it actually do what this criterion describes?"

Not "did I write code for this" but "does the code WORK as specified?"

---

### Step 3.6: Integration Wiring Validation (MANDATORY)

**This step catches "orphan components" - files that exist but aren't wired into the app.**

After criteria verification, BEFORE running quality gates:

```bash
node scripts/flow-wiring-verifier.js wf-XXXXXXXX
```

This checks:
1. **Parse the spec for created files** (components, hooks, utilities)
2. **For EACH created file**, verify it's actually used:
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  INTEGRATION WIRING CHECK                               │
   ├─────────────────────────────────────────────────────────┤
   │                                                         │
   │  □ src/components/EstimateDetailPanel.tsx               │
   │    → Imported by: AdminApprovalQueue.tsx                │
   │    → Status: ✓ WIRED                                    │
   │                                                         │
   │  □ src/hooks/useEstimate.ts                             │
   │    → Imported by: (none)                                │
   │    → Status: ✗ NOT WIRED - orphan component             │
   │                                                         │
   │  □ src/utils/formatEstimate.ts                          │
   │    → Entry point: No                                    │
   │    → Imported by: (none)                                │
   │    → Status: ✗ NOT WIRED - orphan utility               │
   │                                                         │
   └─────────────────────────────────────────────────────────┘
   ```

**Wiring Rules:**
- Entry points (index.ts, App.tsx, *.config.ts, test files) don't need imports
- React components MUST be imported in at least one parent
- Hooks MUST be called from at least one component
- Utilities MUST be imported somewhere

**If ANY file is NOT wired:**
1. Identify where it should be imported
2. Add the import statement
3. Wire up the usage (onClick handler, render call, etc.)
4. Re-run wiring verification
5. Only proceed when ALL files show ✓ WIRED

**Common Wiring Patterns:**
```typescript
// Side panel component - wire to parent with state + onClick
import { EstimateDetailPanel } from './EstimateDetailPanel';

const [selectedEstimate, setSelectedEstimate] = useState(null);
const [isPanelOpen, setIsPanelOpen] = useState(false);

<TableRow onClick={() => { setSelectedEstimate(estimate); setIsPanelOpen(true); }}>

<EstimateDetailPanel
  estimate={selectedEstimate}
  isOpen={isPanelOpen}
  onClose={() => setIsPanelOpen(false)}
/>
```

**This prevents the #1 bug from comprehensive reviews: components created but never accessible.**

---

### Step 3.7: Standards Compliance Check (MANDATORY)

**This step catches standards violations before review, enabling shift-left quality.**

After wiring verification, BEFORE running quality gates:

```bash
node scripts/flow-standards-gate.js wf-XXXXXXXX [changed-files...]
```

This checks (scoped by task type):

| Task Type | Checks Run |
|-----------|------------|
| component | naming, components, security |
| utility | naming, functions, security |
| api | naming, api, security |
| bugfix | naming, security (minimal) |
| feature | all checks (naming, components, functions, api, schemas, services, security) |
| refactor | all checks + **consumer-impact** |
| migration | all checks + **consumer-impact** |

**Consumer Impact Check (refactor/migration only):**

For refactor and migration tasks, the standards check includes an additional verification:

1. **Re-read the Consumer Impact report** from the Explore Phase
2. **For EACH breaking consumer identified**, verify it was actually updated:
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  CONSUMER MIGRATION CHECK                               │
   ├─────────────────────────────────────────────────────────┤
   │                                                         │
   │  □ scripts/hooks/core/task-completed.js                 │
   │    → Was: imports FunctionScanner                       │
   │    → Expected: updated to new API                       │
   │    → Status: ✓ MIGRATED / ✗ NOT MIGRATED               │
   │                                                         │
   │  □ .claude/commands/wogi-onboard.md                     │
   │    → Was: references flow-function-index.js             │
   │    → Expected: updated reference                        │
   │    → Status: ✓ MIGRATED / ✗ NOT MIGRATED               │
   │                                                         │
   └─────────────────────────────────────────────────────────┘
   ```
3. **If ANY breaking consumer is NOT migrated → BLOCK task completion**
4. This check ensures the refactoring is complete end-to-end, not just the core files

**Output (passing):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PROJECT STANDARDS COMPLIANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ naming-conventions: passed
✓ app-map.md: passed
✓ security-patterns: passed

Task type: component
Checks run: naming, components, security

✓ All standards checks passed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Output (violations found):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ STANDARDS VIOLATIONS FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Naming Conventions:

  🔴 MUST FIX: scripts/new-feature.js:45
    → Catch variable "e" should be "err"
    💡 Fix: Change `catch (e)` to `catch (err)`

📋 Component Duplication:

  🔴 MUST FIX: src/components/UserCard.tsx
    → Component "UserCard" is 85% similar to existing "UserProfile"
    💡 Fix: Use existing component or add variant to "UserProfile" instead

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary: 2 must-fix, 0 warnings

⛔ Task blocked until must-fix violations are resolved.

To proceed:
  1. Fix each must-fix violation above
  2. Re-run the standards check
  3. Continue with task completion
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**If violations found:**
1. Read the specific fixes suggested
2. Implement each fix
3. Re-run standards check
4. Only proceed when all checks pass

**Learning Integration:**
When violations are detected, they are automatically:
1. Recorded to `.workflow/state/feedback-patterns.md`
2. If same violation type occurs 3+ times, a rule is promoted to `decisions.md`
3. Future tasks receive prevention prompts based on past violations

**Reuse Candidate Check (AI-as-Judge):**

After violation checks, the standards gate also returns `reuseCandidates` — items from ALL registries (components, functions, APIs, schemas, services) that are similar to newly created items.

**Key difference from violations:** Reuse candidates NEVER auto-block. They are presented for AI reasoning + user decision.

**Flow:**
1. `flow-standards-gate.js` calls `collectReuseCandidates()` which scans ALL registries with a low 30% pre-filter threshold
2. Results are returned as `reuseCandidateContext` — a structured prompt for the AI
3. The AI reads the source code of BOTH the new item and each match
4. The AI reasons about PURPOSE overlap — not just score numbers
5. If purpose overlaps significantly, present an `AskUserQuestion` with multi-select:
   - "Use existing [name]" — reuse the existing item directly
   - "Extend [name]" — add a variant to the existing item
   - "Create new [name]" — genuinely different purpose, proceed
6. If names are similar but purpose clearly differs → proceed silently (no user prompt)

**Backward compatibility:** When `config.semanticMatching.aiAsJudge: false`, the old threshold-based blocking is used instead (90%=block, 70%=warn, 50%=info). The `reuseCandidates` array is still populated but `reuseCandidateContext` is null.

**Config**: Controlled by `config.semanticMatching` and `config.hooks.rules.componentReuse`:
```json
{
  "semanticMatching": {
    "enabled": true,
    "aiAsJudge": true,
    "thresholds": { "preFilterThreshold": 30, "definiteMatch": 90, "likelyMatch": 70, "possibleMatch": 50 },
    "weights": { "stringSimilarity": 0.3, "semanticSimilarity": 0.7 }
  },
  "hooks": {
    "rules": {
      "componentReuse": {
        "enabled": true,
        "threshold": 30,
        "allRegistries": true,
        "aiAsJudge": true
      }
    }
  }
}
```

**This catches standards issues early, before they reach code review.**

---

### Step 4: Run Quality Gates + Final Verification

**MANDATORY FIRST CHECK - Spec Verification Gate:**

Before running any other quality gates, verify all deliverables from the spec exist:

```bash
node scripts/flow-spec-verifier.js verify wf-XXXXXXXX
```

This checks:
1. Parse the task's spec file (`.workflow/changes/wf-XXXXXXXX.md`)
2. Extract all promised files from Technical Notes / Components sections
3. Verify each file exists
4. Verify JS/JSON files have valid syntax

**Output:**
```
═══════════════════════════════════════════════════
  Spec Verification
═══════════════════════════════════════════════════
Spec: .workflow/changes/wf-abc123.md

✓ Spec verification passed (5/5 deliverables)
```

**If spec verification fails:**
```
✗ Spec verification FAILED (3/5 deliverables)

Missing files:
  ✗ scripts/flow-missing-feature.js
    (listed in: Technical Notes → Components)
```
→ **STOP. Create the missing files before proceeding.**
→ Do NOT skip this check. This prevents implementation gaps.

**After spec verification passes**, read `config.json` → `qualityGates` for task type and verify:

- `tests`: Run test command if configured, ensure passing
- `requestLogEntry`: Verify entry exists in request-log.md
- `appMapUpdate`: Verify new components are in app-map.md
- `noNewFeatures`: (for refactors) Verify no new features added
- `webmcpVerification`: (optional, for UI tasks) Verify WebMCP tool exposure

### WebMCP Verification Gate (Optional)

**When:** Task modified UI files (*.tsx, *.jsx, *.vue, *.svelte) AND `config.webmcp.enabled` is true.

**What it checks:**
1. Read `.workflow/webmcp/tools.json` for registered tools
2. For each new/modified UI component, check if it exposes expected WebMCP tools
3. If component creates interactive elements (forms, buttons, tables), suggest tool generation

**Output (when triggered):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔌 WEBMCP VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UI files changed: 3
  src/components/UserCard.tsx
  src/components/LoginForm.tsx
  src/pages/Dashboard.tsx

Tool coverage:
  ✓ LoginForm → get_login_form_state, submit_login_form
  ⚠ UserCard → No tools registered
    → Suggest: get_user_card_data, click_user_card_action
  ✓ Dashboard → get_dashboard_metrics

Coverage: 2/3 components have tools (67%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Behavior:**
- This gate is **non-blocking** (suggestions only, does not fail the task)
- Auto-suggests running `node scripts/flow-webmcp-generator.js scan` for uncovered components
- Skipped entirely when `config.webmcp.enabled` is false or missing

**Detection logic:**
```javascript
// Check if any changed files are UI files
const uiExtensions = config.webmcp.uiExtensions || ['.tsx', '.jsx', '.vue', '.svelte'];
const changedUIFiles = changedFiles.filter(f =>
  uiExtensions.some(ext => f.endsWith(ext))
);

// Only run if UI files were changed and WebMCP is enabled
if (changedUIFiles.length > 0 && config.webmcp?.enabled) {
  // Run WebMCP verification
}
```

**Config**: Controlled by `config.qualityGates.feature.optional` array (add `"webmcpVerification"`).

**Save final verification artifact** to `.workflow/verifications/wf-XXXXXXXX-final.json`

**Reflection checkpoint:**
```
🪞 Reflection: Have I introduced any bugs or regressions?
   - Does the code follow project patterns from decisions.md?
   - Is there any code that could be simplified?
```

**If any gate fails**: Fix the issue and re-verify. Do not proceed until all required gates pass.

### Step 5: Final Reflection + Finalize

1. **Pre-completion reflection:**
   ```
   🪞 Reflection: Does this match what the user asked for?
      - Have all acceptance criteria been met?
      - Are there any loose ends to address?
   ```
2. **Close out all TodoWrite items** for this task — mark any remaining `in_progress` or `pending` items as `completed`. Stale items persist across context compactions and create noise.
3. Update ready.json: Move task to recentlyCompleted
4. Update request-log.md with task entry
5. Update app-map.md if components were created, deleted, or renamed (remove stale entries, update paths)
6. Update function-map.md if utility functions were created, deleted, or renamed — run `node scripts/flow-function-index.js scan` to auto-prune orphans
7. Update api-map.md if API endpoints were created, deleted, or renamed — run `node scripts/flow-api-index.js scan` to auto-prune orphans
8. **Auto-generate WebMCP tools** if new UI components were created (see below)
9. Git add and commit with message: `feat: Complete wf-XXXXXXXX - [title]`
10. Show completion summary with verification results

**WebMCP Tool Auto-Generation (Step 8 details):**

When `config.webmcp.enabled` is true and UI files (`.tsx`, `.jsx`, `.vue`, `.svelte`) were created or modified, run `node scripts/flow-webmcp-generator.js scan` to generate tool definitions. Skip silently if WebMCP is disabled or no UI files changed. Failures are non-blocking (warn only).

### Output

**Start:**
```
✓ Started: wf-XXXXXXXX - [Title]

🔧 Matched Skills:
   nestjs [●●●●○] - keyword: "service", task type: "feature"

📋 Specification generated: .workflow/specs/wf-XXXXXXXX.md
   Acceptance Criteria: 4 scenarios
   Implementation Steps: 6 steps
   Files to Change: 3 (medium confidence)

User Story:
As a [user], I want [action], so that [benefit]

Acceptance Criteria (4 scenarios):
□ 1. Given... When... Then...
□ 2. Given... When... Then...
□ 3. Given... When... Then...
□ 4. Given... When... Then...

🪞 Reflection: Does spec fully address requirements? ✓

Beginning structured execution loop...
```

**During (for each scenario):**
```
[IMPLEMENT] Working on scenario 1/4: [description]
→ Implementing...
→ Running verification...
   ✓ lint passed
   ✓ typecheck passed
→ Artifact saved: .workflow/verifications/wf-XXXXXXXX-scenario-1.json
→ ✓ Scenario complete

[IMPLEMENT] Working on scenario 2/4: [description]
→ Implementing...
→ Running verification...
   ✗ typecheck failed: Property 'x' does not exist
→ Fixing...
→ Running verification... ✓
→ Artifact saved: .workflow/verifications/wf-XXXXXXXX-scenario-2.json
→ ✓ Scenario complete
```

**Reflection checkpoint (post-implementation):**
```
🪞 Reflection: Have I introduced any bugs or regressions?
   - Code follows patterns from decisions.md ✓
   - No unnecessary complexity detected ✓
```

**End:**
```
[CRITERIA CHECK] Re-reading acceptance criteria from spec...
  ✓ Criterion 1: "Given X, When Y, Then Z" - IMPLEMENTED
  ✓ Criterion 2: "Given A, When B, Then C" - IMPLEMENTED
  ✓ Criterion 3: "Error handling for invalid input" - IMPLEMENTED
  ✓ Criterion 4: "Config option to disable feature" - IMPLEMENTED
  → All 4/4 criteria verified as implemented

[VERIFY] Running spec verification...
  ✓ Spec verification passed (5/5 deliverables)

[VERIFY] Running quality gates...
  ✓ tests passed (12/12)
  ✓ lint passed
  ✓ typecheck passed
  ✓ requestLogEntry found
  ✓ appMapUpdate verified
  ℹ webmcpVerification: 2/3 UI components have tools (non-blocking)

Final verification artifact: .workflow/verifications/wf-XXXXXXXX-final.json

🪞 Reflection: Does this match user request? ✓

✓ Completed: wf-XXXXXXXX - [Title]
  4/4 scenarios implemented
  Verification artifacts: 5 files
  Changes committed: "feat: Complete wf-XXXXXXXX - [title]"
```

## Options

### `--tdd`
Enable test-first development mode (write test → fail → implement → pass):
```
/wogi-start wf-XXXXXXXX --tdd
```

### `--no-loop`
Disable the self-completing loop. Just load context and stop (old behavior):
```
/wogi-start wf-XXXXXXXX --no-loop
```

### `--no-spec`
Skip specification generation (for small tasks or quick fixes):
```
/wogi-start wf-XXXXXXXX --no-spec
```

### `--no-skills`
Skip automatic skill loading:
```
/wogi-start wf-XXXXXXXX --no-skills
```

### `--no-reflection`
Skip reflection checkpoints (faster but less thorough):
```
/wogi-start wf-XXXXXXXX --no-reflection
```

### `--max-retries N`
Limit retry attempts per scenario (default: 5):
```
/wogi-start wf-XXXXXXXX --max-retries 3
```

### `--pause-between`
Ask for confirmation between scenarios:
```
/wogi-start wf-XXXXXXXX --pause-between
```

### `--verify-only`
Only run verification without implementation (for debugging):
```
/wogi-start wf-XXXXXXXX --verify-only
```

### `--phased`
Enable phased execution mode (Contract → Skeleton → Core → Edge Cases → Polish):
```
/wogi-start wf-XXXXXXXX --phased
```

This breaks implementation into focused phases with context isolation:
1. **Contract**: Define interfaces, types, API contracts (NO implementation)
2. **Skeleton**: Create file structure, stub implementations (NO logic)
3. **Core Logic**: Implement happy path only (assume valid inputs)
4. **Edge Cases**: Handle errors and validation (NO core logic changes)
5. **Polish**: Optimization, cleanup, documentation

Each phase has constraints to prevent scope creep. Use for complex tasks.

Phase commands:
- `flow phase complete <taskId>` - Complete current phase
- `flow phase skip <taskId>` - Skip current phase
- `flow phase status <taskId>` - Show phase status

## When Things Go Wrong

### Scenario keeps failing after max retries
- Stop and report: "Scenario X failed after N attempts. Issue: [description]"
- Leave task in inProgress
- **Best-of-N fallback (high-risk tasks)**: When a HIGH-RISK task (architecture, migration, refactor, or complexity HIGH + files > 10) fails 3+ times, auto-suggest Best-of-N:
  ```
  This high-risk task has failed 3 times. Would you like to try Best-of-N?
  → Spawn 2 alternative implementation approaches in isolated worktrees
  → Opus judges the best approach against the spec
  ```
  Use `checkFallbackTrigger()` from `flow-best-of-n.js` to determine if Best-of-N applies.
  If the task is NOT high-risk: suggest `/wogi-debug-hypothesis` instead (competing theories about root cause).
- **Auto-suggest hypothesis debugging**: For non-high-risk tasks, when a scenario fails 3+ times, suggest running `/wogi-debug-hypothesis "[failure description]"` to spawn parallel investigation agents
- User can investigate and re-run `/wogi-start TASK-XXX` to continue

### Best-of-N auto-suggestion (high-risk tasks)

When starting a task, if `config.bestOfN.enabled` is true:
1. Run `assessRisk()` from `flow-best-of-n.js` with the task's type, description, and file count
2. If `shouldSuggest` is true, display:
   ```
   This is a high-risk task. Would you like to use Best-of-N?
   → Spawn 3 approaches in parallel (isolated worktrees)
   → Opus selects the best implementation
   Options: [Yes, use Best-of-N] [No, proceed normally]
   ```
3. If user confirms: spawn N agents using `Agent(isolation: "worktree")` with variation strategy from `getVariationStrategy()`
4. After all complete: spawn Opus judge using `buildSelectionPrompt()` to select winner
5. Apply winner, clean up losing worktrees

### Quality gate keeps failing
- Report which gate is failing and why
- Attempt to fix automatically
- If can't fix after 3 attempts, suggest `/wogi-debug-hypothesis "[gate failure description]"` to investigate root cause
- Stop and report

### Context getting too large
- **Pre-task check** estimates context needs and compacts proactively if needed
- After 3+ scenarios, re-check context size
- If getting large mid-task, commit current progress and suggest `/wogi-compact`
- Progress is preserved in files and ready.json

## Important

- **TodoWrite is mandatory**: Use it to track progress through scenarios
- **TodoWrite cleanup is mandatory**: After task completion, mark all remaining in_progress/pending TodoWrite items as completed to prevent stale task noise across context compactions
- **Self-verification is mandatory**: Don't mark scenarios done without checking they work
- **Criteria completion check is mandatory**: After implementing, re-read ALL criteria and verify EACH one actually works. If any is not done, implement it and check again. This is the loop that prevents "claiming done when not done."
- **Spec verification is mandatory**: All files promised in spec must exist before completion
- **Quality gates are mandatory**: Task isn't done until gates pass
- **Commits preserve progress**: Even if you stop mid-task, work is saved
