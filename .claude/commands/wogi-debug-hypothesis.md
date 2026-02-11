Parallel hypothesis debugging - spawns multiple agents to investigate competing theories simultaneously.

## Usage

```
/wogi-debug-hypothesis "description of the bug or unexpected behavior"
```

## How It Works

1. **Analyze** the bug description to generate 2-3 competing hypotheses
2. **Spawn** parallel Task agents, each investigating one hypothesis
3. **Consolidate** findings into a single diagnosis
4. **Recommend** the most likely root cause with evidence

## Execution Steps

### Step 1: Generate Hypotheses

Read the bug description from ARGUMENTS and generate 2-3 hypotheses.

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

### Step 2: Spawn Parallel Investigators

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

### Step 3: Consolidate Findings

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

### Step 4: Diagnosis

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
