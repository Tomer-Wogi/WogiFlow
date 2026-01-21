<!-- .workflow/state/task-types/modify.md -->
<!-- PINS: task-modify, task-type, modify -->

# Modify Task Type

## Description
<!-- PIN: task-modify-desc -->
Editing existing files to add, change, or update functionality. This includes:
- Adding new props or features to components
- Updating function behavior
- Changing UI elements
- Adding new methods to services
- Updating configuration

## Required Context
<!-- PIN: task-modify-context -->
Essential context for successful modification:

### Always Include
- **Full current file**: Complete file being modified
- **Clear diff markers**: What to change and where
- **Type definitions**: Existing and new types
- **Related imports**: Any new imports needed

### Based on Task
- **Dependent files**: Files that import the modified file
- **Usage examples**: How the file is currently used
- **Test files**: Existing tests to update

## Context Loading Priority
<!-- PIN: task-modify-priority -->
1. Full content of file being modified
2. Exact change specification
3. Type definitions for changed areas
4. Related file context (if touching imports)
5. Usage patterns from dependent files

## Success Indicators
<!-- PIN: task-modify-success -->
A successful modify task produces:
- Changes applied at correct location
- Existing functionality preserved
- New functionality works as specified
- Types updated correctly
- No breaking changes to dependents
- Tests still pass

## Common Failures
<!-- PIN: task-modify-failures -->
| Failure Type | Cause | Prevention |
|--------------|-------|------------|
| Wrong location | Unclear change spec | Specify exact line/function |
| Breaking changes | Missing dependent context | Include usage examples |
| Lost code | Incomplete file view | Include full file content |
| Type mismatches | Outdated type defs | Include current types |

## Model-Specific Adjustments
<!-- PIN: task-modify-models -->
- **Low-context models**: Include full file + clear markers
- **High-context models**: Can work with excerpts
- **Local LLMs**: Full file always, explicit markers
