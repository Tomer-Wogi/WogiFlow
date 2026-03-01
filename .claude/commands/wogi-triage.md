---
description: "Interactive walkthrough of review findings from last review"
---
Interactive walkthrough of review findings. Loads findings from `.workflow/state/last-review.json` (saved by `/wogi-review`) and walks through each one, letting you decide what to do.

**Triggers**: `/wogi-triage`, "triage findings", "walk through review", "triage review"

## Usage

```bash
/wogi-triage                     # Walk through all findings
/wogi-triage --severity high     # Only high+ severity findings
/wogi-triage --category security # Only security findings
/wogi-triage --agent performance # Only findings from performance agent
/wogi-triage --source review     # Only review-sourced tasks from ready.json
/wogi-triage --batch             # Group findings into batches for faster decisions
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  /wogi-triage                                            │
├─────────────────────────────────────────────────────────┤
│  1. Load findings from .workflow/state/last-review.json   │
│  2. Sort by severity (critical → high → medium → low)    │
│  3. Apply filters (--severity, --category, --agent)      │
│  4. FOR EACH finding:                                    │
│     → Display finding details                            │
│     → Ask user: Fix / Task / Skip / Dismiss              │
│     → Record decision                                    │
│  5. Execute decisions:                                   │
│     → "Fix now" items: fix sequentially                  │
│     → "Create task" items: add to ready.json             │
│     → "Dismiss" items: record in feedback-patterns.md    │
│  6. Display triage summary                               │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

Run `/wogi-review` first. Triage loads findings from the last review's `last-review.json`.

If no findings file exists or it was deleted:
```
No review findings found. Run /wogi-review first to generate findings.
```

**Error handling**: If the file is missing, corrupted, or empty, display the message above and exit gracefully. Do not attempt to triage without a valid findings file.

If findings are already triaged (`"triaged": true`):
```
These findings have already been triaged. Run /wogi-review again to generate new findings,
or use /wogi-triage --force to re-triage existing findings.
```

## Finding Walkthrough

For each finding, display and ask the user to decide:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Finding 3 of 12 | Severity: HIGH | Category: Security
Agent: security
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: src/api.ts:45
Issue: Raw JSON.parse without try-catch
Recommendation: Use safeJsonParse from scripts/flow-utils.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use `AskUserQuestion` to present options for each finding:

```
What would you like to do with this finding?
  [1] Fix now — apply the fix immediately after triage completes
  [2] Create task — add to ready.json for later
  [3] Skip — not relevant right now (no action taken)
  [4] Dismiss — not a real issue (teaches the learning system)
