Quick capture an idea or bug without interrupting your current work. Provide a brief title: `/wogi-capture Add dark mode toggle`

**v2.0**: Now with **Auto-Grouping** - related ideas stay together, unrelated ideas split into separate captures.

## Usage

```bash
/wogi-capture "Your idea or bug here"
/wogi-capture "Bug: login fails on Safari"
```

Just provide a brief title. That's it.

## Auto-Grouping (v2.0)

When you capture multiple related items at once, they're automatically grouped:

```
/wogi-capture "change send button to blue, change cancel button to blue, change delete button to blue"
→ ONE capture: "Update button colors" (3 items grouped)

/wogi-capture "fix login bug, add dark mode, update footer"
→ THREE captures (unrelated items split)

/wogi-capture "change header to blue, change footer to blue, fix the login bug"
→ TWO captures: color changes grouped, bug fix separate
```

### Grouping Heuristics

Items are grouped when they share:
- **Same action type**: color changes, size changes, text updates
- **Same target**: button, header, form, etc.
- **Same item type**: bugs with bugs, features with features

### Disable Grouping

Use `--no-group` to create separate items without grouping:
```bash
/wogi-capture "change all buttons to blue, fix the form" --no-group
→ TWO captures (no grouping applied)
```

Or disable globally in config:
```json
{
  "capture": {
    "autoGroup": false
  }
}
```

## What Happens

1. **Parse input** - Split by commas, "and", numbered lists
2. **Analyze items** - Extract action type, target component, item type
3. **Group related** - Combine similar items above threshold
4. **Auto-detect type** from keywords:
   - "bug", "fix", "broken", "error", "crash", "fails" → `bug`
   - Everything else → `feature`
5. **Auto-tag** from current context (if a task is in progress)
6. **Add to backlog** in `ready.json` with minimal metadata

## Backlog Triage

Items go to a `backlog` array in ready.json. Use `/wogi-ready` to see them.

Later you can:
- Promote to `ready` (use `/wogi-story` to create proper story)
- Discard if no longer relevant
- Convert to bug with `/wogi-bug`

## Examples

```
/wogi-capture Add export to PDF
→ Captured: Add export to PDF (feature)

/wogi-capture Bug: form validation not working
→ Captured: Bug: form validation not working (bug)

/wogi-capture Broken image on profile page
→ Captured: Broken image on profile page (bug)

/wogi-capture "update header color, update footer color, add logout button"
→ Captured 2 items:
  • Update header/footer colors (2 items grouped)
  • add logout button
```

## CLI Usage

```bash
node scripts/flow-capture.js "Add dark mode toggle"
node scripts/flow-capture.js "Bug: login fails" --json
node scripts/flow-capture.js "change all buttons" --no-group
```

## Options

- `--type <type>` - Force type (bug/feature) instead of auto-detect
- `--tags <tags>` - Add comma-separated tags
- `--json` - Output JSON instead of minimal confirmation
- `--no-group` - Disable auto-grouping (create separate items)

## Configuration

In `config.json`:
```json
{
  "capture": {
    "autoGroup": true,         // Enable/disable auto-grouping
    "groupingThreshold": 0.5,  // Similarity threshold (0-1)
    "maxGroupSize": 5          // Max items per group
  }
}
```
