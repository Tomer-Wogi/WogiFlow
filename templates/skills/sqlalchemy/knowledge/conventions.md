# sqlalchemy — Conventions

Naming and structural conventions for sqlalchemy.

---

- Use Mapped[] type annotations (SQLAlchemy 2.0+)
- Session management via context managers or dependency injection
- Use Alembic for ALL migrations (never create_all in production)
- Prefer selectinload over lazy loading in async contexts

---

_Customize these conventions based on your team's preferences._
