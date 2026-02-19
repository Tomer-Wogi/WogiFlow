# Completion

After verification passes, the completion phase handles logging, commits, archival, and cleanup.

---

## Request Logging

Every completed task is logged in `.workflow/state/request-log.md` for future context.

### Log Entry Format

```markdown
### R-047 | 2024-01-15 14:30
**Type**: new
**Tags**: #screen:login #component:AuthService #feature:authentication
**Request**: "Add user authentication with login form"
**Result**: Created AuthService and LoginForm components with validation
**Files**: src/services/AuthService.ts, src/components/LoginForm.tsx
```

### Entry Fields

| Field | Purpose |
|-------|---------|
| `Type` | new / fix / change / refactor |
| `Tags` | Searchable categories (#screen, #component, #feature) |
| `Request` | Original user request |
| `Result` | What was accomplished |
| `Files` | Files created/modified |

### Configuration

```json
{
  "autoLog": true,                    // Auto-add log entries
  "requestLog": {
    "enabled": true,
    "autoArchive": true,              // Archive old entries
    "maxRecentEntries": 50,           // Keep last 50 active
    "keepRecent": 30,                 // Days before archival
    "createSummary": true             // Generate summary on archive
  }
}
```

### Why Logging Matters

- **Future Context**: AI reads log to understand project history
- **Pattern Learning**: Identify common requests and solutions
- **Audit Trail**: Track what changed and when
- **Tag Search**: Find related work with `/wogi-search #component:Button`

---

## App-Map Updates

New components are registered in `.workflow/state/app-map.md`.

### When to Update

- Created new component
- Created new hook
- Created new service/utility
- Created new page/route

### Update Format

```markdown
## Components

### Button (src/components/Button.tsx)
- **Variants**: primary, secondary, ghost, danger
- **Props**: label, onClick, disabled, loading
- **Used by**: LoginForm, RegistrationForm, DashboardHeader
```

### Configuration

```json
{
  "autoUpdateAppMap": true,
  "componentRules": {
    "preferVariants": true,           // Suggest variants over new components
    "requireAppMapEntry": true,       // Block completion without entry
    "requireDetailDoc": false         // Require detailed documentation
  }
}
```

### Automatic Detection

On task completion, system checks:
1. Were new files created in component directories?
2. Do they export React components/hooks?
3. If yes, prompt to add to app-map

---

## Commit Handling

Commits are managed based on task type and configuration.

### Configuration

```json
{
  "commits": {
    "requireApproval": {
      "feature": true,          // Features need approval
      "bugfix": false,          // Bugfixes auto-commit
      "refactor": true,         // Refactors need approval
      "docs": false             // Docs auto-commit
    },
    "autoCommitSmallFixes": true,
    "smallFixThreshold": 3,     // Files count for "small"
    "squashTaskCommits": true,  // Squash on completion
    "commitMessageFormat": "conventional"
  }
}
```

### Approval Flow

For tasks requiring approval:

```
Changes to commit:

  M src/services/AuthService.ts
  A src/components/LoginForm.tsx
  A src/components/LoginForm.test.tsx
  M src/routes/index.tsx

Ready to commit these changes? [y/n]
```

### Commit Message Format

**Conventional:**
```
feat(auth): add user authentication

- Create AuthService with login/logout
- Add LoginForm component with validation
- Integrate with existing routing

TASK-015

🤖 Generated with Claude Code
```

### Small Fix Auto-Commit

If `autoCommitSmallFixes` is enabled and changes are < `smallFixThreshold` files:
```
✓ Auto-committed small fix (2 files)
  Commit: abc1234 "fix(auth): correct password validation"
```

---

## Session Archival

Durable sessions are archived for learning and metrics.

### What's Archived

```json
{
  "taskId": "TASK-015",
  "taskType": "task",
  "startedAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T11:45:00Z",
  "status": "completed",
  "steps": [...],
  "execution": {
    "totalIterations": 3,
    "totalRetries": 1
  },
  "metrics": {
    "stepsCompleted": 5,
    "tokensSaved": 12500,
    "duration": 4500000
  }
}
```

### Archive Location

`.workflow/state/session-history/`

### Configuration

```json
{
  "durableSteps": {
    "enabled": true,
    "autoResume": true
  }
}
```

### Session History Commands

```bash
# View session statistics
flow session stats

# Output:
# Total sessions: 47
# Completed: 45
# Failed: 2
# Cancelled: 0
# Avg steps: 4.2
# Avg tokens saved: 85.3%
```

---

## Checkpoint System

Checkpoints provide rollback capability during task execution.

### Configuration

```json
{
  "checkpoint": {
    "enabled": true,
    "interval": 5,                // Create every N steps
    "maxCheckpoints": 20,         // Keep last 20
    "autoCommit": true,           // Git commit at checkpoint
    "commitPrefix": "[checkpoint]",
    "includeStateFiles": true     // Snapshot workflow state
  }
}
```

### What's Saved

1. **Git Commit**: Current code state
2. **State Snapshot**: ready.json, request-log.md, app-map.md, etc.
3. **Session State**: durable-session.json

### Commands

```bash
# Create manual checkpoint
flow checkpoint create "Before risky refactor"

# List checkpoints
flow checkpoint list

# Rollback to checkpoint
flow checkpoint rollback cp-2024-01-15T10-30-00

# Status
flow checkpoint status
```

### Rollback

When rolling back:
1. State files restored from snapshot
2. Git soft reset to checkpoint commit
3. Changes preserved as unstaged

```bash
flow checkpoint rollback cp-2024-01-15T10-30-00

# Output:
# ✅ State files restored
# ✅ Git rolled back to abc1234
#
# Changes since checkpoint are now unstaged.
# Review with: git status
```

---

## Context Health Check

After task completion, check context window usage.

### Configuration

```json
{
  "contextMonitor": {
    "enabled": true,
    "warnAt": 0.7,              // Warn at 70% usage
    "criticalAt": 0.85,         // Critical at 85%
    "contextWindow": 200000,    // Token limit
    "checkAfterTask": true
  }
}
```

### Post-Task Check

```
✓ Completed: TASK-015

Context Health:
  Usage: 45,000 / 200,000 tokens (22.5%)
  Status: ✓ Healthy

# Or if high:
Context Health:
  Usage: 165,000 / 200,000 tokens (82.5%)
  Status: ⚠️ Consider running /compact
```

---

## Completion Flow Summary

```
Task Verification Passed
         ↓
┌────────────────────────────────────────────┐
│ 1. Move task to recentlyCompleted          │
├────────────────────────────────────────────┤
│ 2. Archive durable session                 │
├────────────────────────────────────────────┤
│ 3. Update session state                    │
├────────────────────────────────────────────┤
│ 4. Add key fact to memory                  │
├────────────────────────────────────────────┤
│ 5. Auto-archive request log (if threshold) │
├────────────────────────────────────────────┤
│ 6. Commit changes (with approval if needed)│
├────────────────────────────────────────────┤
│ 7. Run regression tests (if enabled)       │
├────────────────────────────────────────────┤
│ 8. Check context health                    │
└────────────────────────────────────────────┘
         ↓
    ✓ Task Complete
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-done TASK-XXX` | Complete task (runs gates) |
| `/wogi-log` | Add request log entry |
| `/wogi-map-add` | Add component to app-map |
| `flow checkpoint create` | Manual checkpoint |
| `flow checkpoint rollback` | Rollback to checkpoint |
| `flow session stats` | View session metrics |

---

## Best Practices

1. **Always log completed tasks** - Future AI needs this context
2. **Update app-map for new components** - Prevents duplication
3. **Use checkpoints for risky work** - Easy rollback
4. **Monitor context health** - Compact before overflow
5. **Review commit diffs** - Catch unintended changes

---

## Related

- [Verification](./03-verification.md) - Before completion
- [Trade-offs](./trade-offs.md) - Balancing thoroughness
- [Memory & Context](../04-memory-context/) - Context management
