# sequelize — Anti-Patterns

Common mistakes to avoid when working with sequelize.

---

## Forgetting Transaction Propagation

**Problem**: Queries inside a transaction block not using the transaction object

**Fix**: Pass `{ transaction: t }` to every query inside the transaction

**Example**:
```
// Bad: await User.create({ name }); // inside transaction block
// Good: await User.create({ name }, { transaction: t });
```

---

