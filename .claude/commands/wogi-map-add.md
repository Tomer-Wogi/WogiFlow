---
description: "Add a component to the app-map"
---
Add a component to the app-map.

Usage: `/wogi-map-add [name] [path] [variants]`

Example: `/wogi-map-add Button components/ui/Button "primary,secondary,ghost"`

Steps:
1. Add entry to `.workflow/state/app-map.md` in Components table
2. Create detail file at `.workflow/state/components/[name].md`
3. Show confirmation

Output:
```
✓ Added to app-map: Button

| Component | Variants | Path |
|-----------|----------|------|
| Button | primary, secondary, ghost | `components/ui/Button` |

Created: .workflow/state/components/Button.md

Don't forget to document:
- Props and their types
- Usage examples
- Which screens use this component
```

For screens: `/wogi-map-add screen Login /login`
For modals: `/wogi-map-add modal ConfirmDelete "Delete button click"`
