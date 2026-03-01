---
name: vue
version: 1.0.0
description: "Vue 3 Composition API patterns and component design"
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
context7: "/vuejs/docs"
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

# vue Skill

Vue 3 Composition API patterns and component design.

## Triggers

- keywords: ["vue","vue3","composition api","ref","reactive","computed","watch","pinia","nuxt"]
- filePatterns: ["*.vue","src/components/**/*.vue","src/composables/**/*.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["frontend","ui"]

## When to Use

Load this skill when working with vue in the project.
Matches files: *.vue, src/components/**/*.vue, src/composables/**/*.ts

## Quick Reference

### Key Patterns
- **Composables for Shared Logic**: Composables are Vue's equivalent of React hooks — testable, composable units of logic
- **Script Setup for Cleaner Components**: Less boilerplate than Options API, better TypeScript inference, auto-exposed to template

### Common Mistakes to Avoid
- **Mutating Props Directly**: Changing prop values inside child components
- **Reactive Destructuring Without toRefs**: Destructuring reactive objects loses reactivity

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
