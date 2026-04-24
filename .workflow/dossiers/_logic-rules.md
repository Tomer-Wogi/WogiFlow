# Cross-Cutting Logic Rules

Business-logic rules that span multiple features / pages. Rules here are auto-loaded whenever any task touches files in a rule's scope. When a rule's enforcement-grep pattern appears anywhere in the repo it shouldn't, `flow logic-rules scan` surfaces it.

## Why this exists

Feature dossiers capture per-feature knowledge. Some rules span features — e.g., "every person in the system must have a seat" applies to Customer, Employee, Contact, Invite flows alike. Putting that rule in one feature's dossier means other features don't see it.

This file is the canonical home for cross-cutting rules.

## Format

Each rule is a level-2 heading `## RULE: <id>` followed by metadata and body:

```markdown
## RULE: every-person-needs-seat

<!-- id: every-person-needs-seat -->
<!-- status: active -->
<!-- created: 2026-03-20 -->

**Statement**: Every person in the system must have a seat (be a registered employee). No free-form contact-person records.

**Why**: Consistent permission/audit model. Contact persons without seats can't be assigned, can't log time, and create ghost records the owner has already asked to remove twice.

**Applies to**:
- pattern: src/**/Customer*Form*
- pattern: src/**/contact*
- keyword: contact person
- component: ContactPersonBlock

**Enforcement grep**: `ContactPersonBlock|contactPerson|contact_person`

**Origin**: wf-xxxxxxxx (customer page refactor, owner directive 2026-03-20)
```

Field semantics:

- **id** — kebab-case, unique across workspace + repo. Workspace rules shadow repo on collision.
- **status** — `active` or `deprecated`. Only active rules load + enforce.
- **Statement** — one sentence. What the rule is.
- **Why** — one sentence. The reason, usually an owner correction or incident.
- **Applies to** — file globs + keywords + components that scope the rule.
- **Enforcement grep** — regex used by `scan` (violation detection) and `propagate` (find other places the rule should apply). Optional, but without it the rule is advisory only.
- **Origin** — task ID or date where the rule came from.

## Rules

<!-- Add rules below. Start with "## RULE: <id>". -->
