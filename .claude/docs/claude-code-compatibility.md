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
| 1.0.46+ | 2.1.20+ | Task deletion, improved compaction |
| 1.2.0+ | 2.1.33+ | TaskCompleted, TeammateIdle hooks, agent frontmatter |
| 1.3.0+ | 2.1.33+ | WebMCP integration, model registry (Opus 4.6/Sonnet 4.6) |
| 1.5.0+ | latest | ConfigChange hook, native worktree awareness, settings.json plugin, Sonnet 4.6 1M context |

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

### Features in 2.1.20+

- **Task deletion**: Claude Code now supports `status: "deleted"` in TaskUpdate to remove tasks from the task list
- **Improved compaction**: Session resume now correctly loads compact summary instead of full history
- **Additional CLAUDE.md loading**: Load rules from multiple directories with `--add-dir` flag (requires `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`)
- **PR review status**: Prompt footer shows PR state (approved, changes requested, pending, draft)
- **Background agent permissions**: Agents now prompt for tool permissions before launching (security improvement)
- **Config backup rotation**: Config backups are timestamped and rotated (keeps 5 most recent)

### Task Deletion: Two Systems

Claude Code and Wogi Flow manage tasks differently:

| System | Scope | Task Deletion Behavior |
|--------|-------|------------------------|
| **Claude Code** (TaskCreate/Update) | Single conversation | Safe to delete - ephemeral progress UI |
| **Wogi Flow** (ready.json) | Cross-session | Use `cancelTask()` to preserve history |

**When to use Claude Code task deletion:**
- Ephemeral subtasks created during execution
- Progress indicators that are no longer relevant
- Cleanup after task completion

**When to use Wogi Flow task cancellation:**
- Persistent workflow tasks that need history preserved
- Tasks where work was partially done
- Tasks superseded by other work

**Wogi Flow cancellation preserves:**
- Task metadata in `recentlyCompleted`
- Cancellation reason and timestamp
- Whether work was done
- Searchable history for learning

Example:
```javascript
const { cancelTask } = require('./flow-utils');

// Cancel a task with preservation
await cancelTask('wf-123', 'superseded', false);
// Reasons: 'superseded', 'duplicate', 'requirements_changed', 'user_cancelled'
```

### Features in 2.1.33+

- **TaskCompleted hook event**: New hook event fired when Claude Code completes a task. Wogi Flow uses this to automatically move completed tasks in ready.json.
- **TeammateIdle hook event**: Fired when a teammate agent becomes idle. Wogi Flow suggests next available parallel task (experimental, opt-in via `hooks.rules.teammateIdle.enabled`).
- **Agent frontmatter**: Agent `.md` files support YAML frontmatter with `memory: project` and `Task(agent_type)` restrictions.
- **Claude Opus 4.6 / Sonnet 4.6**: Latest model family supported in Wogi Flow's model registry.
- **WebMCP (W3C Standard)**: `navigator.modelContext` API replaces Playwright-based browser testing.

### Hook Events Used by Wogi Flow

| Event | Hook Script | Purpose |
|-------|-------------|---------|
| SessionStart | session-start.js | Load context, check tasks |
| Setup | setup.js | Initialize workflow |
| UserPromptSubmit | user-prompt-submit.js | Task gating, bypass detection |
| PreToolUse | pre-tool-use.js | Scope validation, component reuse |
| PostToolUse | post-tool-use.js | Auto-validation, observation capture |
| Stop | stop.js | Session cleanup |
| SessionEnd | session-end.js | Request logging, progress update |
| TaskCompleted | task-completed.js | Move task to recentlyCompleted |
| TeammateIdle | teammate-idle.js | Suggest next task (disabled by default) |
| ConfigChange | config-change.js | Re-sync bridge on mid-session config changes |

### Features in Latest Release

- **ConfigChange hook event**: New hook event fired when configuration files change during a session. WogiFlow uses this to automatically re-sync the bridge (regenerate CLAUDE.md) when `.workflow/config.json` is modified mid-session. Always non-blocking.
- **Sonnet 4.6 with 1M context**: Sonnet 4.5 with 1M context has been removed from the Max plan in favor of Sonnet 4.6, which now has 1M context. WogiFlow's model registry updated with `contextWindowBeta: 1000000` for Sonnet 4.6.
- **Native `--worktree` flag**: Claude Code now supports `--worktree` (`-w`) to start sessions in an isolated git worktree (under `.claude/worktrees/`). WogiFlow's `createWorktree()` detects this and skips nested worktree creation.
- **Plugin `settings.json`**: Plugins can now ship `settings.json` for default configuration. WogiFlow now generates `.claude/settings.json` (committed, shared) with hook registrations using relative paths, while `.claude/settings.local.json` (gitignored) holds user-specific permissions.
- **Managed settings hierarchy**: `disableAllHooks` now respects managed settings hierarchy - non-managed settings cannot disable managed hooks set by policy. WogiFlow hooks in `settings.json` (shared) are protected from user disabling via this mechanism.
- **Background agent improvements**: Ctrl+F kills background agents (two-press confirmation). Ctrl+C/ESC no longer silently ignored when background agents are running.
- **MCP startup performance**: Auth failure caching and batched tool token counting improve startup when WogiFlow's MCP servers are configured.

### Simple Mode Naming Distinction

Claude Code's `CLAUDE_CODE_SIMPLE` environment variable (which enables a simplified tool set) is **unrelated** to WogiFlow's `loops.simpleMode` (a lightweight task completion loop using string detection). They are separate features that happen to share the word "simple":

| Feature | Scope | Purpose |
|---------|-------|---------|
| `CLAUDE_CODE_SIMPLE` | Claude Code | Restricts available tools to Bash + Edit |
| `loops.simpleMode` | WogiFlow | Completion-promise loop using `TASK_COMPLETE` string |

Both can be active simultaneously without conflict.

### Native Worktree vs WogiFlow Worktree

| Feature | Claude Code `--worktree` | WogiFlow `flow-worktree.js` |
|---------|-------------------------|----------------------------|
| Location | `.claude/worktrees/` | OS temp dir (`wogi-worktrees-{uid}`) |
| Branch naming | Auto-generated | `wogi-task-{taskId}-{timestamp}` |
| Squash merge | No (manual) | Yes (`squashOnMerge` config) |
| Task linking | No | Yes (links to task ID) |
| Cleanup | Prompted on session exit | Auto after 24h (`autoCleanupHours`) |

WogiFlow detects native worktrees and avoids nesting. When launched with `--worktree`, WogiFlow uses the native worktree as-is.

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

*Last updated: 2026-02-20*
