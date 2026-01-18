# Specification Amendments: Gap Analysis & Fixes

**Created**: 2026-01-18
**Purpose**: Address gaps, overlaps, and risks identified when comparing spec against existing WogiFlow implementation

---

## Critical Findings Summary

| Issue Type | Count | Risk Level |
|------------|-------|------------|
| **Redundancies** | 3 | High - Will confuse users |
| **Missing Integrations** | 5 | Medium - Features won't connect |
| **Schema Changes** | 2 | Medium - Migration needed |
| **New Commands** | 2 | Low - Additive |
| **Breaks/Rewiring** | 4 | High - Must fix before implementing |

---

## 1. REDUNDANCY: Story Decomposition vs Hierarchical Tasks

### Current State
```javascript
// flow-story.js line 375
{
  type: 'sub-task',
  parent: taskId,  // <-- Parent relationship already exists!
  // But no 'level' field
}
```

```json
// config.json already has:
"storyDecomposition": {
  "autoDetect": true,
  "autoDecompose": false,
  "complexityThreshold": "medium",
  "minSubTasks": 5
}
```

### Problem
The spec proposes NEW fields (`parentId`, `level`, `epics` array) but:
- `parent` field already exists on sub-tasks
- `storyDecomposition` config already handles story→task decomposition
- Creating parallel systems will confuse users

### Amendment

**INSTEAD OF** creating new `hierarchy` config section, **EXTEND** existing `storyDecomposition`:

```json
{
  "storyDecomposition": {
    "autoDetect": true,
    "autoDecompose": false,
    "complexityThreshold": "medium",
    "minSubTasks": 5,

    // NEW: Hierarchical extensions
    "supportEpics": true,           // Enable Epic level (L0)
    "autoClassify": true,           // Auto-classify requests
    "epicThreshold": {
      "minFiles": 15,
      "minStories": 3
    },
    "propagateProgress": true,      // Propagate status to parent
    "levelField": true              // Add 'level' field to tasks
  }
}
```

**Rename** `parentId` in spec to `parent` to match existing field.

**Files to modify instead of create:**
- `scripts/flow-story.js` - Extend, don't create flow-hierarchy.js
- `scripts/flow-utils.js` - Add level classification to existing task functions
- `scripts/flow-start.js` - Add parent awareness, progress propagation

---

## 2. REDUNDANCY: Verification Phases vs Progressive Implementation

### Current State
```javascript
// flow-verification.js line 309
const phases = ['spec', 'test', 'implementation', 'final'];

// These phases already track execution!
loopState.phases[phase] = {
  status: 'pending',
  startTime: new Date().toISOString()
};
```

```json
// config.json already has (disabled):
"phases": {
  "enabled": false,
  "definitions": []
}
```

### Problem
Spec proposes Contract→Skeleton→Core→EdgeCases→Polish phases, but:
- flow-verification.js already has 4-phase tracking
- Config already has `phases` (just disabled with empty definitions)
- durable-session.js has step tracking that could be phase-aware

### Amendment

**INSTEAD OF** creating `flow-phased-execution.js`, **EXTEND** existing systems:

1. **Enable and populate existing `phases` config:**
```json
{
  "phases": {
    "enabled": true,
    "useForImplementation": true,  // NEW: Enable for task implementation
    "definitions": [
      { "name": "contract", "steps": ["define-interfaces", "type-contracts"] },
      { "name": "skeleton", "steps": ["create-files", "wire-imports"] },
      { "name": "core", "steps": ["implement-happy-path", "core-tests"] },
      { "name": "edge-cases", "steps": ["error-handling", "validation"] },
      { "name": "polish", "steps": ["conventions", "lint", "review"] }
    ],
    "contextIsolation": true,      // NEW: Fresh context per phase
    "maxBacktracks": 2,
    "checkpointAfterPhase": true
  }
}
```

2. **Extend flow-verification.js** to use configurable phases instead of hardcoded `['spec', 'test', 'implementation', 'final']`

3. **Extend flow-durable-session.js** to track phase (already has step tracking):
```javascript
// Add to step object:
{
  phase: 'core',  // NEW field
  // ... existing fields
}
```

**Files to modify:**
- `scripts/flow-verification.js` - Make phases configurable
- `scripts/flow-durable-session.js` - Add phase tracking
- `.workflow/config.json` - Populate phases.definitions

---

## 3. GAP: Parent Progress Propagation Not Wired

