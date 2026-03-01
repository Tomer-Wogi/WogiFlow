---
name: hono
version: 1.0.0
description: "Hono web framework patterns for edge and serverless"
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
context7: "/nicepkg/hono.dev"
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

# hono Skill

Hono web framework patterns for edge and serverless.

## Triggers

- keywords: ["hono","middleware","router","edge","cloudflare workers","bun","deno"]
- filePatterns: ["src/**/*.ts","src/routes/**/*.ts","wrangler.toml"]
- taskTypes: ["feature","bugfix"]
- categories: ["backend","api","edge"]

## When to Use

Load this skill when working with hono in the project.
Matches files: src/**/*.ts, src/routes/**/*.ts, wrangler.toml

## Quick Reference

### Key Patterns
- **Type-Safe Routes**: Hono infers types through the chain, giving full type safety on client and server

### Common Mistakes to Avoid
- **Heavy Dependencies at the Edge**: Importing large Node.js packages in edge runtime

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
