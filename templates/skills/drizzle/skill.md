---
name: drizzle
version: 1.0.0
description: "Drizzle ORM type-safe SQL patterns"
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
context7: "/drizzle-team/drizzle-orm"
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

# drizzle Skill

Drizzle ORM type-safe SQL patterns.

## Triggers

- keywords: ["drizzle","drizzle-orm","pgTable","mysqlTable","sqliteTable","select","insert","schema"]
- filePatterns: ["drizzle.config.ts","src/db/**/*","src/schema/**/*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","database","orm"]

## When to Use

Load this skill when working with drizzle in the project.
Matches files: drizzle.config.ts, src/db/**/*, src/schema/**/*

## Quick Reference

### Key Patterns
- **Schema-First Type Safety**: Table definitions ARE the TypeScript types — no separate interface needed
- **Relational Queries**: Drizzle generates optimized JOINs from declarative relation queries

### Common Mistakes to Avoid
- **Not Using Prepared Statements**: Re-preparing the same query on every call

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
