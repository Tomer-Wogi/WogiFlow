# Future Features

Planned and considered features for WogiFlow.

---

## Status Legend

| Status | Meaning |
|--------|---------|
| **Planned** | Will be implemented |
| **Backlog** | On request or when needed |
| **Considering** | Under evaluation |
| **Skipped** | Not planning to implement |

---

## Planned Features

### Team Observability Dashboard

**Status**: Planned (with team tier launch)

Web UI for team-wide visibility:
- All runs with status
- Per-step spans with inputs/outputs
- Retry history and failure context
- Team-wide task dashboard
- Role-based access (admin, lead, member)

**Trigger**: Team tier launch with hosted database

---

### Enhanced Model Stats

**Status**: Planned

Track detailed success metrics per model:

```json
{
  "ollama-qwen": {
    "successRate": 0.87,
    "avgLatencyMs": 4500,
    "failuresByCategory": {
      "import_error": 12,
      "type_error": 5
    },
    "byTaskType": {
      "create-component": { "success": 45, "fail": 3 },
      "fix-bug": { "success": 22, "fail": 8 }
    }
  }
}
```

**Trigger**: Users asking "which model is best for X?"

---

## Backlog Features

### Quality Gate Confidence

**Status**: Backlog

Don't apply low-confidence changes automatically:

```javascript
const confidenceMarkers = {
  high: ["I'm confident", "This will work", "Straightforward"],
  low: ["I think", "might work", "not entirely sure"]
};
```

**Trigger**: When bad outputs are frequently applied

---

### Context Priority Scoring

**Status**: Backlog

Smarter context selection than "include everything":

```javascript
const CONTEXT_PRIORITIES = {
  required_types: 1.0,      // Always include
  target_file: 0.95,        // Almost always
  related_imports: 0.8,     // Usually helpful
  patterns: 0.7,            // Good to have
  examples: 0.5,            // Nice to have
  full_files: 0.3           // Only if space
};
```

**Trigger**: If context overflow becomes common

---

### Formalized Model Registry

**Status**: Backlog

Structured capability definitions per model:

```json
{
  "models": {
    "gpt-4o-mini": {
      "provider": "openai",
      "contextWindow": 128000,
      "costTier": "cheap",
      "capabilities": ["code-generation", "structured-output"],
      "structuredOutputReliability": "high"
    }
  }
}
```

**Trigger**: When supporting 5+ executor models

---

## Multi-Model Features

Only implement if users have 3+ models configured.

### Multi-Model Orchestration

**Status**: Considering

Route different tasks to optimal models:

```json
{
  "modelRouting": {
    "orchestration": "claude-opus",
    "exploration": "claude-haiku",
    "frontend": "gemini-pro",
    "debugging": "gpt-5",
    "documentation": "claude-sonnet"
  }
}
```

**Trigger**: Users want to optimize cost/quality tradeoffs
**Risk**: Complexity, API key management, cost tracking

---

### Task Router

**Status**: Backlog

Automatically route task types to best models.

**Trigger**: Users with 3+ models asking for routing
**Risk**: Over-engineering for single-model users

---

### Parallel Dispatch

**Status**: Backlog

Execute independent subtasks on multiple models simultaneously.

**Trigger**: Users request parallel execution for speed
**Risk**: Complexity for unclear gain

---

## Skipped Features

We're skeptical these add value without strong evidence.

### Structured JSON Contract

**Why Skipped**: Local LLMs can't reliably produce JSON
**Would Reconsider If**: New models achieve 95%+ JSON reliability
**Current Solution**: `flow-response-parser.js` handles messy output

---

### SQLite Telemetry

**Why Skipped**: JSON files work fine for 50 runs/day
**Would Reconsider If**: Users need complex queries across runs
**Concerns**: Native dependency, not human-readable, overkill

---

### Prompt Fragment System

**Why Skipped**: Current Handlebars templates work fine
**Would Reconsider If**: Templates become unmanageable (20+)

---

## Shipped

Features that were on the backlog and have been completed:

| Feature | Implementation |
|---------|---------------|
| Extensible Registry Architecture | Plugin-based registries with auto-activation per stack |
| AI-Judge Semantic Matching | flow-semantic-match.js — wired into all reuse consumers |
| Framework-Driven File Discovery | flow-framework-resolver.js — stack-aware dynamic patterns |
| Consumer Impact Analysis | Explore Phase Agent 6 — maps all consumers before refactoring |
| Multi-Agent Explore Phase | 5-6 parallel research agents before implementation |
| Origin Task Tracing | Same-session annotation, origin references, learning signals |
| Enhanced Review Fix Workflow | Severity routing, persistent tasks, batch mode |
| Decision Amendment Tracking | flow-decision-tracker.js — auditable rule change trail |
| Cross-Artifact Consistency | flow-consistency-check.js — detects orphans and phantoms |
| Worktree Isolation | flow-worktree.js — parallel tasks in isolated git worktrees |
| Parallel Execution | flow-parallel.js — concurrent independent tasks |
| Durable Sessions | flow-durable-session.js — suspend/resume across sessions |
| Damage Control System | flow-damage-control.js — pattern-based safety |
| Memory Systems | MCP memory server with SQLite persistence |
| Guided Edit Mode | `/wogi-guided-edit` for step-by-step multi-file changes |
| Tiered Learning | flow-tiered-learning.js — smart auto-apply logic |
| Model Registry & Stats | flow-models.js — `flow models list/info/route/stats` |
| Complexity Assessment | flow-complexity.js — `flow complexity "<task>"` |
| Metrics & Analysis | flow-metrics.js — `flow metrics --problems` |
| PRD Management | flow-prd-manager.js — `flow prd load/context/list/clear` |

---

## How This Backlog Works

1. **Review Quarterly**: Are users asking for any of these?
2. **Promote on Demand**: Move items up when users request them
3. **Delete if Stale**: Remove items no one asks about in 6 months
4. **Track Triggers**: Note what would make each feature valuable

---

## Requesting Features

To request a feature from this backlog:
1. Open an issue with use case
2. Describe the pain point
3. If compelling, feature gets promoted

---

## Related

- [Task Execution](./02-task-execution/) - Core execution features
- [Self-Improvement](./03-self-improvement/) - Learning system
- [Hybrid Mode](./02-task-execution/02-execution-loop.md#hybrid-mode) - Multi-model basics
