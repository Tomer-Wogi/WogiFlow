---
name: jest
version: 1.0.0
description: "Jest testing patterns, mocking, and assertions"
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
context7: "/nicepkg/jestjs.io"
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

# jest Skill

Jest testing patterns, mocking, and assertions.

## Triggers

- keywords: ["jest","test","describe","it","expect","mock","spy","beforeEach","afterEach","toEqual","toBe"]
- filePatterns: ["**/*.test.ts","**/*.test.tsx","**/*.spec.ts","**/*.spec.tsx","jest.config.*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["testing"]

## When to Use

Load this skill when working with jest in the project.
Matches files: **/*.test.ts, **/*.test.tsx, **/*.spec.ts, **/*.spec.tsx, jest.config.*

## Quick Reference

### Key Patterns
- **Arrange-Act-Assert**: Clear structure makes tests readable and maintainable
- **Module Mocking**: Module-level mocking replaces entire module implementations for isolation

### Common Mistakes to Avoid
- **Testing Implementation Details**: Tests break on refactor even when behavior is preserved
- **Shared Mutable State Between Tests**: Tests pass individually but fail when run together

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
