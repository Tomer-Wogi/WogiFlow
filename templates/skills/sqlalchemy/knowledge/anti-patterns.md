# sqlalchemy — Anti-Patterns

Common mistakes to avoid when working with sqlalchemy.

---

## Lazy Loading in Async Context

**Problem**: Lazy-loaded relationships fail in async sessions

**Fix**: Use selectinload() or joinedload() for eager loading

**Example**:
```
# Bad: user.posts (triggers lazy load, fails in async)
# Good: select(User).options(selectinload(User.posts))
```

---

