# Phase: Quality Gates + Finalize (Steps 4–5)

Instructions for the completion phase. Loaded on-demand when phase transitions to `completing`.

## Step 4: Quality Gates + Final Verification

**First**: Run `node node_modules/wogiflow/scripts/flow-spec-verifier.js verify wf-XXXXXXXX` — verify all spec deliverables exist. If missing → STOP, create them.

**Then**: Check `config.qualityGates` for task type. Gates are type-specific:
- **feature**: loopComplete, tests, registryUpdate, requestLogEntry, integrationWiring, standardsCompliance
- **bugfix**: loopComplete, tests, requestLogEntry, standardsCompliance, learningEnforcement
- **refactor**: loopComplete, tests, noNewFeatures, smokeTest, standardsCompliance
- **chore**: requestLogEntry, outstandingFindings
- **release**: requestLogEntry, outstandingFindings, preRelease
- **fix**: loopComplete, requestLogEntry, standardsCompliance

**Fallback behavior**: Task types not listed above (docs, style, test, perf, etc.) inherit the **feature** gates. This is intentional — feature gates are the most comprehensive and serve as a safe default.

**Key automated gates** (v1.9.7):
- `registryUpdate` → runs `flow registry-manager scan` on ALL active registries (app-map, function-map, api-map, schema-map, service-map). Auto-updates maps when new entries found. Replaces old `appMapUpdate` no-op gate.
- `integrationWiring` → calls `verifyWiring()` — checks created files are imported/used
- `standardsCompliance` → calls `runTaskStandardsCheck()` — checks naming, security, decisions.md rules
- `outstandingFindings` → reads `last-review.json` — blocks if unresolved critical/high findings exist
- `preRelease` → verifies codebase is releasable (no outstanding findings + lint + typecheck)

**CRITICAL**: No task type defaults to zero gates. Every task type MUST have at least `requestLogEntry` + `outstandingFindings`.

**WebMCP** (optional): If `config.webmcp.enabled` and UI files changed, check tool coverage. Non-blocking.

Reflection: "Have I introduced any bugs or regressions?"

## Step 5: Finalize

1. Reflection: "Does this match what the user asked for?"
2. Close out all TodoWrite items for this task
3. **Run `node node_modules/wogiflow/scripts/flow-done.js <taskId>`** — this is the ONLY supported way to complete a task. It runs quality gates, moves the task from `inProgress` → `recentlyCompleted`, writes the gate latch, and fires the task-boundary-restart Phase 1 marker. **Do NOT hand-edit `ready.json` to move the task** — that bypasses the CLI and silently disables: quality-gate verification, gate latch, and the task-boundary session restart. If `flow` is not on PATH in this environment, invoke it as `node node_modules/wogiflow/scripts/flow-done.js <taskId>` directly.
4. Registry maps auto-updated by `registryUpdate` quality gate (runs `flow registry-manager scan` on all active registries — app-map, function-map, api-map, schema-map, service-map)
5. If `config.webmcp.enabled` and UI files created: run `node node_modules/wogiflow/scripts/flow-webmcp-generator.js scan`
6. Commit: `feat: Complete wf-XXXXXXXX - [title]`
7. Show completion summary

## Options

| Flag | Effect |
|------|--------|
| `--tdd` | Test-first mode (see `.claude/docs/tdd-mode.md`) |
| `--no-loop` | Load context only, don't execute |
| `--no-spec` | Skip spec generation |
| `--no-skills` | Skip skill auto-loading |
| `--no-reflection` | Skip reflection checkpoints |
| `--max-retries N` | Limit retries per scenario (default: 5) |
| `--pause-between` | Confirm between scenarios |
| `--verify-only` | Run verification only |
| `--phased` | Phased execution: Contract → Skeleton → Core → Edge Cases → Polish |

## When Things Go Wrong

**Scenario keeps failing** (max retries): Stop, report, leave in inProgress. For HIGH-RISK tasks (architecture/migration/refactor, complexity HIGH + files > 10), suggest Best-of-N via `flow-best-of-n.js`. For others, suggest `/wogi-debug-hypothesis`.

