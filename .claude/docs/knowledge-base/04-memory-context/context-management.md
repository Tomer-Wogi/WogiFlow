# Context Management

Monitor context usage and compact when needed.

---

## Why Context Matters

Claude has a context window limit. When exceeded:
- Earlier conversation is lost
- AI may hallucinate or repeat itself
- Work quality degrades

WogiFlow monitors context and helps you manage it.

---

## Configuration

```json
{
  "context": {
    "monitor": {
      "enabled": true
    },
    "smart": {
      "enabled": true,
      "safeThreshold": 0.95,
      "emergencyThreshold": 0.9
    },
    "proactive": {
      "enabled": true,
      "triggerThreshold": 0.75
    }
  }
}
```

> **Note**: Context monitoring is disabled by default (`enabled: false`). The `context` section also includes `smart` (pre-task context estimation) and `proactive` (automatic compaction at phase boundaries) sub-keys. See [All Options](../configuration/all-options.md) for full details.
```

### Context Estimation

WogiFlow estimates context usage before starting tasks via `context.smart`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `safeThreshold` | 0.95 | Projected usage below this is safe |
| `emergencyThreshold` | 0.9 | Current usage above this triggers emergency compact |
| `perFile` | 0.02 | Estimated context cost per file |
| `perCriterion` | 0.03 | Estimated context cost per acceptance criterion |

---

## How Monitoring Works

### Automatic Checks

Context is checked:
1. At session start (`checkOnSessionStart`)
2. After task completion (`checkAfterTask`)
3. Before large operations

### Warning Levels

```
Usage: 45,000 / 200,000 (22.5%)
Status: ✓ Healthy

Usage: 145,000 / 200,000 (72.5%)
Status: ⚠️ Warning - Consider compacting

Usage: 175,000 / 200,000 (87.5%)
Status: 🚨 Critical - Compact now
```

---

## Compaction

### What is Compaction?

Compaction summarizes the conversation to free context space while preserving essential information.

### When to Compact

- After completing 2-3 tasks
- After 15-20 messages
- Before starting large tasks
- When warned about context usage

### How to Compact

```bash
/wogi-pre-compact
```

### What's Preserved

- Current task and acceptance criteria
- Recent key facts
- Important decisions made
- Files currently being worked on

### What's Summarized

- Completed work details
- Long code discussions
- Exploration and research
- Resolved issues

---

## Memory Blocks

Key facts are stored in memory blocks:

```javascript
// From flow-memory-blocks.js

const memoryBlocks = {
  currentTask: {
    id: "wf-a1b2c3d4",
    title: "Add authentication"
  },
  keyFacts: [
    "Using existing api wrapper from lib/api.ts",
    "Auth tokens stored in localStorage"
  ],
  recentFiles: [
    "src/services/AuthService.ts",
    "src/components/LoginForm.tsx"
  ],
  decisions: [
    "Use Zustand for auth state",
    "JWT tokens with refresh"
  ]
};
```

### Adding Key Facts

```javascript
addKeyFact("Auth tokens expire after 1 hour");
```

### Clearing on Task Complete

```javascript
clearCurrentTask();
```

---

## Pre-Compaction Checklist

Before running `/compact`:

1. **Update Progress**
   ```bash
   # Ensure progress.md reflects current state
   cat .workflow/state/progress.md
   ```

2. **Log Completed Work**
   ```bash
   # Add entries to request-log
   /wogi-log
   ```

3. **Commit Changes**
   ```bash
   git add -A && git commit -m "checkpoint before compact"
   ```

---

## Compaction Strategy

### Default Strategy

```json
{
  "memory": {
    "automatic": {
      "compactOnSessionEnd": true
    }
  }
}
```

### Custom Strategies

Available in config:
- `entropyThreshold`: How aggressively to compact
- `relevanceDecay`: How quickly old info loses relevance

---

## Tracking Context Health

### CLI Check

```bash
flow context status

# Output:
# Context Health
# ─────────────────────
# Usage: 145,000 / 200,000 (72.5%)
# Status: Warning
# Last compaction: 2024-01-15 10:30
# Recommendation: Compact before next large task
```

### In-Session Check

After completing a task:
```
✓ Completed: wf-a1b2c3d4

Context Health:
  Usage: 72.5%
  Status: ⚠️ Consider running /compact
```

---

## Automatic Archival

Old request log entries are archived automatically:

```json
{
  "requestLog": {
    "enabled": true
  }
}
```

### How It Works

1. When entries exceed `maxRecentEntries`
2. Old entries moved to archive
3. Summary created if `createSummary` is true
4. Archived entries still searchable

---

## Context Window Sizes

| Model | Context Window |
|-------|---------------|
| Claude Opus | 200,000 |
| Claude Sonnet | 200,000 |
| Claude Haiku | 200,000 |
| GPT-4 | 128,000 |
| Local models | Varies (4K-128K) |

Configure for your model:
```json
{
  "context": {
    "monitor": {
      "contextWindow": 128000
    }
  }
}
```

---

## Best Practices

1. **Compact Proactively**: Don't wait for critical
2. **Save Before Compact**: Commit your work first
3. **Use Memory Blocks**: Mark important facts
4. **Review Compaction**: Check nothing important was lost
5. **Adjust Thresholds**: Lower if you need more buffer

---

## Troubleshooting

### Lost Context After Compact

Check preserved data:
- Memory blocks should retain key facts
- Current task should be preserved
- progress.md should have handoff notes

### Context Growing Too Fast

Consider:
- Breaking large tasks into smaller ones
- Using hybrid mode for boilerplate
- More frequent compaction

### Warning Not Appearing

Check configuration:
```json
{
  "context": {
    "monitor": {
      "enabled": true
    }
  }
}
```

---

## Related

- [Session Persistence](./session-persistence.md) - Preserving across sessions
- [Memory Systems](./memory-systems.md) - Fact storage and decay
- [Compaction Command](../../commands.md) - Full command reference
