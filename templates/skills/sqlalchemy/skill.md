---
name: sqlalchemy
version: 1.0.0
description: "SQLAlchemy ORM and Core patterns"
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
context7: "/sqlalchemy/sqlalchemy"
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

# sqlalchemy Skill

SQLAlchemy ORM and Core patterns.

## Triggers

- keywords: ["sqlalchemy","session","engine","model","query","relationship","column","Base","declarative"]
- filePatterns: ["models/**/*.py","database.py","db.py","alembic/**/*","alembic.ini"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","python","database","orm"]

## When to Use

Load this skill when working with sqlalchemy in the project.
Matches files: models/**/*.py, database.py, db.py, alembic/**/*, alembic.ini

## Quick Reference

### Key Patterns
- **Session-Per-Request**: One session per request ensures proper transaction boundaries and cleanup
- **Alembic for Migrations**: Alembic tracks schema changes in version-controlled migration files

### Common Mistakes to Avoid
- **Lazy Loading in Async Context**: Lazy-loaded relationships fail in async sessions

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
