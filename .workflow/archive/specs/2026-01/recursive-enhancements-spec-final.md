# Recursive Enhancements Specification (Final)

**Version**: 2.0.0 (Merged & Optimized)
**Created**: 2026-01-18
**Status**: ✅ IMPLEMENTED
**Completed**: 2026-01-18
**Inspired by**: arXiv:2512.24601 (Recursive Language Models)

## Implementation Summary

All 6 phases have been implemented and validated:

| Phase | Component | Files Created/Modified | Status |
|-------|-----------|------------------------|--------|
| 0 | Classification System | flow-utils.js (+4 functions) | ✅ Complete |
| 1 | Multi-Pass Review | flow-review-passes/* (5 files) | ✅ Complete |
| 2 | Recursive Context Compaction | flow-context-compact/* (4 files) | ✅ Complete |
| 3 | Progressive Implementation | flow-phased-task.js, flow-start.js | ✅ Complete |
| 4 | Hierarchical Task System | flow-epics.js, wogi-epics.md | ✅ Complete |
| 5 | Recursive Error Recovery | flow-error-recovery.js | ✅ Complete |

### New Files Created
- `scripts/flow-review-passes/index.js` - Multi-pass review orchestrator
- `scripts/flow-review-passes/structure.js` - Structure pass
- `scripts/flow-review-passes/logic.js` - Logic pass
- `scripts/flow-review-passes/security.js` - Security pass
- `scripts/flow-review-passes/integration.js` - Integration pass
- `scripts/flow-context-compact/index.js` - Context compaction API
- `scripts/flow-context-compact/summary-tree.js` - Hierarchical summary tree
- `scripts/flow-context-compact/section-extractor.js` - Relevance extraction
- `scripts/flow-context-compact/expander.js` - On-demand expansion
- `scripts/flow-phased-task.js` - Phase execution coordinator
- `scripts/flow-epics.js` - Epic management system
- `scripts/flow-error-recovery.js` - Recursive error recovery

### Modified Files
- `scripts/flow-utils.js` - Added classification functions
- `scripts/flow-start.js` - Added --phased flag
- `.workflow/config.json` - Added epics, errorRecovery, phases config
- `.claude/commands/wogi-start.md` - Added --phased documentation
- `.claude/commands/wogi-compact.md` - Updated with recursive compaction
- `.claude/commands/wogi-epics.md` - New epic management skill

---

---

## Executive Summary

This specification defines enhancements to WogiFlow based on recursive decomposition principles. After thorough analysis of existing code, all proposed features are designed to **EXTEND** existing systems rather than create parallel ones.

**Key Optimization**: We identified 18+ existing features that can be leveraged, reducing new code by ~60%.

---

## Pre-Implementation Checklist

Before implementing, verify these existing systems are understood:

| Existing System | Location | Status | Integration |
|-----------------|----------|--------|-------------|
| `parent` field on tasks | flow-story.js:376 | Working | Extend, don't create `parentId` |
| `storyDecomposition` config | config.json:132 | Enabled | Extend for epics |
| `phases` config | config.json:93 | **Disabled** | Enable and populate |
| `workflowSteps.codeReview` | flow-step-review.js | **Disabled** | Can coexist with /wogi-review |
| `damageControl` | flow-damage-control.js | **Disabled** | Integrate recovery |
| Adaptive learning | flow-adaptive-learning.js | Working | Extend for hypotheses |
| Verification phases | flow-verification.js:309 | Hardcoded | Make configurable |
| Durable sessions | flow-durable-session.js | Working | Add phase tracking |

---

## Part 1: Classification System

### 1.1 Purpose
Auto-classify incoming requests as Epic/Story/Task/Subtask to determine appropriate workflow.

### 1.2 Classification Levels

| Level | Type | Files | Criteria | Workflow |
|-------|------|-------|----------|----------|
| L0 | Epic | 15+ | 3+ stories OR new subsystem | Decompose to stories |
| L1 | Story | 5-15 | 3-10 AC OR multi-component | Create spec, decompose |
| L2 | Task | 1-5 | 1-3 AC OR single concern | Direct implementation |
| L3 | Subtask | 1 | Atomic operation | Inline execution |

### 1.3 Implementation

**File to modify**: `scripts/flow-utils.js`

```javascript
/**
 * Classify a work item request
 * @param {string} request - User's request text
 * @param {object} context - Optional context (files mentioned, etc.)
 * @returns {object} { level: 'L0'|'L1'|'L2'|'L3', type: string, confidence: number }
 */
