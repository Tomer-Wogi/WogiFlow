# [wf-e0d502fe] Implement spec-verification gate to prevent implementation gaps

## User Story
**As a** developer using WogiFlow
**I want** automatic verification that all spec deliverables exist before a task can be marked complete
**So that** implementation gaps (files promised in specs but never created) are caught before claiming "done"

## Description
When working on complex tasks with spec files, there's a risk of marking tasks as complete when some deliverables were never implemented. This happened with the recursive-enhancements spec where `flow-hypothesis-generator.js` was promised but never created, yet the spec was marked "IMPLEMENTED".

This story implements a verification gate that parses spec files, extracts promised deliverables (files to create/modify), and blocks task completion until all deliverables exist and are valid.

## Root Cause Analysis
The gap occurred because:
1. Spec had a clear file list, but no automated verification
2. Task was marked complete based on "seems done" rather than evidence
3. No gate prevented marking complete with missing files

## Acceptance Criteria

### Scenario 1: Task with spec - all deliverables present
**Given** a task `wf-XXXXXXXX` has an associated spec file in `.workflow/changes/`
**And** the spec lists files to create: `scripts/foo.js`, `scripts/bar.js`
**And** both files exist and pass syntax validation
**When** I run `/wogi-done wf-XXXXXXXX`
**Then** the verification passes
**And** the task is marked complete
**And** the output shows "✓ Spec verification passed (2/2 deliverables)"

### Scenario 2: Task with spec - missing deliverables
**Given** a task `wf-XXXXXXXX` has an associated spec file
**And** the spec lists files to create: `scripts/foo.js`, `scripts/bar.js`
**And** only `scripts/foo.js` exists
**When** I run `/wogi-done wf-XXXXXXXX`
**Then** the verification fails
**And** the task is NOT marked complete
**And** the output shows:
```
✗ Spec verification failed (1/2 deliverables)
Missing:
  - scripts/bar.js (listed in spec Part 2)
```
**And** I am prompted: "Create missing files or use --skip-spec-check to override"

### Scenario 3: Task with spec - file exists but fails validation
**Given** a task has a spec listing `scripts/foo.js`
**And** `scripts/foo.js` exists but has syntax errors
**When** I run `/wogi-done wf-XXXXXXXX`
**Then** the verification fails with:
```
✗ Spec verification failed
  - scripts/foo.js exists but fails syntax check
```

### Scenario 4: Task without spec
**Given** a task `wf-XXXXXXXX` has no associated spec file
**When** I run `/wogi-done wf-XXXXXXXX`
**Then** the verification is skipped
**And** the task proceeds with normal completion flow

### Scenario 5: Override with flag
**Given** a task has missing deliverables
**When** I run `/wogi-done wf-XXXXXXXX --skip-spec-check`
**Then** a warning is shown but task completes
**And** the completion is logged with `specCheckSkipped: true`

### Scenario 6: Spec parsing extracts deliverables
**Given** a spec file with content:
```markdown
### New Files (3)
| File | Purpose |
|------|---------|
| `scripts/flow-foo.js` | Does foo |
| `scripts/flow-bar.js` | Does bar |

### Modified Files (2)
| File | Changes |
|------|---------|
| `scripts/flow-utils.js` | Add function |
```
**When** the spec parser runs
**Then** it extracts:
  - New files: `scripts/flow-foo.js`, `scripts/flow-bar.js`
  - Modified files: `scripts/flow-utils.js`

### Scenario 7: Config option to require spec check
**Given** `config.json` has `tasks.requireSpecVerification: true`
**When** a task with spec is completed
**Then** the spec check cannot be skipped without `--force`

### Scenario 8: Loop integration
**Given** a task is running with loop enforcement enabled
**And** the loop reaches the "done" state
**When** the loop tries to complete the task
**Then** the spec verification gate runs automatically
**And** the loop cannot exit until verification passes

## Technical Notes

### Components
- **Create new**: `scripts/flow-spec-verifier.js` - Spec parsing and verification
- **Modify**: `scripts/flow-done.js` - Add verification gate before completion
- **Modify**: `.workflow/config.json` - Add `tasks.requireSpecVerification` option

### Spec Parsing Strategy
Extract deliverables from:
1. Markdown tables with "File" columns
2. Code blocks with file paths
3. Lists with backticked file paths
4. "New Files" and "Modified Files" sections

### Validation Checks
For each deliverable:
1. File exists at path
2. For `.js` files: `node --check` passes
3. For `.json` files: Valid JSON
4. For `.md` files: File is non-empty

### Config Schema
```json
{
  "tasks": {
    "requireSpecVerification": true,
    "specVerification": {
      "validateSyntax": true,
      "allowSkipWithFlag": true,
      "parsePatterns": ["tables", "code-blocks", "lists"]
    }
  }
}
```

## Test Strategy
- [ ] Unit: Spec parser extracts files from various formats
- [ ] Unit: Verification logic for file existence and syntax
- [ ] Integration: flow-done with spec verification
- [ ] Integration: Loop completion blocked by missing deliverables

## Dependencies
- None (builds on existing flow-done.js)

## Complexity
**Medium** - Requires spec parsing logic, but core verification is straightforward

## Out of Scope
- AI-powered spec analysis (this is pattern-based only)
- Verification of file contents (only existence and syntax)
- Automatic creation of missing files

## Sub-Tasks

### wf-e0d502fe-01: Create flow-spec-verifier.js
- Parse spec files to extract deliverables
- Support multiple markdown formats (tables, lists, code blocks)
- Export `parseSpecDeliverables()` and `verifyDeliverables()` functions

### wf-e0d502fe-02: Integrate verification into flow-done.js
- Add verification gate before task completion
- Show clear output for pass/fail
- Support `--skip-spec-check` flag

### wf-e0d502fe-03: Add config options
- Add `tasks.requireSpecVerification` to config.json
- Add `tasks.specVerification` settings
- Update config.schema.json

### wf-e0d502fe-04: Update wogi-done.md skill
- Document new verification behavior
- Document `--skip-spec-check` flag
- Add examples

### wf-e0d502fe-05: Add decision to decisions.md
- Document "Spec Verification Gate" pattern
- Explain when and why it runs
