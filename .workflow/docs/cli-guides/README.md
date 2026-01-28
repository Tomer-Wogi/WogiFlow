# WogiFlow Multi-CLI Support

WogiFlow works across multiple AI coding CLIs with feature parity. Each CLI may have different invocation methods, but the core functionality remains the same.

## Supported CLIs

| CLI | Enforcement | Commands | Guide |
|-----|-------------|----------|-------|
| [Claude Code](./claude-code.md) | Hard (hooks) | Native `/cmd` | Full |
| [Gemini CLI](./gemini-cli.md) | Hard (hooks) | Trigger phrases | Full |
| [Cursor](./cursor.md) | Mixed (prompt-level + soft) | Trigger phrases | Full |
| [OpenCode](./opencode.md) | Hard (plugins) | Trigger phrases | Full |
| [Codex](./codex.md) | Soft (rules only) | Trigger phrases | Full |
| [Kimi](./kimi.md) | Soft (rules only) | Trigger phrases | Full |

## Enforcement Levels

- **Hard**: Can block operations before they execute (best protection)
- **Soft**: Can only warn after operations (advisory only)
- **Mixed**: Hard at some points, soft at others

## Universal Workflow

Regardless of CLI, the WogiFlow workflow is the same:

1. **Start session**: Run morning briefing to see pending tasks
2. **Start task**: Describe what you want to implement
3. **Auto-checks**: Component reuse, scope validation, lint/typecheck run automatically
4. **Complete task**: All acceptance criteria verified, changes logged
5. **End session**: Session end command ensures everything is logged and committed

## User Commands

These commands work on all CLIs (invocation varies by CLI):

| Command | Purpose |
|---------|---------|
| wogi-start | Universal entry point for implementation |
| wogi-review | Code review with verification gates |
| wogi-morning | Morning briefing with task recommendations |
| wogi-session-end | Properly end a work session |
| wogi-peer-review | Multi-model code review |
| wogi-hybrid | Enable local LLM execution |
| wogi-ready | Show available tasks |
| wogi-status | Project overview |

## Auto-Invoked Features

These run automatically during task execution:

- **Component reuse checking** - Prevents duplicate components
- **Function/API reuse checking** - Prevents duplicate utilities
- **Scope validation** - Ensures edits stay within task scope
- **Post-edit validation** - Runs lint and typecheck after every edit
- **Request logging** - Logs all changes to request-log.md
- **App-map updates** - Registers new components automatically

## Configuration

All CLIs share the same configuration in `.workflow/config.json`. Run `flow bridge sync` to regenerate CLI-specific files after config changes.

## Switching Between CLIs

The workflow state is stored in `.workflow/state/` which is CLI-agnostic. You can:

1. Start a task in Claude Code
2. Continue it in Cursor
3. Finish it in Gemini CLI

All CLIs read and write to the same state files.
