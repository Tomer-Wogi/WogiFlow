---
name: django
version: 1.0.0
description: "Django models, views, and ORM patterns"
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
context7: "/django/django"
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

# django Skill

Django models, views, and ORM patterns.

## Triggers

- keywords: ["django","model","view","template","migration","admin","queryset","orm","serializer"]
- filePatterns: ["models.py","views.py","urls.py","admin.py","serializers.py","settings.py","manage.py"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","python","fullstack"]

## When to Use

Load this skill when working with django in the project.
Matches files: models.py, views.py, urls.py, admin.py, serializers.py, settings.py, manage.py

## Quick Reference

### Key Patterns
- **Fat Models, Thin Views**: Models are easier to test than views, and logic stays close to the data
- **select_related / prefetch_related**: Prevents N+1 queries when accessing related objects

### Common Mistakes to Avoid
- **Querying in Templates**: Template tags triggering database queries

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
