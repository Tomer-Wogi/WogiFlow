# Component Indexing

Auto-scan and register components from your codebase.

---

## Purpose

Component indexing solves:
- **Duplication**: Know what exists before creating new
- **Discovery**: Find existing utilities and helpers
- **Consistency**: Ensure new code uses existing patterns
- **Hybrid Mode**: Provide context to local LLMs

---

## Quick Start

```bash
# Show index summary
/wogi-map-index

# Rescan codebase
/wogi-map-index scan

# Show full details
/wogi-map-index full
```

---

## What Gets Indexed

| Category | What's Included |
|----------|-----------------|
| `components` | React/Vue components |
| `pages` | Routes and page components |
| `hooks` | Custom React hooks |
| `services` | Business logic services |
| `modules` | NestJS/Angular modules |
| `utils` | Utility functions |
| `api` | API route handlers |

---

## Configuration

Component indexing is now configured via the `registries` array in `config.json`. Each registry object defines a type, directories, and ignore patterns:

```json
{
  "registries": [
    {
      "type": "component",
      "autoScan": true,                    // Enable auto-scanning
      "scanOn": [                          // When to scan
        "sessionStart",                    // On new Claude session
        "afterTask",                       // After task completion
        "preCommit"                        // Before git commits (requires hooks)
      ],
      "staleAfterMinutes": 60,             // Refresh if older than this
      "directories": [                     // Where to look
        "src/components",
        "src/hooks",
        "src/services",
        "src/pages",
        "src/modules",
        "app"
      ],
      "ignore": [                          // What to skip
        "*.test.*",
        "*.spec.*",
        "*.stories.*",
        "index.ts",
        "index.js",
        "__tests__",
        "__mocks__"
      ]
    }
  ]
}
```

---

## Index File Structure

The index is stored in `.workflow/state/component-index.json`:

```json
{
  "lastScan": "2024-01-15T10:30:00.000Z",
  "scanConfig": {
    "directories": ["src/components", "src/hooks"],
    "ignore": ["*.test.*"]
  },
  "components": [
    {
      "name": "Button",
      "path": "src/components/Button.tsx",
      "exports": ["Button", "ButtonProps"]
    }
  ],
  "hooks": [
    {
      "name": "useAuth",
      "path": "src/hooks/useAuth.ts",
      "exports": ["useAuth", "AuthContext"]
    }
  ],
  "services": [...],
  "pages": [...],
  "utils": [...]
}
```

---

## Categorization Logic

Components are categorized by path and naming:

| Pattern | Category |
|---------|----------|
| `/components/` in path | `components` |
| `/pages/` or `/app/` in path | `pages` |
| `use` prefix or `/hooks/` | `hooks` |
| `.service` suffix or `/services/` | `services` |
| `.module` suffix or `/modules/` | `modules` |
| `/utils/` or `/lib/` or `/helpers/` | `utils` |
| `/api/` in path | `api` |

---

## Export Detection

The indexer extracts export names from files:

```typescript
// Button.tsx
export const Button = () => {...}
export type ButtonProps = {...}
export default Button;

// Index entry:
{
  "name": "Button",
  "path": "src/components/Button.tsx",
  "exports": ["Button", "ButtonProps"]
}
```

Detected patterns:
- `export const/let/var X`
- `export function X`
- `export class X`
- `export default X`
- `export { A, B, C }`

---

## When Scanning Occurs

Based on `scanOn` configuration:

| Trigger | When |
|---------|------|
| `sessionStart` | Beginning of each Claude session (also checks stale) |
| `afterTask` | After completing any task via `flow done` |
| `preCommit` | Before git commits (requires git hooks installed) |
| `manual` | Only when explicitly requested |

```json
{
  "registries": [
    {
      "type": "component",
      "scanOn": ["sessionStart", "afterTask", "preCommit"],
      "staleAfterMinutes": 60
    }
  ]
}
```

### Stale Index Refresh

When `sessionStart` is enabled, the index is automatically refreshed if older than `staleAfterMinutes` (default: 60 minutes).

### Git Hooks Setup

To enable `preCommit` scanning, install git hooks:

```bash
node scripts/flow-setup-hooks.js           # Install hooks
node scripts/flow-setup-hooks.js --status  # Check status
node scripts/flow-setup-hooks.js --remove  # Remove hooks
```

The pre-commit hook will:
1. Scan component index if `preCommit` is in `scanOn`
2. Sync rules from `decisions.md` if it was modified

---

## Commands

```bash
# Summary view
/wogi-map-index
# Output:
# 📦 Component Index
# Last scan: 2024-01-15 10:30
#
# | Category   | Count |
# |------------|-------|
# | Components |    45 |
# | Pages      |    12 |
# | Hooks      |     8 |
# | Services   |    15 |
#
# Total: 80 items

# Full details
/wogi-map-index full
# Shows table with name, path, exports for each item

# Rescan
/wogi-map-index scan
# Scanned 4 directories
# Found 80 items
# ✓ Index updated

# Raw JSON
/wogi-map-index json
```

---

## App-Map vs Component Index

| Feature | Component Index | App-Map |
|---------|-----------------|---------|
| **Source** | Auto-scanned | Human-curated |
| **Format** | JSON | Markdown |
| **Content** | File paths, exports | Descriptions, variants, usage |
| **Updates** | Automatic | Manual |
| **Purpose** | Discovery | Documentation |

Use together:
1. **Component Index**: Find what exists
2. **App-Map**: Understand how to use it

---

## Hybrid Mode Integration

The component index feeds into hybrid mode:

```json
{
  "hybrid": {
    "projectContext": {
      "availableComponents": {
        "Button": "src/components/Button.tsx",
        "Modal": "src/components/Modal.tsx"
      }
    }
  }
}
```

This helps local LLMs:
- Know what imports are available
- Use existing components instead of creating new
- Follow established patterns

---

## Comparing with App-Map

Use `/wogi-map-sync` to compare:

```bash
/wogi-map-sync

# Output:
# 📊 Index vs App-Map Comparison
#
# In index but not in app-map:
#   - NewButton (src/components/NewButton.tsx)
#   - useLocalStorage (src/hooks/useLocalStorage.ts)
#
# In app-map but not in index:
#   - LegacyDropdown (may have been deleted)
#
# Suggest updates? [y/n]
```

---

## Troubleshooting

### Components Not Found

Check directories are correct:
```bash
# Verify directories exist
ls -la src/components/
```

Update the component registry entry in the `registries` array:
```json
{
  "registries": [
    {
      "type": "component",
      "directories": ["components", "lib"]  // Adjust paths
    }
  ]
}
```

### Too Many Results

Add ignore patterns to the component registry entry:
```json
{
  "registries": [
    {
      "type": "component",
      "ignore": [
        "*.test.*",
        "*.stories.*",
        "*.d.ts",
        "internal/*"
      ]
    }
  ]
}
```

### Exports Not Detected

The indexer has limits:
- Only processes `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`
- Limits to 5 exports per file
- May miss complex re-exports

---

## Related

- [Onboarding](./onboarding-existing.md) - Initial scanning
- [App-Map Updates](../02-task-execution/04-completion.md) - Keeping registry current
- [Configuration Reference](../configuration/all-options.md) - All options