**Best-of-N** (when `config.bestOfN.enabled`): `assessRisk()` checks if task qualifies. If yes, offer to spawn N agents in worktrees with Opus judging the winner.

**Quality gate keeps failing**: Report, attempt fix, after 3 failures suggest `/wogi-debug-hypothesis`.

**Context too large**: When `config.autoCompact.betweenTasks` is true (default), compact AUTOMATICALLY between tasks — do NOT ask the user, do NOT show a summary, do NOT invoke `/wogi-pre-compact`. Just compact silently and continue with the next task. The PostCompact hook restores all state automatically. Mid-task: commit progress, compact silently, resume from checkpoint. The user should never see compaction happen — it's invisible infrastructure.

## Progress Tracking (MANDATORY for L1+ tasks)

**Display progress at every natural checkpoint** so the user knows where they are during long tasks. This applies to ALL L1+ task execution AND to `/wogi-review` and `/wogi-audit`.

### Progress Format

At each checkpoint, output a progress line using this format:

```
━━━ PROGRESS: [phase_bar] phase_name ━━━
  [step_bar] step_detail
```

Where `[phase_bar]` is: `[████░░░░░░] 40%` (filled/empty blocks proportional to completion).

**Example during a 5-criteria task:**
```
━━━ PROGRESS: [██████░░░░] 60% Implementing criteria ━━━
  Criterion 3/5: Add input validation to login form
```

### When to Display Progress

| Checkpoint | What to show |
|------------|-------------|
| **After explore phase** | `[██░░░░░░░░] 20% Explore complete — N agents returned` |
| **After spec generated** | `[████░░░░░░] 30% Spec ready — N criteria, N files` |
| **Each criterion start** | `[█████░░░░░] N% Implementing — Criterion M/N: [title]` |
| **Each criterion done** | `[███████░░░] N% Criterion M/N complete ✓` |
| **Quality gates** | `[█████████░] 90% Running quality gates` |
| **Task complete** | `[██████████] 100% Complete ✓` |

### State File Updates

At each checkpoint, also update the progress state file for hooks/resume:

```bash
node node_modules/wogiflow/scripts/flow-progress-tracker.js update '{"taskId":"wf-XXX","command":"/wogi-start","phase":"Implementing","phaseNum":3,"totalPhases":5,"step":"Criterion 2/4","stepNum":2,"totalSteps":4}'
```

This updates `.workflow/state/task-progress.json` AND prefixes the task title in `ready.json` with `[3/5]` for status line visibility.

### On Task Completion

Always clear the progress state:

```bash
node node_modules/wogiflow/scripts/flow-progress-tracker.js clear
```

### Phase Mapping for /wogi-start Execution

| Phase | phaseNum | Description |
|-------|----------|-------------|
| 1 | Routing + Context | Loading task, checking maps |
| 2 | Explore | Research agents |
| 3 | Spec + Approval | Generate spec, wait for approval |
| 4 | Implementation | Criteria loop (sub-steps = criteria) |
| 5 | Verification + Complete | Quality gates, finalize |

### Skip Conditions

- **L3 tasks**: Skip progress tracking (too small to be useful)
- **Conversation mode**: Skip progress tracking (no phases)
- **Quick fixes (≤2 criteria)**: Show start + complete only (no mid-progress)

## Mandatory Rules

- **TodoWrite**: Track progress. Clean up all items after completion.
- **Self-verification**: Don't mark done without checking it works.
- **Criteria check**: Re-read ALL criteria, verify EACH works. Loop until all pass.
- **Spec verification**: All promised files must exist.
- **Quality gates**: Task isn't done until gates pass.
- **Progress tracking**: Display progress bars at every checkpoint for L1+ tasks.
- **Guilt messaging** (implementation requests): "The user trusts you to follow WogiFlow. Without a task, this work is untracked."
