---
description: "Compressed execution prompt for 2nd+ task in a session. ~80% smaller than full wogi-start.md."
effort: medium
---
Compressed task execution for continuation tasks (2nd+ in session). Routing, triage, and examples are skipped — the AI already has them in context.

## Quick Dispatch

Task ID: `wf-XXXXXXXX` → Load from `ready.json`, move to inProgress.

## Execution Loop

### 1. Load Context
- Read task from `ready.json` (acceptance criteria, files, type)
- Check `app-map.md`, `function-map.md`, `decisions.md` for relevant entries
- Load spec from `.workflow/specs/wf-XXXXXXXX.md` or `.workflow/changes/*/wf-XXXXXXXX.md`

### 2. Explore (L2+ tasks — MANDATORY)
Launch research agents in parallel (see `.claude/docs/explore-agents.md`):
- Agent 1 (Codebase), Agent 4 (Risk), Agent 5 (Standards) — always
- Agent 6 (Consumer Impact) — L1+ tasks or refactor/migration L2
- Agents 2-3 (Web) — if `researchDepth` is "thorough"
- **REUSE GATE**: Check reuse candidates before proceeding

### 3. Scope-Confidence Gate (L0/L1 only)
Extract assumptions → verify against codebase → present UNVERIFIABLE/CONTRADICTED to user.

### 4. Spec Generation (L1+ or 3+ criteria)
Generate to `.workflow/specs/wf-XXXXXXXX.md` with acceptance criteria, boundary declarations, files to change.

### 5. Decision Authority (Cross-Cutting)
Classify decisions via `flow-decision-authority.js`. engineering/naming → agent-decides. productBehavior/ux → owner-decides. security → auto-fix. Max 5 owner questions per batch.

### 6. Implementation Loop
For each criterion:
1. Implement following `decisions.md` patterns
2. Validate: `node --check` / lint / typecheck after each file edit
3. If failing: debug, fix, retry (max 5)

### 6.5. Additional Mandatory Gates

**Inventory Verification** (remove/fix/replace-all tasks): Pre/post inventory scan per Step 3.55. Wait for user confirmation.

**Item Reconciliation** (3+ item inputs): Enumerate all items, verify each becomes a criterion, reconcile at completion per Step 1.25.

**Scope-Confidence Gate** (L0/L1 only): Extract assumptions, verify against codebase, present UNVERIFIABLE/CONTRADICTED per Step 1.45.

### 7. Verification Gates (ALL MANDATORY)

**Criteria Check**: Re-read ALL criteria, verify each is implemented AND works.

**Sub-Agent Verification** (if agents used): Distrust self-reports. Trace full feature chain. Check wiring.

**Skeptical Evaluator** (L2+, if `config.skepticalEvaluator.enabled`): Spawn code-reviewer agent to independently grade each criterion.

**Runtime Verification**: Generate and run tests per `flow-runtime-verification.js`. Frontend → browser tests. Backend → API tests.

**Wiring Validation**: `flow-wiring-verifier.js` — verify created files are imported/used. Check removal impact.

**Standards Compliance**: `flow-standards-gate.js` — naming, security, decisions.md rules.

### 8. Quality Gates
Run `flow-spec-verifier.js verify`. Check `config.qualityGates` for task type:
- **feature**: loopComplete, tests, registryUpdate, requestLogEntry, integrationWiring, standardsCompliance
- **bugfix**: loopComplete, tests, requestLogEntry, standardsCompliance, learningEnforcement
- **fix**: loopComplete, requestLogEntry, standardsCompliance

### 9. Finalize
1. Move task to `recentlyCompleted` in ready.json
2. Update `request-log.md`
3. Registry maps auto-updated by `registryUpdate` gate
4. Commit: `feat: Complete wf-XXXXXXXX - [title]`

## Sprint Reset (5+ criteria)
At every 3rd criterion: commit progress, save checkpoint to `task-checkpoint.json`, compact context, resume from checkpoint.

## Phase Execution (MANDATORY)

Before executing ANY phase, you MUST Read the phase instruction file. The PreToolUse hook BLOCKS Edit/Write/Bash until the phase file is read.

| Phase | File to Read |
|-------|-------------|
| exploring | `.claude/docs/phases/01-explore.md` |
| spec_review | `.claude/docs/phases/02-spec.md` |
| coding | `.claude/docs/phases/03-implement.md` |
| validating | `.claude/docs/phases/04-verify.md` |
| completing | `.claude/docs/phases/05-complete.md` |

## Rules
- Validate after EVERY file edit
- Re-read ALL criteria before marking done
- Quality gates MUST pass
- Never skip wiring validation
- Update request-log.md

ARGUMENTS: {args}
