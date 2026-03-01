# fastify — Conventions

Naming and structural conventions for fastify.

---

- Use plugins for encapsulation (one plugin per feature)
- Define JSON schemas for all routes (body, params, querystring, response)
- Use decorateRequest/decorateReply for shared request context
- Register plugins with `fastify-plugin` when sharing across encapsulation contexts

---

_Customize these conventions based on your team's preferences._
