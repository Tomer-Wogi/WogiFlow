# Project Roadmap

Future work and deferred phases. Items here are ideas/plans, not yet refined into stories.

**Auto-managed by WogiFlow** - Items are added when large features are broken into phases.

---

## Now (Current Focus)

<!-- Items actively being worked on. Usually maps to stories in ready.json -->

### Phase 0.1.1: CLI Template System

**Status:** Ready to Start
**Created:** 2026-01-13
**Depends On:** None

**Assumes:**
- Handlebars available as dependency
- Current CLAUDE.md generation works as reference

**Key Files:**
- `scripts/flow-cli-sync.js` - New file to create
- `.workflow/templates/claude-md.hbs` - Existing template to migrate

**Implementation Plan:**
1. Create flow-cli-sync.js with Handlebars rendering
2. Define template context structure
3. Add CLI detection utilities

---

---

## Next (Ready to Plan)

<!-- Items to tackle after current work. Ready to be promoted to stories. -->

### Phase 0.1.2: Claude Template

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System

**Assumes:**
- CLI Template System implemented
- Handlebars rendering working

**Key Files:**
- `scripts/flow-cli-sync.js` - Template renderer
- `.workflow/cli/templates/claude.hbs` - New template location

**Implementation Plan:**
1. Migrate current CLAUDE.md generation to template
2. Add progressive discovery references
3. Test sync command

---

### Phase 0.1.6: Sync Command

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System

**Assumes:**
- Template system implemented
- All CLI templates created (0.1.2-0.1.5)

**Key Files:**
- `scripts/flow` - Add sync subcommand
- `scripts/flow-cli-sync.js` - Sync logic

**Implementation Plan:**
1. Add `flow sync` CLI command
2. Detect active CLIs from config
3. Generate all CLI-specific files

---

### Phase 0.2: Failure Category Enum

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** None

**Assumes:**
- Current ERROR_CATEGORIES in flow-adaptive-learning.js as starting point

**Key Files:**
- `scripts/flow-adaptive-learning.js` - Existing partial implementation
- `scripts/flow-utils.js` - Where enum should live

**Context When Deferred:**
Consistent error categorization needed by Cascade Fallback, Model Stats, and Learning system.

**Implementation Plan:**
1. Formalize FailureCategory enum in flow-utils.js
2. Update flow-adaptive-learning.js to use it
3. Document categories and usage

---

### Phase 0.3: Variable Substitution in Config

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** None

**Assumes:**
- Config files use JSON format
- Secrets should not be in version control

**Key Files:**
- `scripts/flow-utils.js` - Add substitution function
- `.workflow/config.json` - Will use patterns

**Context When Deferred:**
Cleaner config patterns for secrets and environment variables.

**Implementation Plan:**
1. Implement {file:path} pattern for file-based secrets
2. Implement {env:VAR} pattern for environment variables
3. Add to config loading in flow-utils.js

---

---

## Later (Future Phases)

<!-- Deferred items from large feature breakdowns. Includes dependency tracking. -->

### Phase 0.1.3: Codex Template

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System

**Assumes:**
- Template system implemented
- TOML config format understood

**Key Files:**
- `scripts/flow-cli-sync.js` - Template renderer
- `.workflow/cli/templates/codex.hbs` - New template

**Context When Deferred:**
Codex CLI uses AGENTS.md with <100 lines best practice and TOML config.

**Implementation Plan:**
1. Create AGENTS.md template (<100 lines)
2. Add progressive discovery pattern
3. Support TOML config generation

---

### Phase 0.1.4: Gemini Template

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System

**Assumes:**
- Template system implemented
- Gemini CLI docs understood

**Key Files:**
- `scripts/flow-cli-sync.js` - Template renderer
- `.workflow/cli/templates/gemini.hbs` - New template

**Context When Deferred:**
Gemini CLI uses GEMINI.md + system.md pattern with 8 hook events.

**Implementation Plan:**
1. Create GEMINI.md template
2. Create system.md template
3. Support Gemini hook integration

---

### Phase 0.1.5: OpenCode Template

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System

**Assumes:**
- Template system implemented
- OpenCode follows AGENTS.md pattern