### Current State
- `flow-story.js` creates tasks with `parent: taskId` (line 376)
- `flow-start.js` doesn't check for parent or propagate progress
- `flow-done.js` doesn't update parent when child completes

### Problem
Sub-tasks exist but parent status never auto-updates.

### Amendment

**Add to `flow-utils.js`:**
```javascript
/**
 * Update parent task progress when child completes
 */
async function propagateProgressToParent(childTaskId) {
  const ready = getReadyData();
  const child = findTaskInAllLists(ready, childTaskId);

  if (!child?.parent) return; // No parent

  const parent = findTaskInAllLists(ready, child.parent);
  if (!parent) return;

  // Find all children
  const children = findChildTasks(ready, parent.id);
  const completed = children.filter(c => c.status === 'completed').length;

  parent.progress = {
    total: children.length,
    completed,
    percentage: Math.round((completed / children.length) * 100)
  };

  // Auto-complete parent if all children done
  if (completed === children.length) {
    parent.status = 'completed';
    parent.completedAt = new Date().toISOString();
  }

  saveReadyData(ready);
}
```

**Modify `flow-done.js`:**
```javascript
// After moving task to completed, add:
const config = getConfig();
if (config.storyDecomposition?.propagateProgress !== false) {
  await propagateProgressToParent(taskId);
}
```

---

## 4. GAP: ready.json Schema Migration

### Current State
```json
{
  "ready": [...],
  "inProgress": [...],
  "blocked": [...],
  "recentlyCompleted": [...]
}
```

### Proposed State (from spec)
```json
{
  "epics": [...],          // NEW
  "ready": [
    {
      "id": "...",
      "level": "L2",       // NEW
      "parent": null,      // Renamed from parentId
      // ... existing fields
    }
  ]
}
```

### Amendment

**Make ALL new fields optional with defaults:**
```javascript
// In flow-utils.js, when reading tasks:
function normalizeTask(task) {
  return {
    ...task,
    level: task.level || 'L2',      // Default to Task level
    parent: task.parent || null,
    progress: task.progress || null
  };
}
```

**Migration is automatic** - old tasks work with new code.

**Validation update:**
```javascript
// Add to ready.json schema validation
const VALID_LEVELS = ['L0', 'L1', 'L2', 'L3'];
if (task.level && !VALID_LEVELS.includes(task.level)) {
  console.warn(`Invalid level ${task.level}, defaulting to L2`);
  task.level = 'L2';
}
```

---

## 5. BREAK: wogi-start Needs Flags

### Current State
```javascript
// flow-start.js line 97-98
const forceResume = process.argv.includes('--force-resume');
const skipSuspensionCheck = process.argv.includes('--skip-suspension');
// No --phased, --epic, --from-phase flags
```

### Amendment

**Add flags to flow-start.js:**
```javascript
const forceResume = process.argv.includes('--force-resume');
const skipSuspensionCheck = process.argv.includes('--skip-suspension');

// NEW flags
const phased = process.argv.includes('--phased');
const epicId = getArgValue('--epic');
const fromPhase = getArgValue('--from-phase');
const nextInEpic = process.argv.includes('--next');
```

**Add logic for --epic --next:**
```javascript
if (epicId && nextInEpic) {
  // Find next ready task in epic
  const nextTask = findNextTaskInEpic(epicId);
  if (!nextTask) {
    console.log('All tasks in epic completed!');
    process.exit(0);
  }
  taskId = nextTask.id;
}
```

**Update wogi-start.md:**
```markdown
## Options

### `--phased`
Enable phased implementation (Contract→Skeleton→Core→EdgeCases→Polish).

### `--epic=EPIC-ID --next`
Start the next ready task within an epic.

### `--from-phase=PHASE`
Resume from a specific phase (for crashed sessions).
```

---

## 6. BREAK: Review System Needs Rewiring

### Current State
```javascript
// wogi-review.md describes parallel execution:
// "Launch 3 agents in parallel (single message with 3 Task tool calls)"
```

### Problem
Switching to sequential multi-pass breaks existing parallel review pattern.

### Amendment

**Keep both options:**
```json
{
  "review": {
    "mode": "multiPass",  // "parallel" | "multiPass"

    // Parallel mode (existing)
    "parallel": {
      "agents": ["code-logic", "security", "architecture"]
    },

    // Multi-pass mode (new)
    "multiPass": {
      "enabled": true,
      "passes": ["structure", "logic", "security", "integration"],
      // ... rest of spec
    }
  }
}
```

