---
name: typescript
version: 1.0.0
description: "TypeScript patterns, generics, and type utilities"
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
context7: "/microsoft/TypeScript"
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

# typescript Skill

TypeScript patterns, generics, and type utilities.

## Triggers

- keywords: ["typescript","ts","type","interface","generic","utility type","Partial","Pick","Omit","Record","enum"]
- filePatterns: ["tsconfig.json","**/*.ts","**/*.tsx","**/*.d.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["language","typing"]

## When to Use

Load this skill when working with typescript in the project.
Matches files: tsconfig.json, **/*.ts, **/*.tsx, **/*.d.ts

## Quick Reference

### Key Patterns
- **Discriminated Unions**: TypeScript narrows types based on the discriminant property, eliminating impossible states
- **Generic Constraints**: Constraints ensure generics only accept valid types, catching errors at compile time

### Common Mistakes to Avoid
- **Overusing any**: Losing type safety
- **Excessive Type Assertions**: Forcing types with `as` hides real type errors

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
