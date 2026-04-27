# Intent-Grounded Reasoning (IGR) — Operator Reference

> **Epic**: `wf-b00262b1` — 8 stories, all coreComplete 2026-04-13
> **Research**: `.workflow/scratch/wf-4d4ae31c-research-report.md`
> **Spec**: `.workflow/scratch/wf-4d4ae31c-feature-spec.md`

## What IGR does

IGR closes the gap between single-pass and N-pass agent quality by baking "challenge yourself" into the pipeline. It grounds reasoning in project intent (product.md, domain-model.md, user-journeys.md, glossary.md), forces a plan/critique split before code is written, records per-gate telemetry, and gates completion claims behind observable evidence.

Research finding: across 1,309 user messages mined, first-pass agent output was systematically shallower than second-pass output. The #1 failure mode — false completion — accounted for 31 of 68 failure incidents (nearly half).

## The 8 stages

| Stage | What it does | Module |
|-------|--------------|--------|
| 0 | **Gate Telemetry** — every gate records to `.workflow/state/gate-telemetry.jsonl` with PASS/CONCERN/FAIL + metadata | `scripts/flow-gate-telemetry.js` |
| 1 | **Intent Bootstrap** — scaffolds product/domain/glossary/user-journeys artifacts; agnostic trap-zone detector finds structural ambiguities | `scripts/flow-intent-bootstrap.js` + `scripts/flow-trap-zone.js` |
| 2 | **Intent Framing Pass** — per-task reasoning step; produces a Framing Artifact resolving ambiguities before any other work | `scripts/flow-intent-framing.js` |
| 3 | **Architect Pass** — read-only sub-agent produces an 8-section pre-spec plan | `scripts/flow-architect-pass.js` + persona `.workflow/agents/architect.md` |
| 4 | **Logic Adversary** — separate sub-agent on a different model critiques the plan against the 11-principle Logic Constitution (v2: P11 + sub-principles 11.1–11.5 covering observed-behavior, project rules, sibling features, stacked-story integration, and temporal source coverage) | `scripts/flow-logic-adversary.js` + rubric `.workflow/rubrics/logic-constitution-v2.md` |
| 5 | **Session Correction Memory** — detects user corrections during a session and cross-references back to gates that passed the contradicted work | extensions in `scripts/flow-correction-detector.js` |
| 6 | **Completion Truth Gate** — audits "done" claims against Tier 0–4 evidence; downgrades language when evidence is insufficient | `scripts/flow-completion-truth-gate.js` |
| 7 | **Pipeline wiring + rollout** — integrates all above into `/wogi-start`, the gate registry, the eval framework | (this story) |

## How it fires

IGR is gated by two layers of flags:

1. **Master switch**: `config.intentGroundedReasoning.enabled` (default `false`).
2. **Per-stage switches**: e.g., `config.intentGroundedReasoning.logicAdversary.enabled`.

With the master off, IGR adds zero overhead. With it on, each stage can be disabled independently.

Pipeline steps added by IGR (all guarded by `intentGroundedReasoning.enabled`):

| Step | When | Sub-agent? | Artifact produced |
|------|------|------------|-------------------|
| 0.3 | First `/wogi-start` without intent artifacts | No (orchestrator) | `.workflow/state/{product,domain-model,user-journeys,glossary}.md` drafts |
| 1.15 | Every L1+ task | No (orchestrator self-reflects) | `.workflow/state/framing/{taskId}.md` |
| 1.55 | Every L1+ task | **Yes** — read-only sub-agent | `.workflow/plans/{taskId}.md` |
| 1.57 | Every L1+ task (after 1.55) | **Yes** — separate sub-agent, different model | verdict in `.workflow/state/adversary-runs/{taskId}-rN.json` |
| 3.9 (via gate registry) | Every task with `completionTruth` in `qualityGates` | No | telemetry + optional language-downgrade |

## Configuration reference

Minimal enable:
```json
{
  "intentGroundedReasoning": {
    "enabled": true
  },
  "gateTelemetry": {
    "enabled": true
  }
}
```

