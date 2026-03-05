# [wf-3daad465] Add subagent metrics aggregation via memory-db observations

> **Updated 2026-02-06**: Rewritten to leverage existing observation capture infrastructure (wf-fd8d2444) instead of building a parallel metrics system.

## User Story
**As a** WogiFlow user
**I want** subagent execution metrics (token count, tool uses, duration) aggregated and queryable
**So that** I can understand the cost and performance characteristics of automated task execution

## Description
The observation capture system (commit 9a56726) already records every Task tool invocation in the memory-db with `tool_name`, `input_summary`, `output_summary`, `duration_ms`, and `context_task_id`. However, there's no way to aggregate or view Task-specific metrics like total tokens, cost estimates, or per-subagent-type breakdowns.

This story adds an aggregation layer on top of the existing observation data rather than duplicating storage in `command-metrics.json`.

## What Already Exists
- `observation-capture.js` records Task tool uses with `subagent_type` in input_summary
- `flow-memory-db.js` stores observations with `duration_ms` and supports queries
- `flow-memory-db.js` already calculates `avgDurationMs` across all observations
- Task tool input includes `subagent_type` (developer, reviewer, tester, etc.)

## What's Missing
- No way to query observations filtered to Task tool only
- No aggregation by `subagent_type` (how much does each agent type cost?)
- No token count extraction from Task tool results (Claude Code returns usage data)
- No cost estimation
- No CLI command to view subagent metrics

## Acceptance Criteria

### Scenario 1: Query subagent metrics from memory-db
**Given** Task tool observations exist in memory-db
**When** calling `getSubagentMetrics()` in flow-metrics.js
**Then** observations are queried with `WHERE tool_name = 'Task'`
**And** results are grouped by subagent_type (parsed from input_summary)
**And** each group includes: run count, total duration, average duration

### Scenario 2: Token count extraction from Task results
**Given** a Task tool observation has output_summary containing token/usage info
**When** the observation is processed for metrics
**Then** token counts are extracted from the output (if present in Claude Code response)
**And** stored or computed on-demand for aggregation

### Scenario 3: Cost estimation
**Given** subagent metrics include token counts
**When** viewing metrics via CLI
**Then** estimated cost is calculated using configurable pricing in config.json
**And** displayed alongside token totals per subagent type

### Scenario 4: CLI command
**Given** the user runs `flow metrics subagents`
**When** subagent observations exist
**Then** a summary table is displayed:
```
Subagent Metrics (last 30 days)
─────────────────────────────────────────
Type         Runs  Avg Duration  Tokens  Est. Cost
developer      12     45.2s       89.4k   $0.54
reviewer        4     22.1s       31.2k   $0.19
explore         8     12.5s       18.7k   $0.11
─────────────────────────────────────────
Total          24     31.3s      139.3k   $0.84
```

### Scenario 5: Metrics disabled in config
**Given** `config.metrics.trackSubagents` is set to `false`
**When** running `flow metrics subagents`
**Then** a message is shown: "Subagent metrics tracking is disabled"
**And** existing observation capture continues working normally (no side effects)

## Technical Notes

### Architecture Decision: Query memory-db, don't duplicate
The original spec proposed storing metrics in a separate `subagents` section of `command-metrics.json`. This is now unnecessary because:
1. Observation capture already stores all Task tool data in memory-db
2. Duplicating data creates consistency risks
3. SQLite queries provide flexible aggregation for free

### Files to modify
| File | Change |
|------|--------|
| `scripts/flow-metrics.js` | Add `getSubagentMetrics()` that queries memory-db |
| `scripts/flow-memory-db.js` | Add `getTaskObservations()` query filtered to Task tool |
| `.workflow/config.json` | Add `metrics.trackSubagents: true` and `metrics.tokenPricing` |
| `scripts/flow.js` | Wire `flow metrics subagents` CLI command |

### Token pricing config
```json
{
  "metrics": {
    "trackSubagents": true,
    "tokenPricing": {
      "inputPer1k": 0.003,
      "outputPer1k": 0.015
    }
  }
}
```

### Parsing subagent_type from observations
Observation `input_summary` is formatted as: `Task [developer]: description...`
Extract subagent_type with: `/^Task \[(\w+)\]/`

## Test Strategy
- [ ] Unit: `getSubagentMetrics()` returns correct aggregations from test observations
- [ ] Unit: subagent_type parsing from input_summary works for all agent types
- [ ] Integration: `flow metrics subagents` displays formatted output

## Dependencies
- Requires observation capture (wf-fd8d2444) - already completed
- Requires memory-db (already in place)

## Complexity
Low - Aggregation layer on existing data, no new storage

## Out of Scope
- Real-time cost alerts (future)
- Per-model cost breakdown (would need model info in Task result)
- Historical trend charts
- Modifying observation capture to store additional fields
