---
description: "Show per-gate telemetry: invocations, pass rate, catch rate, miss rate. The IGR self-assessment dashboard."
effort: low
---

Display per-gate statistics from the IGR Gate Telemetry log (`.workflow/state/gate-telemetry.jsonl`). This is the **self-assessment dashboard** the owner asked for during epic planning ("write down every time a gate catches something so we can see what's working and what's not working").

Story: `wf-faf340cf` (IGR Story 0 — Gate Telemetry & Self-Assessment Framework)

## Usage

```bash
# All gates, all time
/wogi-gate-stats

# Filter by time window (e.g., last 7 days)
/wogi-gate-stats --since=7d
/wogi-gate-stats --since=24h
/wogi-gate-stats --since=30d

# Filter to one gate
/wogi-gate-stats --gate=logic-adversary
/wogi-gate-stats --gate=completion-truth-gate
/wogi-gate-stats --gate=standards-gate

# Combined
/wogi-gate-stats --since=7d --gate=intent-framing
```

## What the metrics mean

| Metric | Definition | What it tells you |
|--------|-----------|-------------------|
| `invocations` | How many times the gate ran | Activity level |
| `pass%` | `PASS / invocations` | How permissive the gate is |
| `catch%` | `(CONCERN + FAIL) / invocations` | How often the gate found issues — the "is this gate doing anything" signal |
| `miss%` | `userCorrectedAfterPass / PASS` | **Critical signal** — how often the gate passed work the user later corrected. High miss% = rubber-stamping. |
| `avgMs` | Average duration | Performance |
| `misses` | Raw count of cross-referenced misses | The number of times you had to correct something this gate said was fine |

## The miss-rate signal — the one that matters most

A gate with `pass% = 100%` and `miss% > 10%` is **rubber-stamping**. It's letting things through that you then have to correct. This is the failure mode the owner's QA-98%-parable warned against: 100% coverage that creates false confidence is more dangerous than 70% coverage that triggers a second review.

When you see high miss rates:
1. Tune the rubric (for `logic-adversary`: edit `.workflow/rubrics/logic-constitution-v2.md`)
2. Add calibration examples (for `logic-adversary`: append to `.workflow/state/adversary-calibration.json`)
3. Strengthen the gate's blocking behavior (for `completion-truth-gate`: raise `minTierForDone` or set `blockFalseCompletion: true`)

## Example output

```
gateId                 invocations  pass%   catch%  miss%   avgMs  misses
---------------------  -----------  ------  ------  ------  -----  ------
logic-adversary        12           75.0%   25.0%   8.3%    72341  1
intent-framing         12           83.3%   16.7%   0.0%    234    0
architect-pass         12           91.7%   8.3%    0.0%    5234   0
completion-truth-gate  10           80.0%   20.0%   0.0%    14     0
session-corrections    3            100.0%  0.0%    0.0%    87     0
standards-gate         12           100.0%  0.0%    0.0%    52     0
intent-bootstrap       1            100.0%  0.0%    0.0%    12     0

Total events: 62
```

## Related commands

- `node scripts/flow-gate-telemetry.js rotate` — force log rotation (default rotates at 10 MB)
- `node scripts/flow-gate-telemetry.js schema` — print the event schema
- `/wogi-challenge` — manually invoke the Logic Adversary (one of the gates this dashboard tracks)

## Under the hood

- Script: `scripts/flow-gate-telemetry.js`
- Log: `.workflow/state/gate-telemetry.jsonl` (append-only, JSONL)
- Archive: `.workflow/state/gate-telemetry-archive/`

## Arguments

Arguments: `{{ args }}`
