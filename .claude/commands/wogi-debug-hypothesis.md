---
description: "Parallel hypothesis debugging - spawns agents for competing theories"
effort: high
---
Parallel hypothesis debugging — spawns multiple agents to investigate competing theories simultaneously. **v2.23.0+**: now runs IGR-style assumption surfacing and scope verification BEFORE generating hypotheses, and a cross-hypothesis adversary step AFTER investigation to catch "three variations of the same wrong theory."

## Usage

```
/wogi-debug-hypothesis "description of the bug or unexpected behavior"
/wogi-debug-hypothesis --no-assumptions   # skip Tier 2 assumption gate (not recommended)
/wogi-debug-hypothesis --no-adversary     # skip cross-hypothesis adversary
```

## How It Works (v2.23.0+)

```
Bug description
  ↓
Step 0: Scope-Confidence pre-check — verify files/modules you plan to
        investigate actually exist (regex → grep); halt if contradictions
  ↓
Step 1: Assumption Surfacing (Tier 2) — list domain-model assumptions
        your hypotheses will depend on; WAIT for user confirmation
  ↓
Step 2: Generate 2-3 hypotheses grounded in CONFIRMED assumptions
  ↓
Step 3: Spawn parallel Explore agents per hypothesis (READ-ONLY)
  ↓
Step 4: Consolidate findings
  ↓
Step 5: Hypothesis Adversary — spawn adversary on different model; goal:
        challenge the winning hypothesis against rejected ones; surface
        any overlap that suggests the diagnosis missed the real cause
  ↓
Step 6: Final diagnosis with confidence + suggested fix
```

The "user is the adversary" assumption pass (Step 1) is the single most
important addition — it forces hypothesis generation to be grounded in
facts rather than whatever the AI's first read of the bug happened to be.

## Execution Steps

### Step 0: Scope-Confidence Pre-Check (v2.23.0+)

Before generating hypotheses, extract noun-phrases from the bug description that look like code entities (function names, filenames, module names, API endpoints) and verify they exist in the codebase:

```javascript
const gates = require('wogiflow/scripts/flow-story-gates');
const audit = gates.auditScopeConfidence(ARGUMENTS);
```

