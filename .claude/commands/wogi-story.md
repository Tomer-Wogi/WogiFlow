---
description: "Create a detailed story with acceptance criteria"
---
Create a detailed story with acceptance criteria. Provide title: `/wogi-story Add login form`

Run `./scripts/flow story "<title>"` to create a story.

Load `agents/story-writer.md` for the full story format.

## Options

- `--deep` - Enable deep decomposition mode (auto-generate granular sub-tasks)
- `--priority <P>` - Set priority P0-P4 (default: P2 from config)
- `--json` - Output JSON for programmatic access

Examples:
```bash
flow story "Add user login"
flow story "Add user login" --deep
flow story "Add user login" --priority P1
flow story "Add user login" authentication --deep --json
```

## Standard Mode

Create a story with:
1. **User Story**: As a [user], I want [action], so that [benefit]
2. **Description**: 2-4 sentences of context
3. **Acceptance Criteria** using Given/When/Then (Gherkin):
   - Happy path scenario
   - Alternative path scenarios
   - Error handling scenarios
4. **Technical Notes**:
   - Check `.workflow/state/app-map.md` for existing components
   - List components to use vs create
   - Note API endpoints if relevant
5. **Test Strategy**: Unit, Integration, E2E
6. **Dependencies**: What must be done first
7. **Complexity**: Low/Medium/High

## Deep Decomposition Mode (`--deep`)

When `--deep` flag is used, OR when Claude detects a complex story:

1. Create the parent story as above
2. Analyze complexity factors:
   - Number of acceptance criteria (>5 triggers decomposition)
   - Distinct UI components needed (>3 triggers)
   - API endpoints involved (>2 triggers)
   - Files likely to change (>10 triggers)
3. Auto-decompose into granular sub-tasks:
   - Each acceptance scenario → separate sub-task
   - Each UI component → separate sub-task
   - Each error state → separate sub-task
   - Each loading state → separate sub-task
   - Each API integration → separate sub-task

### Sub-Task Format

Parent: `wf-a1b2c3d4` (the main story, hash-based ID)
Children: `wf-a1b2c3d4-01`, `wf-a1b2c3d4-02`, etc.

Each sub-task includes:
- Single focused objective
- Clear done criteria
- Dependencies on other sub-tasks
- Priority (inherits from parent)
- Estimated scope (XS/S/M)

### Auto-Suggest Behavior

Check `config.json → storyDecomposition`:
- `autoDetect: true` - Claude suggests when beneficial (default)
- `autoDecompose: true` - Auto-decompose without asking
- `autoDecompose: false` - Only decompose with `--deep` flag

When `autoDetect` is enabled and complexity is detected, Claude will ask:
> "This looks like a complex story with [X scenarios]. Would you like me to decompose it into granular sub-tasks?"

## Output

Save the story to `.workflow/changes/[feature]/wf-XXXXXXXX.md`

Example output:
```
Created story: wf-a1b2c3d4

File: .workflow/changes/general/wf-a1b2c3d4.md
Title: Add user login
Feature: general
Priority: P1
```

If decomposed, also create:
- `.workflow/changes/[feature]/wf-a1b2c3d4-01.md` (sub-task 1)
- `.workflow/changes/[feature]/wf-a1b2c3d4-02.md` (sub-task 2)
- etc.

Update `ready.json` with parent task (with priority) and all sub-tasks.

Ask clarifying questions if needed to write good acceptance criteria.
