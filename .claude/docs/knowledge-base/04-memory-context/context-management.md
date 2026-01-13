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
  "contextMonitor": {
    "enabled": true,
    "warnAt": 0.7,              // Warn at 70%
    "criticalAt": 0.85,         // Critical at 85%
    "contextWindow": 200000,    // Token limit
    "checkOnSessionStart": true,
    "checkAfterTask": true,
    "trackingMethod": "auto"    // auto, native, or estimated
  }
}
```

### Tracking Methods (v1.0.3+)

| Method | Description |
|--------|-------------|
| `auto` | Uses native if available, falls back to estimated (default) |
| `native` | Uses Claude Code's native context tracking (v1.0.52+) |
| `estimated` | Uses token estimation from state files |

Native tracking is more accurate but requires Claude Code v1.0.52+ and status line configuration via `/wogi-statusline-setup`.

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
/wogi-compact
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
    id: "TASK-015",
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
  "automaticMemory": {
    "compactOnSessionEnd": true
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
✓ Completed: TASK-015

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
    "autoArchive": true,
    "maxRecentEntries": 50,
    "keepRecent": 30,
    "createSummary": true
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
  "contextMonitor": {
    "contextWindow": 128000
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
  "contextMonitor": {
    "enabled": true,
    "checkOnSessionStart": true,
    "checkAfterTask": true
  }
}
```

---

## Related

- [Session Persistence](./session-persistence.md) - Preserving across sessions
- [Memory Systems](./memory-systems.md) - Fact storage and decay
- [Compaction Command](../../commands.md) - Full command reference
