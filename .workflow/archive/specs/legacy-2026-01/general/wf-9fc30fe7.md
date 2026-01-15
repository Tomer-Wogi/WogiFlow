# [wf-9fc30fe7] Claude Code 2.1.x Alignment - Skill Frontmatter & Permissions

## User Story
**As a** Wogi Flow user on Claude Code
**I want** skills and permissions aligned with Claude Code 2.1.x features
**So that** I get the best possible experience with hot-reload, wildcards, and new frontmatter fields

## Description
Align Wogi Flow with Claude Code 2.1.0-2.1.3 features. This includes updating skill frontmatter to support new fields (user-invocable, context, agent, allowed-tools), implementing wildcard Bash permissions to reduce 100+ rules to ~20, adding permission validation to health checks, and updating roadmap with future items (LSP, Release Channels).

## Acceptance Criteria

### Scenario 1: Skill template updated with new frontmatter
**Given** the skill template in `.claude/skills/_template/skill.md`
**When** I view the template
**Then** it includes `user-invocable`, `context`, `agent`, and `allowed-tools` fields
**And** the fields have sensible defaults documented

### Scenario 2: Existing skills updated
**Given** all skills in `.claude/skills/*/skill.md`
**When** I check their frontmatter
**Then** they include the new fields appropriate to their purpose
**And** `_template` has `user-invocable: false`

### Scenario 3: Wildcard Bash permissions
**Given** the claude-bridge.js generates settings.local.json
**When** I run `flow sync`
**Then** permissions use wildcards like `Bash(npm *)` instead of individual commands
**And** the total number of permission rules is reduced significantly

### Scenario 4: Permission validation in health check
**Given** I run `flow health`
**When** there are duplicate or shadowed permission rules
**Then** the health check warns about unreachable rules

### Scenario 5: Hook timeout updated
**Given** the `.workflow/config.json` file
**When** I check `hooks.timeout`
**Then** it is set to 600000 (10 minutes) to match Claude Code 2.1.2

### Scenario 6: Roadmap updated
**Given** the roadmap at `.workflow/roadmap/roadmap.md`
**When** I check Phase 5
**Then** it includes LSP Tool Integration and Release Channel Configuration

### Scenario 7: respectGitignore setting
**Given** the claude-bridge.js generates settings
**When** I check the generated settings.local.json
**Then** it includes `respectGitignore: true`

## Technical Notes
- **Components**:
  - Modify: `claude-bridge.js` (wildcard permissions, respectGitignore)
  - Modify: `flow-health.js` (permission validation)
  - Modify: `.claude/skills/*/skill.md` (all skills)
  - Modify: `.workflow/config.json` (hook timeout)
  - Modify: `.workflow/roadmap/roadmap.md` (LSP, Release Channels)
- **CLI-Agnostic**: All Claude-specific changes go in `claude-bridge.js`
- **Constraints**: Must maintain backward compatibility

## Test Strategy
- [ ] Manual: Run `flow sync` and verify settings.local.json
- [ ] Manual: Run `flow health` and check permission warnings
- [ ] Manual: Verify skills load correctly in Claude Code

## Dependencies
- None

## Complexity
Medium - Multiple file changes but well-defined scope

## Out of Scope
- Hooks in skill frontmatter (separate task)
- Commands & skills merger (separate task)