function classifyWorkItem(request, context = {}) {
  const analysis = analyzeRequest(request, context);

  // Use existing codeComplexityCheck patterns if available
  const complexityHint = context.complexityHint || null;

  const scores = {
    epic: calculateEpicScore(analysis),
    story: calculateStoryScore(analysis),
    task: calculateTaskScore(analysis),
    subtask: calculateSubtaskScore(analysis)
  };

  // Return highest scoring classification
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [type, score] = sorted[0];

  return {
    level: { epic: 'L0', story: 'L1', task: 'L2', subtask: 'L3' }[type],
    type,
    confidence: Math.round(score * 100),
    analysis
  };
}

function analyzeRequest(request, context) {
  const lower = request.toLowerCase();

  return {
    estimatedFiles: estimateFileCount(request, context),
    hasSystemKeywords: /system|architecture|migration|platform|redesign/i.test(request),
    hasFeatureKeywords: /feature|flow|integration|module/i.test(request),
    hasTaskKeywords: /add|fix|update|change|remove|button|field/i.test(request),
    mentionedComponents: extractComponents(request),
    complexity: estimateComplexity(request)
  };
}
```

### 1.4 Config Extension

**File to modify**: `.workflow/config.json`

Add to existing `storyDecomposition` section (DO NOT create new section):

```json
{
  "storyDecomposition": {
    "autoDetect": true,
    "autoDecompose": false,
    "complexityThreshold": "medium",
    "minSubTasks": 5,

    "classification": {
      "enabled": true,
      "autoClassify": true,
      "warnOnMismatch": true,
      "thresholds": {
        "epic": { "minFiles": 15, "minStories": 3 },
        "story": { "minFiles": 5, "maxFiles": 15, "minCriteria": 3 },
        "task": { "minFiles": 1, "maxFiles": 5, "minCriteria": 1 }
      },
      "keywords": {
        "epic": ["system", "architecture", "migration", "redesign"],
        "story": ["feature", "flow", "integration", "module"],
        "task": ["add", "fix", "update", "change"]
      }
    },
    "supportEpics": true,
    "propagateProgress": true
  }
}
```

### 1.5 Files to Modify (NOT Create)

| File | Changes |
|------|---------|
| `scripts/flow-utils.js` | Add `classifyWorkItem()`, `normalizeTask()` |
| `.workflow/config.json` | Extend `storyDecomposition` |
| `.workflow/config.schema.json` | Add classification schema |
| `CLAUDE.md` | Update task gating section |

---

## Part 2: Multi-Pass Review System

### 2.1 Architecture

Two review systems coexist:
1. **Static Review** (`workflowSteps.codeReview` → `flow-step-review.js`) - Pattern-based, runs automatically
2. **LLM Review** (`/wogi-review` command) - Uses Task agents, runs on demand

Multi-pass enhances the **LLM Review** path only.

### 2.2 Pass Definitions

```
PASS 1: Structure (Haiku - fast, cheap)
├── File organization, naming
├── Known anti-patterns from decisions.md
├── Context: File list only, no content
└── Output: files_to_examine[], structural_issues[]

PASS 2: Logic (Sonnet - balanced)
├── Business logic, edge cases
├── Only examines files_to_examine from Pass 1
├── Context: File contents + interfaces
└── Output: logic_issues[], test_gaps[]

