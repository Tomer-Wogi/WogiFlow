# Change Specifications

Task and story specifications created by `/wogi-story`.

## Structure

```
.workflow/changes/
├── README.md                     # This file
├── wf-a1b2c3d4.md               # Simple story (flat)
├── wf-e5f6g7h8.md               # Another simple story
└── add-user-authentication/      # Feature folder (decomposed stories)
    ├── wf-m3n4o5p6.md           # Parent story
    ├── wf-m3n4o5p6-01.md        # Sub-task: Login
    ├── wf-m3n4o5p6-02.md        # Sub-task: Register
    └── wf-m3n4o5p6-03.md        # Sub-task: Reset password
```

## Storage Rules

| Story Type | Location |
|------------|----------|
| Simple story | Flat in `.workflow/changes/` |
| Decomposed story (`--deep`) | Feature folder (auto-created from title slug) |

## Lifecycle

1. **Created** by `/wogi-story "title"` or `flow story "title"`
2. **Active** during implementation (when task is in progress)
3. **Archived** automatically when `/wogi-done` completes the task

Archived specs (and feature folders) are moved to `.workflow/archive/specs/[YYYY-MM]/`

## File Naming

- `wf-XXXXXXXX.md` - Story specification (8-char hash from title)
- `wf-XXXXXXXX-01.md` - First sub-task of parent story
- `wf-XXXXXXXX-02.md` - Second sub-task, etc.

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-story "title"` | Create a simple story (flat) |
| `/wogi-story "title" --deep` | Create decomposed story with feature folder |
| `/wogi-done TASK-ID` | Complete task and auto-archive spec/folder |

## Related Files

- `.workflow/state/ready.json` - Task queue (ready, in-progress, completed)
- `.workflow/state/implementation-timeline.md` - Chronological implementation log
- `.workflow/archive/specs/` - Archived specifications by month

---
Last updated: 2026-01-15
