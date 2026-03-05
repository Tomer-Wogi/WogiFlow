# [wf-400afaf9] Add metadata task type to model routing for economy tier

## User Story
**As a** WogiFlow user running hybrid mode
**I want** metadata tasks (file classification, syntax detection, task categorization) to automatically route to economy-tier models
**So that** I save tokens on simple classification tasks while maintaining quality for complex work

## Description
WogiFlow's model router already supports cost-tier routing with `economy`, `standard`, and `premium` tiers. It routes `boilerplate` and `docs` tasks to economy tier. However, metadata-focused tasks (detecting file types, classifying task complexity, extracting keywords) are not explicitly routed. Adding a `metadata` task type will ensure these simple classification tasks use cheaper models, following the pattern Crush uses with its two-tier model architecture.

## Acceptance Criteria

### Scenario 1: Metadata task routes to economy tier
**Given** a task classified as `metadata` type
**When** the model router selects a model
**Then** it should prefer `economy` tier models
**And** only require `analysis` capability

### Scenario 2: Task analyzer detects metadata tasks
**Given** a task description like "classify files by type" or "detect syntax errors"
**When** the task analyzer runs
**Then** it should classify the task type as `metadata`

### Scenario 3: Existing routing unchanged
**Given** tasks of type `feature`, `bugfix`, `architecture`, etc.
**When** the model router selects a model
**Then** they should route to their existing tiers (unchanged behavior)

## Technical Notes
- **Components**:
  - Modify: `scripts/flow-model-router.js` - Add `metadata` to `TASK_TYPE_ROUTING`
  - Modify: `scripts/flow-task-analyzer.js` - Add metadata detection patterns
- **No API changes**
- **No state changes**
- **Constraints**: Must not affect existing task type routing

## Test Strategy
- [ ] Unit: Test `metadata` type routes to economy tier
- [ ] Unit: Test task analyzer detects metadata keywords
- [ ] Integration: Test full routing pipeline with metadata task

## Dependencies
- None

## Complexity
Low - Adding one entry to existing mapping and a few patterns to task analyzer

## Out of Scope
- Automatic metadata task detection during task execution (just classification)
- Changing other task type routing preferences
