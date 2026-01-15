# [wf-phase0-1] CLI Agnosticism + Multi-Model Architecture

## User Story
**As a** developer using any AI coding CLI (Claude Code, Gemini CLI, OpenCode)
**I want** wogi-flow to work universally with my preferred CLI and models
**So that** I can use the workflow system regardless of which AI tools I choose

## Description
This is the foundational architecture change that enables wogi-flow to work across multiple AI CLIs instead of being Claude Code-specific. It establishes a universal `.workflow/` structure as the source of truth, with CLI-specific bridges that generate the appropriate files for each CLI. This change also introduces the model registry and provider abstraction that enables multi-model routing.

This must be done first because all future features (model routing, skill marketplace, etc.) depend on this universal architecture.

## Acceptance Criteria

### Scenario 1: Universal workflow structure
**Given** a project with wogi-flow installed
**When** I examine the file structure
**Then** all workflow state should be in `.workflow/` (CLI-agnostic)
**And** CLI-specific files (`.claude/`, `.gemini/`) should be generated from universal config

### Scenario 2: CLI selection during installation
**Given** I am running `flow install` on a new project
**When** the installer starts
**Then** I should be asked "Which CLI are you using?" as the first question
**And** I should see options for Claude Code, Gemini CLI, OpenCode, and Other
**And** the appropriate CLI bridge should be activated based on my selection

### Scenario 3: Model registry creation
**Given** I have selected my CLI during installation
**When** I configure my models
**Then** a `.workflow/models/registry.json` should be created
**And** it should contain provider info, context windows, cost tiers, and capabilities
**And** it should be CLI-agnostic (usable by any bridge)

### Scenario 4: CLI bridge generates CLI-specific files
**Given** I have a universal config in `.workflow/`
**When** I run the CLI bridge (or it runs automatically)
**Then** CLI-specific files should be generated (e.g., `.claude/` from `.workflow/`)
**And** `CLAUDE.md` (or equivalent) should be generated from universal templates
**And** skills should be copied/linked to CLI-specific locations

### Scenario 5: Skills work across CLIs
**Given** I have skills installed in `.workflow/skills/`
**When** the CLI bridge runs
**Then** skills should be available in the CLI-specific skill location
**And** skill knowledge and patterns should be preserved
**And** hot-reload should work for the active CLI

### Scenario 6: Existing Claude Code projects migrate
**Given** I have an existing wogi-flow project (Claude Code-only)
**When** I run the migration command
**Then** my `.claude/` content should move to universal `.workflow/` structure
**And** a Claude Code bridge should be created
**And** my existing workflows should continue working

### Scenario 7: Provider abstraction layer
**Given** I want to use models from multiple providers
**When** I configure providers in the model registry
**Then** each provider should have its own configuration section
**And** provider-specific settings (folder structure, rules file, prompts) should be defined
**And** the system should know how to communicate with each provider

## Technical Notes

**New Files/Directories**:
- `.workflow/models/registry.json` - Model capabilities, costs, providers
- `.workflow/models/stats.json` - Performance tracking (stub for now)
- `.workflow/bridges/` - CLI bridge scripts
- `.workflow/bridges/claude.js` - Claude Code bridge
- `.workflow/bridges/gemini.js` - Gemini CLI bridge (stub)
- `.workflow/templates/` - Universal templates for generating CLI files

**Files to Modify**:
- `scripts/flow-install` - Add CLI selection as first question
- `scripts/flow` - Add `bridge` command
- `.workflow/config.json` - Add `cli` and `providers` sections
- `CLAUDE.md` - Will be generated from template

**Migration Path**:
1. Create universal structure in `.workflow/`
2. Move skills from `.claude/skills/` to `.workflow/skills/`
3. Create bridge that syncs to `.claude/`
4. CLAUDE.md becomes a generated file

**Architecture**:
```
.workflow/                    ← Universal source of truth
├── config.json              ← Model configs, CLI selection
├── models/
│   ├── registry.json        ← All model capabilities
│   └── stats.json           ← Performance tracking
├── skills/                  ← Universal skills (moved from .claude/)
├── templates/               ← Templates for CLI-specific files
│   ├── claude-md.hbs
│   └── gemini-md.hbs
└── bridges/
    ├── claude.js            ← Generates .claude/ files
    └── gemini.js            ← Generates .gemini/ files
```

## Test Strategy
- [ ] Unit: Bridge generates correct files from templates
- [ ] Unit: Model registry validates correctly
- [ ] Integration: `flow install` creates proper structure for each CLI
- [ ] Integration: Migration preserves existing workflows
- [ ] E2E: Full workflow works after migration

