---
name: eslint
version: 1.0.0
description: "ESLint configuration patterns and custom rules"
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
context7: "/nicepkg/eslint.org"
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

# eslint Skill

ESLint configuration patterns and custom rules.

## Triggers

- keywords: ["eslint","lint","rule","config","plugin","extends","flat config"]
- filePatterns: ["eslint.config.*",".eslintrc.*",".eslintignore"]
- taskTypes: ["feature","refactor"]
- categories: ["tooling","quality"]

## When to Use

Load this skill when working with eslint in the project.
Matches files: eslint.config.*, .eslintrc.*, .eslintignore

## Quick Reference

### Key Patterns
- **Flat Config (ESLint 9+)**: Flat config is simpler, more composable, and the future of ESLint

### Common Mistakes to Avoid
- **Disabling Rules Inline Without Reason**: // eslint-disable-next-line scattered everywhere

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
