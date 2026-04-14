# Task Execution Flow

The `/wogi-start` command initiates a structured execution pipeline that ensures thorough, high-quality task completion. This is the heart of WogiFlow.

---

## The Execution Pipeline

```
1. Task Selection    →  2. Planning     →  3. Execution Loop  →  4. Verification  →  5. Completion
   ─────────────────    ─────────────     ──────────────────     ──────────────      ────────────
   • Task gating        • Story creation   • Self-completing    • Auto-inference    • Logging
   • Size assessment    • Acceptance       • Durable sessions   • Quality gates     • Commits
   • Dependency check     criteria         • Suspend/resume     • Quality gates     • Archival
                        • Decomposition    • Hybrid mode                            • Cleanup
```

---

## Why This Matters

**The Problem**: Without structure, AI tends to:
- Start coding without understanding the full scope
- Miss edge cases and error handling
- Leave tasks incomplete when "good enough"
- Skip verification and break other features

**The Solution**: WogiFlow enforces a pipeline that:
- Gates implementation behind proper planning
- Loops until ALL acceptance criteria pass
- Verifies changes don't break existing functionality
- Documents everything for future context

---

## Quick Start

```bash
# See available tasks
/wogi-ready

# Start a task (enters execution pipeline)
/wogi-start wf-a1b2c3d4

# Create a story with acceptance criteria first
/wogi-story "Add user authentication"
```

---

## Pipeline Steps

### Step 1: Task Selection & Planning
Before any code is written, ensure the task is properly scoped.

**Key Features:**
- **Task Gating**: Implementation requires an existing task (no ad-hoc coding)
- **Size Assessment**: Small/Medium/Large determines planning depth
- **Story Creation**: Detailed acceptance criteria for non-trivial tasks

[Read more: Task Planning](./01-task-planning.md)

### Step 2: Execution Loop
The core loop that ensures thorough completion.

**Key Features:**
- **Self-Completing Loops**: Cannot exit until all criteria pass
- **Durable Sessions**: Crash recovery and progress tracking
- **Suspend/Resume**: Handle long-running or blocked tasks
- **Hybrid Mode**: Use local LLM for execution (configurable token savings)

[Read more: Execution Loop](./02-execution-loop.md)

### Step 3: Verification
Automated checks that validate the implementation.

**Key Features:**
- **Auto-Inference**: Automatic verification of file existence, function exports, etc.
- **Quality Gates**: Lint, typecheck, test requirements per task type
- **Pattern Enforcement**: Ensure code follows project decisions

[Read more: Verification](./03-verification.md)

### Step 4: Completion
Proper wrap-up and documentation.

**Key Features:**
- **Request Logging**: Every change documented with tags
- **App-Map Updates**: New components registered
- **Commit Handling**: Approval workflow based on task type
- **Session Archival**: Preserve context for learning

[Read more: Completion](./04-completion.md)

### Step 5: Session Review (Optional)
Comprehensive code review before finalizing changes.

**Key Features:**
- **3 Parallel Agents**: Code/Logic, Security, Architecture
- **Natural Triggers**: Say "please review" to run
- **Consolidated Report**: Issues ranked by severity

[Read more: Session Review](./05-session-review.md)

---

## Essential Configuration

```json
{
  "enforcement": {
    "strictMode": true,                    // Require tasks for implementation
    "requireTaskForImplementation": true,   // Block ad-hoc coding
    "requireStoryForMediumTasks": true      // Medium+ tasks need stories
  },
  "execution": {
    "loops": {
      "enforced": true,                    // Cannot exit until complete
      "maxRetries": 5,                     // Failed verification retries
      "maxIterations": 20                  // Total loop cycles
    }
  },
  "qualityGates": {
    "feature": {
      "require": ["tests", "registryUpdate", "requestLogEntry"]
    }
  }
}
```

---

## Trade-offs

Understanding the trade-offs helps you configure WogiFlow for your needs:

| Setting | Higher Value | Lower Value |
|---------|-------------|-------------|
| `execution.loops.maxRetries` | More thorough, more tokens | Faster, might miss issues |
| `execution.loops.enforced` | Guaranteed completion | Manual control |
| `qualityGates` | Fewer bugs in production | Faster development |
| `models.hybrid.enabled` | Token savings (varies by model) | Full Claude quality |

[Read more: Trade-offs](./trade-offs.md)

---

## Additional Features

### Plan Management
Strategic initiatives that coordinate epics and features.

[Read more: Plan Management](./plan-management.md)

### Specification Mode
How specs are generated and verified for medium/large tasks.

[Read more: Specification Mode](./specification-mode.md)

### Quick Capture
Capture ideas and bugs without interrupting current work.

[Read more: Quick Capture](./quick-capture.md)

### Debug Hypothesis
Parallel agents investigate competing theories for bug investigation.

[Read more: Debug Hypothesis](./debug-hypothesis.md)

### Peer Review
Multi-model code review for diverse perspectives.

[Read more: Peer Review](./peer-review.md)

### Eval System
Multi-judge scoring for task output quality assessment.

[Read more: Eval System](./eval-system.md)

### Branch Finalization
Merge, PR, or discard decision workflow for branches.

[Read more: Branch Finalization](./branch-finalization.md)

### Workspace Mode
Multi-repo orchestration with manager-worker architecture, boundary enforcement, and agent-to-agent communication.

[Read more: Workspace Mode](./workspace-mode.md)

### Decision Authority
Automatic classification of which decisions the AI makes autonomously vs which need human approval.

[Read more: Decision Authority](./decision-authority.md)

### External Integrations (Archived)
Task import from Jira and Linear — currently archived, may return via WogiFlow Teams.

[Read more: External Integrations](./external-integrations.md)

### Model Management
Registry, routing, and statistics for multiple LLM providers.

[Read more: Model Management](./model-management.md)

---

## Related

- [Commands Reference](../../commands.md) - All slash commands
- [Configuration Reference](../configuration/all-options.md) - All config options
- [Safety & Guardrails](../06-safety-guardrails/) - Damage control, checkpoints
