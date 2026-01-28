# WogiFlow for Codex

Codex has **soft enforcement only** (advisory). WogiFlow cannot block operations in Codex because it lacks pre-operation hooks.

## Setup

1. Install WogiFlow: `npm install wogiflow`
2. Initialize: `npx flow onboard`
3. Sync bridge: `npx flow bridge sync codex`

**Rules file**: `AGENTS.md` (project root)
**Config file**: `.codex/config.toml`

## Enforcement

Codex provides **soft enforcement only**:

- No pre-operation hooks
- Rules in AGENTS.md are advisory
- LLM must self-enforce the workflow

**IMPORTANT**: Because Codex cannot block operations, you rely on the LLM following the instructions in AGENTS.md. For guaranteed enforcement, use Claude Code, Gemini CLI, or OpenCode instead.

## Commands

Invoke via trigger phrases or natural language:

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
| "start task wf-XXX" or implementation request | Should route through wogi-start |
| "code review", "review what we did" | Should run code review |
| "morning briefing" | Should show morning briefing |
| "wrap up", "end session" | Should end session properly |
| "peer review" | Should run multi-model review |
| "show tasks", "what's ready" | Should show available tasks |
| "project status" | Should show project overview |

## Self-Enforcement Required

Because Codex lacks hooks, the AGENTS.md file includes detailed self-enforcement instructions:

### Task Gating (Self-Check)

Before ANY implementation:
1. Check `.workflow/state/ready.json` for existing tasks
2. If no task exists, create one first
3. Do NOT edit files without an active task

The AI must voluntarily follow these rules.

### Research Protocol (Self-Check)

For capability questions:
1. Do NOT answer from training data alone
2. Search for current documentation
3. List assumptions and verify each one

### Component Reuse (Self-Check)

Before creating components:
1. Check app-map.md first
2. Search codebase for existing
3. Prefer reuse over creation

## What Should Happen Automatically

If the LLM follows AGENTS.md:

1. **Pre-implementation**: Checks for active task
2. **Each edit**: Runs validation after editing
3. **Post-task**: Updates maps, logs changes

## Differences from Claude Code

- **No enforcement hooks**: All rules are advisory
- **Self-enforcement**: LLM must voluntarily follow rules
- **AGENTS.md format**: Generic agents format
- **TOML config**: Uses `.codex/config.toml`
- **Less reliable**: Without hooks, enforcement depends on LLM compliance

## When to Use Codex

Use Codex when:
- You understand the enforcement limitations
- You're working on low-risk tasks
- Hard enforcement isn't critical

Use Claude Code or OpenCode when:
- You need guaranteed enforcement
- Working on production code
- Team compliance is important
