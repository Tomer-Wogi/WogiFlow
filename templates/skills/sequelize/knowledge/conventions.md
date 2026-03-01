# sequelize — Conventions

Naming and structural conventions for sequelize.

---

- Use migrations for ALL schema changes (never sync in production)
- Define associations in a static `associate()` method
- Use scopes for reusable query filters
- Always pass transaction objects through nested operations

---

_Customize these conventions based on your team's preferences._
