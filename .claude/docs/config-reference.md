# WogiFlow Configuration Reference

Your `config.json` works like `tsconfig.json` — you only add what you want to change. Everything else uses sensible defaults from the engine.

**Location**: `.workflow/config.json`

## How It Works

```
config.json (your overrides)  +  built-in defaults  =  final config
```

You never need to paste the full config. Just add the keys you want to change.

**Example** — enable testing and strict task gating:
```json
{
  "testing": { "enabled": true, "mode": "full" },
  "enforcement": { "taskGating": { "enabled": true } }
}
```

---

## All Available Overrides

### Scripts (Build Tools)

Tell WogiFlow how to lint, typecheck, and test your project.

```json
{
  "scripts": {
    "lint": "npx eslint . --fix",
    "typecheck": "npx tsc --noEmit",
    "test": "npx vitest run",
    "build": "npm run build",
    "coverage": "npx vitest --coverage"
  }
}
```

**Default**: All `null` (WogiFlow skips validation steps if not set).

---

### Testing (Auto-Testing Suite)

Enable UI, API, and data integrity testing. Auto-detects on first use via `/wogi-test`.

```json
{
  "testing": {
    "enabled": true,
    "mode": "full"
  }
}
```

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `enabled` | `true/false` | `false` | Master switch for all testing |
| `mode` | `auto`, `ui`, `api`, `full`, `unit`, `off` | `auto` | Which test types to run. `auto` uses project detection |

