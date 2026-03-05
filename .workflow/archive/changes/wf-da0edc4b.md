# Split flow-utils.js God File

**ID**: wf-da0edc4b
**Epic**: wf-ea2c59c1 (WogiFlow Deep Optimization)
**Type**: refactor | **Level**: L1 | **Priority**: P1

## Problem

flow-utils.js is 3,544 lines with 91 functions, imported by 182 scripts. Any change risks breaking 182 files. Functions span 6+ unrelated domains.

## Proposed Split

| New Module | Functions | Lines (est) |
|-----------|-----------|-------------|
| `flow-paths.js` | PATHS, path constants, isPathWithinProject | ~100 |
| `flow-io.js` | readFile, writeFile, writeJson, safeJsonParse, fileExists | ~200 |
| `flow-config.js` | getConfig, loadConfig, CONFIG_DEFAULTS, getConfigWithDefaults | ~150 |
| `flow-tokens.js` | estimateTokens, countTokens | ~50 |
| `flow-colors.js` | color, colors object, ANSI codes | ~80 |
| `flow-utils.js` | Thin re-export wrapper + remaining utilities | ~200 |

## Backward Compatibility

flow-utils.js becomes a re-export file:
```javascript
// flow-utils.js (new version)
const { PATHS, isPathWithinProject } = require('./flow-paths');
const { readFile, writeFile, writeJson, safeJsonParse } = require('./flow-io');
const { getConfig, getConfigWithDefaults } = require('./flow-config');
const { estimateTokens } = require('./flow-tokens');
const { color, colors } = require('./flow-colors');
// ... re-export everything
module.exports = { PATHS, readFile, writeFile, getConfig, estimateTokens, color, ... };
```

All 182 importing scripts continue working without changes.

## Acceptance Criteria

1. **Given** flow-utils.js has 91 functions, **When** split, **Then** 5 focused modules + thin re-export wrapper
2. **Given** 182 scripts import from flow-utils.js, **When** split is done, **Then** all continue working via re-exports
3. **Given** new modules exist, **When** new code is written, **Then** developers import from specific modules
4. **Given** split creates new files, **When** node --check runs, **Then** all files pass syntax check
5. **Given** circular dependency risk, **When** modules are separated, **Then** dependency graph is acyclic