PASS 3: Security (Sonnet, conditional)
├── Runs if: security patterns detected OR high-risk files
├── OWASP checks, injection risks
├── Context: Security-relevant code only
└── Output: vulnerabilities[]

PASS 4: Integration (Sonnet, conditional)
├── Runs if: 5+ files OR API changes
├── Breaking changes, contract drift
├── Context: API contracts, dependents
└── Output: breaking_changes[], conflicts[]
```

### 2.3 Implementation

**New files** (minimal - orchestration only):

| File | Purpose | Lines (est.) |
|------|---------|--------------|
| `scripts/flow-review-passes/index.js` | Pass orchestrator | ~200 |
| `scripts/flow-review-passes/structure.js` | Pass 1 logic | ~100 |
| `scripts/flow-review-passes/logic.js` | Pass 2 logic | ~100 |
| `scripts/flow-review-passes/security.js` | Pass 3 logic | ~100 |
| `scripts/flow-review-passes/integration.js` | Pass 4 logic | ~100 |

**Modify** (not create):

| File | Changes |
|------|---------|
| `.claude/commands/wogi-review.md` | Add `--multipass`, `--passes=`, `--parallel` flags |
| `.workflow/config.json` | Add `review.multiPass` section |

### 2.4 Config

```json
{
  "review": {
    "mode": "parallel",

    "multiPass": {
      "enabled": false,
      "passes": {
        "structure": { "enabled": true, "model": "haiku" },
        "logic": { "enabled": true, "model": "sonnet" },
        "security": { "enabled": true, "model": "sonnet", "conditional": true },
        "integration": { "enabled": true, "model": "sonnet", "conditional": true }
      },
      "earlyExitOnCritical": true,
      "passForward": true
    },

    "parallel": {
      "enabled": true,
      "agents": ["code-logic", "security", "architecture"]
    }
  }
}
```

### 2.5 Backward Compatibility

- Default: `mode: "parallel"` (existing behavior)
- `/wogi-review` works unchanged
- `/wogi-review --multipass` enables new behavior
- User can set `review.mode: "multiPass"` to make it default

---

## Part 3: Recursive Context Compaction

### 3.1 Concept

Replace linear summarization with hierarchical summary tree where:
- High-relevance sections stay expanded
- Low-relevance sections collapse to summaries
- Summaries can be expanded on-demand

### 3.2 Implementation

**New file**: `scripts/flow-summary-tree.js`

```javascript
/**
 * Summary Tree Manager
 *
 * Creates hierarchical summaries that can be selectively expanded
 * based on relevance to current task.
 */

const LEVELS = {
  PROJECT: 'project',    // Always loaded (~500 tokens)
  SESSION: 'session',    // Loaded if recent (~1000 tokens)
  TASK: 'task',          // Loaded if current (~500 tokens)
  STEP: 'step'           // On-demand (~200 tokens each)
};

async function generateSummaryTree(content, options) {
  // Identify natural sections using existing PIN markers
  const sections = identifySections(content);

  const tree = {
    id: generateId(),
    level: LEVELS.PROJECT,
    summary: null,
    hash: hashContent(content),
    children: [],
    expanded: true
  };

  for (const section of sections) {
    const relevance = calculateRelevance(section, options.currentTask);

    tree.children.push({
      id: section.pin || generateId(),
      level: LEVELS.SESSION,
      name: section.name,
      relevance,
      summary: relevance < 0.5 ? await summarize(section) : null,
      hash: hashContent(section.content),
      fullContent: section.content,
      expanded: relevance >= 0.5
    });
  }

  return tree;
}

