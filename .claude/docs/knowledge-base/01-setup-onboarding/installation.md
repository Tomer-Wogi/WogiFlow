# Installation

Set up WogiFlow for your project.

---

## Quick Install

```bash
npm install wogiflow
```

This automatically:
1. Creates the `.workflow/` directory structure
2. Copies template files to `.workflow/state/`
3. Sets up necessary subdirectories

---

## What Gets Created

```
.workflow/
├── config.json              # Configuration (200+ options)
├── state/
│   ├── ready.json          # Task queues
│   ├── app-map.md          # Component registry
│   ├── decisions.md        # Coding patterns
│   ├── request-log.md      # Change history
│   ├── progress.md         # Session notes
│   └── component-index.json # Auto-scanned components
├── changes/                 # Feature change sets
├── memory/                  # Local memory database
└── verifications/           # Verification artifacts
```

---

## For Existing Projects

After installing, run onboarding to analyze your codebase:

```bash
npx flow onboard
```

This analyzes your codebase and populates:
- `decisions.md` - Detected coding patterns
- `app-map.md` - Found components
- `component-index.json` - Auto-scanned index

See [Onboarding Existing Projects](./onboarding-existing.md).

---

## Post-Installation

### 1. Review Config

Check `.workflow/config.json` and adjust settings:

```json
{
  "enforcement": {
    "strictMode": true,
    "requireStoryForMediumTasks": true
  },
  "loops": {
    "enforced": true,
    "maxRetries": 5
  }
}
```

### 2. Add to Git

```bash
git add .workflow/
git commit -m "feat: add WogiFlow workflow"
```

### 3. Verify Setup

```bash
npx flow health
```

Or in Claude:
```
/wogi-health
```

---

## Updating WogiFlow

```bash
npm update wogiflow
```

---

## Default Configuration

The installer creates a balanced config:

| Setting | Default | Purpose |
|---------|---------|---------|
| `enforcement.strictMode` | `true` | Require tasks for implementation |
| `loops.enforced` | `true` | Enable self-completing loops |
| `loops.maxRetries` | `5` | Retry failed verifications |
| `durableSteps.enabled` | `true` | Enable crash recovery |
| `autoLog` | `true` | Auto-log changes |
| `autoUpdateAppMap` | `true` | Auto-update component registry |

---

## Troubleshooting

### Permission Denied

```bash
chmod +x ./node_modules/wogiflow/scripts/flow*
```

### Missing Dependencies

Ensure Node.js 18+ is installed:
```bash
node --version  # Should be 18+
```

### Config Validation Errors

Check JSON syntax:
```bash
node -e "JSON.parse(require('fs').readFileSync('.workflow/config.json'))"
```

---

## Related

- [Onboarding Existing Projects](./onboarding-existing.md)
- [Configuration Reference](../configuration/all-options.md)
- [Component Indexing](./component-indexing.md)
