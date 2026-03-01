# mongoose — Conventions

Naming and structural conventions for mongoose.

---

- Define schemas in dedicated files: `user.model.ts`
- Use TypeScript interfaces alongside schemas
- Add indexes for frequently queried fields
- Use mongoose middleware (pre/post hooks) for cross-cutting concerns
- Use lean() for read-only queries

---

_Customize these conventions based on your team's preferences._
