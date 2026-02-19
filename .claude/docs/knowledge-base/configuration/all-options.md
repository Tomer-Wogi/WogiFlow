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
| [loops](#loops) | Self-completing execution loops |
| [durableSteps](#durablesteps) | Crash recovery |
| [suspension](#suspension) | Long-running task handling |
| [parallel](#parallel) | Concurrent execution |
| [phases](#phases) | Project phase tracking |
| [mandatorySteps](#mandatorysteps) | Required workflow steps |
| [priorities](#priorities) | Task priority levels |
| [storyDecomposition](#storydecomposition) | Story breakdown |

### Category 2: Quality & Validation
| Section | Purpose |
|---------|---------|
| [qualityGates](#qualitygates) | Per-task-type requirements |
| [validation](#validation) | Auto-validation commands |
| [testing](#testing) | Test execution |
| [tdd](#tdd) | Test-first development mode |
| [regressionTesting](#regressiontesting) | Regression checks |
| [componentRules](#componentrules) | Component reuse rules |
| [strictMode](#strictmode) | Additional strict options |
| [review](#review) | Code review settings |
| [needsClarification](#needsclarification) | Spec uncertainty markers |
| [consistency](#consistency) | Cross-artifact validation |

### Category 3: Learning & Memory
| Section | Purpose |
|---------|---------|
| [skills](#skills) | Installed skills |
| [skillLearning](#skilllearning) | Skill auto-creation |
| [memory](#memory) | Fact storage |
| [automaticMemory](#automaticmemory) | Memory management |
| [automaticPromotion](#automaticpromotion) | Pattern promotion |
| [knowledgeRouting](#knowledgerouting) | Knowledge routing |
| [modelAdapters](#modeladapters) | Per-model learning |
| [prd](#prd) | PRD chunking |
| [decisions](#decisions) | Decision amendment tracking |

### Category 4: Context & Session
| Section | Purpose |
|---------|---------|
| [autoContext](#autocontext) | Auto-loading related files |
| [sessionState](#sessionstate) | Session persistence |
| [contextMonitor](#contextmonitor) | Context window management |
| [morningBriefing](#morningbriefing) | Session start context |
| [requestLog](#requestlog) | Change history |

### Category 5: Development Tools
| Section | Purpose |
|---------|---------|
| [componentIndex](#componentindex) | Component scanning |
| [figmaAnalyzer](#figmaanalyzer) | Design-to-code |
| [guidedEdit](#guidededit) | Multi-file editing |
| [traces](#traces) | Code flow traces |
| [worktree](#worktree) | Git worktree isolation |
| [hybrid](#hybrid) | Local LLM execution |
| [lsp](#lsp) | Language server integration |
| [codebaseInsights](#codebaseinsights) | Project analysis |

### Category 6: Safety & Commits
| Section | Purpose |
|---------|---------|
| [commits](#commits) | Commit approval workflow |
| [security](#security) | Pre-commit security scans |
| [damageControl](#damagecontrol) | Destructive command protection |

### Category 7: Integrations
| Section | Purpose |
|---------|---------|
| [agents](#agents) | Agent personas |
| [multiApproach](#multiapproach) | Multiple solution analysis |
| [hooks](#hooks) | CLI hooks (Claude Code, etc.) |
| [metrics](#metrics) | Usage tracking |
| [corrections](#corrections) | Correction file handling |

---

## enforcement

Controls task gating and strict mode behavior.

```json
{
  "enforcement": {
    "strictMode": true,
    "requireTaskForImplementation": true,
    "requireStoryForMediumTasks": true,
    "requirePatternCitation": false,
    "citationFormat": "// Pattern: {pattern}",
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
| `strictMode` | boolean | `true` | Enable strict task gating |
| `requireTaskForImplementation` | boolean | `true` | Require task before coding |
| `requireStoryForMediumTasks` | boolean | `true` | Require story for medium+ tasks |
| `requirePatternCitation` | boolean | `false` | Require citing patterns in code |
| `citationFormat` | string | `"// Pattern: {pattern}"` | Format for pattern citations |
| `taskSizeThresholds.small.maxFiles` | number | `3` | Max files for small task |
| `taskSizeThresholds.small.maxHours` | number | `1` | Max hours for small task |
| `taskSizeThresholds.medium.maxFiles` | number | `10` | Max files for medium task |
| `taskSizeThresholds.medium.maxHours` | number | `4` | Max hours for medium task |
| `taskSizeThresholds.large.minFiles` | number | `10` | Min files for large task |
| `taskSizeThresholds.large.minHours` | number | `4` | Min hours for large task |

---

## commits

Controls commit approval workflow.

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
| `requireApproval.feature` | boolean | `true` | Require approval for features |
| `requireApproval.bugfix` | boolean | `false` | Require approval for bugfixes |
| `requireApproval.refactor` | boolean | `true` | Require approval for refactors |
| `requireApproval.docs` | boolean | `false` | Require approval for docs |
| `autoCommitSmallFixes` | boolean | `true` | Auto-commit small changes |
| `smallFixThreshold` | number | `3` | Max files for "small fix" |
| `squashTaskCommits` | boolean | `true` | Squash commits on task complete |
| `commitMessageFormat` | string | `"conventional"` | `"conventional"` or `"simple"` |

---

## workflow

High-level workflow configuration.

```json
{
  "workflow": {
    "planningStyle": "feature-based",
    "agentStructure": "unified"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `planningStyle` | string | `"feature-based"` | Planning approach |
| `agentStructure` | string | `"unified"` | Agent organization |

---

## loops

Controls self-completing execution loops.

```json
{
  "loops": {
    "enabled": true,
    "enforced": true,
    "blockExitUntilComplete": true,
    "requireVerification": true,
    "blockOnSkip": true,
    "maxRetries": 5,
    "maxIterations": 20,
    "commitEvery": 3,
    "pauseBetweenScenarios": false,
    "autoInferVerification": true,
    "fallbackToManual": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable execution loops |
| `enforced` | boolean | `true` | Enforce loop completion |
| `blockExitUntilComplete` | boolean | `true` | Prevent early exit |
| `requireVerification` | boolean | `true` | Require verification pass |
| `blockOnSkip` | boolean | `true` | Block if scenario skipped |
| `maxRetries` | number | `5` | Max retries per scenario |
| `maxIterations` | number | `20` | Max total loop iterations |
| `commitEvery` | number | `3` | Commit every N scenarios |
| `pauseBetweenScenarios` | boolean | `false` | Pause between scenarios |
| `autoInferVerification` | boolean | `true` | Auto-generate verification steps |
| `fallbackToManual` | boolean | `true` | Fall back to manual on failure |

**Trade-off**: Higher `maxRetries`/`maxIterations` = higher completion rate but more token usage.

---

## durableSteps

Controls crash recovery and session persistence.

```json
{
  "durableSteps": {
    "enabled": true,
    "autoResume": true,
    "checkSuspensionsOnStart": true,
    "defaultMaxAttempts": 5
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable durable sessions |
| `autoResume` | boolean | `true` | Auto-resume interrupted tasks |
| `checkSuspensionsOnStart` | boolean | `true` | Check for suspended tasks |
| `defaultMaxAttempts` | number | `5` | Default retry attempts |

---

## suspension

Controls long-running task handling.

```json
{
  "suspension": {
    "enabled": true,
    "pollIntervalSeconds": 60,
    "maxPollAttempts": 120,
    "reminderAfterHours": 24
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable suspend/resume |
| `pollIntervalSeconds` | number | `60` | Polling interval for conditions |
| `maxPollAttempts` | number | `120` | Max poll attempts before timeout |
| `reminderAfterHours` | number | `24` | Hours before reminder |

---

## parallel

Controls concurrent task execution.

```json
{
  "parallel": {
    "enabled": true,
    "maxConcurrent": 3,
    "autoApprove": false,
    "requireWorktree": true,
    "showProgress": true,
    "autoDetect": true,
    "autoSuggest": true,
    "autoExecute": false,
    "minTasksForParallel": 2
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable parallel execution |
| `maxConcurrent` | number | `3` | Max concurrent tasks |
| `autoApprove` | boolean | `false` | Auto-approve parallel work |
| `requireWorktree` | boolean | `true` | Require git worktree isolation |
| `showProgress` | boolean | `true` | Show progress indicators |
| `autoDetect` | boolean | `true` | Auto-detect parallelizable tasks |
| `autoSuggest` | boolean | `true` | Suggest parallel execution |
| `autoExecute` | boolean | `false` | Auto-execute in parallel |
| `minTasksForParallel` | number | `2` | Min tasks for parallel mode |

---

## corrections

Controls correction file handling.

```json
{
  "corrections": {
    "mode": "inline",
    "detailPath": ".workflow/corrections"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | string | `"inline"` | `"inline"` or `"detailed"` |
| `detailPath` | string | `".workflow/corrections"` | Path for detailed corrections |

---

## phases

Controls project phases (disabled by default).

```json
{
  "phases": {
    "enabled": false,
    "definitions": []
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable phase tracking |
| `definitions` | array | `[]` | Phase definitions |

---

## mandatorySteps

Required steps at various points.

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
| `afterTask` | array | `[]` | Steps after each task |
| `beforeCommit` | array | `[]` | Steps before commit |
| `onSessionEnd` | array | `["updateRequestLog", "updateAppMap"]` | Steps on session end |

---

## qualityGates

Per-task-type quality requirements.

```json
{
  "qualityGates": {
    "feature": {
      "require": ["loopComplete", "tests", "appMapUpdate", "requestLogEntry"],
      "optional": ["review", "docs"]
    },
    "bugfix": {
      "require": ["loopComplete", "tests", "requestLogEntry"],
      "optional": ["review"]
    },
    "refactor": {
      "require": ["loopComplete", "tests", "noNewFeatures"],
      "optional": ["review"]
    }
  }
}
```

| Gate | Description |
|------|-------------|
| `loopComplete` | Self-completing loop must finish all acceptance criteria |
| `tests` | Tests must pass |
| `appMapUpdate` | App-map must be updated |
| `requestLogEntry` | Request log must be updated |
| `review` | Code review required |
| `docs` | Documentation required |
| `noNewFeatures` | No new features (refactor only) |

---

## strictMode

Additional strict mode options.

```json
{
  "strictMode": {
    "verificationChecklist": false,
    "correctionReportsOnFail": false,
    "featureReportsOnComplete": false
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `verificationChecklist` | boolean | `false` | Require verification checklist |
| `correctionReportsOnFail` | boolean | `false` | Generate correction reports |
| `featureReportsOnComplete` | boolean | `false` | Generate feature reports |

---

## componentRules

Component reuse and creation rules.

```json
{
  "componentRules": {
    "preferVariants": true,
    "requireAppMapEntry": true,
    "requireDetailDoc": false,
    "autoGenerateStorybook": false,
    "storybookPath": "src/stories"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `preferVariants` | boolean | `true` | Prefer variants over new components |
| `requireAppMapEntry` | boolean | `true` | Require app-map entry for new components |
| `requireDetailDoc` | boolean | `false` | Require detailed documentation |
| `autoGenerateStorybook` | boolean | `false` | Auto-generate Storybook stories |
| `storybookPath` | string | `"src/stories"` | Path for Storybook stories |

---

## testing

Test execution configuration.

```json
{
  "testing": {
    "runAfterTask": false,
    "runBeforeCommit": false
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runAfterTask` | boolean | `false` | Run tests after task |
| `runBeforeCommit` | boolean | `false` | Run tests before commit |

---

## hooks

CLI hooks configuration for Claude Code.

```json
{
  "hooks": {
    "enabled": true,
    "targets": ["claude-code"],
    "gracefulDegradation": true,
    "timeout": 5000,
    "rules": {
      "taskGating": { "enabled": true, "blockWithoutTask": true },
      "validation": { "enabled": true, "runAfterEdit": true },
      "loopEnforcement": { "enabled": true },
      "componentReuse": { "enabled": true, "threshold": 80, "blockOnSimilar": false },
      "sessionContext": { "enabled": true, "loadSuspendedTasks": true },
      "autoLogging": { "enabled": true }
    },
    "claudeCode": {
      "installPath": ".claude/settings.local.json"
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable CLI hooks |
| `targets` | array | `["claude-code"]` | Target CLIs for hooks |
| `gracefulDegradation` | boolean | `true` | Continue on hook failure |
| `timeout` | number | `5000` | Hook timeout in ms |
| `rules.taskGating.enabled` | boolean | `true` | Enable task gating hook |
| `rules.taskGating.blockWithoutTask` | boolean | `true` | Block edits without active task |
| `rules.validation.enabled` | boolean | `true` | Enable validation hook |
| `rules.validation.runAfterEdit` | boolean | `true` | Run validation after file edits |
| `rules.loopEnforcement.enabled` | boolean | `true` | Block stop until criteria met |
| `rules.componentReuse.enabled` | boolean | `true` | Check for similar components |
| `rules.componentReuse.threshold` | number | `80` | Similarity threshold (0-100) |
| `rules.sessionContext.enabled` | boolean | `true` | Load context on session start |
| `rules.autoLogging.enabled` | boolean | `true` | Auto-log session activity |

**Setup/Management:**
```bash
./scripts/flow hooks setup    # Install hooks
./scripts/flow hooks status   # Check hook status
./scripts/flow hooks remove   # Remove hooks
./scripts/flow hooks test X   # Test a specific hook
```

---

## skills

Installed skills.

```json
{
  "skills": {
    "installed": []
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `installed` | array | `[]` | List of installed skill names |

---

## skillLearning

Skill auto-creation and learning.

```json
{
  "skillLearning": {
    "enabled": true,
    "autoExtract": true,
    "triggers": {
      "onCommit": true,
      "onTaskComplete": true,
      "onCompact": true
    },
    "minCorrectionsToLearn": 1,
    "autoCreateSkills": "ask",
    "autoDetectFrameworks": true,
    "fetchOfficialDocs": true,
    "frameworkDetectionPatterns": {
      "nestjs": ["*.module.ts", "*.controller.ts", "*.service.ts", "@nestjs/*"],
      "react": ["*.tsx", "*.jsx", "use*.ts", "react", "react-dom"],
      "vue": ["*.vue", "vue", "@vue/*"],
      "angular": ["*.component.ts", "*.module.ts", "@angular/*"],
      "fastapi": ["main.py", "fastapi", "pydantic"],
      "django": ["manage.py", "django", "settings.py"],
      "express": ["app.js", "express", "router.js"]
    },
    "officialDocsUrls": {
      "nestjs": "https://docs.nestjs.com",
      "react": "https://react.dev",
      "vue": "https://vuejs.org/guide",
      "angular": "https://angular.io/docs",
      "fastapi": "https://fastapi.tiangolo.com",
      "django": "https://docs.djangoproject.com",
      "express": "https://expressjs.com/en/guide"
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable skill learning |
| `autoExtract` | boolean | `true` | Auto-extract patterns |
| `triggers.onCommit` | boolean | `true` | Learn on commit |
| `triggers.onTaskComplete` | boolean | `true` | Learn on task complete |
| `triggers.onCompact` | boolean | `true` | Learn on compact |
| `minCorrectionsToLearn` | number | `1` | Min corrections to create pattern |
| `autoCreateSkills` | string | `"ask"` | `"ask"`, `"auto"`, or `"never"` |
| `autoDetectFrameworks` | boolean | `true` | Auto-detect frameworks |
| `fetchOfficialDocs` | boolean | `true` | Fetch official documentation |
| `frameworkDetectionPatterns` | object | (see above) | Patterns to detect frameworks |
| `officialDocsUrls` | object | (see above) | URLs for official docs |

---

## componentIndex

Component auto-scanning configuration.

```json
{
  "componentIndex": {
    "autoScan": true,
    "scanOn": ["sessionStart", "afterTask", "preCommit"],
    "staleAfterMinutes": 60,
    "directories": [
      "src/components",
      "src/hooks",
      "src/services",
      "src/pages",
      "src/modules",
      "app"
    ],
    "ignore": [
      "*.test.*",
      "*.spec.*",
      "*.stories.*",
      "index.ts",
      "index.js",
      "__tests__",
      "__mocks__"
    ]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoScan` | boolean | `true` | Auto-scan on triggers |
| `scanOn` | array | `["sessionStart"]` | When to scan: `sessionStart`, `afterTask`, `preCommit` |
| `staleAfterMinutes` | number | `60` | Refresh if older than this (with sessionStart) |
| `directories` | array | (see above) | Directories to scan |
| `ignore` | array | (see above) | Patterns to ignore |

---

## guidedEdit

Step-by-step multi-file editing configuration.

```json
{
  "guidedEdit": {
    "enabled": true,
    "sessionFile": ".workflow/state/guided-edit-session.json",
    "extensions": ["ts", "tsx", "js", "jsx", "vue", "svelte"],
    "srcDir": null
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable guided edit |
| `sessionFile` | string | (see above) | Session persistence file |
| `extensions` | array | `["ts", "tsx", "js", "jsx", "vue", "svelte"]` | File extensions to search |
| `srcDir` | string\|null | `null` | Source directory (null = auto-detect) |

---

## figmaAnalyzer

Design-to-code matching configuration.

```json
{
  "figmaAnalyzer": {
    "enabled": true,
    "thresholds": {
      "exactMatch": 95,
      "strongMatch": 80,
      "variantCandidate": 60
    },
    "componentDirs": ["src/components", "components", "src/ui", "ui"],
    "mcpServer": {
      "port": 3847,
      "autoStart": false
    },
    "autoScanOnAnalyze": true,
    "generatePrompts": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable Figma analyzer |
| `thresholds.exactMatch` | number | `95` | Score for exact match |
| `thresholds.strongMatch` | number | `80` | Score for strong match |
| `thresholds.variantCandidate` | number | `60` | Score for variant candidate |
| `componentDirs` | array | (see above) | Directories to search |
| `mcpServer.port` | number | `3847` | MCP server port |
| `mcpServer.autoStart` | boolean | `false` | Auto-start MCP server |
| `autoScanOnAnalyze` | boolean | `true` | Scan components on analyze |
| `generatePrompts` | boolean | `true` | Generate implementation prompts |

---

## traces

Code flow trace configuration.

```json
{
  "traces": {
    "saveTo": ".workflow/traces",
    "generateDiagrams": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `saveTo` | string | `".workflow/traces"` | Where to save traces |
| `generateDiagrams` | boolean | `true` | Generate Mermaid diagrams |

---

## worktree

Git worktree isolation configuration.

```json
{
  "worktree": {
    "enabled": false,
    "autoCleanupHours": 24,
    "keepOnFailure": false,
    "squashOnMerge": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable worktree isolation |
| `autoCleanupHours` | number | `24` | Hours before cleanup |
| `keepOnFailure` | boolean | `false` | Keep worktree on failure |
| `squashOnMerge` | boolean | `true` | Squash commits on merge |

---

## hybrid

Local LLM execution configuration (85-95% token savings).

```json
{
  "hybrid": {
    "enabled": false,
    "executor": {
      "type": "local",
      "provider": null,
      "providerEndpoint": null,
      "model": null,
      "apiKey": null
    },
    "planner": {
      "adaptToExecutor": true,
      "useAdapterKnowledge": true
    },
    "settings": {
      "temperature": 0.7,
      "maxTokens": 4096,
      "maxRetries": 20,
      "timeout": 120000,
      "autoExecute": false,
      "createBranch": false,
      "tokenEstimation": {
        "enabled": true,
        "minTokens": 1000,
        "maxTokens": 8000,
        "defaultLevel": "medium",
        "logMetrics": true
      }
    },
    "cloudProviders": {
      "openai": {
        "models": ["gpt-4o-mini", "gpt-4o"],
        "defaultModel": "gpt-4o-mini",
        "envKey": "OPENAI_API_KEY"
      },
      "anthropic": {
        "models": ["claude-3-5-haiku-latest", "claude-3-haiku-20240307"],
        "defaultModel": "claude-3-5-haiku-latest",
        "envKey": "ANTHROPIC_API_KEY"
      },
      "google": {
        "models": ["gemini-2.0-flash-exp", "gemini-1.5-flash"],
        "defaultModel": "gemini-2.0-flash-exp",
        "envKey": "GOOGLE_API_KEY"
      }
    },
    "templates": {
      "directory": "templates/hybrid"
    },
    "projectContext": {
      "uiFramework": null,
      "stylingApproach": null,
      "componentDirs": [],
      "typeDirs": ["src/types/*.ts"],
      "doNotImport": ["React"],
      "excludeDirectories": ["__tests__", "__mocks__", "node_modules", ".git", "dist", "build"]
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable hybrid mode |
| `executor.type` | string | `"local"` | `"local"` or `"cloud"` |
| `executor.provider` | string | `null` | Cloud provider name |
| `executor.providerEndpoint` | string | `null` | Custom endpoint URL |
| `executor.model` | string | `null` | Model to use |
| `executor.apiKey` | string | `null` | API key (or use env var) |
| `planner.adaptToExecutor` | boolean | `true` | Adapt prompts to executor |
| `planner.useAdapterKnowledge` | boolean | `true` | Use model adapter knowledge |
| `settings.temperature` | number | `0.7` | LLM temperature |
| `settings.maxTokens` | number | `4096` | Max tokens per request |
| `settings.maxRetries` | number | `20` | Max retry attempts |
| `settings.timeout` | number | `120000` | Timeout in ms |
| `settings.autoExecute` | boolean | `false` | Auto-execute plans |
| `settings.createBranch` | boolean | `false` | Create branch for changes |
| `tokenEstimation.enabled` | boolean | `true` | Estimate tokens |
| `tokenEstimation.minTokens` | number | `1000` | Min estimated tokens |
| `tokenEstimation.maxTokens` | number | `8000` | Max estimated tokens |

---

## validation

Auto-validation command configuration.

```json
{
  "validation": {
    "afterFileEdit": {
      "enabled": false,
      "commands": {
        "*.ts": ["npx tsc --noEmit"],
        "*.tsx": ["npx tsc --noEmit", "npx eslint {file} --fix"],
        "*.js": ["npx eslint {file} --fix"],
        "*.jsx": ["npx eslint {file} --fix"]
      },
      "fixErrorsBeforeContinuing": true
    },
    "afterTaskComplete": {
      "enabled": true,
      "commands": ["npm run lint", "npm run typecheck"]
    },
    "beforeCommit": {
      "enabled": true,
      "commands": ["npm run lint", "npm run typecheck", "npm run test"]
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `afterFileEdit.enabled` | boolean | `false` | Validate after each edit |
| `afterFileEdit.commands` | object | (see above) | Commands per file type |
| `afterFileEdit.fixErrorsBeforeContinuing` | boolean | `true` | Block on errors |
| `afterTaskComplete.enabled` | boolean | `true` | Validate after task |
| `afterTaskComplete.commands` | array | (see above) | Commands to run |
| `beforeCommit.enabled` | boolean | `true` | Validate before commit |
| `beforeCommit.commands` | array | (see above) | Commands to run |

---

## agents

Agent persona configuration.

```json
{
  "agents": {
    "enabled": ["orchestrator", "story-writer", "developer", "reviewer", "tester"],
    "optional": ["accessibility", "security", "performance", "docs", "design-system", "onboarding"]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | array | (see above) | Enabled agent personas |
| `optional` | array | (see above) | Optional agent personas |

---

## multiApproach

Multiple solution analysis configuration.

```json
{
  "multiApproach": {
    "enabled": true,
    "mode": "suggest",
    "triggerOn": ["large", "xl"],
    "maxApproaches": 3,
    "selectionStrategy": "first-passing"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable multi-approach |
| `mode` | string | `"suggest"` | `"suggest"` or `"auto"` |
| `triggerOn` | array | `["large", "xl"]` | Task sizes to trigger |
| `maxApproaches` | number | `3` | Max approaches to generate |
| `selectionStrategy` | string | `"first-passing"` | How to select approach |

---

## autoContext

Auto-loading related files configuration. Automatically discovers relevant files, semantic memory facts, and LSP type information when starting a task.

```json
{
  "autoContext": {
    "enabled": true,
    "showLoadedFiles": true,
    "maxFilesToLoad": 10,
    "maxGrepResults": 10,
    "maxComponentMatches": 15,
    "maxContentLines": 50,
    "includeContent": false,
    "useAstGrep": false,
    "maxSemanticFacts": 5,
    "semanticMinRelevance": 40,
    "lspEnrichment": {
      "enabled": true,
      "maxFiles": 5,
      "timeoutMs": 2000,
      "showExports": true,
      "showDiagnostics": true,
      "prioritizeHealthyFiles": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable auto-context |
| `showLoadedFiles` | boolean | `true` | Show loaded files |
| `maxFilesToLoad` | number | `10` | Max files to load |
| `maxGrepResults` | number | `10` | Max grep results |
| `maxComponentMatches` | number | `15` | Max component matches |
| `maxContentLines` | number | `50` | Max lines per file |
| `includeContent` | boolean | `false` | Include file content |
| `useAstGrep` | boolean | `false` | Use AST-based grep |
| `maxSemanticFacts` | number | `5` | Max semantic memory facts to include |
| `semanticMinRelevance` | number | `40` | Min relevance % for semantic facts |

### LSP Enrichment (v2.2+)

LSP enrichment adds type information and diagnostics to discovered files.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lspEnrichment.enabled` | boolean | `true` | Enable LSP enrichment |
| `lspEnrichment.maxFiles` | number | `5` | Max files to enrich |
| `lspEnrichment.timeoutMs` | number | `2000` | LSP timeout in ms |
| `lspEnrichment.showExports` | boolean | `true` | Show exported symbols |
| `lspEnrichment.showDiagnostics` | boolean | `true` | Show error/warning counts |
| `lspEnrichment.prioritizeHealthyFiles` | boolean | `true` | Sort error-free files first |

**Output Example:**
```
📂 Auto-loaded context:
   ✓ src/services/AuthService.ts
   ⚠️ src/hooks/useAuth.ts (2 warnings)
   ❌ src/utils/broken.ts (1 error)

📦 Key exports:
   AuthService.ts: login, logout, refreshToken
   useAuth.ts: useAuth, AuthProvider

🧠 Learned facts:
   ● Always use AuthContext for user state
```

---

## metrics

Usage tracking configuration.

```json
{
  "metrics": {
    "enabled": true,
    "trackCommands": true,
    "retentionDays": 30,
    "alertOnFailureRate": 0.3
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable metrics |
| `trackCommands` | boolean | `true` | Track command usage |
| `retentionDays` | number | `30` | Days to retain metrics |
| `alertOnFailureRate` | number | `0.3` | Alert threshold (0-1) |

---

## security

Pre-commit security scanning configuration.

```json
{
  "security": {
    "scanBeforeCommit": true,
    "blockOnHigh": true,
    "checkPatterns": {
      "secrets": true,
      "injection": true,
      "npmAudit": true
    },
    "ignoreFiles": ["*.test.ts", "*.spec.ts"]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scanBeforeCommit` | boolean | `true` | Scan before commit |
| `blockOnHigh` | boolean | `true` | Block on high severity |
| `checkPatterns.secrets` | boolean | `true` | Check for secrets |
| `checkPatterns.injection` | boolean | `true` | Check for injection |
| `checkPatterns.npmAudit` | boolean | `true` | Run npm audit |
| `ignoreFiles` | array | (see above) | Files to ignore |

---

## modelAdapters

Per-model learning configuration.

```json
{
  "modelAdapters": {
    "enabled": true,
    "autoLearn": true,
    "directory": ".workflow/model-adapters"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable model adapters |
| `autoLearn` | boolean | `true` | Auto-learn from errors |
| `directory` | string | `".workflow/model-adapters"` | Adapter storage path |

---

## codebaseInsights

Project analysis configuration.

```json
{
  "codebaseInsights": {
    "enabled": true,
    "generateOn": ["onboarding", "manual"]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable insights |
| `generateOn` | array | `["onboarding", "manual"]` | When to generate |

---

## lsp

Language server integration configuration. LSP provides type information, diagnostics, and symbol navigation.

```json
{
  "lsp": {
    "enabled": true,
    "server": "typescript-language-server",
    "timeout": 5000,
    "cacheTypes": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable LSP integration |
| `server` | string | `"typescript-language-server"` | LSP server to use |
| `timeout` | number | `5000` | Request timeout in ms |
| `cacheTypes` | boolean | `true` | Cache type information |

### Installation

LSP dependencies can be installed manually:

```bash
npm i -D typescript-language-server typescript
```

### Auto-Context Integration

When `autoContext.lspEnrichment.enabled` is `true`, the LSP server enriches auto-context results with:
- **Exported symbols**: Function, class, interface, and variable names
- **Diagnostics**: Error and warning counts per file
- **Health prioritization**: Files with errors are sorted to the bottom

See [autoContext.lspEnrichment](#lsp-enrichment-v22) for configuration options.

---

## contextMonitor

Context window management configuration.

```json
{
  "contextMonitor": {
    "enabled": true,
    "warnAt": 0.7,
    "criticalAt": 0.85,
    "contextWindow": 200000,
    "checkOnSessionStart": true,
    "checkAfterTask": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable monitoring |
| `warnAt` | number | `0.7` | Warning threshold (0-1) |
| `criticalAt` | number | `0.85` | Critical threshold (0-1) |
| `contextWindow` | number | `200000` | Estimated context window |
| `checkOnSessionStart` | boolean | `true` | Check on start |
| `checkAfterTask` | boolean | `true` | Check after task |
| `trackingMethod` | string | `"auto"` | Tracking method: "auto", "native", or "estimated" |

---

## requestLog

Change history configuration.

```json
{
  "requestLog": {
    "enabled": true,
    "autoArchive": true,
    "maxRecentEntries": 50,
    "keepRecent": 30,
    "createSummary": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable request log |
| `autoArchive` | boolean | `true` | Auto-archive old entries |
| `maxRecentEntries` | number | `50` | Max entries before archive |
| `keepRecent` | number | `30` | Days to keep recent |
| `createSummary` | boolean | `true` | Create summary on archive |

---

## sessionState

Session persistence configuration.

```json
{
  "sessionState": {
    "enabled": true,
    "autoRestore": true,
    "maxGapHours": 24,
    "trackFiles": true,
    "trackDecisions": true,
    "maxRecentFiles": 20,
    "maxRecentDecisions": 10
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable session state |
| `autoRestore` | boolean | `true` | Auto-restore session |
| `maxGapHours` | number | `24` | Max hours between sessions |
| `trackFiles` | boolean | `true` | Track file access |
| `trackDecisions` | boolean | `true` | Track decisions |
| `maxRecentFiles` | number | `20` | Max recent files |
| `maxRecentDecisions` | number | `10` | Max recent decisions |

---

## memory

Fact storage configuration.

```json
{
  "memory": {
    "enabled": true,
    "localDb": ".workflow/memory/local.db",
    "embeddingModel": "Xenova/all-MiniLM-L6-v2",
    "maxLocalFacts": 1000,
    "autoRemember": false
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable memory system |
| `localDb` | string | `".workflow/memory/local.db"` | Local database path |
| `embeddingModel` | string | `"Xenova/all-MiniLM-L6-v2"` | Embedding model |
| `maxLocalFacts` | number | `1000` | Max stored facts |
| `autoRemember` | boolean | `false` | Auto-remember facts |

---

## knowledgeRouting

Knowledge routing configuration.

```json
{
  "knowledgeRouting": {
    "autoDetect": true,
    "confirmWithUser": true,
    "defaultScope": "local",
    "modelSpecificLearning": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoDetect` | boolean | `true` | Auto-detect knowledge type |
| `confirmWithUser` | boolean | `true` | Confirm before routing |
| `defaultScope` | string | `"local"` | Default scope |
| `modelSpecificLearning` | boolean | `true` | Per-model learning |

---

## prd

PRD chunking configuration.

```json
{
  "prd": {
    "enabled": true,
    "maxContextTokens": 2000,
    "chunkSize": 500,
    "autoRetrieve": false
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable PRD support |
| `maxContextTokens` | number | `2000` | Max tokens per chunk |
| `chunkSize` | number | `500` | Chunk size in tokens |
| `autoRetrieve` | boolean | `false` | Auto-retrieve relevant chunks |

---

## automaticMemory

Memory management configuration.

```json
{
  "automaticMemory": {
    "enabled": true,
    "entropyThreshold": 0.7,
    "compactOnSessionEnd": true,
    "relevanceDecay": {
      "enabled": true,
      "decayRate": 0.033,
      "neverAccessedPenalty": 0.1
    },
    "demotion": {
      "relevanceThreshold": 0.3,
      "coldRetentionDays": 90
    },
    "selfTuning": {
      "enabled": false,
      "adjustOnOverflow": true,
      "adjustOnFailures": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable auto memory |
| `entropyThreshold` | number | `0.7` | Entropy threshold |
| `compactOnSessionEnd` | boolean | `true` | Compact on session end |
| `relevanceDecay.enabled` | boolean | `true` | Enable decay |
| `relevanceDecay.decayRate` | number | `0.033` | Decay rate per day |
| `relevanceDecay.neverAccessedPenalty` | number | `0.1` | Penalty for unused |
| `demotion.relevanceThreshold` | number | `0.3` | Threshold for demotion |
| `demotion.coldRetentionDays` | number | `90` | Days to keep cold |
| `selfTuning.enabled` | boolean | `false` | Enable self-tuning |

---

## automaticPromotion

Pattern promotion configuration.

```json
{
  "automaticPromotion": {
    "enabled": false,
    "threshold": 3,
    "minRelevance": 0.8,
    "destinations": ["decisions.md"],
    "requireApproval": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable promotion |
| `threshold` | number | `3` | Uses before promotion |
| `minRelevance` | number | `0.8` | Min relevance score |
| `destinations` | array | `["decisions.md"]` | Where to promote |
| `requireApproval` | boolean | `true` | Require user approval |

---

## regressionTesting

Regression test configuration.

```json
{
  "regressionTesting": {
    "enabled": true,
    "sampleSize": 3,
    "runOnTaskComplete": true,
    "onFailure": "warn"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable regression tests |
| `sampleSize` | number | `3` | Tasks to test |
| `runOnTaskComplete` | boolean | `true` | Run after task |
| `onFailure` | string | `"warn"` | `"warn"`, `"block"`, or `"fix"` |

---

## storyDecomposition

Story breakdown configuration.

```json
{
  "storyDecomposition": {
    "autoDetect": true,
    "autoDecompose": false,
    "complexityThreshold": "medium",
    "minSubTasks": 5,
    "edgeCases": true,
    "loadingStates": true,
    "errorStates": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoDetect` | boolean | `true` | Auto-detect complex stories |
| `autoDecompose` | boolean | `false` | Auto-decompose stories |
| `complexityThreshold` | string | `"medium"` | Threshold for decomposition |
| `minSubTasks` | number | `5` | Min sub-tasks to suggest |
| `edgeCases` | boolean | `true` | Include edge cases |
| `loadingStates` | boolean | `true` | Include loading states |
| `errorStates` | boolean | `true` | Include error states |

---

## damageControl

Destructive command protection configuration.

```json
{
  "damageControl": {
    "enabled": false,
    "patternsFile": ".workflow/damage-control.yaml",
    "promptHook": {
      "enabled": false,
      "model": "haiku",
      "timeout": 5000,
      "skipSafeCommands": true
    },
    "onBlock": "error",
    "onAsk": "prompt",
    "logging": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable damage control |
| `patternsFile` | string | `".workflow/damage-control.yaml"` | Patterns file path |
| `promptHook.enabled` | boolean | `false` | Enable AI review |
| `promptHook.model` | string | `"haiku"` | Model for review |
| `promptHook.timeout` | number | `5000` | Review timeout |
| `promptHook.skipSafeCommands` | boolean | `true` | Skip safe commands |
| `onBlock` | string | `"error"` | `"error"`, `"warn"`, or `"log"` |
| `onAsk` | string | `"prompt"` | `"prompt"`, `"block"`, or `"allow"` |
| `logging` | boolean | `true` | Log blocked commands |

---

## priorities

Task priority configuration.

```json
{
  "priorities": {
    "defaultPriority": "P2",
    "autoBoostDays": 2,
    "autoBoostAmount": 1,
    "levels": {
      "P0": { "label": "Critical", "description": "Drop everything" },
      "P1": { "label": "High", "description": "Do today" },
      "P2": { "label": "Medium", "description": "Do this week" },
      "P3": { "label": "Low", "description": "Do when possible" },
      "P4": { "label": "Backlog", "description": "Someday" }
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultPriority` | string | `"P2"` | Default task priority |
| `autoBoostDays` | number | `2` | Days before auto-boost |
| `autoBoostAmount` | number | `1` | Priority levels to boost |
| `levels` | object | (see above) | Priority level definitions |

---

## morningBriefing

Session start context configuration.

```json
{
  "morningBriefing": {
    "enabled": true,
    "showLastSession": true,
    "showChanges": true,
    "showRecommendedTasks": 3,
    "generatePrompt": true,
    "showBlockers": true,
    "showKeyContext": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable briefing |
| `showLastSession` | boolean | `true` | Show last session info |
| `showChanges` | boolean | `true` | Show recent changes |
| `showRecommendedTasks` | number | `3` | Tasks to recommend |
| `generatePrompt` | boolean | `true` | Generate startup prompt |
| `showBlockers` | boolean | `true` | Show blockers |
| `showKeyContext` | boolean | `true` | Show key context |

---

## Other Top-Level Options

```json
{
  "version": "2.0.0",
  "projectName": "",
  "autoLog": true,
  "autoUpdateAppMap": true,
  "requireApproval": []
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `"2.0.0"` | Config version |
| `projectName` | string | `""` | Project name |
| `autoLog` | boolean | `true` | Auto-update request log |
| `autoUpdateAppMap` | boolean | `true` | Auto-update app-map |
| `requireApproval` | array | `[]` | Operations requiring approval |

---

## review

Code review configuration.

```json
{
  "review": {
    "minFindings": 3,
    "requireJustificationIfClean": true,
    "gitVerifiedClaims": {
      "enabled": true,
      "verifyFileCreation": true,
      "verifyContentMatch": true,
      "blockOnMismatch": true
    },
    "agents": {
      "core": ["code-logic", "security", "architecture"],
      "optional": ["performance"],
      "projectRules": true,
      "maxParallelAgents": 6
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minFindings` | number | `3` | Minimum findings per review agent (adversarial mode) |
| `requireJustificationIfClean` | boolean | `true` | Require justification when fewer than minFindings |
| `gitVerifiedClaims.enabled` | boolean | `true` | Cross-reference spec vs git diff |
| `gitVerifiedClaims.verifyFileCreation` | boolean | `true` | Verify spec-promised files exist in git |
| `gitVerifiedClaims.verifyContentMatch` | boolean | `true` | Verify content matches spec intent |
| `gitVerifiedClaims.blockOnMismatch` | boolean | `true` | Block review on missing files |
| `agents.core` | array | (see above) | Core review agents (always run) |
| `agents.optional` | array | `["performance"]` | Optional review agents |
| `agents.projectRules` | boolean | `true` | Auto-generate agents from decisions.md |
| `agents.maxParallelAgents` | number | `6` | Max total review agents |

---

## needsClarification

Controls [NEEDS CLARIFICATION] markers in spec generation.

```json
{
  "needsClarification": {
    "enabled": true,
    "markerFormat": "[NEEDS CLARIFICATION: {reason}]",
    "blockImplementation": true,
    "minMarkersForReview": 0,
    "categories": ["assumption", "ambiguity", "missing-context", "dependency-unknown", "edge-case"]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable clarification markers |
| `markerFormat` | string | `"[NEEDS CLARIFICATION: {reason}]"` | Marker format in specs |
| `blockImplementation` | boolean | `true` | Block coding until all markers resolved |
| `minMarkersForReview` | number | `0` | Min markers before requiring review |
| `categories` | array | (see above) | Allowed marker categories |

---

## tdd

Test-first development (TDD) mode.

```json
{
  "tdd": {
    "enforced": false,
    "defaultForTypes": [],
    "requireFailingTestFirst": true,
    "testFrameworkDetection": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enforced` | boolean | `false` | Globally enforce TDD |
| `defaultForTypes` | array | `[]` | Task types that auto-enable TDD (e.g., `["feature", "bugfix"]`) |
| `requireFailingTestFirst` | boolean | `true` | Require failing test before implementation |
| `testFrameworkDetection` | boolean | `true` | Auto-detect test framework from package.json |

---

## decisions

Decision amendment tracking configuration.

```json
{
  "decisions": {
    "amendmentTracking": {
      "enabled": true,
      "logFile": ".workflow/state/decision-amendments.json",
      "requireRationale": true,
      "requireImpactAssessment": false,
      "trackSource": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `amendmentTracking.enabled` | boolean | `true` | Enable amendment tracking |
| `amendmentTracking.logFile` | string | `".workflow/state/decision-amendments.json"` | Log file path |
| `amendmentTracking.requireRationale` | boolean | `true` | Require rationale for changes |
| `amendmentTracking.requireImpactAssessment` | boolean | `false` | Require impact assessment |
| `amendmentTracking.trackSource` | boolean | `true` | Track amendment source |

---

## consistency

Cross-artifact consistency analysis.

```json
{
  "consistency": {
    "enabled": true,
    "runOn": ["afterTask", "beforeCommit"],
    "mode": "warn",
    "checks": {
      "phantomEntries": true,
      "orphanFiles": true,
      "crossMapConsistency": true,
      "nameCollisions": true,
      "deadImports": true
    },
    "orphanMode": "warn",
    "maxOrphans": 10
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable consistency checks |
| `runOn` | array | `["afterTask", "beforeCommit"]` | When to run checks |
| `mode` | string | `"warn"` | `"warn"` or `"block"` |
| `checks.phantomEntries` | boolean | `true` | Check for documented but missing items |
| `checks.orphanFiles` | boolean | `true` | Check for undocumented files |
| `checks.crossMapConsistency` | boolean | `true` | Cross-reference between maps |
| `orphanMode` | string | `"warn"` | `"warn"` or `"block"` for orphan files |
| `maxOrphans` | number | `10` | Max orphans before warning |

---

## Related

- [Task Execution](../02-task-execution/) - Where most config applies
- [Setup & Onboarding](../01-setup-onboarding/) - Initial configuration
- [Safety & Guardrails](../06-safety-guardrails/) - Security configuration
