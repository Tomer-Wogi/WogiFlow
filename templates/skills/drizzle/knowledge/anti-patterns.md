# drizzle — Anti-Patterns

Common mistakes to avoid when working with drizzle.

---

## Not Using Prepared Statements

**Problem**: Re-preparing the same query on every call

**Fix**: Use .prepare() for frequently-executed queries

**Example**:
```
const getUser = db.select().from(users).where(eq(users.id, sql.placeholder("id"))).prepare();
await getUser.execute({ id: 1 });
```

---

