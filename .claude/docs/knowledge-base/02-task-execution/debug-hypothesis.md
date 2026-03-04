# Debug Hypothesis

Parallel hypothesis debugging with competing investigation agents.

---

## Purpose

The `/wogi-debug-hypothesis` command tackles difficult bugs by generating multiple competing theories and investigating them in parallel. Instead of following a single debugging thread (which can lead you down a rabbit hole), it spawns separate agents that each investigate a different hypothesis simultaneously.

Use it when:
- A bug has no obvious cause
- You have multiple theories and want to test them all at once
- Sequential debugging has stalled
- You want evidence-based diagnosis rather than guesswork

---

## How It Works

### Execution Flow

1. **Analyze** -- Read the bug description and generate 2-3 competing hypotheses from different bug categories
2. **Spawn** -- Launch parallel investigation agents, one per hypothesis, all running simultaneously
3. **Investigate** -- Each agent searches the codebase for evidence that supports or refutes its assigned hypothesis
4. **Consolidate** -- Collect all findings into a single diagnosis report
5. **Recommend** -- Identify the most likely root cause with supporting evidence

### Hypothesis Generation

The system generates diverse hypotheses from different bug categories to avoid tunnel vision:

| Category | Example Hypotheses |
|----------|-------------------|
| Data | Wrong data source, stale cache, race condition |
| Logic | Off-by-one error, wrong condition, missing edge case |
| Integration | API contract mismatch, version incompatibility, wrong endpoint |
| State | Stale state, missing initialization, wrong lifecycle |
| Config | Wrong environment, missing config value, incorrect defaults |

Hypotheses are intentionally chosen from different categories. Three variations of the same theory would defeat the purpose of parallel investigation.

### Investigation Agents

Each agent operates in read-only mode (no file modifications) and:
- Uses Glob to find relevant files
- Uses Grep to search for patterns related to its hypothesis
- Reads the most relevant files (up to 5)
- Looks for evidence that SUPPORTS or REFUTES the hypothesis

Each agent returns a structured verdict:
- **CONFIRMED** -- Evidence strongly supports this hypothesis
- **REFUTED** -- Evidence contradicts this hypothesis
- **INCONCLUSIVE** -- Not enough evidence either way

Along with a confidence level (HIGH / MEDIUM / LOW) and specific evidence citations (file, line, finding).

---

## Commands

```bash
/wogi-debug-hypothesis "description of the bug or unexpected behavior"
```

Provide a clear description of the problem. The more specific the description, the better the generated hypotheses will be.

---

## Output

### Phase 1: Hypotheses

```
HYPOTHESIS DEBUGGING

Bug: "login form submits but nothing happens"

Generated hypotheses:

  H1: API endpoint returning error silently
      Investigation: Check error handling in login service

  H2: Form event handler not wired correctly
      Investigation: Check form onSubmit binding and event propagation

  H3: Auth state not updating after successful login
      Investigation: Check state management after login response

Spawning 3 investigation agents in parallel...
```

### Phase 2: Investigation Results

```
INVESTIGATION RESULTS

  H1: API endpoint returning error silently
      Verdict: REFUTED
      Confidence: HIGH
      Evidence:
        - src/api/auth.ts:42 — Error handler logs and throws correctly
        - src/api/auth.ts:58 — Network errors surfaced to caller

  H2: Form event handler not wired correctly
      Verdict: CONFIRMED
      Confidence: HIGH
      Evidence:
        - src/components/LoginForm.tsx:15 — onSubmit calls e.preventDefault()
        - src/components/LoginForm.tsx:23 — Missing await on async handler

  H3: Auth state not updating after successful login
      Verdict: INCONCLUSIVE
      Confidence: LOW
      Evidence:
        - src/store/auth.ts:30 — State update looks correct
```

### Phase 3: Diagnosis

```
DIAGNOSIS

Root cause: Form submit handler missing await on async login call

Supporting evidence:
  - LoginForm.tsx:23 — async handler called without await
  - Function returns before login completes

Suggested fix:
  Add await to the login call in the form submit handler
  Files to modify: src/components/LoginForm.tsx

Confidence: HIGH

Next steps:
  - To fix this, run: /wogi-start "fix missing await in login form handler"
  - To investigate further: /wogi-debug-hypothesis "[refined question]"
```

---

## Key Constraints

- **Read-only** -- This command investigates but does NOT fix anything. All agents use explore-only tools.
- **2-3 hypotheses** -- Minimum 2, maximum 3 to keep token usage reasonable.
- **Evidence-based** -- Every verdict must cite specific file and line evidence.
- **Feeds into /wogi-start** -- The diagnosis output can be used directly as input to create a fix task.

---

## Best Practices

1. **Be specific in your bug description** -- "Login form submits but nothing happens" is better than "login broken"
2. **Include reproduction context** -- Mention what you expected vs what actually happened
3. **Use when sequential debugging stalls** -- If you have already tried one theory and it did not pan out, use this to test multiple theories at once
4. **Follow up with /wogi-start** -- Once you have a confirmed hypothesis, create a fix task from the diagnosis
5. **Refine if inconclusive** -- If all hypotheses are inconclusive, run again with a refined bug description

---

## Related

- [Execution Loop](./02-execution-loop.md) -- Task implementation flow
- [Verification](./03-verification.md) -- Quality gates after fixing
- [Trade-offs](./trade-offs.md) -- Decision-making patterns
