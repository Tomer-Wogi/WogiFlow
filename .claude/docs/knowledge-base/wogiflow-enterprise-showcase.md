# WogiFlow: Enterprise AI Development Workflow

**The only AI coding workflow with mechanical enforcement.**

Every other tool in the Claude Code ecosystem gives the AI _suggestions_. WogiFlow gives it _rules it physically cannot break_. This is the difference between a coding assistant that sometimes follows best practices and one that is architecturally incapable of skipping them.

---

## The Core Problem WogiFlow Solves

AI coding agents are powerful but undisciplined. Without structure, they:

- Skip verification and claim "done" based on "the code looks correct"
- Make untracked changes that nobody can audit
- Forget project conventions between sessions
- Hallucinate completion — static checks pass, but the feature doesn't actually work
- Make autonomous decisions about things the team should decide
- Lose context mid-task and produce inconsistent output

These problems multiply with team size. One developer with a loose AI assistant creates tech debt. Ten developers with loose AI assistants create chaos.

**WogiFlow eliminates these failure modes through mechanical enforcement** — hook-based gates that physically intercept every tool call and block violations before they happen. Not prompts asking nicely. Real code that runs before every file edit, every bash command, every tool invocation.

---

## How It Works: The /wogi-start Pipeline

Everything in WogiFlow begins with `/wogi-start`. This is the universal entry point — every user message, every task, every question must pass through it. The routing gate mechanically blocks all tools (Edit, Write, Bash, Read, Grep) until routing completes.

### What Happens When You Say "Add dark mode toggle"

```
User message
    │
    ▼
┌─────────────────────────────┐
│  ROUTING GATE (mechanical)  │  ← All tools blocked until /wogi-start runs
│  PreToolUse hook intercepts │
│  every tool call            │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  /wogi-start TRIAGE         │  ← Classifies: story, bug, review, conversation?
│  Determines task level:     │     Routes to appropriate pipeline
│  L0 Epic (15+ files)        │
│  L1 Story (5-15 files)      │
│  L2 Task (1-5 files)        │
│  L3 Subtask (1 file)        │
└─────────────┬───────────────┘
              │
              ▼
```

### The Pipeline: What Runs Depends on Task Size

| Phase | L3 Subtask | L2 Task | L1 Story | L0 Epic |
|-------|-----------|---------|----------|---------|
| **Routing + Context** | Yes | Yes | Yes | Yes |
| **Multi-Agent Research** (6 parallel agents) | Skip | Yes | Yes | Yes |
| **Reuse Gate** (check existing components) | Skip | Yes | Yes | Yes |
| **Scope-Confidence Audit** | Skip | Skip | Yes | Yes |
| **Architect Pass** (IGR) | Skip | Skip | Yes | Yes |
| **Logic Adversary** (different model critiques plan) | Skip | Skip | Yes | Yes |
| **Spec Generation + Approval** | Skip | Conditional | Yes (blocks for approval) | Yes (blocks for approval) |
| **Implementation Loop** | Yes | Yes | Yes | Yes |
| **Skeptical Evaluator** (separate agent grades work) | Skip | Yes | Yes | Yes |
| **Runtime Verification** (auto-generated tests) | Yes | Yes | Yes | Yes |
| **Wiring Validation** | Yes | Yes | Yes | Yes |
| **Standards Compliance** | Yes | Yes | Yes | Yes |
| **Quality Gates** | Yes | Yes | Yes | Yes |

A trivial L3 fix takes seconds. An L1 story goes through the full pipeline — research, planning, adversarial review, implementation, independent verification, quality gates. The AI doesn't choose what to skip; the pipeline enforces it based on task classification.

### Phase-Loaded Architecture

The pipeline instructions are split into 5 phase files loaded on-demand. A conversation that never reaches the coding phase never loads coding instructions — saving ~79% of prompt tokens. The PreToolUse hook blocks Edit/Write/Bash until the current phase's instruction file is read, ensuring the AI always has the right instructions loaded.

---

## Mechanical Enforcement: 12+ Gates That Cannot Be Bypassed

Every tool call in WogiFlow passes through the PreToolUse hook. This is real JavaScript code that executes before Claude Code processes any Edit, Write, Bash, Read, or Grep command. The gates are not suggestions — they are physical blocks.

