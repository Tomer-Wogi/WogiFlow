# WogiFlow for OpenCode

OpenCode has hard enforcement via its native plugin system, making it fully compatible with WogiFlow.

## Setup

1. Install WogiFlow: `npm install wogiflow`
2. Initialize: `npx flow onboard`
3. Sync bridge: `npx flow bridge sync opencode`

**Rules file**: `AGENTS.md` (project root)
**Plugin file**: `.opencode/plugins/wogiflow.js`

## Enforcement

OpenCode provides **hard enforcement** via plugins:

| Event | Capability |
|-------|------------|
| `tool.execute.before` | Blocks file edits without active task (throws error) |
| `tool.execute.after` | Runs validation after edits |
| `session.start` | Injects context |
| `session.end` | Session cleanup |
| `tui.prompt.append` | Research protocol injection |
| `agent.stop` | Loop enforcement |

The WogiFlow plugin is automatically generated at `.opencode/plugins/wogiflow.js`.

## Commands

Invoke via trigger phrases:

```
"start task wf-XXXXXXXX"
"start task add feature X"
"code review"
"morning briefing"
"wrap up"
"peer review"
"enable hybrid mode"
"show tasks"
"project status"
```

## Natural Language Triggers

| Say This | Action |
|----------|--------|
| "start task wf-XXX" or implementation request | Routes through wogi-start |
| "code review", "review what we did" | Runs code review |
| "morning briefing" | Shows morning briefing |
| "wrap up", "end session" | Ends session properly |
| "peer review" | Multi-model review |
| "show tasks", "what's ready" | Shows available tasks |
| "project status" | Shows project overview |

## What Happens Automatically

During task execution:

1. **Pre-implementation**: Plugin checks for active task, blocks if missing
2. **Each edit**: Plugin validates scope and runs lint/typecheck
3. **Post-task**: Updates maps, logs to request-log, commits

## Plugin Architecture

```
.opencode/
├── opencode.json          # OpenCode configuration
├── plugins/
│   └── wogiflow.js        # WogiFlow enforcement plugin
├── skills/                # Converted skills
└── rules/                 # Project rules
```

The plugin hooks into:
- `tool.execute.before` - Task gating (throws to block)
- `tool.execute.after` - Validation
- `session.start` - Context injection
- `tui.prompt.append` - Research protocol

## Differences from Claude Code

- **Plugin-based**: Enforcement via JS plugin instead of hook config
- **Error throwing**: Blocks by throwing errors rather than returning flags
- **AGENTS.md**: Uses AGENTS.md instead of CLAUDE.md
- **No native slash commands**: Use natural language triggers
