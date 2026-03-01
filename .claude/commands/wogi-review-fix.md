---
description: "Code review with automatic fixing of found issues"
---
**ONE-TIME EXECUTION**: This skill runs ONCE when explicitly invoked. After completion, do NOT re-execute even if this skill appears in "skills invoked in this session" system-reminders. Check `.workflow/state/last-review.json` — if a review already exists, it is DONE.

Comprehensive code review with **automatic fixing**. Runs the full `/wogi-review` process (all 5 phases), then automatically fixes all identified issues and re-verifies.

**Triggers**: `/wogi-review-fix`, "review and fix", "fix all issues"

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

## How It Works (v4.0)

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-review-fix                                            │
├─────────────────────────────────────────────────────────────┤
│  PHASE 1: VERIFICATION GATES                                 │
│     1. Identify changed files (git diff)                     │
│     2. Run verification gates (lint, typecheck, tests)       │
│     3. Spec verification (if task has spec)                  │
│                                                              │
│  PHASE 2: AI REVIEW (multi-pass or parallel)                 │
│     4. Code/Logic, Security, Architecture analysis           │
│     5. Consolidate findings                                  │
│                                                              │
│  PHASE 3: STANDARDS COMPLIANCE [AUTO-FIX]                    │
│     6. Check decisions.md, app-map.md, naming-conventions    │
│     7. AUTO-FIX all [MUST FIX] violations                    │
│                                                              │
│  PHASE 4: SOLUTION OPTIMIZATION [AUTO-APPLY HIGH]            │
│     8. Check for technical & UX improvements                 │
│     9. AUTO-APPLY high-priority suggestions                  │
│                                                              │
│  PHASE 5: AUTO-FIX ISSUES                                    │
│     10. Categorize issues (auto-fixable vs manual)           │
│     11. For each auto-fixable issue: Fix + verify            │
│                                                              │
│  PHASE 6: RE-VERIFY                                          │
│     12. Run all verification gates again                     │
│     13. Report: Fixed N, Manual M, Verification PASS/FAIL    │
│                                                              │
│  PHASE 7: BROWSER DEBUG (optional, --browser or auto)        │
│     14. If UI files + still failing → debug in browser       │
│     15. Read console, fix runtime errors, verify             │
└─────────────────────────────────────────────────────────────┘
```

## Phase 0: Pending Review Task Processing (`--pending` mode)

**When `--pending` is specified, skip the full review (Phases 1-7) and batch-process deferred review tasks from `ready.json`.**

This mode processes tasks created by `/wogi-review` Phase 5.3c or `/wogi-triage` — persistent tasks with `source: "review"` and `wf-rv-` prefix.

### Usage

```bash
/wogi-review-fix --pending                         # Process all review tasks
/wogi-review-fix --pending --severity high         # Only high+ severity
/wogi-review-fix --pending --file src/api.ts       # Only tasks for specific file
```

### Execution Steps

**0.1. Load pending review tasks**:
- Read `ready.json`
- Filter tasks where `source === "review"` (these have `wf-rv-` prefix)
- Apply filters if provided:
  - `--severity high`: Only P0 (critical) and P1 (high) tasks
  - `--file <path>`: Only tasks where `finding.file` matches the path

**0.2. Group into batches** (read `config.reviewFix.batchExecution`):
- Group by `finding.file`, then by `finding.category`
- Sort batches by priority (P0 first)

**0.3. Display batch plan**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PENDING REVIEW TASKS (N items in M batches)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Batch 1 | File: src/api.ts | Category: security (3 findings)
  P0: SQL injection in user query
  P1: Missing auth check
  P2: Raw JSON.parse without try-catch

Batch 2 | File: src/utils.ts | Category: code-logic (2 findings)
  P2: Sequential awaits could use Promise.all
  P3: Unused import

Options:
  [1] Process all batches now
  [2] Process critical/high batches only
  [3] Select specific batches
  [4] Cancel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Context-Aware Orchestrated Mode (MANDATORY for 10+ findings)

**When `config.reviewFix.contextBudget.enabled` is true AND there are 10+ findings to process, the review-fix flow MUST use sub-agent orchestration instead of processing all findings in the main conversation.**

This prevents the "Conversation too long" compaction failure that occurs when processing many findings sequentially in one context.

**How it works:**

1. **Budget calculation**: Run the context budget estimator to split findings into dynamic batches:
   ```
   The batch size is NOT hardcoded. It is calculated from:
   - Each finding's severity (critical=5%, high=4%, medium=3%, low=2% of context)
   - Whether the finding is autoFixable (0.6x multiplier — simpler)
   - Whether the finding involves cross-file changes (1.3x multiplier — harder)
   - Available sub-agent context budget (default: 70% of fresh context)
   - Compaction buffer reserve (default: 15%)
   - Orchestrator overhead (default: 10%)
   ```

2. **Display the budget plan**:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📊 CONTEXT BUDGET PLAN
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Total findings: 39
   Batches needed: 4 (dynamic — based on finding complexity)
   Strategy: Sub-agent per batch (fresh context each)

   Batch 1: 12 findings (3 critical, 4 high, 5 medium) — est. 42% context
   Batch 2: 11 findings (2 high, 6 medium, 3 low) — est. 35% context
   Batch 3: 10 findings (4 medium, 6 low) — est. 28% context
   Batch 4: 6 findings (2 medium, 4 low) — est. 16% context

   Each batch runs in a fresh sub-agent context.
   Progress is saved between batches.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

3. **Execute batches via sub-agents**: For each batch, spawn a `Task` agent with `subagent_type=Bash` or `subagent_type=general-purpose` that:
   - Receives ONLY the findings for this batch (not all 39)
   - Receives the file paths and recommendations
   - Processes each finding: read file → apply fix → verify (node --check / lint)
   - Returns a structured result: which findings were fixed, which failed, any notes
   - The sub-agent has a **completely fresh context** — no accumulation from previous batches

4. **Track progress** between batches:
   - After each batch completes, save progress to `config.reviewFix.contextBudget.progressFile` (default: `.workflow/state/review-fix-progress.json`):
     ```json
     {
       "reviewDate": "2026-02-26T...",
       "taskId": "wf-cr-t3rv01",
       "totalFindings": 39,
       "processedIds": ["i-001", "sec-004", ...],
       "failedIds": ["l-012"],
       "currentBatch": 2,
       "totalBatches": 4,
       "startedAt": "...",
       "lastBatchAt": "..."
     }
     ```
   - This file survives compaction. If the orchestrator itself needs to compact, it can resume from this checkpoint.

5. **Orchestrator stays lean**: The main conversation only:
   - Calculates the budget plan
   - Spawns sub-agents for each batch
   - Collects results
   - Updates the progress file
   - Runs final verification across all modified files
   - Commits

6. **After all batches complete**:
   - Display consolidated summary
   - Run final verification (lint, typecheck, tests) across ALL modified files
   - Commit: `fix: N review findings fixed across M batches (wf-XXXXXXXX)`
   - Clean up the progress file

**Resume after interruption**: If a session ends mid-fix (crash, context overflow, user abort):
- On next `/wogi-review-fix --pending` or `/wogi-start wf-XXXXXXXX`, check for progress file
- If progress file exists and has remaining findings:
  ```
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔄 RESUMING REVIEW-FIX SESSION
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Previous session: 15/39 findings processed (batch 2/4)
  Remaining: 24 findings in 2 batches

  Continuing from batch 3...
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ```
- Skip already-processed findings and continue with remaining batches

**Also applies to direct finding processing from `last-review.json`**:
When a task like `wf-cr-XXXXXXXX` is created to fix findings from `last-review.json`, the SAME orchestrated mode applies. Read findings from `last-review.json`, calculate budget, execute in batches.

**Skip condition**: When `contextBudget.enabled` is false OR fewer than 10 findings exist, use the traditional single-context batch execution below.

**Config** (`config.reviewFix.contextBudget`):
```json
{
  "enabled": true,
  "useSubAgents": true,
  "subAgentContextBudget": 0.70,
  "compactionBuffer": 0.15,
  "orchestratorOverhead": 0.10,
  "findingCosts": {
    "critical": 0.05,
    "high": 0.04,
    "medium": 0.03,
    "low": 0.02
  },
  "progressFile": ".workflow/state/review-fix-progress.json"
}
```

---

**0.4. Execute each batch** (traditional mode — used when contextBudget is disabled or < 10 findings):

For each batch:
1. **Create batch task**: Generate `wf-rvb-XXXXXXXX` (8-char hash of batch files + categories). Add to `inProgress` in `ready.json`. This satisfies the task-gate for edits.
2. **Fix each finding** in the batch:
   - Apply severity routing (read `config.reviewFix.severityRouting`):
     - critical/high findings → Full fix loop (read file, apply fix, verify with lint+typecheck+tests)
     - medium/low findings → Light fix loop (apply fix, verify with `node --check` + lint + typecheck)
     - Security findings (`category: "security"`) → Always display to user, even when auto-fixable
   - On success → Remove the individual `wf-rv-` task from `ready` array in `ready.json`
   - On failure → Leave task in `ready` array, add `"fixAttempted": true` to the task, continue to next finding
3. **Complete batch task**: Move `wf-rvb-XXXXXXXX` from `inProgress` to `recentlyCompleted` with `completedAt` timestamp

**0.5. Post-batch verification**:
- Run full verification gates (lint, typecheck, tests) across all modified files
- If new issues found, report them (do NOT auto-create tasks for verification regressions)

**0.6. Commit and summary**:
- Git add modified files and commit: `fix: Batch-fix N review findings (wf-rvb-XXXXXXXX)`
- Display summary:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ BATCH PROCESSING COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Batches processed: M
Findings fixed: X / Y total
Findings remaining: Z (still in ready.json)
Verification: PASSED / FAILED

Run /wogi-ready to see remaining review tasks.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**When `--pending` is NOT specified**, proceed with the normal review+fix flow below.

---

## Phase 1: Verification Gates

Same as `/wogi-review` - run automated tools first:

```bash
# Spec verification (if task has spec)
node scripts/flow-spec-verifier.js verify wf-XXXXXXXX

