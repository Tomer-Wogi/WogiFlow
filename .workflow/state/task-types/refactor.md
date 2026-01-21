<!-- .workflow/state/task-types/refactor.md -->
<!-- PINS: task-refactor, task-type, refactor -->

# Refactor Task Type

## Description
<!-- PIN: task-refactor-desc -->
Structural changes that maintain behavior but improve code quality. This includes:
- Extracting components/functions
- Renaming across files
- Moving files to new locations
- Simplifying complex code
- Improving type safety
- Reducing duplication

## Required Context
<!-- PIN: task-refactor-context -->
Essential context for successful refactoring:

### Always Include
- **Dependency map**: All files that reference the target
- **Before/after examples**: Clear expectation of change
- **Full files involved**: Every file that will change
- **Test coverage**: Existing tests to verify behavior

### Based on Task
- **Import graph**: How files connect
- **Usage patterns**: How the code is called
- **Type relationships**: Interface inheritance

## Context Loading Priority
<!-- PIN: task-refactor-priority -->
1. Full dependency map (who imports what)
2. All files that will be modified
3. Clear before/after specification
4. Test files for verification
5. Pattern guidance for new structure

## Success Indicators
<!-- PIN: task-refactor-success -->
A successful refactor task produces:
- Behavior unchanged (tests pass)
- Structure improved as specified
- All references updated
- No orphaned code
- Types remain correct
- Cleaner/simpler result

## Common Failures
<!-- PIN: task-refactor-failures -->
| Failure Type | Cause | Prevention |
|--------------|-------|------------|
| Broken imports | Missing dependency map | Include full import graph |
| Lost behavior | Incomplete test coverage | Run tests before/after |
| Partial update | Missing reference files | Include all affected files |
| Wrong pattern | Unclear target structure | Show before/after example |

## Model-Specific Adjustments
<!-- PIN: task-refactor-models -->
- **Low-context models**: Step-by-step refactor, one file at a time
- **High-context models**: Can handle multi-file in one pass
- **Local LLMs**: Break into smaller steps, verify each
