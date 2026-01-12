# Wogi Flow Roadmap

**Status**: Dependency-ordered implementation plan (reorganized 2026-01-10)

---

## Implementation Phases

Features are organized by logical dependencies to avoid refactoring. Build foundation first, layer features on top.

```
┌─────────────────────────────────────────────────────────┐
│                PHASE 0: FOUNDATION                       │
│  CLI Agnosticism + Multi-Model Architecture (parallel)   │
│  Failure Categories │ Variable Substitution              │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│             PHASE 1: MODEL INFRASTRUCTURE                │
│       Formalized Model Registry → Enhanced Stats         │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              PHASE 2: MULTI-MODEL CORE                   │
│      Multi-Model Mode → Prompt Fragment System           │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│             PHASE 3: INTELLIGENT ROUTING                 │
│   Task Router → Cascade Fallback → Tiered Learning       │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│             PHASE 4: ADVANCED EXECUTION                  │
│  Parallel Dispatch → Context Scoring → Gate Confidence   │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│           PHASE 5: DISTRIBUTION & COMMUNITY              │
│        npm Package → Skill Library Marketplace           │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│            PHASE 6: TEAM & INTEGRATIONS                  │
│   Team Observability → Jira/Linear → Background Sync     │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Order Summary

| Order | Feature | Depends On | Effort |
|-------|---------|------------|--------|
| **0.1** | CLI Agnosticism + Multi-Model Architecture | - | 4-6 weeks |
| **0.2** | Failure Category Enum | - | 1-2 hours |
| **0.3** | Variable Substitution | - | 4-6 hours |
| **1.1** | Formalized Model Registry | 0.1 | 3-4 hours |
| **1.2** | Enhanced Model Stats | 1.1, 0.2 | 2-3 hours |
| **2.1** | Multi-Model Mode | 1.1, 1.2 | 2-3 weeks |
| **2.2** | Prompt Fragment System | 1.1, 0.1 | 1-2 days |
| **3.1** | Task Router | 2.1 | 1-2 days |
| **3.2** | Cascade Fallback | 3.1, 0.2 | 4-6 hours |
| **3.3** | Tiered Learning Thresholds | 1.2, 2.1 | 2-3 hours |
| **4.1** | Parallel Dispatch | 3.1 | 2-3 days |
| **4.2** | Context Priority Scoring | 1.1 | 4-6 hours |
| **4.3** | Quality Gate Confidence | - | 2-3 hours |
| **5.1** | npm Package Distribution | 0.1 | 1-2 days |
| **5.1.1** | Release Channel Configuration | 5.1 | 4-6 hours |
| **5.1.2** | LSP Tool Integration | 5.1 | 1-2 days |
| **5.2** | Skill Library Marketplace | 5.1, 0.1 | 3-4 weeks |
| **6.1** | Team Observability Web UI | Team Backend | 2-3 weeks |
| **6.2** | Jira/Linear Integration | - | 1-2 days each |
| **6.3** | Background Sync Daemon | 4.1 | 2-3 days |

---

## Key Milestones

| Milestone | Features Complete | Value Delivered |
|-----------|-------------------|-----------------|
| **M1: Foundation** | 0.1, 0.2, 0.3 | Universal architecture, cleaner config |
| **M2: Model-Aware** | 1.1, 1.2 | Know model capabilities, track performance |
| **M3: Multi-Model** | 2.1, 2.2 | Use multiple models, cost savings |
| **M4: Smart Routing** | 3.1, 3.2, 3.3 | Intelligent task→model routing |
| **M5: Advanced** | 4.1, 4.2, 4.3 | Parallel execution, optimized context |
| **M6: Distribution** | 5.1, 5.2 | npm install, community skills |

---

## Phase 0: Foundation

Design CLI Agnosticism and Multi-Model together so everything works across CLIs from day one.

### 0.1 CLI Agnosticism + Multi-Model Architecture

**Why first**: Everything we build should work across CLIs (Claude Code, Gemini CLI, OpenCode). Building Claude-specific features now means rewriting later. Multi-Model needs to know about providers/CLIs.

**Universal Architecture**:
```
.workflow/                    ← Universal source of truth
├── config.json              ← Model configs, routing rules
├── models/                  ← Model registry (CLI-agnostic)
│   ├── registry.json        ← All model capabilities
│   └── stats.json           ← Performance tracking
├── state/
└── skills/                  ← Skills work across CLIs
         │
         ▼ (bridges generate CLI-specific files)
