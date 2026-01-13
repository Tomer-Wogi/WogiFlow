# Project Roadmap

Future work and deferred phases. Items here are ideas/plans, not yet refined into stories.

**Auto-managed by WogiFlow** - Items are added when large features are broken into phases.

---

## Now (Current Focus)

<!-- Items actively being worked on. Usually maps to stories in ready.json -->

---

## Next (Ready to Plan)

<!-- Items to tackle after current work. Ready to be promoted to stories. -->

---

## Later (Future Phases)

<!-- Deferred items from large feature breakdowns. Includes dependency tracking. -->

### Example: [Feature Name]

**Status:** Deferred
**Created:** YYYY-MM-DD
**Depends On:** [Parent phase or feature]

**Assumes:**
- [Key assumption that must remain true]
- [Another assumption]

**Key Files:**
- `path/to/file.ts` - [Why this file matters]
- `path/to/other.ts` - [Why this file matters]

**Context When Deferred:**
[Brief description of project state when this was deferred]

**Implementation Plan:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

---

## Ideas (Exploration)

<!-- Nice-to-have, not committed. No dependencies tracked yet. -->

---

## Completed

<!-- Archive of completed roadmap items for reference -->

---

## How This File Works

### Adding Items
- **Manually**: Edit this file directly
- **Via AI**: When you request a large feature, I'll ask if you want to defer phases here
- **Command**: `/wogi-roadmap add "Feature name" --phase=later`

### Promoting Items
When ready to implement a roadmap item:
1. Run `/wogi-roadmap promote "Feature name"`
2. I'll validate dependencies still hold
3. I'll create a story in ready.json

### Dependency Validation
Before implementing any item, I check:
- **Depends On**: Is the parent phase/feature complete?
- **Assumes**: Do assumptions still hold in current codebase?
- **Key Files**: Do required files exist with expected interfaces?

If validation fails, I'll explain what changed and offer options.
