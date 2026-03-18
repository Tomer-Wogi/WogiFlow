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
| 1.2.0+ | 2.1.33+ | TaskCompleted hook, agent frontmatter |
| 1.3.0+ | 2.1.33+ | WebMCP integration, model registry (Opus 4.6/Sonnet 4.6) |
| 1.5.0+ | 2.1.50+ | ConfigChange hook, native worktree awareness, settings.json plugin, Sonnet 4.6 1M context |
| 1.9.1+ | 2.1.72+ | ExitWorktree, Agent model param, effort levels, /plan description, fd auto-approval, prompt cache fix |
| 1.9.5+ | 2.1.73+ | SessionStart double-fire fix, hook context pollution fix, modelOverrides, subagent model fix on Bedrock/Vertex |
| 1.9.5+ | 2.1.74+ | SessionEnd timeout fix, managed policy ask rules, autoMemoryDirectory, Agent tool routing gate fix |
| 2.0.0+ | 2.1.76+ | PostCompact hook, Elicitation/ElicitationResult events, deferred tool schema fix |
| 2.1.0+ | 2.1.77+ | PreToolUse allow/deny separation, 128k output tokens, worktree sparse checkout, compaction circuit breaker |

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
| ConfigChange | config-change.js | Re-sync bridge on mid-session config changes |
| InstructionsLoaded | instructions-loaded.js | Package check, rule conflicts, auto-onboard |
| PostCompact | post-compact.js | Re-inject state after context compaction (2.1.76+) |

### Features in Latest Release

- **ConfigChange hook event**: New hook event fired when configuration files change during a session. WogiFlow uses this to automatically re-sync the bridge (regenerate CLAUDE.md) when `.workflow/config.json` is modified mid-session. Always non-blocking.
- **Sonnet 4.6 with 1M context**: Sonnet 4.5 with 1M context has been removed from the Max plan in favor of Sonnet 4.6, which now has 1M context. WogiFlow's model registry updated with `contextWindowBeta: 1000000` for Sonnet 4.6.
- **Native `--worktree` flag**: Claude Code now supports `--worktree` (`-w`) to start sessions in an isolated git worktree (under `.claude/worktrees/`). WogiFlow's `createWorktree()` detects this and skips nested worktree creation.
- **Plugin `settings.json`**: Plugins can now ship `settings.json` for default configuration. WogiFlow now generates `.claude/settings.json` (committed, shared) with hook registrations using relative paths, while `.claude/settings.local.json` (gitignored) holds user-specific permissions.
- **Managed settings hierarchy**: `disableAllHooks` now respects managed settings hierarchy - non-managed settings cannot disable managed hooks set by policy. WogiFlow hooks in `settings.json` (shared) are protected from user disabling via this mechanism.
- **Background agent improvements**: Ctrl+F kills background agents (two-press confirmation). Ctrl+C/ESC no longer silently ignored when background agents are running.
- **MCP startup performance**: Auth failure caching and batched tool token counting improve startup when WogiFlow's MCP servers are configured.

### Features in 2.1.72+

- **ExitWorktree tool**: New tool to cleanly leave an EnterWorktree session. WogiFlow's `/wogi-finalize` now references ExitWorktree for Claude Code-managed worktree cleanup. Use ExitWorktree instead of manual git worktree commands when inside a Claude Code worktree session.
- **Agent model parameter restored**: The `model` parameter on the Agent tool now supports per-invocation overrides (`"sonnet"`, `"opus"`, `"haiku"`). WogiFlow's explore agents can now route to cheaper models for routine analysis while keeping complex reasoning on Opus. See `.claude/docs/explore-agents.md` for model routing guidance.
- **Simplified effort levels**: Effort levels simplified to low/medium/high (removed "max"). New symbols: `○ ◐ ●`. Use `/effort auto` to reset. WogiFlow maps task levels to effort: L3→low, L2→medium, L1/L0→high.
- **/plan description argument**: `/plan` now accepts an optional description that immediately starts plan mode on the topic. WogiFlow's `/wogi-plan` can pass descriptions through to enter plan mode contextually.
- **New auto-approved Bash commands**: `lsof`, `pgrep`, `tput`, `ss`, `fd`, `fdfind` added to bash auto-approval allowlist. WogiFlow now uses `fd`/`fdfind` (with `find` fallback) for faster file search in the wiring verifier, and `lsof` in health diagnostics — all without permission prompts.
- **Prompt cache fix**: Fixed prompt cache invalidation in SDK query() calls, reducing input token costs up to 12x. WogiFlow's heavy context loading (CLAUDE.md + state files + specs) benefits significantly.
- **Parallel tool resilience**: Failed Read/WebFetch/Glob no longer cascades to cancel sibling tool calls — only Bash errors cascade. WogiFlow's parallel explore agents are now more resilient.
- **Worktree isolation fixes**: Task resume correctly restores cwd in worktrees; background task notifications now include worktreePath and worktreeBranch. WogiFlow's parallel execution with worktree isolation is now production-ready.
- **Skill hooks firing twice**: Fixed skill hooks firing twice per event. WogiFlow hooks (which are hooks-enabled) no longer double-fire.
- **CLAUDE.md HTML comments hidden**: HTML comments (`<!-- ... -->`) in CLAUDE.md are now hidden from Claude when auto-injected (still visible via Read tool). WogiFlow's templates and state files verified as unaffected — no HTML comments are used in generated CLAUDE.md or injected context.
- **/clear safety**: `/clear` no longer kills background agent/bash tasks. WogiFlow's background research agents survive user `/clear`.
- **CLAUDE_CODE_DISABLE_CRON**: New env var to immediately stop scheduled cron jobs mid-session.

