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
| 2.4.0+ | 2.1.83+ | managed-settings.d/, CwdChanged/FileChanged hooks, ENV_SCRUB, --channels limitations, MEMORY.md 25KB cap |
| 2.5.0+ | 2.1.84+ | TaskCreated hook, YAML glob lists in rules, CLAUDE_STREAM_IDLE_TIMEOUT_MS, WorktreeCreate HTTP transport, idle-return prompt, MCP 2KB cap |
| 2.9.0+ | 2.1.90+ | --resume deferred-tool cache fix, MCP schema perf, PostToolUse format-on-save fix, PreToolUse exit-code-2 fix, .husky protected |
| 2.9.2+ | 2.1.97+ | Stop/SubagentStop long-session fix, subagent worktree cwd leak fix, refreshInterval status line, workspace.git_worktree, MCP HTTP/SSE leak fix, 429 backoff, compaction transcript dedup |
| 2.18.0+ | 2.1.108+ | ENABLE_PROMPT_CACHING_1H guidance, /recap awareness, /doctor MCP duplicate-scope mirror in `/wogi-health` |
| 2.27.0+ | 2.1.116+ | Sandbox dangerous-path safety on auto-allow, agent frontmatter hooks for `--agent`, `/resume` large-session speedup, MCP stdio concurrent startup |
| 2.27.0+ | 2.1.117+ | Native bfs/ugrep via Bash (hook audit documented), Opus 4.7 /context fix (estimator already percentage-based), Pro/Max effort default shift (advisory delta documented), agent frontmatter `mcpServers` for `--agent`, subagent model-mismatch malware-warning fix, managed-settings plugin marketplace enforcement |
| 2.29.6+ | 2.1.132+ | Statusline `context_window` token-count accuracy fix (release notes: was reporting cumulative session totals — may have affected `wogi-statusline-setup` percentage presets if percentage was derived from cumulative tokens), Bedrock/Vertex `ENABLE_PROMPT_CACHING_1H` 400-error fix (recommendation now safe on those providers), `CLAUDE_CODE_SESSION_ID` available in Bash subprocess env |

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
| TaskCreated | task-created.js | Link native tasks to active WogiFlow task (2.1.84+) |
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

### Features in 2.1.83+

- **managed-settings.d/ drop-in directory**: A `managed-settings.d/` directory alongside `managed-settings.json` allows separate teams/tools to deploy independent policy fragments that merge alphabetically. WogiFlow currently generates `settings.local.json` — for wogiflow-cloud teams, this opens the door to deploying team policies as individual fragments (e.g., `00-wogiflow-hooks.json`, `50-team-policy.json`). No code change needed yet; tracked as cloud opportunity.

- **CwdChanged and FileChanged hook events**: Two new hook events. `CwdChanged` fires when the working directory changes (useful for direnv-style setups). `FileChanged` fires when watched files change on disk — WogiFlow could use this to detect external changes to `.workflow/state/` files and auto-rescan. Added to `UNUSED_SUPPORTED_EVENTS` in `claude-code.js`. Implementation deferred to a future task.

- **CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1**: Strips Anthropic and cloud provider credentials from subprocess environments (Bash tool, hooks, MCP stdio servers). **Impact on WogiFlow**: Hooks are subprocesses, so any hook that needs API keys (e.g., `flow-correction-detector.js` spawning a child process for async correction detection) will not have credentials available. The correction detector now gracefully degrades (returns `isCorrection: false`) when no API key is available. `flow-providers.js` makes direct `https.request()` calls from the hook process itself (not a subprocess of the subprocess), so it reads `process.env` before scrubbing — but if ENV_SCRUB applies transitively to hook processes, provider calls would also be affected. For wogiflow-cloud: if cloud sync hooks need API keys, they must use an alternative credential mechanism (file-based, keychain, or passed via hook input JSON).

- **Agents can declare initialPrompt in frontmatter**: Agents can now auto-submit a first turn without the AI composing it. WogiFlow's 11 persona agents in `agents/` could use this for standardized opening probes. No code change needed; optimization opportunity.

- **Background subagent fixes**: (1) Fixed subagents becoming invisible after context compaction — this prevented duplicate agent spawns in WogiFlow's parallel explore phase. (2) Fixed agents staying stuck in "running" state when git/API calls hang during cleanup. Both fixes improve reliability of `/wogi-start` explore phase and `/wogi-bulk-loop`.

- **--channels disables AskUserQuestion and plan mode**: When `--channels` is active (remote/SDK), `AskUserQuestion` and plan-mode tools are disabled. **Impact on WogiFlow**: WogiFlow uses `AskUserQuestion` extensively for approval gates, clarifying questions, and interactive decisions. In `--channels` mode, these will silently fail or be unavailable. WogiFlow should detect channels mode and fall back to non-interactive patterns: auto-approve with defaults, skip clarifying questions, use best-effort decisions. Documented in CLAUDE.md template and wogi-start command.

- **TaskOutput deprecated**: `TaskOutput` tool is deprecated in favor of using `Read` on the background task's output file path. WogiFlow does not use `TaskOutput` directly (confirmed by codebase search). No change needed.

- **MEMORY.md index truncation**: Now truncates at **25KB** as well as 200 lines (previously only 200 lines). WogiFlow's MEMORY.md enforcement block at the top consumes space from this budget. Projects with large MEMORY.md files may lose entries silently. The CLAUDE.md template's auto-memory section already mentions 200 lines; the 25KB limit is enforced by Claude Code's system prompt and does not need to be duplicated in the template.

- **Plugin manifest.userConfig**: Plugins can now prompt for configuration at enable time, with `sensitive: true` values stored in keychain (macOS) or protected credentials file. If WogiFlow becomes a Claude Code plugin, this provides native credential storage for cloud API tokens and model API keys — replacing `wogi login`'s file-based token storage. Tracked as cloud opportunity.

