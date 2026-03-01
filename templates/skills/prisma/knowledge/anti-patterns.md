# prisma — Anti-Patterns

Common mistakes to avoid when working with prisma.

---

## N+1 Queries

**Problem**: Looping and querying inside a loop

**Fix**: Use include/select with relations, or findMany with where-in

**Example**:
```
// Bad: for (const user of users) { await prisma.post.findMany({ where: { userId: user.id } }); }
// Good: await prisma.user.findMany({ include: { posts: true } });
```

---

## Raw SQL Without Parameterization

**Problem**: SQL injection via string interpolation in $queryRaw

**Fix**: Use Prisma.sql tagged template or $queryRaw with template literals

**Example**:
```
// Bad: prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${id}`)
// Good: prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`
```

---

