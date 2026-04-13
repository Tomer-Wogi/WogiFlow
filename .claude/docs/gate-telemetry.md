# Gate Telemetry & Self-Assessment

> **Story**: `wf-faf340cf` (IGR Story 0) &mdash; Epic: `wf-b00262b1` (Intent-Grounded Reasoning)

## Why this exists

WogiFlow has many quality gates. Without telemetry, we have to *believe* they are catching things. With telemetry, we can *see* which gates catch real issues, which rubber-stamp, and where coverage gaps are — before a customer hits them.

This is the **self-assessment layer** the owner requested during IGR epic planning: "Write down every time a gate catches something so we can see what's working."

## What gets recorded

Every WogiFlow gate (existing + IGR) appends a structured event to `.workflow/state/gate-telemetry.jsonl` when it runs. Each event captures:

| Field | Purpose |
|-------|---------|
| `gateId` | Which gate (canonical ID — `standards-gate`, `logic-adversary`, etc.) |
| `verdict` | `PASS` / `CONCERN` / `FAIL` / `ERROR` / `SKIP` |
| `taskId` | Task being evaluated |
| `findingCount`, `findingSummary` | What the gate caught (short summaries only, no full content) |
| `iterations` | Iteration count for looped gates (Logic Adversary rounds) |
| `durationMs` | How long the gate took |
| `inputHash` | 16-char SHA-1 prefix — for dedup and traceability |
| `downstream.userCorrectedAfterPass` | Cross-referenced from session-corrections: did the user correct something this gate passed? |
| `metadata` | Gate-specific extras |

The schema is versioned (`v` field). Events never mutate EXCEPT via `correlateMiss()` — the one allowed path that flips `userCorrectedAfterPass` when the session-correction detector observes a later user correction on a task a gate previously PASSed.

## Privacy

No full prompts, diffs, or user messages are stored. Only:
- Short finding summaries (≤200 chars each)
- Hashes (16-char SHA-1 prefix) of inputs

Safe to commit to version control if desired; suited for team dashboards.

## What events are aggregated

Per-gate stats (via `flow gate-stats` or `getGateStats()`):

| Metric | Definition |
|--------|-----------|
| `invocations` | How many times the gate ran |
| `passRate` | `PASS / invocations` |
| `catchRate` | `(CONCERN + FAIL) / invocations` — the "is this gate doing anything" signal |
| `missRate` | `userCorrectedAfterPass / PASS` — the "is this gate rubber-stamping" signal |
| `avgFindings` | Average findings per invocation |
| `avgIterations` | Average iterations (relevant for looped gates) |
| `avgDurationMs` | Average duration per invocation |

**The `missRate` is the critical signal.** A gate with 100% pass rate and high miss rate is a false-confidence producer — the exact pattern the owner's QA parable warned against.

## CLI

```bash
# Per-gate summary table
node scripts/flow-gate-telemetry.js stats

# Filter by time window
node scripts/flow-gate-telemetry.js stats --since=7d
node scripts/flow-gate-telemetry.js stats --since=30d

# Filter by specific gate
node scripts/flow-gate-telemetry.js stats --gate=logic-adversary

# Print the event schema as JSON
node scripts/flow-gate-telemetry.js schema

# Rotate the active log if over the size threshold
node scripts/flow-gate-telemetry.js rotate
```

## Programmatic use

```javascript
const { recordGateEvent, getGateStats, correlateMiss } = require('./flow-gate-telemetry');

// In a gate implementation:
const start = Date.now();
const result = runMyGate(input);
recordGateEvent({
  gateId: 'my-gate',
  gateVersion: '1.0',
  taskId: taskContext.id,
  verdict: result.blocked ? 'FAIL' : result.findings.length > 0 ? 'CONCERN' : 'PASS',
  findingCount: result.findings.length,
  findingSummary: result.findings.slice(0, 10).map(f => f.message.slice(0, 120)),
  durationMs: Date.now() - start,
  metadata: { myExtras: '...' }
});
```

`recordGateEvent` NEVER throws — telemetry failure never breaks a gate. Failures emit a `warn()` and proceed.

## Cross-reference on correction

The session-correction detector (Story `wf-cc4eb238`, forthcoming) calls `correlateMiss(gateId, taskId, correction)` when it detects a user correction on a task. This rewrites prior PASS events for that gate + task, flagging them as misses. Over time, this produces the `missRate` metric that reveals rubber-stamping.

## Currently instrumented gates

- `standards-gate` — Step 3.7 (retroactively instrumented by this story)

Additional instrumentation lands as subsequent IGR stories ship:
- `skeptical-evaluator` — Step 3.56
- `scope-confidence` — Step 1.45
- `runtime-verification` — Step 3.58
- `integration-wiring` — Step 3.6
- `criteria-verification` — Step 3.5
- `logic-adversary` — IGR Stage 4 (Story `wf-3975a001`)
- `intent-framing` — IGR Stage 2 (Story `wf-5c024cc2`)
- `architect-pass` — IGR Stage 3 (Story `wf-4d3e8d3e`)
- `completion-truth-gate` — IGR Stage 6 (Story `wf-76312197`)

## Storage

- Active log: `.workflow/state/gate-telemetry.jsonl` (append-only)
- Archived logs: `.workflow/state/gate-telemetry-archive/gate-telemetry-YYYY-MM-DD-HHMMSS.jsonl`
- Rotation threshold: 10 MB (configurable via `config.gateTelemetry.rotateSizeBytes`)

## Configuration

```json
{
  "gateTelemetry": {
    "enabled": true,
    "rotateSizeBytes": 10485760,
    "crossReferenceOnCorrection": true
  }
}
```

Disable with `enabled: false` (not recommended — removes visibility into gate effectiveness).

## Design rationale

**Why JSONL, not JSON?** Append-only is vastly more efficient than read-modify-write for high-frequency writes. Each gate invocation becomes one line. Readers handle it with `split('\n')`.

**Why hash inputs instead of storing them?** Privacy + storage. A 16-char SHA-1 prefix is enough to dedup repeated inputs and correlate gate events across a task without keeping raw content.

**Why allow `correlateMiss` to mutate events?** Cross-referencing a downstream signal (user correction) back to an earlier gate verdict is the entire point of self-assessment. Without it, we never learn which gates are rubber-stamping.

**Why never throw from `recordGateEvent`?** Telemetry is observability — it must never be more important than the operation it observes. A failed telemetry write degrades self-assessment accuracy but does not block work.
