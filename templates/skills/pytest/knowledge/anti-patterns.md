# pytest — Anti-Patterns

Common mistakes to avoid when working with pytest.

---

## Overly Broad Fixtures

**Problem**: Session-scoped fixtures that set up too much

**Fix**: Use function-scoped fixtures by default, session-scope only for expensive setup

**Example**:
```
# Bad: @pytest.fixture(scope="session") for mutable state
# Good: @pytest.fixture (defaults to function scope)
```

---

