# Phase: Implementation (Steps 3–3.52)

Instructions for the implementation phase. Loaded on-demand when phase transitions to `coding`.

## Step 3: Execute Each Scenario (Loop)

**When TDD is NOT active**, use this normal flow. For each acceptance criterion:
1. Mark in_progress in TodoWrite
2. Implement following matched skill patterns
3. Run verification (lint, typecheck, tests) → save artifact to `.workflow/verifications/`
4. If failing: debug, fix, retry (max 5 attempts)
5. Mark completed only when verification passes

## Step 3.05: Sprint-Based Context Reset (L1+ tasks with 5+ criteria)

**Activates when**: `config.sprintReset.enabled` (default: true) AND task has 5+ acceptance criteria AND current criterion index is a multiple of `config.sprintReset.criteriaPerSprint` (default: 3).

**The problem this solves**: For large tasks, context fills with implementation details from early criteria. By criterion 6+, the AI is working with degraded context — old diffs, stale tool results, and exploration artifacts crowd out what matters for the current criterion. The Anthropic harness design research found that full context resets with structured file-based handoffs produce higher quality output than continuous context for long-running tasks.

**Procedure** (runs automatically at sprint boundaries):

1. After completing criterion N (where N % `criteriaPerSprint` === 0 AND remaining criteria > 0):
2. **Commit progress**: `git add -A && git commit -m "sprint: criteria 1-N of M complete"`
3. **Save sprint checkpoint** to `.workflow/state/task-checkpoint.json`:
   - Task ID, spec path, completed criteria indices, changed files, remaining criteria
4. **Output sprint summary** (visible to user):
   ```
   ━━━ SPRINT BOUNDARY ━━━
   Completed criteria 1-N of M. Committing and resetting context.
   Remaining: criteria (N+1)-M
   ```
5. **Compact context** — this triggers a full compaction. The PostCompact hook restores:
   - Active task ID and spec reference
   - Which criteria are done vs pending (from checkpoint)
   - Changed files list
6. **Resume from checkpoint** — read the spec fresh, skip completed criteria, continue with criterion N+1

**Why this is different from normal compaction**: Normal compaction summarizes the conversation. Sprint reset goes further — it commits work, saves a structured checkpoint, and compacts. The next sprint starts with a clean slate + the checkpoint file, not a compressed summary of everything that happened. The AI reads the spec fresh rather than relying on a summarized memory of it.

**Configuration**:
```json
{
  "sprintReset": {
    "enabled": true,
    "criteriaPerSprint": 3,
    "minTaskCriteria": 5
  }
}
```

**Skip when**: Task has < 5 criteria, TDD mode is active (TDD has its own rhythm), or `sprintReset.enabled` is false.

## Step 3.5: Criteria Completion Verification (MANDATORY)

After implementing all scenarios, BEFORE quality gates:

1. Re-read original acceptance criteria from spec
2. For EACH criterion: verify it was actually implemented and WORKS (not just "code exists" but "code does what the criterion describes")
3. If ANY criterion NOT done → implement it, then re-check ALL criteria again
4. Only proceed when ALL criteria verified

**This prevents "claiming done when not done."**

## Step 3.52: Sub-Agent Output Verification (MANDATORY when agents were used)

**Activates when**: Any acceptance criterion was implemented by a sub-agent (Agent tool with `isolation: "worktree"` or any delegated agent).

**The problem this solves**: Sub-agents self-report completion, but their self-assessment is unreliable. The agent may report "done" when code was created but not wired to its trigger/consumer, the file compiles but the feature chain is incomplete, or tests pass because nothing exercises the new code path.

**Procedure**:

1. **DISTRUST sub-agent self-reports.** A sub-agent saying "done" is a CLAIM, not a FACT. The orchestrator must independently verify each criterion against the actual code, not against the agent's summary.

2. For EACH criterion a sub-agent claims to have completed:
   a. **Read the ACTUAL files** the agent modified (not just the agent's summary)
   b. **Trace the full feature chain**: Who calls this? → What does it call? → What's the end-to-end flow?
   c. For services: verify at least ONE caller invokes the critical method
   d. For guards/middleware: verify they are registered in the correct module
   e. For event-driven features: verify the event is emitted AND consumed

3. **Chain verification checklist** (for each new service/feature):
   - [ ] Service/component is created
   - [ ] Registered in the correct module (providers, imports)
   - [ ] Exported from the module (if needed by other modules)
   - [ ] Imported by the consuming module
   - [ ] Injected in the consuming service/controller
   - [ ] The critical method is CALLED at the right trigger point
   - [ ] The trigger point is reachable from a user action (HTTP request, cron, event)

4. If ANY link in the chain is missing → the criterion is NOT done. Fix the missing link first.

**Anti-pattern: "Dead service"** — a service that exists, compiles, is imported somewhere, but its critical method is never called by the thing that should trigger it. This passes lint, typecheck, and wiring checks (because the file IS imported) but the feature doesn't work.