**In wogi-review.md:**
```bash
/wogi-review                    # Uses config.review.mode
/wogi-review --parallel         # Force parallel mode
/wogi-review --multipass        # Force multi-pass mode
```

This preserves existing behavior while adding new capability.

---

## 7. GAP: Missing Classification Integration Points

### Flows That Need Classification:

| Flow | Current | Needs |
|------|---------|-------|
| `/wogi-story` | Creates story directly | Should classify first, may become epic |
| User request in chat | Goes through task gating | Should classify before gating |
| `/wogi-start` | Starts any task | Should warn if starting L0 without decomposition |
| `/wogi-done` | Completes task | Should update parent if hierarchical |

### Amendment

**Add to CLAUDE.md task gating:**
```markdown
### Step 2.5: Classify Request (NEW)

After determining size, classify the work item:

| Classification | Action |
|----------------|--------|
| Epic (L0) | STOP - Must create epic with `/wogi-epic` |
| Story (L1) | Create story with `/wogi-story` |
| Task (L2) | Create task inline or with `/wogi-story` |
| Subtask (L3) | Execute directly, no task required |

If classification is Epic but user wants to proceed without decomposition:
> "This appears to be an Epic (15+ files, multiple features).
> Creating without decomposition may lead to:
> - Context overflow
> - Lost progress on crash
> - Difficult reviews
>
> Proceed anyway? (Use --force-task to skip this check)"
```

---

## 8. GAP: Compact Command Needs Summary Tree Support

### Current State
```markdown
// wogi-compact.md is very simple:
"Compact the conversation to free up context space."
// Just saves to progress.md, no hierarchy
```

### Amendment

**Extend wogi-compact.md:**
```markdown
## Hierarchical Compaction (NEW)

When `config.compaction.strategy: "hierarchical"`:

1. Generate summary tree:
   - Root: Project-level summary
   - Session: Current session summary
   - Task: Current task summary
   - Steps: Per-step summaries (collapsed)

2. Save to `.workflow/state/summary-tree.json`

3. On context reload, expand only relevant branches

## Options

### `--preserve=PIN`
Keep specific sections expanded (by PIN from decisions.md).

### `--show-tree`
Display current summary tree structure.

### `--regenerate`
Force regeneration of all summaries (ignores cache).
```

---

## 9. BREAK: Scripts Referencing Task Structure

### Scripts that read ready.json and may break:

| Script | Risk | Fix |
|--------|------|-----|
| `flow-start.js` | Medium | Add level/parent handling |
| `flow-done.js` | Medium | Add progress propagation |
| `flow-story.js` | Low | Already has parent field |
| `flow-utils.js` | High | Core functions need updating |
| `flow-ready.js` | Medium | Display needs level/parent |
| `flow-status.js` | Medium | Status display needs hierarchy |
| `flow-bulk.js` | Low | Should respect epic ordering |
| `flow-deps.js` | High | Primary consumer of hierarchy |

### Amendment: Update Order

1. **First**: Update `flow-utils.js` with normalization
2. **Second**: Update `flow-done.js` with propagation
3. **Third**: Update `flow-start.js` with flags
4. **Fourth**: Update display commands (status, ready, deps)

---

## 10. Files to Create vs Modify

### Original Spec: 18 New Files

### Amended: 8 New, 10 Modify

**New Files (reduced):**
| File | Purpose |
|------|---------|
| `scripts/flow-review-passes/structure.js` | Structure review pass |
| `scripts/flow-review-passes/logic.js` | Logic review pass |
| `scripts/flow-review-passes/security.js` | Security review pass |
| `scripts/flow-review-passes/integration.js` | Integration review pass |
| `scripts/flow-summary-tree.js` | Hierarchical summary management |
| `scripts/flow-hypothesis-generator.js` | Error hypothesis generation |
| `scripts/flow-hypothesis-tester.js` | Hypothesis testing |
| `.claude/commands/wogi-epic.md` | Epic creation command |

**Modify Instead of Create:**
| Instead Of | Modify |
|------------|--------|
| flow-hierarchy.js | flow-story.js + flow-utils.js |
| flow-decomposition.js | flow-story.js (already has it) |
| flow-dependencies.js | flow-deps.js (extend existing) |
| flow-phased-execution.js | flow-verification.js + flow-durable-session.js |
| flow-phase-context.js | flow-context-gatherer.js |
| flow-recursive-recovery.js | flow-damage-control.js + flow-adaptive-learning.js |
| flow-context-expander.js | flow-context-scoring.js |
| flow-review-multipass.js | extend existing review in commands |

