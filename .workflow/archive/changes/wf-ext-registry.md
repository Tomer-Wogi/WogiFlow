# Story: Extensible Registry Architecture

**ID**: wf-ext-registry
**Epic**: epic-universal-registry
**Type**: story
**Priority**: P1
**Feature**: scanner

## User Story

As a WogiFlow developer,
I want the registry system to support plugin-based registries that auto-activate per tech stack,
So that any language/framework can contribute its own registry types beyond the current three.

## Description

Currently WogiFlow has three hardcoded registries: components (manual app-map), functions (FunctionScanner), and APIs (APIScanner). These are configured separately in config.json and have no way to add new registry types without modifying core code.

This story refactors the system into a plugin-based architecture where:
- Each registry is a plugin class extending `BaseScanner`
- Plugins declare an `activateWhen(stack)` method
- A `RegistryManager` loads, activates, and orchestrates all plugins
- Config evolves to a unified `registries` array
- Default plugins preserve backwards compatibility

## Acceptance Criteria

### Scenario 1: Existing scanners work as registry plugins
Given the existing FunctionScanner and APIScanner
When refactored to implement the RegistryPlugin interface
Then they produce identical output to their current behavior

### Scenario 2: Registry auto-activation based on detected stack
Given config has `registries` array with `activateWhen` conditions
When `detectStack()` returns `{orm: 'Prisma'}`
Then the SchemaRegistry plugin auto-activates

### Scenario 3: Backwards-compatible config
Given an existing config.json with separate `functionRegistry` and `apiRegistry` sections
When the new RegistryManager loads
Then it reads both old-format and new-format config without breaking

### Scenario 4: New plugin added without core changes
Given a new registry plugin class is created in `scripts/registries/`
When registered in the plugins list
Then it integrates without modifying RegistryManager code

### Scenario 5: ComponentScanner automates app-map
Given app-map.md is currently manual-only
When the ComponentScanner plugin runs
Then it discovers React/Vue/Svelte components and generates entries (complementing manual entries, not replacing)

### Scenario 6: Unified scan command
Given the RegistryManager
When `node scripts/flow-registry-manager.js scan` runs
Then all active registry plugins scan, prune, and generate their maps

### Scenario 7: Post-task update uses RegistryManager
Given a task is completed
When post-task updates run
Then RegistryManager orchestrates all active registries (not three separate scan commands)

### Scenario 8: Registry manifest generated and maintained
Given the RegistryManager has active plugins
When `scan` completes (or on RegistryManager init)
Then `.workflow/state/registry-manifest.json` is generated listing all active registries with metadata
And consuming systems can read the manifest to discover all available maps dynamically

### Scenario 9: Manifest includes metadata for each registry
Given a registry-manifest.json
When read by any consuming system
Then each entry includes: id, name, mapFile, indexFile, type, category, activateWhen, and active status

## Technical Notes

### Components
- **New**: `scripts/flow-registry-manager.js` — Plugin orchestrator + manifest generator
- **New**: `scripts/registries/` directory — Plugin modules
- **New**: `.workflow/state/registry-manifest.json` — Auto-generated registry manifest
- **Move**: `FunctionScanner` → `scripts/registries/function-registry.js`
- **Move**: `APIScanner` → `scripts/registries/api-registry.js`
- **New**: `scripts/registries/component-registry.js` — Automated component discovery
- **Modify**: `scripts/flow-function-index.js` — Thin wrapper for backwards compat
- **Modify**: `scripts/flow-api-index.js` — Thin wrapper for backwards compat
- **Modify**: `.workflow/config.json` — Add `registries` array
- **Modify**: `lib/installer.js` — Include `registries` in default config

### RegistryPlugin Interface

```javascript
class RegistryPlugin extends BaseScanner {
  // Plugin metadata
  static id = 'function-registry';      // Unique ID
  static name = 'Function Registry';    // Display name
  static mapFile = 'function-map.md';   // Output file
  static indexFile = 'function-index.json'; // Machine-readable output
  static category = 'code';             // code | database | architecture
  static type = 'functions';            // For context loading

  // Activation
  activateWhen(stack) {
    // Return true if this plugin should be active for this stack
    // Default plugins always return true
    return true;
  }

  // Core interface (inherited from BaseScanner)
  async scan() { }
  prune() { }
  async generateMap() { }
  async save() { }
}
```

