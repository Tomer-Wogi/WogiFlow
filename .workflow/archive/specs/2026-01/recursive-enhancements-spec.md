# Recursive Enhancements Specification

**Version**: 1.0.0
**Created**: 2026-01-18
**Status**: Draft - Pending Approval
**Inspired by**: arXiv:2512.24601 (Recursive Language Models)

---

## Executive Summary

This specification defines five major enhancements to WogiFlow based on the principle that **recursive decomposition beats brute-force context scaling**. Each enhancement is designed to:

1. Improve handling of long/complex tasks
2. Reduce context waste through isolation
3. Enable crash recovery at finer granularity
4. Maintain backward compatibility with existing workflows

**Key Principle**: Each recursive level gets **fresh, focused context** rather than carrying forward accumulated context baggage.

---

## Table of Contents

1. [Epic/Story/Task Classification System](#1-epicstorytask-classification-system)
2. [Multi-Pass Review System](#2-multi-pass-review-system)
3. [Recursive Context Compaction](#3-recursive-context-compaction)
4. [Progressive Implementation Phases](#4-progressive-implementation-phases)
5. [Hierarchical Task Decomposition](#5-hierarchical-task-decomposition)
6. [Recursive Error Recovery](#6-recursive-error-recovery)
7. [Implementation Plan](#7-implementation-plan)
8. [Migration Strategy](#8-migration-strategy)
9. [Testing Strategy](#9-testing-strategy)
10. [Risk Mitigation](#10-risk-mitigation)

---

## 1. Epic/Story/Task Classification System

### 1.1 Overview

Define clear rules for when work items become Epics vs Stories vs Tasks. This forms the foundation for hierarchical task decomposition.

### 1.2 Classification Rules

| Level | Name | Criteria | Example |
|-------|------|----------|---------|
| **L0** | Epic | 15+ files OR 3+ stories OR cross-cutting concern OR new subsystem | "Add user authentication system" |
| **L1** | Story | 5-15 files OR 3-10 acceptance criteria OR 2+ related features | "Implement login flow with OAuth" |
| **L2** | Task | 1-5 files OR 1-3 acceptance criteria OR single concern | "Add login button to header" |
| **L3** | Subtask | 1 file OR 1 acceptance criterion OR atomic operation | "Style the login button" |

### 1.3 Automatic Classification Algorithm

```javascript
function classifyWorkItem(request) {
  const analysis = analyzeRequest(request);

  // Epic indicators (any 2+ triggers L0)
  const epicIndicators = [
    analysis.estimatedFiles >= 15,
    analysis.estimatedStories >= 3,
    analysis.affectsMultipleSubsystems,
    analysis.requiresNewSubsystem,
    analysis.estimatedDays >= 5,
    analysis.keywords.includes('system') || analysis.keywords.includes('architecture'),
  ];

  // Story indicators (any 2+ triggers L1)
  const storyIndicators = [
    analysis.estimatedFiles >= 5 && analysis.estimatedFiles < 15,
    analysis.estimatedCriteria >= 3 && analysis.estimatedCriteria <= 10,
    analysis.requiresMultipleComponents,
    analysis.estimatedDays >= 1 && analysis.estimatedDays < 5,
    analysis.hasUserFacingChanges && analysis.hasBackendChanges,
  ];

  // Task indicators
  const taskIndicators = [
    analysis.estimatedFiles >= 1 && analysis.estimatedFiles <= 5,
    analysis.estimatedCriteria >= 1 && analysis.estimatedCriteria <= 3,
    analysis.singleConcern,
    analysis.estimatedHours >= 1 && analysis.estimatedHours < 8,
  ];

  const epicScore = epicIndicators.filter(Boolean).length;
  const storyScore = storyIndicators.filter(Boolean).length;
  const taskScore = taskIndicators.filter(Boolean).length;

  if (epicScore >= 2) return { level: 'L0', type: 'epic' };
  if (storyScore >= 2) return { level: 'L1', type: 'story' };
  if (taskScore >= 2) return { level: 'L2', type: 'task' };
  return { level: 'L3', type: 'subtask' };
}
```

### 1.4 User Override Rules

- User can always override automatic classification
- Promoted classification (task → story) is allowed freely
- Demoted classification (story → task) requires confirmation
- Force small: `--force-task` flag bypasses classification

### 1.5 Configuration

```json
{
  "classification": {
    "enabled": true,
    "autoClassify": true,
    "defaultLevel": "task",
    "thresholds": {
      "epic": {
        "minFiles": 15,
        "minStories": 3,
        "minDays": 5
      },
      "story": {
        "minFiles": 5,
        "maxFiles": 15,
        "minCriteria": 3,
        "maxCriteria": 10
      },
      "task": {
        "minFiles": 1,
        "maxFiles": 5,
        "minCriteria": 1,
        "maxCriteria": 3
      }
    },
    "keywords": {
      "epic": ["system", "architecture", "migration", "redesign", "platform"],
      "story": ["feature", "flow", "integration", "module"],
      "task": ["add", "fix", "update", "change", "remove"]
    },
    "requireApprovalForEpic": true,
    "allowSmallEpics": true
  }
}
```

### 1.6 Files to Modify

| File | Change |
|------|--------|
| `scripts/flow-utils.js` | Add `classifyWorkItem()` function |
| `.workflow/config.json` | Add `classification` section |
| `.workflow/config.schema.json` | Add classification schema |
| `.claude/commands/wogi-story.md` | Integrate classification check |
| `CLAUDE.md` | Update task gating to use classification |

### 1.7 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Single-file epic (architecture doc) | Allow if `allowSmallEpics: true` |
| 20-file "bug fix" | Prompt: "This looks like an epic. Reclassify?" |
| User says "small task" but analysis says epic | Trust user with warning |
| Circular dependency between epics | Block: "Epic A depends on Epic B which depends on A" |

---

## 2. Multi-Pass Review System

### 2.1 Overview

Replace single-pass parallel review with staged sequential passes, each with fresh context focused on specific concerns.

### 2.2 Pass Definitions

```
┌─────────────────────────────────────────────────────────────┐
│ PASS 1: Structure & Patterns (Fast - Haiku/GPT-4o-mini)     │
│ Context: File list, naming conventions, known anti-patterns │
│ Time: ~30 seconds                                           │
│ Output: Structural issues, anti-pattern violations          │
├─────────────────────────────────────────────────────────────┤
│ PASS 2: Logic & Edge Cases (Balanced - Sonnet/GPT-4o)       │
│ Context: Changed files + relevant interfaces                │
│ Time: ~2 minutes                                            │
│ Output: Logic errors, missing edge cases, test gaps         │
├─────────────────────────────────────────────────────────────┤
│ PASS 3: Security & Performance (Deep - Opus when needed)    │
│ Context: Files flagged in P1/P2 + security patterns         │
│ Time: ~3 minutes                                            │
│ Output: Vulnerabilities, performance issues, OWASP checks   │
├─────────────────────────────────────────────────────────────┤
│ PASS 4: Integration & Breaking Changes (Fresh context)      │
│ Context: API contracts, dependent files, changelog          │
│ Time: ~2 minutes                                            │
│ Output: Breaking changes, API drift, integration issues     │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Pass Flow Control

```javascript
async function multiPassReview(changedFiles, options) {
  const results = { passes: [], summary: null };

  // Pass 1: Structure (always runs)
  const pass1 = await runPass('structure', {
    model: options.cheapModel || 'haiku',
    context: buildStructureContext(changedFiles),
    timeout: 30000,
  });
  results.passes.push(pass1);

  // Early exit if critical structural issues
  if (pass1.hasCritical && options.earlyExit) {
    return finalizeResults(results, 'stopped_at_pass_1');
  }

  // Pass 2: Logic (runs unless --quick)
  if (!options.quick) {
    const pass2 = await runPass('logic', {
      model: options.balancedModel || 'sonnet',
      context: buildLogicContext(changedFiles, pass1.flaggedFiles),
      timeout: 120000,
    });
    results.passes.push(pass2);

    if (pass2.hasCritical && options.earlyExit) {
      return finalizeResults(results, 'stopped_at_pass_2');
    }
  }

  // Pass 3: Security (runs for security-sensitive files or --security flag)
  const needsSecurityPass =
    options.security ||
    pass1.flaggedForSecurity.length > 0 ||
    changedFiles.some(f => isSecuritySensitive(f));

  if (needsSecurityPass) {
    const pass3 = await runPass('security', {
      model: options.deepModel || 'sonnet', // Opus only if really needed
      context: buildSecurityContext(changedFiles, pass1, pass2),
      timeout: 180000,
    });
    results.passes.push(pass3);
  }

  // Pass 4: Integration (runs for 5+ files or --integration flag)
  if (changedFiles.length >= 5 || options.integration) {
    const pass4 = await runPass('integration', {
      model: options.balancedModel || 'sonnet',
      context: buildIntegrationContext(changedFiles),
      timeout: 120000,
    });
    results.passes.push(pass4);
  }

  return finalizeResults(results, 'completed');
}
```

### 2.4 Context Isolation Per Pass

| Pass | Included | Excluded |
|------|----------|----------|
| Structure | File paths, line counts, naming patterns, anti-pattern rules | File contents, implementation details |
| Logic | Changed file contents, interfaces, related tests | Unrelated files, full codebase |
| Security | Security-flagged files, OWASP patterns, auth flows | Non-sensitive code |
| Integration | API contracts, exports/imports, dependent file list | Implementation internals |

### 2.5 Configuration

```json
{
  "review": {
    "multiPass": {
      "enabled": true,
      "defaultPasses": ["structure", "logic"],
      "conditionalPasses": {
        "security": {
          "triggerOnPatterns": ["auth", "crypto", "payment", "api-key"],
          "triggerOnFileCount": null
        },
        "integration": {
          "triggerOnPatterns": ["api", "contract", "export"],
          "triggerOnFileCount": 5
        }
      },
      "earlyExitOnCritical": true,
      "models": {
        "structure": "haiku",
        "logic": "sonnet",
        "security": "sonnet",
        "integration": "sonnet"
      },
      "timeouts": {
        "structure": 30000,
        "logic": 120000,
        "security": 180000,
        "integration": 120000
      }
    },
    "parallel": {
      "enabled": false,
      "deprecationWarning": "Use multiPass instead"
    }
  }
}
```

### 2.6 Command Integration

```bash
# Full review (all applicable passes)
/wogi-review

# Quick review (structure only)
/wogi-review --quick

# Specific passes
/wogi-review --passes=structure,security

# Force all passes
/wogi-review --all-passes

# Skip to specific pass (debugging)
/wogi-review --start-from=security
```

### 2.7 Output Format

```markdown
═══════════════════════════════════════════════════════════════
                     MULTI-PASS REVIEW REPORT
═══════════════════════════════════════════════════════════════

PASS 1: STRUCTURE & PATTERNS ✓ (28s)
────────────────────────────────────────────────────────────────
Model: claude-3-5-haiku
Files analyzed: 12
Issues found: 2 (0 critical, 1 high, 1 medium)

[HIGH] Naming convention violation
  File: src/components/userAuth.tsx (should be UserAuth.tsx)
  Pattern: Component files should use PascalCase

[MEDIUM] Possible code duplication
  Files: src/utils/format.ts, src/helpers/formatter.ts
  Pattern: Similar functionality in multiple locations

PASS 2: LOGIC & EDGE CASES ✓ (1m 42s)
────────────────────────────────────────────────────────────────
Model: claude-sonnet-4-20250514
Files analyzed: 3 (focused on flagged + changed)
Issues found: 1 (0 critical, 0 high, 1 medium)

[MEDIUM] Missing error handling
  File: src/components/userAuth.tsx:45
  Issue: OAuth callback doesn't handle network timeout
  Suggestion: Add try-catch with timeout handling

PASS 3: SECURITY ⊘ SKIPPED
────────────────────────────────────────────────────────────────
Reason: No security-sensitive patterns detected

PASS 4: INTEGRATION ✓ (1m 15s)
────────────────────────────────────────────────────────────────
Model: claude-sonnet-4-20250514
Files analyzed: 8 (exports + dependents)
Issues found: 1 (1 critical, 0 high, 0 medium)

[CRITICAL] Breaking change detected
  File: src/api/auth.ts
  Issue: loginUser() signature changed - 3 consumers affected
  Affected: src/pages/Login.tsx, src/hooks/useAuth.ts, tests/auth.test.ts
  Suggestion: Add backward-compatible overload or migration guide

═══════════════════════════════════════════════════════════════
                           SUMMARY
═══════════════════════════════════════════════════════════════
Total time: 3m 25s
Passes run: 3/4
Issues: 4 total (1 critical, 1 high, 2 medium)

Action required: Fix CRITICAL issue before merging
```

### 2.8 Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/flow-review-multipass.js` | Create | Multi-pass review orchestrator |
| `scripts/flow-review-passes/structure.js` | Create | Structure pass implementation |
| `scripts/flow-review-passes/logic.js` | Create | Logic pass implementation |
| `scripts/flow-review-passes/security.js` | Create | Security pass implementation |
| `scripts/flow-review-passes/integration.js` | Create | Integration pass implementation |
| `.claude/commands/wogi-review.md` | Modify | Add multi-pass options |
| `.workflow/config.json` | Modify | Add `review.multiPass` config |
| `.workflow/state/review-history.json` | Create | Track pass results for learning |

### 2.9 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Pass 1 times out | Proceed with defaults, warn user |
| Pass 2 finds same issue as Pass 1 | Deduplicate in final report |
| All passes find 0 issues | Celebrate! Show "Clean review" |
| User cancels mid-review | Save partial results, allow resume |
| File changes during review | Warn, offer to restart affected passes |
| Model rate limited mid-review | Auto-fallback to next tier, continue |

---

## 3. Recursive Context Compaction

### 3.1 Overview

Replace linear summarization with hierarchical summary tree that preserves structure and enables on-demand expansion.

### 3.2 Hierarchy Structure

```
PROJECT SUMMARY (~500 tokens, always loaded)
├── Core architecture decisions
├── Active features in progress
└── Key patterns to follow

SESSION SUMMARY (~1000 tokens, loaded if recent)
├── Session goals
├── Completed work
├── Open questions
└── → [Expand for details]

TASK SUMMARY (~500 tokens, loaded if current)
├── Acceptance criteria status
├── Files modified
├── Blockers encountered
└── → [Expand for step details]

STEP DETAILS (~200 tokens each, on-demand)
├── Step 1: [collapsed]
├── Step 2: [collapsed]
└── Step 3: [expanded - currently active]
    ├── What was attempted
    ├── What failed
    └── Current state
```

### 3.3 Summary Generation Algorithm

```javascript
async function generateHierarchicalSummary(content, options) {
  const tree = {
    id: generateId(),
    level: 'root',
    summary: null,
    hash: null,
    children: [],
    fullContent: content,
    tokens: estimateTokens(content),
  };

  // If content fits in budget, no summarization needed
  if (tree.tokens <= options.budget) {
    return { tree, strategy: 'full' };
  }

  // Identify natural sections
  const sections = identifySections(content);

  for (const section of sections) {
    const child = {
      id: generateId(),
      level: 'section',
      name: section.name,
      relevance: calculateRelevance(section, options.currentTask),
      summary: null,
      hash: hashContent(section.content),
      children: [],
      fullContent: section.content,
      tokens: estimateTokens(section.content),
    };

    // Recursively summarize large sections
    if (child.tokens > options.sectionBudget) {
      const subSummary = await generateHierarchicalSummary(
        section.content,
        { ...options, budget: options.sectionBudget }
      );
      child.children = subSummary.tree.children;
      child.summary = await summarizeSection(section, options.model);
    }

    tree.children.push(child);
  }

  // Generate root summary
  tree.summary = await generateRootSummary(tree.children, options.model);
  tree.hash = hashContent(tree.summary);

  return { tree, strategy: 'hierarchical' };
}
```

### 3.4 On-Demand Expansion

```javascript
function expandContext(tree, budget, currentTask) {
  const result = [];
  let usedTokens = 0;

  // Always include root summary
  result.push({ type: 'summary', content: tree.summary });
  usedTokens += estimateTokens(tree.summary);

  // Sort children by relevance to current task
  const sortedChildren = tree.children
    .map(child => ({
      ...child,
      score: calculateRelevanceScore(child, currentTask),
    }))
    .sort((a, b) => b.score - a.score);

  // Expand high-relevance sections
  for (const child of sortedChildren) {
    if (usedTokens >= budget) break;

    if (child.score >= 0.8) {
      // High relevance: include full content
      result.push({ type: 'full', content: child.fullContent });
      usedTokens += child.tokens;
    } else if (child.score >= 0.5) {
      // Medium relevance: include summary + expandable marker
      result.push({
        type: 'summary',
        content: child.summary,
        expandable: true,
        childId: child.id,
      });
      usedTokens += estimateTokens(child.summary);
    } else {
      // Low relevance: just note existence
      result.push({
        type: 'collapsed',
        content: `[${child.name}: ${child.children.length} items - expand with /expand ${child.id}]`,
      });
      usedTokens += 20; // minimal token cost
    }
  }

  return { result, usedTokens, budget };
}
```

### 3.5 Staleness Detection

```javascript
function checkStaleness(tree) {
  const stale = [];

  function walk(node, path = []) {
    // Check if source content has changed
    const currentHash = hashContent(node.fullContent);
    if (currentHash !== node.hash) {
      stale.push({
        path: [...path, node.name || node.id],
        oldHash: node.hash,
        newHash: currentHash,
        tokens: node.tokens,
      });
    }

    // Check children
    for (const child of node.children || []) {
      walk(child, [...path, node.name || node.id]);
    }
  }

  walk(tree);
  return stale;
}

async function refreshStale(tree, staleNodes) {
  for (const staleInfo of staleNodes) {
    const node = findNodeByPath(tree, staleInfo.path);
    if (node) {
      // Regenerate summary for this node
      node.summary = await summarizeSection(
        { content: node.fullContent, name: node.name },
        { model: 'haiku' } // Use cheap model for refresh
      );
      node.hash = staleInfo.newHash;
    }
  }
  return tree;
}
```

### 3.6 Configuration

```json
{
  "compaction": {
    "strategy": "hierarchical",
    "budgets": {
      "root": 500,
      "session": 1000,
      "task": 500,
      "step": 200
    },
    "relevanceThresholds": {
      "full": 0.8,
      "summary": 0.5,
      "collapsed": 0.0
    },
    "staleness": {
      "enabled": true,
      "autoRefresh": true,
      "checkOnAccess": true
    },
    "models": {
      "summarize": "haiku",
      "refresh": "haiku"
    },
    "maxDepth": 4,
    "preserveOnCompact": ["currentTask", "keyFacts", "recentDecisions"]
  }
}
```

### 3.7 Command Integration

```bash
# Compact with hierarchical strategy
/wogi-compact

# Preserve specific sections
/wogi-compact --preserve=auth,security

# Expand collapsed section
/expand node-id-123

# Show summary tree structure
/wogi-compact --show-tree

# Force full regeneration
/wogi-compact --regenerate
```

### 3.8 Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/flow-summary-tree.js` | Create | Hierarchical summary management |
| `scripts/flow-context-expander.js` | Create | On-demand expansion logic |
| `.claude/commands/wogi-compact.md` | Modify | Add hierarchical options |
| `.workflow/state/summary-tree.json` | Create | Persist summary hierarchy |
| `.workflow/config.json` | Modify | Add `compaction` config |

### 3.9 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Relevant fact in deeply collapsed branch | Relevance scoring should surface it |
| Circular references in summaries | Detect cycles, break with placeholder |
| Summary larger than section | Use section directly, skip summary |
| All sections equally relevant | Fall back to recency-based ordering |
| Expand exhausts budget | Collapse least-relevant sibling to make room |

---

## 4. Progressive Implementation Phases

### 4.1 Overview

Implement features in distinct phases with fresh context per phase, enabling better focus and crash recovery at phase boundaries.

### 4.2 Phase Definitions

```
PHASE 1: CONTRACT (Fresh context: types, APIs, interfaces)
├── Define interfaces
├── Define function signatures
├── Define type contracts
├── Write interface tests (type-level)
└── Checkpoint: contracts-defined

PHASE 2: SKELETON (Fresh context: contracts + file structure)
├── Create file structure
├── Implement stubs
├── Wire up imports/exports
├── Verify builds
└── Checkpoint: skeleton-complete

PHASE 3: CORE LOGIC (Fresh context: contracts + relevant code)
├── Implement happy path
├── Write core unit tests
├── Verify tests pass
└── Checkpoint: core-working

PHASE 4: EDGE CASES (Fresh context: contracts + failure modes)
├── Add error handling
├── Add validation
├── Write edge case tests
├── Handle loading/error states
└── Checkpoint: robust

PHASE 5: POLISH (Fresh context: style guide + patterns)
├── Apply naming conventions
├── Ensure pattern compliance
├── Run full lint/typecheck
├── Final review
└── Checkpoint: complete
```

### 4.3 Phase Execution Flow

```javascript
async function executePhasedImplementation(task, options) {
  const session = await loadOrCreateDurableSession(task.id, 'phased');
  const phases = definePhasesForTask(task);

  for (let i = session.currentPhase || 0; i < phases.length; i++) {
    const phase = phases[i];

    // Build fresh context for this phase
    const context = await buildPhaseContext(phase, task, {
      excludePreviousPhaseDetails: true,
      includeCheckpoints: true,
    });

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`PHASE ${i + 1}: ${phase.name.toUpperCase()}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Execute phase steps
    for (const step of phase.steps) {
      session.currentStep = step.id;
      await saveDurableSession(session);

      try {
        const result = await executeStep(step, context);

        if (!result.success) {
          // Phase failed - decide whether to retry or backtrack
          const decision = await handlePhaseFailure(phase, step, result, session);

          if (decision.action === 'backtrack') {
            // Go back to previous phase
            i = decision.targetPhase - 1; // Will increment to targetPhase
            session.backtrackCount = (session.backtrackCount || 0) + 1;

            if (session.backtrackCount > 2) {
              return { success: false, reason: 'too_many_backtracks', session };
            }

            console.log(`⟲ Backtracking to Phase ${decision.targetPhase}`);
            break;
          } else if (decision.action === 'retry') {
            // Retry current step
            step.attempts = (step.attempts || 0) + 1;
            if (step.attempts > options.maxRetries) {
              return { success: false, reason: 'max_retries_exceeded', session };
            }
            continue;
          }
        }

        step.status = 'completed';
        step.completedAt = new Date().toISOString();
      } catch (error) {
        step.status = 'failed';
        step.error = error.message;
        throw error;
      }
    }

    // Phase checkpoint
    await createPhaseCheckpoint(task, phase, session);
    session.currentPhase = i + 1;
    session.completedPhases = session.completedPhases || [];
    session.completedPhases.push(phase.name);
    await saveDurableSession(session);

    console.log(`\n✓ Phase ${i + 1} complete: ${phase.name}`);
  }

  return { success: true, session };
}
```

### 4.4 Phase Context Isolation

| Phase | Context Includes | Context Excludes |
|-------|------------------|------------------|
| Contract | Type files, API specs, interface patterns | Implementation code |
| Skeleton | Contracts, file structure, import patterns | Business logic |
| Core Logic | Contracts, related implementations, test patterns | Error handling, polish |
| Edge Cases | Contracts, error patterns, validation rules | Happy path details |
| Polish | Style guide, naming patterns, lint rules | Implementation details |

### 4.5 Backtrack Detection

```javascript
function shouldBacktrack(phase, step, error) {
  // Check if error indicates earlier phase was wrong
  const backtrackIndicators = [
    {
      pattern: /interface.*does not match/i,
      targetPhase: 1, // Back to Contract
      reason: 'Interface definition was incorrect',
    },
    {
      pattern: /cannot find module/i,
      targetPhase: 2, // Back to Skeleton
      reason: 'File structure issue',
    },
    {
      pattern: /type.*is not assignable/i,
      targetPhase: 1, // Back to Contract
      reason: 'Type contract mismatch',
    },
  ];

  for (const indicator of backtrackIndicators) {
    if (indicator.pattern.test(error.message)) {
      return {
        shouldBacktrack: true,
        targetPhase: indicator.targetPhase,
        reason: indicator.reason,
      };
    }
  }

  return { shouldBacktrack: false };
}
```

### 4.6 Configuration

```json
{
  "phases": {
    "enabled": true,
    "autoDetect": true,
    "triggerFor": ["feature", "refactor"],
    "skipFor": ["bugfix", "docs"],
    "definitions": [
      {
        "name": "contract",
        "steps": ["define-interfaces", "define-signatures", "interface-tests"],
        "contextIncludes": ["types/**", "interfaces/**", "api/**"],
        "contextExcludes": ["**/*.impl.*", "**/*.test.*"]
      },
      {
        "name": "skeleton",
        "steps": ["create-files", "implement-stubs", "wire-imports"],
        "contextIncludes": ["contracts", "src/**"],
        "contextExcludes": ["**/*.test.*"]
      },
      {
        "name": "core",
        "steps": ["implement-happy-path", "write-core-tests", "verify-tests"],
        "contextIncludes": ["contracts", "related-impl"],
        "contextExcludes": ["error-handling", "edge-cases"]
      },
      {
        "name": "edge-cases",
        "steps": ["error-handling", "validation", "edge-case-tests"],
        "contextIncludes": ["contracts", "error-patterns"],
        "contextExcludes": ["happy-path-details"]
      },
      {
        "name": "polish",
        "steps": ["apply-conventions", "lint-fix", "final-review"],
        "contextIncludes": ["style-guide", "patterns"],
        "contextExcludes": ["implementation-details"]
      }
    ],
    "maxBacktracks": 2,
    "checkpointAfterPhase": true,
    "requirePhaseApproval": false
  }
}
```

### 4.7 Command Integration

```bash
# Start task with phased implementation
/wogi-start TASK-ID --phased

# Resume from specific phase
/wogi-start TASK-ID --from-phase=core

# Skip to phase (debugging)
/wogi-start TASK-ID --skip-to-phase=polish

# Show phase status
/wogi-status --phases
```

### 4.8 Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/flow-phased-execution.js` | Create | Phase orchestration logic |
| `scripts/flow-phase-context.js` | Create | Phase-specific context building |
| `scripts/flow-durable-session.js` | Modify | Add phase tracking fields |
| `.claude/commands/wogi-start.md` | Modify | Add `--phased` flag |
| `.workflow/config.json` | Modify | Enable and configure `phases` |

### 4.9 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Phase 1 wrong, discovered in Phase 4 | Backtrack with context from all phases |
| External dependency changes mid-phase | Detect via hash, warn, offer restart |
| Phase has 0 steps applicable | Skip phase, log warning |
| All phases complete but tests fail | Add implicit "verification" phase |
| User wants to skip phase | Allow with `--force-skip`, log warning |

---

## 5. Hierarchical Task Decomposition

### 5.1 Overview

Enable Epics to contain Stories, Stories to contain Tasks, and Tasks to contain Subtasks, with proper state management and dependency tracking.

### 5.2 Data Structures

#### 5.2.1 Enhanced ready.json

```json
{
  "lastUpdated": "2026-01-18T10:00:00.000Z",
  "epics": [
    {
      "id": "epic-auth-001",
      "title": "User Authentication System",
      "type": "epic",
      "level": "L0",
      "status": "in_progress",
      "priority": "P1",
      "stories": ["wf-login-001", "wf-register-001", "wf-oauth-001"],
      "progress": {
        "total": 3,
        "completed": 1,
        "inProgress": 1,
        "blocked": 0
      },
      "createdAt": "2026-01-15T10:00:00.000Z",
      "startedAt": "2026-01-16T09:00:00.000Z"
    }
  ],
  "ready": [
    {
      "id": "wf-register-001",
      "title": "Implement user registration",
      "type": "story",
      "level": "L1",
      "parentId": "epic-auth-001",
      "status": "ready",
      "priority": "P2",
      "tasks": [],
      "acceptanceCriteria": [...]
    }
  ],
  "inProgress": [
    {
      "id": "wf-login-001",
      "title": "Implement login flow",
      "type": "story",
      "level": "L1",
      "parentId": "epic-auth-001",
      "status": "in_progress",
      "tasks": ["wf-login-001-01", "wf-login-001-02", "wf-login-001-03"],
      "progress": {
        "total": 3,
        "completed": 1,
        "inProgress": 1,
        "blocked": 0
      }
    }
  ],
  "blocked": [],
  "recentlyCompleted": [
    {
      "id": "wf-oauth-001",
      "title": "OAuth provider integration",
      "type": "story",
      "level": "L1",
      "parentId": "epic-auth-001",
      "status": "completed",
      "completedAt": "2026-01-17T15:00:00.000Z"
    }
  ]
}
```

#### 5.2.2 Task Hierarchy

```
epic-auth-001 (Epic: User Authentication System)
├── wf-oauth-001 (Story: OAuth provider integration) ✓ COMPLETED
│   ├── wf-oauth-001-01 (Task: Add OAuth config) ✓
│   ├── wf-oauth-001-02 (Task: Implement Google OAuth) ✓
│   └── wf-oauth-001-03 (Task: Implement GitHub OAuth) ✓
│
├── wf-login-001 (Story: Implement login flow) ⏳ IN PROGRESS
│   ├── wf-login-001-01 (Task: Create login form) ✓ COMPLETED
│   ├── wf-login-001-02 (Task: Implement login API) ⏳ IN PROGRESS
│   │   ├── wf-login-001-02-a (Subtask: Add endpoint) ✓
│   │   ├── wf-login-001-02-b (Subtask: Add validation) ⏳
│   │   └── wf-login-001-02-c (Subtask: Add rate limiting) ○
│   └── wf-login-001-03 (Task: Add session management) ○ READY
│
└── wf-register-001 (Story: Implement user registration) ○ READY
    └── (tasks not yet decomposed)
```

### 5.3 Decomposition Algorithm

```javascript
async function decomposeWorkItem(item, options) {
  const classification = classifyWorkItem(item);

  if (classification.level === 'L0') {
    // Epic: decompose into stories
    return await decomposeEpic(item, options);
  } else if (classification.level === 'L1') {
    // Story: decompose into tasks
    return await decomposeStory(item, options);
  } else if (classification.level === 'L2') {
    // Task: optionally decompose into subtasks
    if (options.deep || shouldAutoDecompose(item)) {
      return await decomposeTask(item, options);
    }
  }

  return item; // L3 subtasks are atomic
}

async function decomposeEpic(epic, options) {
  const analysis = await analyzeEpicScope(epic);

  const stories = [];
  for (const feature of analysis.features) {
    const story = {
      id: generateStoryId(epic.id),
      title: feature.title,
      type: 'story',
      level: 'L1',
      parentId: epic.id,
      status: 'ready',
      description: feature.description,
      acceptanceCriteria: await generateAcceptanceCriteria(feature),
      tasks: [],
      dependencies: feature.dependencies,
    };
    stories.push(story);
  }

  // Detect dependencies between stories
  const withDeps = await detectStoryDependencies(stories);

  // Order stories by dependency graph
  const ordered = topologicalSort(withDeps);

  epic.stories = ordered.map(s => s.id);
  epic.progress = { total: ordered.length, completed: 0, inProgress: 0, blocked: 0 };

  return { epic, stories: ordered };
}

async function decomposeStory(story, options) {
  const analysis = await analyzeStoryScope(story);

  const tasks = [];
  for (const criterion of story.acceptanceCriteria) {
    // Each criterion may become 1+ tasks
    const tasksForCriterion = await criterionToTasks(criterion, story);
    tasks.push(...tasksForCriterion);
  }

  // Add edge case tasks if enabled
  if (options.includeEdgeCases) {
    const edgeCaseTasks = await generateEdgeCaseTasks(story);
    tasks.push(...edgeCaseTasks);
  }

  // Detect dependencies between tasks
  const withDeps = await detectTaskDependencies(tasks);
  const ordered = topologicalSort(withDeps);

  story.tasks = ordered.map(t => t.id);
  story.progress = { total: ordered.length, completed: 0, inProgress: 0, blocked: 0 };

  return { story, tasks: ordered };
}
```

### 5.4 Dependency Management

```javascript
function detectDependencies(items) {
  const deps = new Map();

  for (const item of items) {
    deps.set(item.id, []);

    // Analyze for explicit dependencies
    for (const other of items) {
      if (item.id === other.id) continue;

      // Check if item references other
      if (itemReferences(item, other)) {
        deps.get(item.id).push(other.id);
      }

      // Check if item's files depend on other's files
      if (filesDepend(item.files, other.files)) {
        deps.get(item.id).push(other.id);
      }
    }
  }

  return deps;
}

function topologicalSort(items) {
  const deps = detectDependencies(items);
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(item) {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) {
      throw new Error(`Circular dependency detected involving ${item.id}`);
    }

    visiting.add(item.id);

    for (const depId of deps.get(item.id) || []) {
      const dep = items.find(i => i.id === depId);
      if (dep) visit(dep);
    }

    visiting.delete(item.id);
    visited.add(item.id);
    sorted.push(item);
  }

  for (const item of items) {
    visit(item);
  }

  return sorted;
}
```

### 5.5 Progress Propagation

```javascript
function updateProgress(taskId, newStatus) {
  const task = findTask(taskId);
  const oldStatus = task.status;
  task.status = newStatus;

  // Propagate to parent
  if (task.parentId) {
    const parent = findTask(task.parentId);
    updateParentProgress(parent);

    // Recursively propagate up
    if (parent.parentId) {
      updateProgress(parent.id, parent.status);
    }
  }
}

function updateParentProgress(parent) {
  const children = getChildren(parent.id);

  const progress = {
    total: children.length,
    completed: children.filter(c => c.status === 'completed').length,
    inProgress: children.filter(c => c.status === 'in_progress').length,
    blocked: children.filter(c => c.status === 'blocked').length,
  };

  parent.progress = progress;

  // Update parent status based on children
  if (progress.completed === progress.total) {
    parent.status = 'completed';
  } else if (progress.inProgress > 0 || progress.completed > 0) {
    parent.status = 'in_progress';
  } else if (progress.blocked > 0) {
    parent.status = 'blocked';
  } else {
    parent.status = 'ready';
  }
}
```

### 5.6 Configuration

```json
{
  "hierarchy": {
    "enabled": true,
    "maxDepth": 4,
    "autoDecompose": {
      "epic": true,
      "story": true,
      "task": false
    },
    "decompositionRules": {
      "epic": {
        "minStories": 2,
        "maxStories": 10,
        "requireApproval": true
      },
      "story": {
        "minTasks": 2,
        "maxTasks": 8,
        "requireApproval": false
      },
      "task": {
        "minSubtasks": 2,
        "maxSubtasks": 5,
        "triggerThreshold": 5
      }
    },
    "dependencies": {
      "autoDetect": true,
      "blockOnCycle": true,
      "visualize": true
    },
    "progress": {
      "propagateUp": true,
      "showInStatus": true,
      "showPercentage": true
    }
  }
}
```

### 5.7 Command Integration

```bash
# Create epic (triggers decomposition)
/wogi-epic "User Authentication System"

# View epic hierarchy
/wogi-deps epic-auth-001

# Start next available task in epic
/wogi-start --epic=epic-auth-001 --next

# View progress across hierarchy
/wogi-status --epic=epic-auth-001

# Manually decompose story
/wogi-story wf-login-001 --decompose

# Add task to story
/wogi-task wf-login-001 "Add rate limiting to login API"
```

### 5.8 Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/flow-hierarchy.js` | Create | Hierarchy management |
| `scripts/flow-decomposition.js` | Create | Decomposition algorithms |
| `scripts/flow-dependencies.js` | Create | Dependency detection & ordering |
| `scripts/flow-utils.js` | Modify | Add hierarchy operations |
| `.claude/commands/wogi-epic.md` | Create | Epic creation command |
| `.claude/commands/wogi-deps.md` | Modify | Add hierarchy visualization |
| `.workflow/state/ready.json` | Modify | Add `epics` array, `parentId` fields |
| `.workflow/config.json` | Modify | Add `hierarchy` config |

### 5.9 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Circular dependency A→B→A | Block with clear error message |
| Story completed but epic not | Auto-complete epic if all stories done |
| Task blocked by external epic | Show cross-epic dependency warning |
| User deletes parent while children exist | Orphan children, move to top level |
| Decomposition produces 1 item | Warn, allow but suggest not decomposing |
| 50+ items at one level | Suggest creating intermediate grouping |

---

## 6. Recursive Error Recovery

### 6.1 Overview

Replace linear retry with recursive hypothesis-driven recovery that decomposes errors into testable hypotheses.

### 6.2 Hypothesis Tree Structure

```
ERROR: "Cannot read property 'map' of undefined"
├── HYPOTHESIS 1: Data not loaded yet (async timing)
│   ├── Test: Check if data fetch completed
│   ├── Result: ✓ Fetch completed
│   └── Conclusion: NOT THE CAUSE
│
├── HYPOTHESIS 2: API returned unexpected format
│   ├── Test: Log API response structure
│   ├── Result: ✓ API returns { data: null } not { data: [] }
│   ├── Sub-hypothesis 2.1: Backend bug
│   │   ├── Test: Check backend logs
│   │   └── Result: ✗ Cannot access backend
│   ├── Sub-hypothesis 2.2: Handle null case
│   │   ├── Test: Add null check
│   │   └── Result: ✓ Error resolved
│   └── Conclusion: FIXED - null handling missing
│
└── HYPOTHESIS 3: Wrong variable accessed
    └── (Not tested - H2 resolved issue)
```

### 6.3 Recovery Algorithm

```javascript
async function recoverRecursively(error, context, depth = 0) {
  const MAX_DEPTH = 3;
  const MAX_HYPOTHESES = 5;

  if (depth > MAX_DEPTH) {
    return {
      success: false,
      reason: 'max_depth_exceeded',
      tree: context.hypothesisTree,
      suggestion: 'Manual intervention required',
    };
  }

  // Generate hypotheses for this error
  const hypotheses = await generateHypotheses(error, context, MAX_HYPOTHESES);

  // Sort by likelihood
  hypotheses.sort((a, b) => b.likelihood - a.likelihood);

  for (const hypothesis of hypotheses) {
    context.hypothesisTree.push({
      id: generateId(),
      depth,
      hypothesis: hypothesis.description,
      likelihood: hypothesis.likelihood,
      status: 'testing',
      children: [],
    });

    // Test hypothesis
    const testResult = await testHypothesis(hypothesis, context);

    if (testResult.confirmed) {
      // Try to fix based on hypothesis
      const fix = await generateFix(hypothesis, testResult, context);
      const fixResult = await applyFix(fix, context);

      if (fixResult.success) {
        updateHypothesisStatus(context.hypothesisTree, hypothesis.id, 'fixed');
        return {
          success: true,
          fix,
          tree: context.hypothesisTree,
        };
      } else if (fixResult.newError) {
        // Fix caused new error - recurse
        updateHypothesisStatus(context.hypothesisTree, hypothesis.id, 'caused_new_error');

        const subResult = await recoverRecursively(
          fixResult.newError,
          {
            ...context,
            parentHypothesis: hypothesis.id,
          },
          depth + 1
        );

        if (subResult.success) {
          return subResult;
        }
      }
    } else {
      updateHypothesisStatus(context.hypothesisTree, hypothesis.id, 'not_confirmed');
    }
  }

  // All hypotheses exhausted
  return {
    success: false,
    reason: 'all_hypotheses_failed',
    tree: context.hypothesisTree,
    suggestion: await generateManualSuggestion(error, context),
  };
}
```

### 6.4 Hypothesis Generation

```javascript
async function generateHypotheses(error, context, maxCount) {
  const hypotheses = [];

  // Pattern-based hypotheses
  const patterns = [
    {
      errorPattern: /cannot read property.*of undefined/i,
      hypotheses: [
        { description: 'Variable not initialized', likelihood: 0.8, test: 'check_initialization' },
        { description: 'Async data not loaded', likelihood: 0.7, test: 'check_async_timing' },
        { description: 'API returned unexpected null', likelihood: 0.6, test: 'check_api_response' },
      ],
    },
    {
      errorPattern: /cannot find module/i,
      hypotheses: [
        { description: 'Import path incorrect', likelihood: 0.9, test: 'check_file_exists' },
        { description: 'Module not installed', likelihood: 0.7, test: 'check_node_modules' },
        { description: 'Circular dependency', likelihood: 0.4, test: 'check_import_cycle' },
      ],
    },
    {
      errorPattern: /type.*is not assignable/i,
      hypotheses: [
        { description: 'Type definition outdated', likelihood: 0.7, test: 'check_type_definition' },
        { description: 'Missing type coercion', likelihood: 0.6, test: 'check_type_usage' },
        { description: 'Interface changed upstream', likelihood: 0.5, test: 'check_interface_changes' },
      ],
    },
  ];

  // Find matching patterns
  for (const pattern of patterns) {
    if (pattern.errorPattern.test(error.message)) {
      hypotheses.push(...pattern.hypotheses);
    }
  }

  // Add context-aware hypotheses
  if (context.recentChanges) {
    hypotheses.push({
      description: 'Recent change caused regression',
      likelihood: 0.5,
      test: 'check_recent_changes',
      context: context.recentChanges,
    });
  }

  // Add AI-generated hypotheses if pattern-based insufficient
  if (hypotheses.length < maxCount) {
    const aiHypotheses = await generateAIHypotheses(error, context, maxCount - hypotheses.length);
    hypotheses.push(...aiHypotheses);
  }

  return hypotheses.slice(0, maxCount);
}
```

### 6.5 Loop Prevention

```javascript
function detectLoop(hypothesisTree) {
  const seen = new Map();

  function walk(node) {
    const key = `${node.hypothesis}:${node.fix?.type}`;

    if (seen.has(key)) {
      const previous = seen.get(key);
      if (previous.depth < node.depth) {
        return {
          isLoop: true,
          loopStart: previous,
          loopEnd: node,
        };
      }
    }

    seen.set(key, node);

    for (const child of node.children || []) {
      const result = walk(child);
      if (result.isLoop) return result;
    }

    return { isLoop: false };
  }

  for (const root of hypothesisTree) {
    const result = walk(root);
    if (result.isLoop) return result;
  }

  return { isLoop: false };
}
```

### 6.6 Configuration

```json
{
  "recovery": {
    "recursive": {
      "enabled": true,
      "maxDepth": 3,
      "maxHypotheses": 5,
      "timeout": 300000,
      "loopDetection": true
    },
    "hypothesisGeneration": {
      "usePatterns": true,
      "useAI": true,
      "aiModel": "haiku",
      "contextWindow": 2000
    },
    "testing": {
      "autoTest": true,
      "testTimeout": 30000,
      "allowSideEffects": false
    },
    "fixes": {
      "autoApply": false,
      "requireApproval": true,
      "createBackup": true
    },
    "learning": {
      "enabled": true,
      "recordSuccessfulFixes": true,
      "recordFailedHypotheses": true
    }
  }
}
```

### 6.7 Output Format

```markdown
═══════════════════════════════════════════════════════════════
                   RECURSIVE ERROR RECOVERY
═══════════════════════════════════════════════════════════════

ERROR: Cannot read property 'map' of undefined
FILE: src/components/UserList.tsx:45
STACK: UserList.render → users.map

HYPOTHESIS TREE:
├─ [TESTED] H1: Variable not initialized
│  └─ Result: users is initialized as []
│  └─ Status: NOT THE CAUSE
│
├─ [TESTED] H2: API returned unexpected null
│  └─ Result: API returns { data: null } when no users
│  ├─ [TESTED] H2.1: Add null coalescing
│  │  └─ Fix: users?.map or (users || []).map
│  │  └─ Result: ✓ Error resolved
│  └─ Status: FIXED
│
└─ [SKIPPED] H3: Wrong variable accessed
   └─ Reason: H2 resolved the issue

RESOLUTION:
Fix applied: Added null coalescing operator
File: src/components/UserList.tsx:45
Change: users.map → (users || []).map

LEARNING RECORDED:
Pattern: API may return null instead of empty array
Fix: Always use null coalescing when mapping API data
Location: .workflow/learnings/api-null-handling.md
```

### 6.8 Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/flow-recursive-recovery.js` | Create | Main recovery orchestrator |
| `scripts/flow-hypothesis-generator.js` | Create | Hypothesis generation |
| `scripts/flow-hypothesis-tester.js` | Create | Hypothesis testing |
| `scripts/flow-adaptive-learning.js` | Modify | Integrate with recovery |
| `scripts/flow-damage-control.js` | Modify | Use recursive recovery |
| `.workflow/state/last-failure.json` | Modify | Store hypothesis tree |
| `.workflow/config.json` | Modify | Add `recovery.recursive` config |

### 6.9 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Fix causes same error | Detect loop, try next hypothesis |
| All hypotheses fail | Escalate to user with full tree |
| Hypothesis test times out | Mark inconclusive, try next |
| Fix causes different error | Recurse on new error |
| Error has no pattern match | Fall back to AI-only hypotheses |
| User rejects fix | Record as "rejected", try alternatives |

---

## 7. Implementation Plan

### 7.1 Phase Overview

| Phase | Enhancement | Duration | Dependencies |
|-------|-------------|----------|--------------|
| 0 | Classification System | 2 days | None |
| 1 | Multi-Pass Review | 4 days | Phase 0 |
| 2 | Recursive Compaction | 5 days | None |
| 3 | Progressive Phases | 4 days | None |
| 4 | Hierarchical Tasks | 6 days | Phase 0 |
| 5 | Recursive Recovery | 5 days | None |

**Total Estimated: 26 days** (with parallelization: ~15 days)

### 7.2 Detailed Implementation Steps

#### Phase 0: Classification System (Foundation)

```
Day 1:
├── [ ] Add classifyWorkItem() to flow-utils.js
├── [ ] Add classification config schema
├── [ ] Update config.json with classification defaults
└── [ ] Write unit tests for classification

Day 2:
├── [ ] Integrate with /wogi-story command
├── [ ] Update task gating in CLAUDE.md
├── [ ] Add --force-task flag
└── [ ] Test classification edge cases

REVIEW CHECKPOINT 0:
├── Run classification on 10 real requests
├── Verify backward compatibility
└── Document any config changes needed
```

#### Phase 1: Multi-Pass Review

```
Day 1:
├── [ ] Create flow-review-multipass.js skeleton
├── [ ] Implement pass orchestration logic
├── [ ] Add pass configuration to config.json
└── [ ] Create pass result aggregation

Day 2:
├── [ ] Implement structure pass (flow-review-passes/structure.js)
├── [ ] Implement logic pass (flow-review-passes/logic.js)
├── [ ] Test passes in isolation
└── [ ] Add pass-forward context logic

Day 3:
├── [ ] Implement security pass (flow-review-passes/security.js)
├── [ ] Implement integration pass (flow-review-passes/integration.js)
├── [ ] Add conditional pass triggering
└── [ ] Implement early exit logic

Day 4:
├── [ ] Update wogi-review.md command
├── [ ] Add --passes, --quick, --all-passes flags
├── [ ] Create review-history.json tracking
├── [ ] Integration testing

REVIEW CHECKPOINT 1:
├── Run multi-pass review on 5 real PRs
├── Compare results to old parallel review
├── Measure time/token differences
├── Check for regressions in review quality
```

#### Phase 2: Recursive Compaction

```
Day 1:
├── [ ] Create flow-summary-tree.js
├── [ ] Implement hierarchical summary generation
├── [ ] Add section identification logic
└── [ ] Create summary-tree.json state file

Day 2:
├── [ ] Implement on-demand expansion (flow-context-expander.js)
├── [ ] Add relevance scoring for expansion
├── [ ] Implement budget-aware expansion
└── [ ] Test expansion/collapse cycles

Day 3:
├── [ ] Implement staleness detection
├── [ ] Add hash-based invalidation
├── [ ] Implement auto-refresh logic
└── [ ] Add refresh scheduling

Day 4:
├── [ ] Update wogi-compact.md command
├── [ ] Add --preserve, --show-tree, --regenerate flags
├── [ ] Integrate with session state
└── [ ] Add compaction strategy config

Day 5:
├── [ ] Integration with existing context system
├── [ ] Performance optimization
├── [ ] Edge case handling
└── [ ] Full integration testing

REVIEW CHECKPOINT 2:
├── Compact a 100-message session
├── Verify relevant context preserved
├── Measure token savings
├── Check for context loss regressions
```

#### Phase 3: Progressive Phases

```
Day 1:
├── [ ] Create flow-phased-execution.js
├── [ ] Define phase structure and steps
├── [ ] Implement phase tracking in durable session
└── [ ] Add phase configuration

Day 2:
├── [ ] Create flow-phase-context.js
├── [ ] Implement context isolation per phase
├── [ ] Add phase checkpoint creation
└── [ ] Test phase transitions

Day 3:
├── [ ] Implement backtrack detection
├── [ ] Add backtrack recovery logic
├── [ ] Update wogi-start.md with --phased flag
└── [ ] Test backtrack scenarios

Day 4:
├── [ ] Integration with existing execution flow
├── [ ] Add --from-phase, --skip-to-phase flags
├── [ ] Full integration testing
└── [ ] Document phase workflows

REVIEW CHECKPOINT 3:
├── Run phased execution on 3 features
├── Test crash recovery at each phase boundary
├── Verify context isolation working
├── Test backtrack handling
```

#### Phase 4: Hierarchical Tasks

```
Day 1:
├── [ ] Create flow-hierarchy.js
├── [ ] Update ready.json schema with epics, parentId
├── [ ] Implement hierarchy CRUD operations
└── [ ] Add hierarchy config

Day 2:
├── [ ] Create flow-decomposition.js
├── [ ] Implement epic → stories decomposition
├── [ ] Implement story → tasks decomposition
└── [ ] Test decomposition quality

Day 3:
├── [ ] Create flow-dependencies.js
├── [ ] Implement dependency detection
├── [ ] Add topological sorting
├── [ ] Test circular dependency detection

Day 4:
├── [ ] Implement progress propagation
├── [ ] Add parent status updates
├── [ ] Create wogi-epic.md command
└── [ ] Update wogi-deps.md for hierarchy

Day 5:
├── [ ] Implement --epic flag for wogi-start
├── [ ] Add --next flag for auto-selection
├── [ ] Integration with existing task flow
└── [ ] Test multi-level hierarchies

Day 6:
├── [ ] Full integration testing
├── [ ] Edge case handling
├── [ ] Performance optimization
└── [ ] Documentation

REVIEW CHECKPOINT 4:
├── Create epic with 3 stories, 9 tasks
├── Execute through completion
├── Verify progress propagation
├── Test dependency blocking
├── Verify state consistency
```

#### Phase 5: Recursive Recovery

```
Day 1:
├── [ ] Create flow-recursive-recovery.js
├── [ ] Implement hypothesis tree structure
├── [ ] Add depth and loop tracking
└── [ ] Configure recovery settings

Day 2:
├── [ ] Create flow-hypothesis-generator.js
├── [ ] Implement pattern-based hypotheses
├── [ ] Add AI hypothesis generation
└── [ ] Test hypothesis quality

Day 3:
├── [ ] Create flow-hypothesis-tester.js
├── [ ] Implement test execution
├── [ ] Add fix generation and application
└── [ ] Test fix effectiveness

Day 4:
├── [ ] Implement loop detection
├── [ ] Add learning from recoveries
├── [ ] Integrate with damage-control.js
└── [ ] Test recursive scenarios

Day 5:
├── [ ] Full integration testing
├── [ ] Edge case handling
├── [ ] Update last-failure.json format
└── [ ] Documentation

REVIEW CHECKPOINT 5:
├── Test on 5 real error scenarios
├── Verify hypothesis quality
├── Check loop prevention
├── Measure recovery success rate
├── Verify learning capture
```

### 7.3 Final Integration & Testing

```
Day 1-2:
├── [ ] Cross-feature integration testing
├── [ ] Regression testing on existing workflows
├── [ ] Performance benchmarking
├── [ ] Documentation review

Day 3:
├── [ ] Fix any integration issues
├── [ ] Final configuration tuning
├── [ ] Update all command documentation
└── [ ] Create migration guide

FINAL REVIEW:
├── Full workflow test (epic → completion)
├── All edge cases documented and tested
├── No regressions in existing features
├── Performance acceptable
├── Documentation complete
```

---

## 8. Migration Strategy

### 8.1 Backward Compatibility

All enhancements are **opt-in** by default:

| Feature | Default | Enable Via |
|---------|---------|------------|
| Classification | `enabled: true` | Always runs, informational only |
| Multi-Pass Review | `enabled: false` | `review.multiPass.enabled: true` |
| Recursive Compaction | `strategy: "linear"` | `compaction.strategy: "hierarchical"` |
| Progressive Phases | `enabled: false` | `phases.enabled: true` |
| Hierarchical Tasks | `enabled: false` | `hierarchy.enabled: true` |
| Recursive Recovery | `enabled: false` | `recovery.recursive.enabled: true` |

### 8.2 State Migration

#### ready.json Migration

```javascript
// Migration script: migrate-ready-json.js
function migrateReadyJson(oldReady) {
  return {
    ...oldReady,
    // Add new fields with defaults
    epics: [],
    // Add parentId: null to existing tasks
    ready: oldReady.ready.map(task => ({
      ...task,
      parentId: null,
      level: 'L2', // Default existing tasks to L2
    })),
    inProgress: oldReady.inProgress.map(task => ({
      ...task,
      parentId: null,
      level: 'L2',
    })),
    // ... same for other arrays
  };
}
```

### 8.3 Rollback Plan

Each enhancement can be disabled independently:

```bash
# Disable multi-pass review, revert to parallel
flow config set review.multiPass.enabled false

# Disable hierarchical compaction, revert to linear
flow config set compaction.strategy linear

# Disable phases, revert to single-pass implementation
flow config set phases.enabled false

# Disable hierarchy, ignore parent relationships
flow config set hierarchy.enabled false

# Disable recursive recovery, revert to linear retry
flow config set recovery.recursive.enabled false
```

---

## 9. Testing Strategy

### 9.1 Test Categories

| Category | Description | Tools |
|----------|-------------|-------|
| Unit | Individual functions | Jest |
| Integration | Feature workflows | Custom scripts |
| Regression | Existing features | flow-regression.js |
| Performance | Token/time metrics | Custom benchmarks |
| Edge Cases | Boundary conditions | Manual + automated |

### 9.2 Test Cases Per Enhancement

#### Classification Tests
- [ ] Small task correctly classified
- [ ] Medium story correctly classified
- [ ] Large epic correctly classified
- [ ] Boundary cases (exactly 5 files, etc.)
- [ ] User override works
- [ ] Keyword detection works

#### Multi-Pass Review Tests
- [ ] All 4 passes execute correctly
- [ ] Early exit works on critical
- [ ] Conditional passes trigger correctly
- [ ] Results deduplicated
- [ ] Pass-forward context correct
- [ ] Timeout handling works

#### Compaction Tests
- [ ] Hierarchy generated correctly
- [ ] Expansion preserves relevant content
- [ ] Staleness detected
- [ ] Refresh updates summaries
- [ ] Budget respected
- [ ] Circular references handled

#### Phases Tests
- [ ] All phases execute in order
- [ ] Context isolated per phase
- [ ] Checkpoints created
- [ ] Backtrack works correctly
- [ ] Resume from checkpoint works
- [ ] Max backtracks enforced

#### Hierarchy Tests
- [ ] Epic decomposition works
- [ ] Story decomposition works
- [ ] Dependencies detected
- [ ] Circular deps blocked
- [ ] Progress propagates
- [ ] Status updates correct

#### Recovery Tests
- [ ] Hypotheses generated
- [ ] Tests execute correctly
- [ ] Fixes applied
- [ ] Loops detected
- [ ] Depth limit respected
- [ ] Learning captured

### 9.3 Performance Benchmarks

| Metric | Target | Measurement |
|--------|--------|-------------|
| Classification time | < 100ms | Per request |
| Review pass time | < 3min total | Per review |
| Compaction time | < 30s | Per session |
| Phase transition | < 5s | Per phase |
| Decomposition | < 10s | Per epic |
| Recovery depth=3 | < 60s | Per recovery |

---

## 10. Risk Mitigation

### 10.1 Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Infinite recursion | Medium | High | Depth limits, loop detection |
| Context fragmentation | Medium | Medium | Quality checks, fallback to full |
| Stale summaries | Medium | Low | Hash-based invalidation |
| Breaking existing flows | Low | High | Feature flags, gradual rollout |
| Performance degradation | Medium | Medium | Benchmarks, async operations |
| User confusion | Medium | Low | Clear documentation, defaults |

### 10.2 Monitoring

Add telemetry for:
- Classification accuracy (user overrides as signal)
- Review pass effectiveness (issues found per pass)
- Compaction ratio (tokens saved vs quality)
- Phase backtrack frequency
- Decomposition quality (task completion rate)
- Recovery success rate

### 10.3 Escape Hatches

Every enhancement has manual override:
- `--no-classify`: Skip classification
- `--single-pass`: Skip multi-pass review
- `--no-compact`: Skip compaction
- `--no-phases`: Skip phased execution
- `--flat`: Ignore hierarchy
- `--no-recover`: Skip recursive recovery

---

## Appendix A: Config Schema Additions

```json
{
  "classification": { /* See Section 1.5 */ },
  "review": {
    "multiPass": { /* See Section 2.5 */ }
  },
  "compaction": { /* See Section 3.6 */ },
  "phases": { /* See Section 4.6 */ },
  "hierarchy": { /* See Section 5.6 */ },
  "recovery": {
    "recursive": { /* See Section 6.6 */ }
  }
}
```

---

## Appendix B: New Commands Summary

| Command | Description |
|---------|-------------|
| `/wogi-epic "title"` | Create new epic |
| `/wogi-review --passes=...` | Multi-pass review |
| `/wogi-compact --preserve=...` | Hierarchical compaction |
| `/wogi-start --phased` | Phased implementation |
| `/wogi-start --epic=... --next` | Start next task in epic |
| `/wogi-deps EPIC-ID` | Show hierarchy |
| `/expand NODE-ID` | Expand collapsed context |

---

## Appendix C: File Changes Summary

### New Files (18)
- `scripts/flow-review-multipass.js`
- `scripts/flow-review-passes/structure.js`
- `scripts/flow-review-passes/logic.js`
- `scripts/flow-review-passes/security.js`
- `scripts/flow-review-passes/integration.js`
- `scripts/flow-summary-tree.js`
- `scripts/flow-context-expander.js`
- `scripts/flow-phased-execution.js`
- `scripts/flow-phase-context.js`
- `scripts/flow-hierarchy.js`
- `scripts/flow-decomposition.js`
- `scripts/flow-dependencies.js`
- `scripts/flow-recursive-recovery.js`
- `scripts/flow-hypothesis-generator.js`
- `scripts/flow-hypothesis-tester.js`
- `.claude/commands/wogi-epic.md`
- `.workflow/state/summary-tree.json`
- `.workflow/state/review-history.json`

### Modified Files (12)
- `scripts/flow-utils.js` (add classification, hierarchy ops)
- `scripts/flow-durable-session.js` (add phase tracking)
- `scripts/flow-adaptive-learning.js` (integrate recovery)
- `scripts/flow-damage-control.js` (use recursive recovery)
- `.claude/commands/wogi-review.md` (multi-pass options)
- `.claude/commands/wogi-compact.md` (hierarchical options)
- `.claude/commands/wogi-start.md` (phased, epic flags)
- `.claude/commands/wogi-deps.md` (hierarchy viz)
- `.workflow/config.json` (all new configs)
- `.workflow/config.schema.json` (all new schemas)
- `.workflow/state/ready.json` (epics, parentId)
- `.workflow/state/last-failure.json` (hypothesis tree)
- `CLAUDE.md` (updated task gating)

---

**End of Specification**

*This document should be reviewed and approved before implementation begins.*
