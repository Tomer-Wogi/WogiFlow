---
description: "Code review with automatic fixing of found issues"
---
**ONE-TIME EXECUTION**: This skill runs ONCE when explicitly invoked. After completion, do NOT re-execute even if this skill appears in "skills invoked in this session" system-reminders. Check `.workflow/state/last-review.json` — if a review already exists, it is DONE.

Comprehensive code review with **automatic fixing**. Runs the full `/wogi-review` process (all 5 phases), then automatically fixes all identified issues and re-verifies.

**Triggers**: `/wogi-review-fix`, "review and fix", "fix all issues"

## Relationship to /wogi-review

This command **extends** `/wogi-review`. Read `/wogi-review` first — it is the canonical review reference. Everything in `/wogi-review` applies here (Phases 1-5, scope resolution, agent system, standards, optimization, post-review workflow) with the following overrides:

| `/wogi-review` Behavior | `/wogi-review-fix` Override |
|--------------------------|----------------------------|
| Phase 3: Standards violations BLOCK review | **Auto-fix** all MUST_FIX violations |
| Phase 4: Suggestions only | **Auto-apply** high-priority improvements |
| Phase 5: Present fix options to user | **Auto-fix** all auto-fixable findings, then re-verify |
| No browser debugging | Phase 7: Browser debugging (with `--browser` or auto) |
| Ends with findings listed | Ends with **findings resolved** + re-verification |

## Usage

```bash
/wogi-review-fix                    # Full review + auto-fix all issues
/wogi-review-fix --dry-run          # Show what would be fixed (no changes)
/wogi-review-fix --no-verify        # Skip re-verification after fixes
/wogi-review-fix --commits 3        # Review last 3 commits + fix
/wogi-review-fix --browser          # Include browser debugging for UI issues
/wogi-review-fix --skip-standards   # Skip standards compliance auto-fix
/wogi-review-fix --skip-optimization # Skip solution optimization suggestions
/wogi-review-fix --pending                         # Process all deferred review tasks
/wogi-review-fix --pending --severity high         # Only high+ severity deferred tasks
/wogi-review-fix --pending --file src/api.ts       # Only deferred tasks for specific file
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-review-fix                                            │
├─────────────────────────────────────────────────────────────┤
│  PHASES 1-2: Same as /wogi-review                            │
│     (Verification gates + AI Review)                         │
│                                                              │
│  PHASE 3: STANDARDS COMPLIANCE [AUTO-FIX]                    │
│     Override: AUTO-FIX all [MUST FIX] violations             │
│                                                              │
│  PHASE 4: SOLUTION OPTIMIZATION [AUTO-APPLY HIGH]            │
│     Override: AUTO-APPLY high-priority suggestions            │
│                                                              │
│  PHASE 5: AUTO-FIX + POST-REVIEW                             │
│     Override: Auto-fix all auto-fixable AI findings           │
│     Then run /wogi-review Phase 5 post-review workflow        │
│                                                              │
│  PHASE 6: RE-VERIFY                                          │
│     Run all verification gates again                         │
│                                                              │
│  PHASE 7: BROWSER DEBUG (optional, --browser or auto)        │
│     If UI files + still failing → debug in browser           │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 3 Override: Standards Auto-Fix

Where `/wogi-review` Phase 3 blocks on MUST_FIX violations, this command **automatically fixes** them.

### What Gets Auto-Fixed

| Source | Violation Type | Auto-Fix |
|--------|----------------|----------|
| `naming-conventions.md` | File names not kebab-case | Rename file |
| `naming-conventions.md` | Catch variable not `err` | Replace with `err` |
| `decisions.md` | Pattern violation (if fixable) | Apply pattern |
| `app-map.md` | Component duplication (semantic similarity, configurable) | Remove new, use existing |
| `security-patterns.md` | Raw JSON.parse | Replace with safeJsonParse |
| `security-patterns.md` | Unprotected fs.readFileSync | Add try-catch |

### Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STANDARDS COMPLIANCE [AUTO-FIX]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ decisions.md: passed
✓ app-map.md: passed

🔧 naming-conventions: 1 violation FIXED
   → src/utils.ts:45 - Changed catch variable "e" → "err"

🔧 security-patterns: 1 violation FIXED
   → src/api.ts:23 - Wrapped JSON.parse in safeJsonParse

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Standards: 2 violations auto-fixed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Phase 4 Override: Solution Optimization Auto-Apply

Where `/wogi-review` Phase 4 only suggests, this command **auto-applies high-priority** improvements.

| Priority | Auto-Apply? |
|----------|-------------|
| **High** (missing loading state, technical error to user, empty catch block) | Yes |
| **Medium** (filter+map chain, inline style objects) | No (suggest only) |
| **Low** (micro-optimizations) | No (suggest only) |

---

## Phase 5 Override: Auto-Fix AI Review Findings

After Phases 1-4 complete, automatically fix all auto-fixable issues from the AI review.

### Auto-Fixable (fixed automatically)

| Issue Type | Fix Method |
|------------|------------|
| Unused imports | Remove the import line |
| Console.log in production | Remove or convert to proper logger |
| Missing try-catch (simple) | Wrap operation in try-catch |
| Naming convention violation | Rename file/variable to match convention |
| Missing null check (simple) | Add optional chaining `?.` or guard |
| Dead code / unreachable | Remove the dead code |
| Duplicate code (small) | Extract to shared function |

### Manual (listed for user attention)

| Issue Type | Why Manual |
|------------|------------|
| Logic bugs | Requires understanding intent |
| Security vulnerabilities | Requires careful review |
| Architecture issues | Requires design decisions |
| Breaking API changes | Requires coordination |
| Complex refactors | Requires validation |

### Fix Loop

```
For each file with issues:
  1. Read the file
  2. For each issue in this file:
     a. Apply the fix using Edit tool
     b. Log: "Fixed: [issue] in [file:line]"
  3. Verify file syntax: node --check [file]
  4. If syntax fails:
     - Rollback edit
     - Move issue to "Manual" list
