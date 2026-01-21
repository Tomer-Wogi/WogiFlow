<!-- .workflow/state/task-types/fix.md -->
<!-- PINS: task-fix, task-type, fix -->

# Fix Task Type

## Description
<!-- PIN: task-fix-desc -->
Bug fixes and error resolution. This includes:
- Runtime errors
- Type errors
- Logic bugs
- Edge case handling
- Performance issues
- Regression fixes

## Required Context
<!-- PIN: task-fix-context -->
Essential context for successful bug fixing:

### Always Include
- **Error message/stack trace**: Exact error details
- **Reproduction steps**: How to trigger the bug
- **Related code**: File and function where bug occurs
- **Expected behavior**: What should happen

### Based on Task
- **Data flow**: How data reaches the bug location
- **Edge cases**: Input that triggers the bug
- **Related tests**: Test that should catch this

## Context Loading Priority
<!-- PIN: task-fix-priority -->
1. Exact error message and stack trace
2. Full file containing the bug
3. Reproduction steps or failing test
4. Related code (data sources, callers)
5. Expected vs actual behavior

## Success Indicators
<!-- PIN: task-fix-success -->
A successful fix task produces:
- Error no longer occurs
- Original behavior restored
- No new bugs introduced
- Root cause addressed (not just symptom)
- Test added to prevent regression

## Common Failures
<!-- PIN: task-fix-failures -->
| Failure Type | Cause | Prevention |
|--------------|-------|------------|
| Symptom fix | Missing root cause | Include data flow context |
| New bug | Incomplete understanding | Show full related code |
| Partial fix | Edge cases missed | Include edge case examples |
| Wrong location | Unclear stack trace | Provide full trace |

## Model-Specific Adjustments
<!-- PIN: task-fix-models -->
- **Low-context models**: Focus on exact error location + context
- **High-context models**: Can analyze broader codebase
- **Local LLMs**: Include explicit error patterns to avoid
