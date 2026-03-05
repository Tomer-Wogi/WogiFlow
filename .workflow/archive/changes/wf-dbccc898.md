# [wf-dbccc898] Remove /wogi-start bypass loophole — make routing unconditionally mandatory

## User Story
**As a** WogiFlow user shipping the product
**I want** the CLAUDE.md template to have zero loopholes that let the AI skip /wogi-start
**So that** every user message is unconditionally routed through /wogi-start with no self-classification escape hatch

## Description
The CLAUDE.md template has contradictory language. The Task Gating section says questions/exploration "proceed normally without task gating" while the hooks inject "MANDATORY ROUTING" for every prompt. The AI exploits the CLAUDE.md exception to rationalize skipping /wogi-start. Fix all three locations in the templates to make /wogi-start unconditionally mandatory.

## Acceptance Criteria

### Scenario 1: Task Gating section has no "handle normally" exception
**Given** the template `claude-md.hbs`
**When** the Task Gating section is generated
**Then** it says ALL requests go through `/wogi-start` with zero exceptions
**And** there is no "NO - Handle normally" category

### Scenario 2: Universal Entry Point clarifies routing is internal
**Given** the template `claude-md.hbs` Universal Entry Point section
**When** it describes what `/wogi-start` routes
**Then** it explicitly states these descriptions are what happens INSIDE `/wogi-start` after invocation
**And** it explicitly forbids the AI from using these descriptions to self-classify and skip

### Scenario 3: User Commands partial has no self-classification language
**Given** the partial `user-commands.hbs` /wogi-start description
**When** it describes request triage categories
**Then** it clarifies these categories are internal to `/wogi-start`
**And** includes a warning that the AI must not use them to bypass invocation

## Technical Notes
- **Files to change**:
  - `.workflow/templates/claude-md.hbs` (Task Gating + Universal Entry Point sections)
  - `.workflow/templates/partials/user-commands.hbs` (/wogi-start description)
- **Regenerate**: Run `node scripts/flow-bridge.js sync claude-code` after template changes
- **No code changes**: This is purely documentation/template language fixes
- **Self-maintenance rule**: CLAUDE.md is generated — edit templates, not CLAUDE.md directly

## Test Strategy
- [ ] Unit: Verify generated CLAUDE.md contains no "proceed normally without task gating" or "handle normally" language
- [ ] Integration: Verify generated CLAUDE.md explicitly states /wogi-start is unconditionally required

## Dependencies
- None

## Complexity
Low - Text changes only in 2 template files + regeneration
