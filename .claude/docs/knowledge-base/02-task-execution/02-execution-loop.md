# Execution Loop

The execution loop is the core mechanism that ensures task completion. When enabled, it prevents exiting until all acceptance criteria are verified.

---

## Self-Completing Loops

**The Problem**: Without enforcement, AI often stops when code "looks done" but hasn't been verified against all acceptance criteria.

**The Solution**: Loop enforcement that:
1. Tracks each acceptance criterion
2. Requires verification before marking complete
3. Blocks exit until all criteria pass (or max retries exceeded)

### How It Works

```
┌────────────────────────────────────────────────────────────────┐
│                      EXECUTION LOOP                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     │
│   │  Load AC    │────▶│  Implement  │────▶│  Verify     │     │
│   │  Criteria   │     │  Criterion  │     │  Criterion  │     │
│   └─────────────┘     └─────────────┘     └──────┬──────┘     │
│                                                  │             │
│                       ┌──────────────────────────┴────────┐   │
│                       │                                   │   │
│                       ▼                                   ▼   │
│               ┌─────────────┐                   ┌─────────────┐
│               │   PASSED    │                   │   FAILED    │
│               │  Mark done  │                   │  Retry or   │
│               │  Next AC    │                   │  increment  │
│               └─────────────┘                   └─────────────┘
│                       │                                   │   │
│                       ▼                                   │   │
│               ┌─────────────┐                             │   │
│               │ All done?   │◀────────────────────────────┘   │
│               │ Can exit?   │                                 │
│               └──────┬──────┘                                 │
│                      │                                        │
│        ┌─────────────┴─────────────┐                          │
│        ▼                           ▼                          │
│  ┌───────────┐              ┌────────────┐                    │
│  │    YES    │              │     NO     │                    │
│  │  Complete │              │  Continue  │────────────────────┘
│  │   Task    │              │   Loop     │
│  └───────────┘              └────────────┘
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Configuration

```json
{
  "loops": {
    "enabled": true,              // Enable execution loops
    "enforced": true,             // Cannot exit until complete
    "blockExitUntilComplete": true,
    "requireVerification": true,  // Must verify each criterion
    "blockOnSkip": true,          // Cannot skip without approval
    "maxRetries": 5,              // Failed verification retries
    "maxIterations": 20,          // Total loop cycles
    "commitEvery": 3,             // Checkpoint commits
    "pauseBetweenScenarios": false,
    "autoInferVerification": true,
    "fallbackToManual": true
  }
}
```

### Key Settings Explained

| Setting | Default | Purpose |
|---------|---------|---------|
| `enforced` | true | Master switch for loop enforcement |
| `maxRetries` | 5 | How many times to retry a failed criterion |
| `maxIterations` | 20 | Total passes through all criteria |
| `requireVerification` | true | Must auto-verify or manually confirm |
| `blockOnSkip` | true | Cannot skip criteria without approval |

---

## Durable Sessions

Durable sessions provide crash recovery and progress tracking for long-running tasks.

### The Problem

- Claude Code might crash mid-task
- Session might be interrupted
- Progress is lost, work must restart

### The Solution

Durable sessions persist:
- Current step being executed
- Completion status of each criterion
- Retry counts and error history
- Full context for resumption

### How It Works

1. **Task Start**: Creates `durable-session.json` with all steps
2. **Step Execution**: Updates step status after each action
3. **Interruption**: Session persists on disk
4. **Resume**: `/wogi-start TASK-XXX` detects existing session
5. **Completion**: Session archived for learning

### Configuration

```json
{
  "durableSteps": {
    "enabled": true,              // Enable durable sessions
    "autoResume": true,           // Auto-resume on restart
    "checkSuspensionsOnStart": true,
    "defaultMaxAttempts": 5
  }
}
```

### Session File Structure

```json
{
  "taskId": "TASK-015",
  "taskType": "task",
  "startedAt": "2024-01-15T10:30:00Z",
  "steps": [
    {
      "id": "step-001",
      "description": "Create AuthService",
      "status": "completed",
      "completedAt": "2024-01-15T10:35:00Z"
    },
    {
      "id": "step-002",
      "description": "Create LoginForm",
      "status": "in_progress",
      "attempts": 1
    }
  ],
  "execution": {
    "currentStep": 1,
    "totalIterations": 2,
    "totalRetries": 1
  }
}
```

### Resuming a Session

```bash
# Normal start detects existing session
/wogi-start TASK-015
# Output: "🔄 Resuming from durable session (3/7 steps completed)"

# Force resume after suspension
flow resume --force

# Check session status
flow session status
```

---

## Suspend/Resume

For tasks that require waiting (external reviews, CI runs, etc.), suspend/resume allows pausing without losing context.

### Suspension Types

| Type | Trigger | Resume Condition |
|------|---------|-----------------|
| `time` | Wait for duration | Time elapsed |
| `poll` | Check external status | Condition met |
| `manual` | Human review needed | Explicit approval |
| `file` | Wait for file | File exists |

### Configuration

```json
{
  "suspension": {
    "enabled": true,
    "pollIntervalSeconds": 60,    // How often to check poll conditions
    "maxPollAttempts": 120,       // Max checks before timeout
    "reminderAfterHours": 24      // Remind about suspended tasks
  }
}
```

### Commands

```bash
# Suspend current task for 1 hour
flow suspend --time 1h "Waiting for CI"

# Suspend for human review
flow suspend --manual "Need design approval"