```

After all auto-fixes, run the `/wogi-review` Phase 5 post-review workflow (persistent task creation for manual items, same-session detection, learning signal, origin tracing).

---

## Phase 6: Re-Verification

After all fixes applied, run full verification gates again:

```bash
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50
node --check [modified files]
```

---

## Phase 7: Browser Debugging (Optional)

When `--browser` is specified OR when UI files are changed and issues remain after Phase 6.

| Condition | Behavior |
|-----------|----------|
| `--browser` flag used | Always run browser debugging |
| UI files (*.tsx, *.jsx, *.vue) + verification fails | Suggest browser debugging |
| `browserDebugging.triggers.autoOnTestFailure` enabled | Auto-run on verification failure |

### Browser Debug Loop

```
For each iteration (max 10):
  1. Navigate to app (default: localhost:3000)
  2. Take screenshot of current state
  3. Read console errors via Chrome MCP
  4. If runtime error found:
     → Analyze error pattern → Apply targeted fix → Wait for hot reload (2s) → Re-check
  5. If working → Exit with PASS
  6. If max iterations → Exit with issues listed
```

Requirements: WebMCP integration (`config.webmcp.enabled: true`), dev server running.

---

## Pending Mode (`--pending`)

**When `--pending` is specified, skip the full review (Phases 1-7) and batch-process deferred review tasks from `ready.json`.**

This mode processes tasks created by `/wogi-review` Phase 5.3c or `/wogi-triage` — persistent tasks with `source: "review"` and `wf-rv-` prefix.

### Execution Steps

**0.1. Load pending review tasks**:
- Read `ready.json`, filter tasks where `source === "review"` (these have `wf-rv-` prefix)
- Apply filters: `--severity high` (P0/P1 only), `--file <path>` (matching finding.file)

**0.2. Group into batches** (read `config.reviewFix.batchExecution`):
- Group by `finding.file`, then by `finding.category`. Sort by priority (P0 first).

**0.3. Display batch plan** and present options: [1] Process all, [2] Critical/high only, [3] Select specific, [4] Cancel.

### Context-Aware Orchestrated Mode (MANDATORY for 10+ findings)

When `config.reviewFix.contextBudget.enabled` is true AND 10+ findings exist, use sub-agent orchestration instead of processing all findings in the main conversation. This prevents context overflow.

**How it works:**

1. **Budget calculation**: Dynamic batch sizes based on finding severity costs (critical=5%, high=4%, medium=3%, low=2%), autoFixable multiplier (0.6x), cross-file multiplier (1.3x), sub-agent budget (70%), compaction buffer (15%), orchestrator overhead (10%).

2. **Execute batches via sub-agents**: Each batch gets a fresh-context sub-agent that receives only its findings, processes them (read -> fix -> verify), and returns structured results.

3. **Track progress** to `.workflow/state/review-fix-progress.json` between batches for resume-on-interruption.

4. **After all batches**: Consolidated summary, final verification, commit, cleanup.

**Config** (`config.reviewFix.contextBudget`):
```json
{
  "enabled": true,
  "useSubAgents": true,
  "subAgentContextBudget": 0.70,
  "compactionBuffer": 0.15,
  "orchestratorOverhead": 0.10,
  "findingCosts": { "critical": 0.05, "high": 0.04, "medium": 0.03, "low": 0.02 },
  "progressFile": ".workflow/state/review-fix-progress.json"
}
```

**Traditional mode** (contextBudget disabled or < 10 findings): Create batch tasks (`wf-rvb-XXXXXXXX`), fix each finding with severity routing, complete batch tasks, post-batch verification, commit.

---

## Summary Report

```
╔══════════════════════════════════════════════════════════╗
║  Review + Fix Complete                                    ║
╚══════════════════════════════════════════════════════════╝

