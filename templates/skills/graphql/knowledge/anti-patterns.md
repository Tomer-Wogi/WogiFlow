# graphql — Anti-Patterns

Common mistakes to avoid when working with graphql.

---

## Deeply Nested Queries Without Limits

**Problem**: Clients can query infinite depth, causing performance issues

**Fix**: Use query depth limiting and complexity analysis

**Example**:
```
// Limit: { depthLimit: 5, complexityLimit: 1000 }
```

---

