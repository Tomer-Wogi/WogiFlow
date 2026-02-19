Manage epics (large initiatives) with hierarchical progress tracking.

## Overview

Epics are large work items (L0) that contain multiple stories (L1), which in turn contain tasks (L2) and subtasks (L3). Progress automatically propagates up the hierarchy.

```
Epic (L0) - 15+ files, multi-week effort
├── Story (L1) - 5-15 files, days of work
│   ├── Task (L2) - 1-5 files, hours of work
│   │   └── Subtask (L3) - 1 file, atomic
│   └── Task (L2)
└── Story (L1)
```

## Commands

### List Epics
```bash
node scripts/flow-epics.js list
# or: flow epics list
```

### Create Epic
```bash
node scripts/flow-epics.js create <epicId> --title "Title" --desc "Description"
```

Example:
```bash
node scripts/flow-epics.js create epic-auth --title "Authentication System" --desc "Complete user authentication implementation"
```

### Add Story to Epic
```bash
node scripts/flow-epics.js add-story <epicId> <storyId>
```

Example:
```bash
node scripts/flow-epics.js add-story epic-auth wf-abc123
```

### View Epic Details
```bash
node scripts/flow-epics.js show <epicId>
```

### View Full Hierarchy Tree
```bash
node scripts/flow-epics.js tree <epicId>
```

Output:
```
→ 📦 Authentication System [45%]
  → 📖 Login Flow [80%]
    ✓ 📋 Create login form [100%]
    → 📋 Add validation [50%]
      ✓ ▪ Email validation [100%]
      · ▪ Password validation [0%]
  · 📖 OAuth Integration [0%]
```

### Update Progress
```bash
# Update specific epic
node scripts/flow-epics.js update <epicId>

# Update all epics
node scripts/flow-epics.js update
```

### Remove Story from Epic
```bash
node scripts/flow-epics.js remove-story <epicId> <storyId>
```

### Delete Epic
```bash
node scripts/flow-epics.js delete <epicId>
```

## Progress Calculation

Progress is calculated recursively:
- **Leaf tasks**: Based on status (completed=100%, inProgress=50%, ready=0%)
- **Parent tasks**: Average of children's progress
- **Automatic propagation**: When a task is completed, parent progress updates

## Integration with Stories

When using `/wogi-story`:
1. Create the story with acceptance criteria
2. Add it to the appropriate epic:
   ```bash
   node scripts/flow-epics.js add-story <epicId> <storyId>
   ```
3. Progress will automatically track as you complete tasks

## Workflow Example

```bash
# 1. Create an epic for a major initiative
node scripts/flow-epics.js create epic-dashboard --title "Analytics Dashboard"

# 2. Create stories for each component
/wogi-story "Create data visualization charts"
/wogi-story "Build filtering system"

# 3. Add stories to epic
node scripts/flow-epics.js add-story epic-dashboard wf-charts-123
node scripts/flow-epics.js add-story epic-dashboard wf-filter-456

# 4. Work on tasks (stories auto-decompose into tasks)
/wogi-start wf-charts-task-001

# 5. Check progress
node scripts/flow-epics.js tree epic-dashboard
```

## Status Icons

| Icon | Meaning |
|------|---------|
| ✓ | Completed (100%) |
| → | In Progress (1-99%) |
| · | Ready/Not Started (0%) |
| ✗ | Blocked |

## Level Icons

| Icon | Level | Type |
|------|-------|------|
| 📦 | L0 | Epic |
| 📖 | L1 | Story |
| 📋 | L2 | Task |
| ▪ | L3 | Subtask |

## Auto-Bulk Execution

When an epic is created and stories are added to the ready queue, `/wogi-start` will automatically invoke `/wogi-bulk` to process them sequentially. Each story gets its own fresh context and follows the full execution loop.

This means after creating an epic with stories, you don't need to manually start each one — bulk orchestration handles it.

**To disable**: Set `config.bulkOrchestrator.enabled: false`

## Tips

- **Start with epics for major features** - Break down into stories before implementation
- **Update progress regularly** - Run `flow epics update` to sync status
- **Use tree view for standup** - Quick visual of project state
- **Epics don't block work** - You can still use `/wogi-start` without epics
- **Auto-bulk**: After epic creation, stories are auto-processed via `/wogi-bulk`
