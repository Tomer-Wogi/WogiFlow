---
name: express
version: 1.0.0
description: "Express.js middleware patterns, error handling, and routing"
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
context7: "/expressjs/express"
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

# express Skill

Express.js middleware patterns, error handling, and routing.

## Triggers

- keywords: ["express","middleware","router","req","res","next","app.use","app.get","app.post"]
- filePatterns: ["routes/**/*.js","routes/**/*.ts","middleware/**/*","app.js","app.ts","server.js","server.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["backend","api"]

## When to Use

Load this skill when working with express in the project.
Matches files: routes/**/*.js, routes/**/*.ts, middleware/**/*, app.js, app.ts, server.js, server.ts

## Quick Reference

### Key Patterns
- **Centralized Error Handler**: Single error handler prevents duplicate error formatting across routes
- **Async Handler Wrapper**: Forwards unhandled promise rejections to the error handler middleware
- **Router Modularization**: Keeps route files focused and manageable as the API grows

### Common Mistakes to Avoid
- **Not Calling next() in Middleware**: Request hangs because middleware doesn't call next()
- **Swallowing Errors in Async Routes**: Unhandled promise rejections crash the server

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
