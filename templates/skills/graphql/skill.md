---
name: graphql
version: 1.0.0
description: "GraphQL schema design, resolvers, and client patterns"
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
context7: "/graphql/graphql-js"
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

# graphql Skill

GraphQL schema design, resolvers, and client patterns.

## Triggers

- keywords: ["graphql","query","mutation","subscription","resolver","schema","type","apollo","urql"]
- filePatterns: ["**/*.graphql","**/*.gql","schema.graphql","resolvers/**/*","typeDefs.*"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["api","fullstack"]

## When to Use

Load this skill when working with graphql in the project.
Matches files: **/*.graphql, **/*.gql, schema.graphql, resolvers/**/*, typeDefs.*

## Quick Reference

### Key Patterns
- **DataLoader for N+1 Prevention**: DataLoader batches and caches per-request, eliminating N+1 query problems in resolvers

### Common Mistakes to Avoid
- **Deeply Nested Queries Without Limits**: Clients can query infinite depth, causing performance issues

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
