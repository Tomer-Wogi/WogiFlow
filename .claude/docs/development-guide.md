# WogiFlow Development Guide

Rules and practices for developing WogiFlow itself. These apply when working on the WogiFlow codebase, not when using WogiFlow on other projects.

## Testing Practices

### Always Use `--dry-run` When Testing Task Features (2026-01-30)

**Background**: Orphaned test tasks polluted the production queue for 11 days because Claude tested `flow story --deep` with a generic title and didn't clean up.

**Rule**: When testing WogiFlow task/story features:

1. **ALWAYS use `--dry-run` first**
   ```bash
   flow story "Test title" --deep --dry-run  # Preview only, no files created
   ```

2. **If you must create real test tasks**:
   - Use obviously test-like titles: `[TEST] ...` or `TEST: ...`
   - Clean up IMMEDIATELY after verifying the feature works:
     - Delete files from `.workflow/changes/`
     - Remove entries from `.workflow/state/ready.json`

3. **After ANY testing session**, verify cleanup:
   ```bash
   # Check for orphaned test tasks
   grep -i "test\|example\|sample" .workflow/state/ready.json

   # Check for unrelated tasks (e.g., "authentication", "login form" in a CLI tool project)
   cat .workflow/state/ready.json | grep title
   ```

4. **Morning briefing check**: If `/wogi-morning` shows tasks unrelated to WogiFlow (like "Add authentication flow"), these are orphaned test tasks - remove them immediately.

### Why This Matters

- Test tasks showing up in morning briefing breaks user trust
- They waste time investigating "what is this task I didn't create?"
- Orphaned tasks can sit in the queue for days/weeks if not caught

---

## Distinguishing Project vs WogiFlow Changes

When making changes during WogiFlow development, classify where they belong:

| Change Type | Where It Goes | Example |
|-------------|---------------|---------|
| WogiFlow feature/fix | Codebase (`scripts/`, `.claude/docs/`) | New `--dry-run` flag |
| WogiFlow documentation | Codebase (`.claude/docs/`, `README`) | Command help text |
| Project-specific rule | `.workflow/state/decisions.md` | "Use kebab-case in this project" |
| End-user guidance | `CLAUDE.md` template | Task gating instructions |

**Key question**: "Would this be useful to someone installing WogiFlow fresh on a new project?"
- **Yes** → Goes in the codebase (gets distributed with WogiFlow)
- **No** → Goes in `.workflow/state/` (project-specific, gitignored)

### Examples

**Goes in codebase** (distributed):
- "Use `--dry-run` when testing task features" - applies to anyone developing WogiFlow
- Security patterns in `.claude/rules/security/` - applies to all WogiFlow code
- Command documentation - helps all users

**Goes in project state** (not distributed):
- "We use PostgreSQL for this project" - specific to one project
- "Component naming convention for our design system" - project-specific
- Business rules from user feedback - unique to their project

---

## Test Data Isolation

When testing features that create persistent state:

1. **Prefer dry-run/preview modes** when available
2. **Use test-specific identifiers** that are easy to grep and clean up
3. **Clean up in the same session** - don't leave it for "later"
4. **Verify cleanup** - check that state files don't contain test data

---

## Adding New Development Rules

When you learn something important about developing WogiFlow:

1. **Check if it belongs here** - Is it about developing WogiFlow itself?
2. **Add it to this file** - With date and context
3. **Commit it** - So future sessions have access
4. **Don't add to `decisions.md`** - That's for end-user project rules
