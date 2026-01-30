Continuous work loop - processes captured ideas and tasks automatically.

**v1.0**: Implements Matt Maher's "do-work" pattern with safety mechanisms.

## Usage

```
/wogi-bulk-loop                    # Start continuous loop
/wogi-bulk-loop --yolo             # Auto-approve mode (skip spec approval)
/wogi-bulk-loop --max-tasks 5      # Stop after 5 tasks
/wogi-bulk-loop --timeout 2h       # Stop after 2 hours
/wogi-bulk-loop --no-create        # Only process existing tasks
/wogi-bulk-loop --dry-run          # Show what would be processed
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  /wogi-bulk-loop                                         │
├─────────────────────────────────────────────────────────┤
│  1. Check for work:                                     │
│     - In-progress tasks (resume interrupted)            │
│     - Ready tasks (sorted by priority)                  │
│     - Captured items (from /wogi-capture)               │
│                                                         │
│  2. If work found:                                      │
│     - Is it a raw capture? → Create story first         │
│     - Is it a task? → Execute with /wogi-start          │
│     - Run ALL quality gates                             │
│     - Commit on success                                 │
│                                                         │
│  3. Loop back to step 1                                 │
│                                                         │
│  4. If no work:                                         │
│     - Sleep for poll interval (default 10s)             │
│     - Check again                                       │
│                                                         │
│  5. Stop conditions:                                    │
│     - Ctrl+C (graceful shutdown)                        │
│     - Max tasks reached                                 │
│     - Max iterations reached (default 100)              │
│     - 3 consecutive errors                              │
│     - Context at 80% → auto-compact and continue        │
└─────────────────────────────────────────────────────────┘
```

## Work Sources (Priority Order)

1. **In-progress tasks** - Resume interrupted work first
2. **Ready tasks** - Highest priority (P0-P4) first
3. **Captured ideas** - From `/wogi-capture`, converted to stories

## YOLO Mode

When `--yolo` flag is set:
- Auto-approve spec generation (skip approval gate)
- Auto-commit on success (skip commit confirmation)
- Continue on warnings (only stop on errors)

**YOLO does NOT skip:**
- Quality gates (lint, typecheck, tests)
- Criteria verification
- Wiring checks
- Spec verification

It only skips human confirmation points.

## Safety Mechanisms

| Risk | Mitigation |
|------|------------|
| Context overflow | Auto-compact at 80%, continue loop |
| Infinite loop | Max iterations (default 100) |
| Error spiral | Stop after 3 consecutive failures |
| Runaway tasks | Per-task timeout (default 30 min) |
| Lost work | Commit after each successful task |

## Options

- `--yolo` - Skip approval prompts (NOT quality gates)
- `--max-tasks N` - Stop after N tasks
- `--max-iterations N` - Stop after N iterations (default 100)
- `--timeout 2h` - Stop after duration (e.g., 30m, 1h, 2h)
- `--poll-interval N` - Seconds between checks when idle (default 10)
- `--no-create` - Only process existing tasks, don't create from captures
- `--dry-run` - Show what would be processed without executing

## Output

**Start:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 BULK LOOP STARTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mode: YOLO (auto-approve)
Max tasks: 5
Max iterations: 100
Create stories: Yes
Dry run: No

Press Ctrl+C to stop gracefully
```

**During:**
```
[1] Processing: Add user validation
  Source: ready | Priority: P1
  Running: flow start wf-abc123 --yolo
  ✓ Completed: Add user validation

[2] Processing: Fix login bug
  Source: ready | Priority: P2
  → Creating story from capture...
  Running: flow start wf-def456 --yolo
  ✓ Completed: Fix login bug
```

**End:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏁 BULK LOOP COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tasks completed: 5
Iterations: 7
Duration: 1h 23m
Errors: 0
```

## Two-Terminal Workflow

For continuous work while capturing ideas:

**Terminal 1 (Work):**
```
/wogi-bulk-loop --yolo
```

**Terminal 2 (Capture):**
```
/wogi-capture "add dark mode toggle"
/wogi-capture "bug: login fails on Safari"
/wogi-capture "refactor auth module"
```

Terminal 1 will automatically pick up captured items and process them.

## CLI Usage

```bash
node scripts/flow-bulk-loop.js
node scripts/flow-bulk-loop.js --yolo --max-tasks 10
node scripts/flow-bulk-loop.js --dry-run
```

## Configuration

In `config.json`:
```json
{
  "bulkLoop": {
    "enabled": true,
    "maxIterations": 100,
    "pollInterval": 10,
    "errorThreshold": 3,
    "contextThreshold": 0.8,
    "taskTimeout": 1800
  }
}
```
