# sqlalchemy — Successful Patterns

Best practices for working with sqlalchemy.

---

## Session-Per-Request

**Context**: Managing database sessions in web apps

**Example**:
```
async def get_db():
    async with async_session() as session:
        yield session

@router.get("/users")
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    return result.scalars().all()
```

**Why it works**: One session per request ensures proper transaction boundaries and cleanup

---

## Alembic for Migrations

**Context**: Schema evolution

**Example**:
```
# alembic revision --autogenerate -m "add users table"
# alembic upgrade head
```

**Why it works**: Alembic tracks schema changes in version-controlled migration files

---

