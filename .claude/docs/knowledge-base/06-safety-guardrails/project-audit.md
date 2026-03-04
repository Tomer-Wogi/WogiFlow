# Project Audit

Comprehensive project-wide deep analysis across 7 dimensions.

---

## Purpose

The `/wogi-audit` command performs a holistic project analysis that goes far beyond code review. While `/wogi-review` asks "did I introduce problems?", `/wogi-audit` asks "how can we make this project better?"

Use it when:
- Onboarding to a new project
- Periodically assessing project health
- Planning a refactoring initiative
- Evaluating technical debt before a release

---

## How It Differs from Other Commands

| Aspect | /wogi-health | /wogi-review | /wogi-audit |
|--------|-------------|-------------|-------------|
| Checks | WogiFlow files and config | Code quality in changed files | Entire project holistically |
| Finds | Missing files, broken JSON | Bugs, security, standards violations | Architecture, opportunities, modernization |
| Scope | WogiFlow infrastructure | Git diff (or scoped files) | All project code |
| When | After install or config changes | After coding, before commit | Periodically, or when onboarding |
| Output | Health status (pass/fail) | Findings with fix recommendations | Strategic report with prioritized opportunities |

---

## Configuration

Controlled by the `audit` key in `.workflow/config.json`:

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

Disable any agent by setting it to `false` in `audit.agents`. Adjust scoring weights to reflect your project's priorities.

---

## How It Works

### Two-Layer Architecture

The audit system has two layers:

1. **Runtime script** (`scripts/flow-audit.js`) -- provides helper functions for file scanning, TODO finding, dependency checking, and score calculation.
2. **AI orchestration** (the `/wogi-audit` command) -- launches 7 parallel agents, each analyzing one dimension, then consolidates results.

### The 7 Audit Dimensions

Each dimension is investigated by a separate agent running in parallel:

| Dimension | What It Analyzes |
|-----------|-----------------|
| **Architecture** | Separation of concerns, layer violations, god files, circular dependencies, missing abstractions |
| **Dependencies** | Outdated packages, deprecated libraries, unused dependencies, security vulnerabilities, lighter alternatives |
| **Duplication** | Copy-paste patterns, similar functions, overlapping components, consolidation opportunities |
| **Performance** | Sequential awaits, N+1 queries, sync file operations, memory leak patterns, bundle size concerns |
| **Consistency** | Error handling patterns, logging patterns, naming conventions, API response formats, config access patterns |
| **Modernization** | Outdated syntax (var, callbacks), missing modern features (optional chaining), framework best practices |
| **Tech Debt** | TODO/FIXME/HACK comments, commented-out code, high complexity functions, dead code |

### Execution Flow

1. **Gather files** -- `node scripts/flow-audit.js files` returns all tracked project files (excluding configured exclusions).
2. **Launch agents** -- All enabled agents run in parallel, each analyzing their dimension.
3. **Score** -- Each agent returns a letter grade (A through F) and tagged findings (HIGH/MED/LOW).
4. **Consolidate** -- `node scripts/flow-audit.js score` calculates a weighted overall score.
5. **Report** -- A formatted report is displayed with all findings and a Top 5 Quick Wins list.
6. **Persist** -- Results are saved to `.workflow/state/last-audit.json`.

---

## Commands

```bash
/wogi-audit                    # Full 7-dimension audit
/wogi-audit --skip-deps        # Skip dependency analysis
/wogi-audit --skip-web         # Skip web searches (faster, offline)
/wogi-audit --focus arch       # Focus on architecture only
/wogi-audit --focus perf,debt  # Focus on specific dimensions
```

---

## Output

The audit produces a structured report:

```
PROJECT AUDIT REPORT

Project: [name] | Files scanned: N | Date: YYYY-MM-DD
HEALTH SCORE: [A/B/C/D/F] (weighted across all dimensions)

--- ARCHITECTURE (score: X) ---
  Strengths:
  - [good patterns found]
  Opportunities:
  [HIGH] [description]
  [MED]  [description]

--- DEPENDENCIES (score: X) ---
  [findings...]

... (all 7 dimensions) ...

SUMMARY: N opportunities found
  High: N | Medium: N | Low: N

Top 5 Quick Wins (highest impact, lowest effort):
  1. [description]
  2. [description]
  ...
```

---

## Post-Audit Actions

After the report is displayed, you can:

1. **Create tasks** -- Convert high-priority findings to stories/tasks in `ready.json`
2. **Add to tech debt** -- Add findings to `.workflow/state/tech-debt.json` via `/wogi-debt`
3. **Save report** -- Persist to `.workflow/audits/YYYY-MM-DD-audit.md`
4. **Create rules** -- Promote recurring patterns to `decisions.md` via `/wogi-decide`

---

## Scoring

Each dimension receives a letter grade (A through F). The overall score is a weighted average using the weights defined in `audit.scoring.weights`. Architecture has the highest default weight (0.25), reflecting its outsized impact on project quality.

---

## Best Practices

1. **Run periodically** -- Schedule an audit every few weeks or at sprint boundaries
2. **Focus on high-priority findings** -- Address HIGH items first for maximum impact
3. **Use --focus for targeted analysis** -- When you know the area of concern, narrow the scope
4. **Track trends** -- Compare `last-audit.json` across sessions to measure improvement
5. **Use --skip-web for offline work** -- Modernization and dependency checks can search the web; skip this when offline or for speed

---

## Related

- [Security Scanning](./security-scanning.md) -- Pre-commit vulnerability detection
- [Verification](../02-task-execution/03-verification.md) -- Quality gates for task completion
- [Session Review](../02-task-execution/05-session-review.md) -- Code review of session changes
