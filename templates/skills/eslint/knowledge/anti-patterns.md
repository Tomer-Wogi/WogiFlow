# eslint — Anti-Patterns

Common mistakes to avoid when working with eslint.

---

## Disabling Rules Inline Without Reason

**Problem**: // eslint-disable-next-line scattered everywhere

**Fix**: Fix the underlying issue or adjust the rule configuration

**Example**:
```
// Bad: // eslint-disable-next-line no-any
// Good: Fix the type, or if truly needed, add a comment explaining why
```

---

