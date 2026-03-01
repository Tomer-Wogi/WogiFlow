# typeorm — Conventions

Naming and structural conventions for typeorm.

---

- Entities in `entities/` or `*.entity.ts` files
- Use DataSource configuration (not ormconfig.json)
- Always use migrations for schema changes
- Use QueryBuilder for complex queries, repository methods for simple ones

---

_Customize these conventions based on your team's preferences._
