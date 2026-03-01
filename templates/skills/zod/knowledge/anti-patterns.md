# zod — Anti-Patterns

Common mistakes to avoid when working with zod.

---

## Duplicate Type + Schema

**Problem**: Maintaining separate TypeScript interface AND Zod schema

**Fix**: Define schema first, infer type: `type X = z.infer<typeof XSchema>`

**Example**:
```
// Bad: interface User { name: string } + z.object({ name: z.string() })
// Good: const UserSchema = z.object(...); type User = z.infer<typeof UserSchema>;
```

---