| Gate | What It Enforces | Fail Mode |
|------|-----------------|-----------|
| **Routing Gate** | Every message must go through /wogi-start first | Block all tools |
| **Phase Gate** | Tools restricted per workflow phase (no editing during research) | Block Edit/Write |
| **Phase-Read Gate** | Must read phase instructions before working | Block Edit/Write/Bash |
| **Scope Gate** | Edits must be within the task's declared file scope | Block Edit/Write |
| **Bugfix Scope Gate** | L3 bugfixes limited to 3 files before escalation | Warn then block |
| **Scope Mutation Gate** | Fix tasks can't create new files; can't delete pre-existing files | Block Write/Bash |
| **Strike Gate** | After 3 failed verification attempts, blocks further edits | Block Edit/Write/Bash |
| **Deploy Gate** | Can't deploy without verification artifact | Block Bash |
| **Git Safety Gate** | Auto-backup before destructive git operations | Block or backup |
| **Commit-Log Gate** | Commits must have request-log entries | Block Bash (git commit) |
| **Manager Boundary Gate** | Manager repos can't modify worker repo source code | Block Edit/Write |
| **Component Reuse Gate** | Must check existing components before creating new ones | Warn on Write |
| **Standards Compliance** | Naming, security, decisions.md rules enforced | Block task completion |
| **Damage Control** | Configurable blocklist for dangerous commands/files | Block or ask |

**Example**: A developer asks Claude to "quickly fix the login bug." Without WogiFlow, Claude edits 8 files, skips tests, and says "done." With WogiFlow:

1. Routing gate forces `/wogi-start` classification → L3 bugfix
2. Bugfix scope gate warns after 3 files, blocks after threshold
3. Phase gate prevents editing during the research phase
4. Strike gate blocks further changes after 3 failed lint checks
5. Standards gate verifies the fix follows project conventions
6. Commit-log gate ensures the change is logged before commit

---

## Intent-Grounded Reasoning (IGR)

For L1+ tasks, WogiFlow adds a reasoning layer that catches logic failures _before_ code is written.

### The Architect + Adversary Pattern

1. **Intent Framing**: The AI explicitly interprets the task — resolving ambiguous terms, identifying affected user journeys, surfacing assumptions
2. **Architect Pass**: A read-only sub-agent produces an 8-section plan (approach, data model, risks, alternatives, dependencies)
3. **Logic Adversary**: A _different model_ critiques the plan against a 10-principle Logic Constitution. Same-model self-critique is a known rubber-stamp failure mode — WogiFlow uses Sonnet to critique Opus plans (or vice versa)
4. **Iteration Loop**: If the Adversary finds issues, the plan goes back to the Architect. Max 3 rounds. If it still fails → task is blocked and surfaced to the user

This catches architectural mistakes, missing edge cases, and flawed assumptions before a single line of code is written.

### Completion Truth Gate

When the AI claims a task is "done," the Truth Gate audits every acceptance criterion against evidence tiers:

| Tier | Name | Counts as Done? |
|------|------|----------------|
| 0 | STATIC (compiles, lints) | Never |
| 1 | STRUCTURAL (file exists, imported) | Never |
| 2 | OBSERVATIONAL (page loads, renders) | Display-only criteria |
| 3 | INTERACTIVE (click → result persists) | Yes |
| 4 | AUTOMATED (test passes) | Yes (strongest) |

If the AI claims "done" with only Tier 0 evidence (it compiles), the gate downgrades the claim to "implemented (unverified)" and blocks task completion.

---

## Verification: The Skeptical Evaluator

After implementation, WogiFlow spawns a separate sub-agent specifically tuned for skepticism:

- **Different model** than the implementer (prevents self-congratulation bias)
- **Prompted to find problems**, not praise
- **Grades each criterion**: PASS / PARTIAL / FAIL with file:line evidence
- **Iteration loop**: If issues found → fix → re-evaluate (max 3 rounds)

This is based on Anthropic's own harness design research: _"Separating the agent doing the work from the agent judging it is a strong lever"_ and _"tuning standalone evaluators toward skepticism is far more tractable than making a generator critical of its own work."_

---

## Hybrid Mode: Smart Model Routing

Not every task needs the most expensive model. WogiFlow's hybrid mode lets Opus plan while cheaper models execute:

