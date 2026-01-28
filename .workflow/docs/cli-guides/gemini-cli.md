# WogiFlow for Gemini CLI

Gemini CLI has hard enforcement support via hooks, making it fully compatible with WogiFlow.

## Setup

1. Install WogiFlow: `npm install wogiflow`
2. Initialize: `npx flow onboard`
3. Sync bridge: `npx flow bridge sync gemini-cli`

**Rules file**: `GEMINI.md` (project root)

## Enforcement

Gemini CLI provides **hard enforcement** via hooks:

- `BeforeTool` - Blocks file edits without active task
- `AfterTool` - Runs validation after edits
- `BeforeAgent` - Checks implementation gate
- `SessionStart` - Injects context
- `SessionEnd` - Session cleanup

**Note**: Gemini CLI lacks a `Stop` hook, so loop enforcement is advisory.

## Commands

Invoke via trigger phrases or execute scripts:

```bash
# Via natural language
"start task wf-XXXXXXXX"
"start task add feature X"
"code review"
"morning briefing"
"wrap up"
"peer review"
"enable hybrid mode"
"show tasks"
"project status"

# Via script
./scripts/flow start wf-XXXXXXXX
./scripts/flow review
./scripts/flow morning
./scripts/flow session-end
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

1. **Pre-implementation**: Checks app-map, function-map, api-map for reuse
2. **Each edit**: Validates file is in scope, runs lint/typecheck
3. **Post-task**: Updates maps, logs to request-log, commits

## Differences from Claude Code

- **No native slash commands**: Use natural language triggers instead
- **Missing Stop hook**: Loop enforcement is advisory
- **Script execution**: Use `./scripts/flow <command>` for direct execution
