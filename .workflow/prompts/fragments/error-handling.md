---
id: error-handling
purpose: quality
order: 25
models: all
cli: all
description: Error handling patterns
---

# Error Handling

## Principles
- Handle errors at appropriate boundaries
- Provide meaningful error messages
- Log errors with context for debugging
- Never swallow errors silently

## Patterns
- Use try/catch for async operations
- Validate inputs at function boundaries
- Return error objects or throw, be consistent
- Consider error recovery when possible
