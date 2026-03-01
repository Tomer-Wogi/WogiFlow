---
name: fastify
version: 1.0.0
description: "Fastify plugin patterns, schema validation, and hooks"
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
context7: "/fastify/fastify"
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

# fastify Skill

Fastify plugin patterns, schema validation, and hooks.

## Triggers

- keywords: ["fastify","plugin","schema","hook","route","decorateRequest","register"]
- filePatterns: ["routes/**/*.ts","plugins/**/*.ts","app.ts","server.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","api"]

## When to Use

Load this skill when working with fastify in the project.
Matches files: routes/**/*.ts, plugins/**/*.ts, app.ts, server.ts

## Quick Reference

### Key Patterns
- **Plugin Encapsulation**: Fastify plugins get their own encapsulated context, preventing cross-contamination
- **JSON Schema Validation**: Built-in schema validation is faster than middleware-based validation and auto-generates docs

### Common Mistakes to Avoid
- **Blocking the Event Loop**: Synchronous CPU-heavy work in route handlers

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
