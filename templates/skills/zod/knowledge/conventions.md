# zod — Conventions

Naming and structural conventions for zod.

---

- Schema names: `UserSchema`, `CreatePostSchema` (PascalCase + Schema suffix)
- Type inference: `type User = z.infer<typeof UserSchema>`
- Use safeParse at boundaries (API, form), parse internally
- Compose schemas: `.extend()`, `.merge()`, `.pick()`, `.omit()`

---

_Customize these conventions based on your team's preferences._
