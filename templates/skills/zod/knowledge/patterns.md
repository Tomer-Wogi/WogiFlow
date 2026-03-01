# zod — Successful Patterns

Best practices for working with zod.

---

## Schema-Driven Types

**Context**: Single source of truth for runtime validation + TS types

**Example**:
```
const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});
type User = z.infer<typeof UserSchema>;
```

**Why it works**: z.infer derives the TypeScript type from the schema — no duplicate definitions

---

## safeParse for Error Handling

**Context**: Validating without throwing

**Example**:
```
const result = UserSchema.safeParse(input);
if (!result.success) {
  return { errors: result.error.flatten().fieldErrors };
}
const user = result.data; // typed as User
```

**Why it works**: safeParse returns a discriminated union — never throws, easy to handle

---

