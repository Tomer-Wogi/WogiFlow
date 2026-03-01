---
name: playwright
version: 1.0.0
description: "Playwright E2E testing patterns and page object model"
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
context7: "/nicepkg/playwright.dev"
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

# playwright Skill

Playwright E2E testing patterns and page object model.

## Triggers

- keywords: ["playwright","test","page","browser","locator","expect","toBeVisible","toHaveText","e2e"]
- filePatterns: ["**/*.spec.ts","tests/**/*.ts","playwright.config.ts","e2e/**/*.ts"]
- taskTypes: ["feature","bugfix"]
- categories: ["testing","e2e"]

## When to Use

Load this skill when working with playwright in the project.
Matches files: **/*.spec.ts, tests/**/*.ts, playwright.config.ts, e2e/**/*.ts

## Quick Reference

### Key Patterns
- **Locator-First Approach**: Role-based locators are resilient to DOM changes and match how users find elements
- **Page Object Model**: Encapsulates page interactions, making tests maintainable when UI changes

### Common Mistakes to Avoid
- **Hard-Coded Waits**: Using page.waitForTimeout(5000) instead of proper assertions
- **CSS/XPath Selectors**: Fragile selectors tied to DOM structure

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
