# /wogi-self-adversary — Self-adversary decision loop

Iterate a generator and adversary on different models until you reach ≥95% confidence on an implementation-class decision. Only escalate to the user if confidence stays low after the loop.

**Triggers**: invoked by the AI itself when blocked by the self-adversary PreToolUse gate (wf-e399bd8d), OR by the user directly.

## Usage

```bash
/wogi-self-adversary "<question + brief context>"
```

The argument should be the question the AI was about to ask the user, optionally followed by relevant context (files, prior decisions, constraints). Both will be passed to the loop.

## How it works

For Claude inside this skill — read carefully, then execute.

### Step 1: Parse the argument

The ARGUMENTS string contains the question + context. Split on a sensible boundary (first newline, or `--context:` separator if present). If no clear split, treat the entire argument as the question and leave context empty.

### Step 2: Run the loop

```js
const { runSelfAdversaryLoop } = require('wogiflow/scripts/flow-self-adversary-loop');
const result = await runSelfAdversaryLoop({
  question: questionText,
  context: contextText,
  maxIterations: 8,
  targetConfidence: 95
});
```

Or via Bash if a CLI wrapper exists; otherwise invoke through Node inline.

### Step 3: Handle the result

**Three possible outcomes:**

**A. `escalate: false`** — confident decision reached.

1. Display the decision + confidence + iteration count to the user as a summary.
2. Write the completion marker so the next `AskUserQuestion` (if any) is allowed:
   ```js
   const gate = require('wogiflow/scripts/hooks/core/self-adversary-gate');
   gate.writeCompletionMarker({
     question: questionText,
     decision: result.decision,
     confidence: result.confidence,
     iterationCount: result.iterationCount
   });
   ```
3. ACT on the decision in your subsequent tool calls — no more asking, no hedging.

**B. `escalate: true` (reason: `low-confidence` / `max-iterations-exhausted`)** — loop ran but couldn't converge.

1. Write the escalation marker (allows the next `AskUserQuestion` to pass without re-blocking):
   ```js
   gate.writeEscalationMarker({
     question: questionText,
     decision: result.decision,
     confidence: result.confidence,
     iterationCount: result.iterationCount,
     reason: result.reason
   });
   ```
2. Surface to the user with: the question, what the loop concluded (best decision + confidence), why iteration couldn't push past the threshold, and what specific resolution you need from them.
3. Call `AskUserQuestion` (which now passes the gate).

**C. `escalate: true` (reason: `no-credentials` / `model-error` / etc.)** — loop couldn't run.

1. Note the failure mode briefly to the user.
2. Write the escalation marker and surface the original question.

### Step 4: Audit trail

Append a one-line summary to `.workflow/state/self-adversary-log.json` (append-only, ring-buffered at 100):

```json
{
  "timestamp": "...",
  "questionHash": "...",
  "iterations": N,
  "finalConfidence": X,
  "outcome": "decided" | "escalated",
  "reason": "..."
}
```

This lets the user audit how often the loop converges vs escalates. Helps tune `targetConfidence` and `maxIterations` over time.

## Configuration

`.workflow/config.json`:

```json
{
  "selfAdversaryGate": {
    "enabled": true,
    "targetConfidence": 95,
    "maxIterations": 8,
    "generatorModel": "anthropic:claude-sonnet-4-6",
    "adversaryModel": "anthropic:claude-3-5-haiku-latest"
  }
}
```

- `enabled: false` — disables both the PreToolUse gate AND prevents the skill from running. Reverts to "always ask the user".
- `targetConfidence` — clamped to [50, 99]; default 95.
- `maxIterations` — clamped to [1, 12]; default 8.

## Files

| File | Purpose |
|---|---|
| `scripts/flow-self-adversary-loop.js` | Core loop (generator ↔ adversary, iteration memory in-process). |
| `scripts/flow-impl-question-classifier.js` | Haiku classifier — implementation vs product/architecture/sensitive. |
| `scripts/hooks/core/self-adversary-gate.js` | PreToolUse intercept + markers. |
| `.workflow/state/self-adversary-complete.json` | Single-use marker, allows next AskUserQuestion. |
| `.workflow/state/self-adversary-escalation.json` | Single-use marker, allows next AskUserQuestion after loop concluded "needs-user". |
| `.workflow/state/self-adversary-log.json` | Append-only audit trail. |

## Why this exists

User directive 2026-05-11 (wf-e399bd8d):

> "Always do highest standards, best approach, don't compromise on quality for token savings. Challenge yourself a few times and most of the times you get to a point where you already know what to do with very high confidence, 90 or 95+ percent. When you have doubt that you'll be able to challenge yourself, use adversary research. And do it in a few iterations until you're confident. And only if you're still not confident, then ask the user."

The pattern maps to Self-Refine (Madaan et al. 2023) + Reflexion (Shinn et al. 2023) + Multi-Agent Reflexion (different-model adversary escapes local optima). WogiFlow already runs an Architect+Adversary loop at the PLAN level (IGR Step 1.55/1.57). This skill is the implementation-decision analogue, finer-grained, runs during coding rather than spec_review.
