# next — Anti-Patterns

Common mistakes to avoid when working with next.

---

## Unnecessary "use client"

**Problem**: Adding "use client" to components that don't use hooks or browser APIs

**Fix**: Only mark components as client when they use useState, useEffect, onClick, etc.

**Example**:
```
// Bad: "use client" on a component that just renders props
// Good: Keep as Server Component, pass interactivity to small client children
```

---

## Fetching Data in Client Components

**Problem**: Using useEffect + fetch in client components when server fetch would work

**Fix**: Fetch data in Server Components or use Server Actions

**Example**:
```
// Bad: "use client" + useEffect(() => fetch("/api/users"))
// Good: Server Component with direct db/API call
```

---

## Not Revalidating After Mutations

**Problem**: Data appears stale after a mutation

**Fix**: Call revalidatePath() or revalidateTag() after Server Actions

**Example**:
```
revalidatePath("/dashboard"); // after mutation
```

---

