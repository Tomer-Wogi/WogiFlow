# graphql — Successful Patterns

Best practices for working with graphql.

---

## DataLoader for N+1 Prevention

**Context**: Batching related data fetches

**Example**:
```
const userLoader = new DataLoader(async (ids) => {
  const users = await db.user.findMany({ where: { id: { in: ids } } });
  return ids.map(id => users.find(u => u.id === id));
});
```

**Why it works**: DataLoader batches and caches per-request, eliminating N+1 query problems in resolvers

---

