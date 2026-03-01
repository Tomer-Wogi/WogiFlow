# fastapi — Anti-Patterns

Common mistakes to avoid when working with fastapi.

---

## Blocking Calls in Async Endpoints

**Problem**: Calling sync functions in async def blocks the event loop

**Fix**: Use run_in_executor for sync I/O or make the endpoint sync (def, not async def)

**Example**:
```
# Bad: async def endpoint(): result = requests.get(...)
# Good: async def endpoint(): result = await httpx.get(...)
```

---

