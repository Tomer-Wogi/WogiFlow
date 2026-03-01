---
description: "Compare auto-generated index with curated app-map and suggest updates"
---
Compare auto-generated index with curated app-map and suggest updates.

Usage: `/wogi-map-sync`

## What It Does

1. Reads `component-index.json` (auto-generated)
2. Reads `app-map.md` (curated)
3. Finds discrepancies:
   - In codebase but NOT in app-map → suggest adding
   - In app-map but NOT in codebase → may be stale
4. Offers to update app-map

## Output

```
🔄 App Map Sync

Comparing component-index.json (scanned: 2024-01-15)
           with app-map.md (updated: 2024-01-10)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📥 IN CODEBASE, NOT IN APP-MAP (consider adding):

Components:
  • DatePicker (src/components/ui/DatePicker.tsx)
  • Tooltip (src/components/ui/Tooltip.tsx)
  • Card (src/components/ui/Card.tsx)

Hooks:
  • useDebounce (src/hooks/useDebounce.ts)
  • useLocalStorage (src/hooks/useLocalStorage.ts)

Services:
  • PaymentService (src/services/payment.service.ts)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📤 IN APP-MAP, NOT IN CODEBASE (possibly stale):

Components:
  • OldModal (listed at src/components/Modal.tsx - FILE NOT FOUND)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ IN SYNC (67 items match)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Actions:
  (a) Add all missing to app-map
  (s) Select which to add
  (r) Remove stale entries
  (n) Do nothing
```

## Interactive Selection

If user chooses `(s)`:

```
Select components to add (comma-separated numbers, or 'all'):

  1. DatePicker (src/components/ui/DatePicker.tsx)
  2. Tooltip (src/components/ui/Tooltip.tsx)
  3. Card (src/components/ui/Card.tsx)
  4. useDebounce (src/hooks/useDebounce.ts)
  5. useLocalStorage (src/hooks/useLocalStorage.ts)
  6. PaymentService (src/services/payment.service.ts)

> 1, 4, 6
```

Then prompts for descriptions before adding.

## When to Use

- After pulling new code
- Before starting a task (ensure map is current)
- During code review
- Periodically (weekly?)

## Related Commands

| Command | Purpose |
|---------|---------|
| `/wogi-map` | View curated app-map |
| `/wogi-map-index` | View auto-generated index |
| `/wogi-map-index scan` | Refresh the index |
| `/wogi-map-add` | Manually add to app-map |
