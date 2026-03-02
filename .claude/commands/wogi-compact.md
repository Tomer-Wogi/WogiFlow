---
description: "Compact conversation context using the recursive summary tree"
---
Compact the conversation to free up context space using the recursive summary tree.

## Recursive Context Compaction

WogiFlow uses a hierarchical summary tree to manage context:

```
Root (overview)
├── Tasks Section (summary)
│   ├── Task 1 (details, expandable)
│   └── Task 2 (details, expandable)
├── Decisions Section (summary)
│   └── Decision details (expandable)
└── Files Section (summary)
    └── File changes (expandable)
```

## CRITICAL: Task Queue Check

**Before ANY compaction**, you MUST:

1. Read `.workflow/state/ready.json`
2. Note pending tasks in your summary
3. **NEVER claim "nothing pending" without checking ready.json**

If tasks exist:
- **In Progress** (`inProgress` in ready.json): List task IDs currently being worked on
- **Ready** (`ready` in ready.json): Count + list task IDs awaiting work
- **Blocked** (`blocked` in ready.json): Count blocked tasks

This ensures task awareness survives context compaction.

## Before Compacting

1. **Update progress.md** with:
   - Current task being worked on
   - What's been done this session
   - Next steps
   - Any decisions made

2. **Ensure request-log is current** - All changes logged

3. **Save any in-progress work** - Commit or stash

## Automatic Context Saving

When compacting, the system automatically:
1. Builds a hierarchical summary tree of the session
2. Stores summaries at multiple levels (root → sections → details)
3. Applies relevance decay to older items
4. Enables on-demand expansion when details are needed later
5. **Cleans up completed plan files** from `~/.claude/plans/`

### Plan File Cleanup

Compaction automatically cleans up plan files from your home directory (`~/.claude/plans/`) that are explicitly marked as complete:
- Plans with `# Plan: Complete` in the title
- Plans containing the explicit marker `This plan can be deleted`

Only files with these explicit completion markers are deleted. This prevents stale plan files from accumulating and being shown after context restoration.

## Format for Context Summary

Provide this information for the compaction system:

```
## Session Summary for Compaction

**Goal**: [What user wanted to accomplish]

**Completed**:
- [Task/change 1]
- [Task/change 2]

**Pending Tasks** (REQUIRED - from ready.json):
- In Progress: [task IDs or "none"]
- Ready: [count] tasks - [first 5 task IDs]
- Blocked: [count] tasks

**In Progress (Current)**:
- TASK-XXX: [description] - [current state, what's left]

**Key Decisions**:
- [Decision 1]
- [Decision 2]

**Files Modified**:
- [file1.tsx] - [what changed]
- [file2.tsx] - [what changed]

**Next Steps**:
1. [Step 1]
2. [Step 2]

**Context to Preserve**:
- [Important context that should survive compaction]

**⚠️ ROUTING ENFORCEMENT (MANDATORY — survives compaction)**:
Every new user message after resuming from this compacted context MUST be
routed through a `/wogi-*` command BEFORE any other action. This includes
questions, conversations, follow-ups, and implementation requests.
Do NOT answer directly from compacted memory. Do NOT skip routing because
"the answer seems obvious." The routing requirement applies unconditionally.
If no Natural Language Detection match → invoke `/wogi-start` with the full
user message as args.

**ON RESUME**: Check `.workflow/state/ready.json` for pending work.
Route ALL new user messages through `/wogi-start` or a matching `/wogi-*` command.
```

## Context Pressure Monitoring

### Smart Compaction (v2.2)

With smart compaction enabled (`config.smartCompaction.enabled`), context is managed intelligently:

- **Before task start**: `/wogi-start` estimates task's context needs
- **Proactive compaction**: Only compacts if `current + estimated > 95%`
- **Emergency threshold**: Always compacts if context exceeds 95%

This means fixed thresholds are less relevant - compaction happens when actually needed based on the specific task.

### Proactive Phase-Boundary Compaction (v2.3)

With proactive compaction enabled (`config.proactiveCompaction.enabled`), WogiFlow compacts between task phases:

- **Phase boundaries**: After explore, spec, each scenario, criteria check, validation
- **Trigger threshold**: Default 75% context usage (configurable via `triggerThreshold`)
- **Task checkpoints**: Full task state saved to `.workflow/state/task-checkpoint.json` at every phase boundary
- **Auto-compact recovery**: If Claude's auto-compact fires, checkpoint enables lossless recovery

**How it works:**
1. At each phase boundary, `/wogi-start` saves a task checkpoint (task ID, phase, scenarios, files changed)
2. If context exceeds the trigger threshold, proactive compaction fires before the next phase
3. If Claude auto-compacts (at ~95%), session resume reads the checkpoint and restores full state

**Recovery flow:**
```
Auto-compact fires at ~95% → Session resumes with compressed context
→ /wogi-start detects checkpoint exists → Reads task-checkpoint.json
→ Displays: "Auto-compact detected. Restoring task state from checkpoint..."
→ Continues from the exact phase where it left off
```

**Config** (`config.proactiveCompaction`):
```json
{
  "enabled": true,
  "triggerThreshold": 0.75,
  "useHaiku": true,
  "phases": ["exploring", "spec_review", "scenario", "criteria_check", "validating"]
}
```

**CLI commands:**
```bash
# Check if compaction needed at a phase
node scripts/flow-proactive-compact.js check exploring 0.78 wf-a1b2c3d4

# Show current config
node scripts/flow-proactive-compact.js config

# Generate compaction context from checkpoint
node scripts/flow-proactive-compact.js context

# View/manage checkpoints
node scripts/flow-task-checkpoint.js load
node scripts/flow-task-checkpoint.js check
node scripts/flow-task-checkpoint.js clear wf-a1b2c3d4
```

### Legacy Fixed Thresholds

If smart compaction is disabled, check context pressure status:
- **Normal**: Under 50k tokens - no action needed
- **Warning**: 50k-80k tokens - consider compacting soon
- **Critical**: Over 80k tokens - compact immediately

## CLI Commands

```bash
# View tree stats
node scripts/flow-context-compact stats

# Check context pressure
node scripts/flow-context-compact pressure

# View serialized tree
node scripts/flow-context-compact show

# Manual compact
node scripts/flow-context-compact compact

# Compact and prune old nodes
node scripts/flow-context-compact compact --prune

# Get context for a query
node scripts/flow-context-compact context "authentication task"
```

After providing the summary, tell user: "Ready to compact. Please run /compact or continue and I'll auto-compact when needed."
