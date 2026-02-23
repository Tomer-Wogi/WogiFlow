# WogiFlow Command Flowcharts

How the core commands work, with visual flowcharts for every path.

---

## 1. `/wogi-start` — The Universal Entry Point

Everything in WogiFlow flows through `/wogi-start`. It's both a **router** (classifying what the user wants) and an **executor** (running the structured task loop).

### How Routing Works

When you type anything, `/wogi-start` first decides what kind of request this is:

```
┌─────────────────────────────────────────────────────────────┐
│  USER MESSAGE                                                │
│  "add dark mode" / "fix the bug" / "push to github"         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 0: Natural Language Detection                          │
│                                                              │
│  Does message match a known phrase?                          │
│    "code review"        → /wogi-review                       │
│    "morning briefing"   → /wogi-morning                      │
│    "show tasks"         → /wogi-ready                        │
│    "from now on always" → /wogi-decide                       │
│    (no match)           → Continue to Step 1                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ no match
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Intent Classification                               │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ Conversational│  │ Conversation │  │ Exploration       │   │
│  │ "yes", "go   │  │ "what do you │  │ "what does X      │   │
│  │  ahead", "no"│  │  think about"│  │  do?", "how"      │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘   │
│         │                 │                    │              │
│         ▼                 ▼                    ▼              │
│    Look back at     Respond               Answer the         │
│    conversation,    conversationally.     question             │
│    execute what     No files, no tasks,   directly            │
│    was proposed     no side effects.                          │
│                     Read-only tools OK.                       │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ Operational  │  │ Quick Fix    │  │ Bug Report        │   │
│  │ "push to    │  │ "fix typo in │  │ "login page       │   │
│  │  github"    │  │  header"     │  │  crashes"         │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘   │
│         │                 │                    │              │
│         ▼                 ▼                    ▼              │
│    Execute the       Execute + log       Route to            │
│    command           (no story           /wogi-bug            │
│    directly           needed)                                │
│                                                              │
│  ┌───────────────────┐                                       │
│  │ Implementation    │                                       │
│  │ "add dark mode"   │                                       │
│  │ "refactor auth"   │                                       │
│  └────────┬──────────┘                                       │
│           │                                                  │
│           ▼                                                  │
│      Route to                                                │
│      /wogi-story                                             │
│      (creates task)                                          │
└─────────────────────────────────────────────────────────────┘
```

### Task Size Classification

When an implementation request arrives, `/wogi-start` assesses scope:

```
┌──────────────────────────────────────────────────┐
│  SIZE ASSESSMENT                                  │
│                                                   │
│  How many files? How complex?                     │
│                                                   │
│  ┌─────────┐  ┌─────────┐  ┌────────┐  ┌──────┐ │
│  │ L3      │  │ L2      │  │ L1     │  │ L0   │ │
│  │ Subtask │  │ Task    │  │ Story  │  │ Epic │ │
│  │ 1 file  │  │ 1-5     │  │ 5-15   │  │ 15+  │ │
│  │ trivial │  │ files   │  │ files  │  │ files│ │
│  └────┬────┘  └────┬────┘  └───┬────┘  └──┬───┘ │
│       │            │           │           │     │
│       ▼            ▼           ▼           ▼     │
│    Execute      Create      Create       Create  │
│    inline       task,       story,       epic,   │
│    (no spec)    proceed     WAIT for     decompose│
│                             approval     to stories│
└──────────────────────────────────────────────────┘
```

### The Full Execution Pipeline (L2+ Tasks)

This is what happens when `/wogi-start` runs a real task:

