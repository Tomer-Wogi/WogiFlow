---
name: docker
version: 1.0.0
description: "Docker patterns for containerization and multi-stage builds"
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
context7: "/docker/docs"
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

# docker Skill

Docker patterns for containerization and multi-stage builds.

## Triggers

- keywords: ["docker","dockerfile","container","image","compose","build","layer","multi-stage"]
- filePatterns: ["Dockerfile","Dockerfile.*","docker-compose.yml","docker-compose.yaml",".dockerignore"]
- taskTypes: ["feature","refactor"]
- categories: ["infrastructure","devops"]

## When to Use

Load this skill when working with docker in the project.
Matches files: Dockerfile, Dockerfile.*, docker-compose.yml, docker-compose.yaml, .dockerignore

## Quick Reference

### Key Patterns
- **Multi-Stage Build**: Build tools and source stay in builder stage, production image is minimal
- **Layer Caching for Dependencies**: Copying package files first lets Docker cache the npm install layer

### Common Mistakes to Avoid
- **Running as Root**: Container processes run as root by default
- **Using :latest Tag**: Builds are not reproducible

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
