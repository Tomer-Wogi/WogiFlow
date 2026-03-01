---
description: "Execute multiple tasks in sequence following all workflow rules"
---
Execute multiple tasks in sequence, following all workflow rules.

**v3.0**: Now supports **orchestrator mode** where each task executes in a fresh sub-agent context, preventing context pollution. Inspired by Matt Maher's "do-work" pattern.

**v2.1**: Uses task queue for automatic continuation between tasks.

## Usage

- `/wogi-bulk` - Work through all ready tasks
- `/wogi-bulk 3` - Work through next 3 tasks
- `/wogi-bulk wf-001 wf-002 wf-003` - Work specific tasks in order

**Natural Language Alternative** (no slash command needed):
- "do story 1-3" or "work on tasks 1-5"
- "do wf-001, wf-002, wf-003"
- "work on these 3 stories"

## How It Works (v3.0 - Orchestrator Mode)

**Default behavior** (when `bulkOrchestrator.enabled: true`):

1. **Build Execution Plan**:
   - Detect dependencies between tasks
   - Group independent tasks into parallel batches
   - Order batches to respect dependencies

2. **Execute Each Batch**:
   - For each batch, spawn sub-agent(s) with **fresh context**
   - Independent tasks in same batch run in parallel
   - Dependent tasks wait for their dependencies

3. **Pass-Forward Summaries**:
   - When Task A completes, generate completion summary
   - Task B (if dependent on A) receives summary as context
   - Ensures continuity without context pollution

4. **Failure Handling** (configurable via `onFailure`):
   - `stop-all`: Stop entire queue on any failure
   - `stop-dependent`: Skip tasks that depend on failed task, continue others
   - `continue`: Log failure and continue all remaining tasks

**Benefits over v2.1:**
- No context pollution between tasks
- Can run for hours without context exhaustion
- Each task is atomic and reliable

## How It Works (v2.1 - Legacy Mode)

When `bulkOrchestrator.enabled: false`:

1. **Initialize Queue**:
   - Parse task IDs from arguments or natural language
   - Store in durable session's `taskQueue`
   - Run `flow queue init <task-ids>`

2. **Start First Task**:
   - Run `/wogi-start <first-task-id>`
   - Full execution loop with all quality gates

3. **Automatic Continuation**:
   - When task completes, stop hook checks queue
   - If more tasks, outputs next task instruction
   - Continues until queue is empty

4. **Quality Per Task**:
   - Each task runs complete execution loop
   - Spec generation (if needed)
   - All acceptance criteria verification
   - Quality gates and validation
   - Request log and app-map updates

## Execution Flow (v3.0 Orchestrator)

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-bulk wf-001 wf-002 wf-003                            │
├─────────────────────────────────────────────────────────────┤
│  1. Detect dependencies between tasks                       │
│  2. Build execution batches:                                │
│     Batch 1: [wf-001, wf-002] (independent, run parallel)   │
│     Batch 2: [wf-003] (depends on wf-001, run after)        │
│                                                             │
│  3. Execute Batch 1:                                        │
│     ┌─────────────────┐  ┌─────────────────┐                │
│     │ Sub-Agent A     │  │ Sub-Agent B     │  ← Parallel    │
│     │ /wogi-start     │  │ /wogi-start     │                │
│     │ wf-001          │  │ wf-002          │                │
│     │ (fresh context) │  │ (fresh context) │                │
│     └────────┬────────┘  └────────┬────────┘                │
│              │                    │                         │
│              ▼                    ▼                         │
│     [Summary A]           [Summary B]                       │
│                                                             │
│  4. Execute Batch 2:                                        │
│     ┌─────────────────────────────────┐                     │
│     │ Sub-Agent C                     │                     │
│     │ Context: Summary A (dependency) │  ← Pass-forward     │
│     │ /wogi-start wf-003              │                     │
│     │ (fresh context + summary)       │                     │
│     └─────────────────────────────────┘                     │
│                                                             │
│  5. All batches complete - show summary                     │
└─────────────────────────────────────────────────────────────┘
```

## Execution Flow (v2.1 Legacy)

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-bulk 3 --no-orchestrator                             │
├─────────────────────────────────────────────────────────────┤
│  1. Get 3 ready tasks sorted by priority                    │
│  2. Initialize task queue: [wf-001, wf-002, wf-003]         │
│  3. Start wf-001 (full loop, SAME context)                  │
│     → All scenarios implemented and verified                │
│     → Quality gates pass                                    │
│     → Committed                                             │
│  4. Stop hook detects queue has more tasks                  │
│  5. Auto-continue to wf-002 (full loop, SAME context)       │
│     → ...                                                   │
│  6. Auto-continue to wf-003 (full loop, SAME context)       │
│     → ...                                                   │
│  7. Queue empty - stop                                      │
└─────────────────────────────────────────────────────────────┘
```