### Registry Manifest (registry-manifest.json)

The RegistryManager generates this file after every scan or init. It serves as the **single source of truth** for all consuming systems that need to know which registries exist and where their files are.

```json
{
  "version": 1,
  "generatedAt": "2026-02-21T14:00:00.000Z",
  "registries": [
    {
      "id": "components",
      "name": "Component Registry",
      "mapFile": "app-map.md",
      "indexFile": "component-index.json",
      "category": "code",
      "type": "components",
      "enabled": true,
      "active": true,
      "activateWhen": "always"
    },
    {
      "id": "functions",
      "name": "Function Registry",
      "mapFile": "function-map.md",
      "indexFile": "function-index.json",
      "category": "code",
      "type": "functions",
      "enabled": true,
      "active": true,
      "activateWhen": "always"
    },
    {
      "id": "apis",
      "name": "API Registry",
      "mapFile": "api-map.md",
      "indexFile": "api-index.json",
      "category": "code",
      "type": "apis",
      "enabled": true,
      "active": true,
      "activateWhen": "always"
    },
    {
      "id": "schemas",
      "name": "Schema Registry",
      "mapFile": "schema-map.md",
      "indexFile": "schema-index.json",
      "category": "database",
      "type": "schemas",
      "enabled": "auto",
      "active": true,
      "activateWhen": "orm"
    }
  ]
}
```

**Design principle**: The manifest is purely descriptive. It doesn't replace config — it reflects the *resolved* state after config + stack detection. Consuming systems read the manifest to discover what registries exist; they never hardcode map filenames.

**Helper function** (added to `flow-utils.js` or `flow-registry-manager.js`):

```javascript
function getActiveRegistries() {
  const manifestPath = path.join(STATE_DIR, 'registry-manifest.json');
  if (fs.existsSync(manifestPath)) {
    return safeJsonParse(manifestPath, { registries: [] }).registries
      .filter(r => r.active);
  }
  // Fallback: return hardcoded defaults (backwards compat)
  return [
    { id: 'components', mapFile: 'app-map.md', indexFile: 'component-index.json', category: 'code', type: 'components' },
    { id: 'functions', mapFile: 'function-map.md', indexFile: 'function-index.json', category: 'code', type: 'functions' },
    { id: 'apis', mapFile: 'api-map.md', indexFile: 'api-index.json', category: 'code', type: 'apis' }
  ];
}
```

The fallback ensures that if `registry-manifest.json` doesn't exist yet (fresh install, pre-migration), all consuming systems still work with the original three maps.

### Config Evolution

**Old format (still supported):**
```json
{
  "functionRegistry": { "enabled": true, "directories": [...] },
  "apiRegistry": { "enabled": true, "directories": [...] },
  "componentIndex": { "autoScan": true, "directories": [...] }
}
```

**New format:**
```json
{
  "registries": [
    { "id": "components", "enabled": true, "directories": [...] },
    { "id": "functions", "enabled": true, "directories": [...] },
    { "id": "apis", "enabled": true, "directories": [...] },
    { "id": "schemas", "enabled": "auto", "activateWhen": "orm" },
    { "id": "services", "enabled": "auto", "activateWhen": "backend" }
  ]
}
```

`"enabled": "auto"` means: activate only when `activateWhen` condition is met by detected stack.

## Boundaries

Do NOT modify:
- Existing `.workflow/state/*.md` map file formats (additive only)
- Existing scanner CLI commands (`flow function-index scan` must still work)
- `.claude/commands/` files (instruction updates are in wf-manifest-wiring story)

## Dependencies

- **Depends on**: wf-fwk-discovery (needs framework-driven patterns)

## Complexity

High — Refactors core scanning architecture. Must maintain full backwards compatibility. Manifest generation adds moderate scope but is essential for downstream wiring.
