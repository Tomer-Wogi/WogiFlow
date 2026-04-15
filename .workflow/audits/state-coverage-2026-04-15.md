# State-File Coverage Audit — 2026-04-15

**Task**: wf-0059082d (Wave A of epic-episodic-memory)
**Scope**: Inventory every durable state file; identify gaps where session conclusions don't reliably land in a state file; propose schema extensions.
**Method**: Filesystem inventory, sample analysis of recent sessions (R-238 through R-276), cross-reference of conclusion types vs capture surfaces.

---

## Summary

**State files are structurally sound but leak at three layers:**

1. **Intent-artifact layer** (product, domain-model, glossary, user-journeys) — scaffolded but stuck in draft state with `[CONFIRM]` markers. Sessions that make product-level decisions don't update these. Capture gap: very high.
2. **Decision layer** (decisions.md, feedback-patterns.md) — writes happen manually via `/wogi-decide`, `/wogi-learn`, `/wogi-correct`. No automatic detection of conclusions made inline during tasks. Capture gap: high — relies on user/agent discipline.
3. **Reasoning layer** — no state file captures *why* alternatives were rejected, *what* adversary passes caught, or *which* approaches were considered before settling. Capture gap: complete (no home for this content at all).

**Auto-populated files are healthy**: app-map, function-map, api-map, request-log (265 entries), component/function/api indexes. Registry gate keeps these current.

**Session/task state** (ready.json, task-checkpoint.json, durable-session.json, workflow-phase.json, session-state.json) is operational — captures *where we are*, not *what we concluded*.

---

## File Inventory

### Auto-captured (healthy)
| File | Purpose | Writer | Health |
|---|---|---|---|
| `request-log.md` | Every file-changing request with tags | Append via hook | ✓ 265 entries |
| `app-map.md` | Component registry | `flow registry-manager scan` | ✓ Auto |
| `function-map.md` | Function registry | `flow registry-manager scan` | ✓ Auto |
| `api-map.md` | API endpoint registry | `flow registry-manager scan` | ✓ Auto |
| `component-index.json` | Component metadata | Registry manager | ✓ Auto |
| `function-index.json` | Function metadata | Registry manager | ✓ Auto |
| `export-map.json` | Export tracking | Registry manager | ✓ Auto |
| `section-index.json` | PIN index | `flow-section-index.js` | ✓ Auto |
| `gate-telemetry.jsonl` | Gate self-assessment | Gate telemetry | ✓ Auto |
| `command-metrics.json` | Command usage | Command wrapper | ✓ Auto |

### Manually-captured (gap-prone)
| File | Purpose | Writer | Health |
|---|---|---|---|
| `decisions.md` | Architectural/team rules | `/wogi-decide` or manual | ⚠ Manual trigger required |
| `feedback-patterns.md` | Bug patterns from corrections | `/wogi-correct` + promotion after 3+ occurrences | ⚠ 1 correction recorded (CORR-001) vs 265 logged changes — underused |
| `decision-amendments.json` | Decision changes over time | `/wogi-decide` | ⚠ Manual trigger |

### Intent artifacts (DRAFT — not capturing)
| File | State | Problem |
|---|---|---|
| `product.md` | `reviewStatus: draft`, `[CONFIRM]` markers unfilled | Generated 2026-04-13, still draft |
| `domain-model.md` | Empty placeholder, no entities | Gap — no auto-detection of entities |
| `glossary.md` | Empty placeholder, no terms | Gap — trap-zone detector ran but found nothing |
| `user-journeys.md` | Empty placeholder, no journeys | Gap — no detection |

### Session state (operational, not durable-content)
| File | Purpose |
|---|---|
| `ready.json` | Task queue (inProgress, ready, backlog, blocked, recentlyCompleted) |
| `task-checkpoint.json` | Current task's phase, files changed, scenarios |
| `durable-session.json` | Session metrics, bypass counters |
| `workflow-phase.json` | Current phase state |
| `session-state.json` | Session counters (tasks started, etc.) |
| `progress.md` | Per-task progress log |
| `todowrite-state.json` | Active todo list |

### Archive / telemetry (partial)
| File | Purpose | Health |
|---|---|---|
| `.workflow/state/adversary-runs/` | Adversary critique archive | 5 entries — populated for IGR tasks |
| `.workflow/state/framing/` | Intent framing artifacts | Empty — not populated despite IGR being enabled |
| `.workflow/corrections/` | Formal correction records | 1 entry (CORR-001) |
| `.workflow/state/clarifications.md` | Clarifying question log | (not inspected) |
| `adaptive-learning.json` | Adaptive learning state | (operational) |
| `adversary-calibration.json` | Adversary confidence | (operational) |

---

## Gap Analysis

