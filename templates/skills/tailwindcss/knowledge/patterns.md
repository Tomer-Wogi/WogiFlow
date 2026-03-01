# tailwindcss — Successful Patterns

Best practices for working with tailwindcss.

---

## Utility-First with Component Extraction

**Context**: Managing repeated utility patterns

**Example**:
```
// Extract to component, not @apply
function Badge({ variant, children }) {
  const styles = {
    success: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
  };
  return <span className={`px-2 py-1 rounded text-sm ${styles[variant]}`}>{children}</span>;
}
```

**Why it works**: Component extraction > @apply. Keeps utilities in markup where Tailwind shines

---

## Responsive Mobile-First

**Context**: Building responsive layouts

**Example**:
```
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

**Why it works**: Mobile-first breakpoints (sm, md, lg, xl, 2xl) build up from small screens

---

