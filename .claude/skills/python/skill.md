---
name: python
version: 1.0.0
description: Python/FastAPI patterns and best practices
scope: project
user-invocable: true
context: inline
agent: developer
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash(python *)
  - Bash(pip *)
  - Bash(pytest *)
lastUpdated: 2026-01-11
learningCount: 0
successRate: 0
loadable: false
status: coming-soon
---

# Python Skill

Python/FastAPI patterns and best practices.

## Status

🚧 **Coming Soon** - This skill is under development.

## Triggers

- keywords: ["python", "pip", "django", "flask", "fastapi", "pytest", "pydantic", "sqlalchemy", "alembic", "uvicorn", "virtualenv", "poetry"]
- filePatterns: ["*.py", "requirements.txt", "setup.py", "pyproject.toml", "Pipfile"]
- taskTypes: ["feature", "bugfix", "refactor"]
- categories: ["python", "python-backend"]

## Planned Commands

| Command | Description |
|---------|-------------|
| `/python-endpoint [name]` | Create FastAPI endpoint |
| `/python-model [name]` | Create Pydantic model |
| `/python-test [name]` | Create pytest test |
| `/python-migration [name]` | Create Alembic migration |

## Planned Templates

- FastAPI router
- Pydantic model
- SQLAlchemy model
- Pytest test

## Contributing

Want to help build this skill? Create a PR with:
- Commands in `commands/`
- Rules in `rules/`
- Templates in `templates/`