### G1 — Rejected alternatives have no home (SEVERE)
**Signal**: Current user concern — "so you won't recommend something that we already said is not good."
**Observation**: decisions.md stores *chosen* rules, never *rejected* alternatives with rationale. feedback-patterns.md stores *bugs*, not *design rejections*.
**Impact**: Future agents re-propose the same approaches the user already declined. Re-work, trust erosion.
**Proposed home**: New section in `decisions.md` — `## Rejected Alternatives` with `### Alternative: <X>\n**Rejected**: <date>\n**Reason**: ...\n**Chose instead**: ...`. Or separate file `.workflow/state/rejected-alternatives.md` with PIN index.

### G2 — Intent artifacts stuck in draft (HIGH)
**Signal**: `product.md`, `domain-model.md`, `glossary.md`, `user-journeys.md` all `reviewStatus: draft` with `[CONFIRM]` markers. Last auto-update 2026-04-13; still unfilled 2 days later.
**Observation**: IGR bootstrap scaffolds these but no session captures product decisions back into them.
**Impact**: IGR adversary runs principles 3/6 at reduced confidence per the file banner. Product reasoning absent at every future task.
**Proposed enforcement**: Capture gate scans task outputs for product-statement-shaped content; prompts user to update product.md. Or staleness nudge at session-end for draft intent artifacts.

### G3 — Session-level design discussions leave no reasoning trace (SEVERE)
**Signal**: This very session produced a 3-layer architectural analysis, 5 rejected approaches, 13-story epic. The stories live in `.workflow/changes/`. The *reasoning* — why externalization vs compaction, why 13 vs 11 stories, why ops-class was rejected in favor of memory eviction — lives only in transcript.
**Observation**: No file captures design discussion outcomes at the story/epic level. Architecture Decision Records (ADR) pattern not present.
**Impact**: Next session asks the same questions we just answered.
**Proposed home**: `.workflow/state/adr/ADR-{NNN}-{slug}.md` with context, decision, consequences, alternatives-considered. Or extend epic/story spec template with "Design rationale" and "Alternatives considered" sections.

### G4 — No conclusion-classification heuristic (BLOCKING for capture gate)
**Signal**: No script exists that takes a message fragment and classifies it as "rule / pattern / PRD / snippet / architectural-decision."
**Observation**: `/wogi-decide` and `/wogi-learn` require manual invocation. No AI-driven detection.
**Impact**: Capture gate (wf-a3cc5f2a) cannot verify a conclusion landed in the right file if it can't classify what the conclusion *is*.
**Proposed**: Build `flow-conclusion-classifier.js` as a prerequisite for wf-a3cc5f2a. Input: text + task context. Output: `{kind, targetFile, confidence, suggestedWrite}`.

### G5 — Task-completion summaries are thin (MEDIUM)
**Signal**: ready.json `recentlyCompleted` entries store `{id, title, type, level, priority}` — no decisions, no learnings, no rejected-paths from the task.
**Observation**: Task-complete hook doesn't emit a structured summary of *what was decided* during the task.
**Impact**: Cross-task continuity relies on transcript or request-log, both of which are file-change-centric, not decision-centric.
**Proposed**: Extend `recentlyCompleted` entry schema: `{..., decisions: [], learnings: [], rejectedPaths: [], openQuestions: []}`. Populate at task close.

### G6 — feedback-patterns.md dramatically underused (HIGH)
**Signal**: 265 request-log entries, 1 correction record. Promotion-to-rules threshold is 3+ occurrences — we have none.
**Observation**: `/wogi-correct` is almost never invoked. Patterns are either not detected or not recorded.
**Impact**: The self-improvement loop (feedback → patterns → rules) is effectively inactive despite being advertised as a core loop.
**Proposed**: Detect corrections automatically — when user says "no, actually..." / "we don't do it that way" / corrects an AI output, auto-create a CORR-NNN record pending user confirmation.

### G7 — Framing artifacts directory is empty (MEDIUM)
**Signal**: `.workflow/state/framing/` is empty despite IGR being enabled and L1+ tasks supposedly running the framing pass.
**Observation**: Either the framing pass isn't running, or it is but isn't persisting. Need to diagnose.
**Impact**: Architect pass (Step 1.55) and Adversary pass (Step 1.57) claim to consume framing artifacts — if they're absent, those gates operate on degraded input.
**Proposed**: Separate investigation; may be a bug in `flow-intent-framing.js` save path. Track separately.

### G8 — Adversary critique outputs exist but aren't promoted (MEDIUM)
**Signal**: 5 adversary-run JSON files exist. Good — they're archived. But nothing surfaces their findings back into decisions.md or feedback-patterns.md.
**Observation**: Adversary catches a logic flaw → spec is revised → adversary run archived. The *learning* (e.g., "always guard dotted key traversal against `__proto__`") is surfaced once and forgotten unless the user manually runs `/wogi-learn`.
**Impact**: Repeated vulnerability patterns across projects.
**Proposed**: Adversary-run post-processing: extract findings, classify, auto-propose for feedback-patterns.md or decisions.md promotion.

