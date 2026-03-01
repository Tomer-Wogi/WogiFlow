---
name: prisma
version: 1.0.0
description: "Prisma ORM patterns, schema design, and query optimization"
scope: project
user-invocable: false
context: inline
agent: developer
memory: project
license: MIT
compatibility: "Claude Code 2.1+"
source: prebuilt
prebuiltVersion: "1.0.0"
lastDocCheck: "2026-03-01"
context7: "/prisma/prisma"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
lastUpdated: "2026-03-01"
learningCount: 0
successRate: 0
---

# prisma Skill

Prisma ORM patterns, schema design, and query optimization.

## Triggers

- keywords: ["prisma","prisma client","schema","migration","findMany","findUnique","create","update","include","select"]
- filePatterns: ["prisma/schema.prisma","prisma/migrations/**","src/**/*.ts","lib/db.*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","database","orm"]

## When to Use

Load this skill when working with prisma in the project.
Matches files: prisma/schema.prisma, prisma/migrations/**, src/**/*.ts, lib/db.*

## Quick Reference

### Key Patterns
- **Singleton Prisma Client**: Hot reload in dev creates new PrismaClient instances, exhausting connections
- **Select Only What You Need**: select reduces data transfer and prevents accidentally exposing sensitive fields
- **Transactions for Multi-Step Operations**: Interactive transactions ensure all operations succeed or all are rolled back

### Common Mistakes to Avoid
- **N+1 Queries**: Looping and querying inside a loop
- **Raw SQL Without Parameterization**: SQL injection via string interpolation in $queryRaw

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
