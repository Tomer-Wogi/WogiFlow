# typescript — Anti-Patterns

Common mistakes to avoid when working with typescript.

---

## Overusing any

**Problem**: Losing type safety

**Fix**: Use unknown for truly unknown types, then narrow with type guards

**Example**:
```
// Bad: function parse(data: any)
// Good: function parse(data: unknown): data is User
```

---

## Excessive Type Assertions

**Problem**: Forcing types with `as` hides real type errors

**Fix**: Fix the underlying type issue instead of asserting

**Example**:
```
// Bad: const user = data as User;
// Good: const user = parseUser(data); // validates and returns typed
```

---