# Check suspension status
flow resume --status

# Resume when condition met
flow resume

# Force resume regardless of condition
flow resume --force

# Approve manual review
flow resume --approve
```

### Example: CI Wait

```bash
# After pushing PR
flow suspend --poll \
  --command "gh pr checks 123 | grep -q 'All checks passed'" \
  "Waiting for CI checks"

# WogiFlow will:
# 1. Save current context
# 2. Poll the command every 60 seconds
# 3. Auto-resume when command succeeds
```

---

## Hybrid Mode

Hybrid mode uses a local LLM for execution while Claude plans, saving 85-95% of tokens.

### The Trade-off

| Aspect | Claude Only | Hybrid Mode |
|--------|-------------|-------------|
| Token Cost | 100% | 5-15% |
| Code Quality | Highest | Good (varies by model) |
| Speed | Fast | Depends on hardware |
| Context | Full | Limited to prompt |

### How It Works

1. **Claude Plans**: Creates detailed execution plan with context
2. **Plan Export**: Saved as structured JSON with all needed info
3. **Local Execution**: Local LLM executes each step
4. **Validation**: Results verified against acceptance criteria
5. **Retry/Escalate**: Failed steps can retry or escalate to Claude

### Configuration

```json
{
  "hybrid": {
    "enabled": true,
    "executor": {
      "type": "local",              // "local" | "cloud"
      "provider": "ollama",         // "ollama" | "lmstudio" | "openai" | etc.
      "providerEndpoint": "http://localhost:11434",
      "model": "qwen3-coder"
    },
    "planner": {
      "adaptToExecutor": true,      // Adjust plan for model capabilities
      "useAdapterKnowledge": true   // Use learned model behaviors
    },
    "settings": {
      "temperature": 0.7,
      "maxTokens": 4096,
      "maxRetries": 20,
      "timeout": 120000,
      "autoExecute": false          // Require approval before execution
    }
  }
}
```

### Enabling Hybrid Mode

```bash
# Interactive setup
/wogi-hybrid-setup

# Or manually enable
/wogi-hybrid
```

### Execution Flow

```
Claude (Planning)                    Local LLM (Execution)
─────────────────                    ────────────────────
1. Analyze task
2. Create plan with:
   - Step descriptions
   - File paths
   - Component imports
   - Type definitions
   - Pattern requirements
3. Export plan.json
                          ────────▶  4. Load plan
                                     5. Execute each step
                                     6. Write files
                                     7. Run validation
                          ◀────────  8. Report results
9. Verify and commit
```

### Token Savings Calculation

Hybrid mode tracks savings:
```bash
flow session stats
# Output:
# Total sessions: 15
# Completed: 14
# Avg tokens saved: 85.3%
```

---

## Parallel Execution

Execute independent tasks simultaneously using git worktrees.

### Configuration

```json
{
  "parallel": {
    "enabled": true,
    "maxConcurrent": 3,           // Max parallel tasks
    "autoApprove": false,         // Require approval
    "requireWorktree": true,      // Isolate in worktrees
    "showProgress": true,
    "autoDetect": true,           // Detect parallelizable tasks
    "autoSuggest": true,          // Suggest when beneficial
    "autoExecute": false,         // Require approval
    "minTasksForParallel": 2
  }
}
```

### How It Works

1. **Detection**: Identify tasks with no dependencies
2. **Worktree Creation**: Each task gets isolated branch
3. **Parallel Execution**: Run tasks simultaneously
4. **Merge**: Combine completed branches
5. **Cleanup**: Remove worktrees

### Commands

```bash
# Suggest parallel execution
/wogi-bulk TASK-001 TASK-002 TASK-003

# Check parallel status
flow parallel status

# Merge completed parallel work
flow parallel merge
```

---

## Loop Status & Monitoring

### Check Loop Status

```bash
# Current loop status
node scripts/flow-task-enforcer.js status

# Output:
# 📊 Active Loop Session
# Task: TASK-015
# Iteration: 3
# Retries: 1
#
# Acceptance Criteria:
#   ✅ AC-1: Create AuthService
#   ✅ AC-2: Create LoginForm
#   ⏳ AC-3: Add validation
#   ⏳ AC-4: Handle errors
#
# Can exit: No (incomplete)
```

### Loop Statistics

```bash
node scripts/flow-task-enforcer.js stats

# Output:
# 📈 Loop Statistics
# Total loops: 47
# Completed: 45
# Failed: 2
# Avg iterations: 2.3
```

---

## Best Practices

1. **Keep criteria atomic** - Each should be independently verifiable
2. **Use auto-inference** - Let the system verify when possible
3. **Don't fight the loop** - If stuck, the criteria might need refinement
4. **Use hybrid for boilerplate** - Save tokens on repetitive work
5. **Suspend, don't abandon** - Preserve context for later

---

## Troubleshooting

### Loop won't exit
- Check if all criteria are marked complete
- Verify auto-inference is finding files/functions
- Review verification results in session

### Hybrid mode failures
- Check local LLM is running: `curl http://localhost:11434/api/version`
- Verify model is loaded: `ollama list`
- Check timeout settings for slow models

### Session not resuming
- Verify `durable-session.json` exists
- Check task ID matches
- Try `flow session status`

---

## Related

- [Task Planning](./01-task-planning.md) - Before the loop
- [Verification](./03-verification.md) - How criteria are verified
- [Trade-offs](./trade-offs.md) - Balancing thoroughness vs tokens
