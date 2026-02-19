# WogiFlow

A self-improving AI development workflow that learns from your feedback and works across multiple AI coding CLIs.

## Quick Start

```bash
# Install
npm install wogiflow

# Analyze your project
npx flow onboard

# Sync to your CLI
npx flow bridge sync
```

## Supported CLIs

WogiFlow works with 6 AI coding CLIs. Use whichever you prefer - the workflow state is shared.

| CLI | Enforcement | Rules File | Min Version | Guide |
|-----|-------------|------------|-------------|-------|
| **Claude Code** | Hard (hooks) | `CLAUDE.md` | **2.1.23+** | [Guide](.claude/docs/knowledge-base/01-setup-onboarding/) |
| **Gemini CLI** | Hard (hooks) | `GEMINI.md` | - | - |
| **Cursor** | Mixed | `.cursor/rules/wogiflow.mdc` | - | - |
| **OpenCode** | Hard (plugins) | `AGENTS.md` | - | - |
| **Codex** | Soft (rules) | `AGENTS.md` | - | - |
| **Kimi** | Soft (rules) | `AGENTS.md` | - | - |

> **Claude Code 2.1.23+ Recommended**: Includes critical fixes for per-user temp directory isolation (shared systems), async hook cancellation, and ripgrep timeout reporting. Earlier versions may experience silent search failures.

**Enforcement levels:**
- **Hard**: Blocks operations before execution (best protection)
- **Mixed**: Hard at prompt level, soft after
- **Soft**: Advisory only (rules in context, no blocking)

### Switching CLIs

Workflow state is stored in `.workflow/state/` - CLI-agnostic. You can:
1. Start a task in Claude Code
2. Continue it in Cursor
3. Finish it in Gemini CLI

Run `npx flow bridge sync` after switching to regenerate CLI-specific files.

---

## Core Features

| Feature | Description |
|---------|-------------|
| **Task Gating** | Blocks implementation without an active task |
| **Self-Completing Tasks** | `/wogi-start` runs until all criteria pass |
| **Component Registry** | Prevents duplicate components via app-map |
| **Post-Edit Validation** | Auto-runs lint/typecheck after every edit |
| **Request Logging** | All changes logged with tags for searchability |
| **Adversarial Code Review** | Review agents must find minimum findings or justify clean code |
| **Git-Verified Claims** | Cross-references spec deliverables against actual git diff |
| **Decision Amendment Tracking** | Auditable trail of all project rule changes with rationale |
| **Cross-Artifact Consistency** | Validates app-map/function-map/api-map against codebase |
| **TDD Mode** | Opt-in test-first development enforcement |
| **Hybrid Mode** | Claude plans, local LLM executes (20-60% token savings) |
| **Peer Review** | Multi-model code review for diverse perspectives |
| **Skills System** | Modular add-ons that learn from your sessions |
| **Research Protocol** | Enforces verification before capability claims |

---

## Developer Workflow

### Daily Commands

```bash
# Session start
/wogi-morning              # Morning briefing with task recommendations
/wogi-ready                # Show available tasks
/wogi-status               # Project overview

# Task execution
/wogi-start TASK-012       # Start task (self-completing loop)
/wogi-start "add feature"  # Or describe what you want

# Creation
/wogi-story "Add login"    # Create story with acceptance criteria
/wogi-bug "Login fails"    # Report a bug

# Session end
/wogi-review               # Code review with 3 parallel agents
/wogi-session-end          # Save progress, commit, push
```

### How Tasks Work

```
/wogi-start "add logout button"
    │
    ├── [AUTO] Classify request → Implementation
    ├── [AUTO] Check app-map for existing components
    ├── [AUTO] Generate acceptance criteria
    │
    │   FOR EACH edit:
    │   ├── [AUTO] Validate file is in scope
    │   ├── [AUTO] Run lint/typecheck
    │
    ├── [AUTO] Verify ALL criteria met
    ├── [AUTO] Update app-map, request-log
    └── [AUTO] Commit changes
```

### Command Quick Reference

| Category | Commands |
|----------|----------|
| **Tasks** | `/wogi-ready`, `/wogi-start`, `/wogi-status`, `/wogi-deps` |
| **Create** | `/wogi-story`, `/wogi-bug`, `/wogi-feature` |
| **Review** | `/wogi-review`, `/wogi-peer-review` |
| **Components** | `/wogi-map`, `/wogi-map-add`, `/wogi-map-scan` |
| **Session** | `/wogi-morning`, `/wogi-session-end`, `/wogi-health` |
| **Hybrid** | `/wogi-hybrid`, `/wogi-hybrid-setup`, `/wogi-hybrid-off` |
| **Utilities** | `/wogi-search`, `/wogi-trace`, `/wogi-config` |

