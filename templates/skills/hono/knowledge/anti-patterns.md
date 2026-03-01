# hono — Anti-Patterns

Common mistakes to avoid when working with hono.

---

## Heavy Dependencies at the Edge

**Problem**: Importing large Node.js packages in edge runtime

**Fix**: Use edge-compatible alternatives or Hono built-ins

**Example**:
```
// Bad: import crypto from "crypto" (not available in Workers)
// Good: Use Web Crypto API
```

---