# Standard verification
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50
```

## Phase 2: AI Review

Same as `/wogi-review` - auto-detects multi-pass vs parallel:

- **Parallel mode**: 3 agents simultaneously (Code/Logic, Security, Architecture)
- **Multi-pass mode**: 4 sequential passes (auto-enabled for 5+ files or security-sensitive)

## Phase 3: Standards Compliance [AUTO-FIX]

Unlike `/wogi-review` which blocks on violations, `/wogi-review-fix` **automatically fixes** them.

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
📋 STANDARDS COMPLIANCE [AUTO-FIX]
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

### Skip Standards Auto-Fix

```bash
/wogi-review-fix --skip-standards
```

---

## Phase 4: Solution Optimization [AUTO-APPLY HIGH]

Unlike `/wogi-review` which only suggests, `/wogi-review-fix` **auto-applies high-priority** improvements.

### What Gets Auto-Applied

| Priority | Category | Auto-Apply? |
|----------|----------|-------------|
| **High** | Missing loading state | ✓ Add loading indicator |
| **High** | Technical error to user | ✓ Replace with friendly message |
| **High** | Empty catch block | ✓ Add proper error handling |
| **Medium** | filter+map chain | ✗ (suggest only) |
| **Medium** | Inline style objects | ✗ (suggest only) |
| **Low** | Micro-optimizations | ✗ (suggest only) |

### Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 SOLUTION OPTIMIZATION [AUTO-APPLY HIGH]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 Applied (High priority):
   ✓ src/Form.tsx:89 - Added loading state to form submission
   ✓ src/api.ts:45 - Replaced technical error with user-friendly message

📋 Suggestions (not applied):
   [Medium] Array.filter().map() could use reduce() - src/utils.ts:12
   [Low] Consider extracting to custom hook - src/Form.tsx:34

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Optimizations: 2 applied, 2 suggested
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Skip Optimization

```bash
/wogi-review-fix --skip-optimization
```

---

## Phase 5: Auto-Fix Issues

Fix all auto-fixable issues from the AI review.

### Auto-Fixable (will be fixed automatically)

| Issue Type | Fix Method |
|------------|------------|
| Unused imports | Remove the import line |
| Console.log in production | Remove or convert to proper logger |
| Missing try-catch (simple) | Wrap operation in try-catch |
| Naming convention violation | Rename file/variable to match convention |
| Missing null check (simple) | Add optional chaining `?.` or guard |
| Dead code / unreachable | Remove the dead code |
| Duplicate code (small) | Extract to shared function |

### Manual (will be listed for user attention)

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

---

## Phase 6: Re-Verification

After all fixes applied:

```bash
# Run verification gates again
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50

