# [wf-f698b7fb] Add GitHub release workflow rule to prevent race condition failures

## User Story
**As a** developer using WogiFlow
**I want** a documented rule for creating GitHub releases correctly
**So that** npm publish automation doesn't fail due to race conditions

## Description
The npm publish GitHub Action has failed 10+ times because of a race condition: when `git push` is immediately followed by `gh release create`, the tag gets created on the remote's HEAD before the push propagates, pointing to an old commit. This rule documents the correct procedure and recovery steps.

## Acceptance Criteria

### Scenario 1: Rule file exists
**Given** the .claude/rules/operations directory exists
**When** the rule is created
**Then** github-releases.md contains the correct release procedure
**And** it documents the recovery steps for failed releases

### Scenario 2: Rule is loaded in future sessions
**Given** a new Claude Code session starts
**When** the user asks to create a release
**Then** the rule is available in context to guide correct behavior

## Technical Notes
- **Components**:
  - Create new: `.claude/rules/operations/github-releases.md`
- **No code changes**: This is documentation only
- **Constraints**: Must be in tracked git directory (not .workflow/state which is gitignored)

## Test Strategy
- [ ] Unit: N/A - documentation only
- [ ] Integration: Verify file is committed to git
- [ ] E2E: Next release should follow correct procedure

## Dependencies
- None

## Complexity
Low - Single documentation file

## Out of Scope
- Automating the release process itself
- Modifying the GitHub Actions workflow
