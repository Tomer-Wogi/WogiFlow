# wf-origintrace — Origin Task Tracing for Review Fixes

## User Story
**As a** WogiFlow user
**I want** review fix tasks to reference the original task that caused the issue, and same-session reviews to annotate the completed task directly
**So that** I can trace quality issues back to their source and detect patterns where certain task types consistently produce review fixes

## Description
Currently, review findings create standalone `wf-rv-` fix tasks with no connection to the original task that produced the issue. This creates two problems: (1) same-session reviews create redundant tasks when the completed task could simply be annotated with findings, and (2) cross-session fix tasks have no traceability to their origin, preventing pattern detection. This story adds `originTask` references to fix tasks, same-session annotation on completed tasks, and a learning signal aggregation mechanism.

## Acceptance Criteria

### Scenario 1: Same-session review annotates completed task
**Given** a review is running and the reviewed files overlap with a task in `recentlyCompleted`
**When** findings are generated for files that were changed by that completed task
**Then** the completed task in `recentlyCompleted` should be annotated with a `reviewFindings` metadata field containing the finding summaries
**And** no new `wf-rv-` tasks should be created for those findings (they live on the completed task)

### Scenario 2: Cross-session fix tasks include originTask reference
**Given** a review creates `wf-rv-` fix tasks for findings
**When** the finding's file can be traced to a completed task (via git blame or recentlyCompleted scan)
**Then** the fix task should include an `originTask` field with `{ "id", "title", "type", "feature" }`
**And** the originTask field should reference the task that last modified the file

### Scenario 3: originTask reference when origin cannot be determined
**Given** a review creates `wf-rv-` fix tasks
**When** the finding's file cannot be traced to any completed task (e.g., the file was modified outside WogiFlow)
**Then** the fix task should include `"originTask": null`
**And** the task should still be created normally

### Scenario 4: Learning signal detection for repeated patterns
**Given** multiple fix tasks exist with `originTask` references
**When** 3+ fix tasks share the same `originTask.type` or `originTask.feature`
**Then** a learning signal entry should be added to `feedback-patterns.md`
**And** the entry should note: "Tasks of type [type]/feature [feature] consistently generate review fixes"

### Scenario 5: Same-session detection logic
**Given** a review is running
**When** determining if this is a same-session review
**Then** the detection should check if any reviewed file was changed by a task in `recentlyCompleted` from the current session (completedAt within last 2 hours)
**And** only files that overlap with that task's changes are annotated (other findings still create separate tasks)

### Scenario 6: Config controls the behavior
**Given** the `originTaskTracing` config section exists
**When** `annotateCompletedTasks` is false
**Then** same-session annotation is skipped and all findings create standalone `wf-rv-` tasks
**When** `traceOrigin` is false
**Then** no `originTask` field is added to fix tasks
**When** `learningSignalThreshold` is set to N
**Then** the learning signal fires after N matching fix tasks instead of the default 3

## Technical Notes
- **Files to modify**:
  - `.workflow/config.json` — Add `originTaskTracing` config block
  - `.claude/commands/wogi-review.md` — Modify Phase 5.3c task creation + add same-session detection
  - `.claude/commands/wogi-review-fix.md` — Add `originTask` to task format in Phase 0 and manual task creation
  - `.claude/commands/wogi-triage.md` — Add `originTask` to task creation format
- **No new scripts** — All changes are in AI instruction files and config
- **Dependencies**: Builds on `wf-reviewfix` (Enhanced Post-Review Fix Workflow) which is already completed

## Boundaries
- Do NOT modify any `.js` scripts
- Do NOT modify the review agents (Phase 2)
- Do NOT change the severity routing table
- Do NOT modify the `wf-cr-` fix session task format (only `wf-rv-` tasks)

## Test Strategy
- [ ] Manual: Run `/wogi-review` after completing a task in the same session, verify completed task gets annotated
- [ ] Manual: Run `/wogi-review` on older code, verify `wf-rv-` tasks have `originTask` references
- [ ] Manual: Verify config toggles disable each feature independently
- [ ] Verification: Cross-file consistency check that `originTask` format is identical across all 3 command files

## Dependencies
- wf-reviewfix (completed) — provides the persistent task creation infrastructure this builds on

## Complexity
Medium — 4 files, 6 acceptance criteria, no new scripts, builds on existing infrastructure

## Out of Scope
- Automated pattern detection CLI command (future: `flow review-patterns`)
- Dashboard/visualization of origin task relationships
- Modifying the review agents to be aware of origin tasks