| Task Complexity | Executor | Token Savings |
|----------------|----------|---------------|
| Typo fix, config edit | Haiku / GPT-4o-mini | ~75% |
| New function, component | Sonnet / GPT-4o | ~60% |
| Documentation | Haiku | ~80% |
| Complex refactoring | Opus only | 0% (not delegated) |

**How it works:**
1. Opus analyzes the task and creates a detailed execution plan
2. You review and approve (or edit via `/wogi-hybrid-edit`)
3. The executor model (Haiku, Sonnet, Ollama, etc.) runs each step
4. Opus validates results — lint, typecheck, standards checks
5. Opus handles failures with escalation back to itself if needed

**Supports cloud and local models**: Haiku, Sonnet, GPT-4o, GPT-4o-mini, Gemini Flash/Pro, Ollama (Qwen3-Coder, DeepSeek Coder, Nemotron). Local models = free execution.

---

## Code Review: /wogi-review

WogiFlow's review is not "look at the code and give suggestions." It's a 5-phase verification pipeline:

1. **Verification Gates**: Spec verification, lint, typecheck, test execution
2. **AI Analysis**: Multi-pass or parallel code/logic/security/architecture review with adversarial minimum findings (the reviewer must find at least N issues — prevents rubber-stamping)
3. **Git-Verified Claim Checking**: Cross-references spec claims against actual git diff. If the spec promises a file that isn't in the diff → BLOCKED
4. **Standards Compliance [STRICT]**: Every finding checked against decisions.md, app-map.md, naming conventions. MUST_FIX violations block sign-off
5. **Post-Review Workflow**: Fix loop with automatic task creation for findings

The review produces a structured report with findings classified by severity (critical, high, medium, low) and type (MUST_FIX, SHOULD_FIX, SUGGESTION). Critical/high findings block the next release.

---

## Morning Briefing: /wogi-morning

Start every day with instant situational awareness:

- **Where you left off**: Current task, status, files touched
- **What happened since**: New commits, issues, changes by teammates
- **Rule violations**: Auto-promoted patterns awaiting enforcement decisions
- **Stale skills**: Documentation older than 90 days flagged for refresh
- **Recommended next tasks**: Top 3 by priority from the backlog
- **Ready-to-use prompt**: Copy-paste continuation prompt to resume immediately

This eliminates the 10-15 minute "where was I?" ramp-up that costs teams hours per week.

---

## Session End: /wogi-session-end

When you stop working, WogiFlow preserves everything:

- **Structured handoff notes**: What's completed, what's in progress, what's next
- **Cross-session pattern detection**: Identifies requests repeated 3+ times across sessions and suggests promoting them to permanent rules
- **State persistence**: All workflow state committed to git — survives restarts, crashes, and machine changes
- **Request log verification**: Ensures all changes are logged before closing
- **Component registry check**: Verifies new components are registered in app-map

The next session (or the next developer on the same repo) picks up exactly where you left off.

---

## Workspace Mode: Multi-Repo Orchestration

This is the game changer for enterprise teams. WogiFlow can manage multiple repositories from a single orchestrator.

### The Manager-Worker Architecture

```
Manager (workspace root — orchestrates, never codes)
   │
   ├── Backend repo (provider — APIs, database)
   ├── Frontend repo (consumer — UI, pages)
   ├── Shared repo (library — types, utils)
   └── Mobile repo (consumer — native app)
```

**How it works:**
1. You tell the manager: "Add user profile editing"
2. Manager reads metadata from all repos (API maps, component registries, schemas — never source code)
3. Manager analyzes which repos are affected and in what order
4. Manager creates phased execution plan: library → provider → consumer
5. Each worker repo gets a task dispatched via HTTP channel
6. Workers execute independently in their own Claude Code sessions
7. Workers communicate via message bus: contract changes, questions, completion signals
8. Manager validates cross-repo integration

### Mechanical Boundary Enforcement

The manager physically cannot modify worker repo source code. The Manager Boundary Gate blocks all Edit/Write operations on files inside member repos. The manager can only:
- Read metadata (api-map, app-map, schema-map, config)
- Dispatch tasks to workers
- Read messages from the message bus
- Validate cross-repo contracts

This prevents the orchestrator from becoming a bottleneck or making unauthorized changes.

### Cross-Repo Quality Gates

