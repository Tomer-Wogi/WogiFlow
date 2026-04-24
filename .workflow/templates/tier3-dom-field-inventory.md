# Tier-3 DOM Field Inventory Snapshot

**Purpose**: Structured template for Tier-3 (INTERACTIVE) verification of any UI surface that contains user-input fields — forms, filters, settings panels, search bars, wizards. Prevents "vanishing field" bugs where a field silently disappears during refactor.

**When to use**: Validating phase (see `.claude/docs/phases/04-verify.md`). Required for any task that:
- Modifies a form, filter group, wizard step, or settings section
- Adds / removes / renames a field in an existing UI
- Refactors a component whose children include `<input>`, `<select>`, `<textarea>`, or a custom input component

**Story**: wf-f9431ef6 (B3)
**Consumer**: `/wogi-start` validating phase, `/wogi-test-browser`, `flow-skeptical-evaluator.js`

---

## Protocol

### Step 1 — Before-change baseline (BEFORE any code changes)

Navigate to the page/component and capture the field inventory:

```
Page URL:       <url or route>
Component:      <top-level component path>
Captured at:    <ISO timestamp>

Fields (one row per input):
  1. name="<input name or data-testid>"
     label="<visible label text>"
     type=<text|email|password|select|checkbox|radio|textarea|custom>
     default=<default value>
     required=<yes|no>
     validation=<"min=3", "regex=...", or "none">
     visible=<yes|no (conditional rendering)>
     aria-label=<screen-reader label if different from label>

  2. ...
```

Save as: `.workflow/verifications/<taskId>/dom-inventory-before.md`

### Step 2 — After-change snapshot (AFTER implementation + lint/typecheck pass)

Re-navigate to the same page/component with the new code and capture the same schema.

Save as: `.workflow/verifications/<taskId>/dom-inventory-after.md`

### Step 3 — Diff and surface changes

For each field present in BEFORE:
- **preserved**: field still present with same name, label, type, validation → OK
- **modified**: field present but with different label / type / validation → REVIEW (was the change intentional?)
- **vanished**: field absent from AFTER → **CRITICAL** (unless intentional per the task spec)

For each field present in AFTER but not in BEFORE:
- **added**: new field → REVIEW (was it in the task spec? does it need validation?)

### Step 4 — Reconcile against the spec

Open the task spec (`.workflow/changes/*/<taskId>.md`) and check that every `vanished`, `modified`, and `added` field is explicitly named in an acceptance criterion.

If ANY change is NOT in the spec:
- STOP
- Surface the unplanned change to the user
- Either: (a) the change is unintentional → revert, (b) the change is correct but spec is stale → user approves the spec update

### Step 5 — Persist

Write the reconciliation report to `.workflow/verifications/<taskId>/dom-diff.md`:

```markdown
# DOM Field Diff — <taskId>

## Preserved (N)
  ✓ field-1 (label, type)
  ...

## Modified (N)
  ~ field-2: label changed "Foo" → "Bar" — PLANNED per AC-3
  ...

## Vanished (N)
  ✗ field-3 — UNEXPECTED; reverting / asking user

## Added (N)
  + field-4 (label, type) — PLANNED per AC-5
```

---

## Why this template exists

Prior incidents (see `feedback-patterns.md`): forms silently lost fields during component refactors. Lint, typecheck, and even smoke tests passed because the missing field had no consumer in the critical path. Users discovered the loss days later, sometimes after data was submitted with missing values.

Tier-3 field-inventory snapshots turn "silently vanished" into "mechanically diffable". The structured format makes it greppable and reviewable, not just narrative-memory.

---

## Configuration

- Template is referenced by path from phase docs; no config toggle.
- If a task's files contain `.tsx|.jsx|.vue|.svelte` and a form element, validating phase should prompt for this inventory.
- When using `/wogi-test-browser`, the MCP tool can produce the BEFORE / AFTER snapshots automatically.