**UI testing overrides** (only needed if defaults don't match your project):
```json
{
  "testing": {
    "enabled": true,
    "ui": {
      "baseUrl": "http://localhost:5173",
      "startCommand": "npm run dev",
      "headless": true,
      "checkAccessibility": true,
      "stateChecks": ["empty", "loading", "error", "success"]
    }
  }
}
```

**API testing overrides**:
```json
{
  "testing": {
    "enabled": true,
    "api": {
      "baseUrl": "http://localhost:8080",
      "startCommand": "npm run serve",
      "specFile": "openapi.yaml"
    }
  }
}
```

**Test generation**:
```json
{
  "testing": {
    "generation": {
      "autoGenerate": false,
      "includeEdgeCases": false
    }
  }
}
```

**Disable specific quality gates** (tests still run, but won't block task completion):
```json
{
  "testing": {
    "qualityGates": {
      "generatedTestsPass": false,
      "uiVerification": false,
      "apiVerification": false,
      "dataIntegrity": false
    }
  }
}
```

---

### Enforcement (How Strict WogiFlow Is)

```json
{
  "enforcement": {
    "strictMode": true,
    "taskGating": { "enabled": true },
    "scopeGating": { "enabled": true },
    "routingGate": { "enabled": true }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `strictMode` | `true` | Enforce task routing for every message |
| `taskGating.enabled` | `true` | Block edits without an active task |
| `scopeGating.enabled` | `true` | Warn when editing files outside task scope |
| `routingGate.enabled` | `true` | Block tools until routed through `/wogi-start` |
| `loopEnforcement.enabled` | `true` | Require verification loop completion |

**Relaxed mode** (good for exploration/prototyping):
```json
{
  "enforcement": {
    "strictMode": false,
    "taskGating": { "enabled": false },
    "scopeGating": { "enabled": false },
    "routingGate": { "enabled": false }
  }
}
```

---

### Quality Gates (What Must Pass Before Task Closes)

Customize which checks are required per task type.

```json
{
  "qualityGates": {
    "feature": {
      "require": ["loopComplete", "tests", "registryUpdate", "requestLogEntry"],
      "optional": ["review"]
    },
    "bugfix": {
      "require": ["loopComplete", "tests", "requestLogEntry"],
      "optional": []
    }
  }
}
```

**Available gates**: `loopComplete`, `tests`, `generatedTestsPass`, `uiVerification`, `apiVerification`, `registryUpdate`, `requestLogEntry`, `integrationWiring`, `standardsCompliance`, `outstandingFindings`, `preRelease`, `noNewFeatures`, `smokeTest`, `learningEnforcement`, `review`, `docs`, `webmcpVerification`

**Task types**: `feature`, `bugfix`, `refactor`, `chore`, `release`, `fix`

---

### Commits

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
    "smallFixThreshold": 3
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `requireApproval.*` | varies | Ask before committing this type |
| `autoCommitSmallFixes` | `true` | Auto-commit when <= threshold files changed |
| `smallFixThreshold` | `3` | Max files for auto-commit |

---

### Hooks (Background Automation)

```json
{
  "hooks": {
    "enabled": true,
    "rules": {
      "intelligence": {
        "sessionContext": { "enabled": true },
        "validation": { "enabled": true, "runAfterEdit": true }
      },
      "lifecycle": {
        "taskCompleted": { "enabled": true },
        "phaseGate": { "enabled": true }
      }
    }
  }
}
```

**Disable all hooks** (maximum speed, no background checks):
```json
{
  "hooks": { "enabled": false }
}
```

---

### Execution (Task Behavior)

```json
{
  "execution": {
    "maxRetries": 5,
    "tdd": {
      "enforced": true,
      "defaultForTypes": ["bugfix"]
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxRetries` | `5` | Max fix attempts per failing scenario |
| `tdd.enforced` | `true` | Write tests before implementation |
| `tdd.defaultForTypes` | `["bugfix"]` | Auto-enable TDD for these task types |

---

### Bulk Orchestrator (Multi-Task Execution)

```json
{
  "parallelExecution": {
    "bulkOrchestrator": {
      "enabled": true,
      "parallelLimit": 3,
      "onFailure": "stop-dependent",
      "continuous": { "enabled": true }
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Use sub-agent isolation per task |
| `parallelLimit` | `3` | Max tasks running in parallel |
| `onFailure` | `stop-dependent` | `stop-all`, `stop-dependent`, or `continue` |
| `continuous.enabled` | `false` | Keep checking for new tasks when queue empties |

---

### Review (Code Review Behavior)

```json
{
  "review": {
    "minFindings": 3,
    "agents": {
      "core": ["code-logic", "security", "architecture"],
      "optional": ["performance"],
      "projectRules": true,
      "maxParallelAgents": 6
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `minFindings` | `3` | Min findings per agent (adversarial mode) |
| `agents.optional` | `["performance"]` | Extra review agents to enable |
| `agents.projectRules` | `true` | Auto-generate agents from decisions.md |
| `agents.maxParallelAgents` | `6` | Cap on total review agents |

---

### Research (Explore Phase)

```json
{
  "research": {
    "enabled": true,
    "planMode": {
      "researchDepth": "thorough"
    }
  }
}
```

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `enabled` | `true/false` | `false` | Enable web research during explore phase |
| `planMode.researchDepth` | `thorough`, `standard`, `minimal` | `thorough` | How many research agents to launch |

---

### Component Reuse

```json
{
  "componentReuse": {
    "enabled": true,
    "threshold": 30,
    "aiAsJudge": true,
    "blockOnSimilar": false
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Check for existing components before creating |
| `threshold` | `30` | Similarity % to flag as potential duplicate |
| `aiAsJudge` | `true` | Use AI to judge purpose overlap (not just name) |
| `blockOnSimilar` | `false` | Block creation if similar found (vs just warn) |

---

### Skills

```json
{
  "skills": {
    "installed": ["figma-analyzer"],
    "autoInvoke": true
  }
}
```

---

### Specification Mode

```json
{
  "specificationMode": {
    "enabled": true,
    "mandatoryFor": ["medium", "large"],
    "skipFor": ["small", "bugfix"],
    "requireApproval": true
  }
}
```

---

### Context Management

```json
{
  "contextManagement": {
    "proactive": {
      "enabled": true,
      "triggerThreshold": 0.75
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `proactive.triggerThreshold` | `0.75` | Auto-compact when context reaches this % |

---

### Long Input Gate

```json
{
  "longInputGate": {
    "enabled": true,
    "lineThreshold": 60,
    "charThreshold": 3000
  }
}
```

Auto-routes long inputs (transcripts, specs) through `/wogi-extract-review`.

---

### Finalization (Branch Management)

```json
{
  "finalization": {
    "defaultAction": "ask",
    "autoMergeForTypes": ["bugfix", "quick-fix"],
    "squashOnMerge": true
  }
}
```

---

### Models (Hybrid/Multi-Model)

```json
{
  "models": {
    "hybrid": {
      "enabled": true,
      "executor": {
        "type": "local",
        "model": "claude-3-5-haiku-latest"
      }
    }
  }
}
```

---

### Plugins

```json
{
  "plugins": {
    "enabled": true,
    "standaloneBypassTask": true
  }
}
```

---

### Security

```json
{
  "security": {
    "scanBeforeCommit": true,
    "blockOnHigh": true,
    "checkPatterns": {
      "secrets": true,
      "injection": true,
      "npmAudit": true
    }
  }
}
```

---

## Quick Copy-Paste Presets

### Minimal (Fast, No Overhead)
```json
{
  "enforcement": { "strictMode": false },
  "hooks": { "enabled": false }
}
```

### Standard (Recommended)
```json
{
  "scripts": {
    "lint": "npx eslint . --fix",
    "typecheck": "npx tsc --noEmit",
    "test": "npx vitest run"
  }
}
```

### Full Testing
```json
{
  "testing": { "enabled": true, "mode": "full" },
  "scripts": {
    "lint": "npx eslint . --fix",
    "typecheck": "npx tsc --noEmit",
    "test": "npx vitest run"
  }
}
```

### Maximum Quality
```json
{
  "testing": { "enabled": true, "mode": "full" },
  "enforcement": { "strictMode": true, "taskGating": { "enabled": true } },
  "research": { "enabled": true },
  "specificationMode": { "enabled": true },
  "hooks": { "enabled": true },
  "scripts": {
    "lint": "npx eslint . --fix",
    "typecheck": "npx tsc --noEmit",
    "test": "npx vitest run"
  }
}
```

---

## View Your Current Config

```bash
/wogi-config           # Show effective config (defaults + overrides)
cat .workflow/config.json   # Show just your overrides
```

## Where Defaults Live

All defaults are defined in `scripts/flow-config-defaults.js`. Your config.json overrides are deep-merged on top of these defaults at runtime via `mergeWithDefaults()`.

You never need to copy defaults into config.json — only add keys you want to change.
