# [wf-boundaries] Add boundary declarations to task specs

## User Story
**As a** WogiFlow user
**I want** task specs to include a "## Boundaries" section listing files/paths the agent must NOT touch
**So that** stable, tested code is protected during task execution even if it's related to the task

## Description
Inspired by the PAUL framework's boundary system, this adds a blacklist complement to our existing scope gating whitelist. Currently scope-gate.js validates that edits are within the task's `filesToChange` list (whitelist). Boundaries add the inverse — an explicit "DO NOT MODIFY" list that blocks edits to protected files even if they somehow pass scope validation. This catches the case where an agent decides to "fix" or "improve" adjacent stable code while working on a task.

## Acceptance Criteria

### Scenario 1: Story template includes Boundaries section
**Given** a new story is created via flow-story.js
**When** the template is generated
**Then** it includes a `## Boundaries` section between "Out of Scope" and the end, with placeholder guidance for DO NOT MODIFY files

### Scenario 2: Scope gate enforces boundaries at runtime
**Given** a task has a `## Boundaries` section listing protected files/paths
**When** the agent attempts to edit a file matching a boundary pattern
**Then** the scope gate blocks or warns (based on config mode) with a clear "BOUNDARY VIOLATION" message

### Scenario 3: wogi-start spec generation includes boundaries
**Given** a task is being planned in Step 1.5 (spec generation)
**When** the spec is generated
**Then** it includes boundary declarations auto-detected from the task context (related files that should NOT be modified)

## Technical Notes
- **Files to change**:
  - `scripts/flow-story.js` — Add ## Boundaries to story template
  - `scripts/hooks/core/scope-gate.js` — Add boundary enforcement logic
  - `scripts/flow-spec-generator.js` — Add boundary section to generated specs
  - `.claude/commands/wogi-start.md` — Mention boundaries in Step 1.5
- **Reuse**: Extend existing `isFileInScope()` pattern in scope-gate.js
- **Config**: Add `boundaries` to `hooks.rules` in config schema

## Test Strategy
- [ ] Manual: Create a story, verify ## Boundaries section appears
- [ ] Manual: Verify scope-gate parses boundaries from spec file
- [ ] Syntax check: `node --check scripts/flow-story.js && node --check scripts/hooks/core/scope-gate.js && node --check scripts/flow-spec-generator.js`

## Dependencies
- None

## Complexity
Medium - 4 files, follows existing scope-gate patterns