```
┌─────────────────────────────────────────────────────────────────┐
│  /wogi-start wf-XXXXXXXX                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─── PHASE 0: PRE-FLIGHT ───────────────────────────────────┐  │
│  │                                                            │  │
│  │  0.25 Context Check                                        │  │
│  │    Current context + estimated task size > 95%?            │  │
│  │      YES → Compact first, then resume                      │  │
│  │      NO  → Proceed                                         │  │
│  │                                                            │  │
│  │  0.5 Parallel Check                                        │  │
│  │    Other independent tasks in ready queue?                 │  │
│  │      YES → Offer parallel execution option                 │  │
│  │      NO  → Continue sequentially                           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 1: RESEARCH (5 parallel agents) ─────────────────┐  │
│  │                                                            │  │
│  │  Agent 1: Codebase Analyzer                                │  │
│  │    → Find related files, existing components,              │  │
│  │      patterns from decisions.md, dependency map            │  │
│  │                                                            │  │
│  │  Agent 2: Best Practices Researcher                        │  │
│  │    → Web search for current patterns & pitfalls            │  │
│  │                                                            │  │
│  │  Agent 3: Version Verifier                                 │  │
│  │    → Check package.json versions, verify API compat        │  │
│  │                                                            │  │
│  │  Agent 4: Risk & History Analyzer                          │  │
│  │    → Check feedback-patterns.md, past corrections,         │  │
│  │      rejected approaches from memory-db                    │  │
│  │                                                            │  │
│  │  Agent 5: Standards Preview                                │  │
│  │    → Preview which rules will be enforced,                 │  │
│  │      check component duplication, security patterns        │  │
│  │                                                            │  │
│  │  Agent 6: Consumer Impact (refactors only)                 │  │
│  │    → Map ALL files that import/use the code being changed  │  │
│  │    → Classify: BREAKING / NEEDS-UPDATE / SAFE              │  │
│  │                                                            │  │
│  │  All agents run in PARALLEL → Consolidated summary         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 2: SPECIFICATION ────────────────────────────────┐  │
│  │                                                            │  │
│  │  Generate spec with:                                       │  │
│  │    - Acceptance criteria (Given/When/Then)                 │  │
│  │    - Files to change                                       │  │
│  │    - Boundary declarations (files NOT to touch)            │  │
│  │    - Consumer migration plan (if refactor)                 │  │
│  │    - [NEEDS CLARIFICATION] markers for unknowns            │  │
│  │                                                            │  │
│  │  ┌────────────────────────────────────────────────┐        │  │
│  │  │  L1/L0 tasks: APPROVAL GATE                    │        │  │
│  │  │  Display spec → STOP → Wait for user approval  │        │  │
│  │  │  L2/L3 tasks: Proceed immediately              │        │  │
│  │  └────────────────────────────────────────────────┘        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 3: IMPLEMENTATION LOOP ──────────────────────────┐  │
│  │                                                            │  │
│  │  FOR EACH acceptance criterion:                            │  │
│  │    ┌──────────────────────────────────────────────┐        │  │
│  │    │  1. Mark in_progress                         │        │  │
│  │    │  2. Implement the scenario                   │        │  │
│  │    │  3. Run verification (lint + typecheck)      │        │  │
│  │    │       │                                      │        │  │
│  │    │       ├── PASS → Mark completed, next        │        │  │
│  │    │       └── FAIL → Fix, retry (max 5x)        │        │  │
│  │    └──────────────────────────────────────────────┘        │  │
│  │                                                            │  │
│  │  AFTER all criteria implemented:                           │  │
│  │                                                            │  │
│  │  3.5 Criteria Completion Check                             │  │
│  │    Re-read ALL criteria. Any missing? → Loop back          │  │
│  │                                                            │  │
│  │  3.6 Wiring Check                                          │  │
│  │    Every new file imported somewhere? Orphans? → Wire them │  │
│  │                                                            │  │
│  │  3.7 Standards Check                                       │  │
│  │    Naming conventions, security patterns, duplication      │  │
│  │    Violations? → Fix, re-check                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 4: VERIFICATION ─────────────────────────────────┐  │
│  │                                                            │  │
│  │  Spec Verification: Do all promised files exist?           │  │
│  │  Quality Gates: lint, typecheck, tests, request-log        │  │
│  │  Reflection: Does this match what the user asked for?      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 5: COMPLETION ───────────────────────────────────┐  │
│  │                                                            │  │
│  │  Update: ready.json, request-log.md, app-map.md            │  │
│  │  Commit changes                                            │  │
│  │  Show completion summary                                   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Small Tasks (L3 Subtask) — Simplified Path

For trivial tasks (1 file, atomic change), the pipeline is much shorter:

```
User: "fix the typo in the header"
         │
         ▼