# Syntax check all modified files
node --check [modified files]
```

---

## Phase 7: Browser Debugging (Optional)

When `--browser` is specified OR when UI files are changed and issues remain after Phase 6.

### When Browser Debugging Triggers

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
     → Analyze error pattern
     → Apply targeted fix
     → Wait for hot reload (2s)
     → Re-check
  5. If working → Exit with PASS
  6. If max iterations → Exit with issues listed
```

### Requirements

- WebMCP integration: `config.webmcp.enabled: true`
- Dev server running (for hot reload)

---

## Summary Report

```
╔══════════════════════════════════════════════════════════╗
║  Review + Fix Complete                                    ║
╚══════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════
STANDARDS COMPLIANCE
═══════════════════════════════════════════════════════════
✓ 2 violations auto-fixed (naming, security)
✓ All standards now passing

═══════════════════════════════════════════════════════════
SOLUTION OPTIMIZATION
═══════════════════════════════════════════════════════════
✓ 2 high-priority improvements applied
📋 2 suggestions for manual review

═══════════════════════════════════════════════════════════
AI REVIEW ISSUES
═══════════════════════════════════════════════════════════
✓ src/utils.ts:45 - Removed unused import 'lodash'
✓ src/api.ts:23 - Removed console.log
✓ src/api.ts:67 - Added null check
... (8 more)

═══════════════════════════════════════════════════════════
MANUAL ATTENTION NEEDED (3 issues)
═══════════════════════════════════════════════════════════
⚠ src/auth.ts:89 - Potential SQL injection (security)
⚠ src/api.ts:134 - Race condition (logic)
⚠ src/utils.ts:200 - Breaking API change (architecture)

═══════════════════════════════════════════════════════════
BROWSER DEBUG (if enabled)
═══════════════════════════════════════════════════════════
✓ 1 runtime issue fixed via browser debugging

═══════════════════════════════════════════════════════════
RE-VERIFICATION
═══════════════════════════════════════════════════════════
✓ Lint: passed
✓ TypeCheck: passed
✓ Tests: passed
✓ Standards: passed

═══════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════
Total issues found: 20
  Standards violations: 2 (auto-fixed)
  High-priority optimizations: 2 (auto-applied)
  AI review issues: 12 (auto-fixed)
  Browser runtime issues: 1 (auto-fixed)
  Manual review needed: 3 → tasks created

Verification: PASSED

Files modified: 6
  • src/utils.ts (4 fixes)
  • src/api.ts (6 fixes)
  • src/components/Button.tsx (2 fixes)
  • src/components/Form.tsx (3 fixes)
  • src/auth.ts (1 fix)
  • src/components/TaskList.tsx (1 browser fix)

Tasks created for manual items: 3
  • wf-rv-XXXXXXXX: Potential SQL injection (P0)
  • wf-rv-XXXXXXXX: Race condition (P1)
  • wf-rv-XXXXXXXX: Breaking API change (P2)

Run /wogi-review-fix --pending to batch-process deferred items.
```

