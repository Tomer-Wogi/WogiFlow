# pytest — Successful Patterns

Best practices for working with pytest.

---

## Fixtures for Setup/Teardown

**Context**: Reusable test dependencies

**Example**:
```
@pytest.fixture
async def db_session():
    session = await create_test_session()
    yield session
    await session.rollback()
    await session.close()

async def test_create_user(db_session):
    user = User(name="Alice")
    db_session.add(user)
    await db_session.flush()
    assert user.id is not None
```

**Why it works**: Fixtures handle setup/teardown, are composable, and scoped (function/class/module/session)

---

## Parametrize for Data-Driven Tests

**Context**: Testing multiple inputs

**Example**:
```
@pytest.mark.parametrize("input,expected", [
    ("hello", 5),
    ("", 0),
    ("a b c", 5),
])
def test_length(input, expected):
    assert len(input) == expected
```

**Why it works**: One test function covers multiple cases without code duplication

---