### Features in 2.1.73+

- **SessionStart hooks no longer fire twice on resume**: Fixed `--resume` and `--continue` triggering SessionStart hooks twice per session. WogiFlow's session-start hook (context injection, version check, routing-pending flag, durable-session) now fires exactly once, reducing startup overhead and preventing duplicate state initialization.
- **JSON-output hooks no longer inject no-op system-reminders**: Fixed hook JSON output being injected as system-reminder messages into the model's context on every turn. WogiFlow hooks return `hookSpecificOutput.additionalContext` which was previously re-injected every turn — now correctly processed once. Reduces context pollution and improves prompt caching.
- **modelOverrides setting**: New user-facing setting maps model picker entries (e.g., "opus") to custom provider model IDs (e.g., Bedrock inference profile ARNs). WogiFlow's `model` parameter on Agent calls (used in explore phase, hybrid mode) transparently benefits — Claude Code resolves abstract names through the user's overrides. No WogiFlow code change needed.
- **Subagent model parameter fixed on Bedrock/Vertex/Foundry**: Subagents with `model: opus/sonnet/haiku` were silently downgraded to older model versions. WogiFlow's explore agents using `model: "sonnet"` for cost optimization now correctly run on the latest Sonnet version on all providers.
- **Background bash process cleanup**: Background bash processes spawned by subagents are now cleaned up when the agent exits. WogiFlow's explore and review subagents no longer risk process leaks.
- **Bash output isolation**: Fixed bash tool output being lost when running multiple Claude Code sessions in the same project. Relevant for users running `/wogi-bulk --continuous` in one terminal alongside another session.
- **Default Opus on Bedrock/Vertex/Foundry**: Changed from Opus 4.1 to Opus 4.6, matching direct API behavior.
- **`/loop` available everywhere**: `/loop` now works on Bedrock, Vertex, Foundry, and with telemetry disabled. Can be used alongside WogiFlow's `/wogi-bulk-loop` for complementary recurring tasks.
- **CPU freeze fix**: Fixed 100% CPU loops triggered by permission prompts for complex bash commands. Improves stability during WogiFlow hook execution.

### Features in 2.1.74+

- **SessionEnd hooks timeout fix**: SessionEnd hooks were previously killed after 1.5s regardless of configured `timeout`. Now respects the hook's `timeout` setting. WogiFlow's SessionEnd hook (`timeout: 10`) runs state cleanup (`cleanStaleFiles()`), community sync (`syncUp()`), and memory pipeline (`rememberSessionLearnings()`) — these were likely being killed prematurely. Additionally, `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` env var allows override beyond the hook config value.
- **Managed policy ask rules no longer bypassed**: Fixed managed `ask` rules being bypassed by user `allow` rules or skill `allowed-tools`. WogiFlow uses `settings.json` (committed, managed) for hooks and `settings.local.json` for user permissions. This fix strengthens the managed settings hierarchy — managed `ask` rules now properly override user `allow` rules. No code change needed, but enables WogiFlow to add managed `ask` rules for dangerous operations in the future.
- **autoMemoryDirectory setting**: New setting to configure a custom directory for auto-memory storage. WogiFlow's memory hierarchy (`MEMORY.md` is subordinate to `.workflow/state/`) works regardless of where auto-memory is stored, since Claude Code reads from the configured location. Users who customize this should ensure their `MEMORY.md` includes WogiFlow's memory hierarchy enforcement block.
- **Full model IDs in agent frontmatter**: Fixed full model IDs (e.g., `claude-opus-4-5`) being silently ignored in agent frontmatter `model:` field. WogiFlow's agent files (`agents/`) use persona descriptions, not model frontmatter, so no impact. Explore agents use the `model` parameter on the Agent tool (already working since 2.1.72).
- **Streaming API memory leak fix**: Fixed memory leak where streaming API response buffers were not released when the generator was terminated early. Improves stability for long WogiFlow sessions with many tool calls.
- **Plugin install/marketplace fixes**: Fixed `/plugin install` for marketplace plugins with local sources, and marketplace update not syncing git submodules. WogiFlow's plugin system is internal (not marketplace-based), so no direct impact.
- **`--plugin-dir` override change**: Local dev copies now override installed marketplace plugins with the same name. Useful for WogiFlow plugin development workflows.

