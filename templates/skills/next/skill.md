---
name: next
version: 1.0.0
description: "Next.js App Router patterns, server components, and data fetching"
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
context7: "/vercel/next.js"
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

# next Skill

Next.js App Router patterns, server components, and data fetching.

## Triggers

- keywords: ["nextjs","next","app router","server component","client component","page","layout","middleware","api route","server action"]
- filePatterns: ["app/**/*.tsx","app/**/*.ts","pages/**/*.tsx","next.config.*","middleware.ts"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["frontend","fullstack","ssr"]

## When to Use

Load this skill when working with next in the project.
Matches files: app/**/*.tsx, app/**/*.ts, pages/**/*.tsx, next.config.*, middleware.ts

## Quick Reference

### Key Patterns
- **Server Components by Default**: Server Components send zero JS to the client, reducing bundle size and improving performance
- **Server Actions for Mutations**: Server Actions eliminate API route boilerplate for mutations and integrate with form elements
- **Layout Composition for Shared UI**: Layouts persist across navigations, avoiding re-renders and maintaining scroll position

### Common Mistakes to Avoid
- **Unnecessary "use client"**: Adding "use client" to components that don't use hooks or browser APIs
- **Fetching Data in Client Components**: Using useEffect + fetch in client components when server fetch would work
- **Not Revalidating After Mutations**: Data appears stale after a mutation

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
