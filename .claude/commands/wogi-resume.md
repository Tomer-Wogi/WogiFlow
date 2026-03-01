---
description: "Resume a suspended task"
---
Resume a suspended task.

## Usage

```
/wogi-resume [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--status`, `-s` | Show suspension status only |
| `--approve`, `-a` | Approve human review condition |
| `--force`, `-f` | Force resume regardless of conditions |
| `--approved-by <name>` | Specify who approved (for audit) |

## Examples

### Check Status

```
/wogi-resume --status
```

Shows current suspension status and whether conditions are met.

### Resume When Ready

```
/wogi-resume
```

Attempts to resume. Succeeds if:
- Time condition has elapsed
- Poll command returns expected value
- File exists
- Human review approved

### Approve Human Review

```
/wogi-resume --approve
```

For tasks suspended with `--review`, this approves and resumes.

### Force Resume

```
/wogi-resume --force
```

Bypasses all conditions and resumes immediately.

## Output

### When Suspended (conditions not met)

```
Cannot Resume Yet
─────────────────────────────────
Reason: waiting-for-time
Resume at: 2024-01-06T09:00:00.000Z
Remaining: 45m 30s

To force resume: flow resume --force
─────────────────────────────────
```

### When Resumed

```
Task Resumed
─────────────────────────────────
Task: TASK-042

Remaining steps: 3
Next: Implement the user authentication...
─────────────────────────────────
```

## Auto-Resume on Start

When you run `/wogi-start TASK-XXX`:

1. Checks for existing durable session
2. If suspended, checks resume condition
3. If condition met, auto-resumes
4. If not met, shows status and options

## Requirements

- Durable steps must be enabled in config (default: true)
- Task must be suspended (otherwise already active)