function expandContext(tree, budget, task) {
  // Sort by relevance, expand high-relevance first
  // Collapse low-relevance to summaries
  // Respect token budget
}
```

**Modify** (leverage existing):

| File | Changes |
|------|---------|
| `scripts/flow-section-resolver.js` | Add expansion tracking |
| `scripts/flow-context-scoring.js` | Add hierarchy-aware scoring |
| `.claude/commands/wogi-compact.md` | Add `--hierarchical`, `--preserve=PIN` |

### 3.3 Config

```json
{
  "compaction": {
    "strategy": "linear",

    "hierarchical": {
      "enabled": false,
      "budgets": {
        "project": 500,
        "session": 1000,
        "task": 500,
        "step": 200
      },
      "relevanceThresholds": {
        "expand": 0.7,
        "summary": 0.4,
        "collapse": 0.0
      },
      "autoRefresh": true
    }
  }
}
```

---

## Part 4: Progressive Implementation Phases

### 4.1 Key Insight

**flow-verification.js line 309 already has phases**:
```javascript
const phases = ['spec', 'test', 'implementation', 'final'];
```

We should make this configurable, not create a parallel system.

### 4.2 Implementation

**Modify** `scripts/flow-verification.js`:

```javascript
// Instead of hardcoded:
// const phases = ['spec', 'test', 'implementation', 'final'];

// Use configurable:
function getPhases(config) {
  if (config.phases?.enabled && config.phases?.definitions?.length > 0) {
    return config.phases.definitions.map(p => p.name);
  }
  // Fallback to default
  return ['spec', 'test', 'implementation', 'final'];
}
```

**Enable and populate** existing `phases` config:

```json
{
  "phases": {
    "enabled": true,
    "useForImplementation": true,
    "definitions": [
      {
        "name": "contract",
        "description": "Define interfaces and type contracts",
        "steps": ["define-interfaces", "type-contracts", "interface-tests"],
        "contextIncludes": ["types/**", "interfaces/**"],
        "contextExcludes": ["**/*.impl.*"]
      },
      {
        "name": "skeleton",
        "description": "Create file structure and stubs",
        "steps": ["create-files", "implement-stubs", "wire-imports"],
        "contextIncludes": ["contracts", "src/**"],
        "contextExcludes": ["**/*.test.*"]
      },
      {
        "name": "core",
        "description": "Implement happy path logic",
        "steps": ["happy-path", "core-tests"],
        "contextIncludes": ["contracts", "related-impl"],
        "contextExcludes": ["error-handling"]
      },
      {
        "name": "edge-cases",
        "description": "Add error handling and validation",
        "steps": ["error-handling", "validation", "edge-tests"],
        "contextIncludes": ["contracts", "error-patterns"],
        "contextExcludes": ["happy-path-details"]
      },
      {
        "name": "polish",
        "description": "Apply conventions and final review",
        "steps": ["conventions", "lint-fix", "final-review"],
        "contextIncludes": ["style-guide", "patterns"],
        "contextExcludes": ["implementation-details"]
      }
    ],
    "contextIsolation": true,
    "maxBacktracks": 2,
    "checkpointAfterPhase": true
  }
}
```

### 4.3 Durable Session Extension

**Modify** `scripts/flow-durable-session.js`:

Add `phase` field to step tracking (existing structure):

```javascript
const STEP_TYPE = {
  ACCEPTANCE_CRITERIA: 'acceptance-criteria',
  HYBRID_EXECUTION: 'hybrid-execution',
  QUALITY_GATE: 'quality-gate',
  CUSTOM: 'custom',
  PHASE: 'phase'  // NEW
};

function createPhaseStep(phaseName, phaseConfig) {
  return {
    id: `phase-${phaseName}`,
    type: STEP_TYPE.PHASE,
    name: phaseName,
    description: phaseConfig.description,
    steps: phaseConfig.steps,
    status: STEP_STATUS.PENDING,
    contextConfig: {
      includes: phaseConfig.contextIncludes,
      excludes: phaseConfig.contextExcludes
    }
  };
}
```

### 4.4 Command Integration

**Modify** `scripts/flow-start.js` and `.claude/commands/wogi-start.md`:

```javascript
// Add flags
const phased = process.argv.includes('--phased');
const fromPhase = getArgValue('--from-phase');
const skipToPhase = getArgValue('--skip-to-phase');