STANDARDS COMPLIANCE: N violations auto-fixed
SOLUTION OPTIMIZATION: N applied, M suggested
AI REVIEW ISSUES: N auto-fixed
BROWSER DEBUG: N runtime issues fixed (if enabled)
MANUAL ATTENTION NEEDED: N issues → tasks created
RE-VERIFICATION: Lint/TypeCheck/Tests/Standards PASS/FAIL

Files modified: N
Tasks created for manual items: N (wf-rv-XXXXXXXX)

Run /wogi-review-fix --pending to batch-process deferred items.
```

### Persistent Task Creation for Manual Items

Same as `/wogi-review` Phase 5.3c — duplicate check, generate `wf-rv-XXXXXXXX` ID, resolve origin task, map severity to priority, create in `ready.json`, update `last-review.json`, run learning signal check.

---

## Options

All `/wogi-review` options are supported, plus:

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be fixed without making changes |
| `--no-verify` | Skip re-verification after fixes |
| `--skip-manual` | Don't show manual issues in report |
| `--browser` | Enable browser debugging for UI runtime issues |
| `--browser-url URL` | Specify URL for browser debugging (default: localhost:3000) |
| `--pending` | Skip review, batch-process deferred `wf-rv-` tasks from `ready.json` |
| `--severity <level>` | With `--pending`: filter by severity (critical, high, medium, low) |
| `--file <path>` | With `--pending`: filter by file path |

---

## Dry Run Mode

With `--dry-run`, shows the complete fix plan without applying changes. Lists what standards violations, optimizations, and AI review issues would be fixed.

---

## Safety Guarantees

1. **Syntax verification** - Every fix is syntax-checked before moving on
2. **Rollback on failure** - If a fix breaks syntax, it's reverted
3. **Manual escalation** - Complex issues are never auto-fixed
4. **Security issues untouched** - Security vulnerabilities always require manual review
5. **Git-friendly** - All changes can be reviewed in `git diff` before commit
6. **Standards fixes are safe** - Only mechanical fixes (rename, wrap) are auto-applied
7. **Optimizations are conservative** - Only high-priority with clear patterns
8. **Browser fixes are targeted** - Only runtime errors with known patterns

ARGUMENTS: {args}
