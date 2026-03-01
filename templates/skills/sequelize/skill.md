---
name: sequelize
version: 1.0.0
description: "Sequelize ORM patterns, model definitions, and migrations"
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
context7: "/websites/sequelize_v6"
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

# sequelize Skill

Sequelize ORM patterns, model definitions, and migrations.

## Triggers

- keywords: ["sequelize","model","migration","association","findAll","findOne","create","update","transaction"]
- filePatterns: ["models/**/*","migrations/**/*","seeders/**/*",".sequelizerc"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","database","orm"]

## When to Use

Load this skill when working with sequelize in the project.
Matches files: models/**/*, migrations/**/*, seeders/**/*, .sequelizerc

## Quick Reference

### Key Patterns
- **Model Class Pattern**: Class-based models provide better TypeScript support and association clarity
- **Managed Transactions**: Auto-commits on success, auto-rollbacks on error

### Common Mistakes to Avoid
- **Forgetting Transaction Propagation**: Queries inside a transaction block not using the transaction object

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