┌─────────────────────────────┐
│  Classify: L3 (Subtask)     │
│  Skip: research, spec,      │
│        approval gate         │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Execute inline             │
│  1. Read the file           │
│  2. Make the change         │
│  3. Verify (lint/typecheck) │
│  4. Log to request-log      │
│  5. Commit                  │
└─────────────────────────────┘
```

### Medium Tasks (L2 Task) — Standard Path

For 1-5 file changes with clear scope:

```
User: "add a loading spinner to the dashboard"
         │
         ▼
┌─────────────────────────────────────┐
│  Classify: L2 (Task)                │
│  Run: research agents (parallel)    │
│  Generate: spec with criteria       │
│  Skip: approval gate (L2 proceeds)  │
│  Execute: full implementation loop  │
│  Verify: criteria + standards       │
│  Complete: log + commit             │
└─────────────────────────────────────┘
```

### Large Tasks (L1 Story) — Full Path with Approval

For 5-15 file changes requiring design decisions:

```
User: "add user authentication"
         │
         ▼
┌─────────────────────────────────────┐
│  Classify: L1 (Story)               │
│  Run: research agents (parallel)    │
│  Generate: spec with criteria       │
│  *** STOP: Wait for user approval ***│
│  User: "approved"                   │
│  Execute: full implementation loop  │
│  Verify: criteria + standards       │
│  Complete: log + commit             │
└─────────────────────────────────────┘
```

### `/wogi-start` Options

| Flag | Effect |
|------|--------|
| `--tdd` | Write test first → verify fails → implement → verify passes |
| `--no-loop` | Load context only, don't auto-execute |
| `--no-spec` | Skip spec generation |
| `--no-skills` | Skip automatic skill loading |
| `--no-reflection` | Skip reflection checkpoints |
| `--max-retries N` | Limit retry attempts per scenario |
| `--pause-between` | Confirm between scenarios |
| `--verify-only` | Run verification without implementation |
| `--phased` | Break into Contract → Skeleton → Core → Edge Cases → Polish |

---

## 2. `/wogi-bug` — Bug Investigation & Fix

`/wogi-bug` is NOT a passive template creator. It's an AI investigator that searches the codebase, forms hypotheses, populates a full bug report, then auto-routes to `/wogi-start` for the fix.

### Full Bug Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  /wogi-bug "Login button not responding"                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─── PHASE 1: UNDERSTAND ───────────────────────────────────┐  │
│  │                                                            │  │
│  │  Parse user's description:                                 │  │
│  │    Symptom:   What the user observes                       │  │
│  │    Context:   Where it happens (screen, API, CLI)          │  │
│  │    Trigger:   What action causes it                        │  │
│  │    Frequency: Always? Sometimes? Race condition?           │  │
│  │                                                            │  │
│  │  If vague → Ask up to 3 clarifying questions               │  │
│  │  If clear → Skip questions, proceed to investigation       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 2: INVESTIGATE (2-3 parallel agents) ────────────┐  │
│  │                                                            │  │
│  │  Agent 1: Error Source Finder                              │  │
│  │    → Grep for error messages                               │  │
│  │    → Trace code flow from trigger to symptom               │  │
│  │    → Identify file:line where bug lives                    │  │
│  │    → Check git log for recent changes                      │  │
│  │                                                            │  │
│  │  Agent 2: Pattern & History Checker                        │  │
│  │    → Search feedback-patterns.md for similar bugs          │  │
│  │    → Check decisions.md for rules that should prevent it   │  │
│  │    → Search .workflow/bugs/ for past similar bugs          │  │
│  │    → Check request-log for recent related work             │  │
│  │                                                            │  │
│  │  Agent 3: Dependency Impact (high/critical severity only)  │  │
│  │    → Map files that import the affected code               │  │
│  │    → Assess cascade risk                                   │  │
│  │    → Check test coverage                                   │  │
│  │                                                            │  │
│  │  All agents run in PARALLEL                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 3: POPULATE REPORT ──────────────────────────────┐  │
│  │                                                            │  │
│  │  Using investigation results, fill EVERY field:            │  │
│  │    - Bug summary (1-2 sentences)                           │  │
│  │    - Steps to reproduce (numbered, concrete)               │  │
│  │    - Expected vs actual behavior                           │  │
│  │    - Root cause analysis (file:line, technical explanation) │  │
│  │    - 2+ fix approaches with pros/cons                      │  │
│  │    - 3+ acceptance criteria (Given/When/Then)              │  │
│  │    - Prevention & learning entries                          │  │
│  │                                                            │  │
│  │  *** Zero placeholder brackets allowed ***                 │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 4: SEVERITY ASSESSMENT ──────────────────────────┐  │
│  │                                                            │  │
│  │  Critical: Data loss, security, complete feature broken    │  │
│  │  High:     Major feature degraded, painful workaround      │  │
│  │  Medium:   Partially broken, easy workaround               │  │
│  │  Low:      Cosmetic, edge case only                        │  │
│  │                                                            │  │
│  │  May override user-provided severity with justification    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 5: CREATE FILE ──────────────────────────────────┐  │
│  │                                                            │  │
│  │  ./scripts/flow bug "title" --priority P1 --severity high  │  │
│  │  Edit generated file → replace all placeholders            │  │
│  │  Verify: grep for remaining [placeholder] → must be 0     │  │
│  │  Add to ready.json                                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 6: ROUTE TO EXECUTION ──────────────────────────┐  │
│  │                                                            │  │
│  │  Immediately invoke /wogi-start wf-XXXXXXXX                │  │
│  │  The bug report IS the specification                       │  │
│  │  /wogi-start uses acceptance criteria from bug file        │  │
│  │                                                            │  │
│  │  Bug-specific extras inside /wogi-start:                   │  │
│  │    - Verify root cause hypothesis before fixing            │  │
│  │    - Update bug status: Open → In Progress → Fixed         │  │
│  │    - MANDATORY learning enforcement after fix:             │  │
│  │      → Populate Resolution section                         │  │
│  │      → Capture to feedback-patterns.md                     │  │
│  │      → Evaluate prevention rules                           │  │
│  │      → Cross-reference to source task                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Bug Discovered During Other Work

When a bug is found while working on a different task:

```
Working on wf-XXXXXXXX...
         │
         ▼  Unexpected test failure / error in unrelated file
         │