- **WebFetch identifies as Claude-User**: `WebFetch` now sends a `Claude-User` user agent so site operators can recognize and allowlist/block Claude Code traffic via `robots.txt`. WogiFlow's explore agents (Agent 2: Best Practices, Agent 3: Version Verifier) use `WebFetch` for research. If sites block `Claude-User`, research agents will get empty results. Agents should treat unexpectedly empty WebFetch results as potentially blocked and log a warning.

- **--mcp-config bypass fix**: Fixed `--mcp-config` CLI flag bypassing `allowedMcpServers`/`deniedMcpServers` managed policy enforcement. Security improvement — no WogiFlow code change needed.

- **Uninstalled plugin hooks fix**: Fixed uninstalled plugin hooks continuing to fire until the next session. Improves hook hygiene for WogiFlow plugin management.

### Features in 2.1.84+

- **TaskCreated hook event**: New hook event fired when a task is created via TaskCreate. WogiFlow uses this to link native Claude Code tasks to the active WogiFlow task in `session-state.json`, enabling cross-system task tracking. Implemented in `scripts/hooks/core/task-created.js`.

- **YAML glob lists in rules/skills frontmatter**: Rules and skills `globs:` field now accepts YAML lists in addition to single strings. WogiFlow's `flow-rules-sync.js` currently generates single-string globs with brace expansion (`"**/*.{js,ts}"`). This opens the door to cleaner multi-pattern rules without brace expansion hacks. No immediate code change — tracked as improvement.

- **CLAUDE_STREAM_IDLE_TIMEOUT_MS**: New env var to configure the streaming idle watchdog threshold (default 90s). WogiFlow's explore phase launches 5-6 parallel agents — if an agent takes >90s without streaming output, the watchdog may kill the connection. Users experiencing timeouts during explore should set this higher (e.g., `CLAUDE_STREAM_IDLE_TIMEOUT_MS=180000` for 3 minutes).

- **WorktreeCreate hook HTTP transport**: WorktreeCreate now supports `type: "http"` — return the created worktree path via `hookSpecificOutput.worktreePath`. WogiFlow continues to use command transport locally. HTTP transport enables wogiflow-cloud to receive worktree events server-side for team task tracking. Listed in `UNUSED_SUPPORTED_EVENTS` as a cloud opportunity.

- **Idle-return prompt**: Users returning after 75+ minutes are nudged to `/clear`. WogiFlow's PostCompact hook handles `/clear` correctly — it fires on compaction, re-injects state (active task, workflow phase, durable session progress), and re-arms routing. Session restore tested and working via the same PostCompact pathway.

- **MCP tool descriptions capped at 2KB**: MCP tool descriptions and server instructions now capped at 2KB to prevent OpenAPI-generated servers from bloating context. WogiFlow's plugin system registers MCP servers — plugins with verbose OpenAPI specs may have descriptions silently truncated. Plugin docs should note this limit.

- **System-prompt caching with ToolSearch**: Global system-prompt caching now works when ToolSearch is enabled. WogiFlow sessions use ToolSearch for deferred MCP tools — this reduces input token costs automatically. No code change needed.

- **Subagent JSON-schema fix**: Fixed workflow subagents failing with API 400 when the outer session uses `--json-schema` and the subagent also specifies a schema. Improves reliability of WogiFlow explore agents in structured-output sessions.

- **allowedChannelPlugins managed setting**: Enterprise admins can define a channel plugin allowlist. Relevant for wogiflow-cloud teams product — team admins could control which wogi plugins are allowed across the team. Tracked as cloud opportunity.

- **ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL_SUPPORTS**: New env vars to override effort/thinking capability detection for pinned default models on Bedrock/Vertex/Foundry. WogiFlow's hybrid mode routes to different models — 3P users who pin models can now declare their capabilities properly.

### Features in 2.1.90+

- **--resume deferred-tool prompt-cache fix**: Fixed `--resume` causing a full prompt-cache miss on the first request for sessions with deferred tools, MCP servers, or custom agents (regression since v2.1.69). WogiFlow sessions using deferred MCP tools (Atlassian, Figma, Gmail, Google Calendar) now resume with cache preserved — faster first-turn response after `--resume` or `/wogi-suspend` + resume.

- **MCP schema cache-key performance**: Eliminated per-turn `JSON.stringify` of MCP tool schemas on cache-key lookup. WogiFlow sessions with MCP servers benefit automatically — reduced CPU overhead on every turn. Combined with the SSE linear-time fix (large streamed frames were previously quadratic) and SDK transcript write fix (long conversations no longer slow down quadratically), this significantly improves performance for long WogiFlow sessions.

- **PostToolUse format-on-save fix**: Fixed `Edit`/`Write` failing with "File content has changed" when a PostToolUse format-on-save hook rewrites the file between consecutive edits. WogiFlow's PostToolUse validation is read-only (`tsc --noEmit`, `eslint`) and does NOT rewrite files, so this was never triggered. However, users who configure custom validation commands with formatters (e.g., `prettier --write`) in `config.validation.afterFileEdit.commands` would have hit this bug on older CC versions.

- **PreToolUse exit-code-2 blocking fix**: Fixed PreToolUse hooks that emit JSON to stdout and exit with code 2 not correctly blocking the tool call. WogiFlow hooks always `exit(0)` and use `permissionDecision: 'deny'` in the JSON payload for blocking — the correct pattern. Not affected, but good to know the exit-code-2 pattern now also works for other tools.

- **Auto mode boundary enforcement**: Fixed auto mode not respecting explicit user boundaries ("don't push", "wait for X before Y") even when the action would otherwise be allowed. Improves safety when users set boundaries during WogiFlow task execution.

