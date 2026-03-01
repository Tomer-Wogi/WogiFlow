---
name: fastapi
version: 1.0.0
description: "FastAPI async patterns, dependency injection, and Pydantic models"
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
context7: "/tiangolo/fastapi"
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

# fastapi Skill

FastAPI async patterns, dependency injection, and Pydantic models.

## Triggers

- keywords: ["fastapi","pydantic","async","await","Depends","router","BaseModel","HTTPException","uvicorn"]
- filePatterns: ["main.py","routers/**/*.py","models/**/*.py","schemas/**/*.py","dependencies/**/*.py"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","python","api","async"]

## When to Use

Load this skill when working with fastapi in the project.
Matches files: main.py, routers/**/*.py, models/**/*.py, schemas/**/*.py, dependencies/**/*.py

## Quick Reference

### Key Patterns
- **Dependency Injection**: Dependencies are composable, testable, and automatically resolved by FastAPI
- **Pydantic Response Models**: response_model auto-serializes, validates, and documents the response schema

### Common Mistakes to Avoid
- **Blocking Calls in Async Endpoints**: Calling sync functions in async def blocks the event loop

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
