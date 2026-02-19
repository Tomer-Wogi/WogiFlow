Start working on a task. Provide the task ID as argument: `/wogi-start wf-XXXXXXXX`

**UNIVERSAL ENTRY POINT**: This is the single entry point for ALL requests. Route everything through `/wogi-start` - it will intelligently classify and route to the appropriate action.

## Request Triage (AI-Driven Routing v5.0)

When invoked with a **quoted request** instead of a task ID (e.g., `/wogi-start "update github and npm"`), you must assess the user's intent and route to the best command.

### Step 0: Detect Request Type

**Is this a task ID or a quoted request?**
- Task ID format: `wf-XXXXXXXX` (letters, numbers, hyphens) → Skip triage, go to Structured Execution
- Quoted request or natural language → Read the Command Catalog below, understand the user's intent, and invoke the right command

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

### Internal Tools (Auto-Invoked by wogi-start)

These commands are used automatically during task execution. You don't need to route to them — they run as part of the workflow:

| Command | Auto-invoked when |
|---------|-------------------|
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
3. **Some requests need no command at all.** Questions like "what does X do?" — just answer directly. Operational requests like "push to github" — just execute them. Quick fixes (typos, text changes) — fix and log to request-log.
4. **When genuinely unsure, ask.** Don't guess. Present 2-3 options from the catalog and let the user choose.

### Request Categories (Decision Guide)

**Proceed directly (no command needed):**
- Questions and exploration: "what does X do?", "explain how Y works", "show me the code for Z"
- Operational tasks: "push to github", "run tests", "deploy to staging", "npm publish"
- Quick fixes: simple typos, text changes, single-line fixes (execute + log to request-log)

**Route to a command (invoke the Skill tool):**
- Everything else. Pick the best command from the catalog above based on user intent.

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
→ Action: Execute git push directly (no command needed)
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
│  │     → All 3 run in parallel as Task agents         │  │
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
   - If `current >= 95%` → **Emergency compact** (always, regardless of task)
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
  "emergencyThreshold": 0.95,
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
- `"thorough"` (default): All 3 agents run in parallel
- `"standard"`: Codebase Analyzer + quick best practices search
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

#### Launching the Agents

**All 3 agents are launched as parallel `Task` calls in a single message** (established pattern from `/wogi-review`):

```javascript
// Launch all 3 in parallel (single message, 3 Task tool calls)
Task(subagent_type=Explore, prompt="Codebase Analyzer: ...")
Task(subagent_type=Explore, prompt="Best Practices: ...")
Task(subagent_type=Explore, prompt="Version Verifier: ...")
```

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

If web search fails for any agent (network issues, rate limits, timeouts):
- Log a warning: `⚠️ Web research unavailable for [Agent Name]. Proceeding with codebase analysis only.`
- The Codebase Analyzer always runs locally and never fails due to network issues
- If Best Practices agent fails: proceed without best practices (codebase + version verifier only)
- If Version Verifier agent fails: proceed using local package.json versions only (no web validation)
- If ALL web-based agents fail: proceed with codebase analysis only, equivalent to `researchDepth: "minimal"`
- Task proceeds normally without blocking — web research is always best-effort

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
      "versionVerifier": { "enabled": true }
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
   - Test strategy
   - Verification commands
2. Display spec summary
3. **Reflection checkpoint**: "Does this spec fully address the requirements?"

**Spec Output:**
```
📋 Generated Specification:

Acceptance Criteria: 4 scenarios
Implementation Steps: 6 steps
Files to Change: 3 files (medium confidence)
Verification Commands: 4 commands

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
- "Update app-map.md if new components created"
- "Update function-map.md if new utility functions created"
- "Update api-map.md if new API endpoints created"
- "Run quality gates"
- "Commit changes"

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
| feature | all checks |
| refactor | all checks |

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

**Config**: Controlled by `config.standardsCompliance`:
```json
{
  "standardsCompliance": {
    "enabled": true,
    "mode": "block",              // "block" or "warn"
    "scopeByTaskType": true,      // Use smart scoping
    "alwaysCheck": ["naming", "security"],
    "similarityThreshold": 80,
    "learning": {
      "enabled": true,
      "promotionThreshold": 3,
      "autoSyncRules": true
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
2. Update ready.json: Move task to recentlyCompleted
3. Update request-log.md with task entry
4. Update app-map.md if new components were created
5. Update function-map.md if new utility functions were created
6. Update api-map.md if new API endpoints were created
7. Git add and commit with message: `feat: Complete wf-XXXXXXXX - [title]`
8. Show completion summary with verification results

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

Final verification artifact: .workflow/verifications/wf-XXXXXXXX-final.json

🪞 Reflection: Does this match user request? ✓

✓ Completed: wf-XXXXXXXX - [Title]
  4/4 scenarios implemented
  Verification artifacts: 5 files
  Changes committed: "feat: Complete wf-XXXXXXXX - [title]"
```

## Options

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
- **Auto-suggest hypothesis debugging**: When a scenario fails 3+ times, suggest running `/wogi-debug-hypothesis "[failure description]"` to spawn parallel investigation agents that analyze competing theories about the root cause
- User can investigate and re-run `/wogi-start TASK-XXX` to continue

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
- **Self-verification is mandatory**: Don't mark scenarios done without checking they work
- **Criteria completion check is mandatory**: After implementing, re-read ALL criteria and verify EACH one actually works. If any is not done, implement it and check again. This is the loop that prevents "claiming done when not done."
- **Spec verification is mandatory**: All files promised in spec must exist before completion
- **Quality gates are mandatory**: Task isn't done until gates pass
- **Commits preserve progress**: Even if you stop mid-task, work is saved
