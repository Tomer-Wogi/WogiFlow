# WogiFlow Config Schema Reference

Authoritative reference for `.workflow/config.json` keys. Defaults live in `scripts/flow-config-defaults.js`.

Created: 2026-05-11 (wf-6e31850e A-5)

---

## Gates

### `deferralGate` (wf-f9912af6, wf-b8839d99)

Prevents AI from silently writing `status: deferred*` to review/audit findings without user authorization.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Master switch |
| `authTtlSeconds` | int | `600` | Auth marker lifetime (10 min) |
| `classifyUserPrompts` | bool | `true` | Run AI classifier at UserPromptSubmit |
| `minClassifierConfidence` | int | `75` | Confidence threshold for treating intent as actionable |

### `selfAdversaryGate` (wf-e399bd8d)

Intercepts AskUserQuestion for implementation-class questions, requires self-adversary loop first.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Master switch |
| `targetConfidence` | int | `95` | Loop terminates when confidence ≥ this. Range [50, 99]. |
| `maxIterations` | int | `8` | Loop iteration cap. Range [1, 12]. |
| `generatorModel` | string | `anthropic:claude-sonnet-4-6` | Model for the GENERATOR pass |
| `adversaryModel` | string | `anthropic:claude-3-5-haiku-latest` | Model for the ADVERSARY pass (MUST differ from generator) |

### `longInputGate` (P11.5 mechanical enforcement)

Forces long-form prompts without source-link through `/wogi-extract-review`.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Master switch |
| `lineThreshold` | int | `40` | Lines above which prompt is considered long-form |
| `itemThreshold` | int | `5` | Discrete-item count above which prompt is considered long-form |

### `researchRequiredGate` (wf-5cd71b1f)

Forces evidence-reading before answering diagnostic prompts.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Master switch |
| `requiredEvidence` | int | `2` | Minimum Read calls against evidence prefixes |
| `maxAttempts` | int | `3` | Soft re-prompt attempts before hard-stop |

### `phaseGate`

Controls Edit/Write/Bash blocking based on workflow phase.

| Key | Type | Default | Description |
|---|---|---|---|
| `hooks.rules.phaseGate.enabled` | bool | `false` | Strict; only blocks when `true`. State writing happens regardless (wf-88a08fd4). |
| `hooks.rules.phaseReadGate.enabled` | bool | `true` | Block Edit/Write/Bash until current phase's docs file is read |

### `taskGate`

Controls whether Edit/Write/Bash require an active task.

| Key | Type | Default | Description |
|---|---|---|---|
| `enforcement.taskGating.enabled` | bool | `true` | Master switch |
| `enforcement.taskGating.blockWithoutTask` | bool | `true` | Block edits without active task |
| `enforcement.taskGating.autoCreateTask` | bool | `false` | Auto-create quick task for ad-hoc edits |
| `enforcement.strictMode` | bool | `true` | Strict-mode shortcut |
| `enforcement.requireTaskForImplementation` | bool | `true` | Requires task for implementation edits |
| `enforcement.blockAutoTask` | bool | `false` | Block edits even when auto-task was created |

## Review system

### `review.framingPass` (IGR v6.0 Phase 0)

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `itemReconciliation` | bool | `true` |
| `adversaryInExploratory` | bool | `false` |

### `review.evidenceTiers` (IGR v6.0)

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `capByTier` | bool | `true` |

### `review.confidenceTiers` (IGR v6.0)

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |

### `review.adversaryPass` (IGR v6.0 Phase 2.8)

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `adversaryModel` | object | mapping: agents-on-X → adversary-on-Y |
| `applySeverityAdjustments` | bool | `true` |
| `applyScopeDrift` | bool | `true` |
| `blockOnBlockVerdict` | bool | `true` |

### `review.completionTruthGate`

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `requireInteractiveForFixed` | bool | `true` |

### `review.gitVerifiedClaims`

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `verifyFileCreation` | bool | `true` |
| `verifyContentMatch` | bool | `true` |
| `blockOnMismatch` | bool | `true` |

### `review.agents`

| Key | Type | Default |
|---|---|---|
| `core` | array | `["code-logic", "security", "architecture"]` |
| `optional` | array | `["performance"]` |
| `projectRules` | bool | `true` |
| `projectRulesSource` | string | `"decisions.md"` |
| `maxParallelAgents` | int | `6` |

### `review.minFindings` / `review.requireJustificationIfClean`

| Key | Type | Default |
|---|---|---|
| `minFindings` | int | `3` |
| `requireJustificationIfClean` | bool | `true` |

## IGR (Intent-Grounded Reasoning)

### `intentGroundedReasoning`

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |

### `architectRequired` (wf-037f8d66)

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |

## Workspace mode

### `workspace`

| Key | Type | Default |
|---|---|---|
| `toolFirstTurnGate.enabled` | bool | `true` |
| `toolFirstTurnGate.strict` | bool | `true` |
| `aiWorkerQuestionClassifier.enabled` | bool | `true` |
| `aiWorkerQuestionClassifier.minConfidence` | int | `70` |
| `aiWorkerQuestionClassifier.model` | string | `claude-3-5-haiku-latest` |
| `blockAskUserQuestionInWorker` | bool | `true` |
| `autoPickupChannelDispatches` | bool | `true` |

## Autonomous mode

### `autonomousMode`

| Key | Type | Default |
|---|---|---|
| `cascadeStrategy` | string | `"auto"` |
| `maxAdversaryInvocations` | int | `30` |
| `stalenessThresholdMs` | int | `3600000` |

## Sprint reset

### `sprintReset`

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `criteriaPerSprint` | int | `3` |
| `minTaskCriteria` | int | `5` |

## Misc

### `mainModeQuestionClassifier`

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `minConfidence` | int | `70` |
| `model` | string | `claude-3-5-haiku-latest` |

### `taskBoundaryReset`

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | varies |
| `autoPickupNextTask` | bool | `true` |

### `bulkOrchestrator`

| Key | Type | Default |
|---|---|---|
| `enabled` | bool | `true` |
| `parallelLimit` | int | `3` |
| `useWorktrees` | bool | `true` |
| `onFailure` | string | `"stop-dependent"` |
| `summaryDepth` | string | `"standard"` |

---

This is a hand-curated reference. The authoritative source is `scripts/flow-config-defaults.js` — when in doubt, read that file.