### G9 — flow-story doesn't propagate to ready.json (OPERATIONAL BUG, discovered during audit)
**Signal**: 13 stories created via `flow-story.js` for this epic. `epics.json` correctly lists them. ready.json `backlog/ready/inProgress` does NOT. `task-queue.json` structure exists but was not populated for these stories.
**Observation**: `flow-story.js` writes spec files to `.workflow/changes/` and registers with epic but skips ready.json insert. `/wogi-start wf-0059082d` attempted to find it in ready.json and failed.
**Impact**: Auto-bulk orchestration cannot pick up these stories. `/wogi-start <id>` must fall back on spec-file lookup.
**Proposed**: Separate bug report. Either fix flow-story to write to ready.json, or fix /wogi-start to accept epic-registered stories missing from ready. Not blocking this epic.

### G10 — Staleness not tracked for draft content (LOW)
**Signal**: Intent artifacts have `lastAutoUpdated: 2026-04-13T10:21:55.819Z` and are still draft 2 days later. No reminder or warning.
**Observation**: No staleness-detection pass anywhere in the system.
**Impact**: Draft state becomes permanent. IGR operates at reduced confidence indefinitely.
**Proposed**: Extend `/wogi-health` to flag draft intent artifacts older than N days. Session-end nudge.

---

## Proposed Schema Extensions

### decisions.md — new sections
- `## Rejected Alternatives` (addresses G1) — rejected approach, reason, chosen instead
- `## Architectural Decision Records` (addresses G3) — compressed ADR entries with alternatives-considered

### feedback-patterns.md — new auto-input
- Auto-detected corrections create draft CORR-NNN pending user confirmation (addresses G6)

### recentlyCompleted schema in ready.json (addresses G5)
```json
{
  "id": "wf-XXXXXXXX",
  "title": "...",
  "type": "...",
  "level": "...",
  "priority": "...",
  "completedAt": "ISO",
  "decisions": [{ "text": "...", "targetFile": "decisions.md", "written": true }],
  "learnings": [{ "text": "...", "targetFile": "feedback-patterns.md", "written": true }],
  "rejectedPaths": [{ "approach": "...", "reason": "..." }],
  "openQuestions": ["..."]
}
```

### New: `.workflow/state/adr/` directory (addresses G3)
- `ADR-{NNN}-{slug}.md` with Context / Decision / Consequences / Alternatives-Considered / References sections
- Auto-linked from epics/stories via `adrRefs: []` field

### New: `.workflow/state/audits/` (this file's location)
- Persistent location for structured project audits

---

## Capture Surfaces That Must Be Instrumented

For the capture gate (wf-a3cc5f2a) to work, these entry points need detection + state-file-write verification:

1. **TaskCompleted hook** — scan task transcript segments for conclusion-shaped content
2. **Session-end** — scan entire session for unclaimed conclusions
3. **/wogi-decide, /wogi-learn, /wogi-correct** — already capture surfaces; extend with auto-classification
4. **Adversary run post-processing** — extract findings, propose promotion
5. **Architect plan post-processing** — extract alternatives-considered, write to ADR
6. **Post-compaction hook** — scan compacted transcript for conclusions about to be lost

---

## Priority Ranking for Capture Gate (wf-a3cc5f2a)

**Must enforce (block task close):**
- G4 conclusion classifier must exist (prerequisite — technical dependency)
- G5 recentlyCompleted schema extension (structural requirement)
- G1 rejected-alternatives capture (directly addresses user's stated concern)
- G3 ADR capture (durable design rationale)

**Should enforce (warn, don't block):**
- G2 intent artifact updates when product-level decisions made
- G6 auto-correction detection with user confirmation

**Nice-to-have (post-epic):**
- G7 framing-directory diagnostic (separate bug)
- G8 adversary-run promotion pipeline (extends wf-6a352aae promotion)
- G10 staleness detection (separate story for /wogi-health)

**Operational bug (file separately):**
- G9 flow-story → ready.json propagation

---

## Delivery

**This report is the deliverable for wf-0059082d.** No code changes required — all findings feed downstream stories in the epic:

- G1, G3, G5 → shape the capture-gate design (wf-a3cc5f2a)
- G4 → prerequisite classifier, inline to wf-a3cc5f2a scope
- G2, G10 → inform wf-6a352aae (cleanup + promotion) and wf-1976a301 (tampering detection)
- G6 → feeds wf-a3cc5f2a's auto-correction detection
- G7, G8, G9 → separate tracking; G9 should be filed as a bug now

**Next in Wave A**: wf-546e96bc (Config schema + migration). Foundation work that can proceed independently — config defines the knobs the rest of the epic uses.
