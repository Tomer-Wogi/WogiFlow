# Team Setup

Configure team sync and shared knowledge.

---

## Purpose

Team features enable:
- **Shared Decisions**: Team-wide coding patterns
- **Knowledge Transfer**: Share learnings across projects
- **Consistent Configuration**: Import/export workflow profiles
- **Audit Trails**: Track changes across team members

---

## Quick Start

### Export Your Profile

```bash
/wogi-export
```

Creates a shareable profile with your configuration.

### Import Team Profile

```bash
/wogi-import
```

Import a team's shared configuration.

---

## Configuration

```json
{
  "team": {
    "enabled": false,
    "teamId": null,
    "userId": null,
    "projectId": null,
    "apiKey": null,
    "backendUrl": "https://api.wogi-flow.com",
    "syncInterval": 300000,
    "autoSync": true,
    "sync": {
      "decisions": true,
      "appMap": true,
      "componentIndex": true,
      "skills": true,
      "memory": true,
      "requestLog": "recent",
      "tasks": false
    },
    "conflictResolution": "newest-wins"
  }
}
```

---

## What Gets Synced

| Item | Default | Description |
|------|---------|-------------|
| `decisions` | `true` | Coding patterns and conventions |
| `appMap` | `true` | Component registry |
| `componentIndex` | `true` | Auto-scanned components |
| `skills` | `true` | Installed skill packages |
| `memory` | `true` | Learned facts and patterns |
| `requestLog` | `"recent"` | Change history (recent only) |
| `tasks` | `false` | Task queues |

---

## Profile Export

```bash
/wogi-export

# Output:
# 📤 Exporting workflow profile...
#
# Profile includes:
#   - config.json settings
#   - decisions.md patterns
#   - app-map.md components
#   - Installed skills
#
# Saved to: .workflow/exports/profile-2024-01-15.json
```

### Export File Structure

```json
{
  "version": "2.0.0",
  "exportedAt": "2024-01-15T10:30:00Z",
  "exportedBy": "user-id",
  "config": {...},
  "state": {
    "decisions": "...",
    "appMap": "..."
  },
  "skills": ["react", "nestjs"]
}
```

---

## Profile Import

```bash
/wogi-import

# Prompts for:
# - Profile file path or URL
# - What to import (all or select)
# - Conflict resolution preference
```

### Import Options

| Option | Description |
|--------|-------------|
| Import all | Full profile replacement |
| Select items | Choose specific parts |
| Merge | Combine with existing |
| Replace | Overwrite existing |

---

## Team Sync (Future)

When team backend is available:

### Enable Team Mode

```json
{
  "team": {
    "enabled": true,
    "teamId": "team-123",
    "apiKey": "your-api-key"
  }
}
```

### Auto-Sync Behavior

1. **On Session Start**: Pull latest team changes
2. **On Session End**: Push local changes
3. **Continuous**: Sync every 5 minutes (configurable)

### Conflict Resolution

```json
{
  "team": {
    "conflictResolution": "newest-wins"
  }
}
```

Options:
- `newest-wins` - Latest timestamp wins
- `local-wins` - Prefer local changes
- `remote-wins` - Prefer team changes
- `ask` - Prompt for each conflict

---

## Knowledge Routing

Control where learnings go:

```json
{
  "knowledgeRouting": {
    "autoDetect": true,
    "confirmWithUser": true,
    "defaultScope": "local"
  }
}
```

### Routing Logic

```
New Pattern Learned
      ↓
┌─────────────────────────────────────────┐
│ Is this project-specific?               │
├─────────────────────────────────────────┤
│ YES → Save to local decisions.md        │
│ NO  → Continue                          │
└─────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────┐
│ Is this team-applicable?                │
├─────────────────────────────────────────┤
│ YES → Promote to team (with approval)   │
│ NO  → Keep local                        │
└─────────────────────────────────────────┘
```

---

## Automatic Promotion

Share valuable patterns team-wide:

```json
{
  "automaticPromotion": {
    "enabled": false,
    "threshold": 3,              // Uses before promoting
    "minRelevance": 0.8,
    "destinations": ["decisions.md"],
    "requireApproval": true,
    "autoApplyTeamApproved": true
  }
}
```

### Promotion Flow

1. Pattern used successfully 3+ times
2. Relevance score > 0.8
3. Suggest promotion to team
4. Team admin approves
5. Pattern synced to all team members

---

## Manual Setup (No Backend)

Without team backend, use file-based sharing:

### Share Configuration

```bash
# Export
/wogi-export
# Share: .workflow/exports/profile-2024-01-15.json

# Import on other machine
/wogi-import
# Select exported file
```

### Share via Git

```bash
# Include workflow in repo
git add .workflow/
git commit -m "Share workflow config"
git push
```

Team members:
```bash
git pull
# Workflow config now shared
```

---

## Multi-Project Setup

For multiple projects:

### Shared Team Profile

```json
{
  "team": {
    "projectScope": true  // Scope to current project
  }
}
```

### Cross-Project Knowledge

```json
{
  "team": {
    "projectScope": false  // Share across all projects
  }
}
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-import` | Import team profile |
| `/wogi-export` | Export current profile |
| `/wogi-health` | Check team sync status |

---

## Best Practices

1. **Export Before Major Changes**: Create backup profile
2. **Review Imported Config**: Check for conflicts
3. **Use Project Scope**: Keep project-specific decisions local
4. **Regular Sync**: Keep team knowledge up-to-date
5. **Document Team Decisions**: Use decisions.md for patterns

---

## Troubleshooting

### Import Fails

```bash
# Check file format
node -e "JSON.parse(require('fs').readFileSync('profile.json'))"
```

### Sync Conflicts

Check sync status:
```bash
/wogi-health
# Shows sync status and conflicts
```

### Missing Team Features

Team backend is optional. Most features work with file-based sharing.

---

## Related

- [Configuration Reference](../configuration/all-options.md)
- [Self-Improvement](../03-self-improvement/) - Knowledge learning
- [Memory & Context](../04-memory-context/) - Memory systems