- **PowerShell hardening**: Hardened PowerShell tool permission checks — fixed trailing `&` background job bypass, `-ErrorAction Break` debugger hang, archive-extraction TOCTOU, and parse-fail fallback deny-rule degradation. Also removed `Get-DnsClientCache` and `ipconfig /displaydns` from auto-allow (DNS cache privacy). WogiFlow has no PowerShell commands — not affected. Windows users benefit from improved security.

- **Added /powerup**: Interactive lessons teaching Claude Code features with animated demos. Available to WogiFlow users alongside `/wogi-help`.

- **Added .husky to protected directories**: `.husky/` directory now protected in `acceptEdits` mode, preventing accidental modification of git hooks. WogiFlow projects using Husky for pre-commit hooks benefit from this protection.

- **CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE env var**: Keeps the existing marketplace cache when git pull fails. Useful in offline environments where WogiFlow sessions need marketplace plugins.

- **--resume picker changes**: `--resume` picker no longer shows sessions created by `claude -p` or SDK invocations. WogiFlow sessions are interactive, so they remain visible in the picker. SDK-spawned sessions (e.g., from wogiflow-cloud's remote agents) are now correctly hidden from manual resume.

### Features in 2.1.97+

- **Stop/SubagentStop hooks no longer fail on long sessions**: Fixed prompt-type Stop/SubagentStop hooks failing after extended session activity, and hook evaluator API errors now display the actual error message instead of a generic "JSON validation failed". **Impact on WogiFlow**: CRITICAL reliability fix. WogiFlow's `scripts/hooks/entry/claude-code/stop.js` enforces routing-pending detection (blocks stop until `/wogi-start` is invoked) and runs loop-exit checks — on long sessions this hook was silently failing, meaning routing enforcement degraded and loop gating could skip. After upgrading to 2.1.97+, routing enforcement is reliable for the full session lifetime. No WogiFlow code change needed; the fix is purely in Claude Code's hook evaluator.

- **Subagent worktree cwd leak fix**: Fixed subagents using `isolation: "worktree"` or a `cwd:` override leaking their working directory back into the parent session's Bash tool. **Impact on WogiFlow**: HIGH severity fix. WogiFlow's parallel explore phase (`flow-parallel.js`) and `/wogi-bulk` spawn multiple worktree-isolated sub-agents. Prior to 2.1.97, the parent session's subsequent `Bash` calls could inherit a stale worktree path — causing file edits, git commands, or validation to run in the wrong directory. This was silent and hard to debug. After upgrading, parallel execution with worktree isolation is safe again.

- **`refreshInterval` status line setting**: New top-level field on `statusLine` in `settings.json` that re-runs the status line every N seconds so live values (task ID, context %, active skill, worktree branch) stay current between prompts. **WogiFlow adoption**: `flow-statusline-setup.js` now prompts for and writes `refreshInterval` during interactive setup (default **5 seconds**), and exposes a `--refresh-interval N` CLI flag that can be used standalone or combined with `--format`. Setting to 0 disables auto-refresh. The `buildStatusLine()` helper preserves any existing statusLine fields, so `--format X` no longer wipes a user's previously-configured refresh interval (and vice versa).

- **`workspace.git_worktree` in status line JSON input**: New variable set when the current directory is inside a linked git worktree (independent of Claude Code's `--worktree` flag). **WogiFlow adoption**: The `detailed` preset in `flow-statusline-setup.js` now includes `{{#if workspace.git_worktree}}[WT] {{/if}}` so users see a clear worktree indicator even when they entered a worktree via `git worktree add` outside a `--worktree` session. `wogi-statusline-setup.md` documents the distinction between `workspace.git_worktree` (any linked worktree) and the existing `worktree.*` variables (only when Claude Code created the worktree).

- **Compaction transcript dedup**: Fixed compaction writing duplicate multi-MB subagent transcript files on prompt-too-long retries. **Impact on WogiFlow**: WogiFlow's explore phase launches 5-6 parallel agents per L2+ task. Previously, compaction was writing duplicate transcripts for each agent, bloating session state and slowing `--resume`. Automatic improvement after upgrade.

- **MCP HTTP/SSE memory leak fix**: Fixed MCP HTTP/SSE connections accumulating ~50 MB/hr of unreleased buffers when servers reconnect. **Impact on WogiFlow**: WogiFlow configures MCP servers (memory server, Figma MCP, and optional cloud Atlassian/Gmail/Calendar via deferred tools). Long WogiFlow sessions — especially `/wogi-bulk-loop` continuous runs — were accumulating hidden memory. Automatic improvement after upgrade.

- **429 retry exponential backoff**: Fixed 429 retries burning all attempts in ~13 seconds when the server returned a small `Retry-After` — exponential backoff now applies as a minimum. **Impact on WogiFlow**: WogiFlow's heavy context loading (CLAUDE.md + state files + specs + explore agents) can trigger rate limits on burst workloads. Prior to 2.1.97, all retry attempts were consumed in seconds. Now retries are properly spaced and recoverable.

- **Rate-limit upgrade options preserved across compaction**: Fixed rate-limit upgrade options disappearing after context compaction. **Impact on WogiFlow**: WogiFlow's sprint-based context reset (Step 3.05) triggers compaction mid-task. Users hitting rate limits during long tasks no longer lose their upgrade path after compaction.

- **Slash command picker YAML boolean keyword fix**: Fixed slash command picker breaking when a plugin's frontmatter `name:` is a YAML boolean keyword (`true`, `false`, `yes`, `no`, `on`, `off`). **Impact on WogiFlow**: WogiFlow's `flow-workflow.js` has a YAML parser that coerces bare `true`/`false` strings to JS booleans — if any WogiFlow skill or plugin accidentally used one of these as a `name`, the picker would break. All current WogiFlow skills use descriptive kebab-case names (e.g., `wogi-start`, `wogi-review`) so none are affected. Plugin authors publishing to WogiFlow should continue to quote any YAML boolean keywords in frontmatter as a defensive measure.

- **`permissions.additionalDirectories` mid-session changes apply**: Fixed `permissions.additionalDirectories` changes in `settings.json` not applying mid-session, and fixed removing a directory from `settings.permissions.additionalDirectories` revoking access to the same directory passed via `--add-dir`. **Impact on WogiFlow**: WogiFlow can emit `additionalDirectories` changes during installation, worktree creation, or team sync. Prior to 2.1.97, these changes required a session restart. Now they apply immediately — `/wogi-rescan` and `/wogi-onboard` flows that touch permissions no longer need a manual restart.

- **Permission rules matching JS prototype property names**: Fixed permission rules with names matching JavaScript prototype properties (e.g., `toString`, `constructor`, `hasOwnProperty`) causing `settings.json` to be silently ignored. **Impact on WogiFlow**: Defensive improvement. WogiFlow's `generateSettings()` in `.workflow/bridges/claude-bridge.js` uses `PERM_SAFE_RE` regex validation and never emits prototype names, but this fix protects any user who adds custom permission rules.

- **Managed-settings allow rules cleanup**: Fixed managed-settings `allow` rules remaining active after an admin removed them until process restart. **Impact on wogiflow-cloud**: Relevant for teams using managed settings for policy enforcement. Admins can now dynamically grant/revoke permissions without requiring end-user session restarts.

- **`--dangerously-skip-permissions` downgrade fix**: Fixed bypass mode being silently downgraded to `accept-edits` after approving a write to a protected path. Security improvement — WogiFlow does not rely on bypass mode but users running `/wogi-bulk --continuous` with `--dangerously-skip-permissions` benefit.

- **Bash permission hardening**: Hardened Bash tool permissions, tightening checks around env-var prefixes and network redirects, and reducing false prompts on common commands. Also improved Accept Edits mode to auto-approve filesystem commands prefixed with safe env vars or process wrappers (e.g. `LANG=C rm foo`, `timeout 5 mkdir out`). **Impact on WogiFlow**: Reduces interruptions during validation (`tsc`, `eslint`, `node --test`) that pass through env-var wrappers. WogiFlow's `generatePermissions()` was designed for literal command prefixes — users no longer need to enumerate every env-var-prefixed variant.

- **Focus view toggle (Ctrl+O) in NO_FLICKER mode**: New toggle shows just the prompt, a one-line tool summary with edit diffstats, and the final response. Useful during long WogiFlow task execution to see high-level progress without the full tool call stream. Documentation-only for WogiFlow — no code change. Worth mentioning in `/wogi-help`.

- **Running indicator in `/agents`**: `● N running` indicator now appears in `/agents` next to agent types with live subagent instances. WogiFlow's explore phase agents (5-6 per task) and worktree-isolated sub-agents are now visible at a glance. Free UX improvement.

- **`workspace.git_worktree` on status line JSON input** (see refreshInterval entry above for WogiFlow adoption).

- **Image compression alignment**: Pasted and attached images are now compressed to the same token budget as images read via the Read tool. **Impact on WogiFlow**: The Figma analyzer skill and `/wogi-debug-browser` screenshots benefit automatically — token cost is now predictable regardless of how the image entered the session.

- **Session transcript size improvements**: Empty hook entries are skipped and stored pre-edit file copies are capped. **Impact on WogiFlow**: WogiFlow registers 12+ hooks — many of which return empty `hookSpecificOutput` for fast-path exits. These were bloating the transcript. Automatic improvement after upgrade, with meaningful reduction in session file size for long runs.

- **Per-block token usage accuracy**: Per-block transcript entries now carry the final token usage instead of the streaming placeholder. **Impact on WogiFlow**: `/wogi-status`, cost tracking, and retrospective analysis that reads token usage from transcripts now report accurate numbers.

- **Bash OTEL TRACEPARENT inheritance**: Bash subprocesses now inherit a W3C `TRACEPARENT` env var when OTEL tracing is enabled. **Impact on wogiflow-cloud**: Teams product opportunity — WogiFlow hook subprocesses can propagate trace context to the cloud observability backend for end-to-end request tracing. Tracked as cloud opportunity; no OSS code change needed.

- **Improved context-low warning**: Now shows as a transient footer notification instead of a persistent row. **Impact on WogiFlow**: WogiFlow's proactive compaction triggers at 75% threshold. The transient warning matches WogiFlow's "compaction is invisible infrastructure" principle — less visual noise during task execution.

- **Bedrock SigV4 empty-string fix**: Fixed Bedrock SigV4 authentication failing when `AWS_BEARER_TOKEN_BEDROCK` or `ANTHROPIC_BEDROCK_BASE_URL` are set to empty strings (as GitHub Actions does for unset inputs). **Impact on wogiflow-cloud CI**: Relevant for teams running WogiFlow tasks from GitHub Actions with Bedrock backends. No OSS code change needed.

- **MCP OAuth refresh fix**: Fixed MCP OAuth `oauth.authServerMetadataUrl` not being honored on token refresh after restart, fixing ADFS and similar IdPs. **Impact on WogiFlow**: Enterprise users with ADFS-backed MCP servers benefit automatically.

- **`/claude-api` skill updated for Managed Agents**: The `/claude-api` skill now covers Managed Agents (`/v1/agents`, `/v1/sessions`) alongside the Claude API. **Impact on WogiFlow**: Informational — WogiFlow's `claude-api` skill reference remains accurate.

### Features in 2.1.108+

- **`ENABLE_PROMPT_CACHING_1H` env var (RECOMMENDED for non-subscribers)**: Opts into **1-hour prompt-cache TTL** on **API key, Bedrock, Vertex, and Foundry** providers. Subscribers (Claude Pro, Max, Team, Enterprise via claude.ai OAuth) already get 1h TTL by default — this flag is a **no-op for them**. The complementary `FORCE_PROMPT_CACHING_5M` pins to 5min, and the older `ENABLE_PROMPT_CACHING_1H_BEDROCK` is deprecated but still honored. **Impact on WogiFlow (HIGH)**: WogiFlow sessions load a large, stable prefix every turn — CLAUDE.md (~300 lines), state files (`ready.json`, `decisions.md`, `app-map.md`), phase files, and pinned spec context. At the default 5min TTL, any pause longer than 5 minutes (user thinking, a long `flow` CLI run, a meeting mid-session) invalidates the cache and the next turn pays the full input-token cost again. At 1h TTL, the same prefix stays cached across those pauses, yielding **substantial token-cost reduction** on typical multi-hour WogiFlow work. **Action for API-key / Bedrock / Vertex / Foundry users**: `export ENABLE_PROMPT_CACHING_1H=1` in your shell profile. **Action for subscribers**: none (already enabled). **Risk**: none — if set on a subscriber account it is ignored; if set when not supported, it silently falls back. **Bedrock/Vertex caveat**: Some Claude Code versions before 2.1.132 returned 400 errors when this flag was set on Bedrock/Vertex (per the 2.1.132 release notes). Fixed in **2.1.132+** — Bedrock/Vertex users on older Claude Code should upgrade before setting the flag.

- **`/recap` command and session recap feature**: Provides context when returning to a session. Configurable in `/config` and manually invocable with `/recap`. For users with telemetry disabled (Bedrock/Vertex/Foundry/`DISABLE_TELEMETRY`), recap is still enabled by default; opt out via `/config` or `CLAUDE_CODE_ENABLE_AWAY_SUMMARY=0`. **Overlap with WogiFlow**: `/wogi-morning`, `/wogi-session-end`, and `/wogi-pre-compact` already provide durable recap via state files. `/recap` is ephemeral (summarizes the current session); WogiFlow's state survives session exit. Use both: `/recap` for intra-session context, `/wogi-morning` for cross-session pickup.

- **Built-in slash commands via Skill tool**: Claude can now discover and invoke `/init`, `/review`, `/security-review` via the Skill tool. **Impact on WogiFlow**: No collision — all WogiFlow commands use the `wogi-*` prefix (`/wogi-review`, `/wogi-init`, `/wogi-review-fix`). Natural-language routing in CLAUDE.md directs "code review" phrases to `/wogi-review`, not the built-in `/review`. If a user explicitly types `/review`, Claude Code handles it natively — this is expected.

- **`/model` mid-conversation warning**: `/model` now warns before switching models mid-conversation, since the next response re-reads the full history uncached. **Impact on WogiFlow**: Relevant for hybrid mode (`/wogi-hybrid`) — switching the executor model via `/model` during hybrid execution wastes the cached context. WogiFlow's `/wogi-hybrid-setup` is the correct way to change executor models between sessions rather than mid-session.

- **`DISABLE_PROMPT_CACHING*` startup warning**: Claude Code now warns at startup when prompt caching is disabled via `DISABLE_PROMPT_CACHING*` env vars. **Impact on WogiFlow**: WogiFlow's heavy context prefix makes disabled caching **expensive**. This warning helps users who accidentally disabled caching (e.g., copy-pasted env from another project) spot the regression fast.

- **`/undo` alias for `/rewind`**: Typing `/undo` now aliases to `/rewind`. WogiFlow's `/wogi-pre-compact` and `/wogi-suspend` are complementary — `/undo`/`/rewind` rolls back message turns, while the WogiFlow flows preserve state across sessions.

- **Memory footprint reductions for file reads**: Language grammars now load on demand, reducing memory for file reads, edits, and syntax highlighting. **Impact on WogiFlow**: Long WogiFlow sessions (especially `/wogi-bulk-loop` continuous runs) use noticeably less RAM. No code change needed.

### Features in 2.1.110+

- **PreToolUse hook `additionalContext` preserved on tool failure (BUG FIX, GOOD NEWS)**: Previously, when a tool call failed, any `additionalContext` returned by PreToolUse hooks was **dropped**. Fixed in 2.1.110. **Impact on WogiFlow (HIGH)**: WogiFlow injects `additionalContext` in 8 places via `scripts/hooks/adapters/claude-code.js` (PreToolUse, UserPromptSubmit, SessionStart) for routing enforcement, phase-gate messages, component reuse hints, and session-start task context. Before this fix, if a guarded tool call failed, WogiFlow's context message vanished — producing "silent" hook behavior that was confusing to debug. After this fix, WogiFlow's hook messages are reliably delivered regardless of tool outcome. **Action**: none — automatic improvement after upgrade.

- **`/doctor` warns on duplicate MCP server definitions across scopes**: When the same MCP server is defined in user (`~/.claude/settings.json`), project (`.claude/settings.json`), and local (`.claude/settings.local.json`) scopes with different endpoints, `/doctor` now flags the conflict. **Impact on WogiFlow**: `/wogi-health` has a mirror check in `flow-health.js` that scans the same three scopes and reports duplicate MCP server names with divergent endpoints as a health finding (v2.18.0+).

- **PushNotification tool**: Claude can send mobile push notifications when Remote Control and "Push when Claude decides" config are enabled. **WogiFlow opportunity**: Long-running autonomous loops (`/wogi-bulk`, `/wogi-bulk-loop`) could emit a notification on completion, blocker, or extended hang. Tracked as a future enhancement; not auto-wired.

- **Bash tool timeout enforcement**: The Bash tool now enforces the documented maximum timeout (600000ms / 10min) instead of accepting arbitrarily large values. **Impact on WogiFlow**: No impact — all WogiFlow hook Bash timeouts are under 60s (verified across `.claude/settings.json` and `scripts/hooks/`).

- **stdio MCP servers no longer disconnect on stray non-JSON lines**: Fixed a regression from 2.1.105 where stdio MCP servers that print stray non-JSON lines to stdout were disconnected on the first stray line. **Impact on WogiFlow**: WogiFlow has no custom MCP servers in-repo. User-installed MCP servers (figma, atlassian, gmail) benefit automatically.

- **PermissionRequest hook `updatedInput` re-check**: Fixed PermissionRequest hooks returning `updatedInput` not being re-checked against `permissions.deny` rules; `setMode:'bypassPermissions'` updates now respect `disableBypassPermissionsMode`. **Impact on WogiFlow**: WogiFlow does not implement PermissionRequest hooks (only PermissionDenied for logging). Not affected.

- **`--resume`/`--continue` resurrects unexpired scheduled tasks**: Scheduled tasks (cron/CronCreate) now resume across session restarts. **Impact on WogiFlow**: WogiFlow does not currently use Claude Code's cron feature. Not affected; tracked as a future opportunity for automated maintenance tasks.

- **`/context`, `/exit`, `/reload-plugins` work from Remote Control (mobile/web) clients**: Remote Control users can now invoke these built-ins. **Impact on WogiFlow**: WogiFlow has no TTY-only code paths — all `/wogi-*` skills already work identically on Remote Control. Users can now do full WogiFlow-driven work from mobile/web.

- **`/tui` command and `tui` setting**: `/tui fullscreen` switches to flicker-free rendering in the same conversation. The focus view is now toggled separately with `/focus` (Ctrl+O now toggles verbose transcript only). **Impact on WogiFlow**: Documentation only — no runtime dependency on Ctrl+O. The WogiFlow statusline works identically in both TUI modes.

- **`autoScrollEnabled` config**: New setting to disable conversation auto-scroll in fullscreen mode. Purely UX — no WogiFlow impact.

- **Write tool reports IDE diff edits**: The Write tool now informs the model when the user edits the proposed content in the IDE diff before accepting. **Impact on WogiFlow**: Useful signal for learning — WogiFlow's `/wogi-correction` could eventually consume this to detect "user edited my output" events. Not auto-wired; tracked as an enhancement.

- **TRACEPARENT/TRACESTATE in SDK/headless sessions**: SDK and headless sessions now read W3C trace headers from the environment for distributed trace linking. **Impact on wogiflow-cloud**: Teams backend can propagate trace context from CI/CD pipelines into WogiFlow sessions for end-to-end observability. Tracked as a cloud opportunity.

- **Hardened "Open in editor" against command injection**: Security hardening for untrusted filenames. **Impact on WogiFlow**: Validates the same pattern in `.claude/rules/security/security-patterns.md` — external inputs going into shell commands must be validated. No WogiFlow code change needed.

### Features in 2.1.111+

- **`xhigh` effort level for Opus 4.7**: New effort level sitting between `high` and `max`, available via `/effort`, `--effort`, and the model picker. Other models fall back to `high`. `/effort` now opens an interactive slider when called without arguments. **Impact on WogiFlow**: The effort-level mapping in `wogi-start.md` now acknowledges `xhigh`/`max` as Opus 4.7-only. For L0 epics running on Opus 4.7, users may prefer `xhigh` over `high` for deeper architectural reasoning — the mapping table documents this as an option. No code change needed; the mapping is advisory.

- **`/ultrareview` built-in command**: Claude Code now ships a native `/ultrareview` that runs parallel multi-agent analysis and critique in the cloud — invoke with no arguments to review the current branch, or `/ultrareview <PR#>` to fetch and review a specific GitHub PR. **Relationship to WogiFlow's review commands**: No collision (`wogi-*` prefix). How to choose:
  - `/ultrareview` — cloud-side parallel multi-agent critique. Zero local setup. Best for standalone branch/PR reviews when you don't have peer models configured.
  - `/wogi-peer-review` — uses the peer models you configured via `/wogi-models-setup` (local/BYO models). Best when you want specific perspectives (e.g., a different vendor's model) or offline/cost-controlled review.
  - `/wogi-review` — single-reviewer code review wired into WogiFlow task state (findings logged to `last-review.json`, triaged via `/wogi-triage`). Best for in-flow review during task execution.
  - `/wogi-review-fix` — auto-applies fixes from `/wogi-review` findings.
  Users can combine them: run `/ultrareview` for a wide-angle cloud critique, then `/wogi-review` for task-linked findings.

- **`/less-permission-prompts` built-in skill**: Scans recent transcripts for common read-only Bash and MCP tool calls and proposes a prioritized allowlist for `.claude/settings.json`. **Relationship to WogiFlow**: Complementary to `computeLeanConfig()` in `lib/installer.js` — the installer produces a minimal allowlist at install time, while `/less-permission-prompts` tunes the allowlist based on actual session usage. Suggested workflow: after a few WogiFlow sessions, run `/less-permission-prompts` to prune redundant prompts. Future opportunity: surface this suggestion in `/wogi-health` output.

- **Auto-allow for read-only bash with globs and `cd <project-dir> &&` prefix**: Read-only commands like `ls *.ts` and commands starting with `cd <project-dir> &&` no longer trigger a permission prompt. **Impact on WogiFlow**: Reduces prompts during WogiFlow hook-driven validation (lint/typecheck) and user-driven exploration. Allowlist rules in `lib/installer.js` that duplicated these patterns are now redundant — minor cleanup opportunity (tracked, low priority). No action required; the installer's lean-config approach already avoids over-emitting.

- **Auto mode for Max subscribers on Opus 4.7**: Auto mode is now available for Max subscribers when using Opus 4.7, and no longer requires `--enable-auto-mode`. 2.1.112 fixed a "claude-opus-4-7 is temporarily unavailable" error in auto mode. **Impact on WogiFlow**: WogiFlow's model registry already lists Opus 4.7 (v2.22.0); auto-mode routing is orthogonal to WogiFlow's hybrid mode. Users on Max with Opus 4.7 benefit automatically.

- **`OTEL_LOG_RAW_API_BODIES` env var**: Emits full API request and response bodies as OpenTelemetry log events for debugging. **Impact on WogiFlow**: Useful when debugging hybrid mode (`/wogi-hybrid`) routing and peer-review (`/wogi-peer-review`) model calls — set this env var to see the exact payloads reaching each model. Complements WogiFlow's gate telemetry (`/wogi-gate-stats`) which tracks pass/catch/miss rates at a higher level. Set with: `export OTEL_LOG_RAW_API_BODIES=1`. Note: payloads may contain sensitive data — only enable in development.

- **Headless `--output-format stream-json` includes `plugin_errors` on init**: Plugin demotion errors (unsatisfied dependencies, conflicting versions) are now surfaced on the init event in headless mode. **WogiFlow opportunity**: `/wogi-health` could read this stream when running in CI/headless mode to flag plugin-registry issues before they cause silent failures. Tracked as an enhancement.

- **Opus 4.7 availability fix (2.1.112)**: Fixed a "claude-opus-4-7 is temporarily unavailable" error in auto mode. Aligned with WogiFlow v2.22.0 registry update. No WogiFlow code change needed.

- **Windows improvements**: `CLAUDE_ENV_FILE` and SessionStart hook environment files now apply on Windows (previously a no-op). Permission rules with drive-letter paths are now correctly root-anchored, and paths differing only by drive-letter case are recognized as the same path. **Impact on WogiFlow**: Windows users of WogiFlow's SessionStart hook can now configure environment variables via `CLAUDE_ENV_FILE`. Drive-letter-path permission rules generated by the installer now behave correctly. Automatic improvement after upgrade.

- **Miscellaneous UX**: Plan files named after the originating prompt (e.g. `fix-auth-race-snug-otter.md`), `/skills` menu supports sorting by estimated token count (press `t`), Ctrl+U clears the entire input buffer (Ctrl+Y restores), Ctrl+L forces a full redraw, and typo suggestions on near-miss subcommands. Documentation-only for WogiFlow.

- **Fixed "Unknown skill: commit" error**: Users without a custom `/commit` skill were seeing this error when Claude Code tried to invoke a non-existent built-in. **Impact on WogiFlow**: No WogiFlow-shipped `/commit` skill (commits go through `/wogi-finalize` and git commit instructions). Users benefit passively from the fix.

- **Reliability fixes (all automatic after upgrade)**: Terminal display tearing in iTerm2+tmux, `@`-file suggestions re-scanning entire project in non-git directories, LSP diagnostics from before an edit appearing after it, tab-completing `/resume` behavior, `/context` grid rendering, `/clear` dropping session name, spurious decompression/network/transient errors in the TUI. Reverted v2.1.110 cap on non-streaming fallback retries (now uncapped again). Fixed Bedrock/Vertex/Foundry 429 retries pointing users at the wrong status page, bare URLs unclickable when wrapped in tool output, feedback surveys appearing back-to-back. WogiFlow sessions benefit from all of these automatically.

### Features in 2.1.116+

- **Agent frontmatter hooks fire for main-thread `--agent` sessions (BUG FIX)**: Previously, hooks declared in an agent frontmatter only fired when the agent ran as a sub-agent. When the same agent was invoked on the main thread via `--agent`, its hooks silently did not fire. **Impact on WogiFlow**: WogiFlow ships several agents under `.workflow/agents/` (logic-adversary, architect, etc.). Users running them via `--agent` previously lost any per-agent hook behavior. Automatic improvement after upgrade — no WogiFlow code change.

- **`/resume` large-session speedup (up to 67% on 40MB+ sessions)**: `/resume` now loads significantly faster on large sessions and handles many dead-fork entries efficiently. **Impact on WogiFlow**: WogiFlow's post-compact state recovery and task-checkpoint resume benefit directly — long bulk sessions (`/wogi-bulk`, `/wogi-bulk-loop`) that accumulate large transcripts restart faster. No code change needed.

- **MCP stdio concurrent startup**: Multiple stdio MCP servers now start concurrently instead of serially, and `resources/templates/list` is deferred to first `@`-mention. **Impact on WogiFlow**: Users with several MCP servers (figma, atlassian, gmail) see faster session startup. Orthogonal to WogiFlow. No action.

- **Sandbox auto-allow honors dangerous-path safety check (SECURITY)**: Sandbox auto-allow rules no longer bypass the dangerous-path safety check when a command targets `/`, `$HOME`, or other critical system directories (e.g. `rm -rf /`, `rmdir $HOME`). **Impact on WogiFlow**: Reinforces `.claude/rules/security/security-patterns.md §6` — destructive commands should be scoped to safe variants, not blanket-wildcarded. WogiFlow's installer-generated permission rules already scope `git reset`, `git restore`, `git clean` away from blanket wildcards (v2.19.0+). No code change needed; this is defense-in-depth for users who hand-edited their settings.

- **Bash tool `gh` rate-limit hint**: Bash tool surfaces a hint when `gh` commands hit GitHub's API rate limit, so agents can back off instead of retrying. **Impact on WogiFlow**: Affects `/wogi-finalize`, `/wogi-review` when they shell out to `gh`. No code change needed — WogiFlow's commands already terminate on CLI errors instead of retry-looping.

- **Other UX fixes**: Thinking spinner shows inline progress, `/config` search matches values, Bash security no longer bypasses dangerous-path check for wildcard-allowed rm/rmdir, `/resume` reports load errors on large files instead of silently showing empty, `/doctor` can open during a response. All automatic. See `.claude/rules/security/security-patterns.md §6` for the permission-rule pattern the sandbox fix reinforces.

### Features in 2.1.117+

- **Native macOS/Linux builds replace Glob and Grep tools with embedded bfs/ugrep via Bash**: On native builds (not npm, not Windows), Claude Code now executes `bfs`/`ugrep` through the Bash tool instead of the separate Glob/Grep tools. **Impact on WogiFlow**:
  - **Hooks that match on `tool === 'Glob'|'Grep'`**: audited 2026-04-22. All matches are in **allow-list** contexts (`phase-gate.js`, `routing-gate.js`, `manager-boundary-gate.js`, `pre-tool-orchestrator.js` classify Glob/Grep as read-only; `observation-capture.js` logs them). On native builds, search operations arrive as `Bash` — Bash is NOT in those read-only allow-lists, so search calls get the stricter Bash treatment. No bypass, no gate weakening.
  - **Evidence tracking** (`research-evidence-gate.js`) and **scope enforcement** (`scope-gate.js`) do NOT match on Glob/Grep — unaffected.
  - **Observation gap (minor)**: `observation-capture.js` no longer logs search patterns from native-build users. Cosmetic — does not affect enforcement.
  - **WogiFlow scripts do NOT invoke `bfs`/`ugrep` directly** — those binaries are embedded in Claude Code's native build only, not on users' PATH. Invoking them would break npm/Windows users. Existing Node `fs` / `ripgrep` / `git grep` tooling is the cross-platform path. **No code change needed.**

- **Opus 4.7 `/context` fix — was computing against 200K instead of native 1M**: Claude Code 2.1.117 fixed inflated `/context` percentages and premature auto-compaction on Opus 4.7 sessions. **Impact on WogiFlow**: `scripts/flow-context-estimator.js` operates entirely in percentages provided by Claude Code — no hardcoded 200K/1M assumption. Audited 2026-04-22. When Claude Code reports the correct percentage post-upgrade, the estimator consumes it correctly. **No code change needed.** Only env-var-gated branch is `CLAUDE_CODE_DISABLE_1M_CONTEXT` — which correctly tightens thresholds when the user opts out of extended context.

- **Default effort `high` on Opus 4.6/4.7 for Pro/Max subscribers (was `medium`)**: Claude Code raised the session default. **Impact on WogiFlow**: WogiFlow's effort-level advisory table in `.claude/commands/wogi-start.md` is **task-level-scoped** (L2 → `medium` because 1–5 file changes don't need deep reasoning), not a global default. It intentionally differs from Claude Code's new default — documented inline in the table. Users on Pro/Max wanting the CC default everywhere can use `/effort high` at session start.

- **Agent frontmatter `mcpServers` loaded for main-thread `--agent` sessions**: Complements the 2.1.116 hook fix — MCP servers declared in an agent's frontmatter are now loaded when the agent is invoked via `--agent`. **Impact on WogiFlow**: WogiFlow's `.workflow/agents/` personas that depend on MCP tooling now work correctly when invoked on the main thread. No code change needed.

- **Subagent model-mismatch malware-warning fix**: Previously, subagents running on a different model than the main agent incorrectly flagged file reads with a malware warning. **Impact on WogiFlow (HIGH)**: IGR architect + adversary passes routinely run on a DIFFERENT model from the main agent (config: `intentGroundedReasoning.adversaryModel`, `researchReasoningGate.tier3.adversaryModel`). Pre-fix, these sub-agents could see spurious "malware" warnings on normal file reads during critique. Post-fix, IGR sub-agent reads are clean. Automatic improvement. No code change needed.

- **Managed-settings `blockedMarketplaces`/`strictKnownMarketplaces` enforcement on plugin install/update**: Enterprise admins can now block plugin marketplaces, enforced at install, update, refresh, and autoupdate time. **Impact on WogiFlow**: Relevant to `/wogi-register` and plugin-registry routing (`plugin-registry.json`). Users in managed environments may now be blocked from installing plugins WogiFlow's registry references. `/wogi-register` should surface the underlying Claude Code error verbatim (it already does — no code change). Future enhancement: detect a blocked-marketplace error and suggest the admin-controlled alternative.

- **Pro/Max Opus 4.7 `/context` fix — expanded details**: Fixed alongside the percentage fix, Opus 4.7 sessions no longer auto-compact early. Pairs with WogiFlow's smart-compaction thresholds which recalibrated to 0.80 safe / 0.92 emergency under Claude Code 2.1.75+ token accuracy (see `scripts/flow-context-estimator.js:65`).

- **Other notable fixes**: Plain-CLI OAuth sessions now refresh tokens reactively on 401 (no more mid-session "Please run /login"); WebFetch no longer hangs on very large HTML (truncates before conversion); `/login` works when launched with `CLAUDE_CODE_OAUTH_TOKEN` env var and token expires; Windows caches `where.exe` lookups per process; Bedrock `application-inference-profile` + Opus 4.7 with thinking disabled no longer returns 400; MCP `elicitation/create` no longer auto-cancels in print/SDK mode when the server connects mid-turn. All automatic after upgrade.

- **Experimental flag**: `CLAUDE_CODE_FORK_SUBAGENT=1` enables forked subagents on external builds. Not currently consumed by WogiFlow. Tracked as a future enhancement for faster IGR sub-agent spawning.

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

*Last updated: 2026-04-17*
