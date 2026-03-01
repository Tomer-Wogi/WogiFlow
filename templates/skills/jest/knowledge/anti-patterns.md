# jest — Anti-Patterns

Common mistakes to avoid when working with jest.

---

## Testing Implementation Details

**Problem**: Tests break on refactor even when behavior is preserved

**Fix**: Test behavior (inputs → outputs), not internal state or method calls

**Example**:
```
// Bad: expect(component.state.isOpen).toBe(true);
// Good: expect(screen.getByRole("dialog")).toBeVisible();
```

---

## Shared Mutable State Between Tests

**Problem**: Tests pass individually but fail when run together

**Fix**: Reset state in beforeEach, avoid global variables

**Example**:
```
beforeEach(() => {
  jest.clearAllMocks();
});
```

---

