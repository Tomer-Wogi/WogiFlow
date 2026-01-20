Quick capture an idea or bug without interrupting your current work. Provide a brief title: `/wogi-capture Add dark mode toggle`

## Usage

```bash
/wogi-capture "Your idea or bug here"
/wogi-capture "Bug: login fails on Safari"
```

Just provide a brief title. That's it.

## What Happens

1. **Auto-detect type** from keywords:
   - "bug", "fix", "broken", "error", "crash", "fails" → `bug`
   - Everything else → `feature`

2. **Auto-tag** from current context (if a task is in progress)

3. **Add to backlog** in `ready.json` with minimal metadata

4. **Minimal confirmation** - just "Captured: [title]"

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
```

## CLI Usage

```bash
node scripts/flow-capture.js "Add dark mode toggle"
node scripts/flow-capture.js "Bug: login fails" --json
```

## Options

- `--type <type>` - Force type (bug/feature) instead of auto-detect
- `--tags <tags>` - Add comma-separated tags
- `--json` - Output JSON instead of minimal confirmation
