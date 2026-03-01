---
name: cypress
version: 1.0.0
description: "Cypress E2E and component testing patterns"
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
context7: "/cypress-io/cypress"
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

# cypress Skill

Cypress E2E and component testing patterns.

## Triggers

- keywords: ["cypress","cy","visit","get","click","type","should","intercept","fixture"]
- filePatterns: ["cypress/**/*","**/*.cy.ts","**/*.cy.tsx","cypress.config.*"]
- taskTypes: ["feature","bugfix"]
- categories: ["testing","e2e"]

## When to Use

Load this skill when working with cypress in the project.
Matches files: cypress/**/*, **/*.cy.ts, **/*.cy.tsx, cypress.config.*

## Quick Reference

### Key Patterns
- **Custom Commands for Reuse**: Custom commands reduce duplication and create a readable test DSL
- **Network Stubbing with Intercept**: Intercept isolates tests from backend, making them fast and deterministic

### Common Mistakes to Avoid
- **Using cy.wait(ms)**: Arbitrary timeouts make tests slow and flaky

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
