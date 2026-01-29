# WogiFlow CLI Support

WogiFlow is designed to work with **Claude Code** - the official CLI for Claude by Anthropic.

## Supported CLI

| CLI | Enforcement | Commands | Guide |
|-----|-------------|----------|-------|
| [Claude Code](./claude-code.md) | Hard (hooks) | Native `/cmd` | Full |

## Enforcement

Claude Code provides **hard enforcement** through hooks, which can block operations before they execute. This provides the best protection for workflow compliance.

## Workflow

The WogiFlow workflow with Claude Code:

1. **Start session**: Run morning briefing to see pending tasks
2. **Start task**: Describe what you want to implement
3. **Auto-checks**: Component reuse, scope validation, lint/typecheck run automatically
4. **Complete task**: All acceptance criteria verified, changes logged
5. **End session**: Session end command ensures everything is logged and committed

## User Commands

These commands work via Claude Code's native `/cmd` format:

| Command | Purpose |
|---------|---------|
| /wogi-start | Universal entry point for implementation |
| /wogi-review | Code review with verification gates |
| /wogi-morning | Morning briefing with task recommendations |
| /wogi-session-end | Properly end a work session |
| /wogi-peer-review | Multi-model code review |
| /wogi-hybrid | Enable local LLM execution |
| /wogi-ready | Show available tasks |
| /wogi-status | Project overview |

## Auto-Invoked Features

These run automatically during task execution:

- **Component reuse checking** - Prevents duplicate components
- **Function/API reuse checking** - Prevents duplicate utilities
- **Scope validation** - Ensures edits stay within task scope
- **Post-edit validation** - Runs lint and typecheck after every edit
- **Request logging** - Logs all changes to request-log.md
- **App-map updates** - Registers new components automatically

## Configuration

Configuration is stored in `.workflow/config.json`. Run `flow bridge sync` to regenerate the CLAUDE.md file after config changes.
