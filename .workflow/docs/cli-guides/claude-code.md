# WogiFlow for Claude Code

Claude Code is the primary CLI for WogiFlow and has full feature support with hard enforcement via hooks.

## Setup

1. Install WogiFlow: `npm install wogiflow`
2. Initialize: `npx flow onboard` or `npx flow init`
3. Sync bridge: `npx flow bridge sync claude-code`

**Rules file**: `CLAUDE.md` (project root)

## Enforcement

Claude Code provides **hard enforcement** via hooks:

- `PreToolUse` - Blocks file edits without active task
- `PostToolUse` - Runs validation after edits
- `UserPromptSubmit` - Checks implementation gate
- `SessionStart` - Injects context
- `Stop` - Loop enforcement

## Commands

Use native slash commands:

```
/wogi-start wf-XXXXXXXX       # Start a task
/wogi-start "add feature X"   # Auto-classify and route
/wogi-review                  # Code review
/wogi-morning                 # Morning briefing
/wogi-session-end             # End session
/wogi-peer-review             # Multi-model review
/wogi-hybrid                  # Enable hybrid mode
/wogi-ready                   # Show tasks
/wogi-status                  # Project status
```

## Natural Language Triggers

Claude Code also responds to natural language:

| Say This | Runs |
|----------|------|
| "show tasks" | /wogi-ready |
| "code review" | /wogi-review |
| "morning briefing" | /wogi-morning |
| "wrap up" | /wogi-session-end |
| "project status" | /wogi-status |

## What Happens Automatically

During task execution, these run automatically:

1. **Pre-implementation**: Checks app-map, function-map, api-map for reuse
2. **Each edit**: Validates file is in scope, runs lint/typecheck
3. **Post-task**: Updates maps, logs to request-log, commits

## Differences from Other CLIs

- **Native slash commands**: Claude Code is the only CLI with native `/command` support
- **Full hook coverage**: All enforcement hooks are available
- **Best integration**: WogiFlow was designed for Claude Code first