Per-stage override example:
```json
{
  "intentGroundedReasoning": {
    "enabled": true,
    "logicAdversary": { "enabled": true, "maxRounds": 3, "ultrathinkAutoBump": true },
    "completionTruthGate": { "enabled": true, "minTierForDone": 3, "blockFalseCompletion": true },
    "intentBootstrap": { "autoRunOnFirstTask": true, "confirmArtifacts": "prompt" }
  }
}
```

See `.workflow/config.schema.json` for the full schema.

## Telemetry

Every IGR gate records to `.workflow/state/gate-telemetry.jsonl`. View stats:

```bash
# All gates
node scripts/flow-gate-telemetry.js stats

# One gate
node scripts/flow-gate-telemetry.js stats --gate=logic-adversary

# Time window
node scripts/flow-gate-telemetry.js stats --since=7d
```

Key metric: **missRate**. A gate with 100% `passRate` and non-zero `missRate` is rubber-stamping — it's passing plans the user then has to correct. This is the self-assessment signal the epic was built to produce.

## Sub-agents and model separation

Two stages spawn sub-agents:

- **Architect (Stage 3)** — read-only, restricted to `Read`, `Grep`, `Glob`. Denied: `Edit`, `Write`, `Bash`, task creation. Persona at `.workflow/agents/architect.md`.
- **Logic Adversary (Stage 4)** — read-only critic. Persona at `.workflow/agents/logic-adversary.md`.

The Adversary uses a DIFFERENT model than the Architect when both are available (Sonnet when Architect is Opus, vice versa). This is enforced by `config.intentGroundedReasoning.logicAdversary.modelSeparation` (default `different-from-architect`). Model separation is Anthropic harness-design guidance: the same model that wrote the plan will not find its own blind spots.

## When IGR operates in degraded mode

Each stage has a graceful-degradation path:

- **Bootstrap not run** → intent artifacts missing → Adversary principles 3/4/6/9 SKIP → IGR runs at ~60% coverage
- **Session corrections empty** → Framing's prior-corrections section is empty; Adversary principle 5 still fires (against decisions.md)
- **Request log empty** → Framing notes absence; no error
- **Durable session missing** → Truth Gate SKIPs with "no session" note
- **Any sub-agent fails to spawn** → telemetry records ERROR; pipeline continues without that stage's output

Degraded mode is honest: telemetry records what was available. This lets you see which artifacts are load-bearing for your projects.

## Slash commands

- `/wogi-challenge` — manual Adversary invocation (see `.claude/commands/wogi-challenge.md`)
- `/wogi-start` — normal pipeline; IGR steps fire when enabled

## Non-IGR workflows

With IGR disabled, WogiFlow operates exactly as before. The feature flag is load-bearing — turning it off is the rollback button. None of the new modules import into existing modules; they are additive libraries consumed by registration points (`GATE_REGISTRY`, `explore-agents.md`) and by the `/wogi-start` pipeline when the flag is on.

## Project state after enabling

First `/wogi-start` with IGR on:
1. **Step 0.3 Option C prompt**: "Bootstrap now / Review at session-end / Skip for now"
2. Default option `[2]` scaffolds artifacts in the background
3. `/wogi-session-end` consolidates review of drafts + any session corrections detected
4. Once artifacts are confirmed (`reviewStatus: "confirmed"` in each file header), Adversary runs at full strength — all 10 principles fire

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Adversary always runs in degraded mode | `.workflow/state/{product,domain-model,glossary,user-journeys}.md` exist? If not, run `node scripts/flow-intent-bootstrap.js` |
| `completionTruth` gate doesn't fire | Is `completionTruth` listed in `config.qualityGates.<type>.require` for the task type? |
| Telemetry log is huge | Auto-rotates at 10 MB (`gateTelemetry.rotateSizeBytes`). Run `node scripts/flow-gate-telemetry.js rotate` to force rotation. |
| Architect produces file paths | The persona prohibits this; report as a calibration example in `.workflow/state/adversary-calibration.json` |
| Session corrections aren't detected | Check `hooks.rules.intelligence.correctionDetection.enabled` is `true` and Claude Code hook registration is current |

## Rollback

Set `intentGroundedReasoning.enabled: false` in `config.json`. No code removal needed. Pipeline reverts to pre-IGR behavior on next task.