**Key Files:**
- `scripts/flow-cli-sync.js` - Template renderer
- `.workflow/cli/templates/opencode.hbs` - New template

**Implementation Plan:**
1. Create AGENTS.md template for OpenCode
2. Create opencode.json config template

---

### Phase 0.1.7: Hook Integration

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.6: Sync Command

**Assumes:**
- Sync command working
- All CLI templates created

**Key Files:**
- `scripts/flow-cli-sync.js` - Hook handlers
- `.workflow/cli/hooks/` - Hook scripts

**Context When Deferred:**
Event-based sync for task completions, learnings back to .workflow/.

**Implementation Plan:**
1. Define hook events per CLI
2. Create hook scripts for each CLI
3. Sync learnings back to model-adapters/

---

### Phase 0.1.8: Installer Update (Multi-CLI)

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.2, Phase 0.1.3, Phase 0.1.4, Phase 0.1.5

**Assumes:**
- All CLI templates working
- Sync command operational

**Key Files:**
- `scripts/postinstall.js` - Installer script
- `scripts/flow-cli-sync.js` - Sync utilities

**Context When Deferred:**
Installer should ask "Which CLI(s)?" and generate appropriate files.

**Implementation Plan:**
1. Add CLI selection prompt to postinstall
2. Support multiple CLI selection
3. Generate all selected CLI files

---

### Phase 0.1.9: CLI Detection

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System

**Assumes:**
- CLI environment variables documented
- Detection possible at runtime

**Key Files:**
- `scripts/flow-cli-sync.js` - Detection logic

**Implementation Plan:**
1. Research env vars per CLI
2. Implement getCurrentCLI() function
3. Auto-sync on CLI switch

---

### Phase 1.1: Formalized Model Registry

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1: CLI Agnosticism

**Assumes:**
- CLI agnosticism complete
- Provider abstraction in place

**Key Files:**
- `.workflow/models/registry.json` - New file
- `scripts/flow-models.js` - Registry management

**Context When Deferred:**
Central registry of all model capabilities, cost tiers, and language support.

**Implementation Plan:**
1. Define registry.json schema
2. Populate with known models
3. Add registry query functions

---

### Phase 1.2: Enhanced Model Stats

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 1.1: Model Registry, Phase 0.2: Failure Categories

**Assumes:**
- Model registry implemented
- Failure categories formalized

**Key Files:**
- `.workflow/models/stats.json` - Stats storage
- `scripts/flow-models.js` - Stats tracking

**Context When Deferred:**
Track success rates, latency, failure categories per model and task type.

**Implementation Plan:**
1. Define stats.json schema
2. Integrate with task execution
3. Add stats query commands

---

### Phase 2.1: Multi-Model Mode

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 1.1: Model Registry, Phase 1.2: Model Stats

**Assumes:**
- Model registry complete
- Stats tracking operational

**Key Files:**
- `scripts/flow-multi-model.js` - New file
- `.workflow/config.json` - Model routing config

**Context When Deferred:**
Replaces/evolves Hybrid Mode. Multiple models available with intelligent selection.

**Implementation Plan:**
1. Implement model selection logic
2. Add routing strategies (task-based, cost-optimized, quality-first)
3. Create configuration interface

---

### Phase 2.2: Prompt Fragment System

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 1.1: Model Registry, Phase 0.1: CLI Agnosticism

**Assumes:**
- Model registry knows prompt preferences
- CLI templates working

**Key Files:**
- `scripts/flow-prompt-fragments.js` - New file
- `.workflow/prompts/` - Fragment storage

**Context When Deferred:**
Different models need different prompts. Composable fragments vs monolithic templates.

**Implementation Plan:**
1. Define fragment structure
2. Create model-specific fragments
3. Implement fragment composition

---

### Phase 3.1: Task Router

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 2.1: Multi-Model Mode

**Assumes:**
- Multi-model mode operational
- Model stats available

**Key Files:**
- `scripts/flow-task-router.js` - New file
- `.workflow/config.json` - Routing rules

**Context When Deferred:**
Route task types to optimal models based on capabilities and history.

**Implementation Plan:**
1. Implement task analysis
2. Match tasks to model capabilities
3. Add routing rules configuration

---

### Phase 3.2: Cascade Fallback

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 3.1: Task Router, Phase 0.2: Failure Categories

