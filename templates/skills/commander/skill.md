---
name: commander
version: 1.0.0
description: "Commander.js CLI framework patterns and option parsing"
scope: project
user-invocable: false
context: inline
agent: developer
memory: project
license: MIT
compatibility: "Claude Code 2.1+"
source: prebuilt
prebuiltVersion: "1.0.0"
lastDocCheck: "2026-03-02"
context7: "/tj/commander.js"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
lastUpdated: "2026-03-02"
learningCount: 0
successRate: 0
---

# commander Skill

Commander.js CLI framework patterns and option parsing.

## Triggers

- keywords: ["commander","cli","command","option","argument","subcommand","program","parse","argv"]
- filePatterns: ["**/cli.js","**/cli.ts","**/bin/*","**/commands/**"]
- taskTypes: ["feature","bugfix","refactor"]
- categories: ["cli","framework"]

## When to Use

Load this skill when building CLI tools with Commander.js.
Matches files: cli.js, cli.ts, bin/*, commands/**

## Quick Reference

### Key Patterns
- **Subcommand Architecture**: Use `.command()` with `.action()` for clean multi-command CLIs
- **Option Parsing**: Use `.option()` with defaults, `.requiredOption()` for mandatory flags
- **Variadic Arguments**: Use `<args...>` for collecting multiple positional arguments

### Common Mistakes to Avoid
- **Forgetting `.parse()`**: Commander won't execute without `program.parse()` at the end
- **Mixing .action() with direct program logic**: Use subcommands consistently

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