---

## CLI Commands

```bash
# Setup
flow onboard                    # Analyze project, populate state files
flow bridge sync                # Sync to current CLI

# Tasks
flow ready                      # Show task queue
flow start <id>                 # Start task
flow status                     # Project overview

# Components
flow map-index scan             # Rescan codebase
flow map-sync                   # Compare index with app-map

# Hybrid Mode
flow hybrid enable              # Enable with setup wizard
flow hybrid status              # Show configuration

# Skills
flow skill-learn                # Extract learnings from session
flow skill detect               # Detect frameworks

# Health
flow health                     # Check workflow integrity
flow verify all                 # Run all quality gates
```

---

## File Structure

```
.workflow/
├── config.json              # Workflow configuration
├── bridges/                 # CLI bridge implementations
├── templates/               # Templates for CLI files
├── docs/cli-guides/         # Per-CLI documentation
└── state/
    ├── ready.json           # Task queue
    ├── request-log.md       # Change history
    ├── app-map.md           # Component registry
    ├── function-map.md      # Utility function registry
    ├── api-map.md           # API endpoint registry
    ├── decisions.md         # Project rules
    ├── decision-amendments.json  # Rule change audit trail
    └── progress.md          # Session handoff notes

.claude/                     # Claude Code specific
├── skills/                  # Skill modules
├── docs/                    # Documentation
└── rules/                   # Project rules

CLAUDE.md                    # Claude Code instructions (generated)
GEMINI.md                    # Gemini CLI instructions (generated)
AGENTS.md                    # Codex/Kimi/OpenCode instructions (generated)
```

---

## Configuration

Main configuration in `.workflow/config.json`:

```json
{
  "enforcement": {
    "strictMode": true
  },
  "hooks": {
    "rules": {
      "taskGating": { "enabled": true },
      "validation": { "enabled": true },
      "componentReuse": { "enabled": true }
    }
  },
  "qualityGates": {
    "feature": { "require": ["tests", "appMapUpdate", "requestLogEntry"] }
  },
  "hybrid": {
    "enabled": false,
    "provider": "ollama"
  }
}
```

---

## Documentation

Detailed documentation is in the [Knowledge Base](.claude/docs/knowledge-base/README.md):

| Category | Topics |
|----------|--------|
| [Setup & Onboarding](.claude/docs/knowledge-base/01-setup-onboarding/) | Installation, onboarding, component indexing |
| [Task Execution](.claude/docs/knowledge-base/02-task-execution/) | Workflow steps, verification, completion |
| [Self-Improvement](.claude/docs/knowledge-base/03-self-improvement/) | Skills, learning, model adapters |
| [Memory & Context](.claude/docs/knowledge-base/04-memory-context/) | Context management, session persistence |
| [Development Tools](.claude/docs/knowledge-base/05-development-tools/) | Figma analyzer, code traces, MCP |
| [Safety & Guardrails](.claude/docs/knowledge-base/06-safety-guardrails/) | Damage control, checkpoints, security |
| [Configuration](.claude/docs/knowledge-base/configuration/) | All configuration options |

### CLI-Specific Setup

Each CLI uses its own rules file format. Run `npx flow bridge sync` to generate the appropriate file for your CLI. See the [Setup & Onboarding docs](.claude/docs/knowledge-base/01-setup-onboarding/) for detailed instructions.

---

## Self-Improving Workflow

WogiFlow learns from your corrections:

1. **Correction** → You correct the AI's work
2. **Fix** → AI fixes immediately
3. **Learn** → AI asks to persist the rule
4. **Update** → Updates decisions.md / skills / config
5. **Track** → Logs to feedback-patterns.md

After 3+ similar corrections → promotes to permanent instruction.

### Decision Amendment Tracking

All changes to project rules (`decisions.md`) are tracked with an audit trail:

```bash
# Record a rule change
node scripts/flow-decision-tracker.js record "Coding Standards" add "Added TDD enforcement rule"

# View amendment history
node scripts/flow-decision-tracker.js history

# View statistics
node scripts/flow-decision-tracker.js stats
```

Each amendment records: timestamp, section, action, rationale, source, and impact assessment.

### Cross-Artifact Consistency

Validates that app-map, function-map, and api-map stay in sync with the codebase:

```bash
# Run consistency check
node scripts/flow-consistency-check.js

# JSON output for CI
node scripts/flow-consistency-check.js --json
```

Detects: phantom entries (documented but missing), orphan files (exist but undocumented), and cross-map mismatches.

---

## License

AGPL-3.0
