# Config Consolidation - Update All Consumers

**ID**: wf-67eee59b
**Epic**: wf-ea2c59c1 (WogiFlow Deep Optimization)
**Type**: refactor | **Level**: L1 | **Priority**: P1

## Problem

After consolidating config structure (wf-1d612670) and removing static data (wf-7db613f7), all scripts reading old keys need updating.

## Acceptance Criteria

1. **Given** old config keys are renamed, **When** any script reads config, **Then** it reads from the new consolidated key path
2. **Given** backwards compatibility is needed, **When** getConfig() is called, **Then** a compat shim maps old keys to new keys for one release cycle
3. **Given** config.schema.json exists, **When** config structure changes, **Then** schema is updated to match
4. **Given** documentation references old keys, **When** consolidation is done, **Then** all .md files updated (CLAUDE.md template, docs, commands)
5. **Given** strictMode has 3 separate uses, **When** renamed, **Then** enforcement.strictMode stays, top-level strictMode → verificationMode, research.strictMode → research.requireCitations

## Compat Shim Design

```javascript
// In getConfig() — temporary, remove in next major version
function applyCompatShim(config) {
  // Old path → new path mappings
  if (config.loops && !config.execution) config.execution = config.loops;
  if (config.sessionLearning && !config.learning) config.learning = { session: config.sessionLearning };
  // ... etc
  return config;
}
```

## Blocked By

- wf-1d612670 (Merge Duplicate Sections)
- wf-7db613f7 (Remove Static Data)

## Files to Change

- `scripts/flow-*.js` — all scripts reading config (grep for getConfig)
- `scripts/hooks/**/*.js` — all hooks reading config
- `.workflow/templates/claude-md.hbs` — template references
- `.claude/docs/*.md` — documentation
- `config.schema.json` — schema
