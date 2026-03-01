---
description: "View and manage project coding rules"
---
View and manage project coding rules.

Usage:
- `/wogi-rules` - List all rules
- `/wogi-rules [name]` - View specific rule
- `/wogi-rules sync` - Sync decisions.md to .claude/rules/

## How Rules Work (v2.1.0)

Rules are **auto-generated** from `.workflow/state/decisions.md`:

```
decisions.md (Source of Truth)     .claude/rules/ (Auto-Generated)
  ├── ## Component Architecture   →  component-architecture.md
  ├── ## Coding Standards         →  coding-standards.md
  ├── ## API Patterns             →  api-patterns.md
  └── ## 2026-01-02               →  2026-01-02.md
```

**Key Points:**
- Edit `decisions.md` to add/change rules
- `.claude/rules/` is auto-generated (don't edit directly)
- Rules sync automatically when decisions.md changes
- Path-scoped rules only load when working on relevant files

## Manual Sync

If rules seem out of date:
```bash
node scripts/flow-rules-sync.js
```

Or use this command:
```
/wogi-rules sync
```

## Path Scoping

Rules are automatically scoped based on section keywords:

| Keyword in Section | Files Loaded For |
|--------------------|------------------|
| component, ui | `src/components/**/*` |
| api, backend | `src/api/**/*` |
| test, testing | `**/*.{test,spec}.*` |
| style, css | `**/*.{css,scss}` |
| database, entity | `src/**/*.entity.*` |

## Output - List

```
Project Rules

Source: .workflow/state/decisions.md

Generated Rules (.claude/rules/):
  - component-architecture.md (paths: src/components/**/*)
  - coding-standards.md
  - api-patterns.md (paths: src/api/**/*)
  - 2026-01-02.md

Last synced: 2026-01-08

Use: /wogi-rules [name] to view a rule
     /wogi-rules sync to regenerate rules
```

## Adding Rules

To add a new rule:

1. Add a new `## Section` to decisions.md:
   ```markdown
   ## API Validation

   - All API endpoints must validate input
   - Use Zod schemas for request validation
   - Return 400 for validation errors
   ```

2. Rules auto-sync on next decisions.md update, or run:
   ```
   /wogi-rules sync
   ```

## Execution

When user runs `/wogi-rules`:

1. List rules in `.claude/rules/`
2. Show source (decisions.md)
3. Show path scoping for each rule
4. Show last sync time

When user runs `/wogi-rules sync`:

1. Run `node scripts/flow-rules-sync.js`
2. Show updated rules

When user runs `/wogi-rules [name]`:

1. Read `.claude/rules/[name].md`
2. Display content
