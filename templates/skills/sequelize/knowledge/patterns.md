# sequelize — Successful Patterns

Best practices for working with sequelize.

---

## Model Class Pattern

**Context**: Defining models with TypeScript

**Example**:
```
class User extends Model<UserAttributes, UserCreationAttributes> {
  declare id: number;
  declare name: string;
  static associate(models) {
    User.hasMany(models.Post);
  }
}
```

**Why it works**: Class-based models provide better TypeScript support and association clarity

---

## Managed Transactions

**Context**: Ensuring atomicity

**Example**:
```
await sequelize.transaction(async (t) => {
  const user = await User.create({ name }, { transaction: t });
  await Profile.create({ userId: user.id }, { transaction: t });
});
```

**Why it works**: Auto-commits on success, auto-rollbacks on error

---

