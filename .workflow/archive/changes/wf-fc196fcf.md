# [wf-fc196fcf] Fix post-review fix loop task gating and implementation gate blocking

## User Story
**As a** WogiFlow user running code reviews
**I want** the post-review "Fix all" loop to create a tracked task before applying fixes, and the implementation gate to hard-block unrouted prompts
**So that** all code changes are tracked, and no implementation work bypasses the workflow

## Description
Two bugs cause untracked work after `/wogi-review`:

1. **Phase 5 fix loop has no task**: When user chooses "Fix all" in Phase 5, the review converts findings to TodoWrite items and applies fixes directly — but never creates a task in `ready.json`. The `task-gate` hook requires an active task to allow edits, but since the review's fix loop skips task creation, either the gate auto-creates a task silently (losing tracking) or the fixes go through untracked.

2. **Implementation gate is a soft hint, not a hard block**: `implementation-gate.js` returns `{ allowed: true, blocked: false, systemReminder: "..." }` when no active task exists. The adapter transforms this into `additionalContext` — a system-level hint that Claude may ignore. After a review fix loop, Claude is in "execution mode" and frequently ignores the routing hint, applying subsequent implementation prompts without going through `/wogi-start`.

Root cause files:
- `scripts/hooks/core/implementation-gate.js` line ~319: returns `allowed: true` instead of `blocked: true`
- `.claude/commands/wogi-review.md` Phase 5 step 5.3: no task creation before fix loop

## Acceptance Criteria

### Scenario 1: Phase 5 "Fix all" creates a tracked task before applying fixes
**Given** `/wogi-review` has completed all 5 phases with findings
**When** the user chooses "Fix all" (or "Fix critical first")
**Then** a fix task is created in `ready.json` inProgress (format: `wf-cr-XXXXXX`)
**And** the task has type "fix", feature "review", and title "Fix N review findings from [review-id]"
**And** ONLY AFTER the task exists in inProgress does the fix loop begin applying edits
**And** after all fixes complete, the task is moved to recentlyCompleted

### Scenario 2: Phase 5 "Review manually" does NOT create a fix task
**Given** `/wogi-review` has completed all 5 phases with findings
**When** the user chooses "Review manually" (option 3)
**Then** findings are saved to `last-review.json` only
**And** no task is created in `ready.json`
**And** user is informed they can start fixes later with `/wogi-start`

### Scenario 3: Implementation gate blocks (not hints) when no active task
**Given** no task exists in `ready.json` inProgress
**When** a user submits a prompt that matches implementation patterns (Edit, Write tools)
**Then** the implementation gate returns `{ allowed: false, blocked: true }`
**And** the block message includes the routing instructions
**And** Claude is forced to route through `/wogi-start` before any edits

### Scenario 4: Implementation gate allows when active task exists
**Given** a task exists in `ready.json` inProgress
**When** a user submits any prompt
**Then** the implementation gate returns `{ allowed: true }`
**And** no routing injection occurs

### Scenario 5: Post-fix-loop state is clean for next prompt
**Given** Phase 5 fix loop has completed and task moved to recentlyCompleted
**When** the user submits a new implementation prompt
**Then** the implementation gate detects no active task
**And** it blocks (not hints) and requires `/wogi-start` routing

## Technical Notes

### Revised Approach: Layered Defense (No Deadlock)

The original plan was to change `implementation-gate.js` to return `blocked: true`. However, this would create a **deadlock**: if UserPromptSubmit blocks the prompt, Claude cannot read the prompt to invoke `/wogi-start`, leaving the user stuck.

**Correct layered defense:**
1. **UserPromptSubmit (implementation-gate.js)**: Stays as **soft hint** (`allowed: true`, `systemReminder`) — Claude can still read the prompt and invoke `/wogi-start`
2. **PreToolUse (task-gate.js)**: Already **hard blocks** Edit/Write when no active task exists (`blockWithoutTask` defaults to true, `autoCreateTask` defaults to false)
3. **wogi-review Phase 5**: Creates a fix task in `ready.json` inProgress BEFORE the fix loop — task-gate allows edits during fixes, blocks after completion

This gives the desired behavior without deadlock:
- After review fix loop: task moved to recentlyCompleted → no active task → task-gate blocks Edit/Write
- But Claude can still read prompts → can invoke `/wogi-start` → creates new task → Edit/Write unblocked

### Files Modified
- `.claude/commands/wogi-review.md` — Phase 5 step 5.3: add task creation before fix loop, task completion after
- `.workflow/changes/wf-fc196fcf.md` — Updated spec with revised approach

### Files NOT Modified (already work correctly)
- `scripts/hooks/core/implementation-gate.js` — Stays as soft hint (avoids deadlock)
- `scripts/hooks/adapters/claude-code.js` — Already handles both blocked and systemReminder paths
- `scripts/hooks/core/task-gate.js` — Already hard-blocks Edit/Write when no active task (line 261)

### Key Code Locations
- `task-gate.js` line 236: `blockWithoutTask !== false` defaults to true (hard block on Edit/Write)
- `task-gate.js` line 249: `autoCreateTask === true` defaults to false (no auto-create)
- `implementation-gate.js` line 319: Returns `allowed: true` with `systemReminder` (soft hint, kept as-is)
- `wogi-review.md` Phase 5 step 5.3: Now creates fix task before fix loop

## Test Strategy
- [ ] Manual: Run `/wogi-review`, choose "Fix all", verify task appears in ready.json inProgress
- [ ] Manual: After fix loop completes, verify task moved to recentlyCompleted
- [ ] Manual: After fix loop, submit new implementation prompt, verify task-gate blocks Edit/Write
- [ ] Manual: Verify user can still type prompts (not deadlocked) — implementation-gate injects hint
- [ ] Manual: Run `/wogi-review`, choose "Review manually", verify NO task created

## Dependencies
- None

## Complexity
Low — Only 1 file changed (wogi-review.md). The hook infrastructure already works correctly. The fix is purely in the AI instruction layer (Phase 5 steps).

## Out of Scope
- Changing implementation-gate.js to hard block (would cause deadlock)
- Changing task-gate.js behavior (already works correctly)
- Adding new hook events
- Changing the review's agent system or finding format