┌─────────────────────────────────────────────┐
│  Claude Code    │  Gemini CLI   │  OpenCode │
│  .claude/       │  .gemini/     │  .opencode│
│  CLAUDE.md      │  GEMINI.md    │  config   │
└─────────────────────────────────────────────┘
```

**Deliverables**:
- Universal `.workflow/models/` structure
- CLI bridge architecture
- Provider abstraction layer
- Installer asks "Which CLI?" and "Which models?"

**CLI Selection**:
- **Install-time** (default): Installer asks "Which CLI?" as first question
- **Runtime detection** (advanced): Auto-detect running CLI
- **Multi-CLI** (team scenarios): Generate for multiple CLIs

---

### 0.2 Failure Category Enum

**Why early**: Consistent error categorization used by Cascade Fallback, Model Stats, and Learning system.

```javascript
const FailureCategory = {
  PARSE_ERROR: 'parse_error',
  IMPORT_ERROR: 'import_error',
  TYPE_ERROR: 'type_error',
  SYNTAX_ERROR: 'syntax_error',
  RUNTIME_ERROR: 'runtime_error',
  RATE_LIMIT: 'rate_limit',
  CONTEXT_OVERFLOW: 'context_overflow',
  CAPABILITY_MISMATCH: 'capability_mismatch'
};
```

**Note**: Partially implemented as `ERROR_CATEGORIES` in `flow-adaptive-learning.js`. Needs formalization.

---

### 0.3 Variable Substitution in Config

**Why early**: Cleaner config patterns used throughout model configs, team configs, etc.

**Patterns**:
- `{file:path}` for file-based secrets (Kubernetes pattern)
- `{env:VAR}` for environment variables

**Use Cases**:
```json
"providers": {
  "anthropic": { "apiKey": "{file:~/.secrets/anthropic-key}" }
}
```

---

## Phase 1: Model Infrastructure

### 1.1 Formalized Model Registry

**Depends on**: Phase 0.1 (CLI Agnosticism for provider abstraction)

**Location**: `.workflow/models/registry.json`

```json
{
  "models": {
    "claude-opus-4.5": {
      "provider": "anthropic",
      "contextWindow": 200000,
      "costTier": "premium",
      "capabilities": ["code-generation", "structured-output", "planning"],
      "languages": {
        "typescript": { "quality": "excellent" },
        "python": { "quality": "excellent" }
      },
      "taskTypes": {
        "architecture": "excellent",
        "debugging": "excellent",
        "boilerplate": "overkill"
      }
    }
  }
}
```

---

### 1.2 Enhanced Model Stats

**Depends on**: 1.1 (Model Registry), 0.2 (Failure Categories)

**Location**: `.workflow/models/stats.json`

```json
{
  "ollama-qwen": {
    "successRate": 0.87,
    "avgLatencyMs": 4500,
    "failuresByCategory": {
      "import_error": 12,
      "type_error": 5
    },
    "byTaskType": {
      "create-component": { "success": 45, "fail": 3 },
      "fix-bug": { "success": 22, "fail": 8 }
    },
    "totalRuns": 156
  }
}
```

---

## Phase 2: Multi-Model Core

### 2.1 Multi-Model Mode

**Depends on**: 1.1 (Model Registry), 1.2 (Model Stats)

**Key Concept**: Replaces/evolves Hybrid Mode - "Hybrid" now means "more than one model available"

**Contains**:
- Model selection logic
- Cost optimization strategies (quality-first vs cost-optimized)
- Global learning (aggregated across users)
- Hosted pricing/performance table (optional)

**Intelligent Task Analysis** - Primary model estimates:
- Complexity level
- Token effort (context needed + expected output)
- Domains involved (api, db, frontend)
- Languages required
- Recommended model + reasoning

**Routing Strategies**:
- **Task-based**: Route by task type + language
- **Cost-optimized**: Try cheapest first, escalate on failure
- **Quality-first**: Use best model, fallback if unavailable
- **Learned routing**: Track success rates, auto-optimize

**Model-Specific Configuration**:
```json
{
  "modelConfig": {
    "providers": {
      "anthropic": {
        "folderStructure": ".claude/",
        "rulesFile": "CLAUDE.md",
        "models": {
          "claude-opus-4.5": {
            "promptStyle": "detailed",
            "costTier": "premium",
            "bestFor": ["planning", "architecture"]
          }
        }
      },
      "google": {
        "folderStructure": ".gemini/",
        "rulesFile": "GEMINI.md"
      }
    },
    "taskRouting": {
      "planning": { "preferModel": "claude-opus-4.5" },
      "boilerplate": { "preferModel": "claude-sonnet-4" }
    }
  }
}
```

**Hosted Pricing Service** (optional):
- Live pricing from provider APIs
- Performance benchmarks per task type
- Cost-performance matrix
- Model recommendations based on budget

---

### 2.2 Prompt Fragment System

**Depends on**: 1.1 (Model Registry), 0.1 (CLI Agnosticism)

**Why**: Different models need different prompts. Composable fragments vs monolithic templates.

**Contains**:
- Composable prompt fragments
- Model-specific prompt templates
- Provider-level adjustments
- CLI-specific template generation

---

## Phase 3: Intelligent Routing

### 3.1 Task Router

**Depends on**: 2.1 (Multi-Model Mode), 1.2 (Model Stats)

Route different task types to optimal models based on:
- Task analysis (complexity, language, domain)
- Model capabilities from registry
- Historical success rates from stats
- Cost constraints

---

### 3.2 Cascade Fallback

**Depends on**: 3.1 (Task Router), 0.2 (Failure Categories)

If primary model fails 3x on same error, try alternate model.

```json
"cascade": {
  "enabled": false,
  "fallbackModel": null,
  "maxFailuresBeforeEscalate": 3,
  "escalateOnCategories": ["capability_mismatch", "context_overflow"]
}
```

---

### 3.3 Tiered Learning Thresholds

**Depends on**: 1.2 (Model Stats), 2.1 (Multi-Model Mode)

Smarter auto-application of learned patterns, per model.

```javascript
const LEARNING_TIERS = {
  AUTO_APPLY: { minSuccessRate: 0.9, minSamples: 5 },
  APPLY_WITH_LOG: { minSuccessRate: 0.7, minSamples: 3 },
  QUEUE_FOR_REVIEW: { minSuccessRate: 0, minSamples: 0 }
};
```

---

## Phase 4: Advanced Execution

### 4.1 Parallel Dispatch

**Depends on**: 3.1 (Task Router)

Execute independent subtasks on multiple models simultaneously.

**Contains**:
- Independent subtask detection
- Parallel execution across models
- Result aggregation

---

### 4.2 Context Priority Scoring

**Depends on**: 1.1 (Model Registry for context windows)

Smarter context selection than "include everything".

```javascript
const CONTEXT_PRIORITIES = {
  required_types: 1.0,      // Always include
  target_file: 0.95,        // Almost always
  related_imports: 0.8,     // Usually helpful
  patterns: 0.7,            // Good to have
  examples: 0.5,            // Nice to have
  full_files: 0.3           // Only if space
};
```

---

### 4.3 Quality Gate Confidence

**Standalone** (benefits from model stats)

Don't apply low-confidence changes automatically.

```javascript
const confidenceMarkers = {
  high: ["I'm confident", "This will work", "Straightforward"],
  low: ["I think", "might work", "not entirely sure", "assuming"]
};
```

---

## Phase 5: Distribution & Community

### 5.1 npm Package Distribution

**Depends on**: 0.1 (CLI Agnosticism - one package, multiple CLIs)

**Approach**:
- Package name: `wogi-flow`
- Global CLI: `npm install -g wogi-flow`
- Templates in package, runtime state stays per-project
- `flow upgrade` command for migrating projects

**Key requirement**: Every npm update must work perfectly - stability is critical.

---

### 5.1.1 Release Channel Configuration

**Depends on**: 5.1 (npm Package Distribution)

**Why**: When Wogi Flow becomes an npm package, users need to choose stable vs beta releases.

**Features**:
- `flow config set releaseChannel stable|beta`
- Auto-update notification preferences
- Version pinning options

**Implementation**:
```json
{
  "releaseChannel": "stable",  // stable | beta | canary
  "autoUpdate": {
    "enabled": true,
    "notifyOnly": false,
    "schedule": "daily"
  },
  "versionPinning": {
    "enabled": false,
    "pinnedVersion": null
  }
}
```

**CLI-Agnostic**: Core config option, bridges expose to CLI settings.

---

### 5.1.2 LSP Tool Integration

**Depends on**: 5.1 (npm Package Distribution)

**Why**: Code intelligence features (go-to-definition, find references) significantly improve developer experience.

**Features**:
- Go-to-definition for symbols
- Find all references
- Hover documentation
- Code outline/structure view
- Symbol search across codebase

**CLI-Agnostic Implementation**:
- Each CLI bridge leverages native LSP capabilities
- Claude Code: Uses built-in LSP tool
- Cursor: Uses VS Code LSP integration
- Other CLIs: Provide common LSP client wrapper

**Integration Points**:
- Skill patterns can reference symbols via LSP
- Component reuse checks via reference counting
- Auto-import suggestions in generated code

---

### 5.2 Skill Library Marketplace

**Depends on**: 5.1 (npm Package), 0.1 (CLI Agnosticism - skills work across CLIs)

**Features**:
1. **Remote Skill Repository** - GitHub-hosted, versioned, community contributions
2. **Skill Discovery** - Search, browse by framework/category
3. **Skill Installation** - One-command install with dependency resolution
4. **Skill Publishing** - Publish to community with validation
5. **Team Skills** - Private repositories for team-specific skills

**CLI Commands**:
```bash
./scripts/flow skill search "state management"
./scripts/flow skill install zustand
./scripts/flow skill publish my-skill
```

---

## Phase 6: Team & Integrations

### 6.1 Team Observability Web UI

**Depends on**: Team Backend (already exists)

Web UI for task progress, step status, execution history.

**Features**:
- Web dashboard showing all runs with status
- Per-step spans with inputs/outputs
- Retry history and failure context
- Team-wide task dashboard
- Role-based access (admin, lead, member)

---

### 6.2 Jira/Linear Integration

**Standalone** - can happen any time

Sync tasks from external project management tools.

**Features**:
- `/wogi-external-tasks` - List assigned tasks
- `/wogi-external-tasks --sync` - Sync completed back
- Auto-create stories in ready.json

```json
"integrations": {
  "jira": {
    "enabled": false,
    "baseUrl": "https://company.atlassian.net",
    "projectKey": "PROJ",
    "apiToken": "$JIRA_API_TOKEN"
  }
}
```

---

### 6.3 Background Sync Daemon

**Depends on**: 4.1 (Parallel Dispatch - multiple agents)

Keep state in sync when multiple agents work on different branches.

**Features**:
- File watching on .workflow/state/
- Sync on branch switch
- Automatic cache invalidation
- Heartbeat monitoring

---

## Deferred Items

These items are lower priority or need strong evidence before implementation.

### Structured JSON Contract
**Why deferred**: Local LLMs can't reliably produce JSON. Current `flow-response-parser.js` handles messy output.

### SQLite Telemetry
**Why deferred**: JSON files work fine for 50 runs/day. Would reconsider if users need complex queries.

### Move npm to @wogi Organization
**Why deferred**: Current `wogiflow` package works fine. Migration adds complexity (scoped package, update all docs). Consider when team grows or branding matters.

---

## Implemented Items ✅

### Loop Retry Learning ✅
- **Implemented**: 2026-01-09 in `scripts/flow-loop-retry-learning.js`
- **Features**: Analyzes tasks >3 iterations, identifies root causes, suggests pattern updates

### Failure Category Enum ✅ (Partial)
- **Implemented**: `ERROR_CATEGORIES` in `scripts/flow-adaptive-learning.js`
- **Note**: Needs formalization in Phase 0.2

### Strategy Effectiveness Tracking ✅
- **Implemented**: `scripts/flow-adaptive-learning.js`
- **Command**: `./scripts/flow hybrid learning effectiveness`

### Learning Deduplication ✅
- **Implemented**: 7-day window in `scripts/flow-adaptive-learning.js`

### Community Contribution ✅
- **Commands**: `flow hybrid learning contribute`, `--auto-pr` option

### Enhanced Installation ✅
- **Features**: Hub-spoke skills, tech stack wizard

### Component Index Freshness ✅
- **Features**: afterTask, staleCheck, gitHooks

### Guided Edit Mode ✅
- **Implemented**: `flow-guided-edit.js`, `/wogi-guided-edit` command

---

## Future Enhancements

### Browser Testing Integration
**Priority**: Medium
**Status**: Planned

Integrate browser-based testing into the workflow for UI verification.

**Features**:
- Automated browser test suggestions after UI changes
- Integration with Playwright/Puppeteer for E2E tests
- Visual regression testing support
- Manual test checklist generation for complex UI flows

**CLI Commands**:
```bash
flow browser-test suggest     # Suggest tests for recent changes
flow browser-test run         # Run browser tests
flow browser-test visual      # Run visual regression tests
```

**Integration Points**:
- Post-task hook to suggest browser tests
- Quality gate for UI-related tasks
- Screenshot comparison for visual regressions

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-12 | Added: Browser Testing Integration (Future Enhancements) |
| 2026-01-11 | Added: Release Channel Configuration (Phase 5.1.1) |
| 2026-01-11 | Added: LSP Tool Integration (Phase 5.1.2) |
| 2026-01-10 | **Reorganized roadmap by dependencies** - phases replace priorities |
| 2026-01-10 | **CLI Agnosticism + Multi-Model designed in parallel** |
| 2026-01-10 | Added: Variable Substitution in Config (Phase 0.3) |
| 2026-01-09 | Added: Hosted Pricing & Performance Table (Phase 2.1) |
| 2026-01-09 | Added: npm Package Distribution (Phase 5.1) |
| 2026-01-09 | ✅ Implemented: Loop Retry Learning |
| 2026-01-08 | Added: Skill Library Marketplace (Phase 5.2) |
| 2026-01-08 | Added: CLI Agnosticism, Multi-Model Mode |
| 2026-01-08 | Added: Jira/Linear Integration (Phase 6.2) |
| 2026-01-07 | Added: Team Observability Web UI (Phase 6.1) |
| 2026-01-06 | Added: Background Sync Daemon (Phase 6.3) |
| 2026-01-02 | Initial backlog created |
