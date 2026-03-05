# Build Optimized Memory System

**ID**: wf-f7d4afeb
**Epic**: wf-ea2c59c1 (WogiFlow Deep Optimization)
**Type**: feature | **Level**: L1 | **Priority**: P1

## Problem

Memory system has 5 scattered config flags, dormant MCP server (302MB), and no pipeline integration. When enabled, nothing happens automatically — the AI must manually decide to call memory functions.

## Design

One config flag controls everything:
```json
{
  "memory": {
    "level": "standard",  // off | minimal | standard | full
    "localDb": ".workflow/memory/local.db"
  }
}
```

### Levels

| Level | Recall | Remember on fail | Remember on complete | Remember corrections | Auto-promote |
|-------|--------|-------------------|---------------------|---------------------|-------------|
| off | - | - | - | - | - |
| minimal | task start | - | - | corrections only | - |
| standard | task start | yes | yes | yes | - |
| full | task start | yes | yes | yes | yes |

### Pipeline Integration Points (hook-based, no MCP)

1. **Task start** (SessionStart / wogi-start): `recallForTask(taskTitle, taskType)` → search memory DB for relevant facts, inject into context
2. **Failed attempt** (loop retry detected): `rememberFailure(taskId, approach, error)` → store what didn't work
3. **Task complete** (taskCompleted hook): `rememberCompletion(taskId, decisions, patterns)` → store key decisions
4. **Session end** (SessionEnd hook): `rememberSessionLearnings(sessionSummary)` → store session learnings
5. **User correction** (feedback-patterns write): `rememberCorrection(correction)` → immediate store

### Implementation

- Use existing `flow-memory-db.js` as engine (storeFact, searchFacts)
- Add new functions: `recallForTask()`, `rememberFailure()`, `rememberCompletion()`, `rememberCorrection()`, `rememberSessionLearnings()`
- Wire into existing hooks — no new hook files needed
- No MCP registration — direct require() calls

## Acceptance Criteria

1. **Given** memory.level is "off", **When** any pipeline moment fires, **Then** no memory operations occur
2. **Given** memory.level is "minimal", **When** a task starts, **Then** relevant memories are recalled and shown
3. **Given** memory.level is "minimal" and user makes a correction, **When** correction is detected, **Then** it's stored in memory DB
4. **Given** memory.level is "standard" and a task fails, **When** retry is triggered, **Then** the failed approach is remembered
5. **Given** memory.level is "standard" and a task completes, **When** taskCompleted fires, **Then** key decisions are stored
6. **Given** memory.level is "full" and patterns accumulate, **When** threshold is reached, **Then** auto-promotion to decisions.md occurs
7. **Given** MCP memory server exists, **When** memory system is active, **Then** MCP is NOT used (direct function calls only)
8. **Given** memory recall at task start, **When** no relevant memories exist, **Then** no extra tokens are added
9. **Given** flow-memory-db.js is the engine, **When** memory operations run, **Then** existing SQLite DB is used

## Files to Change

- `scripts/flow-memory-db.js` — add recallForTask(), rememberFailure(), rememberCompletion(), etc.
- `scripts/hooks/core/session-context.js` — wire recall on task start
- `scripts/hooks/core/observation-capture.js` — wire remember on task events
- `scripts/hooks/entry/claude-code/session-end.js` — wire session learning
- `.workflow/config.json` — new memory.level key (replaces 5 old flags)
