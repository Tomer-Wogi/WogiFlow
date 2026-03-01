# prisma — Conventions

Naming and structural conventions for prisma.

---

- Schema file: prisma/schema.prisma (single file or split with prisma-merge)
- Run `npx prisma generate` after schema changes
- Run `npx prisma migrate dev` for dev migrations, `migrate deploy` for production
- Use `@map` and `@@map` for custom table/column names
- Name relations explicitly: `author User @relation("PostAuthor")`

---

_Customize these conventions based on your team's preferences._
