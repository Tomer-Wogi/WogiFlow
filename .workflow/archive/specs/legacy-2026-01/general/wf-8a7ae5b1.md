# [wf-8a7ae5b1] Phase 5: Distribution & Community - npm Package and Skill Library

## User Story
**As a** developer wanting to use Wogi Flow
**I want** to install it via npm with `npm install -g wogi-flow`
**So that** I can easily set up and upgrade the workflow system in any project

## Description
Phase 5 focuses on making Wogi Flow distributable as an npm package. This includes creating a proper package structure, CLI entry point, release channel configuration, and the foundation for a skill library marketplace. The package should work across different AI CLIs (Claude Code, Gemini CLI, etc.) and handle project initialization, upgrades, and skill management.

## Acceptance Criteria

### Scenario 1: Global npm installation
**Given** a developer with Node.js installed
**When** they run `npm install -g wogi-flow`
**Then** the `flow` command becomes available globally
**And** running `flow --version` shows the installed version

### Scenario 2: Project initialization
**Given** a new or existing project without Wogi Flow
**When** the developer runs `flow init` in the project directory
**Then** the `.workflow/` directory structure is created
**And** appropriate CLI files are generated based on selected CLI

### Scenario 3: Release channel configuration
**Given** an installed Wogi Flow package
**When** the developer runs `flow config set releaseChannel beta`
**Then** the release channel preference is saved
**And** future updates follow the beta channel

### Scenario 4: Upgrade handling
**Given** a project with an older Wogi Flow version
**When** the developer runs `flow upgrade`
**Then** the project is migrated to the new version
**And** backward compatibility is maintained

### Scenario 5: Skill installation from registry
**Given** a configured Wogi Flow project
**When** the developer runs `flow skill add react`
**Then** the react skill is downloaded from the registry
**And** installed to `.claude/skills/react/`

## Technical Notes
- **Components**:
  - Create new: package.json (npm package config)
  - Create new: bin/flow (CLI entry point)
  - Create new: lib/installer.js (installation logic)
  - Create new: lib/upgrader.js (upgrade/migration logic)
  - Create new: lib/skill-registry.js (remote skill fetching)
  - Use existing: scripts/flow (main CLI router)
  - Use existing: scripts/flow-*.js (all existing modules)
- **Package Structure**:
  ```
  wogi-flow/
  ├── package.json
  ├── bin/
  │   └── flow           # CLI entry point
  ├── lib/
  │   ├── installer.js   # Project setup
  │   ├── upgrader.js    # Version migrations
  │   └── skill-registry.js
  ├── templates/         # Project templates
  │   ├── workflow/      # .workflow structure
  │   └── claude/        # .claude structure
  └── scripts/           # Existing modules
  ```
- **Release Channels**: stable, beta, canary
- **Skill Registry**: GitHub-based, versioned, community contributions

## Test Strategy
- [ ] Unit: Installer creates correct directory structure
- [ ] Unit: Upgrader handles version migrations
- [ ] Unit: Skill registry fetches and validates skills
- [ ] Integration: Full init → configure → add skill flow
- [ ] E2E: npm install -g, flow init, flow skill add

## Dependencies
- Phase 0.1: CLI Agnosticism (complete)
- All previous phases (0-4) complete

## Complexity
High - Requires restructuring codebase for npm distribution, creating installer, upgrader, and skill registry

## Out of Scope
- Team observability (Phase 6)
- Jira/Linear integration (Phase 6)
- Background sync daemon (Phase 6)
