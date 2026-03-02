---
description: "Evaluate WogiFlow task output quality with multi-judge scoring"
---
Evaluate a completed task's output quality using multi-judge scoring (1 Opus + 2 Sonnet).

## Usage

```
/wogi-eval wf-XXXXXXXX              Evaluate a specific task
/wogi-eval --batch --last 5          Evaluate the last 5 completed tasks
/wogi-eval --compare                 Show eval trend comparison
/wogi-eval --candidates              Show tasks eligible for evaluation
```

## How It Works

1. **Read the spec**: Load the task's acceptance criteria and requirements
2. **Get the diff**: Find the commit and extract the implementation diff
3. **Spawn 3 judge agents**: 1 Opus + 2 Sonnet (via Agent tool `model` parameter)
4. **Score independently**: Each judge scores on 5 dimensions (1-10)
5. **Take median**: Final score = median of 3 judges per dimension
6. **Save results**: Store in `.workflow/evals/`

## Scoring Dimensions

| Dimension | What It Measures |
|-----------|-----------------|
| Completeness | Did implementation address ALL acceptance criteria? |
| Accuracy | Is code correct, handling edge cases? |
| Workflow Compliance | Did it follow WogiFlow patterns (spec, criteria check, wiring, standards)? |
| Token Efficiency | How many tokens/iterations to reach passing state? |
| Quality | Code quality, readability, maintainability |

## Execution Flow

### Step 1: Prepare eval data

```bash
node scripts/flow-eval.js prepare wf-XXXXXXXX
```

This returns: spec content, implementation diff, iteration count, token estimate.

### Step 2: Spawn judge agents

Launch 3 agents in parallel using the Agent tool:

```
Agent(model: "opus", prompt: "<judge prompt with spec + diff>")
Agent(model: "sonnet", prompt: "<judge prompt with spec + diff>")
Agent(model: "sonnet", prompt: "<judge prompt with spec + diff>")
```

Each judge receives the same prompt (from `buildJudgePrompt()` in `flow-eval-judge.js`) and scores independently.

### Step 3: Aggregate scores

```javascript
const { aggregateScores, parseJudgeResponse } = require('./scripts/flow-eval-judge');

// Parse each judge's response
const scores = judgeResponses.map(parseJudgeResponse).filter(Boolean);

// Take median per dimension
const result = aggregateScores(scores);
```

### Step 4: Save and display

```javascript
const { saveEvalResult, formatEvalResults } = require('./scripts/flow-eval');
saveEvalResult({ taskId, aggregated: result, judgeResults: scores, model, taskType });
```

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 EVAL RESULTS: wf-XXXXXXXX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Judges: 3 (1 Opus + 2 Sonnet) | Confidence: high

  completeness          ████████░░ 8/10
  accuracy              ███████░░░ 7/10
  workflowCompliance    █████████░ 9/10
  tokenEfficiency       ██████░░░░ 6/10
  quality               ████████░░ 8/10

Overall: 7.6/10 — PASS (threshold: 6)

Individual Judges:
  Judge 1 (opus): Strong implementation, minor edge case gaps
  Judge 2 (sonnet): Good workflow compliance, token usage could improve
  Judge 3 (sonnet): Clean code, well-structured implementation

Saved: .workflow/evals/wf-XXXXXXXX-eval-2026-03-02T10-00-00.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Batch Mode

When running `--batch --last N`:
1. Get the last N completed tasks from stats
2. Evaluate each sequentially
3. Display summary table

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 BATCH EVAL RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task            Model         Overall  Comp  Acc   WF    Tok   Qual
wf-a1b2c3d4    opus-4-6      7.6      8     7     9     6     8
wf-e5f6a7b8    sonnet-4-6    6.8      7     7     8     5     7
wf-c9d0e1f2    opus-4-6      8.2      9     8     9     7     8

Average: 7.5/10
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Configuration

In `config.json`:
```json
{
  "eval": {
    "judges": { "opus": 1, "sonnet": 2 },
    "scoringDimensions": ["completeness", "accuracy", "workflowCompliance", "tokenEfficiency", "quality"],
    "passingThreshold": 6
  }
}
```

ARGUMENTS: $ARGUMENTS
