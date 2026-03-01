---
name: vitest
version: 1.0.0
description: "Vitest testing patterns with Vite-native speed"
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
context7: "/vitest-dev/vitest"
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

# vitest Skill

Vitest testing patterns with Vite-native speed.

## Triggers

- keywords: ["vitest","test","describe","it","expect","vi","mock","spy","beforeEach"]
- filePatterns: ["**/*.test.ts","**/*.test.tsx","**/*.spec.ts","vitest.config.*","vite.config.*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["testing"]

## When to Use

Load this skill when working with vitest in the project.
Matches files: **/*.test.ts, **/*.test.tsx, **/*.spec.ts, vitest.config.*, vite.config.*

## Quick Reference

### Key Patterns
- **In-Source Testing**: In-source tests are tree-shaken in production but run during testing
- **vi.mock for Module Mocking**: vi.mock hoists to the top of the file and replaces the module. Use factory function for custom implementations.

### Common Mistakes to Avoid
- **Not Using vi.clearAllMocks**: Mock state leaks between tests

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
