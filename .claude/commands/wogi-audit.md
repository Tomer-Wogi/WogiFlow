---
description: "Comprehensive project-wide deep analysis beyond code review"
effort: high
---
Comprehensive project-wide deep analysis that goes far beyond code review. While `/wogi-review` asks "did I introduce problems?", `/wogi-audit` asks "how can we make this project better?"

**Triggers**: `/wogi-audit`, "audit project", "project audit", "full project analysis", "full analysis"

## Usage

```bash
/wogi-audit                    # Full 7-dimension audit
/wogi-audit --skip-deps        # Skip dependency analysis
/wogi-audit --skip-web         # Skip web searches (faster, offline)
/wogi-audit --focus arch       # Focus on architecture only
/wogi-audit --focus perf,debt  # Focus on specific dimensions
```

## Comparison

| Dimension | /wogi-health | /wogi-review | /wogi-audit |
|-----------|-------------|-------------|-------------|
| Checks | WogiFlow files/config | Code quality in specific files | Entire project holistically |
| Finds | Missing files, broken JSON | Bugs, security, standards violations | Architecture, opportunities, modernization |
| Scope | WogiFlow infrastructure | Git diff (or NL-scoped files) | All project code |
| When | After install/config changes | After coding, before commit | Periodically, or when onboarding |
| Output | Health status (pass/fail) | Findings with fix recommendations | Strategic report with prioritized opportunities |

## Architecture Note

The audit system has **two layers**:
1. **Runtime script** (`flow-audit.js`) — provides helper functions for file scanning, TODO finding, dependency checking, and score calculation.
2. **AI instructions** (this document) — describe the 7-agent parallel analysis, scoring, and post-audit workflow. You (the AI) orchestrate the full audit.

## Progress Tracking

At each step checkpoint, display a progress bar AND update the progress state file:

```bash
node node_modules/wogiflow/scripts/flow-progress-tracker.js update '{"taskId":"audit","command":"/wogi-audit","phase":"Agents","phaseNum":2,"totalPhases":6,"step":"Agent 5/7 complete","stepNum":5,"totalSteps":7}'
```

**Phase mapping for /wogi-audit:**
| Step | Description |
|------|-------------|
| 0   | Framing — interpret scope, surface assumptions, item reconciliation |
| 1   | Gather Files — scan project files |
| 1.5 | Gate 0 — pre-agent baseline checks (build, typecheck, lint, config integrity) |
| 1.8 | Evidence Tiers — brief agents on required evidence grading (0–4) |
| 2   | Agents — 7 parallel agents (sub-steps = agents) |
| 3   | Consolidate — score calculation + Gate 0 cap |
| 3.5 | Adversary — different-model critique of findings (false positives, missed issues, severity) |
| 4   | Pattern Promotion — AI clustering + cross-reference + enforcement-gap detection |
| 5   | Display Report — formatted report with Gate 0 baseline + adversary block + promotions |
| 6   | Post-Audit Actions — user chooses follow-up (create tasks, apply promotions, etc.) |
| 7   | Persist — save to last-audit.json (includes Gate 0 data + adversary run + framing + trend) |

**Display at each agent completion:**
```
━━━ PROGRESS: [████░░░░░░] 35% Step 2: Audit Agents ━━━
  Agent 5/7 complete (Architecture, Dependencies, Duplication, Performance, Consistency done)
```

On audit completion, clear progress: `node node_modules/wogiflow/scripts/flow-progress-tracker.js clear`

## How It Works

### Step 0: Framing Pass (MANDATORY when `config.audit.framingPass.enabled`, default ON)

**Problem this solves**: "Audit" means different things in different invocations. "Audit what we did this epic" is bounded to ~20 files; "audit the project" is bounded to the whole repo; "audit our auth flow" is bounded to a module. Without explicit framing, the AI picks its own scope and the user may get an answer to a different question than they asked.

**This is NOT a clarifying-questions step** (no user round-trip). It's a self-reflective interpretation: the AI writes down what it thinks the user asked, what scope bounds that implies, and what's explicitly out of scope — BEFORE launching any agents. The user sees the framing before agents run and can correct it.

**Procedure**:
1. Interpret the user's audit request into a **Framing Artifact** with 5 fields:
   - `interpretation` — one sentence: "I understand this as: audit X for Y purpose"
   - `scopeIn` — explicit list: which files / directories / epics / time windows are in scope
   - `scopeOut` — explicit list: what this audit will NOT cover (out of scope by design, not by omission)
   - `assumptions` — 2–5 domain assumptions the audit rests on (e.g., "an audit must verify test coverage" or "the epic-episodic-memory stories were shipped in the last 30 days")
   - `dimensionWeights` — any adjustment to the 7-dimension balance based on request (e.g., "user asked for token-saving validation → weight performance + tech-debt higher")

