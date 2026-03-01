---
description: "Show or regenerate the auto-generated component index"
---
Show or regenerate the auto-generated component index.

Usage:
- `/wogi-map-index` - Show current index summary
- `/wogi-map-index scan` - Rescan and regenerate index
- `/wogi-map-index full` - Show full index details

## What It Does

Automatically scans configured directories and builds a machine-readable index of:
- Components (React, Vue, etc.)
- Pages/Routes
- Hooks
- Services
- Modules
- Utilities

## Scan Process

1. Read `config.json` → `componentIndex.directories`
2. Find all relevant files (`.tsx`, `.jsx`, `.ts`, `.js`, `.vue`)
3. Extract exports and categorize
4. Save to `.workflow/state/component-index.json`

## Categorization Rules

| Pattern | Category |
|---------|----------|
| `src/components/**` | components |
| `src/pages/**`, `pages/**`, `app/**` | pages |
| `use*.ts`, `src/hooks/**` | hooks |
| `*.service.ts`, `src/services/**` | services |
| `*.module.ts`, `src/modules/**` | modules |
| `src/utils/**`, `src/lib/**` | utils |

## Output - Summary

```
📦 Component Index

Last scan: 2024-01-15 10:30:00

| Category   | Count |
|------------|-------|
| Components | 45    |
| Pages      | 12    |
| Hooks      | 8     |
| Services   | 6     |
| Modules    | 4     |
| Utils      | 15    |

Total: 90 items

Run /wogi-map-index full for details
Run /wogi-map-index scan to refresh
```

## Output - Full

```
📦 Component Index (Full)

## Components (45)

| Name | Path | Exports |
|------|------|---------|
| Button | src/components/ui/Button.tsx | Button, ButtonProps |
| Input | src/components/ui/Input.tsx | Input, InputProps |
| Modal | src/components/ui/Modal.tsx | Modal |
...

## Hooks (8)

| Name | Path | Exports |
|------|------|---------|
| useAuth | src/hooks/useAuth.ts | useAuth |
| useDebounce | src/hooks/useDebounce.ts | useDebounce |
...
```

## Difference from app-map.md

| `app-map.md` | `component-index.json` |
|--------------|------------------------|
| Curated by humans | Auto-generated |
| Rich descriptions | Just names and paths |
| "When to use" guidance | No context |
| Key components only | Everything found |
| May be outdated | Always current (after scan) |

Use `/wogi-map-sync` to compare them.

## Auto-Scan Triggers

Based on `config.json` → `componentIndex.scanOn`:
- `sessionStart` - Scan when starting a session
- `afterTask` - Scan after completing a task
- `manual` - Only scan when explicitly requested
