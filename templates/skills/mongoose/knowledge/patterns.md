# mongoose — Successful Patterns

Best practices for working with mongoose.

---

## Schema with TypeScript

**Context**: Type-safe Mongoose models

**Example**:
```
interface IUser { name: string; email: string; }
const userSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, unique: true },
});
export const User = model<IUser>("User", userSchema);
```

**Why it works**: Interface + Schema gives both runtime validation and compile-time type checking

---

## Lean Queries for Read-Only

**Context**: Performance optimization

**Example**:
```
const users = await User.find().lean();
```

**Why it works**: lean() returns plain objects instead of Mongoose documents, skipping hydration overhead

---

