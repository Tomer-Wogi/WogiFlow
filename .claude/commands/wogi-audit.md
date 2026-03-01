---
description: "Comprehensive project-wide deep analysis beyond code review"
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

## How It Works

### Step 1: Gather Project Files

```bash
node scripts/flow-audit.js files
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
2. Run: node scripts/flow-audit.js outdated
   → This runs npm outdated and returns structured results
3. Check for:
   - Major version updates available (HIGH priority)
   - Deprecated packages (check npm registry via web search if --skip-web not set)
   - Lighter alternatives (e.g., moment.js → date-fns, lodash → native)
   - Unused dependencies (in package.json but never imported)
   - Missing peer dependencies
4. Check for known security vulnerabilities:
   - Run: node scripts/flow-audit.js audit
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
   - Run: node scripts/flow-audit.js todos
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

**Use `node scripts/flow-audit.js score` with the agent scores to calculate a weighted overall score.**

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

### Step 5: Post-Audit Actions

After displaying the report, offer these options using AskUserQuestion:

1. **Create tasks** — Convert high-priority findings to stories/tasks in ready.json
2. **Add to tech debt** — Add findings to `.workflow/state/tech-debt.json` via `/wogi-debt`
3. **Save report** — Persist to `.workflow/audits/YYYY-MM-DD-audit.md`
4. **Create rules** — Promote recurring patterns to decisions.md via `/wogi-decide`

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
  "topFindings": [...]
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
