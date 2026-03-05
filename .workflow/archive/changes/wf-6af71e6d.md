# Function Deduplication

**ID**: wf-6af71e6d
**Epic**: wf-ea2c59c1 (WogiFlow Deep Optimization)
**Type**: refactor | **Level**: L1 | **Priority**: P2

## Problem

Multiple utility functions are duplicated across scripts:
- `estimateTokens()` — 9 copies
- `loadConfig()` / `getConfig()` — 10 copies (inline reimplementations)
- `escapeRegex()` — 5 copies
- Color/chalk wrappers — 6 copies
- `showHelp()` — 24 copies with identical patterns

## Acceptance Criteria

1. **Given** estimateTokens() exists in 9 scripts, **When** deduplicated, **Then** one canonical version in flow-utils.js, all 9 scripts import it
2. **Given** loadConfig/getConfig inline copies exist in 10 scripts, **When** deduplicated, **Then** all use getConfig() from flow-utils.js
3. **Given** escapeRegex() exists in 5 scripts, **When** deduplicated, **Then** one version in flow-utils.js, all 5 import it
4. **Given** color/chalk wrappers exist in 6 scripts, **When** deduplicated, **Then** one color utility in flow-utils.js (or flow-output.js if split)
5. **Given** showHelp() exists in 24 scripts with identical pattern, **When** deduplicated, **Then** shared showHelp(name, description, commands) in flow-utils.js
6. **Given** all changes made, **When** `node --check` runs on each modified script, **Then** all pass
7. **Given** circular dependency risk, **When** imports are updated, **Then** no circular dependency chains are introduced

## Scripts with Duplicates (from audit)

### estimateTokens (9)
- flow-auto-context.js, flow-context-estimator.js, flow-hybrid-executor.js, flow-knowledge-router.js, flow-prompt-composer.js, flow-research.js, flow-smart-compaction.js, flow-standards-gate.js, flow-wiring-verifier.js

### escapeRegex (5)
- flow-auto-context.js, flow-component-reuse.js, flow-registry-manager.js, flow-section-resolver.js, flow-standards-gate.js

### color (6)
- flow-bridge.js, flow-health.js, flow-models.js, flow-morning.js, flow-ready.js, flow-status.js

## Files to Change

- `scripts/flow-utils.js` — add canonical versions of deduplicated functions
- 24+ scripts — update imports to use canonical versions