---

## 11. Implementation Order (Amended)

### Phase 0: Foundation (Unchanged)
- Add classification to flow-utils.js
- Update config schema
- No new files

### Phase 1: Multi-Pass Review (Amended)
- Create 4 pass files (new)
- Extend wogi-review.md (modify)
- Add multiPass config (modify)
- **Keep parallel mode as fallback**

### Phase 2: Recursive Compaction (Amended)
- Create flow-summary-tree.js (new)
- Extend flow-context-scoring.js (modify)
- Extend wogi-compact.md (modify)

### Phase 3: Progressive Phases (Amended)
- **Extend** flow-verification.js (modify)
- **Extend** flow-durable-session.js (modify)
- **Enable** existing phases config (modify)
- Add --phased to wogi-start (modify)

### Phase 4: Hierarchical Tasks (Amended)
- **Extend** flow-story.js with epic support (modify)
- **Extend** flow-utils.js with propagation (modify)
- **Extend** flow-done.js with parent updates (modify)
- Create wogi-epic.md command (new)
- Extend flow-deps.js for visualization (modify)

### Phase 5: Recursive Recovery (Amended)
- Create hypothesis generator/tester (new)
- **Extend** flow-adaptive-learning.js (modify)
- **Extend** flow-damage-control.js (modify)

---

## 12. Test Cases for Backward Compatibility

### Must Pass After All Changes:

```bash
# Existing workflows still work
flow story "Simple task"                    # Creates L2 task
flow story "Complex story" --deep           # Creates with sub-tasks
flow start wf-XXXXXXXX                      # Starts normally
flow done wf-XXXXXXXX                       # Completes normally

# New workflows work
flow story "Big system"                     # Detects as Epic, prompts
flow epic "Auth System"                     # Creates L0 with decomposition
flow start --epic=epic-001 --next           # Starts next task in epic
flow start wf-XXX --phased                  # Uses phased execution

# Edge cases
flow start wf-XXX                           # Old task without level field works
flow done wf-sub-01                         # Propagates to parent
```

---

## 13. Config Migration Script

```javascript
// scripts/migrate-recursive-enhancements.js

function migrateConfig(config) {
  // 1. Extend storyDecomposition
  config.storyDecomposition = {
    ...config.storyDecomposition,
    supportEpics: true,
    autoClassify: true,
    propagateProgress: true
  };

  // 2. Enable phases
  config.phases = {
    enabled: true,
    definitions: [
      { name: 'contract', steps: ['interfaces', 'types'] },
      { name: 'skeleton', steps: ['files', 'imports'] },
      { name: 'core', steps: ['happy-path', 'tests'] },
      { name: 'edge-cases', steps: ['errors', 'validation'] },
      { name: 'polish', steps: ['lint', 'review'] }
    ]
  };

  // 3. Add review multiPass
  config.review = {
    ...config.review,
    mode: 'parallel', // Default to existing behavior
    multiPass: {
      enabled: false, // Opt-in initially
      passes: ['structure', 'logic', 'security', 'integration']
    }
  };

  // 4. Add compaction strategy
  config.compaction = {
    strategy: 'linear', // Default to existing behavior
    hierarchical: {
      enabled: false
    }
  };

  return config;
}

function migrateReadyJson(ready) {
  // Add missing fields to all tasks
  const migrateTasks = (tasks) => tasks.map(t => ({
    ...t,
    level: t.level || 'L2',
    parent: t.parent || null
  }));

  return {
    ...ready,
    epics: ready.epics || [],
    ready: migrateTasks(ready.ready || []),
    inProgress: migrateTasks(ready.inProgress || []),
    blocked: migrateTasks(ready.blocked || []),
    recentlyCompleted: migrateTasks(ready.recentlyCompleted || [])
  };
}
```

---

## Summary of Amendments

| Original Spec | Amendment |
|---------------|-----------|
| Create 18 new files | Create 8 new, modify 10 existing |
| New `hierarchy` config | Extend existing `storyDecomposition` |
| New `phases` config | Enable and populate existing `phases` |
| New `parentId` field | Use existing `parent` field |
| Replace parallel review | Keep both parallel and multiPass modes |
| Break existing flows | Maintain backward compatibility |

**Risk Reduction:**
- No breaking changes to existing workflows
- Gradual opt-in for new features
- Migration script handles schema changes
- All new fields have sensible defaults

---

**End of Amendments**

*Apply these amendments to `recursive-enhancements-spec.md` before implementation.*
