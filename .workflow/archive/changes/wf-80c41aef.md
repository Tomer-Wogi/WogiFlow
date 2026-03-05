# [wf-80c41aef] Add background task execution for non-blocking operations

## User Story
**As a** WogiFlow user
**I want** non-critical tasks (like memory compaction, index updates, skill learning) to run in the background
**So that** they don't block my main workflow and I can continue working while they complete

## Description
WogiFlow has infrastructure for task queues (`flow-queue.js`, `flow-durable-session.js`) but all execution is synchronous and blocking. Crush queues non-critical tasks to run asynchronously. This feature adds background task execution for operations that don't need immediate results: memory compaction, index regeneration, skill learning extraction, and similar maintenance tasks. Tasks run in a child process and report completion via filesystem signals.

## Acceptance Criteria

### Scenario 1: Queue task for background execution
**Given** a non-critical operation like memory compaction
**When** `flow bg queue "compact-memory"` runs
**Then** the task is added to the background queue
**And** control returns immediately to the user
**And** the task starts executing in a child process

### Scenario 2: Check background task status
**Given** background tasks are running or completed
**When** `flow bg status` runs
**Then** it shows: pending tasks, running tasks (with duration), completed tasks (with result)

### Scenario 3: Background task completion notification
**Given** a background task completes
**When** the user runs any flow command
**Then** a one-time notification shows: "Background task 'compact-memory' completed (success/failed)"

### Scenario 4: View background task logs
**Given** a background task has run
**When** `flow bg logs <task-id>` runs
**Then** it shows the full output from the background process

### Scenario 5: Cancel running background task
**Given** a background task is running
**When** `flow bg cancel <task-id>` runs
**Then** the child process is terminated
**And** the task is marked as cancelled

### Scenario 6: Auto-queue eligible operations
**Given** `config.background.autoQueue` lists operations like `compact-memory`, `skill-learn`
**When** these operations are triggered during normal workflow
**Then** they automatically run in background instead of blocking

## Technical Notes
- **Components**:
  - Create: `scripts/flow-background.js` - Background task manager
  - Create: `.workflow/state/background-queue.json` - Task queue state
  - Create: `.workflow/logs/background/` - Task output logs
  - Modify: `scripts/flow-memory-compactor.js` - Add background mode
  - Modify: `scripts/flow-skill-learn.js` - Add background mode
- **Execution**:
  - Use `child_process.spawn` with `detached: true, stdio: 'pipe'`
  - Write stdout/stderr to log file
  - Write completion status to queue state
- **State format**:
  ```json
  {
    "pending": [],
    "running": [{"id": "...", "operation": "compact-memory", "startedAt": "..."}],
    "completed": [{"id": "...", "operation": "...", "result": "success", "completedAt": "..."}]
  }
  ```
- **Constraints**:
  - Only one instance of each operation type can run at once
  - Background tasks should not write to files being actively edited

## Test Strategy
- [ ] Unit: Test queue/dequeue logic
- [ ] Unit: Test process spawning and detachment
- [ ] Integration: Test full lifecycle (queue → run → complete → notify)
- [ ] Integration: Test cancel functionality

## Dependencies
- None

## Complexity
Medium - Child process management adds complexity but is well-documented

## Out of Scope
- Distributed task execution (multiple machines)
- Priority queuing
- Task dependencies (A must complete before B)
