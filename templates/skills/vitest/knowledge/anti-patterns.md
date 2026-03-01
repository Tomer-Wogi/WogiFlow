# vitest — Anti-Patterns

Common mistakes to avoid when working with vitest.

---

## Not Using vi.clearAllMocks

**Problem**: Mock state leaks between tests

**Fix**: Use beforeEach(() => vi.clearAllMocks())

**Example**:
```
beforeEach(() => { vi.clearAllMocks(); });
```

---

