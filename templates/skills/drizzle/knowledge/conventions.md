# drizzle — Conventions

Naming and structural conventions for drizzle.

---

- Schema in src/db/schema.ts or src/schema/ directory
- Use drizzle-kit for migrations: `npx drizzle-kit generate`
- Export table types: `type User = typeof users.$inferSelect`
- Use relations() for declaring relationships between tables

---

_Customize these conventions based on your team's preferences._
