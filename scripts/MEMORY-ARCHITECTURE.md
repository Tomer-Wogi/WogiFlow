# Memory & Knowledge System Architecture

This document clarifies the boundaries between the memory and knowledge modules.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE LAYER                               │
│  Where learnings/rules are stored and retrieved                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────┐     ┌─────────────────────┐             │
│  │ flow-knowledge-     │     │ flow-knowledge-     │             │
│  │ router.js           │     │ sync.js             │             │
│  │                     │     │                     │             │
│  │ WHERE to store      │     │ FRESHNESS of        │             │
│  │ learnings           │     │ knowledge files     │             │
│  │                     │     │                     │             │
│  │ Routes to:          │     │ Tracks:             │             │
│  │ - model-specific    │     │ - stack.md          │             │
│  │ - skill             │     │ - architecture.md   │             │
│  │ - project           │     │ - testing.md        │             │
│  │ - team              │     │                     │             │
│  └─────────────────────┘     └─────────────────────┘             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    MEMORY LAYER                                  │
│  Persistent fact storage and retrieval                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────┐     ┌─────────────────────┐             │
│  │ flow-memory-db.js   │     │ flow-memory-sync.js │             │
│  │                     │     │                     │             │
│  │ DATABASE operations │     │ PROMOTION of        │             │
│  │                     │     │ facts to rules      │             │
│  │ - SQLite + sql.js   │     │                     │             │
│  │ - Embeddings        │     │ Promotes:           │             │
│  │ - Semantic search   │     │ high-relevance      │             │
│  │ - Facts/Proposals   │     │ facts → decisions.md│             │
│  │ - PRD storage       │     │                     │             │
│  └──────────┬──────────┘     └──────────┬──────────┘             │
│             │                           │                         │
│             └───────────────────────────┘                         │
│                         │                                         │
│                         ▼                                         │
│             ┌─────────────────────┐                              │
│             │ .workflow/memory/   │                              │
│             │ local.db            │                              │
│             └─────────────────────┘                              │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Module Responsibilities

### flow-knowledge-router.js
**Purpose**: Determine WHERE learnings should be stored.

**Input**: A correction/learning text + context
**Output**: Routing recommendation (model-specific, skill, project, or team)

**Commands**:
```bash
flow knowledge-route detect "<text>"   # Detect route
flow knowledge-route store "<text>"    # Store with detected route
flow knowledge-route routes            # Show all routes
```

### flow-knowledge-sync.js
**Purpose**: Track FRESHNESS of knowledge files.

**Monitors**:
- package.json → stack.md
- src/ structure → architecture.md
- test config → testing.md

**Commands**:
```bash
flow knowledge-sync status      # Check sync status
flow knowledge-sync regenerate  # Regenerate stale files
```

### flow-memory-db.js
**Purpose**: DATABASE operations for persistent memory.

**Features**:
- SQLite database using sql.js (pure JS)
- Embedding generation via @xenova/transformers
- Semantic similarity search
- Facts, proposals, and PRD chunk storage

**Used by**: MCP memory server, memory-sync

### flow-memory-sync.js
**Purpose**: PROMOTE high-relevance facts to decisions.md.

**Flow**:
1. Scan memory DB for high-relevance facts
2. Check if fact applies broadly (not one-off)
3. Propose promotion to decisions.md
4. On approval, add to decisions.md

**Commands**:
```bash
flow memory-sync             # Check for promotable patterns
flow memory-sync --auto      # Auto-promote without asking
flow memory-sync --list      # List candidates only
```

## Data Flow

```
User correction
      │
      ▼
┌─────────────────────┐
│ knowledge-router    │──────► Route to storage location
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│ memory-db           │──────► Store in SQLite
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│ memory-sync         │──────► Promote to decisions.md
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│ knowledge-sync      │──────► Regenerate knowledge files
└─────────────────────┘
```

## Why Separate Modules?

1. **Single Responsibility**: Each module does one thing well
2. **Testability**: Easier to test in isolation
3. **Composability**: Can be used independently or together
4. **Maintainability**: Changes to one don't affect others

## Future Considerations

- Consider extracting common utilities to `flow-memory-utils.js`
- May add `flow-knowledge-index.js` for knowledge search
- Could add `flow-memory-export.js` for team sharing
