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
| Phase | phaseNum | Description |
|-------|----------|-------------|
| 1 | Gather Files | Scan project files |
| 2 | Agents | 7 parallel agents (sub-steps = agents) |
| 3 | Consolidate | Score calculation |
| 4 | Pattern Promotion | AI clustering + cross-reference + gaps |
| 5 | Report | Display formatted report |
| 6 | Persist | Save to last-audit.json |

**Display at each agent completion:**
```
━━━ PROGRESS: [████░░░░░░] 35% Step 2: Audit Agents ━━━
  Agent 5/7 complete (Architecture, Dependencies, Duplication, Performance, Consistency done)
```

On audit completion, clear progress: `node node_modules/wogiflow/scripts/flow-progress-tracker.js clear`

## How It Works

### Step 1: Gather Project Files

```bash
node node_modules/wogiflow/scripts/flow-audit.js files
```

This returns all tracked project files (excluding node_modules, dist, .workflow/state/, etc.). Use this as the base file set for all agents.

### Step 2: Launch 7 Parallel Agents

Launch ALL enabled agents as parallel `Task` calls in a single message. Each agent uses `subagent_type=Explore` and `model="sonnet"` (per decisions.md: use Sonnet for routine exploration).

**Agent configuration** is in `config.audit.agents` — skip any agent set to `false`.

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
5. Check for circular dependencies between modules
6. Identify missing abstractions (repeated patterns that could be extracted)

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

Return:
- Dependencies summary (total, outdated, vulnerable)
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

Return:
- Consistency findings, each tagged [HIGH/MED/LOW]
- Dominant patterns vs outliers
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

Return:
- Tech debt items, each tagged [HIGH/MED/LOW]
- Summary: TODOs count, FIXMEs count, HACKs count
- Commented-out code blocks count
- Score: A through F
```

### Step 3: Consolidate Results

After all agents complete, consolidate into a single report.

**Use `node node_modules/wogiflow/scripts/flow-audit.js score` with the agent scores to calculate a weighted overall score.**

### Step 4: Display Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT AUDIT REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Project: [name] | Files scanned: N | Date: YYYY-MM-DD

HEALTH SCORE: [A/B/C/D/F] (weighted across all dimensions)

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

### Step 4.5: Pattern Promotion Analysis (MANDATORY)

After displaying the report, run pattern promotion analysis **before** offering post-audit actions. This step has 3 phases.

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

### Step 5: Post-Audit Actions

After displaying the report and promotion summary, offer these options using AskUserQuestion:

1. **Create tasks** — Convert high-priority findings to stories/tasks in ready.json
2. **Add to tech debt** — Add findings to `.workflow/state/tech-debt.json` via `/wogi-debt`
3. **Save report** — Persist to `.workflow/audits/YYYY-MM-DD-audit.md`
4. **Create rules** — Manually promote specific patterns via `/wogi-decide`
5. **Investigate enforcement gaps** — Run Phase 3 investigation for all `ENFORCEMENT_GAP` patterns
6. **Apply all promotions** — Batch-confirm all auto-promoted rules (already written by Phase 2)

### Step 6: Persist Report

Regardless of user choice, always save the audit results to `.workflow/state/last-audit.json`:

```json
{
  "date": "YYYY-MM-DD",
  "overallScore": "B+",
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
