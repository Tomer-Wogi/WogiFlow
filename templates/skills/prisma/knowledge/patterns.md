# prisma — Successful Patterns

Best practices for working with prisma.

---

## Singleton Prisma Client

**Context**: Preventing connection pool exhaustion in dev

**Example**:
```
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

**Why it works**: Hot reload in dev creates new PrismaClient instances, exhausting connections

---

## Select Only What You Need

**Context**: Optimizing query performance

**Example**:
```
const users = await prisma.user.findMany({
  select: { id: true, name: true, email: true },
});
```

**Why it works**: select reduces data transfer and prevents accidentally exposing sensitive fields

---

## Transactions for Multi-Step Operations

**Context**: Ensuring data consistency

**Example**:
```
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { name } });
  await tx.profile.create({ data: { userId: user.id } });
});
```

**Why it works**: Interactive transactions ensure all operations succeed or all are rolled back

---

