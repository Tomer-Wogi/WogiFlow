# Claude Code Compatibility

This document explains how Wogi Flow integrates with Claude Code's native features and provides best practices for using them together.

## Overview

Wogi Flow and Claude Code have complementary task management systems:

| Feature | Wogi Flow | Claude Code (TodoWrite) |
|---------|-----------|------------------------|
| **Scope** | Workflow-level | Execution-level |
| **Persistence** | Cross-session | Within session |
| **Dependencies** | Full dependency graphs | N/A |
| **State files** | `.workflow/state/` | Internal |
| **Purpose** | Project planning & tracking | Real-time progress visibility |

**They work together, not against each other.**

## Integration Points

### 1. Acceptance Criteria Sync

When you start a task with `/wogi-start`, Wogi Flow:
1. Parses acceptance criteria from the task spec
2. Displays them in a TodoWrite-compatible format
3. Tracks progress in `.workflow/state/todowrite-state.json`

This gives you unified visibility across both systems.

### 2. Completion Reports

When a task completes with `/flow done` or naturally ends:
1. TodoWrite stats are displayed (completed/total, percentage)
2. Each criterion shows its final status
3. State is cleared for the next task

### 3. Durable Sessions

Both systems support resumption:
- **Wogi Flow**: Resume from `/wogi-suspend` with full context
- **Claude Code**: Resume sessions from the Sessions dialog (OAuth users)

## Parallel Execution

Claude Code's recent OOM fixes (v2.1.x) make parallel execution safer:

```bash
# Wogi Flow parallel execution is now more reliable
/wogi-bulk wf-001 wf-002 wf-003  # Sequential
```

For true parallelism with worktree isolation:
```bash
flow parallel check  # See available parallel tasks
```

## Version Compatibility

| Wogi Flow | Claude Code | Notes |
|-----------|-------------|-------|
| 1.0.40+ | 2.1.0+ | Full compatibility |
| 1.0.44+ | 2.1.7+ | TodoWrite sync, OOM fixes |
| 1.0.45+ | 2.1.19+ | Native task system awareness |

### Environment Variables (2.1.19+)

#### CLAUDE_CODE_ENABLE_TASKS

Claude Code 2.1.19 introduced an environment variable to disable native task features:

```bash
CLAUDE_CODE_ENABLE_TASKS=false  # Disables native task UI
```

**Impact on Wogi Flow:**
- If set to `false`, TodoWrite sync output may not render in Claude Code's UI
- Wogi Flow's core workflow features continue to work independently
- Acceptance criteria still tracked in `.workflow/state/todowrite-state.json`

**Recommendation:** Leave native tasks enabled (default) for best experience with Wogi Flow.

### Required Claude Code Fixes (2.1.7+)

- **OOM with subagents**: Fixed - parallel execution now safe
- **Windows path escapes**: Fixed - temp directory paths handled correctly
- **Context remaining after /compact**: Fixed - accurate context display

### Fixes in 2.1.19+

- **Worktree session handling**: Sessions now update correctly when resuming from git worktrees
- **Backgrounded hooks**: Hooks that spawn background processes no longer block the session
- **Skills without permissions**: Skills that don't require extra permissions run without approval prompts

## Best Practices

### During Task Execution

1. **Use Wogi Flow for planning**: Create stories, break into tasks, manage dependencies
2. **Let TodoWrite track progress**: Real-time visibility during implementation
3. **Commit regularly**: Both systems track commits

### For Team Collaboration

See [Team Handoffs](#team-handoffs) below.

### For Complex Tasks

1. Create detailed acceptance criteria in specs
2. Use `/wogi-start --phased` for multi-phase work
3. Monitor progress via TodoWrite stats

## Team Handoffs

With Claude Code's remote session resume (OAuth users), teams can hand off work:

### Handoff Workflow

```
1. Current developer:
   /wogi-suspend "waiting for code review"

2. Task state saved to:
   - .workflow/state/durable-session.json
   - .workflow/state/progress.md
   - Committed to git

3. Next developer:
   - Opens Sessions dialog in VSCode
   - Resumes the session
   - Full context is preserved

4. Continue work:
   /wogi-resume  # or just start working
```

### Best Practices for Handoffs

1. **Always use `/wogi-suspend`** rather than just stopping
2. **Update progress.md** before handoff with current status
3. **Commit work** so the next person can pull
4. **Document blockers** in the suspension reason
5. **Use descriptive suspension messages** like:
   - "waiting for API access approval"
   - "blocked on backend deployment"
   - "needs design review"

### State Preserved in Handoffs

| Item | Location | Auto-restored |
|------|----------|---------------|
| Task ID | durable-session.json | Yes |
| Step progress | durable-session.json | Yes |
| Files changed | git | Yes |
| Decisions made | decisions.md | Yes |
| Current focus | progress.md | Manual |

## Troubleshooting

### TodoWrite not showing

- Check if task has acceptance criteria in spec
- Run `flow todowrite-sync stats` to see current state
- State file: `.workflow/state/todowrite-state.json`

### Session not resuming

- Ensure durable-session.json exists
- Check if session is suspended (needs `--force-resume` or condition met)
- Run `/wogi-status` to see current task state

### Parallel tasks failing

- Ensure worktree isolation is enabled
- Check for file conflicts between tasks
- Use `flow parallel check` before starting

## Configuration

TodoWrite sync is automatic when using `/wogi-start`. No additional configuration needed.

To disable (not recommended):
```javascript
// In flow-start.js, set todoWriteSync = null
```

## Related Commands

| Command | Purpose |
|---------|---------|
| `/wogi-start <id>` | Start task with TodoWrite sync |
| `/wogi-suspend` | Pause work with resume condition |
| `/wogi-resume` | Resume suspended task |
| `/wogi-status` | Show current task state |
| `flow todowrite-sync stats` | Show TodoWrite state |

## Keybindings (2.1.18+)

Claude Code 2.1.18 introduced customizable keyboard shortcuts. See `.claude/keybindings.json` for recommended Wogi Flow keybindings.

Run `/keybindings` in Claude Code to customize your shortcuts.

---

*Last updated: 2026-01-24*
