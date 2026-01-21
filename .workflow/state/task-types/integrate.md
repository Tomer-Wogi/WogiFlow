<!-- .workflow/state/task-types/integrate.md -->
<!-- PINS: task-integrate, task-type, integrate -->

# Integrate Task Type

## Description
<!-- PIN: task-integrate-desc -->
Connecting systems, services, or components together. This includes:
- API integration
- Third-party service connection
- Component composition
- State management wiring
- Event handling setup
- Data pipeline connection

## Required Context
<!-- PIN: task-integrate-context -->
Essential context for successful integration:

### Always Include
- **API documentation**: Endpoints, parameters, responses
- **Connection patterns**: How similar integrations work
- **Both endpoints**: Source and target of integration
- **Type definitions**: Data shapes at each end

### Based on Task
- **Authentication**: How auth works for the service
- **Error handling**: Expected errors and recovery
- **Rate limits**: Constraints on API usage

## Context Loading Priority
<!-- PIN: task-integrate-priority -->
1. API documentation or interface specs
2. Existing integration patterns in codebase
3. Type definitions for data exchange
4. Authentication/configuration setup
5. Error handling patterns

## Success Indicators
<!-- PIN: task-integrate-success -->
A successful integration task produces:
- Systems communicate correctly
- Data flows as expected
- Errors handled gracefully
- Types match on both ends
- Authentication works
- Rate limits respected

## Common Failures
<!-- PIN: task-integrate-failures -->
| Failure Type | Cause | Prevention |
|--------------|-------|------------|
| Type mismatch | API types don't match code | Include full API types |
| Auth failure | Wrong auth pattern | Include auth examples |
| Missing error handling | Undocumented errors | Include error patterns |
| Wrong endpoint | Outdated API docs | Verify API version |

## Model-Specific Adjustments
<!-- PIN: task-integrate-models -->
- **Low-context models**: Step-by-step: auth first, then data, then errors
- **High-context models**: Can handle full integration at once
- **Local LLMs**: Break into connection, data, error handling phases
