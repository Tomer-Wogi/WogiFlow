# Memory & Context Management

Preventing hallucinations, managing context windows, and preserving session history.

---

## The Problem

AI struggles with:
- **Context Overflow**: Losing track when context gets too large
- **Session Amnesia**: Forgetting work between sessions
- **Hallucinations**: Making up components that don't exist
- **Lost History**: Not remembering past decisions

---

## The Solution

WogiFlow manages memory through:
- Context monitoring and compaction
- Durable sessions for crash recovery
- Memory blocks for key facts
- Request log as institutional memory

---

## Features

| Feature | Purpose |
|---------|---------|
| [Context Management](./context-management.md) | Monitor and compact context |
| [Session Persistence](./session-persistence.md) | Preserve work across sessions |
| [Memory Systems](./memory-systems.md) | Facts, decay, tiers |
| [Team History](./team-history.md) | Shared logs, audit trails |
| [PRD Management](./prd-management.md) | Load and query product specs |
| [Memory Commands](./memory-commands.md) | CLI for entropy, sync, routing |

---

## Quick Start

### Enable Context Monitoring

```json
{
  "contextMonitor": {
    "enabled": true,
    "warnAt": 0.7,          // Warn at 70%
    "criticalAt": 0.85,     // Critical at 85%
    "contextWindow": 200000
  }
}
```

### Check Context Health

```
Context is monitored automatically.
When high, you'll see:

⚠️ Context Health Warning
Usage: 165,000 / 200,000 tokens (82.5%)
Recommendation: Run /compact before continuing
```

### Compact When Needed

```bash
/wogi-compact
```

---

## Key Configuration

```json
{
  "contextMonitor": {
    "enabled": true,
    "warnAt": 0.7,
    "criticalAt": 0.85,
    "contextWindow": 200000,
    "checkOnSessionStart": true,
    "checkAfterTask": true
  },
  "sessionState": {
    "enabled": true,
    "autoRestore": true,
    "maxGapHours": 24,
    "trackFiles": true,
    "trackDecisions": true
  },
  "memory": {
    "enabled": true,
    "localDb": ".workflow/memory/local.db",
    "maxLocalFacts": 1000,
    "autoRemember": false
  },
  "requestLog": {
    "enabled": true,
    "autoArchive": true,
    "maxRecentEntries": 50
  }
}
```

---

## Memory Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐      │
│   │   Context   │   │   Session   │   │   Request   │      │
│   │   Monitor   │   │    State    │   │     Log     │      │
│   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘      │
│          │                 │                 │              │
│          ▼                 ▼                 ▼              │
│   ┌─────────────────────────────────────────────────┐      │
│   │                  Memory Blocks                   │      │
│   │  - Key facts                                    │      │
│   │  - Recent files                                 │      │
│   │  - Current task                                 │      │
│   │  - Important decisions                          │      │
│   └─────────────────────────────────────────────────┘      │
│                          │                                  │
│                          ▼                                  │
│   ┌─────────────────────────────────────────────────┐      │
│   │              Durable Session                     │      │
│   │  - Crash recovery                               │      │
│   │  - Step tracking                                │      │
│   │  - Resume context                               │      │
│   └─────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Context Thresholds

| Level | Threshold | Behavior |
|-------|-----------|----------|
| Normal | < 70% | Continue normally |
| Warning | 70-85% | Suggest compaction |
| Critical | > 85% | Strongly recommend compact |

---

## Compaction Strategy

When context is high:

1. **Preserve**: Key facts, current task, recent decisions
2. **Summarize**: Long conversations, completed work
3. **Archive**: Old request log entries
4. **Clear**: Temporary context, resolved issues

---

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-compact` | Compact conversation context |
| `/wogi-standup` | Morning briefing with context |
| `flow session status` | Check session state |
| `flow session restore` | Restore previous session |

---

## Best Practices

1. **Compact Regularly**: Every 2-3 tasks or 15-20 messages
2. **Update Progress**: Before compacting, update progress.md
3. **Log Changes**: Keep request-log current
4. **Use Morning Briefing**: Start sessions with context
5. **Trust the Warnings**: Compact when suggested

---

## Related

- [Task Execution](../02-task-execution/) - Uses session context
- [Self-Improvement](../03-self-improvement/) - Memory feeds learning
- [Configuration](../configuration/all-options.md) - All memory settings
