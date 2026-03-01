---
name: typeorm
version: 1.0.0
description: "TypeORM entity patterns, repositories, and migrations"
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
context7: "/typeorm/typeorm"
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

# typeorm Skill

TypeORM entity patterns, repositories, and migrations.

## Triggers

- keywords: ["typeorm","entity","repository","migration","column","relation","OneToMany","ManyToOne","QueryBuilder"]
- filePatterns: ["*.entity.ts","migration/**/*","ormconfig.*","data-source.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","database","orm"]

## When to Use

Load this skill when working with typeorm in the project.
Matches files: *.entity.ts, migration/**/*, ormconfig.*, data-source.ts

## Quick Reference

### Key Patterns
- **Entity with Relations**: Decorator-based entities provide clear mapping between TS classes and DB tables

### Common Mistakes to Avoid
- **Using synchronize: true in Production**: Auto-sync can drop columns/tables

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
