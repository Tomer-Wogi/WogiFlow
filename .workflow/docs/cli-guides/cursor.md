# WogiFlow for Cursor

Cursor has mixed enforcement - hard at the prompt level, but cannot block file edits after the prompt is accepted.

## Setup

1. Install WogiFlow: `npm install wogiflow`
2. Initialize: `npx flow onboard`
3. Sync bridge: `npx flow bridge sync cursor`

**Rules file**: `.cursor/rules/wogiflow.mdc`

## Enforcement

Cursor provides **mixed enforcement**:

| Level | Hook | Capability |
|-------|------|------------|
| Hard | `beforeSubmitPrompt` | Blocks implementation requests without task |
| Hard | `beforeShellExecution` | Strict adherence for commands |
| Soft | `afterFileEdit` | Post-edit validation (cannot block) |
| Soft | `afterAgentResponse` | Notification only |

**Key limitation**: No `beforeFileEdit` hook means file edits cannot be blocked after the prompt is accepted. WogiFlow mitigates this by gating at the prompt level.

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

1. **Pre-prompt**: Implementation gate checks for active task
2. **Pre-implementation**: Checks app-map for component reuse
3. **Each edit**: Post-edit validation runs (notification only)
4. **Post-task**: Updates maps, logs to request-log

## Hybrid Enforcement Strategy

Because Cursor cannot block file edits:

1. **Prompt gating**: Block implementation prompts without task
2. **Post-edit detection**: Detect out-of-scope edits
3. **Violation tracking**: Log violations for session review
4. **Correction suggestions**: Suggest fixes for violations

## Differences from Claude Code

- **No beforeFileEdit**: Cannot block edits after prompt accepted
- **Prompt-level gating**: Must catch implementation requests early
- **MDC format**: Rules use Markdown Component format with YAML frontmatter
- **Hooks.json**: Requires `.cursor/hooks.json` configuration