// If phased mode, create phase steps in durable session
if (phased && config.phases?.enabled) {
  const phases = config.phases.definitions;
  for (const phase of phases) {
    session.steps.push(createPhaseStep(phase.name, phase));
  }
}
```

---

## Part 5: Hierarchical Task System (Epics)

### 5.1 Key Insight

**flow-story.js already creates sub-tasks with `parent` field** (line 376):
```javascript
{
  type: 'sub-task',
  parent: taskId,
  // ...
}
```

We extend this, not replace it.

### 5.2 Schema Extension

**Normalize tasks** to include optional fields:

```javascript
// In flow-utils.js
function normalizeTask(task) {
  return {
    ...task,
    level: task.level || 'L2',        // Default: Task
    parent: task.parent || null,       // Use existing field
    children: task.children || [],     // NEW: child task IDs
    progress: task.progress || null    // NEW: { total, completed, percentage }
  };
}
```

### 5.3 Progress Propagation

**Modify** `scripts/flow-done.js`:

```javascript
// After completing a task, propagate to parent
async function completeTask(taskId, options) {
  // ... existing completion logic ...

  // NEW: Propagate progress to parent
  const config = getConfig();
  if (config.storyDecomposition?.propagateProgress !== false) {
    await propagateProgressToParent(taskId);
  }
}

async function propagateProgressToParent(childId) {
  const ready = getReadyData();
  const child = findTaskInAllLists(ready, childId);

  if (!child?.parent) return;

  const parent = findTaskInAllLists(ready, child.parent);
  if (!parent) return;

  // Find all children of this parent
  const siblings = findAllWithParent(ready, parent.id);
  const completed = siblings.filter(s => s.status === 'completed').length;

  parent.progress = {
    total: siblings.length,
    completed,
    percentage: Math.round((completed / siblings.length) * 100)
  };

  // Auto-complete parent if all children done
  if (completed === siblings.length && siblings.length > 0) {
    parent.status = 'completed';
    parent.completedAt = new Date().toISOString();
    parent.autoCompleted = true;
  }

  await saveReadyData(ready);
}
```

### 5.4 Epic Creation Command

**New file**: `.claude/commands/wogi-epic.md`

```markdown
Create an epic with automatic story decomposition.

## Usage

```bash
/wogi-epic "User Authentication System"
/wogi-epic "Auth System" --stories=3
/wogi-epic "Payment Integration" --no-decompose
```

## Workflow

1. Classify request (should be L0/Epic)
2. If not L0, warn and offer to create as story instead
3. Generate epic with:
   - High-level description
   - Proposed stories (3-5 typical)
   - Dependencies between stories
4. Create epic in ready.json with `type: "epic"`, `level: "L0"`
5. If `--decompose` (default): Create story specs
6. Show epic hierarchy with `/wogi-deps EPIC-ID`
```

### 5.5 Dependencies Visualization

**Modify** `scripts/flow-deps.js`:

Add hierarchy visualization:

```
epic-auth-001: User Authentication System [L0, EPIC]
├── wf-oauth-001: OAuth Integration [L1, STORY] ✓ COMPLETED
│   ├── wf-oauth-001-01: Google OAuth [L2, TASK] ✓
│   ├── wf-oauth-001-02: GitHub OAuth [L2, TASK] ✓
│   └── wf-oauth-001-03: Provider config [L2, TASK] ✓
│
├── wf-login-001: Login Flow [L1, STORY] ⏳ IN PROGRESS (67%)
│   ├── wf-login-001-01: Login form [L2, TASK] ✓
│   ├── wf-login-001-02: Login API [L2, TASK] ⏳
│   └── wf-login-001-03: Session mgmt [L2, TASK] ○
│
└── wf-register-001: Registration [L1, STORY] ○ READY
    └── (not yet decomposed)
