---
name: react
version: 1.0.0
description: "React component patterns, hooks, and state management"
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
context7: "/vercel/react.dev"
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

# react Skill

React component patterns, hooks, and state management.

## Triggers

- keywords: ["react","jsx","tsx","component","hook","useState","useEffect","useRef","useCallback","useMemo","useContext"]
- filePatterns: ["*.tsx","*.jsx","src/components/**","src/hooks/**"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["frontend","ui"]

## When to Use

Load this skill when working with react in the project.
Matches files: *.tsx, *.jsx, src/components/**, src/hooks/**

## Quick Reference

### Key Patterns
- **Custom Hooks for Reusable Logic**: Encapsulates logic, enables testing in isolation, promotes reuse across components
- **Composition Over Configuration**: Compound components give consumers full control over rendering while keeping state internal
- **Error Boundaries for Resilience**: Isolates failures to component subtrees, preserves the rest of the UI

### Common Mistakes to Avoid
- **Prop Drilling Through Many Layers**: Passing props through 3+ intermediate components that don't use them
- **useEffect for Derived State**: Using useEffect to sync state that could be computed during render
- **Missing Dependency Arrays**: Omitting or lying about useEffect dependencies

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
