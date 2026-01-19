Read `.workflow/state/ready.json` and show all tasks organized by status:

Run `./scripts/flow ready` to see the task queue.

1. **Ready** - Tasks that can be started (sorted by priority P0-P4)
2. **In Progress** - Tasks currently being worked on
3. **Blocked** - Tasks waiting on dependencies
4. **Recently Completed** - Last 5 completed tasks
5. **Parallel Execution** - Shows if multiple tasks can run in parallel

For each task show: ID, title, priority (P0-P4), and dependencies if any.

Options:
- `--json` - Output JSON for programmatic access (includes parallel info)

Format output like:
```
Task Queue
===========

READY
  [P0] wf-a1b2c3d4: Critical bug fix
  [P1] wf-b2c3d4e5: Add forgot password link
  [P2] wf-c3d4e5f6: User profile page

IN PROGRESS
  wf-d4e5f6g7: Login form validation

BLOCKED
  wf-e5f6g7h8: Email notifications (waiting on wf-d4e5f6g7)

⚡ PARALLEL EXECUTION AVAILABLE
  3 tasks can run in parallel (no dependencies between them)
  Tasks: wf-a1b2c3d4, wf-b2c3d4e5, wf-c3d4e5f6
  ✓ Worktree isolation enabled - safe for parallel execution

RECENTLY COMPLETED
  wf-f6g7h8i9: Setup authentication

Total active: 4 (2 ready, 1 in progress, 1 blocked)
```

## Parallel Execution

When multiple ready tasks have no dependencies between them, the output will show:
- How many tasks can run in parallel
- Which task IDs are parallelizable
- Whether worktree isolation is enabled (required for safe parallel execution)

**When to use parallel execution:**
- Multiple independent bug fixes
- Features that don't share files
- Documentation tasks across different areas

**How it works:**
- Each task runs in an isolated git worktree (separate branch)
- Tasks execute simultaneously with their own context
- Changes are merged back when each task completes
- Conflicts are resolved with AI assistance if needed

**Configuration** (in `.workflow/config.json`):
```json
{
  "parallel": {
    "enabled": true,
    "maxConcurrent": 3,
    "autoSuggest": true,
    "requireWorktree": true
  },
  "worktree": {
    "enabled": true,
    "squashOnMerge": true
  }
}
```

Priority levels:
- P0: Critical (drop everything)
- P1: High (do today)
- P2: Medium (do this week)
- P3: Low (do when possible)
- P4: Backlog (someday)

Tasks are automatically sorted by priority, then by creation date.
