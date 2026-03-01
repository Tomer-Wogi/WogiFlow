---
name: nestjs
version: 1.0.0
description: "NestJS modules, controllers, services, and dependency injection"
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
context7: "/nicepkg/nestjs.com"
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

# nestjs Skill

NestJS modules, controllers, services, and dependency injection.

## Triggers

- keywords: ["nestjs","nest","controller","service","module","injectable","guard","pipe","interceptor","dto"]
- filePatterns: ["*.controller.ts","*.service.ts","*.module.ts","*.guard.ts","*.pipe.ts","*.dto.ts","nest-cli.json"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","api","enterprise"]

## When to Use

Load this skill when working with nestjs in the project.
Matches files: *.controller.ts, *.service.ts, *.module.ts, *.guard.ts, *.pipe.ts, *.dto.ts, nest-cli.json

## Quick Reference

### Key Patterns
- **Module-Scoped Architecture**: Each module encapsulates a feature with its own controllers, services, and entities
- **DTO Validation with class-validator**: Validation pipes automatically reject invalid requests before they reach service logic

### Common Mistakes to Avoid
- **Business Logic in Controllers**: Controllers handling data access and business rules
- **Circular Module Dependencies**: Module A imports Module B which imports Module A

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
