---
description: "Create a detailed story with acceptance criteria"
effort: medium
---
Create a detailed story with acceptance criteria. Provide title: `/wogi-story Add login form`

Run `./scripts/flow story "<title>"` to create a story.

Load `agents/story-writer.md` for the full story format.

## Anti-Deferral Rule (MANDATORY)

**Every item the user provides MUST become a work item** (criterion or sub-task). Never silently filter items. If you believe an item should be deferred, **ASK the user** — do not decide autonomously.

For multi-item inputs, the command output MUST include: **"All {N} items captured as {criteria|sub-tasks}."** If any item cannot be mapped, the "Unmapped" warning must be surfaced, not suppressed.

This rule applies equally to deep-decomposition mode and flat stories.

## Specification-Quality Gates (wf-63c0f4cc)

Five P0 gates run automatically at creation time (all fail-open):

| Gate | Fires When | Effect |
|------|-----------|--------|
| 1. Long Input | input ≥40 lines OR ≥5 discrete items | routes to `/wogi-extract-review` |
| 2. Item Reconciliation | input has ≥3 discrete items | writes manifest, verifies coverage |
| 3. Consumer Impact | input contains refactor/rename/migrate/etc. | greps consumers, flags phased migration at ≥5 breaking |
| 4. Scope-Confidence | input mentions "new X" / "existing Y" / "the Z service" | audits assumptions → "Pending Clarifications" block |
| 5. Intent Bootstrap | IGR artifacts missing + not already scheduled | schedules background bootstrap via session-state.json |

Gates enforce **specification quality at creation time**; runtime-quality gates (wiring, typecheck, tests) remain `/wogi-start`'s job.

Config: `storyFlow.consumerImpactAnalysis`, `storyFlow.scopeConfidenceAudit`, `storyFlow.itemReconciliation`. All default-true.

## Options

- `--deep` - Enable deep decomposition mode (auto-generate granular sub-tasks)
- `--priority <P>` - Set priority P0-P4 (default: P2 from config)
- `--json` - Output JSON for programmatic access
- `--skip-gates` - Skip all P0 gates (testing/debug only)
- `--bypass-long-input` - Skip Gate 1 (set by `/wogi-start` when it already routed long input)
- `--full-input <txt>` - Full user input for gates (when title is a summary)

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
4. **Number sub-tasks in EXECUTION ORDER** (MANDATORY):
   - `-01`, `-02`, etc. must follow a logical implementation flow
   - A developer should be able to work through them sequentially without jumping
   - **Ordering priority**:
     1. Foundation/layout (page structure, routing, shared types)
     2. Infrastructure/shared dependencies (mock APIs, data layer, state atoms, shared hooks)
     3. Feature components — simple → complex, independent → dependent
     4. Danger/destructive operations last (delete account, data wipes)
   - **After numbering, verify**: "Can I work -01, -02, -03... without hitting unmet dependencies?" If not, renumber.

### Sub-Task Format

Parent: `wf-a1b2c3d4` (the main story, hash-based ID)
Children: `wf-a1b2c3d4-01`, `wf-a1b2c3d4-02`, etc.

Each sub-task includes:
- Single focused objective
- Clear done criteria
- Dependencies on other sub-tasks (all dependencies must have LOWER numbers)
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
