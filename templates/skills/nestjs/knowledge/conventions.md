# nestjs — Conventions

Naming and structural conventions for nestjs.

---

- One module per feature: UserModule, AuthModule, OrderModule
- File naming: user.controller.ts, user.service.ts, user.module.ts
- Use DTOs for all request/response shapes
- Inject services via constructor, not property injection
- Use Guards for auth, Pipes for validation, Interceptors for transformation

---

_Customize these conventions based on your team's preferences._
