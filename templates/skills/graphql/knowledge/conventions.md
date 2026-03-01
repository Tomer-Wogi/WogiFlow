# graphql — Conventions

Naming and structural conventions for graphql.

---

- Schema-first design: define .graphql files, then implement resolvers
- Use DataLoader for all batched data fetching
- Paginate collections: use cursor-based pagination (Relay spec)
- Input types for mutations: `input CreateUserInput { ... }`

---

_Customize these conventions based on your team's preferences._