```

---

## Part 6: Recursive Error Recovery

### 6.1 Key Insight

**flow-adaptive-learning.js already has**:
- Error categorization (`ERROR_CATEGORIES`)
- Strategy tracking (`trackStrategyEffectiveness`)
- Recovery recording (`recordSuccessfulRecovery`)
- Guidance generation (`generateGuidanceFromFailures`)

We add **hypothesis generation** on top of this.

### 6.2 Error Categories (Existing)

From flow-adaptive-learning.js:
- `IMPORT_ERROR`
- `TYPE_ERROR`
- `SYNTAX_ERROR`
- `MARKDOWN_POLLUTION`
- `INCOMPLETE_OUTPUT`
- `HALLUCINATION`
- `PARSE_ERROR`
- `RUNTIME_ERROR`
- `RATE_LIMIT`
- `API_ERROR`
- `CONTEXT_OVERFLOW`
- `CAPABILITY_MISMATCH`
- `MISSING_CONTEXT`
- `PATTERN_VIOLATION`

### 6.3 Hypothesis Generation

**New file**: `scripts/flow-hypothesis-generator.js`

```javascript
/**
 * Generate testable hypotheses from errors
 * Leverages existing ERROR_CATEGORIES from flow-adaptive-learning.js
 */

const { ERROR_CATEGORIES } = require('./flow-adaptive-learning');

const HYPOTHESIS_PATTERNS = {
  IMPORT_ERROR: [
    { hypothesis: 'File path is incorrect', test: 'check_file_exists', likelihood: 0.9 },
    { hypothesis: 'Export name is wrong', test: 'check_exports', likelihood: 0.8 },
    { hypothesis: 'Circular dependency', test: 'check_import_cycle', likelihood: 0.4 }
  ],
  TYPE_ERROR: [
    { hypothesis: 'Type definition outdated', test: 'check_type_definition', likelihood: 0.7 },
    { hypothesis: 'Missing type coercion', test: 'check_type_usage', likelihood: 0.6 },
    { hypothesis: 'Interface changed upstream', test: 'check_interface_changes', likelihood: 0.5 }
  ],
  // ... more patterns per category
};