## Continuous Mode (v3.1)

When enabled, the orchestrator keeps checking for new work instead of stopping when the queue is empty. This enables the two-terminal workflow:

- **Terminal 1**: Running `/wogi-bulk --continuous` - continuously processing tasks
- **Terminal 2**: Capturing ideas with `/wogi-capture` - ideas become ready tasks

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-bulk --continuous                                     │
├─────────────────────────────────────────────────────────────┤
│  1. Process initial queue (wf-001, wf-002)                  │
│     → All tasks complete                                     │
│                                                             │
│  2. Queue empty - but continuous mode enabled               │
│     → Wait 60 seconds (configurable)                        │
│     → Check for new tasks...                                │
│                                                             │
│  3. New task found! (wf-003 was captured during wait)       │
│     → Process wf-003                                        │
│     → Task complete                                         │
│                                                             │
│  4. Queue empty again                                       │
│     → Wait 60 seconds                                       │
│     → Check 1/3... no new tasks                             │
│     → Wait 60 seconds                                       │
│     → Check 2/3... no new tasks                             │
│     → Wait 60 seconds                                       │
│     → Check 3/3... no new tasks                             │
│                                                             │
│  5. Max idle checks reached - stop                          │
│     → Show summary of all completed work                    │
└─────────────────────────────────────────────────────────────┘
```

**Graceful shutdown**: Press `Ctrl+C` to stop the loop. Current task will complete (or checkpoint) before stopping.

## Output

**Start:**
```
📋 Task Queue Initialized

Tasks (3):
  1. wf-001 - Add user login [P1]
  2. wf-002 - Password reset [P2]
  3. wf-003 - Session management [P2]

Starting first task...
```

**Between Tasks (automatic):**
```
✓ Task complete!

Continuing to next task in queue: wf-002
(2 task(s) remaining)

Run: /wogi-start wf-002
```

**Final (after last task):**
```
✓ All tasks complete!

Queue Summary:
  ✓ wf-001 - Add user login
  ✓ wf-002 - Password reset
  ✓ wf-003 - Session management

3/3 tasks completed successfully.
```

## Options

### Orchestrator Options (v3.0)
- `--no-orchestrator` - Disable orchestrator mode, use legacy v2.1 behavior (same context)
- `--parallel-limit <N>` - Max tasks to run in parallel (default: 3)
- `--on-failure <mode>` - How to handle failures: `stop-all`, `stop-dependent`, `continue`
- `--summary-depth <level>` - Pass-forward summary detail: `minimal`, `standard`, `detailed`

### Continuous Mode Options (v3.1)
- `--continuous` - Enable continuous mode (keep checking for new tasks)
- `--no-continuous` - Disable continuous mode (stop when initial queue is done)
- `--idle-timeout <N>` - Seconds to wait when idle before rechecking (default: 60)
- `--idle-action <mode>` - What to do when idle: `stop` or `wait`

### General Options
- `--auto` - Don't pause between tasks (default behavior)
- `--pause` - Pause and ask before each task
- `--plan` - Show execution plan without executing (dry run)
- `--feature <name>` - Only tasks in specified feature

## Configuration

In `config.json`:

### Orchestrator Configuration (v3.0)
```json
{
  "bulkOrchestrator": {
    "enabled": true,           // Use sub-agent isolation (false = legacy mode)
    "parallelLimit": 3,        // Max tasks to run in parallel
    "useWorktrees": true,      // Use git worktrees for parallel isolation
    "onFailure": "stop-dependent",  // stop-all | stop-dependent | continue
    "summaryDepth": "standard", // minimal | standard | detailed
    "continuous": {
      "enabled": false,        // Enable continuous mode
      "idleAction": "stop",    // stop | wait when queue is empty
      "idleTimeout": 60,       // Seconds to wait before rechecking
      "maxIdleChecks": 3       // Max times to check before stopping
    }
  }
}
```

### Task Queue Configuration (v2.1 Legacy)
```json
{
  "taskQueue": {
    "enabled": true,
    "autoContinue": true,
    "pauseBetweenTasks": false,  // Default: automatic
    "maxQueueSize": 10,
    "showProgressSummary": true
  }
}
```

## CLI Commands

```bash
# Initialize queue directly
flow queue init wf-001 wf-002 wf-003

# Check queue status
flow queue status

# Parse natural language
flow queue parse "do story 1-3"

# Clear queue
flow queue clear

# Advance manually
flow queue advance
```

## Important Rules

1. **Full loop per task** - Each task runs complete execution with all quality gates
2. **Automatic continuation** - Default is no pause between tasks
3. **Commit after each task** - Progress saved even if interrupted
4. **Stop on failure** - If quality gates fail, stop and report
5. **Respect dependencies** - Tasks sorted by dependencies then priority
6. **Context management** - Consider `/wogi-compact` after 3+ tasks