**Assumes:**
- Task router operational
- Failure categories formalized

**Key Files:**
- `scripts/flow-cascade.js` - New file
- `.workflow/config.json` - Cascade config

**Context When Deferred:**
If primary model fails 3x on same error, try alternate model.

**Implementation Plan:**
1. Track failure patterns
2. Implement fallback logic
3. Add escalation configuration

---

### Phase 3.3: Tiered Learning Thresholds

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 1.2: Model Stats, Phase 2.1: Multi-Model Mode

**Assumes:**
- Model stats tracking success rates
- Multiple models available

**Key Files:**
- `scripts/flow-adaptive-learning.js` - Update existing
- `.workflow/config.json` - Threshold config

**Context When Deferred:**
Smarter auto-application of learned patterns based on confidence tiers.

**Implementation Plan:**
1. Define learning tiers (AUTO_APPLY, APPLY_WITH_LOG, QUEUE_FOR_REVIEW)
2. Implement tier-based application
3. Per-model threshold tracking

---

### Phase 4.1: Parallel Dispatch

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 3.1: Task Router

**Assumes:**
- Task router can identify subtasks
- Multiple models available

**Key Files:**
- `scripts/flow-parallel.js` - New file

**Context When Deferred:**
Execute independent subtasks on multiple models simultaneously.

**Implementation Plan:**
1. Implement subtask detection
2. Create parallel execution engine
3. Add result aggregation

---

### Phase 4.2: Context Priority Scoring

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 1.1: Model Registry

**Assumes:**
- Model context windows known from registry

**Key Files:**
- `scripts/flow-auto-context.js` - Update existing

**Context When Deferred:**
Smarter context selection based on priority scoring vs "include everything".

**Implementation Plan:**
1. Define priority weights
2. Score context items
3. Select by available context window

---

### Phase 4.3: Quality Gate Confidence

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** None (benefits from model stats)

**Assumes:**
- Can detect confidence markers in responses

**Key Files:**
- `scripts/flow-quality-gates.js` - Update existing

**Context When Deferred:**
Don't apply low-confidence changes automatically.

**Implementation Plan:**
1. Define confidence markers
2. Detect confidence level in responses
3. Gate auto-application on confidence

---

### Phase 5.1: npm Package Distribution

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1: CLI Agnosticism

**Assumes:**
- CLI agnosticism complete
- One package works for all CLIs

**Key Files:**
- `package.json` - npm config
- `scripts/flow` - Entry point

**Context When Deferred:**
Global install via `npm install -g wogi-flow` with perfect update stability.

**Implementation Plan:**
1. Prepare package.json for publication
2. Create flow upgrade command
3. Test installation across CLIs

---

### Phase 5.1.1: Release Channel Configuration

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 5.1: npm Package Distribution

**Assumes:**
- npm package published
- Multiple release tracks desired

**Key Files:**
- `.workflow/config.json` - Channel settings
- `scripts/flow-updater.js` - New file

**Context When Deferred:**
Users choose stable vs beta releases with auto-update preferences.

**Implementation Plan:**
1. Add releaseChannel config
2. Implement version checking
3. Add update notification

---

### Phase 5.1.2: LSP Tool Integration

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 5.1: npm Package Distribution

**Assumes:**
- npm package distributed
- CLIs have LSP capabilities

**Key Files:**
- `scripts/flow-lsp.js` - New file

**Context When Deferred:**
Code intelligence features improve DX significantly.

**Implementation Plan:**
1. Create LSP client wrapper
2. Integrate with skill patterns
3. Add symbol-based component detection

---

### Phase 5.2: Skill Library Marketplace

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 5.1: npm Package, Phase 0.1: CLI Agnosticism

**Assumes:**
- npm package available
- Skills work across CLIs

**Key Files:**
- `scripts/flow-skill-marketplace.js` - New file
- GitHub repo for skills

**Context When Deferred:**
Community skill sharing with discovery, installation, publishing.

**Implementation Plan:**
1. Create GitHub-hosted skill repository
2. Implement skill search/browse
3. Add skill install with dependency resolution
4. Create skill publishing workflow

---

### Phase 6.1: Team Observability Web UI

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Team Backend (already exists)

