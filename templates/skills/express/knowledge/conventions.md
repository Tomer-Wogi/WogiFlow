# express — Conventions

Naming and structural conventions for express.

---

- Use express.Router() for route modularization
- Error-handling middleware has 4 params: (err, req, res, next)
- Validate request body with zod/joi before processing
- Use helmet() for security headers, cors() for CORS
- Return consistent JSON shape: { data } or { error: { message, code } }

---

_Customize these conventions based on your team's preferences._
