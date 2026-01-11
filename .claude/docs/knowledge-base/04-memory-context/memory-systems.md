# Memory Systems

Facts, relevance decay, and memory tiers.

---

## Overview

WogiFlow has multiple memory systems:
- **Local Facts**: Project-specific knowledge
- **Memory Blocks**: Current session context
- **Relevance Decay**: Time-based importance
- **Automatic Memory**: Self-managing storage

---

## Configuration

```json
{
  "memory": {
    "enabled": true,
    "localDb": ".workflow/memory/local.db",
    "embeddingModel": "Xenova/all-MiniLM-L6-v2",
    "maxLocalFacts": 1000,
    "autoRemember": false
  },
  "automaticMemory": {
    "enabled": true,
    "entropyThreshold": 0.7,
    "compactOnSessionEnd": true,
    "relevanceDecay": {
      "enabled": true,
      "decayRate": 0.033,
      "neverAccessedPenalty": 0.1
    },
    "demotion": {
      "relevanceThreshold": 0.3,
      "coldRetentionDays": 90
    }
  }
}
```

---

## Local Facts

Stored in SQLite database:

```
.workflow/memory/local.db
```

### Fact Structure

```json
{
  "id": "fact-001",
  "content": "API tokens expire after 1 hour",
  "category": "architecture",
  "relevance": 0.95,
  "createdAt": "2024-01-15T10:30:00Z",
  "lastAccessed": "2024-01-15T14:00:00Z",
  "accessCount": 3
}
```

### Categories

| Category | Purpose |
|----------|---------|
| architecture | Structural decisions |
| pattern | Coding patterns |
| convention | Team conventions |
| context | Project-specific context |
| temporary | Short-term facts |

---

## Memory Blocks

Active session context:

```javascript
const memoryBlocks = {
  currentTask: {
    id: "TASK-015",
    title: "Add authentication",
    acceptanceCriteria: [...]
  },
  keyFacts: [
    "Using JWT tokens with refresh",
    "Auth state in Zustand store"
  ],
  recentFiles: [
    "src/services/AuthService.ts",
    "src/components/LoginForm.tsx"
  ],
  importantDecisions: [
    "Use localStorage for tokens",
    "1 hour token expiry"
  ]
};
```

### Operations

```javascript
// Add fact
addKeyFact("API uses v2 endpoints");

// Set current task
setCurrentTask("TASK-015", "Add authentication");

// Clear on completion
clearCurrentTask();
```

---

## Relevance Decay

Facts become less relevant over time:

```
Relevance Score
     │
1.0  ├──────╮
     │       ╲
0.8  │        ╲
     │         ╲  decay rate: 0.033
0.6  │          ╲
     │           ╲
0.4  │            ╲
     │             ╲
0.2  │──────────────╲─────────────
     │              threshold (demotion)
0.0  └─────────────────────────────▶
     0    10    20    30    40 days
```

### Configuration

```json
{
  "automaticMemory": {
    "relevanceDecay": {
      "enabled": true,
      "decayRate": 0.033,            // ~3% per day
      "neverAccessedPenalty": 0.1    // Extra penalty if never used
    }
  }
}
```

### Decay Formula

```
newRelevance = currentRelevance * (1 - decayRate) ^ daysSinceAccess
```

---

## Memory Tiers

Facts move through tiers based on relevance:

```
┌─────────────────────────────────────────────────────────────┐
│                      MEMORY TIERS                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────┐                                      │
│   │    HOT MEMORY   │  Relevance > 0.7                     │
│   │  Active context │  Always loaded                       │
│   └────────┬────────┘                                      │
│            │ decay                                          │
│            ▼                                                │
│   ┌─────────────────┐                                      │
│   │   WARM MEMORY   │  Relevance 0.3-0.7                   │
│   │  Recent facts   │  Loaded on demand                    │
│   └────────┬────────┘                                      │
│            │ decay                                          │
│            ▼                                                │
│   ┌─────────────────┐                                      │
│   │   COLD MEMORY   │  Relevance < 0.3                     │
│   │  Archived       │  Searchable only                     │
│   └────────┬────────┘                                      │
│            │ expires                                        │
│            ▼                                                │
│        [Deleted]        After coldRetentionDays            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Demotion

```json
{
  "automaticMemory": {
    "demotion": {
      "relevanceThreshold": 0.3,     // Below this → cold
      "coldRetentionDays": 90        // Days before deletion
    }
  }
}
```

---

## Automatic Memory

Self-managing memory system:

```json
{
  "automaticMemory": {
    "enabled": true,
    "entropyThreshold": 0.7,         // How "interesting" to remember
    "compactOnSessionEnd": true
  }
}
```

### What's Auto-Remembered

- Important decisions made
- Patterns discovered
- Key architectural choices
- Frequently referenced facts

### Entropy Threshold

Higher = more selective (only very important facts)
Lower = more inclusive (remembers more)

---

## Self-Tuning

Automatic parameter adjustment:

```json
{
  "automaticMemory": {
    "selfTuning": {
      "enabled": false,
      "adjustOnOverflow": true,      // Adjust when memory full
      "adjustOnFailures": true       // Adjust when facts missed
    }
  }
}
```

When enabled:
- Adjusts decay rate based on usage
- Adjusts threshold based on misses
- Optimizes for your usage patterns

---

## PRD Chunking

Large documents are chunked for efficient retrieval:

```json
{
  "prd": {
    "enabled": true,
    "maxContextTokens": 2000,        // Max tokens per retrieval
    "chunkSize": 500,                // Tokens per chunk
    "autoRetrieve": false            // Auto-retrieve relevant chunks
  }
}
```

### How It Works

1. PRD is split into chunks
2. Chunks are embedded for similarity search
3. When relevant, matching chunks are retrieved
4. Only needed context is loaded

---

## Fact Access

Facts gain relevance when accessed:

```javascript
// When a fact is used
function accessFact(factId) {
  fact.lastAccessed = new Date();
  fact.accessCount++;
  fact.relevance = recalculateRelevance(fact);
}
```

Frequently used facts stay in hot memory.

---

## Commands

```bash
# (Future) View memory stats
flow memory stats

# (Future) Search facts
flow memory search "authentication"

# Clear temporary facts
flow memory clear --temporary
```

---

## Best Practices

1. **Let Auto-Memory Work**: Don't manually manage everything
2. **Mark Important Facts**: Explicitly add key facts
3. **Review Periodically**: Check what's being remembered
4. **Adjust Decay Rate**: Lower for stable projects
5. **Use PRD Chunking**: For large documents

---

## Troubleshooting

### Important Fact Forgotten

Check relevance score. If too low:
- Access the fact to boost relevance
- Lower decay rate in config
- Mark as permanent (future feature)

### Memory Growing Too Large

Check maxLocalFacts setting:
```json
{
  "memory": {
    "maxLocalFacts": 500
  }
}
```

### Slow Retrieval

Consider reducing embeddingModel complexity or maxLocalFacts.

---

## Related

- [Context Management](./context-management.md) - Active context
- [Session Persistence](./session-persistence.md) - Session memory
- [Configuration](../configuration/all-options.md) - All settings
