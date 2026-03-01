---
description: "Suspend the current task with a resume condition"
---
Suspend the current task with a resume condition.

## Usage

```
/wogi-suspend [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--wait-ci "<command>"` | Wait for CI/CD (polls command until "completed") |
| `--rate-limit <seconds>` | Wait for N seconds (rate limiting) |
| `--review "<message>"` | Wait for human review/approval |
| `--wait-file "<path>"` | Wait for file to exist |
| `--schedule "<datetime>"` | Wait until specific time (ISO 8601) |
| `--long-running "<msg>"` | Long-running task with manual progress |

## Examples

### Wait for CI/CD Pipeline

```
/wogi-suspend --wait-ci "gh run view 1234 --json status -q '.status'"
```

The task will resume when the command returns "completed".

### Rate Limiting

```
/wogi-suspend --rate-limit 60
```

Waits 60 seconds before allowing resume. Useful for API rate limits.

### Human Review

```
/wogi-suspend --review "Check PR #456 before continuing"
```

Requires explicit approval with `/wogi-resume --approve`.

### Wait for File

```
/wogi-suspend --wait-file ".workflow/state/deploy-ready.json"
```

Resumes when the file exists.

### Scheduled Resume

```
/wogi-suspend --schedule "2024-01-06T09:00:00"
```

Resumes after the specified time.

### Long-Running Tasks

```
/wogi-suspend --long-running "Multi-day implementation"
```

For tasks that span multiple sessions. Resume manually.

## How It Works

1. Suspends the current durable session
2. Records the resume condition
3. On next `/wogi-start`, checks if condition is met
4. Auto-resumes if condition met, otherwise shows status

## Resuming

- `/wogi-resume` - Resume if condition is met
- `/wogi-resume --approve` - Approve human review
- `/wogi-resume --force` - Force resume regardless
- `/wogi-resume --status` - Check suspension status

## Requirements

- Durable steps must be enabled in config (default: true)
- Active task session (started with `/wogi-start`)
