# Configuration Reference

Complete reference for all WogiFlow configuration options.

---

## Location

Configuration lives in `.workflow/config.json`

```json
{
  "version": "2.0.0",
  "projectName": "my-project",
  // ... options
}
```

---

## Quick Navigation

### Core Settings
| Option | Purpose |
|--------|---------|
| [version](#other-top-level-options) | Config schema version |
| [projectName](#other-top-level-options) | Project name |
| [autoLog](#other-top-level-options) | Auto-update request log |
| [autoUpdateAppMap](#other-top-level-options) | Auto-update app-map |

### Category 1: Task & Workflow
| Section | Purpose |
|---------|---------|
| [enforcement](#enforcement) | Task gating and strict mode |
| [workflow](#workflow) | Planning and agent structure |
| [execution.loops](#executionloops) | Self-completing execution loops |
| [durableSteps](#durablesteps) | Crash recovery |
| [suspension](#suspension) | Long-running task handling |
| [parallelExecution](#parallelexecution) | Concurrent execution |
| [phases](#phases) | Project phase tracking |
| [mandatorySteps](#mandatorysteps) | Required workflow steps |
| [priorities](#priorities) | Task priority levels |
| [storyDecomposition](#storydecomposition) | Story breakdown |

### Category 2: Quality & Validation
| Section | Purpose |
|---------|---------|
| [qualityGates](#qualitygates) | Per-task-type requirements |
| [validation](#validation) | Auto-validation commands |
| [tdd](#tdd) | Test-first development mode |
| [regressionTesting](#regressiontesting) | Regression checks |
| [standardsCompliance](#standardscompliance) | Pattern compliance enforcement |

### Category 3: Specifications & Planning
| Section | Purpose |
|---------|---------|
| [specificationMode](#specificationmode) | Spec-first development |
| [clarifyingQuestions](#clarifyingquestions) | Requirement clarification |
| [epics](#epics) | Epic-level planning |
| [prd](#prd) | PRD integration |

### Category 4: Learning & Intelligence
| Section | Purpose |
|---------|---------|
| [learning.skill](#learningskill) | Per-skill learning |
| [learning.knowledgeRouting](#learningknowledgerouting) | Knowledge routing |
| [learning.modelAdapters](#learningmodeladapters) | Model adaptation learning |
| [memory](#memory) | Semantic memory system |
| [skills](#skills) | Skill system configuration |

### Category 5: Context & Models
| Section | Purpose |
|---------|---------|
| [context.auto](#contextauto) | Auto-context loading |
| [context.smart](#contextsmart) | Smart context estimation |
| [context.monitor](#contextmonitor) | Context usage monitoring |
| [context.session](#contextsession) | Session state context |
| [models.hybrid](#modelshybrid) | Hybrid model execution |
| [models.multiModel](#modelsmultimodel) | Multi-model routing |

### Category 6: DevOps & Security
| Section | Purpose |
|---------|---------|
| [commits](#commits) | Commit behavior |
| [security](#security) | Security scanning |
| [damageControl](#damagecontrol) | Destructive action prevention |
| [hooks](#hooks) | Hook system configuration |

### Category 7: Advanced Features
| Section | Purpose |
|---------|---------|
| [review](#review) | Code review system |
| [bugFlow](#bugflow) | Bug investigation flow |
| [research](#research) | Research verification |
| [longInputGate](#longinputgate) | Long input processing |
| [techDebt](#techdebt) | Tech debt tracking |
| [finalization](#finalization) | Branch finalization |
| [audit](#audit) | Project audit system |
| [plugins](#plugins) | Plugin system |

---

## enforcement

Controls task gating — whether WogiFlow enforces that all work goes through tasks.

**Config path**: `enforcement`

```json
{
  "enforcement": {
    "strictMode": true,
    "requireTaskForImplementation": true,
    "requireStoryForMediumTasks": true,
    "requirePatternCitation": false,
    "citationFormat": "// Pattern: {pattern}",
    "blockAutoTask": true,
    "warnOnBypass": true,
    "taskSizeThresholds": {
      "small": { "maxFiles": 3, "maxHours": 1 },
      "medium": { "maxFiles": 10, "maxHours": 4 },
      "large": { "minFiles": 10, "minHours": 4 }
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enforcement.strictMode` | boolean | `true` | Block all file edits without an active task |
| `enforcement.requireTaskForImplementation` | boolean | `true` | Require task ID before coding |
| `enforcement.requireStoryForMediumTasks` | boolean | `true` | Require story decomposition for medium+ tasks |
| `enforcement.requirePatternCitation` | boolean | `false` | Require citing decisions.md patterns in code |
| `enforcement.citationFormat` | string | `"// Pattern: {pattern}"` | Format for pattern citations |
| `enforcement.blockAutoTask` | boolean | `true` | Prevent AI from auto-creating tasks to bypass gating |
| `enforcement.warnOnBypass` | boolean | `true` | Warn when routing is bypassed |
| `enforcement.taskSizeThresholds` | object | See above | File/hour thresholds for small/medium/large classification |

---

## execution

Controls task execution behavior including iteration limits and the self-completing loop system.

**Config path**: `execution`

```json
{
  "execution": {
    "maxIterations": 20,
    "stuckThreshold": 3,
    "progressCommitInterval": 3,
    "recheckAfterFix": true,
    "blockExitUntilComplete": true,
    "autoInferVerification": true,
    "maxRetries": 5,
    "requireSpecVerification": true,
    "specVerification": {
      "validateSyntax": true,
      "allowSkipWithFlag": true,
      "parsePatterns": ["tables", "code-blocks", "lists"]
    },
    "loops": {
      "enabled": false,
      "enforced": true,
      "requireVerification": true,
      "blockOnSkip": true,
      "commitEvery": 3,
      "pauseBetweenScenarios": false,
      "fallbackToManual": true,
      "simpleMode": { "enabled": false },
      "recheckAllAfterFix": true,
      "regressionOnRecheck": "warn"
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `execution.maxIterations` | number | `20` | Max fix-verify iterations before giving up |
| `execution.stuckThreshold` | number | `3` | Iterations without progress before escalating |
| `execution.progressCommitInterval` | number | `3` | Commit progress every N iterations |
| `execution.recheckAfterFix` | boolean | `true` | Re-run verification after applying a fix |
| `execution.blockExitUntilComplete` | boolean | `true` | Prevent task completion until all criteria pass |
| `execution.autoInferVerification` | boolean | `true` | Auto-detect verification commands from task context |
| `execution.maxRetries` | number | `5` | Max retries for failed operations |
| `execution.requireSpecVerification` | boolean | `true` | Validate spec structure before proceeding |

### execution.loops

The self-completing loop system that iterates fix-verify until all acceptance criteria pass.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `execution.loops.enabled` | boolean | `false` | Enable self-completing loops |
| `execution.loops.enforced` | boolean | `true` | Block task completion if loop not run |
| `execution.loops.requireVerification` | boolean | `true` | Must verify each criterion |
| `execution.loops.blockOnSkip` | boolean | `true` | Block completion if any criterion skipped |
| `execution.loops.commitEvery` | number | `3` | Auto-commit progress every N iterations |
| `execution.loops.recheckAllAfterFix` | boolean | `true` | Re-check all criteria after any fix |
| `execution.loops.regressionOnRecheck` | string | `"warn"` | Action on regression: `"warn"`, `"block"`, `"ignore"` |

---

## errorRecovery

Hierarchical error analysis and fix suggestion system.

**Config path**: `errorRecovery`

```json
{
  "errorRecovery": {
    "enabled": false,
    "hierarchicalAnalysis": true,
    "autoSuggestFixes": true,
    "trackSuccessfulStrategies": true,
    "maxAttemptsPerLevel": 3,
    "architecturalReassessment": { "enabled": false },
    "recursive": { "enabled": false },
    "hypothesisGeneration": {
      "usePatterns": true,
      "useAI": false,
      "aiModel": "haiku"
    },
    "learning": {
      "recordSuccessfulFixes": true,
      "recordFailedHypotheses": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `errorRecovery.enabled` | boolean | `false` | Enable error recovery system |
| `errorRecovery.hierarchicalAnalysis` | boolean | `true` | Analyze errors at multiple levels |
| `errorRecovery.autoSuggestFixes` | boolean | `true` | Auto-suggest fixes for known error patterns |
| `errorRecovery.maxAttemptsPerLevel` | number | `3` | Max fix attempts per analysis level |
| `errorRecovery.hypothesisGeneration.useAI` | boolean | `false` | Use AI model for hypothesis generation |
| `errorRecovery.learning.recordSuccessfulFixes` | boolean | `true` | Record successful fix strategies |

---

## workflow

High-level workflow configuration.

**Config path**: `workflow`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `workflow.planningStyle` | string | `"feature-based"` | Planning style: `"feature-based"`, `"sprint-based"` |
| `workflow.agentStructure` | string | `"unified"` | Agent structure: `"unified"`, `"multi-agent"` |

---

## parallelExecution

Concurrent task execution and bulk orchestration.

**Config path**: `parallelExecution`

```json
{
  "parallelExecution": {
    "taskQueue": { "enabled": false },
    "parallel": { "enabled": false },
    "bulkOrchestrator": {
      "enabled": false,
      "parallelLimit": 3,
      "useWorktrees": true,
      "onFailure": "stop-dependent",
      "summaryDepth": "standard",
      "continuous": { "enabled": false }
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `parallelExecution.taskQueue.enabled` | boolean | `false` | Enable task queue |
| `parallelExecution.parallel.enabled` | boolean | `false` | Enable parallel execution |
| `parallelExecution.bulkOrchestrator.enabled` | boolean | `false` | Enable bulk orchestrator |
| `parallelExecution.bulkOrchestrator.parallelLimit` | number | `3` | Max concurrent tasks |
| `parallelExecution.bulkOrchestrator.useWorktrees` | boolean | `true` | Use git worktrees for isolation |
| `parallelExecution.bulkOrchestrator.onFailure` | string | `"stop-dependent"` | Failure mode: `"stop-dependent"`, `"stop-all"`, `"continue"` |

---

## durableSteps

Crash recovery — resume interrupted tasks from last checkpoint.

**Config path**: `durableSteps`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `durableSteps.enabled` | boolean | `false` | Enable durable step tracking |

---

## suspension

Handle long-running tasks that exceed context windows.

**Config path**: `suspension`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `suspension.enabled` | boolean | `false` | Enable task suspension |

---

## capture

Request capture and grouping system.

**Config path**: `capture`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `capture.autoGroup` | boolean | `true` | Auto-group related requests |
| `capture.groupingThreshold` | number | `0.5` | Similarity threshold for grouping |
| `capture.maxGroupSize` | number | `5` | Max requests per group |
| `capture.routing.enabled` | boolean | `false` | Enable request routing |

---

## phases

Project phase tracking (e.g., MVP, Beta, Production).

**Config path**: `phases`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `phases.enabled` | boolean | `false` | Enable phase tracking |

---

## mandatorySteps

Steps that MUST run at specific lifecycle points.

**Config path**: `mandatorySteps`

```json
{
  "mandatorySteps": {
    "afterTask": [],
    "beforeCommit": [],
    "onSessionEnd": ["updateRequestLog", "updateAppMap"]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mandatorySteps.afterTask` | string[] | `[]` | Steps to run after each task |
| `mandatorySteps.beforeCommit` | string[] | `[]` | Steps to run before commits |
| `mandatorySteps.onSessionEnd` | string[] | `["updateRequestLog", "updateAppMap"]` | Steps to run on session end |

---

## priorities

Task priority management.

**Config path**: `priorities`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `priorities.defaultPriority` | string | `"P2"` | Default priority for new tasks |
| `priorities.autoBoostDays` | number | `2` | Days before auto-boosting priority |
| `priorities.autoBoostAmount` | number | `1` | Priority levels to boost |

---

## storyDecomposition

Automatic story breakdown into sub-tasks.

**Config path**: `storyDecomposition`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storyDecomposition.autoDetect` | boolean | `true` | Auto-detect when stories need decomposition |
| `storyDecomposition.autoDecompose` | boolean | `false` | Auto-decompose without asking |
| `storyDecomposition.complexityThreshold` | string | `"medium"` | Threshold for auto-decomposition |
| `storyDecomposition.minSubTasks` | number | `5` | Minimum sub-tasks when decomposing |
| `storyDecomposition.edgeCases` | boolean | `true` | Include edge case sub-tasks |
| `storyDecomposition.loadingStates` | boolean | `true` | Include loading state sub-tasks |
| `storyDecomposition.errorStates` | boolean | `true` | Include error state sub-tasks |
| `storyDecomposition.supportEpics` | boolean | `true` | Support epic-level decomposition |
| `storyDecomposition.propagateProgress` | boolean | `true` | Propagate sub-task progress to parent |

---

## qualityGates

Per-task-type quality requirements that must pass before task completion.

**Config path**: `qualityGates`

```json
{
  "qualityGates": {
    "preTaskBaseline": { "enabled": false },
    "feature": {
      "require": ["loopComplete", "tests", "registryUpdate", "requestLogEntry", "integrationWiring", "standardsCompliance"],
      "optional": ["review", "docs", "webmcpVerification"]
    },
    "bugfix": {
      "require": ["loopComplete", "tests", "requestLogEntry", "standardsCompliance", "learningEnforcement", "resolutionPopulated"],
      "optional": ["review", "webmcpVerification"]
    },
    "refactor": {
      "require": ["loopComplete", "tests", "noNewFeatures", "smokeTest", "standardsCompliance"],
      "optional": ["review", "webmcpVerification"]
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `qualityGates.preTaskBaseline.enabled` | boolean | `false` | Capture baseline metrics before task starts |
| `qualityGates.feature.require` | string[] | See above | Required gates for feature tasks |
| `qualityGates.feature.optional` | string[] | See above | Optional gates for feature tasks |
| `qualityGates.bugfix.require` | string[] | See above | Required gates for bugfix tasks |
| `qualityGates.refactor.require` | string[] | See above | Required gates for refactor tasks |

Available gate values: `loopComplete`, `tests`, `registryUpdate`, `requestLogEntry`, `integrationWiring`, `standardsCompliance`, `learningEnforcement`, `resolutionPopulated`, `noNewFeatures`, `smokeTest`, `review`, `docs`, `webmcpVerification`.

---

## standardsCompliance

Enforce coding standards from decisions.md during task execution.

**Config path**: `standardsCompliance`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `standardsCompliance.enabled` | boolean | `false` | Enable standards compliance checking |
| `standardsCompliance.mode` | string | `"block"` | Mode: `"block"`, `"warn"`, `"log"` |
| `standardsCompliance.scopeByTaskType` | boolean | `true` | Only check relevant standards per task type |
| `standardsCompliance.alwaysCheck` | string[] | `["naming", "security"]` | Standards to always check |
| `standardsCompliance.similarityThreshold` | number | `0.8` | Threshold for pattern matching |
| `standardsCompliance.learning.enabled` | boolean | `false` | Learn from compliance results |

---

## validation

Auto-validation after file edits and task completion.

**Config path**: `validation`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `validation.afterFileEdit.enabled` | boolean | `false` | Run lint/typecheck after every file edit |
| `validation.afterTaskComplete.enabled` | boolean | `false` | Run full validation after task completion |
| `validation.beforeCommit.enabled` | boolean | `false` | Run validation before commits |

---

## tdd

Test-driven development enforcement.

**Config path**: `tdd`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tdd.enforced` | boolean | `true` | Enforce TDD workflow |
| `tdd.defaultForTypes` | string[] | `["bugfix"]` | Task types that default to TDD |
| `tdd.requireFailingTestFirst` | boolean | `true` | Require a failing test before implementation |
| `tdd.testFrameworkDetection` | boolean | `true` | Auto-detect test framework |

---

## specificationMode

Spec-first development — require specifications before implementation.

**Config path**: `specificationMode`

```json
{
  "specificationMode": {
    "enabled": false,
    "mandatory": true,
    "mandatoryFor": ["medium", "large"],
    "skipFor": ["small", "bugfix"],
    "requireApproval": true,
    "specDirectory": ".workflow/specs",
    "template": "default",
    "sections": {
      "acceptanceCriteria": true,
      "implementationSteps": true,
      "filesToChange": true,
      "testStrategy": true,
      "verificationCommands": true,
      "rollbackPlan": false
    },
    "autoDetectFiles": true,
    "autoSuggestTests": true,
    "needsClarification": { "enabled": false }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `specificationMode.enabled` | boolean | `false` | Enable spec-first mode |
| `specificationMode.mandatory` | boolean | `true` | Make specs mandatory (when enabled) |
| `specificationMode.mandatoryFor` | string[] | `["medium", "large"]` | Task sizes requiring specs |
| `specificationMode.skipFor` | string[] | `["small", "bugfix"]` | Task types that skip specs |
| `specificationMode.requireApproval` | boolean | `true` | Require user approval of specs |
| `specificationMode.specDirectory` | string | `".workflow/specs"` | Directory for spec files |
| `specificationMode.sections.*` | boolean | varies | Toggle individual spec sections |

---

## skills

Skill system configuration — installed skills, auto-invocation, content loading.

**Config path**: `skills`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `skills.installed` | string[] | `[]` | List of installed skill names |
| `skills.autoInvoke` | boolean | `true` | Auto-invoke matching skills |
| `skills.autoDiscoverNested` | boolean | `true` | Discover skills in subdirectories |
| `skills.minRelevanceScore` | number | `2` | Minimum score to invoke a skill |
| `skills.autoFetchDocs` | boolean | `true` | Auto-fetch library docs for skills |
| `skills.contentPriority` | string[] | See config | Order of content file loading |
| `skills.loadPatterns` | boolean | `true` | Load patterns.md from skill |
| `skills.loadAntiPatterns` | boolean | `true` | Load anti-patterns.md from skill |
| `skills.loadLearnings` | boolean | `true` | Load learnings.md from skill |
| `skills.loadLibraryReference` | boolean | `true` | Load library-reference.md from skill |
| `skills.loadConventions` | boolean | `true` | Load conventions.md from skill |

---

## learning

Learning system — session learning, cross-session persistence, knowledge routing.

**Config path**: `learning`

```json
{
  "learning": {
    "autoPromoteEnabled": false,
    "requireUserConfirmation": true,
    "session": { "enabled": false },
    "crossSession": { "enabled": false },
    "knowledgeRouting": {
      "autoDetect": true,
      "confirmWithUser": true,
      "defaultScope": "local",
      "modelSpecificLearning": true
    },
    "modelAdapters": { "enabled": false },
    "skill": { "enabled": false }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `learning.autoPromoteEnabled` | boolean | `false` | Auto-promote patterns to decisions.md |
| `learning.requireUserConfirmation` | boolean | `true` | Require user confirmation for promotions |
| `learning.session.enabled` | boolean | `false` | Enable session-scoped learning |
| `learning.crossSession.enabled` | boolean | `false` | Enable cross-session learning persistence |
| `learning.knowledgeRouting.autoDetect` | boolean | `true` | Auto-detect knowledge category |
| `learning.knowledgeRouting.defaultScope` | string | `"local"` | Default scope: `"local"`, `"global"`, `"skill"` |
| `learning.knowledgeRouting.modelSpecificLearning` | boolean | `true` | Learn model-specific preferences |
| `learning.modelAdapters.enabled` | boolean | `false` | Enable model adapter learning |
| `learning.skill.enabled` | boolean | `false` | Enable per-skill learning |

---

## memory

Semantic memory system — local vector DB for fact storage and retrieval.

**Config path**: `memory`

```json
{
  "memory": {
    "level": "off",
    "enabled": false,
    "localDb": ".workflow/memory/local.db",
    "embeddingModel": "Xenova/all-MiniLM-L6-v2",
    "maxLocalFacts": 1000,
    "autoRemember": false,
    "automatic": {
      "enabled": false,
      "entropyThreshold": 0.7,
      "compactOnSessionEnd": true,
      "relevanceDecay": { "enabled": false },
      "demotion": { "relevanceThreshold": 0.3, "coldRetentionDays": 90 },
      "selfTuning": { "enabled": false },
      "observationCapture": { "enabled": false },
      "observationExtraction": { "enabled": false }
    },
    "promotion": { "enabled": false }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `memory.level` | string | `"off"` | Memory level: `"off"`, `"session"`, `"persistent"` |
| `memory.enabled` | boolean | `false` | Enable semantic memory |
| `memory.localDb` | string | `".workflow/memory/local.db"` | Path to local vector database |
| `memory.embeddingModel` | string | `"Xenova/all-MiniLM-L6-v2"` | Embedding model for vectors |
| `memory.maxLocalFacts` | number | `1000` | Max facts in local DB |
| `memory.autoRemember` | boolean | `false` | Auto-remember important facts |
| `memory.automatic.enabled` | boolean | `false` | Enable automatic memory management |
| `memory.automatic.entropyThreshold` | number | `0.7` | Information entropy threshold |
| `memory.promotion.enabled` | boolean | `false` | Enable fact promotion across scopes |

---

## context.auto

Auto-context loading — automatically load relevant files before task execution.

**Config path**: `context.auto`

```json
{
  "context": {
    "auto": {
      "enabled": false,
      "strategy": "dynamic",
      "showLoadedFiles": true,
      "includeContent": true,
      "useSectionReferences": true,
      "maxFilesToLoad": 10,
      "maxGrepResults": 10,
      "maxComponentMatches": 15,
      "maxContentLines": 50,
      "useAstGrep": false,
      "maxSemanticFacts": 5,
      "semanticMinRelevance": 40,
      "fallbackLimits": {
        "maxFilesHard": 50,
        "maxTokensHard": 150000
      },
      "lspEnrichment": { "enabled": false }
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.auto.enabled` | boolean | `false` | Enable auto-context loading |
| `context.auto.strategy` | string | `"dynamic"` | Strategy: `"dynamic"`, `"static"`, `"hybrid"` |
| `context.auto.showLoadedFiles` | boolean | `true` | Show which files were auto-loaded |
| `context.auto.includeContent` | boolean | `true` | Include file content (not just paths) |
| `context.auto.useSectionReferences` | boolean | `true` | Use PIN section references |
| `context.auto.maxFilesToLoad` | number | `10` | Max files to auto-load |
| `context.auto.maxContentLines` | number | `50` | Max lines per loaded file |
| `context.auto.useAstGrep` | boolean | `false` | Use AST-based grep for context |
| `context.auto.maxSemanticFacts` | number | `5` | Max semantic memory facts to inject |

---

## context.smart

Smart context estimation — predict context usage before task execution.

**Config path**: `context.smart`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.smart.enabled` | boolean | `true` | Enable smart context estimation |
| `context.smart.safeThreshold` | number | `0.95` | Context usage threshold for safe tasks |
| `context.smart.emergencyThreshold` | number | `0.9` | Emergency context threshold |
| `context.smart.estimation.perFile` | number | `0.02` | Estimated context per file (fraction) |
| `context.smart.estimation.perCriterion` | number | `0.03` | Estimated context per criterion |
| `context.smart.estimation.refactorBuffer` | number | `0.1` | Extra buffer for refactoring tasks |

---

## context.compaction

Context compaction — compress context when approaching limits.

**Config path**: `context.compaction`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.compaction.enabled` | boolean | `false` | Enable context compaction |
| `context.compaction.thresholds.warnAt` | number | `50000` | Warn at this token count |
| `context.compaction.thresholds.compactAt` | number | `80000` | Auto-compact at this token count |
| `context.compaction.autoCleanup` | boolean | `true` | Auto-clean expired context |

---

## context.monitor

Context usage monitoring.

**Config path**: `context.monitor`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.monitor.enabled` | boolean | `false` | Enable context monitoring |

---

## context.session

Session-scoped context state.

**Config path**: `context.session`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.session.enabled` | boolean | `false` | Enable session context tracking |

---

## context.proactive

Proactive context loading during specific task phases.

**Config path**: `context.proactive`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.proactive.enabled` | boolean | `true` | Enable proactive context loading |
| `context.proactive.triggerThreshold` | number | `0.75` | Context threshold to trigger proactive loading |
| `context.proactive.useHaiku` | boolean | `true` | Use Haiku model for proactive context |
| `context.proactive.phases` | string[] | See config | Phases where proactive loading is active |

---

## models.hybrid

Hybrid model execution — delegate tasks to cheaper/faster models.

**Config path**: `models.hybrid`

```json
{
  "models": {
    "hybrid": {
      "enabled": true,
      "executor": {
        "type": "local",
        "provider": null,
        "model": null,
        "useFullContext": true
      },
      "planner": {
        "adaptToExecutor": true,
        "useAdapterKnowledge": true
      },
      "settings": {
        "temperature": 0.7,
        "maxRetries": 20,
        "timeout": 120000,
        "autoExecute": false,
        "outputReserveRatio": 0.3
      },
      "routing": {
        "enabled": true,
        "rules": [
          { "taskType": "simple-edit", "model": "cheapest" },
          { "taskType": "code-generation", "model": "mid-tier" },
          { "taskType": "refactoring", "model": "planner" },
          { "taskType": "documentation", "model": "cheapest" }
        ]
      }
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `models.hybrid.enabled` | boolean | `true` | Enable hybrid model execution |
| `models.hybrid.executor.type` | string | `"local"` | Executor type: `"local"`, `"api"` |
| `models.hybrid.executor.provider` | string | `null` | API provider name |
| `models.hybrid.executor.model` | string | `null` | Specific model to use |
| `models.hybrid.executor.useFullContext` | boolean | `true` | Pass full context to executor |
| `models.hybrid.planner.adaptToExecutor` | boolean | `true` | Adapt prompts for executor model |
| `models.hybrid.settings.temperature` | number | `0.7` | Temperature for executor model |
| `models.hybrid.settings.maxRetries` | number | `20` | Max retries on failure |
| `models.hybrid.settings.autoExecute` | boolean | `false` | Auto-execute without approval |
| `models.hybrid.routing.enabled` | boolean | `true` | Enable task-based model routing |

---

## models.multiModel

Multi-model routing with fallback and escalation.

**Config path**: `models.multiModel`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `models.multiModel.enabled` | boolean | `false` | Enable multi-model routing |
| `models.multiModel.routingStrategy` | string | `"quality-first"` | Strategy: `"quality-first"`, `"cost-optimized"`, `"learned"` |
| `models.multiModel.fallbackEnabled` | boolean | `true` | Enable fallback to higher-capability model |
| `models.multiModel.maxEscalations` | number | `2` | Max model escalations per task |

---

## models.cascade

Model cascade configuration.

**Config path**: `models.cascade`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `models.cascade.enabled` | boolean | `false` | Enable model cascade |

---

## commits

Commit behavior and approval settings.

**Config path**: `commits`

```json
{
  "commits": {
    "requireApproval": {
      "feature": true,
      "bugfix": false,
      "refactor": true,
      "docs": false
    },
    "autoCommitSmallFixes": true,
    "smallFixThreshold": 3,
    "squashTaskCommits": true,
    "commitMessageFormat": "conventional"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `commits.requireApproval.feature` | boolean | `true` | Ask before committing features |
| `commits.requireApproval.bugfix` | boolean | `false` | Ask before committing bugfixes |
| `commits.requireApproval.refactor` | boolean | `true` | Ask before committing refactors |
| `commits.requireApproval.docs` | boolean | `false` | Ask before committing docs |
| `commits.autoCommitSmallFixes` | boolean | `true` | Auto-commit small fixes |
| `commits.smallFixThreshold` | number | `3` | Max files for "small fix" |
| `commits.squashTaskCommits` | boolean | `true` | Squash commits per task |
| `commits.commitMessageFormat` | string | `"conventional"` | Format: `"conventional"`, `"descriptive"` |

---

## security

Security scanning configuration.

**Config path**: `security`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `security.scanBeforeCommit` | boolean | `true` | Run security scan before commits |
| `security.blockOnHigh` | boolean | `true` | Block commit on high-severity findings |
| `security.checkPatterns.secrets` | boolean | `true` | Check for leaked secrets |
| `security.checkPatterns.injection` | boolean | `true` | Check for injection vulnerabilities |
| `security.checkPatterns.npmAudit` | boolean | `true` | Run npm audit |
| `security.ignoreFiles` | string[] | `["*.test.ts", "*.spec.ts"]` | Files to skip in scans |

---

## damageControl

Prevent destructive operations (dangerous shell commands, mass file deletion).

**Config path**: `damageControl`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `damageControl.enabled` | boolean | `false` | Enable damage control |
| `damageControl.patternsFile` | string | `".workflow/damage-control.yaml"` | Path to patterns file |
| `damageControl.events.bash` | boolean | `true` | Monitor bash commands |
| `damageControl.events.file` | boolean | `true` | Monitor file operations |
| `damageControl.events.stop` | boolean | `true` | Block dangerous operations |
| `damageControl.onBlock` | string | `"error"` | Action on block: `"error"`, `"warn"` |
| `damageControl.logging` | boolean | `true` | Log damage control events |

---

## hooks

Hook system — PreToolUse, PostToolUse, and lifecycle hooks.

**Config path**: `hooks`

```json
{
  "hooks": {
    "enabled": false,
    "targets": ["claude-code"],
    "gracefulDegradation": true,
    "timeout": 600000,
    "rules": {
      "enforcement": {
        "taskGating": { "enabled": false, "blockWithoutTask": true },
        "scopeGating": { "enabled": false, "mode": "warn" },
        "implementationGate": { "enabled": false },
        "routingGate": { "enabled": false },
        "loopEnforcement": { "enabled": false }
      },
      "intelligence": {
        "componentReuse": { "enabled": false, "threshold": 30, "blockOnSimilar": false },
        "sessionContext": { "enabled": false },
        "validation": { "enabled": false, "runAfterEdit": true }
      },
      "lifecycle": {
        "taskCompleted": { "enabled": false },
        "completionSummaries": { "enabled": true },
        "autoLogging": { "enabled": false },
        "setup": { "enabled": false },
        "sessionCleanup": { "enabled": true },
        "phaseGate": { "enabled": true }
      }
    },
    "claudeCode": {
      "installPath": ".claude/settings.local.json"
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hooks.enabled` | boolean | `false` | Enable the hook system |
| `hooks.targets` | string[] | `["claude-code"]` | CLI targets to install hooks for |
| `hooks.gracefulDegradation` | boolean | `true` | Continue on hook errors |
| `hooks.timeout` | number | `600000` | Hook timeout in ms |
| `hooks.rules.enforcement.taskGating.enabled` | boolean | `false` | Block file edits without active task |
| `hooks.rules.enforcement.scopeGating.enabled` | boolean | `false` | Block edits outside task scope |
| `hooks.rules.intelligence.componentReuse.enabled` | boolean | `false` | Check for reusable components |
| `hooks.rules.intelligence.componentReuse.threshold` | number | `30` | Similarity threshold (0-100) |
| `hooks.rules.intelligence.validation.enabled` | boolean | `false` | Auto-validate after edits |
| `hooks.rules.lifecycle.taskCompleted.enabled` | boolean | `false` | Hook on task completion |
| `hooks.rules.lifecycle.completionSummaries.enabled` | boolean | `true` | Show completion summaries |
| `hooks.claudeCode.installPath` | string | `".claude/settings.local.json"` | Path for hook installation |

---

## review

Code review system configuration.

**Config path**: `review`

```json
{
  "review": {
    "specFirstGating": true,
    "minFindings": 3,
    "requireJustificationIfClean": true,
    "gitVerifiedClaims": { "enabled": false },
    "multiPass": { "enabled": false },
    "fix": {
      "persistUnfixed": true,
      "severityRouting": {
        "criticalHighRoute": "full",
        "mediumLowRoute": "light"
      },
      "contextBudget": {
        "enabled": true,
        "useSubAgents": true
      }
    },
    "peer": { "enabled": false },
    "triage": { "enabled": false }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `review.specFirstGating` | boolean | `true` | Require spec review before code review |
| `review.minFindings` | number | `3` | Minimum findings expected per review |
| `review.requireJustificationIfClean` | boolean | `true` | Require explanation if no findings |
| `review.multiPass.enabled` | boolean | `false` | Enable multi-pass review |
| `review.fix.persistUnfixed` | boolean | `true` | Save unfixed findings for later |
| `review.fix.contextBudget.enabled` | boolean | `true` | Enable context budget for fix operations |
| `review.fix.contextBudget.useSubAgents` | boolean | `true` | Use sub-agents for parallel fixes |
| `review.peer.enabled` | boolean | `false` | Enable peer review workflow |
| `review.triage.enabled` | boolean | `false` | Enable review triage workflow |

---

## bugFlow

Bug investigation flow — structured debugging with investigation agents.

**Config path**: `bugFlow`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bugFlow.investigationAgents.errorSourceFinder.enabled` | boolean | `false` | Enable error source finder agent |
| `bugFlow.investigationAgents.patternChecker.enabled` | boolean | `false` | Enable pattern checker agent |
| `bugFlow.investigationAgents.dependencyAnalyzer.enabled` | boolean | `false` | Enable dependency analyzer agent |
| `bugFlow.autoRoute` | boolean | `true` | Auto-route bugs to investigation agents |
| `bugFlow.learningEnforcement.enabled` | boolean | `false` | Enforce learning from bug resolutions |
| `bugFlow.inlineDiscovery.maxSearchOperations` | number | `3` | Max search operations for inline discovery |

---

## longInputGate

Long input processing — handle transcripts, specs, and large text inputs.

**Config path**: `longInputGate`

```json
{
  "longInputGate": {
    "enabled": true,
    "charThreshold": 3000,
    "lineThreshold": 60,
    "smartDefault": true,
    "contentRules": {
      "transcript": "full",
      "spec": "full",
      "requirements": "full",
      "code": "skip",
      "default": "quick"
    },
    "autoTriggerTypes": ["transcript", "specs", "requirements", "feature-request"],
    "chunkingThreshold": 10000,
    "chunkSize": 5000,
    "chunkOverlap": 500
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `longInputGate.enabled` | boolean | `true` | Enable long input gate |
| `longInputGate.charThreshold` | number | `3000` | Character count to trigger gate |
| `longInputGate.lineThreshold` | number | `60` | Line count to trigger gate |
| `longInputGate.smartDefault` | boolean | `true` | Smart default processing mode |
| `longInputGate.contentRules.*` | string | varies | Per-content-type rule: `"full"`, `"quick"`, `"skip"` |
| `longInputGate.autoTriggerTypes` | string[] | See above | Content types that auto-trigger |
| `longInputGate.chunkingThreshold` | number | `10000` | Chars before chunking kicks in |
| `longInputGate.chunkSize` | number | `5000` | Size of each chunk |
| `longInputGate.outputLanguage` | string | `"en"` | Output language for processing |

---

## techDebt

Tech debt tracking and management.

**Config path**: `techDebt`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `techDebt.enabled` | boolean | `false` | Enable tech debt tracking |
| `techDebt.promptOnSessionEnd` | boolean | `true` | Prompt to log tech debt at session end |
| `techDebt.showInMorningBriefing` | boolean | `true` | Show tech debt in morning briefing |
| `techDebt.agingThreshold` | number | `3` | Days before debt is considered aged |
| `techDebt.autoFix.enabled` | boolean | `false` | Auto-fix simple tech debt |
| `techDebt.debtBudget.enabled` | boolean | `false` | Enable debt budget per sprint |

---

## finalization

Branch finalization — merge, PR creation, or discard.

**Config path**: `finalization`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `finalization.enabled` | boolean | `true` | Enable branch finalization |
| `finalization.defaultAction` | string | `"ask"` | Default: `"ask"`, `"merge"`, `"pr"`, `"discard"` |
| `finalization.autoMergeForTypes` | string[] | `["bugfix", "quick-fix"]` | Task types that auto-merge |
| `finalization.requirePRForTypes` | string[] | `[]` | Task types requiring PRs |
| `finalization.squashOnMerge` | boolean | `true` | Squash commits on merge |
| `finalization.prTemplate.includeTaskSpec` | boolean | `true` | Include task spec in PR |
| `finalization.prTemplate.includeCommitList` | boolean | `true` | Include commit list in PR |

---

## research

Research verification system — verify claims with citations.

**Config path**: `research`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `research.enabled` | boolean | `false` | Enable research system |
| `research.defaultDepth` | string | `"standard"` | Depth: `"quick"`, `"standard"`, `"deep"`, `"exhaustive"` |
| `research.autoTrigger` | boolean | `true` | Auto-trigger research for relevant tasks |
| `research.requireVerificationFormat` | boolean | `true` | Require structured verification format |
| `research.requireCitations` | boolean | `true` | Require citations for claims |
| `research.cacheVerifications` | boolean | `true` | Cache verification results |
| `research.budgetMode` | string | `"soft"` | Budget mode: `"soft"`, `"hard"` |

---

## audit

Project-wide audit system with multi-agent analysis.

**Config path**: `audit`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `audit.agents.architecture` | boolean | `true` | Enable architecture analysis |
| `audit.agents.dependencies` | boolean | `true` | Enable dependency analysis |
| `audit.agents.duplication` | boolean | `true` | Enable duplication detection |
| `audit.agents.performance` | boolean | `true` | Enable performance analysis |
| `audit.agents.consistency` | boolean | `true` | Enable consistency analysis |
| `audit.agents.modernization` | boolean | `true` | Enable modernization analysis |
| `audit.agents.techDebt` | boolean | `true` | Enable tech debt analysis |
| `audit.scoring.enabled` | boolean | `true` | Enable audit scoring |
| `audit.maxFilesPerAgent` | number | `100` | Max files per audit agent |

---

## plugins

Plugin system for MCP tools and extensions.

**Config path**: `plugins`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `plugins.enabled` | boolean | `true` | Enable plugin system |
| `plugins.registryPath` | string | `".workflow/state/plugin-registry.json"` | Plugin registry file |
| `plugins.autoDiscoverMcp` | boolean | `true` | Auto-discover MCP tools |
| `plugins.autoScanOnSessionStart` | boolean | `true` | Scan for plugins at session start |
| `plugins.webSearchFallback` | boolean | `true` | Fall back to web search for unknown tools |
| `plugins.trackPluginActions` | boolean | `true` | Track plugin usage |

---

## Other Top-Level Options

Simple top-level settings that don't need their own section.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `$schema` | string | `"./config.schema.json"` | JSON schema reference |
| `version` | string | `"2.0.0"` | Config schema version |
| `projectName` | string | `""` | Project name |
| `cli.type` | string | `"claude-code"` | CLI type |
| `cli.autoSync.enabled` | boolean | `false` | Auto-sync CLAUDE.md on config change |
| `autoLog` | boolean | `true` | Auto-update request log after changes |
| `autoUpdateAppMap` | boolean | `true` | Auto-update app-map after changes |
| `scripts.lint` | string | `null` | Lint command |
| `scripts.typecheck` | string | `null` | Type check command |
| `scripts.test` | string | `null` | Test command |
| `scripts.build` | string | `null` | Build command |
| `scripts.fix` | string | `null` | Auto-fix command |
| `scripts.coverage` | string | `null` | Coverage command |
| `requireApproval` | string[] | `[]` | Operations requiring approval |
| `regressionTesting.enabled` | boolean | `false` | Enable regression testing |
| `checkpoint.enabled` | boolean | `false` | Enable checkpointing |
| `epics.enabled` | boolean | `false` | Enable epic support |
| `clarifyingQuestions.enabled` | boolean | `false` | Enable clarifying questions |
| `prd.enabled` | boolean | `false` | Enable PRD integration |
| `morningBriefing.enabled` | boolean | `false` | Enable morning briefing |
| `bulkLoop.enabled` | boolean | `false` | Enable bulk loop processing |
| `requestLog.enabled` | boolean | `false` | Enable request log |
| `semanticMatching.enabled` | boolean | `false` | Enable semantic matching |
| `guidedEdit.enabled` | boolean | `false` | Enable guided edit mode |
| `worktree.enabled` | boolean | `false` | Enable git worktree support |
| `lsp.enabled` | boolean | `false` | Enable LSP integration |
| `codebaseInsights.enabled` | boolean | `false` | Enable codebase insights |
| `webmcp.enabled` | boolean | `false` | Enable web MCP verification |
| `consistency.enabled` | boolean | `false` | Enable consistency checking |
| `metrics.enabled` | boolean | `false` | Enable metrics collection |
| `multiApproach.enabled` | boolean | `false` | Enable multi-approach problem solving |
| `gateConfidence.enabled` | boolean | `false` | Enable gate confidence scoring |

---

## Additional Nested Sections

These sections have configuration but are less commonly modified.

### decide
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `decide.requireRationale` | boolean | `true` | Require rationale for decisions |
| `decide.scanForViolations` | boolean | `true` | Scan codebase for violations after decision |
| `decide.maxClarifyingQuestions` | number | `4` | Max questions before deciding |

### retrospective
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retrospective.maxQuestions` | number | `3` | Max retro questions |
| `retrospective.autoSuggestRules` | boolean | `true` | Auto-suggest new rules from retro |
| `retrospective.quickModeDefault` | boolean | `false` | Default to quick retro mode |

### eval
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `eval.judges.opus` | number | `1` | Number of Opus judges |
| `eval.judges.sonnet` | number | `2` | Number of Sonnet judges |
| `eval.passingThreshold` | number | `6` | Minimum passing score |

### bestOfN
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bestOfN.enabled` | boolean | `true` | Enable best-of-N generation |
| `bestOfN.defaultN` | number | `3` | Default candidates to generate |
| `bestOfN.autoSuggestThreshold` | string | `"high"` | When to auto-suggest best-of-N |

### promptTemplates
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `promptTemplates.enabled` | boolean | `true` | Enable prompt templates |
| `promptTemplates.directory` | string | `".workflow/templates/prompts"` | Templates directory |

### corrections
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `corrections.mode` | string | `"inline"` | Mode: `"inline"`, `"file"` |
| `corrections.detailPath` | string | `".workflow/corrections"` | Path for correction details |

### originTaskTracing
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `originTaskTracing.enabled` | boolean | `false` | Enable origin task tracing |
| `originTaskTracing.sameSessionWindow` | string | `"2h"` | Window for same-session detection |

### community
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `community.enabled` | boolean | `false` | Enable community learning |
| `community.serverUrl` | string | `"https://api.wogiflow.com"` | Community server URL |
| `community.pushOnSessionEnd` | boolean | `true` | Push learnings at session end |
| `community.pullOnSessionStart` | boolean | `true` | Pull learnings at session start |

### traces
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `traces.saveTo` | string | `".workflow/traces"` | Trace output directory |
| `traces.generateDiagrams` | boolean | `true` | Generate Mermaid diagrams |

### agents
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agents.enabled` | string[] | See config | Enabled agent personas |
| `agents.optional` | string[] | See config | Optional agent personas |

### componentRules
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `componentRules.preferVariants` | boolean | `true` | Prefer variants over new components |
| `componentRules.requireAppMapEntry` | boolean | `true` | Require app-map entry for new components |
| `componentRules.requireDetailDoc` | boolean | `false` | Require detail docs for components |

### strictMode
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strictMode.verificationChecklist` | boolean | `false` | Show verification checklist |
| `strictMode.correctionReportsOnFail` | boolean | `false` | Generate correction reports on failure |
| `strictMode.featureReportsOnComplete` | boolean | `false` | Generate feature reports on completion |

### decisions
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `decisions.amendmentTracking.enabled` | boolean | `false` | Track decision amendments |

### registries
Array of registry configurations. Each registry has:

| Option | Type | Description |
|--------|------|-------------|
| `registries[].id` | string | Registry identifier (e.g., `"components"`, `"functions"`, `"apis"`) |
| `registries[].enabled` | boolean/string | `true`, `false`, or `"auto"` |
| `registries[].activateWhen` | string | Condition: `"frontend"`, `"backend"`, `"always"`, `"orm"` |
| `registries[].directories` | string[] | Directories to scan |
| `registries[].scanOn` | string[] | When to scan: `"sessionStart"`, `"afterTask"`, `"preCommit"` |

---

## Config Statistics

- **74 top-level keys** with **511 total leaf values**
- Config schema: `config.schema.json` (when available)
- Generated by `npx flow onboard` during project setup