**Assumes:**
- Team backend API available
- Web dashboard needed

**Key Files:**
- `web/` - New directory for UI

**Context When Deferred:**
Web UI for task progress, step status, execution history.

**Implementation Plan:**
1. Design dashboard layout
2. Implement run status display
3. Add step-level tracing view
4. Role-based access control

---

### Phase 6.2: Jira/Linear Integration

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** None (standalone)

**Assumes:**
- External PM tool APIs available
- Task sync desired

**Key Files:**
- `scripts/flow-integrations.js` - New file
- `.workflow/config.json` - Integration config

**Context When Deferred:**
Sync tasks from external project management tools.

**Implementation Plan:**
1. Implement Jira API client
2. Implement Linear API client
3. Add sync commands
4. Auto-create stories from external

---

### Phase 6.3: Background Sync Daemon

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 4.1: Parallel Dispatch

**Assumes:**
- Multiple agents work simultaneously
- File watching needed

**Key Files:**
- `scripts/flow-daemon.js` - New file

**Context When Deferred:**
Keep state in sync when multiple agents work on different branches.

**Implementation Plan:**
1. Implement file watcher
2. Add branch switch detection
3. Create heartbeat monitoring

---

---

## Ideas (Exploration)

<!-- Nice-to-have, not committed. No dependencies tracked yet. -->

### Structured JSON Contract

**Why deferred**: Local LLMs can't reliably produce JSON. Current flow-response-parser.js handles messy output.

---

### SQLite Telemetry

**Why deferred**: JSON files work fine for 50 runs/day. Would reconsider if users need complex queries.

---

### Move npm to @wogi Organization

**Why deferred**: Current `wogiflow` package works fine. Migration adds complexity (scoped package, update all docs). Consider when team grows or branding matters.

---

### Browser Testing Integration

**Priority**: Medium

Integrate browser-based testing into the workflow for UI verification.

**Features**:
- Automated browser test suggestions after UI changes
- Integration with Playwright/Puppeteer for E2E tests
- Visual regression testing support

---

---

## Completed

<!-- Archive of completed roadmap items for reference -->

### Loop Retry Learning

**Implemented:** 2026-01-09
**Files:** `scripts/flow-loop-retry-learning.js`

Analyzes tasks >3 iterations, identifies root causes, suggests pattern updates.

---

### Strategy Effectiveness Tracking

**Implemented:** 2026-01-09
**Files:** `scripts/flow-adaptive-learning.js`
**Command:** `./scripts/flow hybrid learning effectiveness`

---

### Learning Deduplication

**Implemented:** 2026-01-09
**Files:** `scripts/flow-adaptive-learning.js`

7-day window deduplication in learning system.

---

### Community Contribution

**Implemented:** 2026-01-09
**Commands:** `flow hybrid learning contribute`, `--auto-pr` option

---

### Enhanced Installation

**Implemented:** 2026-01-10
**Features:** Hub-spoke skills, tech stack wizard

---

### Component Index Freshness

**Implemented:** 2026-01-10
**Features:** afterTask, staleCheck, gitHooks

---

### Guided Edit Mode

**Implemented:** 2026-01-11
**Files:** `scripts/flow-guided-edit.js`
**Command:** `/wogi-guided-edit`

---

### Roadmap Management System

**Implemented:** 2026-01-13
**Files:** `scripts/flow-roadmap.js`, `.claude/commands/wogi-roadmap.md`
**Commands:** `/wogi-roadmap add`, `/wogi-roadmap promote`, `/wogi-roadmap validate`

---

---

## How This File Works

### Adding Items
- **Manually**: Edit this file directly
- **Via AI**: When you request a large feature, I'll ask if you want to defer phases here
- **Command**: `/wogi-roadmap add "Feature name" --phase=later`

### Promoting Items
When ready to implement a roadmap item:
1. Run `/wogi-roadmap promote "Feature name"`
2. I'll validate dependencies still hold
3. I'll create a story in ready.json

### Dependency Validation
Before implementing any item, I check:
- **Depends On**: Is the parent phase/feature complete?
- **Assumes**: Do assumptions still hold in current codebase?
- **Key Files**: Do required files exist with expected interfaces?

If validation fails, I'll explain what changed and offer options.
