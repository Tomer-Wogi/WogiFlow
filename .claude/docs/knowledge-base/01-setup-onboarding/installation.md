# Installation

Set up WogiFlow for your project.

---

## Quick Install

```bash
npm install -D wogiflow
# or
bun add -d --trust wogiflow
```

This automatically:
1. Creates the `.workflow/` directory structure
2. Copies template files to `.workflow/state/`
3. Generates a bootstrap `CLAUDE.md` for immediate use
4. Sets up necessary subdirectories

### Bun Users

Bun does not run lifecycle scripts (postinstall) from third-party packages by default — this is a security measure. The `--trust` flag is **required** for WogiFlow to set up properly.

Without `--trust`, the postinstall script never runs, so no `.workflow/` directory, no `.claude/commands/`, no scripts — nothing gets set up.

To persist trust so future updates also run lifecycle scripts, add to `bunfig.toml`:

```toml
[install]
trustedDependencies = ["wogiflow"]
```

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
# or
bun update wogiflow   # requires trustedDependencies in bunfig.toml (see above)
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

### Bun: Nothing Got Set Up

If `.workflow/` and `.claude/` directories don't exist after install, you likely forgot `--trust`:

```bash
# Remove and reinstall with --trust
bun remove wogiflow
bun add -d --trust wogiflow
```

Or add to `bunfig.toml` for persistent trust:
```toml
[install]
trustedDependencies = ["wogiflow"]
```

Then reinstall: `bun install`

### Permission Denied

```bash
chmod +x ./node_modules/wogiflow/scripts/flow*
```

### Missing Dependencies

Ensure Node.js 18+ or Bun 1.0+ is installed:
```bash
node --version  # Should be 18+
bun --version   # Should be 1.0+
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