2. Write the artifact to `.workflow/state/audit-framing/{timestamp}.md` (with PIN markers for future queryability).

3. Display a short summary to the user:
   ```
   ━━━ AUDIT FRAMING ━━━
   Interpretation: [one sentence]
   Scope (in):  [list]
   Scope (out): [list]
   Assumptions:
     - [assumption 1]
     - [assumption 2]

   Dimension weights: [any adjustments from default]
   Proceeding with 7-agent analysis on this scope.
   ━━━━━━━━━━━━━━━━━━━━━━
   ```

4. **Item reconciliation** (when the user's request enumerated multiple focus areas, e.g., "audit X, Y, and Z"): each named item MUST appear in `scopeIn`. If the count shrank (user named 5, framing has 3), the framing pass FAILS — display which items were dropped and require the user to confirm before proceeding. This is the anti-deferral guard from `/wogi-start` ported to audit.

5. **Conversation-mode tier check** (shared with Research Reasoning Gate): "What should we do about X?" in audit context → Tier 2 (surface assumptions). Plain audit = Tier 1 factual.

Config toggles: `audit.framingPass.enabled` (default true), `audit.framingPass.itemReconciliation` (default true).

### Step 1: Gather Project Files

```bash
node node_modules/wogiflow/scripts/flow-audit.js files
```

This returns all tracked project files (excluding node_modules, dist, .workflow/state/, etc.). Use this as the base file set for all agents.

### Step 1.5: Gate 0 — Pre-Agent Baseline Checks (MANDATORY)

**Run BEFORE launching any analysis agents.** These are hard, verifiable checks — not AI judgment. They produce quantitative metrics that cap the final audit score.

**Principle**: If the project doesn't build, doesn't pass typecheck, or has hundreds of linter errors — the score CANNOT be higher than D+, regardless of how elegant the architecture is. The foundation is broken.

```bash
node node_modules/wogiflow/scripts/flow-audit-gates.js run
```

This returns JSON with all gate results. Parse and display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATE 0: PROJECT HEALTH BASELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BUILD:       ✓ passes  |  ✗ FAILS (cap: D)
TYPECHECK:   ✓ 0 errors  |  ✗ N errors (cap: C/D+/D)
LINT:        ✓ 0 errors, M warnings  |  ✗ N errors (cap: C)
LINT CONFIG: ✓ no downgraded rules  |  ✗ N rules downgraded (-N pts)
TESTS:       ✓ pass  |  ✗ FAIL  |  ○ no test script
SCRIPTS:     ✓ all present  |  ✗ missing: build, test

Extended:
  eslint-disable comments: N (across M files)
  Framework: React 18.x + TypeScript (monorepo)
  Git health: 45 commits/30d, conventional commits: yes
  Env hygiene: .env.example ✓, CI ✓

Score cap: [GRADE] (reasons: ...)
Trend: typecheck errors 939 → 412 (-527) ↑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Gate results feed into scoring (Step 3)**:
- `gate0.cap.scoreCap` — maximum score the project can achieve
- `gate0.cap.penalties` — points deducted from the agent-derived score
- `gate0.eslintDisables` — passed to Consistency agent as context
- `gate0.framework` — used to load framework-specific agent prompts
- `gate0.trend` — shown in the final report for improvement tracking

**If Gate 0 reveals critical issues** (build fails, >500 type errors), display a prominent warning before proceeding to agents:
```
⚠ CRITICAL BASELINE ISSUES DETECTED
  The project has fundamental health problems. Agent analysis will proceed
  but the overall score is capped at [GRADE] due to Gate 0 failures.
```

**Framework-specific agent prompts**: When `gate0.framework` detects a known framework, inject framework-specific checks into the relevant agents:

| Framework | Agent | Additional Checks |
|-----------|-------|-------------------|
| **React** | Performance | useState count per component (>5 = re-render risk), React.memo usage ratio, inline objects in JSX .map(), useEffect without cleanup |
| **React** | Architecture | God components (>1000 LOC), prop drilling depth, context provider nesting |
| **Next.js** | Performance | Page bundle sizes, dynamic imports usage, ISR/SSR appropriate usage |
| **Next.js** | Architecture | API route structure, middleware usage, server/client boundary |
| **NestJS** | Architecture | Module structure, circular module deps, guard/interceptor coverage |
| **NestJS** | Performance | Eager-loaded modules, missing caching decorators |

The framework checks are appended to the existing agent prompts — they don't replace the universal checks.

### Step 1.8: Finding Evidence Tiers (MANDATORY when `config.audit.evidenceTiers.enabled`, default ON)

**Problem this solves**: Today's audit findings say "[HIGH] Missing error handling in X" without telling the reader WHY the AI is confident. That leads to rubber-stamped "HIGH" on a finding that's actually speculative, and dismissed "LOW" on findings that were verified by grep.

**Tier system** (shared with the IGR Completion Truth Gate — same constants from `flow-runtime-verification.js`):

| Tier | Name | What it means for audit findings |
|------|------|----------------------------------|
| 0 | STATIC | AI inferred from the source alone — no grep, no execution. Weakest. |
| 1 | STRUCTURAL | AI grepped / globbed / counted instances across the codebase. |
| 2 | OBSERVATIONAL | AI ran a tool (lint, typecheck, npm audit) and read its output. |
| 3 | INTERACTIVE | AI executed code or tests and observed the behavior. |
| 4 | AUTOMATED | A quality gate or test suite produces this finding deterministically on every run. |

**Agent instructions update** (applies to all 7 agents + new ones): every finding MUST carry an `evidenceTier` 0–4 and a one-line `evidenceNote` citing what produced the evidence (filename, tool name, test ID, command run). A finding at Tier 0 with severity HIGH is suspect and should be flagged in the Adversary pass.

**Severity/tier interaction rule**:
- Tier ≥ 2 findings: severity stands as agent assigned.
- Tier 1 findings: severity capped at MEDIUM unless grep returned ≥5 instances.
- Tier 0 findings: severity capped at LOW and must be flagged "UNVERIFIED" in the report.

Config toggle: `audit.evidenceTiers.enabled` (default true).

### Step 2: Launch 7 Parallel Agents

Launch ALL enabled agents as parallel `Task` calls in a single message. Each agent uses `subagent_type=Explore` and `model="sonnet"` (per decisions.md: use Sonnet for routine exploration).

**Agent configuration** is in `config.audit.agents` — skip any agent set to `false`.

**Shared agent preamble (prepend to every agent prompt when `config.audit.evidenceTiers.enabled`)**:

```
IMPORTANT — EVIDENCE TIER REQUIREMENT (wogi-audit evidence tiers):

Every finding you return MUST carry two additional fields:

  evidenceTier: integer 0–4
    0 = STATIC      — inferred from source alone (weakest)
    1 = STRUCTURAL  — grepped / globbed / counted instances
    2 = OBSERVATIONAL — ran a tool (lint, typecheck, npm audit) and read output
    3 = INTERACTIVE — executed code/tests and observed behavior
    4 = AUTOMATED   — deterministic check in a quality gate / test suite

  evidenceNote: one-line string citing what produced the evidence
    examples: "grep 'JSON\\.parse' returned 7 matches in src/api/"
              "npm audit reports 3 high-severity CVEs in package X"
              "Agent 1 file scan: 12 files over 300 LOC"

SEVERITY IS CAPPED BY TIER:
  - Tier 0: severity MUST be LOW (and will be flagged UNVERIFIED in the report)
  - Tier 1: severity capped at MEDIUM (unless grep returned >=5 instances, then HIGH allowed)
  - Tier 2+: severity stands as you assign it

Return each finding in this shape:
  {
    "severity": "HIGH|MEDIUM|LOW",
    "description": "...",
    "files": ["..."],
    "evidenceTier": 0|1|2|3|4,
    "evidenceNote": "..."
  }

Also respect the FRAMING ARTIFACT — only report findings within `scopeIn`. Findings in `scopeOut` will be removed by the orchestrator.
```

---

#### Agent 1: Architecture Analyzer

```
Analyze the architecture of this project.

1. Read the project's main entry points and directory structure
2. Check separation of concerns:
   - Are controllers/routes separate from business logic?
   - Are utilities separate from domain code?
   - Is configuration separate from implementation?
3. Find layer violations:
   - UI code calling database directly
   - Route handlers containing business logic (>50 LOC)
   - Utility files importing domain-specific modules
4. Find god files (files with >300 LOC or >10 exported functions)
5. Check for circular dependencies between modules (import cycles)
6. Identify missing abstractions (repeated patterns that could be extracted)
7. **Dead export scan**: For every exported function/component/type, grep for importers.
   Report exports with ZERO importers — these are dead code at the module boundary.
   Count total dead exports and list the top 10 by file.
8. **If React detected** (from Gate 0 framework): Flag components with >5 useState as
   re-render risks, check React.memo usage ratio, identify prop drilling depth >3

Return a structured report with:
- Strengths (good patterns found)
- Opportunities (improvements), each tagged [HIGH/MED/LOW]
- Score: A (excellent) through F (critical issues)
```

#### Agent 2: Dependency Auditor

```
Audit the project's dependencies.

1. Read package.json for all dependencies and devDependencies
2. Run: node node_modules/wogiflow/scripts/flow-audit.js outdated
   → This runs npm outdated and returns structured results
3. Check for:
   - Major version updates available (HIGH priority)
   - Deprecated packages (check npm registry via web search if --skip-web not set)
   - Lighter alternatives (e.g., moment.js → date-fns, lodash → native)
   - Unused dependencies (in package.json but never imported)
   - Missing peer dependencies
4. Check for known security vulnerabilities:
   - Run: node node_modules/wogiflow/scripts/flow-audit.js audit
   → This runs npm audit and returns structured results
5. **Dependency health** (enhanced):
   - Major versions behind: packages that are 2+ majors behind (HIGH)
   - License risk: GPL/AGPL in commercial projects, or UNLICENSED packages
   - Bundle size outliers: dependencies >500KB that could be replaced with lighter alternatives
   - Duplicate packages: same package at multiple versions in the tree

Return:
- Dependencies summary (total, outdated, vulnerable, deprecated, license issues)
- Each finding tagged [HIGH/MED/LOW]
- Score: A through F
```

#### Agent 3: Duplication & Consolidation Scanner

```
Scan for code duplication and consolidation opportunities.

1. Read ALL registry maps:
   - .workflow/state/app-map.md (components)
   - .workflow/state/function-map.md (functions)
   - .workflow/state/api-map.md (APIs)
   - Any other *-map.md files in .workflow/state/
2. Find similar entries that could be merged:
   - Functions with similar names and purposes
   - Components with overlapping functionality
   - API endpoints that share 80%+ logic
3. Search for copy-paste code patterns:
   - Similar function bodies across different files
   - Repeated error handling patterns (>3 occurrences)
   - Utility functions that duplicate native language features
4. Find consolidation opportunities:
   - Similar utility functions in different directories
   - Multiple implementations of the same pattern

Return:
- Duplication findings, each tagged [HIGH/MED/LOW]
- Consolidation recommendations
- Score: A through F
```

#### Agent 4: Performance & Optimization Analyzer

```
Analyze the project for performance issues and optimization opportunities.

1. Search for common performance anti-patterns:
   - Sequential awaits that could be Promise.all (look for: await X; await Y;)
   - N+1 query patterns (loops containing DB/API calls)
   - Large synchronous file operations in request handlers
   - Missing caching on frequently-accessed data
2. Check for bundle size concerns:
   - Large library imports (lodash, moment, etc.)
   - Importing entire libraries when only one function is needed
3. Check for memory leak patterns:
   - Event listeners not cleaned up
   - Growing arrays/maps without bounds
   - Closures holding references to large objects
4. Framework-specific checks:
   - React: unnecessary re-renders, missing useMemo/useCallback
   - Express/Fastify: missing compression, no request timeouts
   - Node.js: sync file operations in async contexts

Return:
- Performance findings, each tagged [HIGH/MED/LOW]
- Score: A through F
```

#### Agent 5: Consistency & Patterns Auditor

```
Audit consistency of patterns across the project.

1. Error handling consistency:
   - How many different error handling patterns exist? (try/catch, .catch(), middleware, etc.)
   - Are errors logged consistently?
   - Is there a standard error format?
2. Logging patterns:
   - Mix of console.log and structured logging?
   - Consistent log levels?
3. Naming convention adherence:
   - File naming: kebab-case throughout?
   - Variable naming: camelCase consistently?
   - Catch block variables: always 'err'?
4. API response format consistency:
   - Do all endpoints return the same shape ({ data } vs { result } vs raw)?
   - Consistent HTTP status codes?
5. Configuration patterns:
   - Are config values accessed consistently?
   - Any hardcoded values that should be configurable?
6. **eslint-disable comment census** (from Gate 0 data):
   - Gate 0 provides the total count and top files
   - Each eslint-disable is a suppressed violation — a high count (>50) indicates
     hidden technical debt through suppression
   - Flag files with >5 eslint-disable comments as consistency violations
7. **Lint config integrity** (from Gate 0 data):
   - If Gate 0 detected downgraded rules, include them as [HIGH] consistency findings
   - This is "configuration-level debt masking" — making the project appear clean
     by lowering standards instead of fixing code

Return:
- Consistency findings, each tagged [HIGH/MED/LOW]
- Dominant patterns vs outliers
- eslint-disable count and top offenders
- Score: A through F
```

#### Agent 6: Modernization & Alternatives Scout

```
Scout for modernization opportunities in this project.

1. Check for outdated patterns:
   - var usage (should be const/let)
   - Callback-based code (could be async/await)
   - Manual null checks (could use optional chaining ?.)
   - Verbose conditionals (could use nullish coalescing ??)
2. Check framework best practices (if --skip-web not set):
   - Web search for "[framework] best practices 2026"
   - Compare current patterns against recommended approaches
3. Check for newer library alternatives:
   - Web search for lightweight alternatives to heavy dependencies
4. Look for simplification opportunities:
   - Complex logic that could use modern language features
   - Manual implementations of things available in the standard library
   - Overly defensive code that could trust framework guarantees

Return:
- Modernization opportunities, each tagged [HIGH/MED/LOW]
- Score: A through F
```

#### Agent 7: Tech Debt Cataloger

```
Catalog technical debt in this project.

1. Find all TODO, FIXME, HACK, WORKAROUND, TEMPORARY comments:
   - Run: node node_modules/wogiflow/scripts/flow-audit.js todos
   → Returns structured list of all TODO/FIXME/HACK comments with file:line
2. Find commented-out code blocks (>3 consecutive commented lines)
3. Find functions with high complexity:
   - Deep nesting (>4 levels)
   - Many branches (>8 if/else chains)
   - Long functions (>100 LOC)
4. Find dead code:
   - Unused exports (exported but never imported elsewhere)
   - Unreachable branches
5. Cross-reference with existing tech debt:
   - Read .workflow/state/tech-debt.json if it exists
   - Identify new debt vs already-tracked debt
6. **Test coverage reality check** (from Gate 0 data):
   - Test file ratio: N test files / M source files (ideal: >30%)
   - If coverage report is available: line/branch coverage %
   - 0% test coverage + complex business logic = [HIGH] tech debt
7. **Git health indicators** (from Gate 0 data):
   - Commit frequency: active/inactive
   - Stale branches (unmerged >30 days)
   - Commit message quality (conventional commits?)
   - Large uncommitted changes count
8. **Environment/config hygiene** (from Gate 0 data):
   - .env.example missing when .env exists
   - No CI configuration = no automated quality enforcement
   - Secrets patterns in tracked files

Return:
- Tech debt items, each tagged [HIGH/MED/LOW]
- Summary: TODOs count, FIXMEs count, HACKs count
- Commented-out code blocks count
- Test coverage metrics
- Git health summary
- Score: A through F
```

#### Agent 8: Schema Drift Auditor

```
Audit schema drift across the entire project.

1. Identify all schema source-of-truth files:
   - Read schema-map.md and schema-index.json for registered schemas
   - Scan for convention files: *.prisma, *.entity.ts, *.model.ts, *.schema.ts
2. For each schema file, extract all defined field names
3. For each field, grep the codebase for references outside the schema file
4. Cross-reference: are there field names in consumer code that do NOT exist
   in the current schema? (stale references from past changes)
5. Check for inconsistencies:
   - Field name in consumer doesn't match schema casing
   - Optional field accessed without null check in consumer
   - Field used in tests but removed from schema
6. Run automated detection:
   node scripts/flow-schema-drift.js

Return:
- Orphaned field references (field in consumer, not in schema)
- Casing mismatches
- Coverage: % of schema fields actually used by consumers
- Score: A through F
```

### Step 3: Consolidate Results + Apply Score Cap

After all agents complete, consolidate into a single report.

**3.1. Calculate weighted agent score:**
```bash
node node_modules/wogiflow/scripts/flow-audit.js score '{"architecture":"B+","dependencies":"A-",...}'
```

**3.2. Apply Gate 0 score cap:**
```
Final score = min(gate0_cap, weighted_agent_score - gate0_penalties)
```

| Gate 0 Result | Score Cap |
|--------------|-----------|
| Build fails | max D (63) |
| Typecheck >500 errors | max D+ (67) |
| Typecheck >100 errors | max C (73) |
| Typecheck >50 errors | max C+ (77) |
| Lint >50 errors | max C (73) |
| Lint config manipulation | -3 pts per downgraded rule (max -15) |

**Example**: Agents score B (83), but build fails → capped at D (63). Agents score B+ (87), but lint config has 4 downgraded rules → 87 - 12 = 75 → C+.

**3.3. Include extended metrics in the report:**
- eslint-disable comment count (from Gate 0)
- Dead export count (from agent scan)
- Test file ratio (from Gate 0)
- Git health indicators (from Gate 0)

**3.4. Trend delta (if previous audit exists):**
Compare current metrics with `last-audit.json`. Show improvement/regression arrows.

### Step 3.5: Adversary Critique Pass (MANDATORY when `config.audit.adversaryPass.enabled`, default ON)

**Problem this solves**: Agent findings are the single most important output of an audit, and they're also the most likely to contain false positives ("this is HIGH") and false negatives (missing real issues) when no one challenges them. Without an adversary, the audit report rubber-stamps whatever the agents produced.

**This is the audit analogue of the IGR Logic Adversary pass** (wf-3975a001). Same pattern: different model, separate context, looking for specific defect classes.

**Procedure**:
1. Collect: the framing artifact + ALL agent findings (with evidence tiers) + the consolidated score.
2. Launch ONE Agent sub-agent with `subagent_type=Explore` (READ-ONLY), `model=<config.audit.adversaryPass.adversaryModel>` (default `opus` when main audit ran on Sonnet; `sonnet` when audit ran on Opus — must be DIFFERENT from the agent model).
3. Prompt structure:
   ```
   You are the Audit Adversary. Critique the audit report below.

   FRAMING: [framing artifact]
   FINDINGS: [all findings from 7+ agents, each with evidenceTier]
   SCORE: [consolidated score + cap]

   Your job — produce a JSON object with these fields:

   {
     "falsePositives": [
       { "findingId": "...", "reason": "why this isn't actually HIGH/a real issue",
         "evidenceContradicting": "file:line or command that refutes it" }
     ],
     "missedIssues": [
       { "category": "<dimension>", "issue": "...", "whyMissed": "why the scan likely skipped it",
         "evidenceFor": "file:line or pattern" }
     ],
     "severityAdjustments": [
       { "findingId": "...", "from": "HIGH", "to": "MEDIUM",
         "reason": "Tier 0 evidence cannot support HIGH" }
     ],
     "scopeDrift": [
       { "findingId": "...", "reason": "out of declared scopeIn per framing" }
     ],
     "frameAssumptionChallenges": [
       { "assumption": "...from framing", "challenge": "why it may not hold" }
     ],
     "overallVerdict": "ACCEPT | ACCEPT_WITH_ADJUSTMENTS | REVISE_SCORE | REVISE_SCOPE"
   }

   Ground every item in a file path, a line number, a grep pattern, a tool output, or a test ID.
   Do NOT invent issues. "I think" / "might" / "could" are FORBIDDEN — require evidence.
   ```
4. Parse the adversary response. If parse fails, log a warning and continue with unmodified findings.
5. **Apply automatic adjustments**:
   - Each `severityAdjustments` item rewrites the finding's severity in the consolidated report (and marks it `[ADVERSARY-ADJUSTED]`).
   - Each `scopeDrift` item moves the finding out of the main report into an "Out-of-Scope Findings" appendix (not dropped — the user still sees them).
   - `falsePositives` get marked `[DISPUTED]` in the report body (not removed — the user sees both the finding and the dispute).
   - `missedIssues` get appended as new Tier-0 findings labeled `[ADVERSARY-FOUND]` — the user can escalate them with follow-up.
6. **Recompute the score** if `overallVerdict` is `REVISE_SCORE` (e.g., false-positive removal can lift a score by one tier).
7. **Archive the adversary run** to `.workflow/state/adversary-runs/audit-{timestamp}.json` — same directory as IGR adversary runs. This feeds the `flow promote` promotion pipeline (wf-6a352aae) — recurring audit-adversary findings graduate to feedback-patterns.md.
8. **Display a summary block** in the final report:
   ```
   ━━━ ADVERSARY CRITIQUE (different model) ━━━
     Verdict:              [ACCEPT | ACCEPT_WITH_ADJUSTMENTS | REVISE_SCORE | REVISE_SCOPE]
     False positives:      N  (marked [DISPUTED] in findings)
     Severity adjustments: N  (marked [ADVERSARY-ADJUSTED])
     Missed issues found:  N  (appended as [ADVERSARY-FOUND] Tier-0 findings)
     Scope drift:          N  (moved to Out-of-Scope appendix)

     [For each item, show one line with the finding ID + reason]
   ```

**One pass only** — no iteration loop. This is analysis, not implementation. If the adversary finds a serious issue, the user calls it out and we re-audit with adjusted scope.

Config toggles: `audit.adversaryPass.enabled` (default true), `audit.adversaryPass.adversaryModel` (default `sonnet` — different from the agent model used), `audit.adversaryPass.applySeverityAdjustments` (default true), `audit.adversaryPass.applyScopeDrift` (default true).

### Step 4: Pattern Promotion Analysis (MANDATORY)

_Moved from former "Step 4.5" — pattern promotion must run BEFORE Display Report so the report includes promotion outcomes. Phase-table (L43-56) now matches step numbering. Adversary caught this mismatch 2026-04-15 during audit of epic-episodic-memory; see `.workflow/state/adversary-runs/audit-2026-04-15-epic-episodic-memory.json`._

After the adversary pass consolidates findings, run pattern promotion BEFORE displaying the final report. This ensures promotion outcomes (enforcement gaps, newly promoted rules, recurring patterns) are visible in the report itself. This step has 3 phases.

### Step 5: Display Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT AUDIT REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Project: [name] | Files scanned: N | Date: YYYY-MM-DD

GATE 0 BASELINE:
  Build: ✓/✗ | Typecheck: N errors | Lint: N errors, M warnings
  Score cap: [GRADE] | Penalties: -N pts | Framework: [detected]

HEALTH SCORE: [A/B/C/D/F] (capped by Gate 0 from agent score of [X])

━━━ ARCHITECTURE (score: X) ━━━
  Strengths:
  - [good patterns found]

  Opportunities:
  [HIGH] [description]
  [MED]  [description]
  [LOW]  [description]

━━━ DEPENDENCIES (score: X) ━━━
  [findings...]

━━━ DUPLICATION (score: X) ━━━
  [findings...]

━━━ PERFORMANCE (score: X) ━━━
  [findings...]

━━━ CONSISTENCY (score: X) ━━━
  [findings...]

━━━ MODERNIZATION (score: X) ━━━
  [findings...]

━━━ TECH DEBT (score: X) ━━━
  TODOs: N | FIXMEs: N | HACKs: N
  [findings...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY: N opportunities found
  High: N | Medium: N | Low: N

Top 5 Quick Wins (highest impact, lowest effort):
  1. [description]
  2. [description]
  3. [description]
  4. [description]
  5. [description]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Phase 1: AI Semantic Clustering

Launch a single Agent (`subagent_type=Explore`, `model="sonnet"`) with ALL findings from the 7 audit agents:

```
You are a pattern clustering judge. You receive findings from 7 audit agents.
Your job is to semantically group findings that describe the SAME underlying issue.

IMPORTANT: This is semantic matching, not string matching.
"Missing try-catch", "no error handling", and "unprotected JSON.parse" are the SAME pattern.
"Inconsistent naming" and "mixed camelCase and snake_case" are the SAME pattern.

For the findings below, produce a JSON array of clusters:

[findings from all 7 agents pasted here]

Output format (ONLY output valid JSON, no markdown):
[
  {
    "patternId": "kebab-case-id",
    "category": "architecture|code-style|security|performance|consistency|dependencies|tech-debt",
    "description": "One sentence describing the underlying issue",
    "severity": "HIGH|MEDIUM|LOW",
    "isSystemic": true/false (true if 5+ files affected),
    "instanceCount": N,
    "instances": [{"file": "path", "detail": "brief description"}]
  }
]

Rules:
- Merge findings that describe the same root cause, even if different agents worded them differently
- patternId must be stable: same issue should produce the same ID across audits
- severity: HIGH if 5+ files, MEDIUM if 3-4, LOW if 1-2
- Do NOT create a cluster for single-file, one-off issues — only patterns (2+ instances)
- Maximum 20 clusters (if more, merge the most similar)
```

Parse the AI output as JSON. If parsing fails, log a warning and skip to Step 5.

#### Phase 2: Cross-Reference & Promotion

Run the promote command with the clustered findings:

```bash
node node_modules/wogiflow/scripts/flow-audit.js promote '<clusters-json>'
```

This automatically:
1. Checks each pattern against `decisions.md` — marks `ENFORCEMENT_GAP` if a rule already exists
2. Records/increments patterns in `feedback-patterns.md`
3. Auto-promotes to `decisions.md` when count reaches threshold (default: 3)
4. Detects `RECURRING` patterns by comparing with `last-audit.json`

Display the promotion summary in the report:

```
━━━ PATTERN PROMOTION ━━━
  Patterns found: N
  - Promoted to rules:    N (auto-promoted to decisions.md)
  - Tracking:             N (count below threshold)
  - Enforcement gaps:     N (rule exists, still violated!)
  - New patterns:         N (first occurrence)
  - Recurring:            N (seen in previous audit)

  [For each ENFORCEMENT_GAP]:
  ⚠ ENFORCEMENT GAP: "pattern description"
    Rule in: ## Section > ### Rule Name
    Still violated in N files

  [For each PROMOTED]:
  ✓ PROMOTED: "pattern description" (N occurrences → decisions.md)

  [For each SYSTEMIC (5+ files)]:
  ! SYSTEMIC: "pattern description" (N files affected)
    Consider creating an immediate rule
```

#### Phase 3: Enforcement Gap Investigation (on demand)

This phase runs ONLY if enforcement gaps were found AND the user selects it from post-audit actions.

For each `ENFORCEMENT_GAP` pattern, launch an Agent (`subagent_type=Explore`, `model="sonnet"`):

```
You are investigating why a rule in decisions.md is still being violated.

THE RULE (from decisions.md):
[insert ruleText from promotion results]

THE VIOLATIONS (files still violating this rule):
[insert instances array from cluster]

Investigate WHY this rule was violated. Check:
1. Is the rule too vague? Does it say WHAT to do but not HOW?
2. Is the rule too long or buried in a large section? Key constraint might be lost in noise.
3. Is the rule outdated? Does it reference patterns/APIs that have changed?
4. Is the rule in the wrong section? Might be overlooked if categorized poorly.
5. Does the rule have programmatic enforcement? Or is it text-only with no automated checks?
6. Does the rule conflict with another rule or common practice in the codebase?
7. Does the code predate the rule? (Check git blame dates vs rule creation date if available)

Output format (ONLY output valid JSON):
{
  "rootCause": "TOO_VAGUE|TOO_LONG|OUTDATED|WRONG_SCOPE|NO_ENFORCEMENT|CONTRADICTORY|PRE_EXISTING",
  "explanation": "2-3 sentences explaining what's wrong",
  "recommendation": "REWRITE|SPLIT|ADD_TO_STANDARDS_GATE|BACKFILL|NO_ACTION",
  "suggestedFix": "If REWRITE or SPLIT: the improved rule text. If ADD_TO_STANDARDS_GATE: the pattern to add. If BACKFILL: description of cleanup needed."
}
```

Display investigation results:

```
━━━ ENFORCEMENT GAP INVESTIGATION ━━━
  [For each gap]:
  Pattern: "description"
  Root cause: TOO_VAGUE — "The rule says to handle errors but doesn't specify the pattern"
  Recommendation: REWRITE
  Suggested fix: [improved rule text]

  Actions available:
  - Apply suggested rewrites to decisions.md
  - Create backfill cleanup tasks in ready.json
  - Add patterns to standards gate for programmatic enforcement
```

### Step 6: Post-Audit Actions

After displaying the report and promotion summary, offer these options using AskUserQuestion:

1. **Create tasks** — Convert high-priority findings to stories/tasks in ready.json
2. **Add to tech debt** — Add findings to `.workflow/state/tech-debt.json` via `/wogi-debt`
3. **Save report** — Persist to `.workflow/audits/YYYY-MM-DD-audit.md`
4. **Create rules** — Manually promote specific patterns via `/wogi-decide`
5. **Investigate enforcement gaps** — Run Phase 3 investigation for all `ENFORCEMENT_GAP` patterns
6. **Apply all promotions** — Batch-confirm all auto-promoted rules (already written by Phase 2)

### Step 7: Persist Report

Regardless of user choice, always save the audit results to `.workflow/state/last-audit.json`. Include the new framing + adversary sections when those passes ran:

```json
{
  "framing": {
    "interpretation": "...",
    "scopeIn": [...],
    "scopeOut": [...],
    "assumptions": [...],
    "dimensionWeights": {...},
    "artifactPath": ".workflow/state/audit-framing/<timestamp>.md"
  },
  "adversary": {
    "ran": true,
    "overallVerdict": "ACCEPT_WITH_ADJUSTMENTS",
    "falsePositives": N,
    "severityAdjustments": N,
    "missedIssues": N,
    "scopeDrift": N,
    "archivePath": ".workflow/state/adversary-runs/audit-<timestamp>.json"
  },
  ...
}
```

Full persisted shape:

```json
{
  "date": "YYYY-MM-DD",
  "overallScore": "B+",
  "gate0": {
    "buildPasses": true,
    "typecheckErrors": 0,
    "lintErrors": 0,
    "lintWarnings": 12,
    "downgradedRules": [],
    "testsPassing": true,
    "missingScripts": [],
    "eslintDisableCount": 23,
    "scoreCap": 100,
    "penalties": 0,
    "framework": { "name": "react", "version": "18.2.0" },
    "gitHealth": { "recentCommits": 45, "staleBranches": 2, "conventionalCommits": true },
    "envHygiene": { "envExample": true, "ciConfigured": true },
    "testCoverage": { "testFiles": 34, "sourceFiles": 120, "ratio": "28.3%" }
  },
  "agentScore": "B+",
  "scoreCappedBy": null,
  "scores": {
    "architecture": "B+",
    "dependencies": "A-",
    "duplication": "C+",
    "performance": "B",
    "consistency": "B-",
    "modernization": "B+",
    "techDebt": "B"
  },
  "findings": {
    "total": 45,
    "high": 8,
    "medium": 18,
    "low": 19
  },
  "topFindings": [...],
  "patterns": [
    {
      "patternId": "missing-error-handling",
      "category": "security",
      "description": "Functions missing try-catch around I/O operations",
      "instanceCount": 7,
      "severity": "HIGH",
      "status": "ENFORCEMENT_GAP",
      "count": 5,
      "isSystemic": true
    }
  ],
  "enforcementGaps": [
    {
      "patternId": "json-parse-safety",
      "ruleLocation": "## Coding Standards",
      "rootCause": "TOO_VAGUE",
      "recommendation": "REWRITE",
      "suggestedFix": "..."
    }
  ],
  "promotions": {
    "promoted": 2,
    "tracking": 5,
    "gaps": 1,
    "new": 3,
    "recurring": 4
  }
}
```

## Configuration

Controlled by `config.audit`:

```json
{
  "audit": {
    "agents": {
      "architecture": true,
      "dependencies": true,
      "duplication": true,
      "performance": true,
      "consistency": true,
      "modernization": true,
      "techDebt": true
    },
    "scoring": {
      "enabled": true,
      "weights": {
        "architecture": 0.25,
        "dependencies": 0.15,
        "duplication": 0.15,
        "performance": 0.15,
        "consistency": 0.10,
        "modernization": 0.10,
        "techDebt": 0.10
      }
    },
    "exclude": ["node_modules", ".workflow/state", "dist", "build"],
    "maxFilesPerAgent": 100
  }
}
```
