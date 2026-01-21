<!-- .workflow/state/task-types/create.md -->
<!-- PINS: task-create, task-type, create -->

# Create Task Type

## Description
<!-- PIN: task-create-desc -->
Creating new files/components from scratch. This includes:
- New React components
- New utility functions
- New hooks
- New services/API clients
- New test files

## Required Context
<!-- PIN: task-create-context -->
Essential context for successful creation:

### Always Include
- **app-map.md**: Existing components to avoid duplication
- **Similar component example**: Reference for patterns and style
- **Type definitions**: Full prop types and interfaces
- **Import patterns**: Available imports with exact paths

### Based on Task
- **Style system**: Theme tokens, CSS conventions
- **State management**: Context patterns, store structure
- **API patterns**: Data fetching conventions

## Context Loading Priority
<!-- PIN: task-create-priority -->
1. Import map (available imports)
2. Type definitions for target area
3. 1-2 similar component examples
4. Project patterns from decisions.md
5. Full file of closest similar component (if rich context)

## Success Indicators
<!-- PIN: task-create-success -->
A successful create task produces:
- File created at correct path
- Exports match requirements
- Types are correct and complete
- Follows existing patterns
- Passes linting and type-checking
- No hallucinated imports

## Common Failures
<!-- PIN: task-create-failures -->
| Failure Type | Cause | Prevention |
|--------------|-------|------------|
| Wrong imports | Missing import map | Always include available imports |
| Type errors | Incomplete type defs | Include full interface definitions |
| Style mismatch | No example provided | Include similar component |
| Wrong location | Unclear structure | Specify exact file path |

## Model-Specific Adjustments
<!-- PIN: task-create-models -->
- **Low-context models**: Include 2-3 complete component examples
- **High-context models**: Pattern hints sufficient, 1 example
- **Local LLMs**: Maximum context, explicit everything
