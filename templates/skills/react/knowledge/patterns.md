# react — Successful Patterns

Best practices for working with react.

---

## Custom Hooks for Reusable Logic

**Context**: Extracting shared stateful logic

**Example**:
```
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
```

**Why it works**: Encapsulates logic, enables testing in isolation, promotes reuse across components

---

## Composition Over Configuration

**Context**: Building flexible UI components

**Example**:
```
<Card>
  <Card.Header>{title}</Card.Header>
  <Card.Body>{children}</Card.Body>
</Card>
```

**Why it works**: Compound components give consumers full control over rendering while keeping state internal

---

## Error Boundaries for Resilience

**Context**: Preventing full-page crashes from component errors

**Example**:
```
<ErrorBoundary fallback={<ErrorFallback />}>
  <FeatureComponent />
</ErrorBoundary>
```

**Why it works**: Isolates failures to component subtrees, preserves the rest of the UI

---

