# [wf-c14cfa59] Phase 1: Model Infrastructure - Registry Commands and Stats Integration

## User Story
**As a** developer using Wogi Flow
**I want** CLI commands to interact with the model registry and view performance statistics
**So that** I can understand model capabilities, make informed routing decisions, and track costs

## Description
Phase 1 builds on the CLI-agnostic foundation from Phase 0 to provide a formalized model registry and enhanced statistics tracking. The registry (`.workflow/models/registry.json`) already exists with model capabilities, pricing, and routing rules. This story adds the CLI commands to interact with it and integrates stats tracking with task execution.

## Acceptance Criteria

### Scenario 1: List registered models
**Given** a project with `.workflow/models/registry.json`
**When** I run `flow models list`
**Then** I see all registered models grouped by cost tier (premium/standard/economy)
**And** each model shows provider, context window, and best-for use cases

### Scenario 2: Get model information
**Given** a valid model ID like `claude-sonnet-4`
**When** I run `flow models info claude-sonnet-4`
**Then** I see detailed model info including capabilities, language proficiency, and pricing
**And** I see usage statistics if any tasks have been run with that model

### Scenario 3: Get routing recommendation
**Given** a task type like `feature` or `bugfix`
**When** I run `flow models route feature`
**Then** I see the recommended model based on routing rules
**And** I see alternatives and past performance for that task type

### Scenario 4: View model statistics
**Given** task execution history exists
**When** I run `flow models stats`
**Then** I see summary stats (total tasks, tokens, cost)
**And** I see per-model breakdown with success rates
**And** I see failure categories if any

### Scenario 5: View cost analysis
**Given** task execution history with cost data
**When** I run `flow models cost`
**Then** I see total spend and average cost per task
**And** I see cost breakdown by model and task type
**And** I see optimization recommendations if premium models are overused

### Scenario 6: List providers
**Given** providers are configured in the registry
**When** I run `flow models providers`
**Then** I see all available providers (Anthropic, OpenAI, Google, Ollama)
**And** I see which ones have CLI support

### Scenario 7: JSON output
**Given** any models command
**When** I add `--json` flag
**Then** output is valid JSON for programmatic use

### Scenario 8: No registry error
**Given** no `.workflow/models/registry.json` exists
**When** I run any `flow models` command
**Then** I see a helpful error message pointing to `flow init`

## Technical Notes
- **Components**:
  - Use existing: `.workflow/models/registry.json`, `.workflow/models/stats.json`
  - Create new: `scripts/flow-models.js`
- **Integration**:
  - Add `models` command to `scripts/flow` router
  - Export `recordTaskExecution` for other scripts to use
- **Constraints**:
  - Must work with existing model-adapter.js (can coexist or migrate later)
  - Stats format must be backward compatible

## Test Strategy
- [ ] Unit: Test each function (loadRegistry, listModels, getRouteRecommendation, etc.)
- [ ] Integration: Test CLI commands output formatting
- [ ] Manual: Run commands and verify output matches expectations

## Dependencies
- Phase 0.1 complete (CLI agnosticism, registry.json exists)

## Complexity
Medium - New script with multiple commands, integration with existing registry

## Out of Scope
- Automatic stats collection (will be added when integrating with task execution)
- Model adapter migration (can happen in future iteration)
- Multi-model routing during execution (Phase 2/3)
