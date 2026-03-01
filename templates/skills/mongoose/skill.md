---
name: mongoose
version: 1.0.0
description: "Mongoose ODM patterns for MongoDB"
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
context7: "/mongoosejs/mongoose"
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

# mongoose Skill

Mongoose ODM patterns for MongoDB.

## Triggers

- keywords: ["mongoose","schema","model","document","mongodb","findById","populate","aggregate","middleware"]
- filePatterns: ["models/**/*","schemas/**/*","*.model.ts","*.schema.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","database","nosql"]

## When to Use

Load this skill when working with mongoose in the project.
Matches files: models/**/*, schemas/**/*, *.model.ts, *.schema.ts

## Quick Reference

### Key Patterns
- **Schema with TypeScript**: Interface + Schema gives both runtime validation and compile-time type checking
- **Lean Queries for Read-Only**: lean() returns plain objects instead of Mongoose documents, skipping hydration overhead

### Common Mistakes to Avoid
- **Deep Population Chains**: populate("author").populate("author.posts").populate("author.posts.comments")

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
