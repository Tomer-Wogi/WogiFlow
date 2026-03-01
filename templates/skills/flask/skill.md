---
name: flask
version: 1.0.0
description: "Flask application patterns, blueprints, and extensions"
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
context7: "/nicepkg/flask.palletsprojects.com"
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

# flask Skill

Flask application patterns, blueprints, and extensions.

## Triggers

- keywords: ["flask","blueprint","route","request","response","jsonify","app factory","sqlalchemy"]
- filePatterns: ["app.py","wsgi.py","**/*.py","templates/**/*.html"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","python","api"]

## When to Use

Load this skill when working with flask in the project.
Matches files: app.py, wsgi.py, **/*.py, templates/**/*.html

## Quick Reference

### Key Patterns
- **Application Factory**: Factory pattern enables testing with different configs and avoids circular imports
- **Blueprints for Modularity**: Blueprints allow splitting a large app into maintainable modules

### Common Mistakes to Avoid
- **Global App Object**: Importing app directly causes circular imports

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
