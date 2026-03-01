---
name: tailwindcss
version: 1.0.0
description: "Tailwind CSS utility patterns and responsive design"
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
context7: "/nicepkg/tailwindcss.com"
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

# tailwindcss Skill

Tailwind CSS utility patterns and responsive design.

## Triggers

- keywords: ["tailwind","tailwindcss","className","utility","responsive","dark mode","cn","clsx"]
- filePatterns: ["tailwind.config.*","*.tsx","*.jsx","*.vue","*.svelte"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["frontend","css","styling"]

## When to Use

Load this skill when working with tailwindcss in the project.
Matches files: tailwind.config.*, *.tsx, *.jsx, *.vue, *.svelte

## Quick Reference

### Key Patterns
- **Utility-First with Component Extraction**: Component extraction > @apply
- **Responsive Mobile-First**: Mobile-first breakpoints (sm, md, lg, xl, 2xl) build up from small screens

### Common Mistakes to Avoid
- **Overusing @apply**: Moving all utilities into CSS files defeats the purpose of Tailwind
- **Arbitrary Values Everywhere**: Using arbitrary values like `w-[347px]` instead of design tokens

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
