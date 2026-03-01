---
name: mocha
version: 1.0.0
description: "Mocha test framework patterns with chai assertions"
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
context7: "/mochajs/mocha"
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

# mocha Skill

Mocha test framework patterns with chai assertions.

## Triggers

- keywords: ["mocha","describe","it","before","after","beforeEach","afterEach","chai","expect","should"]
- filePatterns: ["test/**/*","**/*.test.js","**/*.spec.js",".mocharc.*"]
- taskTypes: ["feature","bugfix"]
- categories: ["testing"]

## When to Use

Load this skill when working with mocha in the project.
Matches files: test/**/*, **/*.test.js, **/*.spec.js, .mocharc.*

## Quick Reference

### Key Patterns
- **Nested Describe for Context**: Nested describes create readable test output grouped by context

### Common Mistakes to Avoid
- **Arrow Functions with this Context**: Arrow functions don't bind `this`, breaking Mocha's context

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
