# hono — Successful Patterns

Best practices for working with hono.

---

## Type-Safe Routes

**Context**: Building APIs with full type inference

**Example**:
```
const app = new Hono()
  .get("/users/:id", async (c) => {
    const id = c.req.param("id");
    return c.json({ id });
  });
```

**Why it works**: Hono infers types through the chain, giving full type safety on client and server

---

