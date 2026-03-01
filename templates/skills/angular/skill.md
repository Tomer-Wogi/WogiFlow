---
name: angular
version: 1.0.0
description: "Angular component patterns, signals, and dependency injection"
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
context7: "/nicepkg/angular.dev"
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

# angular Skill

Angular component patterns, signals, and dependency injection.

## Triggers

- keywords: ["angular","component","service","module","directive","pipe","signal","injectable","rxjs"]
- filePatterns: ["*.component.ts","*.service.ts","*.module.ts","*.directive.ts","*.pipe.ts","angular.json"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["frontend","enterprise"]

## When to Use

Load this skill when working with angular in the project.
Matches files: *.component.ts, *.service.ts, *.module.ts, *.directive.ts, *.pipe.ts, angular.json

## Quick Reference

### Key Patterns
- **Signals for Reactive State**: Signals provide fine-grained reactivity without RxJS complexity for simple state
- **Smart/Dumb Component Pattern**: Improves testability and reusability of presentation components

### Common Mistakes to Avoid
- **Subscribing Without Unsubscribing**: Memory leaks from uncleaned RxJS subscriptions
- **God Services**: Services with too many responsibilities

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
