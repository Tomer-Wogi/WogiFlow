---
name: svelte
version: 1.0.0
description: "Svelte 5 runes, component patterns, and SvelteKit"
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
context7: "/nicepkg/svelte.dev"
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

# svelte Skill

Svelte 5 runes, component patterns, and SvelteKit.

## Triggers

- keywords: ["svelte","sveltekit","rune","$state","$derived","$effect","store","+page","+layout"]
- filePatterns: ["*.svelte","+page.svelte","+layout.svelte","+server.ts","svelte.config.*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["frontend","ui"]

## When to Use

Load this skill when working with svelte in the project.
Matches files: *.svelte, +page.svelte, +layout.svelte, +server.ts, svelte.config.*

## Quick Reference

### Key Patterns
- **Runes for Reactive State (Svelte 5)**: Runes make reactivity explicit and work anywhere (not just 
- **SvelteKit Load Functions**: Load functions run on the server, keeping secrets safe and enabling SSR

### Common Mistakes to Avoid
- **Mutating $state Arrays Indirectly**: Push/splice on $state arrays may not trigger updates

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
