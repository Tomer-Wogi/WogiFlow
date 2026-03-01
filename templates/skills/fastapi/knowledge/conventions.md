# fastapi — Conventions

Naming and structural conventions for fastapi.

---

- Use Pydantic v2 models for request/response schemas
- Organize routers by feature in routers/ directory
- Use Depends() for dependency injection (auth, db sessions)
- Use async def for endpoints with async I/O, def for sync
- Use HTTPException for error responses

---

_Customize these conventions based on your team's preferences._
