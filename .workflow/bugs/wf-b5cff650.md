# wf-b5cff650: flow-story doesn't propagate new stories to ready.json

**Created**: 2026-04-15
**Status**: Open
**Severity**: Medium
**Priority**: P3
**Tags**: #bug
**Discovered From**: wf-0059082d
**Discovered During**: implementation

## Bug Summary
`flow story "<title>"` (simple, non-decomposed path) creates the spec file in `.workflow/changes/` but never propagates the task to `ready.json`. Result: the story is invisible to `/wogi-start`, `flow ready`, and the session-end promotion pipeline. Only decomposed stories (`--deep`) reach the task queue.

## Reproduction

### Steps to Reproduce
1. `flow story "Add user login"` (no `--deep` flag)
2. `flow ready`
3. Notice the new story is missing from the output

### Expected Behavior
The new story appears in `ready.json → ready[]` with `{id, title, type, level, priority, status, specPath}`.

### Actual Behavior
The spec file exists at `.workflow/changes/wf-XXXXXXXX.md` but `ready.json` is unchanged. `flow ready` does not list the new story.

### Environment
- Browser: [if applicable]
- OS: [if applicable]
- Version: [app version]
- Node/Runtime: [if applicable]

### Screenshots/Logs
[Attach screenshots, error logs, or stack traces]

---

## Root Cause Analysis

### What Went Wrong?
[Technical explanation of the bug - what part of the code/logic is failing and why]

### Why Did This Happen?
[Choose one or more]
- [ ] Logic error in implementation
- [ ] Missing edge case handling
- [ ] Incorrect assumption about inputs/state
- [ ] Race condition / timing issue
- [ ] External dependency failure
- [ ] Configuration/environment issue
- [ ] Prompt/instruction unclear or ambiguous
- [ ] Other: [explain]

### Source of the Problem
<!-- For AI-assisted development, this helps us learn -->
- **Prompt issue**: [Was the original request ambiguous or missing context?]
- **Logic gap**: [What reasoning led to the bug?]
- **Missing context**: [What information would have prevented this?]

---

## Fix Approaches

### Approach 1: [Name] (Recommended)
**Description**: [How this approach fixes the bug]
**Pros**: [Benefits]
**Cons**: [Drawbacks]
**Files affected**: [List files]

### Approach 2: [Name] (Alternative)
**Description**: [How this approach fixes the bug]
**Pros**: [Benefits]
**Cons**: [Drawbacks]
**Files affected**: [List files]

### Chosen Approach
[Which approach and why]

---

## Acceptance Criteria

### Scenario 1: Bug is fixed
**Given** [the conditions that previously triggered the bug]
**When** [the action that caused the bug]
**Then** [the expected correct behavior]

### Scenario 2: No regression
**Given** [related functionality]
**When** [normal usage]
**Then** [existing behavior is preserved]

### Scenario 3: Edge case handling
**Given** [edge case conditions]
**When** [edge case action]
**Then** [graceful handling]

---

## Test Strategy
- [ ] Unit test: [What to test]
- [ ] Integration test: [What to test]
- [ ] Manual verification: [Steps to verify fix]

## Verification Checklist
<!-- Quick steps to confirm the bug is fixed -->
1. [ ] [Step to verify the bug no longer occurs]
2. [ ] [Step to verify no regression]
3. [ ] [Step to verify edge cases]

---

## Prevention & Learning

### How to Prevent Similar Bugs
[What changes to process, prompts, or code patterns would prevent this?]

### Learnings to Capture
<!-- These should be added to decisions.md or skill learnings -->
- [ ] Pattern to add to decisions.md: [describe]
- [ ] Skill learning to record: [describe]
- [ ] Prompt improvement: [describe]

---

## Related
- [Related request-log entries]
- [Related components from app-map]
- Discovered while working on: wf-0059082d

## Resolution
- **Fixed in**: 2026-04-15 (uncommitted at fix time; see R-287)
- **Fix**: Added a `ready.json` write path in `scripts/flow-story.js:381-414` for the simple (non-decomposed) branch, mirroring the existing decomposed-path write. Uses `withLock(READY_PATH, ...)` for race safety, `safeJsonParse` for reads, and an idempotency guard that skips the insert if the task ID is already present anywhere in the queue. Also surfaces "Added to ready.json" / "[DRY RUN] Would add..." / "Could not add..." in the CLI output so the user can see what happened.
- **Root cause confirmed**: Yes. The `ready.json` write was conditionally inside `if (shouldDecompose && analysis.suggestedSubTasks.length > 0)`. Simple stories never entered that block.
- **Learnings applied**: None promoted to decisions.md — this was a single-site gap, not a pattern.
- **Tests added**: Verified live — simple story now appears in `ready.json` after creation; dry-run shows "Would add"; idempotency guard prevents duplicate insert of the same task ID. Full test suite (1042/1042) still passes with no regressions.
