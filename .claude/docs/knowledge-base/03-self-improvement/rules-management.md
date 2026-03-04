# Rules Management

View, manage, and sync project coding rules between `decisions.md` and `.claude/rules/`.

---

## Purpose

WogiFlow auto-generates Claude Code rules from your project's `decisions.md` file. The `/wogi-rules` command lets you view current rules, inspect individual rules, and trigger a sync when rules are out of date.

---

## How It Works

Rules flow in one direction:

```
decisions.md (Source of Truth)  -->  .claude/rules/ (Auto-Generated)
  ## Component Architecture     -->    component-architecture.md
  ## Coding Standards           -->    coding-standards.md
  ## API Patterns               -->    api-patterns.md
```

**Key points:**
- Edit `.workflow/state/decisions.md` to add or change rules
- `.claude/rules/` files are auto-generated -- do not edit them directly
- Rules sync automatically when `decisions.md` changes
- Path-scoped rules only load when working on relevant files

**Script**: `scripts/flow-rules-sync.js`

---

## Commands

```bash
# List all rules
/wogi-rules

# View a specific rule
/wogi-rules <name>

# Sync decisions.md to .claude/rules/
/wogi-rules sync
```

Or via CLI:

```bash
node scripts/flow-rules-sync.js
```

---

## Path Scoping

Rules are automatically scoped to relevant files based on section keywords in `decisions.md`:

| Keyword in Section | Files Loaded For |
|--------------------|------------------|
| component, ui | `src/components/**/*` |
| api, backend | `src/api/**/*` |
| test, testing | `**/*.{test,spec}.*` |
| style, css | `**/*.{css,scss}` |
| database, entity | `src/**/*.entity.*` |

This means a rule about "API Patterns" only loads when you are editing files under `src/api/`, reducing noise for unrelated work.

---

## Adding Rules

To add a new rule:

1. Add a new `## Section` to `.workflow/state/decisions.md`:

```markdown
## API Validation

- All API endpoints must validate input
- Use Zod schemas for request validation
- Return 400 for validation errors
```

2. Sync rules (auto or manual):

```bash
/wogi-rules sync
```

The new section becomes a standalone rule file in `.claude/rules/`.

---

## Output Example

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

---

## When to Sync

Rules auto-sync when `decisions.md` is updated during normal workflow. Manual sync is useful when:

- You edited `decisions.md` outside of WogiFlow
- Rules seem out of date or stale
- After a bulk import of decisions from another project
- After running `/wogi-decide` to add a new coding standard

---

## Best Practices

1. **Edit decisions.md, not rules** -- Rules are generated artifacts; the source of truth is `decisions.md`
2. **Use descriptive section names** -- They determine path scoping and rule file names
3. **Include anti-patterns** -- Document what NOT to do alongside correct patterns
4. **Add code examples** -- Concrete examples make rules actionable
5. **Keep rules current** -- Remove outdated patterns during periodic review

---

## Related

- [Project Learning](./project-learning.md) - How decisions.md evolves from corrections
- [Skill Learning](./skill-learning.md) - Framework-level patterns
- [Configuration](../configuration/all-options.md) - All settings