┌─────────────────────────────────────┐
│  INLINE BUG DISCOVERY               │
│                                      │
│  1. Run lightweight investigation    │
│     (3 searches, 2 file reads max)   │
│  2. Populate ALL fields (no skipping)│
│  3. Create bug file                  │
│  4. Add to ready.json with priority  │
│     boost (medium → P1)             │
│  5. DO NOT start the fix             │
│  6. Return to current task           │
└─────────────────────────────────────┘
```

### Bug vs Story Comparison

| Aspect | `/wogi-story` | `/wogi-bug` |
|--------|--------------|-------------|
| Input | User describes desired feature | User describes broken behavior |
| Investigation | Explore phase (codebase + best practices) | Bug investigation (error source + patterns + impact) |
| Output | Story spec with acceptance criteria | Bug report with root cause + fix approaches |
| Execution | Routes to `/wogi-start` | Routes to `/wogi-start` |
| Post-completion | Update app-map, request-log | Same + learning enforcement + prevention rules |

---

## 3. `/wogi-review` — Comprehensive Code Review

A 5-phase review pipeline with parallel AI agents, standards enforcement, and a fix loop.

### Review Modes

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-review                                                │
│                                                              │
│  Auto-detect review mode:                                    │
│                                                              │
│  ┌──────────────────────┐    ┌────────────────────────────┐  │
│  │  PARALLEL MODE        │    │  MULTI-PASS MODE           │  │
│  │  (default)            │    │  (auto-enabled when)       │  │
│  │                       │    │                            │  │
│  │  3+ agents            │    │  - 5+ files changed        │  │
│  │  simultaneously       │    │  - Security files detected │  │
│  │                       │    │  - API files detected      │  │
│  │  Faster for           │    │                            │  │
│  │  simple reviews       │    │  4 sequential passes:      │  │
│  │                       │    │  1. Structure (Sonnet)     │  │
│  │                       │    │  2. Logic (Sonnet)         │  │
│  │                       │    │  3. Security (conditional) │  │
│  │                       │    │  4. Integration (conditional)│ │
│  └──────────────────────┘    └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### The 5-Phase Review Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  /wogi-review                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─── PHASE 1: VERIFICATION GATES ───────────── [1/5] ──────┐  │
│  │                                                            │  │
│  │  Get changed files (git diff)                              │  │
│  │  Run automated checks:                                     │  │
│  │    ✓/✗ Spec verification (do promised files exist?)        │  │
│  │    ✓/✗ Lint                                                │  │
│  │    ✓/✗ TypeCheck                                           │  │
│  │    ✓/✗ Tests                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 2: AI REVIEW (dynamic agents) ──── [2/5] ──────┐  │
│  │                                                            │  │
│  │  3 Agent Tiers (all run in parallel):                      │  │
│  │                                                            │  │
│  │  TIER 1 — Core (always):                                   │  │
│  │    Code & Logic:  naming, bugs, DRY, error handling        │  │
│  │    Security:      OWASP top 10, injection, credentials     │  │
│  │    Architecture:  component reuse, pattern consistency     │  │
│  │                                                            │  │
│  │  TIER 2 — Optional (from config):                          │  │
│  │    Performance:   N+1 queries, memory leaks, bundle size   │  │
│  │                                                            │  │
│  │  TIER 3 — Project Rules (auto-generated from decisions.md):│  │
│  │    One agent per rule category with substantive rules      │  │
│  │                                                            │  │
│  │  Adversarial mode: each agent MUST find 3+ findings        │  │
│  │  or provide written justification for clean code           │  │
│  │                                                            │  │
│  │  Persist all findings to last-review.json                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 2.5: GIT-VERIFIED CLAIMS ─────── [2.5/5] ──────┐  │
│  │                                                            │  │
│  │  Cross-reference spec vs actual git diff:                  │  │
│  │    ✓ File in spec AND in git diff → verified               │  │
│  │    ✗ File in spec but NOT in git → BLOCKER (missing)       │  │
│  │    ⚠ File in git but NOT in spec → WARNING (scope creep)   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 3: STANDARDS COMPLIANCE ────────── [3/5] ──────┐  │
│  │                                                            │  │
│  │  Check changed files against:                              │  │
│  │    decisions.md         → coding rules                     │  │
│  │    naming-conventions   → kebab-case, catch vars           │  │
│  │    security-patterns    → JSON.parse safety, path safety   │  │
│  │    app-map.md           → component duplication            │  │
│  │                                                            │  │
│  │  MUST_FIX violations → BLOCK sign-off in Phase 5           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 4: SOLUTION OPTIMIZATION ──────── [4/5] ──────┐   │
│  │                                                            │  │
│  │  NON-BLOCKING suggestions:                                 │  │
│  │    Technical: filter+map chains, sequential awaits         │  │
│  │    Modern JS: var usage, Promise chains                    │  │
│  │    UX: loading states, error messages, accessibility       │  │
│  │                                                            │  │
│  │  These are suggestions, not violations.                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌─── PHASE 5: POST-REVIEW ───────────────── [5/5] ──────┐   │
│  │                                                            │  │
│  │  Present consolidated summary to user.                     │  │
│  │                                                            │  │
│  │  User chooses:                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │ [1] Fix all now                                      │  │  │
│  │  │     critical/high → full quality loop                │  │  │
│  │  │     medium/low → light fix loop                      │  │  │
│  │  │                                                      │  │  │
│  │  │ [2] Fix critical/high only, tasks for rest           │  │  │
│  │  │     Fixes important issues, defers medium/low        │  │  │
│  │  │                                                      │  │  │
│  │  │ [3] Triage interactively                             │  │  │
│  │  │     Per-finding decisions via /wogi-triage            │  │  │
│  │  │                                                      │  │  │
│  │  │ [4] Create tasks for all (fix later)                 │  │  │
│  │  │     Every finding → persistent task in ready.json    │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  Fix loop: Create tracked task → apply fixes →             │  │
│  │            re-verify → complete task                       │  │
│  │                                                            │  │
│  │  Learning: capture patterns, promote rules (3+ repeats)   │  │
│  │  Archive: save report to .workflow/reviews/                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Review Options

| Flag | Effect |
|------|--------|
| `--commits N` | Include last N commits |
| `--staged` | Only staged changes |
| `--skip-verify` | Skip verification gates |
| `--verify-only` | Only run verification gates |
| `--multipass` | Force multi-pass mode |
| `--no-multipass` | Disable auto multi-pass |
| `--skip-standards` | Skip standards compliance |
| `--skip-optimization` | Skip optimization suggestions |
| `--security-only` | Only security agent |
| `--quick` | Faster, reduced thoroughness |

---

## 4. `/wogi-hybrid` — Claude Plans, Local LLM Executes

Hybrid mode splits work into planning (Claude) and execution (local/cheap model) to save tokens.

### How Hybrid Mode Works

```
┌─────────────────────────────────────────────────────────────────┐
│  HYBRID MODE                                                     │
│                                                                  │
│  ┌─── SETUP (one time) ─────────────────────────────────────┐   │
│  │                                                            │  │
│  │  /wogi-hybrid                                              │  │
│  │         │                                                  │  │
│  │         ▼                                                  │  │
│  │  Detect local LLM providers:                               │  │
│  │    Ollama installed?  → List available models              │  │
│  │    LM Studio?         → List available models              │  │
│  │    Cloud models?      → Check configured API keys          │  │
│  │         │                                                  │  │
│  │         ▼                                                  │  │
│  │  User selects executor model:                              │  │
│  │    Recommended:                                            │  │
│  │      - Qwen3-Coder 30B (best code quality)                │  │
│  │      - NVIDIA Nemotron 3 Nano (best instruction following) │  │
│  │      - DeepSeek Coder (good balance)                       │  │
│  │         │                                                  │  │
│  │         ▼                                                  │  │
│  │  Model selection persists for the session                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── EXECUTION FLOW ───────────────────────────────────────┐   │
│  │                                                            │  │
│  │  ┌──────────────┐     ┌──────────────┐     ┌───────────┐  │  │
│  │  │  1. YOU       │     │  2. CLAUDE    │     │  3. YOU   │  │  │
│  │  │  Give task    │────▶│  Creates     │────▶│  Review   │  │  │
│  │  │  "Add auth"   │     │  detailed    │     │  & approve│  │  │
│  │  │              │     │  plan        │     │  the plan │  │  │
│  │  └──────────────┘     └──────────────┘     └─────┬─────┘  │  │
│  │                                                   │        │  │
│  │                          ┌────────────────────────┘        │  │
│  │                          ▼                                 │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  4. LOCAL LLM EXECUTES                               │  │  │
│  │  │                                                      │  │  │
│  │  │  For each step in the plan:                          │  │  │
│  │  │    ┌─────────────────────────────────────┐           │  │  │
│  │  │    │  Send step instructions to local LLM │           │  │  │
│  │  │    │  Local LLM generates code            │           │  │  │
│  │  │    │        │                             │           │  │  │
│  │  │    │        ├── SUCCESS → Next step       │           │  │  │
│  │  │    │        │                             │           │  │  │
│  │  │    │        └── FAILURE                   │           │  │  │
│  │  │    │              │                       │           │  │  │
│  │  │    │              ▼                       │           │  │  │
│  │  │    │  ┌───────────────────────────┐       │           │  │  │
│  │  │    │  │ Ask LLM what was missing  │       │           │  │  │
│  │  │    │  │ Update model profile      │       │           │  │  │
│  │  │    │  │ Retry with enhanced context│       │           │  │  │
│  │  │    │  │       │                   │       │           │  │  │
│  │  │    │  │       ├── RETRY SUCCESS   │       │           │  │  │
│  │  │    │  │       │                   │       │           │  │  │
│  │  │    │  │       └── ESCALATE TO     │       │           │  │  │
│  │  │    │  │           CLAUDE          │       │           │  │  │
│  │  │    │  └───────────────────────────┘       │           │  │  │
│  │  │    └─────────────────────────────────────┘           │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                          │                                 │  │
│  │                          ▼                                 │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  5. COMPLETION                                       │  │  │
│  │  │  All steps done → Normal verification pipeline       │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── INTELLIGENCE FEATURES ────────────────────────────────┐   │
│  │                                                            │  │
│  │  Model Learning Profiles (.workflow/state/model-profiles/) │  │
│  │    → Learns what context each model needs                  │  │
│  │    → Tracks common failure patterns                        │  │
│  │    → Optimal instruction richness per model                │  │
│  │                                                            │  │
│  │  Task Type Classification                                  │  │
│  │    create / modify / refactor / fix / integrate            │  │
│  │    → Each type loads specific context                      │  │
│  │                                                            │  │
│  │  Cheaper Context Generation                                │  │
│  │    Scripts (free) → Haiku (cheap) → Sonnet → Opus          │  │
│  │    Uses cheapest model appropriate for each context task   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Token Savings: 20-60% depending on task complexity              │
│                                                                  │
│  Commands:                                                       │
│    /wogi-hybrid-off     Disable hybrid mode                      │
│    /wogi-hybrid-status  Check current configuration              │
│    /wogi-hybrid-edit    Modify plan before execution             │
│    /wogi-hybrid --select-model  Change executor model            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Master Flowchart: All Commands Together

