---
description: "Manual trigger of the IGR Logic Adversary — critique a plan against the Logic Constitution v1 rubric."
effort: medium
---

Manually invoke the **Logic Adversary** (IGR Stage 4) against a plan or spec of your choosing. Normally the Adversary runs automatically during `/wogi-start` Step 1.57. Use `/wogi-challenge` when you want to stress-test a plan outside the pipeline — for example, a design doc you wrote by hand, a pre-approved task where you want an extra pass, or an ad-hoc proposal in conversation.

Story: `wf-b00262b1` (IGR)

## Usage

```bash
# Critique a plan file
/wogi-challenge path/to/plan.md

# Critique the plan for a specific task (reads .workflow/plans/{taskId}.md)
/wogi-challenge wf-XXXXXXXX

# Critique with an explicit rubric version
/wogi-challenge path/to/plan.md --rubric=logic-constitution-v1
```

## What it does

1. Loads the plan (either from a file path or from `.workflow/plans/{taskId}.md`).
2. Calls `scripts/flow-logic-adversary.js buildAdversaryPrompt` to assemble the critique prompt — includes the 10-principle Logic Constitution, few-shot calibration examples, and all available intent artifacts.
3. Spawns a sub-agent via the Agent tool on a different model than this session when possible (Sonnet when you're on Opus; Opus when you're on Sonnet) — the model-separation rule per the approved spec.
4. Parses the returned JSON verdict against the rubric schema.
5. Records a telemetry event (`gateId: logic-adversary`) with the verdict.
6. Renders the verdict in human-readable form with per-principle PASS/CONCERN/FAIL.
7. If the verdict is NEEDS_REVISION or FAIL, offers to iterate — the user can edit the plan and re-run.

## When to use it

- **Before approval** — re-check a plan the automatic Adversary already passed, with fresh eyes.
- **After major revisions** — when you edited a plan by hand and want re-validation.
- **On external docs** — critique a design doc written outside WogiFlow against the Logic Constitution.
- **As a gut-check** — for high-stakes decisions (architecture, migrations) where one pass isn't enough.

## Requirements

- `intentGroundedReasoning.enabled` and `intentGroundedReasoning.logicAdversary.enabled` must be true in `config.json`.
- The plan file must contain structured content parseable by the Adversary (plain markdown is fine).
- For task-ID form (`/wogi-challenge wf-XXX`), the plan must exist at `.workflow/plans/{taskId}.md`.

## Under the hood

- Script: `scripts/flow-logic-adversary.js`
- Rubric: `.workflow/rubrics/logic-constitution-v1.md`
- Persona: `.workflow/agents/logic-adversary.md`
- Calibration: `.workflow/state/adversary-calibration.json`
- Telemetry: `gateId: logic-adversary` in `.workflow/state/gate-telemetry.jsonl`

## Related

- `/wogi-start` — runs Adversary automatically at Step 1.57 during task execution
- `node scripts/flow-gate-telemetry.js stats --gate=logic-adversary` — see historical Adversary effectiveness
- `/wogi-review` — different tool, critiques code after implementation; Adversary critiques plans before

## Arguments

Arguments: `{{ args }}`
