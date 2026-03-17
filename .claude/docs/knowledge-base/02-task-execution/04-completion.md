# Completion

After verification passes, the completion phase handles logging, commits, archival, and cleanup. Task completion is managed automatically by `/wogi-start`'s execution pipeline.

---

## Request Logging

Every completed task is logged in `.workflow/state/request-log.md` for future context.

### Log Entry Format

```markdown
### R-047 | 2026-01-15 14:30
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
  "autoLog": true,
  "requestLog": {
    "enabled": true
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
    "preferVariants": true,
    "requireAppMapEntry": true,
    "requireDetailDoc": false
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
      "feature": true,
      "bugfix": false,
      "refactor": true,
      "docs": false
    },
    "autoCommitSmallFixes": true,
    "smallFixThreshold": 3,
    "squashTaskCommits": true,
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

wf-a1b2c3d4
```

### Small Fix Auto-Commit

If `autoCommitSmallFixes` is enabled and changes are < `smallFixThreshold` files:
```
Auto-committed small fix (2 files)
  Commit: abc1234 "fix(auth): correct password validation"
```

---

## Session Archival

Durable sessions are archived for learning and metrics.

### What's Archived

```json
{
  "taskId": "wf-a1b2c3d4",
  "taskType": "task",
  "startedAt": "2026-01-15T10:30:00Z",
  "completedAt": "2026-01-15T11:45:00Z",
  "status": "completed",
  "steps": [],
  "execution": {
    "totalIterations": 3,
    "totalRetries": 1
  }
}
```

### Configuration

```json
{
  "durableSteps": {
    "enabled": true
  }
}
```

---

## Checkpoint System

Checkpoints provide rollback capability during task execution.

### Configuration

```json
{
  "checkpoint": {
    "enabled": true
  }
}
```

### What's Saved

1. **Git Commit**: Current code state
2. **State Snapshot**: ready.json, request-log.md, app-map.md, etc.
3. **Session State**: durable-session.json

### Commands

```bash
flow checkpoint create "Before risky refactor"
flow checkpoint list
flow checkpoint rollback <checkpoint-id>
flow checkpoint status
```

### Rollback

When rolling back:
1. State files restored from snapshot
2. Git soft reset to checkpoint commit
3. Changes preserved as unstaged

---

## Context Health Check

After task completion, check context window usage.

### Configuration

```json
{
  "context": {
    "monitor": {
      "enabled": true,
      "warnAt": 0.7,
      "criticalAt": 0.85,
      "contextWindow": 200000,
      "checkAfterTask": true
    }
  }
}
```

### Post-Task Check

```
Completed: wf-a1b2c3d4

Context Health:
  Usage: 45,000 / 200,000 tokens (22.5%)
  Status: Healthy

# Or if high:
Context Health:
  Usage: 165,000 / 200,000 tokens (82.5%)
  Status: Consider running /wogi-pre-compact
```

---

## Completion Flow Summary

```
Task Verification Passed
         |
1. Move task to recentlyCompleted in ready.json
2. Archive durable session
3. Update session state
4. Add key fact to memory
5. Auto-archive request log (if threshold)
6. Commit changes (with approval if needed)
7. Run regression tests (if enabled)
8. Check context health
         |
    Task Complete
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-log` | Add request log entry |
| `/wogi-map-add` | Add component to app-map |
| `flow checkpoint create` | Manual checkpoint |
| `flow checkpoint rollback` | Rollback to checkpoint |

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