### Persistent Task Creation for Manual Items

After the "MANUAL ATTENTION NEEDED" section, automatically create persistent tasks for each manual item (findings that could not be auto-fixed). This ensures nothing is silently lost.

For EACH manual finding:

1. **Duplicate check**: Search `ready.json` for existing task with matching `finding.id`. Skip if already exists.
2. **Generate ID**: `wf-rv-XXXXXXXX` (8-char hash of `finding.id` + review date)
3. **Resolve origin task** (when `config.originTaskTracing.traceOrigin` is true):
   - Run `git log --format="%H %s" -1 -- [finding.file]` to find the last commit that touched the file
   - Extract task ID from commit message (pattern: `wf-XXXXXXXX`)
   - Look up the task in `ready.json` → `recentlyCompleted` to get `{ id, title, type, feature }`
   - If no task ID found in commit → set `originTask: null`
4. **Map severity → priority**: critical→P0, high→P1, medium→P2, low→P3
5. **Create task** in `ready.json` `ready` array:
   ```json
   {
     "id": "wf-rv-XXXXXXXX",
     "title": "Review fix: [issue truncated to 80 chars]",
     "type": "fix",
     "feature": "review",
     "source": "review",
     "reviewDate": "[ISO]",
     "originTask": {
       "id": "[origin task ID or null]",
       "title": "[origin task title]",
       "type": "[origin task type]",
       "feature": "[origin task feature]"
     },
     "finding": {
       "id": "[finding.id]",
       "severity": "[finding.severity]",
       "category": "[finding.category]",
       "file": "[finding.file]",
       "line": "[finding.line]",
       "issue": "[finding.issue]",
       "recommendation": "[finding.recommendation]",
       "autoFixable": false
     },
     "status": "ready",
     "priority": "P0-P3",
     "batchable": true,
     "batchKey": "[file]|[category]",
     "createdAt": "[ISO]"
   }
   ```