function generateHypotheses(error, context, maxCount = 5) {
  // 1. Categorize error using existing system
  const category = categorizeError(error);

  // 2. Get pattern-based hypotheses
  const patternHypotheses = HYPOTHESIS_PATTERNS[category] || [];

  // 3. Add context-aware hypotheses
  const contextHypotheses = generateContextHypotheses(error, context);

  // 4. Rank by likelihood
  const all = [...patternHypotheses, ...contextHypotheses]
    .sort((a, b) => b.likelihood - a.likelihood)
    .slice(0, maxCount);

  return all;
}
```

### 6.4 Recursive Recovery Integration

**Modify** `scripts/flow-adaptive-learning.js`:

Add recursive recovery wrapper:

```javascript
async function recoverWithHypotheses(error, context, depth = 0) {
  const MAX_DEPTH = 3;

  if (depth > MAX_DEPTH) {
    return { success: false, reason: 'max_depth', hypothesisTree: context.hypothesisTree };
  }

  const hypotheses = generateHypotheses(error, context);
  context.hypothesisTree = context.hypothesisTree || [];

  for (const hypothesis of hypotheses) {
    const node = {
      id: generateId(),
      depth,
      hypothesis: hypothesis.hypothesis,
      likelihood: hypothesis.likelihood,
      status: 'testing'
    };
    context.hypothesisTree.push(node);

    const testResult = await testHypothesis(hypothesis, context);

    if (testResult.confirmed) {
      const fix = await generateFix(hypothesis, testResult);
      const fixResult = await applyFix(fix);

      if (fixResult.success) {
        node.status = 'fixed';
        recordSuccessfulRecovery(context.model, context.failures, { hypothesis, fix });
        return { success: true, fix, hypothesisTree: context.hypothesisTree };
      }

      if (fixResult.newError) {
        node.status = 'caused_new_error';
        return recoverWithHypotheses(fixResult.newError, context, depth + 1);
      }
    } else {
      node.status = 'not_confirmed';
    }
  }

  return { success: false, reason: 'all_hypotheses_failed', hypothesisTree: context.hypothesisTree };
}
```

### 6.5 Config

```json
{
  "recovery": {
    "recursive": {
      "enabled": false,
      "maxDepth": 3,
      "maxHypotheses": 5,
      "timeout": 300000
    },
    "hypothesisGeneration": {
      "usePatterns": true,
      "useAI": true,
      "aiModel": "haiku"
    },
    "learning": {
      "recordSuccessfulFixes": true,
      "recordFailedHypotheses": true
    }
  }
}
```

---

## Part 7: Implementation Plan (Final)

### Phase 0: Classification (Day 1-2)

| Task | File | Type | Lines |
|------|------|------|-------|
| Add `classifyWorkItem()` | flow-utils.js | Modify | +100 |
| Add `normalizeTask()` | flow-utils.js | Modify | +30 |
| Extend `storyDecomposition` config | config.json | Modify | +20 |
| Update config schema | config.schema.json | Modify | +50 |
| Update task gating | CLAUDE.md | Modify | +30 |

**Checkpoint**: Classification runs on 10 real requests, results match expectations.

### Phase 1: Multi-Pass Review (Day 3-5)

| Task | File | Type | Lines |
|------|------|------|-------|
| Create pass orchestrator | flow-review-passes/index.js | Create | ~200 |
| Create structure pass | flow-review-passes/structure.js | Create | ~100 |
| Create logic pass | flow-review-passes/logic.js | Create | ~100 |
| Create security pass | flow-review-passes/security.js | Create | ~100 |
| Create integration pass | flow-review-passes/integration.js | Create | ~100 |
| Update wogi-review.md | commands/wogi-review.md | Modify | +50 |
| Add review.multiPass config | config.json | Modify | +30 |

**Checkpoint**: Multi-pass review on 5 real PRs, results quality >= parallel mode.

### Phase 2: Recursive Compaction (Day 6-8)

| Task | File | Type | Lines |
|------|------|------|-------|
| Create summary tree manager | flow-summary-tree.js | Create | ~300 |
| Extend context scoring | flow-context-scoring.js | Modify | +50 |
| Extend section resolver | flow-section-resolver.js | Modify | +30 |
| Update wogi-compact.md | commands/wogi-compact.md | Modify | +40 |
| Add compaction config | config.json | Modify | +30 |

**Checkpoint**: Compact 100-message session, relevant context preserved, token savings > 40%.

### Phase 3: Progressive Phases (Day 9-11)

| Task | File | Type | Lines |
|------|------|------|-------|
| Make phases configurable | flow-verification.js | Modify | +50 |
| Add phase to durable session | flow-durable-session.js | Modify | +40 |
| Add --phased flag | flow-start.js | Modify | +30 |
| Enable phases config | config.json | Modify | +60 |
| Update wogi-start.md | commands/wogi-start.md | Modify | +40 |

**Checkpoint**: Phased execution on 3 features, context isolation works, backtrack recovery works.

### Phase 4: Hierarchical Tasks (Day 12-15)

| Task | File | Type | Lines |
|------|------|------|-------|
| Add progress propagation | flow-done.js | Modify | +60 |
| Add `findAllWithParent()` | flow-utils.js | Modify | +30 |
| Extend story for epics | flow-story.js | Modify | +80 |
| Create wogi-epic.md | commands/wogi-epic.md | Create | ~100 |
| Extend flow-deps.js | flow-deps.js | Modify | +50 |
| Enable propagateProgress | config.json | Modify | +10 |

**Checkpoint**: Create epic with 3 stories/9 tasks, complete through hierarchy, progress propagates.

### Phase 5: Recursive Recovery (Day 16-18)

| Task | File | Type | Lines |
|------|------|------|-------|
| Create hypothesis generator | flow-hypothesis-generator.js | Create | ~200 |
| Add recoverWithHypotheses() | flow-adaptive-learning.js | Modify | +100 |
| Add hypothesis tree to last-failure.json | flow-adaptive-learning.js | Modify | +30 |
| Add recovery config | config.json | Modify | +30 |

**Checkpoint**: Test on 5 real error scenarios, hypothesis quality high, recovery rate > 50%.

### Final Integration (Day 19-20)

| Task | Description |
|------|-------------|
| Cross-feature testing | All features work together |
| Regression testing | Existing workflows unchanged |
| Documentation | Update all docs |
| Migration script | Create migrate-v2.js |

---

## Part 8: Files Summary

### New Files (8)

| File | Lines | Purpose |
|------|-------|---------|
| `scripts/flow-review-passes/index.js` | ~200 | Pass orchestrator |
| `scripts/flow-review-passes/structure.js` | ~100 | Structure pass |
| `scripts/flow-review-passes/logic.js` | ~100 | Logic pass |
| `scripts/flow-review-passes/security.js` | ~100 | Security pass |
| `scripts/flow-review-passes/integration.js` | ~100 | Integration pass |
| `scripts/flow-summary-tree.js` | ~300 | Hierarchical summaries |
| `scripts/flow-hypothesis-generator.js` | ~200 | Hypothesis generation |
| `.claude/commands/wogi-epic.md` | ~100 | Epic creation |

**Total new code**: ~1,200 lines

### Modified Files (15)

| File | Changes |
|------|---------|
| `scripts/flow-utils.js` | +160 lines |
| `scripts/flow-done.js` | +60 lines |
| `scripts/flow-start.js` | +40 lines |
| `scripts/flow-story.js` | +80 lines |
| `scripts/flow-verification.js` | +50 lines |
| `scripts/flow-durable-session.js` | +40 lines |
| `scripts/flow-adaptive-learning.js` | +130 lines |
| `scripts/flow-context-scoring.js` | +50 lines |
| `scripts/flow-section-resolver.js` | +30 lines |
| `scripts/flow-deps.js` | +50 lines |
| `.workflow/config.json` | +200 lines |
| `.workflow/config.schema.json` | +300 lines |
| `.claude/commands/wogi-review.md` | +50 lines |
| `.claude/commands/wogi-compact.md` | +40 lines |
| `.claude/commands/wogi-start.md` | +40 lines |
| `CLAUDE.md` | +30 lines |

**Total modifications**: ~1,350 lines

**Grand total**: ~2,550 lines (vs original spec ~4,500 lines = 43% reduction)

---

## Part 9: Backward Compatibility

### All existing commands work unchanged:

```bash
# These all work exactly as before
flow story "Simple task"
flow story "Complex story" --deep
flow start wf-XXXXXXXX
flow done wf-XXXXXXXX
/wogi-review
/wogi-compact
```

### New features are opt-in:

| Feature | Default | Enable |
|---------|---------|--------|
| Classification | Runs but doesn't block | Works automatically |
| Multi-pass review | Disabled | `review.mode: "multiPass"` or `--multipass` |
| Hierarchical compaction | Disabled | `compaction.strategy: "hierarchical"` |
| Progressive phases | Disabled | `phases.enabled: true` or `--phased` |
| Epic support | Disabled | `storyDecomposition.supportEpics: true` |
| Recursive recovery | Disabled | `recovery.recursive.enabled: true` |

### Migration is automatic:

- Old tasks without `level` field default to `L2`
- Old tasks without `parent` field default to `null`
- No manual migration required

---

## Part 10: Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Infinite recursion | Max depth limits, loop detection |
| Context fragmentation | Quality checks, fallback to full |
| Breaking existing flows | All features opt-in |
| Performance degradation | Async operations, benchmarks |
| Stale summaries | Hash-based invalidation |

---

**End of Specification**

*This document supersedes recursive-enhancements-spec.md and recursive-enhancements-spec-amendments.md*

*Ready for implementation approval.*