```

### Decision Actions

| Decision | What Happens |
|----------|-------------|
| **Fix now** | Added to fix queue; executed sequentially after triage loop completes |
| **Create task** | Creates a task in `ready.json` with finding details as description |
| **Skip** | No action taken; finding stays in `last-review.json` for next triage |
| **Dismiss** | Recorded in `feedback-patterns.md` as a false positive; teaches the system to de-prioritize similar findings |

## Fix Execution

After the triage loop completes, execute "Fix now" items sequentially.

**If the fix queue is empty** (no findings marked "Fix now"), skip task creation entirely and proceed directly to the Triage Summary.

**MANDATORY: Create a tracked task before applying any fixes.** This ensures the PreToolUse task-gate allows Edit/Write operations:

1. Generate task ID: Call `generateTaskId('Fix N triage findings')` from `scripts/flow-utils.js` to produce a valid `wf-XXXXXXXX` ID.
2. Add to `ready.json` inProgress:
   ```json
   {
     "id": "[from generateTaskId()]",
     "title": "Fix N triage findings",
     "type": "fix",
     "feature": "triage",
     "status": "in_progress",
     "priority": "P1",
     "createdAt": "[ISO timestamp]",
     "startedAt": "[ISO timestamp]"
   }
   ```
3. Only after the task exists in inProgress, proceed with fixes below.
4. After all fixes complete, move the task to recentlyCompleted.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 EXECUTING FIXES (4 items)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/4] Fixing: Raw JSON.parse in src/api.ts:45
  → Replacing JSON.parse with safeJsonParse
  → Validating... ✓ lint passed, ✓ typecheck passed

[2/4] Fixing: Missing null check in src/utils.ts:23
  → Adding optional chaining
  → Validating... ✓ lint passed, ✓ typecheck passed

[3/4] Fixing: Sequential awaits in src/service.ts:67
  → Refactoring to Promise.all
  → Validating... ✓ lint passed, ✓ typecheck passed

[4/4] Fixing: Unused import in src/helpers.ts:1
  → Removing unused import
  → Validating... ✓ lint passed, ✓ typecheck passed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ All 4 fixes applied and validated
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Task Creation

For "Create task" items, create entries in `ready.json` using the `wf-rv-` prefix (matching the format from `/wogi-review` Phase 5.3c):

1. **Duplicate check**: Search `ready.json` for existing task with matching `finding.id`. Skip if already exists.
2. **Generate ID**: `wf-rv-XXXXXXXX` (8-char hash of `finding.id` + triage date)
3. **Resolve origin task** (when `config.originTaskTracing.traceOrigin` is true):
   - Run `git log --format="%H %s" -1 -- [finding.file]` to find the last commit that touched the file
   - Extract task ID from commit message (pattern: `wf-XXXXXXXX`)
   - Look up the task in `ready.json` → `recentlyCompleted` to get `{ id, title, type, feature }`
   - If no task ID found in commit → set `originTask: null`
4. **Create task**:

```json
{
  "id": "wf-rv-XXXXXXXX",
  "title": "Review fix: [issue truncated to 80 chars]",
  "type": "fix",
  "feature": "review",
  "source": "review",
  "reviewDate": "[ISO from last-review.json]",
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
    "autoFixable": "[finding.autoFixable]"
  },
  "status": "ready",
  "priority": "P0-P3",
  "batchable": true,
  "batchKey": "[file]|[category]",
  "createdAt": "[ISO]"
}
```

This format is identical to tasks created by `/wogi-review` Phase 5.3c and processable by `/wogi-review-fix --pending`.

**Learning signal check**: After all tasks are created during triage, run the learning signal detection (same as `/wogi-review` Phase 5.3c Step 4). If `config.originTaskTracing.learningSignal.enabled` is true, group all `wf-rv-` tasks in `ready.json` by `originTask.type`/`originTask.feature` and check if any group has >= threshold instances. If so, add to `feedback-patterns.md` and display warning in triage summary.

## Dismiss Learning

When a finding is dismissed, record it in `.workflow/state/feedback-patterns.md`:

```markdown
| [date] | review-false-positive-[category] | Finding "[issue summary]" in [file] dismissed as not a real issue | 1 | Monitor |
```

This teaches the system:
- If the same pattern is dismissed 3+ times, the review agent prompt is updated to de-prioritize it
- Patterns are tracked per category (security, performance, etc.)

## Triage Summary

After all findings are processed:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TRIAGE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total findings: 12
  Fix now:     4 (applied ✓)
  Create task: 3 (added to ready.json)
  Skip:        2
  Dismiss:     3 (recorded for learning)

Tasks created:
  - wf-abc12345: Fix SQL injection in user query (P0)
  - wf-def67890: Fix missing auth check (P1)
  - wf-ghi11111: Fix sequential awaits in service (P2)

Run /wogi-ready to see new tasks.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Updating last-review.json

After triage completes, update `last-review.json`:
- Set `"triaged": true`
- Add `"triageDate"` timestamp
- For each finding, add `"triageDecision": "fix|task|skip|dismiss"`
- For "fix" decisions, add `"fixApplied": true|false`

## Filters

### Severity Filter
```bash
/wogi-triage --severity high      # Only critical and high severity
/wogi-triage --severity medium    # Medium and above
/wogi-triage --severity critical  # Only critical
```

### Category Filter
```bash
/wogi-triage --category security     # Only security findings
/wogi-triage --category performance  # Only performance findings
/wogi-triage --category quality      # Only code quality findings
```

### Agent Filter
```bash
/wogi-triage --agent performance            # Only performance agent findings
/wogi-triage --agent project-rules-security # Only project-rules security findings
```

Filters can be combined:
```bash
/wogi-triage --severity high --category security
```

## Batch Mode (`--batch`)

Instead of the per-finding walkthrough, `--batch` groups findings by file+category and presents per-batch decisions for faster triage.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Batch 1 of 5 | File: src/api.ts | Category: security (3 findings)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. [HIGH] Raw JSON.parse without try-catch (line 45)
  2. [HIGH] Missing auth check on endpoint (line 89)
  3. [MEDIUM] Sensitive data in error response (line 112)

Options:
  [1] Fix all in batch — apply all fixes sequentially
  [2] Create tasks — create wf-rv- tasks for all in batch
  [3] Expand individually — triage each finding separately
  [4] Skip — no action for this batch
  [5] Dismiss — all findings in batch are false positives
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use `AskUserQuestion` to present batch options. If user chooses "Expand individually", fall back to per-finding walkthrough for that batch only.

## Source Filter (`--source review`)

When `--source review` is specified, triage loads findings from `ready.json` tasks with `source === "review"` instead of from `last-review.json`.

This is useful for triaging accumulated review debt (deferred findings that were turned into persistent tasks).

**How it works:**
1. Read `ready.json`, filter tasks where `source === "review"` (these have `wf-rv-` prefix)
2. Extract the `finding` field from each task as the finding to triage
3. Walk through findings using the same triage flow (fix/task/skip/dismiss)
4. For "Fix now" decisions: fix the finding, then remove the `wf-rv-` task from `ready.json`
5. For "Dismiss" decisions: remove the `wf-rv-` task from `ready.json`, record in `feedback-patterns.md`
6. For "Skip" decisions: leave the task in `ready.json` unchanged

Can be combined with other filters:
```bash
/wogi-triage --source review --severity high    # Only high+ review tasks
/wogi-triage --source review --batch            # Batch triage of review tasks
/wogi-triage --source review --category security # Only security review tasks
```

## Configuration

In `.workflow/config.json`:

```json
{
  "triage": {
    "enabled": true,
    "autoSuggestAfterReview": true,
    "learnFromDismissals": true
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable/disable triage command |
| `autoSuggestAfterReview` | `true` | Show triage suggestion after `/wogi-review` |
| `learnFromDismissals` | `true` | Record dismissed findings in feedback-patterns |

## Integration with Other Commands

- `/wogi-review` → saves findings → suggests `/wogi-triage`
- `/wogi-triage` → creates tasks → visible in `/wogi-ready`
- `/wogi-triage --dismiss` feedback → updates feedback-patterns.md → improves future reviews

## Distinction from /wogi-review-fix

| Command | Purpose | Interaction |
|---------|---------|-------------|
| `/wogi-triage` | Interactive per-finding walkthrough — you decide per finding | Interactive (asks per finding) |
| `/wogi-review-fix` | Automatic bulk fix of all fixable findings | Automatic (fixes everything) |

**Use `/wogi-triage`** when you want control over which findings to fix, defer, or dismiss.
**Use `/wogi-review-fix`** when you trust the review and want everything fixed automatically.

## Finding Display Template

Each finding is displayed using these fields from `last-review.json`:

| Template Field | Source | Example |
|---------------|--------|---------|
| Finding N of M | Array index / total length | "Finding 3 of 12" |
| Severity | `finding.severity` | "HIGH" |
| Category | `finding.category` | "Security" |
| Agent | `finding.agent` | "security" |
| File | `finding.file` + `finding.line` | "src/api.ts:45" |
| Issue | `finding.issue` | "Raw JSON.parse without try-catch" |
| Recommendation | `finding.recommendation` | "Use safeJsonParse from flow-utils.js" |