6. **Update `last-review.json`**: Add `"taskCreated": "wf-rv-XXXXXXXX"` to each finding that got a task.

**Learning signal check**: After all manual tasks are created, run the learning signal detection (same logic as `/wogi-review` Phase 5.3c Step 4). If `config.originTaskTracing.learningSignal.enabled` is true, collect `originTask` references from newly created `wf-rv-` tasks AND existing `wf-rv-` tasks in `ready.json`, group by `originTask.type`/`originTask.feature`, and check if any group has >= threshold instances. If so, add entry to `feedback-patterns.md` and display warning.

---

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be fixed without making changes |
| `--no-verify` | Skip re-verification after fixes |
| `--commits N` | Include last N commits in review scope |
| `--staged` | Only review staged changes |
| `--skip-manual` | Don't show manual issues in report |
| `--skip-standards` | Skip standards compliance auto-fix |
| `--skip-optimization` | Skip solution optimization auto-apply |
| `--browser` | Enable browser debugging for UI runtime issues |
| `--browser-url URL` | Specify URL for browser debugging (default: localhost:3000) |
| `--multipass` | Force multi-pass review mode |
| `--no-multipass` | Disable auto multi-pass detection |
| `--pending` | Skip review, batch-process deferred `wf-rv-` tasks from `ready.json` |
| `--severity <level>` | With `--pending`: filter by severity (critical, high, medium, low) |
| `--file <path>` | With `--pending`: filter by file path |

---

## Dry Run Mode

With `--dry-run`, shows the complete fix plan without applying:

```
═══════════════════════════════════════════════════════════
DRY RUN - FIX PLAN
═══════════════════════════════════════════════════════════

STANDARDS VIOLATIONS (would fix):
• src/utils.ts:45 - Would change catch variable "e" → "err"
• src/api.ts:23 - Would wrap JSON.parse in safeJsonParse

HIGH-PRIORITY OPTIMIZATIONS (would apply):
• src/Form.tsx:89 - Would add loading state
• src/api.ts:45 - Would replace technical error message

AI REVIEW ISSUES (would fix):
• src/utils.ts:45 - Would remove unused import 'lodash'
• src/api.ts:23 - Would remove console.log
...

Run without --dry-run to apply these fixes.
```

---

## Comparison with /wogi-review

| Aspect | `/wogi-review` | `/wogi-review-fix` |
|--------|----------------|-------------------|
| Verification gates | ✓ | ✓ |
| AI review (multi-pass/parallel) | ✓ | ✓ |
| Standards compliance | Blocks on violations | **Auto-fixes** violations |
| Solution optimization | Suggests only | **Auto-applies** high priority |
| AI review issues | Lists issues | **Auto-fixes** where possible |
| Browser debugging | ✗ | ✓ (with --browser) |
| Re-verification | ✗ | ✓ |
| End state | Issues listed | **Issues resolved** |

---

## When to Use

**Use `/wogi-review`** when:
- You want to see issues before deciding to fix
- You're reviewing someone else's code
- You want to understand the codebase state

**Use `/wogi-review-fix`** when:
- You want issues fixed immediately
- You trust the auto-fix for common issues
- You're cleaning up after a large change
- You want a "fix everything" single command

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
