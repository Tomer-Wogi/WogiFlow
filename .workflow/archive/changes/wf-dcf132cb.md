# Free Package Extension Points — Enable Teams Hook Integration

**ID**: wf-dcf132cb
**Type**: story
**Feature**: teams-extension
**Priority**: P1
**Complexity**: Low
**Created**: 2026-02-25

## User Story

As a WogiFlow maintainer, I want the free `wogiflow` package to have minimal extension points, so that the `@wogiflow/teams` package can register hooks and access state without modifying core code.

## Description

The free `wogiflow` package needs small, backwards-compatible changes to enable the paid Teams extension. These changes add detection of `@wogiflow/teams` in node_modules, auto-registration of its hooks, an empty `team` config section, and an extension hook registry. Free users see zero change in behavior.

## Acceptance Criteria

### Scenario 1: Teams package detection during install
Given `@wogiflow/teams` is installed in node_modules
When `scripts/postinstall.js` runs (via `npm install` or `npm update`)
Then the postinstall script detects the Teams package
And calls its `registerHooks()` export if available
And logs "Registered extension: @wogiflow/teams" to console
And Teams hooks are appended to `.claude/settings.local.json` event arrays (after core hooks)

### Scenario 2: Graceful degradation when Teams not installed
Given `@wogiflow/teams` is NOT installed in node_modules
When `scripts/postinstall.js` runs
Then no error is thrown
And no warning is displayed (silent skip)
And `.claude/settings.local.json` contains only core WogiFlow hooks
And DEBUG=1 mode logs "Extension not found" for debugging

### Scenario 3: State reader functions exported from flow-utils
Given the `scripts/flow-utils.js` module
When `@wogiflow/teams` imports it via `require('wogiflow/scripts/flow-utils')`
Then all critical state reader/writer functions are accessible:
  - `getConfig()`, `getRawConfig()`, `setConfigValueSync()`
  - `getReadyData()`, `saveReadyData()`, `findTask()`, `moveTask()`
  - `PATHS` constant for state file locations
  - `safeJsonParse()`, `generateTaskId()`, `validateTaskId()`

### Scenario 4: Team config section in config.json
Given a fresh `flow init` or `flow onboard`
When the installer creates `.workflow/config.json`
Then it includes a `team` section with defaults: `{ enabled: false, projectId: null, orgId: null }`
And existing installs are unaffected (missing `team` key is fine — Teams creates it on first run)

### Scenario 5: Team config schema validation
Given `.workflow/config.schema.json`
When a config file includes a `team` section with additional Teams-specific fields
Then validation passes (additionalProperties: true on team object)
And the schema documents `enabled`, `projectId`, `orgId` as base fields

### Scenario 6: Extension hook registry in core hooks
Given `scripts/hooks/core/index.js`
When `@wogiflow/teams` calls `registerExtension(name, hookModule)`
Then the extension's hooks are available via `getExtension(name)`
And core hook exports are NOT overwritten by extension hooks
And `getAllExtensions()` returns all registered extensions

### Scenario 7: Hook execution order preserved
Given both core WogiFlow hooks and Teams extension hooks are registered
When a hook event fires (e.g., SessionStart)
Then core WogiFlow hooks execute first (lower array index)
And Teams hooks execute after (appended to end of array)

## Boundaries

**DO NOT modify:**
- `.claude/settings.json` (package-level settings — read-only template)
- `scripts/hooks/entry/claude-code/*.js` (existing hook entry points)
- `scripts/hooks/core/*.js` (existing core hook modules — only modify index.js)
- Pre-tool-use gate logic (task-gate, scope-gate, phase-gate)

**DO NOT add:**
- Any Teams-specific business logic to the free package
- Any network calls to Teams cloud services
- Any required dependency on `@wogiflow/teams`

## Technical Notes

### Files to Modify (4)
1. **`scripts/postinstall.js`** — Add extension detection after settings merge (~line 277). Use `require.resolve()` to detect, `require()` to load, call `registerHooks()`. Wrap in try-catch with silent skip.
2. **`scripts/flow-utils.js`** — Verify all state reader functions are in `module.exports`. Add any missing (likely `setConfigValueSync` if not exported). No new code needed if all already exported.
3. **`lib/installer.js`** — Add `team` defaults to config creation (around line 422, after techDebt section).
4. **`.workflow/config.schema.json`** — Add `team` property schema with `additionalProperties: true`.

### Files to Create (1)
5. **`scripts/hooks/core/extension-registry.js`** — New file: `register(name, module)`, `getExtension(name)`, `getAllExtensions()`. Export from `scripts/hooks/core/index.js`.

### Patterns to Follow
- Lazy-loading pattern from `scripts/hooks/core/index.js` (lines 22-31) for optional modules
- `safeJsonParse` for all JSON reads
- `err` catch variable convention
- `'use strict'` at top of new files
- kebab-case file naming

### Extension API Contract
Teams package must export:
```javascript
module.exports = {
  registerHooks({ settingsPath, projectRoot }) {
    // Append hooks to settings.local.json
    // Return { success: boolean, hooksRegistered: number }
  }
};
```

## Test Strategy

- **Unit**: Syntax check all modified/created JS files (`node --check`)
- **Integration**: Verify `require('./scripts/flow-utils')` exports all listed functions
- **Manual**: Run `node scripts/postinstall.js` with and without `@wogiflow/teams` mock

## Dependencies

- None (backwards-compatible, no external dependencies)