If any assumption is **CONTRADICTED** (user refers to a component that doesn't exist), HALT and ask: "You mentioned `<X>` but I don't see it in the codebase. Did you mean `<nearest match>`, or is `<X>` created under a different name?"

This catches the "investigate imaginary code" failure mode before wasting a parallel agent run.

### Step 1: Assumption Surfacing (Tier 2 — MANDATORY unless `--no-assumptions`)

Before generating ANY hypothesis, identify the domain-model assumptions your theories will depend on. Present them in a fenced block and **WAIT** for user confirmation.

```
━━━ ASSUMPTIONS (confirm before I generate hypotheses) ━━━
The bug description is: "[ARGUMENTS]"

My hypothesis generation will assume:
  1. <assumption about what X does>
  2. <assumption about when Y fires>
  3. <assumption about data shape>
  4. <assumption about call ordering>

Do these match your understanding? [confirm / correct <N>]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Do NOT proceed to Step 2 while waiting.** The user's response becomes the ground truth for hypothesis generation.

**Rationale** (from `config.researchReasoningGate`): same-model self-critique rubber-stamps. The USER is the effective adversary — they validate the domain model before the AI builds theories on invisible guesses. Three hypotheses rooted in the same wrong assumption are still all wrong.

### Step 2: Generate Hypotheses

Using the confirmed assumptions from Step 1, generate 2-3 hypotheses.

For each hypothesis, identify:
- **Theory**: What might be causing this
- **Investigation plan**: What files/code to check
- **Expected evidence**: What would confirm or refute this theory

Display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔬 HYPOTHESIS DEBUGGING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bug: "[ARGUMENTS]"

Generated hypotheses:

  H1: [Theory 1]
      Investigation: [what to check]

  H2: [Theory 2]
      Investigation: [what to check]

  H3: [Theory 3]
      Investigation: [what to check]

Spawning 3 investigation agents in parallel...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 3: Spawn Parallel Investigators

Launch one Task agent per hypothesis. **All agents must be launched in a single message** (parallel Task calls).

For each agent, use this prompt template:

```
You are investigating a bug hypothesis.

**Bug description:** [ARGUMENTS]

**Your hypothesis (H[N]):** [theory]

**Investigation plan:**
[specific files and patterns to check]

**Your job:**
1. Use Glob to find relevant files
2. Use Grep to search for patterns related to this hypothesis
3. Read the most relevant files (up to 5)
4. Look for evidence that SUPPORTS or REFUTES this hypothesis

**Report format:**
Return a JSON-parseable summary:
{
  "hypothesis": "H[N]: [theory]",
  "verdict": "CONFIRMED" | "REFUTED" | "INCONCLUSIVE",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "evidence": [
    { "file": "path/to/file", "line": N, "finding": "what you found" }
  ],
  "explanation": "Brief explanation of your conclusion"
}

IMPORTANT: Only use read-only tools (Glob, Grep, Read, WebSearch, WebFetch). Do NOT modify any files.
```

Use `subagent_type=Explore` for all investigation agents.

### Step 3.5: Consolidate Findings

After all agents complete, display the consolidated results:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 INVESTIGATION RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  H1: [Theory 1]
      Verdict: CONFIRMED / REFUTED / INCONCLUSIVE
      Confidence: HIGH / MEDIUM / LOW
      Evidence:
        - [file:line] [finding]
        - [file:line] [finding]

  H2: [Theory 2]
      Verdict: ...

  H3: [Theory 3]
      Verdict: ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 4: Hypothesis Adversary (v2.23.0+ — MANDATORY unless `--no-adversary`)

After consolidation, spawn a single Agent (different `model` param if `config.hybrid.enabled`, else same) with this prompt:

```
You are the hypothesis adversary.

Confirmed domain assumptions (from the user):
  [list from Step 1]

The 3 hypotheses and their verdicts:
  H1 [CONFIRMED, confidence HIGH]: <theory>
    Evidence: [top 3 findings]
  H2 [REFUTED, confidence HIGH]: <theory>
    Evidence: ...
  H3 [INCONCLUSIVE, confidence LOW]: <theory>
    Evidence: ...

Winning hypothesis: H1

Your job (10 min):
  1. Does H1's evidence actually prove H1, or could it also be consistent
     with H2 or H3? List overlapping evidence.
  2. Is there a 4th hypothesis that would explain ALL the evidence better
     than H1 alone?
  3. List 1-3 specific reasons H1 might be WRONG despite the verdict.
  4. Cite file:line for each concern.

Output format:
{
  "overlap_risk": "low|medium|high",
  "alternative_hypothesis": "<new theory or 'none'>",
  "concerns": [
    { "concern": "...", "evidence": "<file:line>" }
  ]
}
```

Present adversary critique to the user alongside the original diagnosis:

```
━━━ DIAGNOSIS ━━━
[original Step 5 content]

━━━ ADVERSARY CRITIQUE (reviewed by a different model) ━━━
Overlap risk: [low|medium|high]
Alternative hypothesis: [new theory or "none"]
Concerns:
  • [concern 1] — [file:line]
  • [concern 2] — [file:line]
```

One pass only — no iteration loop (this is debug, not implementation).

### Step 5: Diagnosis

Synthesize the findings into a final diagnosis:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 DIAGNOSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Root cause: [most likely explanation based on evidence]

Supporting evidence:
  - [key evidence 1]
  - [key evidence 2]

Suggested fix:
  [brief description of what to change]
  Files to modify: [list]

Confidence: HIGH / MEDIUM / LOW

Next steps:
  - To fix this, run: /wogi-start "fix [description]"
  - To investigate further: /wogi-debug-hypothesis "[refined question]"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Hypothesis Generation Guidelines

When generating hypotheses, consider these common bug categories:

| Category | Example Hypotheses |
|----------|-------------------|
| **Data** | Wrong data source, stale cache, race condition |
| **Logic** | Off-by-one, wrong condition, missing edge case |
| **Integration** | API contract mismatch, version incompatibility, wrong endpoint |
| **State** | Stale state, missing initialization, wrong lifecycle |
| **Config** | Wrong environment, missing config, incorrect defaults |

Prefer **diverse hypotheses** from different categories. Avoid generating 3 variations of the same theory.

## Important

- This command is **read-only** - it investigates but does NOT fix
- All agents use `subagent_type=Explore` (no edit/write tools)
- Maximum 3 hypotheses (2 minimum) to keep token usage reasonable
- If one hypothesis is clearly correct, the others help validate by exclusion
- Results can feed directly into `/wogi-start` for the fix

ARGUMENTS: $ARGUMENTS
