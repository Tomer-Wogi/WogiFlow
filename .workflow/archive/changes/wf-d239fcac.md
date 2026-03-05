# [wf-d239fcac] Add Claude Sonnet 4.6 to model registry

## User Story
**As a** WogiFlow user
**I want** Claude Sonnet 4.6 registered in the model registry
**So that** routing, cost analysis, and model recommendations include the latest Sonnet model

## Description
Claude Sonnet 4.6 is the latest Sonnet model (model ID: `claude-sonnet-4-6`). The model adapter already recognizes it via pattern matching, but the registry.json is missing its entry. This means `flow models list`, `flow models route`, and cost analysis don't know about it. Add the registry entry with correct pricing, capabilities, and update routing to prefer Sonnet 4.6 over Sonnet 4 as the default standard-tier model.

## Acceptance Criteria

### Scenario 1: Model listed in registry
**Given** the model registry at `.workflow/models/registry.json`
**When** I run `flow models list`
**Then** Claude Sonnet 4.6 appears in the standard tier
**And** it shows correct context window (200k), max output (64k), and capabilities

### Scenario 2: Default routing updated
**Given** the routing config in registry.json
**When** a feature/bugfix/refactor task is routed
**Then** it recommends `claude-sonnet-4-6` as the primary model (replacing `claude-sonnet-4`)

### Scenario 3: Cost tier updated
**Given** the costTiers config
**When** standard tier preferred models are listed
**Then** `claude-sonnet-4-6` is listed (alongside or replacing `claude-sonnet-4`)

## Technical Notes
- **Files to change**:
  - `.workflow/models/registry.json` - Add model entry, update routing and costTiers
- **No code changes** - This is a JSON config update only
- **Model ID**: `claude-sonnet-4-6` (official Anthropic model ID)
- **Pricing**: $3/MTok input, $15/MTok output (same as Sonnet 4.5)
- **Context**: 200k tokens, 64k max output
- **Capabilities**: code-gen, reasoning, analysis, structured-output, vision, adaptive-thinking

## Dependencies
- None

## Complexity
Low - Single JSON file update with well-established pattern from existing entries