## Dependencies
- None (this is the foundation)

## Complexity
**High** - Major architectural change affecting many files

## Out of Scope
- Multi-model routing logic (Phase 2)
- Task-based routing (Phase 3)
- Gemini CLI full support (only stub bridge)
- OpenCode full support (only stub bridge)

---

## Sub-Tasks (Deep Decomposition)

### wf-phase0-1-01: Create universal models directory structure
**Objective**: Create `.workflow/models/` with registry.json schema

**Done Criteria**:
- [ ] `.workflow/models/registry.json` exists with schema
- [ ] Schema includes: providers, models, capabilities, costTiers, languages
- [ ] Default registry includes Claude models (opus-4.5, sonnet-4)
- [ ] `.workflow/models/stats.json` stub created

**Scope**: S (1-2 hours)

---

### wf-phase0-1-02: Add CLI selection to installer
**Objective**: Modify `flow install` to ask CLI choice first

**Done Criteria**:
- [ ] Installer asks "Which CLI?" before other questions
- [ ] Options: Claude Code, Gemini CLI, OpenCode, Other
- [ ] Selection saved to `.workflow/config.json` as `cli.type`
- [ ] CLI-specific setup triggered based on selection

**Dependencies**: None
**Scope**: S (1 hour)

---

### wf-phase0-1-03: Create CLI bridge architecture
**Objective**: Create bridge system that generates CLI-specific files

**Done Criteria**:
- [ ] `.workflow/bridges/` directory created
- [ ] Base bridge class/interface defined
- [ ] `flow bridge sync` command added
- [ ] Bridge reads from `.workflow/` and writes to CLI folder

**Dependencies**: wf-phase0-1-01
**Scope**: M (2-3 hours)

---

### wf-phase0-1-04: Implement Claude Code bridge
**Objective**: Create bridge that generates `.claude/` from `.workflow/`

**Done Criteria**:
- [ ] `.workflow/bridges/claude.js` implemented
- [ ] Generates `CLAUDE.md` from template
- [ ] Syncs skills from `.workflow/skills/` to `.claude/skills/`
- [ ] Syncs rules from `.workflow/` to `.claude/rules/`
- [ ] Preserves hot-reload capability

**Dependencies**: wf-phase0-1-03
**Scope**: M (2-3 hours)

---

### wf-phase0-1-05: Create universal templates
**Objective**: Create Handlebars templates for CLI-specific files

**Done Criteria**:
- [ ] `.workflow/templates/claude-md.hbs` created
- [ ] Template includes all CLAUDE.md sections
- [ ] Variables: projectName, skills, rules, config
- [ ] `.workflow/templates/gemini-md.hbs` stub created

**Dependencies**: wf-phase0-1-03
**Scope**: S (1-2 hours)

---

### wf-phase0-1-06: Add provider configuration schema
**Objective**: Define provider-specific settings in config

**Done Criteria**:
- [ ] `config.json` has `providers` section
- [ ] Each provider has: folderStructure, rulesFile, skillsPath, promptStyle
- [ ] Anthropic provider fully configured
- [ ] Google provider stub configured

**Dependencies**: wf-phase0-1-01
**Scope**: S (1 hour)

---

### wf-phase0-1-07: Create migration command
**Objective**: Migrate existing Claude Code projects to universal structure

**Done Criteria**:
- [ ] `flow migrate` command added
- [ ] Moves `.claude/skills/` to `.workflow/skills/`
- [ ] Creates model registry from existing config
- [ ] Sets up Claude bridge
- [ ] Backs up original files before migration

**Dependencies**: wf-phase0-1-04
**Scope**: M (2-3 hours)

---

### wf-phase0-1-08: Update flow commands for universal structure
**Objective**: Ensure all flow commands work with new structure

**Done Criteria**:
- [ ] `flow install` uses universal structure
- [ ] `flow onboard` works with bridges
- [ ] Skill commands use `.workflow/skills/`
- [ ] Config commands read from universal location

**Dependencies**: wf-phase0-1-04, wf-phase0-1-07
**Scope**: M (2-3 hours)

---

### wf-phase0-1-09: Integration testing and documentation
**Objective**: Test full workflow and update docs

**Done Criteria**:
- [ ] Fresh install works with CLI selection
- [ ] Migration from existing project works
- [ ] All existing commands still work
- [ ] README updated with CLI agnosticism info
- [ ] Knowledge base updated

**Dependencies**: wf-phase0-1-08
**Scope**: S (1-2 hours)
