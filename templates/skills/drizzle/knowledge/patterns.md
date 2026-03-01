# drizzle — Successful Patterns

Best practices for working with drizzle.

---

## Schema-First Type Safety

**Context**: Defining tables with full TypeScript inference

**Example**:
```
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 256 }).unique(),
});
```

**Why it works**: Table definitions ARE the TypeScript types — no separate interface needed

---

## Relational Queries

**Context**: Fetching related data

**Example**:
```
const result = await db.query.users.findMany({
  with: { posts: { with: { comments: true } } },
});
```

**Why it works**: Drizzle generates optimized JOINs from declarative relation queries

---