### Features in 2.1.76+

- **PostCompact hook**: New hook event that fires after context compaction completes. WogiFlow uses this to re-inject critical state (active task, workflow phase, durable session progress) and re-arm the routing-pending flag. Fully implemented in `scripts/hooks/core/post-compact.js` and registered in `settings.json`.
- **MCP elicitation support**: MCP servers can now request structured input mid-task via interactive dialogs (form fields or browser URL). New `Elicitation` and `ElicitationResult` hooks available for intercepting/overriding responses. WogiFlow lists these in `UNUSED_SUPPORTED_EVENTS` — not yet implemented but ready for future use (e.g., interactive clarification forms during task triage).
- **Deferred tools schema fix after compaction**: Previously, tools loaded via `ToolSearch` lost their input schemas after compaction, causing array and number parameters to be rejected with type errors. Now fixed. WogiFlow sessions using deferred MCP tools are no longer affected.
- **Auto-compaction circuit breaker**: Auto-compaction now stops after 3 consecutive failures instead of retrying indefinitely. WogiFlow's PostCompact hook tracks compaction frequency and warns when multiple compactions occur in quick succession, indicating potential circuit breaker activation.
- **`/effort` slash command**: New command to set model effort level. WogiFlow already maps task levels to effort (L3→low, L2→medium, L1/L0→high) — this provides a manual override path.
- **`-n`/`--name` CLI flag**: Set a display name for the session at startup. Can be used with WogiFlow task IDs for clearer session identification.
- **`worktree.sparsePaths` setting**: New setting for `claude --worktree` in large monorepos to check out only needed directories via git sparse-checkout. WogiFlow documents this in the worktree comparison table but does not auto-configure it — users should set `sparsePaths` in their Claude Code config for monorepo projects.

### Features in 2.1.77+

- **PreToolUse "allow" no longer bypasses deny rules**: Previously, a PreToolUse hook returning `permissionDecision: "allow"` would bypass explicit deny rules (including enterprise managed settings). Now `allow` only means "this hook permits it" — deny rules from permissions/managed settings still apply independently. WogiFlow's routing gate returns `allow` after routing is complete and `deny` when routing is pending. This fix is CORRECT behavior for WogiFlow — our `allow` should never have overridden user/enterprise deny rules. No code change needed.
- **Compound bash "Always Allow" fix**: "Always Allow" on compound bash commands (e.g., `cd src && npm test`) now saves a single rule for the full string instead of per-subcommand, preventing dead rules and repeated permission prompts. WogiFlow's generated permission rules in `claude-bridge.js` use single-command patterns (e.g., `Bash(npm install *)`) so this fix does not affect WogiFlow-generated permissions. Users who manually "Always Allow" compound commands will see improved behavior.
- **Increased output token limits**: Default max output for Opus 4.6 increased to 64k tokens. Upper bound for both Opus 4.6 and Sonnet 4.6 increased to 128k tokens. WogiFlow's model registry updated: `claude-sonnet-4-6.maxOutputTokens` changed from 64000 to 128000. Opus 4.6 was already at 128000.
- **Background agent partial results preserved**: Killing a background agent now preserves its partial results in conversation context. WogiFlow's explore phase agents (5-6 launched in parallel) benefit — if one agent is killed or times out, its partial findings are still available.
- **Agent tool resume parameter removed**: The Agent tool no longer accepts a `resume` parameter. Use `SendMessage({to: agentId})` to continue a previously spawned agent. WogiFlow does not use the `resume` parameter (confirmed by codebase search). `SendMessage` now auto-resumes stopped agents in the background instead of returning an error.
- **Improved `claude plugin validate`**: Now checks skill, agent, and command frontmatter plus hooks/hooks.json, catching YAML parse errors and schema violations. WogiFlow should periodically run this to catch frontmatter issues.
- **`--resume` truncation fix**: Fixed `--resume` silently truncating recent conversation history due to a race between memory-extraction writes and the main transcript. Improves reliability of session resumption for WogiFlow durable sessions.
- **Stale worktree cleanup race condition fix**: Fixed a race condition where stale-worktree cleanup could delete an agent worktree just resumed from a previous crash. WogiFlow's parallel execution with worktree isolation benefits from improved safety.
- **Memory growth fix**: Fixed progress messages surviving compaction in long-running sessions. Reduces memory pressure during long WogiFlow bulk-loop sessions.
- **Faster startup on macOS**: ~60ms faster by reading keychain credentials in parallel. Faster `--resume` on fork-heavy sessions — up to 45% faster loading and ~100-150MB less peak memory. Benefits WogiFlow sessions with heavy hook context.

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
| Sparse checkout | Yes (`worktree.sparsePaths` setting, 2.1.76+) | Not supported — relies on Claude Code native |

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

*Last updated: 2026-03-11*
