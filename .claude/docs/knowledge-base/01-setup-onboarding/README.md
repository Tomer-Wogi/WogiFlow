# Setup & Onboarding

Everything related to initial setup, codebase analysis, and populating workflow state files.

---

## Purpose

Before WogiFlow can help with your project, it needs context:
- What framework and language are you using?
- What components already exist?
- What patterns and conventions does your team follow?
- What's the current state of development?

The setup and onboarding process gathers this context automatically and stores it in workflow state files.

---

## Quick Start

### Install

```bash
npm install -D wogiflow
# or
bun add -d --trust wogiflow   # --trust is required for bun to run postinstall
```

The postinstall script automatically creates the `.workflow/` directory structure.

### Analyze Existing Project

```bash
npx flow onboard
```

This analyzes your codebase and populates:
- `decisions.md` - Coding patterns and conventions
- `app-map.md` - Component registry
- `project.md` - Project specification
- Initial tasks from known issues

---

## Features in This Category

| Feature | Purpose |
|---------|---------|
| [Installation](./installation.md) | Set up workflow for new projects |
| [Onboarding](./onboarding-existing.md) | Analyze and configure existing projects |
| [Component Indexing](./component-indexing.md) | Auto-scan and register components |
| [Framework Detection](./framework-detection.md) | Auto-detect tech stack and suggest skills |

---

## Key Configuration

```json
{
  "componentIndex": {
    "autoScan": true,
    "scanOn": ["sessionStart"],
    "directories": ["src/components", "src/hooks", "src/services"]
  },
  "skillLearning": {
    "autoDetectFrameworks": true,
    "fetchOfficialDocs": true
  },
  "codebaseInsights": {
    "enabled": true,
    "generateOn": ["onboarding", "manual"]
  }
}
```

---

## What Gets Created

### Directory Structure

```
.workflow/
├── config.json           # All configuration
├── specs/
│   └── project.md       # Project specification
├── state/
│   ├── ready.json       # Task queues
│   ├── app-map.md       # Component registry
│   ├── decisions.md     # Coding patterns
│   ├── request-log.md   # Change history
│   ├── progress.md      # Current progress
│   └── component-index.json  # Auto-scanned index
├── .claude/skills/      # Installed skills (Claude Code 2.1+)
├── agents/              # Agent personas
└── traces/              # Code traces
```

### State Files Purpose

| File | Purpose | Who Updates |
|------|---------|-------------|
| `ready.json` | Task queues (ready, inProgress, completed) | System |
| `app-map.md` | Component registry | AI + Human |
| `decisions.md` | Coding patterns | AI + Human |
| `request-log.md` | Change history | AI |
| `progress.md` | Session handoff notes | AI |
| `component-index.json` | Auto-scanned components | System |

---

## Onboarding Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ONBOARDING FLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. Detect Tech Stack                                      │
│      ├─ Language (TypeScript, Python, etc.)                │
│      ├─ Framework (React, NestJS, FastAPI, etc.)           │
│      └─ Database (PostgreSQL, MongoDB, etc.)               │
│                                                             │
│   2. Scan Components                                        │
│      ├─ React/Vue components                               │
│      ├─ Pages/Routes                                       │
│      ├─ Services/Modules                                   │
│      └─ API endpoints                                      │
│                                                             │
│   3. Project Interview                                      │
│      ├─ Project name and description                       │
│      ├─ PRD/documentation                                  │
│      ├─ Current state (early/MVP/production)               │
│      ├─ Known issues/tech debt                             │
│      └─ Coding preferences                                 │
│                                                             │
│   4. Generate Files                                         │
│      ├─ project.md (specification)                         │
│      ├─ app-map.md (component registry)                    │
│      ├─ decisions.md (patterns)                            │
│      └─ Initial tasks                                      │
│                                                             │
│   5. Suggest Skills                                         │
│      └─ Framework-specific skill installation              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm install -D wogiflow` (or `bun add -d --trust wogiflow`) | Install WogiFlow and create .workflow structure |
| `npx flow onboard` | Analyze existing project |
| `/wogi-map-index` | Show/regenerate component index |
| `/wogi-map-scan` | Scan for unmapped components |
| `/wogi-health` | Check workflow health |
| `/wogi-import` | Import team profile |
| `/wogi-export` | Export workflow profile |

---

## Next Steps After Setup

1. **Review Generated Files**: Check `decisions.md` and `app-map.md` for accuracy
2. **Run Health Check**: `/wogi-health` to verify setup
3. **View Tasks**: `/wogi-ready` to see available tasks
4. **Start Working**: `/wogi-start TASK-001`

---

## Related

- [Task Execution](../02-task-execution/) - How to execute tasks
- [Configuration Reference](../configuration/all-options.md) - All config options
- [Self-Improvement](../03-self-improvement/) - How WogiFlow learns