This shows how the commands relate to each other:

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER MESSAGE                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Natural Language       │
              │  Detection Table        │
              │  (phrase matching)      │
              └─────┬─────┬─────┬──────┘
                    │     │     │
        ┌───────────┘     │     └───────────┐
        ▼                 ▼                 ▼
  /wogi-review     /wogi-ready        /wogi-decide
  /wogi-morning    /wogi-status       /wogi-learn
  /wogi-health     /wogi-roadmap      /wogi-retrospective
  (etc.)           (etc.)             (etc.)
                    │
                    │ no match
                    ▼
              ┌────────────────────────┐
              │  /wogi-start           │
              │  (universal router)    │
              └─────┬──┬──┬──┬──────┘
                    │  │  │  │
        ┌───────────┘  │  │  └───────────┐
        ▼              │  ▼              ▼
  ┌─────────────┐      │ ┌────────────┐ ┌──────────────┐
  │CONVERSATION │      │ │ BUG REPORT │ │IMPLEMENTATION│
  │ "what do you│      │ │ "broken",  │ │ "add", "fix",│
  │  think about"     │ │ "crashes"  │ │ "create"     │
  └──────┬──────┘      │ └─────┬──────┘ └──────┬───────┘
         │             │       │               │
         ▼             ▼       ▼               ▼
   Respond      ┌───────────┐ ┌────────────┐ ┌────────────┐
   conversationally│ EXPLORATION│ │ /wogi-bug  │ │ /wogi-story│
   (no side     │ questions, │ │            │ │            │
    effects,    │ research   │ │ Investigate│ │ Create spec│
    read-only   └─────┬─────┘ │ 2-3 agents │ │ with AC    │
    tools OK)         │       │ Populate   │ │            │
                      ▼       │ bug report │ │            │
                 Answer       │            │ │            │
                 directly     │            │ │            │
                  └─────┬──────┘    └─────┬──────┘
                        │                 │
                        └────────┬────────┘
                                 │
                                 ▼
                  ┌──────────────────────────┐
                  │  /wogi-start wf-XXXXXXXX │
                  │  (structured execution)  │
                  │                          │
                  │  Research → Spec →        │
                  │  Implement → Verify →     │
                  │  Complete                 │
                  │                          │
                  │  ┌────────────────────┐  │
                  │  │ Hybrid mode?       │  │
                  │  │ YES → Local LLM    │  │
                  │  │       executes     │  │
                  │  │ NO  → Claude       │  │
                  │  │       executes     │  │
                  │  └────────────────────┘  │
                  └──────────┬───────────────┘
                             │
                             ▼
                  ┌──────────────────────────┐
                  │  Task Complete            │
                  │                          │
                  │  Optionally:             │
                  │  /wogi-review            │
                  │  (post-implementation    │
                  │   code review)           │
                  └──────────────────────────┘
```
