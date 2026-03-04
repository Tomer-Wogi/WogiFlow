# Eval System

Multi-judge scoring for evaluating task output quality.

---

## Purpose

The `/wogi-eval` command evaluates a completed task's implementation quality using multiple AI judges. It answers the question: "How good was this task execution?" by scoring across 5 dimensions.

Use it when:
- You want an objective quality assessment of completed work
- Comparing output quality across different tasks or models
- Tracking quality trends over time
- Identifying areas where your workflow needs improvement

---

## Configuration

Controlled by the `eval` key in `.workflow/config.json`:

```json
{
  "eval": {
    "judges": { "opus": 1, "sonnet": 2 },
    "scoringDimensions": [
      "completeness",
      "accuracy",
      "workflowCompliance",
      "tokenEfficiency",
      "quality"
    ],
    "passingThreshold": 6
  }
}
```

- **judges** -- Number of each model type to use (default: 1 Opus + 2 Sonnet)
- **scoringDimensions** -- The 5 dimensions each judge scores on
- **passingThreshold** -- Minimum score (1-10) to consider a task as passing

---

## How It Works

### Scoring Dimensions

Each judge scores independently on these 5 dimensions (1-10 scale):

| Dimension | What It Measures |
|-----------|-----------------|
| Completeness | Did the implementation address ALL acceptance criteria? |
| Accuracy | Is the code correct, handling edge cases properly? |
| Workflow Compliance | Did it follow WogiFlow patterns (spec, criteria check, wiring, standards)? |
| Token Efficiency | How many tokens and iterations were needed to reach a passing state? |
| Quality | Code quality, readability, and maintainability |

### Execution Flow

1. **Prepare eval data** -- `node scripts/flow-eval.js prepare wf-XXXXXXXX` loads the task's spec, implementation diff, iteration count, and token estimate.
2. **Spawn 3 judge agents** -- 1 Opus + 2 Sonnet agents run in parallel, each receiving the same prompt (built by `flow-eval-judge.js`).
3. **Score independently** -- Each judge scores all 5 dimensions without seeing other judges' scores.
4. **Aggregate** -- The median score per dimension is taken across all 3 judges. This reduces bias from any single model.
5. **Save results** -- Stored in `.workflow/evals/` as timestamped JSON files.

### Why Median Scoring

Using the median of 3 judges (rather than an average) provides:
- Resistance to outlier scores from a single judge
- More stable results across runs
- Higher confidence when judges agree

---

## Commands

```bash
/wogi-eval wf-XXXXXXXX              # Evaluate a specific completed task
/wogi-eval --batch --last 5          # Evaluate the last 5 completed tasks
/wogi-eval --compare                 # Show eval trend comparison
/wogi-eval --candidates              # Show tasks eligible for evaluation
```

---

## Output

### Single Task Evaluation

```
EVAL RESULTS: wf-XXXXXXXX

Judges: 3 (1 Opus + 2 Sonnet) | Confidence: high

  completeness          8/10
  accuracy              7/10
  workflowCompliance    9/10
  tokenEfficiency       6/10
  quality               8/10

Overall: 7.6/10 -- PASS (threshold: 6)

Individual Judges:
  Judge 1 (opus): Strong implementation, minor edge case gaps
  Judge 2 (sonnet): Good workflow compliance, token usage could improve
  Judge 3 (sonnet): Clean code, well-structured implementation

Saved: .workflow/evals/wf-XXXXXXXX-eval-2026-03-02T10-00-00.json
```

### Batch Evaluation

```
BATCH EVAL RESULTS

Task            Model         Overall  Comp  Acc   WF    Tok   Qual
wf-a1b2c3d4    opus-4-6      7.6      8     7     9     6     8
wf-e5f6a7b8    sonnet-4-6    6.8      7     7     8     5     7
wf-c9d0e1f2    opus-4-6      8.2      9     8     9     7     8

Average: 7.5/10
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/flow-eval.js` | Prepares eval data, saves results, formats output |
| `scripts/flow-eval-judge.js` | Builds judge prompts, parses responses, aggregates scores |

Key functions:
- `buildJudgePrompt()` -- Constructs the scoring prompt with spec and diff
- `parseJudgeResponse()` -- Extracts structured scores from judge output
- `aggregateScores()` -- Computes median per dimension
- `saveEvalResult()` -- Persists results to `.workflow/evals/`
- `formatEvalResults()` -- Formats results for display

---

## Best Practices

1. **Evaluate after completing tasks** -- Run eval before moving to the next task to get timely feedback
2. **Use batch mode for trends** -- `--batch --last 5` reveals patterns in quality over time
3. **Pay attention to low token efficiency** -- This often indicates scope creep or unclear specs
4. **Use --candidates first** -- Check which tasks are eligible before running batch evals
5. **Low workflow compliance scores** -- Usually mean the spec or criteria check steps were skipped

---

## Related

- [Completion](./04-completion.md) -- Task completion workflow
- [Verification](./03-verification.md) -- Quality gates
- [Specification Mode](./specification-mode.md) -- Spec generation that feeds into eval
