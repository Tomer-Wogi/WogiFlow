# typescript — Successful Patterns

Best practices for working with typescript.

---

## Discriminated Unions

**Context**: Modeling mutually exclusive states

**Example**:
```
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: Error };

function handle(r: Result<User>) {
  if (r.ok) r.data; // narrowed to User
  else r.error; // narrowed to Error
}
```

**Why it works**: TypeScript narrows types based on the discriminant property, eliminating impossible states

---

## Generic Constraints

**Context**: Type-safe generic functions

**Example**:
```
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

**Why it works**: Constraints ensure generics only accept valid types, catching errors at compile time

---

