# Background Sync Daemon

Keep workflow state synchronized in the background.

---

## Overview

The sync daemon watches for changes and keeps state files fresh across multiple agent sessions or branches.

**Script**: `flow-sync-daemon.js`

---

## Commands

```bash
# Start the daemon
flow sync-daemon start

# Stop the daemon
flow sync-daemon stop

# Check status
flow sync-daemon status
```

---

## Configuration

Add to `.workflow/config.json`:

```json
{
  "syncDaemon": {
    "enabled": true,
    "watchPaths": [".workflow/state/"],
    "syncOnChange": true,
    "syncOnBranchSwitch": true,
    "heartbeatMs": 5000
  }
}
```

---

## Watched Paths

By default, the daemon watches:

- `.workflow/state/` - All state files
- `.workflow/memory/` - Memory database changes
- `ready.json` - Task queue changes

---

## Use Cases

### Multi-Agent Workflows

When running multiple Claude Code sessions:
- Daemon keeps `ready.json` in sync
- Prevents task conflicts
- Shares completion status

### Git Branch Switching

When switching branches:
- Daemon detects `.git/HEAD` changes
- Reloads state for new branch
- Preserves branch-specific context

---

## Status Output

```bash
$ flow sync-daemon status

Sync Daemon Status
════════════════════════════════════════
Status:     Running
PID:        12345
Uptime:     2h 15m
Last Sync:  2 minutes ago
Watches:    3 paths
Changes:    47 synced
```

---

## Related

- [External Integrations](./external-integrations.md) - Sync with Jira/Linear
- [Session Persistence](../04-memory-context/session-persistence.md) - State management
