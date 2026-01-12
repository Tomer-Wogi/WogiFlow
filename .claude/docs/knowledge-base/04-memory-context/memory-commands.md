# Memory Management Commands

CLI commands for managing WogiFlow's memory system.

---

## Overview

Memory management commands help monitor, maintain, and optimize the memory database and learned patterns.

---

## Entropy Monitor

Track memory fragmentation and context efficiency.

**Script**: `flow-entropy-monitor.js`

```bash
# Show memory entropy stats
flow entropy

# Auto-compact if entropy is high
flow entropy --auto

# Show entropy history
flow entropy --history
```

### What is Entropy?

Memory entropy measures:
- Fragmentation of stored facts
- Staleness of patterns
- Context window efficiency

High entropy (>0.7) suggests compaction needed.

### Output Example

```
Memory Entropy Analysis
════════════════════════════════════════
Current Entropy:  0.45
Threshold:        0.70
Status:           ✓ Healthy

Breakdown:
  Facts:          234 (12 stale)
  Patterns:       45 (3 low-confidence)
  PRD Chunks:     89

Recommendation:   No action needed
```

---

## Memory Sync

Promote high-confidence patterns to project rules.

**Script**: `flow-memory-sync.js`

```bash
# Check for promotable patterns
flow memory-sync

# List candidates only
flow memory-sync --list

# Auto-promote without asking
flow memory-sync --auto

# Show sync status
flow memory-sync --status

# Promote specific fact
flow memory-sync --promote <fact-id>
```

### Promotion Criteria

A pattern is promotable when:
- Relevance score ≥ 80%
- Access count ≥ 3
- Not already in `decisions.md`

### Promotion Flow

```
Memory DB → Candidate Analysis → decisions.md → .claude/rules/
```

Promoted patterns become project rules that load automatically.

---

## Memory Database

Direct database operations.

```bash
# Show memory stats
flow memory stats

# Output:
# Facts: 234
# Proposals: 12
# PRD Chunks: 89
# Database Size: 2.4 MB
```

### Database Location

```
.workflow/memory/local.db
```

SQLite database managed by `flow-memory-db.js`.

---

## Knowledge Router

Route learnings to appropriate storage locations.

**Script**: `flow-knowledge-router.js`

```bash
# Detect route for a learning
flow knowledge-route detect "Always use explicit types"

# Store with detected route
flow knowledge-route store "Use kebab-case" project

# Show all route types
flow knowledge-route routes
```

### Route Types

| Route | Storage Location |
|-------|------------------|
| `model-specific` | `.workflow/model-adapters/<model>.md` |
| `skill:<name>` | `.claude/skills/<name>/knowledge/learnings.md` |
| `project` | `.workflow/state/decisions.md` |
| `team` | Team proposal queue (requires subscription) |

---

## Compact Memory

Full memory compaction and optimization.

```bash
# Run full compaction
flow compact-memory

# Or via entropy command
flow entropy --auto
```

### What Compaction Does

1. Removes stale/low-relevance facts
2. Deduplicates similar patterns
3. Rebuilds embeddings index
4. Vacuums SQLite database

---

## Related

- [Memory Systems](./memory-systems.md) - Architecture overview
- [Context Management](./context-management.md) - Token budgets
- [PRD Management](./prd-management.md) - Document storage
