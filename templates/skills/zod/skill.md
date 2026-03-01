---
name: zod
version: 1.0.0
description: "Zod schema validation and type inference"
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
context7: "/colinhacks/zod"
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

# zod Skill

Zod schema validation and type inference.

## Triggers

- keywords: ["zod","schema","parse","safeParse","infer","z.object","z.string","z.number","validation"]
- filePatterns: ["src/schemas/**/*","src/validators/**/*","*.schema.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["validation","typescript"]

## When to Use

Load this skill when working with zod in the project.
Matches files: src/schemas/**/*, src/validators/**/*, *.schema.ts

## Quick Reference

### Key Patterns
- **Schema-Driven Types**: z
- **safeParse for Error Handling**: safeParse returns a discriminated union — never throws, easy to handle

### Common Mistakes to Avoid
- **Duplicate Type + Schema**: Maintaining separate TypeScript interface AND Zod schema

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
