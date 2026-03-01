---
description: "Configure Claude Code status line for WogiFlow task info"
---
# Status Line Setup

Configure Claude Code's status line to show WogiFlow task information and context usage.

## What This Does

This command helps you configure Claude Code's status line (shown at the bottom of the terminal) to display:
- Current task ID and title
- Context window usage percentage
- Active skill (if any)

## Prerequisites

- Claude Code v1.0.52+ (January 2026 or later)
- The `context_window.used_percentage` field is available in status line input

## Setup Instructions

The status line is configured in your **global** Claude settings at `~/.claude/settings.json`.

### Step 1: Check Current Settings

First, let me check if you have existing status line settings:

```bash
cat ~/.claude/settings.json | grep -A5 statusLine || echo "No statusLine config found"
```

### Step 2: Add Status Line Configuration

Add or update the `statusLine` section in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "enabled": true,
    "format": "{{#if task}}[{{task.id}}] {{/if}}{{model}} | Ctx: {{context_window.used_percentage}}%{{#if skill}} | Skill: {{skill}}{{/if}}"
  }
}
```

### Format Options

| Format | Display Example |
|--------|-----------------|
| **Compact** | `opus | 45%` |
| **Standard** | `[wf-123] opus | Ctx: 45%` |
| **Detailed** | `[wf-123] My Task | opus | Ctx: 45% (85k remaining) | Skill: nestjs` |

### Available Variables

| Variable | Description |
|----------|-------------|
| `{{model}}` | Current model name |
| `{{context_window.used_percentage}}` | Context used as percentage |
| `{{context_window.remaining_percentage}}` | Context remaining as percentage |
| `{{task.id}}` | Current WogiFlow task ID (if any) |
| `{{task.title}}` | Current task title |
| `{{skill}}` | Currently active skill |

### Recommended Formats

**Minimal** (lowest overhead):
```json
"format": "{{model}} | {{context_window.used_percentage}}%"
```

**With Task** (recommended for WogiFlow users):
```json
"format": "{{#if task}}[{{task.id}}] {{/if}}{{model}} | Ctx: {{context_window.used_percentage}}%"
```

**Full Context** (detailed):
```json
"format": "[{{task.id}}] {{model}} | {{context_window.used_percentage}}% used | {{#if skill}}{{skill}}{{/if}}"
```

## WogiFlow Integration

To have WogiFlow automatically update the status line with current task info, we need to:

1. **Session Start Hook**: Reads current task from `ready.json` and exports to status line
2. **Task Start/Complete**: Updates status line when tasks change

This is handled by the existing session-start hook if the status line is enabled.

## Troubleshooting

### Status Line Not Showing
- Ensure `statusLine.enabled` is `true`
- Restart Claude Code after changing settings
- Check for JSON syntax errors in settings.json

### Variables Not Resolving
- `{{task.*}}` variables require WogiFlow integration
- `{{context_window.*}}` requires Claude Code v1.0.52+

## Manual Configuration

If you prefer to manually edit your settings:

```bash
# Open settings in editor
code ~/.claude/settings.json
# or
nano ~/.claude/settings.json
```

Add the statusLine section and restart Claude Code.
