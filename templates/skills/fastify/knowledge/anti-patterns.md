# fastify — Anti-Patterns

Common mistakes to avoid when working with fastify.

---

## Blocking the Event Loop

**Problem**: Synchronous CPU-heavy work in route handlers

**Fix**: Use worker threads or offload to a queue for heavy computation

**Example**:
```
// Bad: JSON.parse(hugeString) in handler
// Good: Use fastify.inject() for internal calls, workers for CPU work
```

---

