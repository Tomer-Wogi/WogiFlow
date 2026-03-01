# typeorm — Anti-Patterns

Common mistakes to avoid when working with typeorm.

---

## Using synchronize: true in Production

**Problem**: Auto-sync can drop columns/tables

**Fix**: Always use migrations in production

**Example**:
```
// Bad: synchronize: true
// Good: synchronize: false + migration:run in CI
```

---

