# [wf-a768cafc] Remove non-Claude CLI support - simplify to Claude Code only

## User Story
**As a** WogiFlow maintainer
**I want** to remove all non-Claude CLI support (Gemini, Cursor, OpenCode, Codex, Kimi)
**So that** the codebase is simpler to maintain and focused on the only working CLI

## Description
After evaluation, non-Claude CLIs (Gemini, Cursor, OpenCode, Codex, Kimi) were found to be incompatible with WogiFlow's autonomous workflow requirements. Gemini is too slow and can't follow complex workflows. Cursor is interactive-first and incompatible. Others would require weeks of custom development. This refactoring removes ~5,000+ lines of dead code and simplifies maintenance.

## Acceptance Criteria

### Scenario 1: Bridge files deleted
**Given** bridge files exist for non-Claude CLIs
**When** refactoring is complete
**Then** only `claude-bridge.js`, `base-bridge.js`, and `index.js` remain in `.workflow/bridges/`

### Scenario 2: Template files deleted
**Given** template files exist for non-Claude CLIs
**When** refactoring is complete
**Then** only `claude-md.hbs` and `agents-md.hbs` remain in `.workflow/templates/`

### Scenario 3: Documentation cleaned
**Given** CLI guides exist for non-Claude CLIs
**When** refactoring is complete
**Then** only `claude-code.md` and `README.md` remain in `.workflow/docs/cli-guides/`

### Scenario 4: Hook adapters cleaned
**Given** hook adapters exist for non-Claude CLIs
**When** refactoring is complete
**Then** only `claude-code.js`, `base-adapter.js`, and `index.js` remain in `scripts/hooks/adapters/`

### Scenario 5: Config simplified
**Given** config supports multiple CLIs
**When** refactoring is complete
**Then** `config.json` has `cli.type` set to `claude-code` and `cli.enabled` removed
**And** `config.schema.json` only allows `claude-code` for `cli.type`

### Scenario 6: Bridge state simplified
**Given** `flow-bridge-state.js` supports multiple CLIs
**When** refactoring is complete
**Then** `CLI_OUTPUT_FILES` and `CLI_TEMPLATES` only contain `claude-code` entries
**And** `syncAllEnabledClis()` works with single CLI

### Scenario 7: Lint and tests pass
**Given** all changes are complete
**When** running `npm run lint`
**Then** no errors are reported

## Technical Notes
- **Files to Delete**:
  - Bridges: `gemini-bridge.js`, `cursor-bridge.js`, `opencode-bridge.js`, `codex-bridge.js`, `kimi-bridge.js`
  - Templates: `gemini-md.hbs`, `cursor-rules.mdc.hbs`, `opencode-*.hbs`, `codex-config.hbs`, `kimi-agents-md.hbs`
  - Docs: `gemini-cli.md`, `cursor.md`, `opencode.md`, `codex.md`, `kimi.md`
  - Adapters: `gemini.js`, `cursor.js`, `opencode.js`
  - Plans: `cursor-bridge-plan.md`
  - Fragments: `output-format-gemini.md`
- **Files to Modify**:
  - `.workflow/bridges/index.js` - Remove non-Claude loaders
  - `.workflow/config.json` - Simplify CLI config
  - `.workflow/config.schema.json` - Update CLI type enum
  - `scripts/flow-bridge-state.js` - Remove non-Claude entries
  - `scripts/hooks/adapters/index.js` - Remove non-Claude adapters

## Test Strategy
- [ ] Unit: Run `npm run lint` to verify no broken imports
- [ ] Integration: Run `node scripts/flow-bridge-state.js status` to verify Claude-only sync
- [ ] E2E: Start new session and verify hook context loads properly

## Dependencies
- None

## Complexity
Medium - Many files to delete but straightforward refactoring

## Out of Scope
- Adding new CLI support in the future
- Modifying Claude Code bridge behavior
