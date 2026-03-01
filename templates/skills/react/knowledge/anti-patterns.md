# react — Anti-Patterns

Common mistakes to avoid when working with react.

---

## Prop Drilling Through Many Layers

**Problem**: Passing props through 3+ intermediate components that don't use them

**Fix**: Use React Context, Zustand, or component composition to avoid drilling

**Example**:
```
// Bad: <App user> → <Layout user> → <Sidebar user> → <UserMenu user>
// Good: const user = useUser(); // in UserMenu directly
```

---

## useEffect for Derived State

**Problem**: Using useEffect to sync state that could be computed during render

**Fix**: Compute derived values directly in the render function or useMemo

**Example**:
```
// Bad: useEffect(() => setFullName(first + " " + last), [first, last]);
// Good: const fullName = `${first} ${last}`;
```

---

## Missing Dependency Arrays

**Problem**: Omitting or lying about useEffect dependencies

**Fix**: Include all values used inside the effect. Use useCallback/useMemo to stabilize references

**Example**:
```
// Bad: useEffect(() => fetchData(id), []);
// Good: useEffect(() => fetchData(id), [id]);
```

---