When workspace mode is active, additional gates enforce integration quality:
- **Contract Compliance**: Changes must comply with declared API contracts
- **Peer Notification**: Affected repos are automatically notified of changes
- **Cascade Verification**: Library changes trigger verification in all consumer repos
- **Impact Query**: Before implementing, workers can ask peers "will my change break you?"

### Agent-to-Agent Communication

Workers communicate through 11 message types:
- `contract-change` — "I changed an API endpoint"
- `question` — "Does your side handle X?"
- `impact-query` / `impact-response` — Pre-implementation impact assessment
- `lock-acquired` / `lock-released` — Shared interface edit coordination
- `verification-request` — "Please verify your integrations"

---

## Self-Improving Workflow

WogiFlow learns from corrections and promotes patterns to permanent rules:

1. **Feedback Patterns**: When you correct the AI, it records the pattern in `feedback-patterns.md`
2. **Promotion Threshold**: When a pattern occurs 3+ times, it's promoted to `decisions.md` (permanent project rules)
3. **Gate Telemetry**: Every gate tracks pass/catch/miss rates. A gate that consistently passes work that later needs correction has a high "miss rate" — revealing rubber-stamping
4. **Correction Memory**: The IGR system cross-references corrections back to gates that previously approved the flawed work
5. **Decision Authority**: The AI learns which decisions it can make autonomously vs which need human approval, calibrated per category

This means the more you use WogiFlow, the better it gets. Week 1 catches 60% of issues. Week 8 catches 90% — because the rules that caught the other 30% were learned from your corrections.

---

## Memory System

WogiFlow maintains persistent memory across sessions using SQLite with semantic search:

- **SQLite database** with HuggingFace Transformers embeddings (all-MiniLM-L6-v2)
- **Cosine similarity search**: "Find decisions related to authentication" works without exact keywords
- **Relevance decay**: Facts accessed frequently stay hot; unused facts decay over 30 days
- **Cold retention**: Facts not accessed in 90 days are archived
- **Auto-promotion**: Facts accessed 3+ times with high relevance are promoted to permanent knowledge
- **Structured registries**: app-map, function-map, api-map, schema-map, service-map — deterministic lookup for components, functions, endpoints, schemas

---

## Why This Matters for Enterprise

### The Cost of Undisciplined AI Coding

| Problem | Without WogiFlow | With WogiFlow |
|---------|-----------------|---------------|
| Untracked changes | AI edits files without logging | Every change logged, tagged, auditable |
| Skipped verification | "It compiles" = "it works" | 5-tier evidence system, skeptical evaluator |
| Convention drift | Each session forgets project rules | Rules mechanically enforced, self-improving |
| Scope creep | Fix one bug, touch 15 files | Bugfix scope gate limits blast radius |
| Knowledge loss | Context lost between sessions | SQLite memory + structured handoffs |
| Unsafe deployments | Deploy without testing | Deploy gate blocks without verification |
| Team inconsistency | 10 developers, 10 styles | Standards gate enforces unified conventions |
| Wasted tokens | Full pipeline for typo fixes | Phase-loaded router: 79% savings for small tasks |
| Multi-repo chaos | Manual coordination across repos | Workspace orchestration with boundary enforcement |

### What Companies Get

1. **Auditability**: Every task is tracked from request through implementation to verification. The request log, git history, and verification artifacts create a complete audit trail.

2. **Consistency**: Mechanical enforcement means the AI follows the same process whether it's Monday morning or Friday 5pm, whether the developer is senior or junior.

3. **Scalability**: Hybrid mode reduces token costs by 60-75%. Workspace mode enables multi-repo orchestration. Phase loading optimizes prompt costs.

4. **Safety**: 12+ mechanical gates prevent unauthorized changes, scope creep, unsafe deployments, and convention violations. The AI literally cannot bypass them.

5. **Continuous improvement**: The self-learning system means the workflow gets better over time without manual rule maintenance. Corrections become permanent rules automatically.

6. **Knowledge retention**: Project knowledge persists in structured state files, semantic memory, and cross-session handoffs. New team members inherit the full learning history.

---

## Quick Start

```bash
npm install -D wogiflow
npx flow onboard
```

Onboarding analyzes the existing project, detects the tech stack, indexes components, and configures the workflow. First task can start in under 5 minutes.

---

*WogiFlow v2.15.0 — AGPL-3.0 Licensed*
*Teams/enterprise features available via @wogiflow/teams*
