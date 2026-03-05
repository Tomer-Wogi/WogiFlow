# Hook Chain Performance

**ID**: wf-1ad065ef
**Epic**: wf-ea2c59c1 (WogiFlow Deep Optimization)
**Type**: refactor | **Level**: L1 | **Priority**: P2

## Problem

PreToolUse hook calls getConfig() 7-8 times per invocation through cascading gate functions. PostToolUse has a 60-second timeout (excessive for observation capture).

## Acceptance Criteria

1. **Given** PreToolUse calls getConfig() 7-8 times per tool call, **When** optimized, **Then** config is loaded once and passed as parameter to all gates
2. **Given** PostToolUse has 60s timeout, **When** optimized, **Then** timeout is 15-20s
3. **Given** config is passed as parameter, **When** gate functions are called, **Then** they accept config as argument instead of calling getConfig() internally
4. **Given** optimization is done, **When** before/after timing is measured, **Then** PreToolUse is measurably faster
5. **Given** gate behavior is unchanged, **When** same inputs are provided, **Then** same gates fire in same order with same results

## Current Flow (PreToolUse)

```
pre-tool-use.js (entry)
  → getConfig()           // call 1
  → phaseGate()
    → getConfig()         // call 2
  → scopeGate()
    → taskGate()
      → getConfig()       // call 3
    → settingsCheck()
      → getConfig()       // call 4
    → exemptCheck()
      → getConfig()       // call 5
  → routingGate()
    → getConfig()         // call 6
  → componentReuse()
    → getConfig()         // call 7
    → registryCheck()
      → getConfig()       // call 8
```

## Proposed Flow

```
pre-tool-use.js (entry)
  → config = getConfig()  // call 1 (ONLY)
  → phaseGate(config)
  → scopeGate(config)
  → routingGate(config)
  → componentReuse(config)
```

## Files to Change

- `scripts/hooks/entry/claude-code/pre-tool-use.js` — load config once, pass to gates
- `scripts/hooks/core/phase-gate.js` — accept config parameter
- `scripts/hooks/core/scope-gate.js` — accept config parameter
- `scripts/hooks/core/routing-gate.js` — accept config parameter
- `scripts/hooks/core/component-reuse-gate.js` — accept config parameter
- `.claude/settings.local.json` — lower PostToolUse timeout from 60000 to 20000
