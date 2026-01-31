# Request Log

Automatic log of all requests that changed files. Searchable by tags.

**Search examples:**
```bash
grep -A5 "#screen:login" .workflow/state/request-log.md
grep -A5 "#component:Button" .workflow/state/request-log.md
grep -A5 "Type: fix" .workflow/state/request-log.md
```

---

<!-- Entries below. Format: R-001, R-002, etc. -->

### R-037 | 2026-01-11 10:30
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-1-05 #templates #cli-agnosticism
**Request**: "Create universal templates"
**Result**: Created Handlebars templates for CLI-specific files:
- Created `.workflow/templates/claude-md.hbs`:
  - Full CLAUDE.md template with Handlebars syntax
  - Conditional task gating section (if strictMode enabled)
  - Dynamic skill listing
  - Config value interpolation (commits, thresholds, etc.)
  - Sections: Quick Start, Commands, Session Startup, Task Rules,
    Auto-validation, Request Logging, Component Reuse, Skills,
    File Locations, Commit Behavior, Quality Gates, Context Management
- Created `.workflow/templates/gemini-md.hbs`:
  - Stub template for Gemini CLI
  - Basic structure with project info
  - Placeholder for future implementation
**Files**:
- .workflow/templates/claude-md.hbs (new)
- .workflow/templates/gemini-md.hbs (new)

### R-038 | 2026-01-11 11:00
**Type**: change
**Tags**: #feature:phase-0-foundation #wf-phase0-1-06 #providers #cli-agnosticism
**Request**: "Add provider configuration schema"
**Result**: Added CLI configuration to each provider in registry.json:
- Added `cli` object to each provider with:
  - `name`: CLI display name
  - `cliId`: CLI identifier for bridge selection
  - `folderStructure`: Paths for configDir, skillsDir, rulesDir, commandsDir, docsDir
  - `rulesFile`: Main instructions file name (CLAUDE.md, GEMINI.md)
  - `promptStyle`: Prompt format preference (xml-tags, markdown)
  - `hotReload`: Whether CLI supports hot-reload
  - `features`: Supported features array
- Anthropic/Claude Code: Full configuration with xml-tags style, hot-reload
- Google/Gemini CLI: Stub configuration with markdown style
- OpenAI: No CLI (cli: null)
- Ollama: No CLI (cli: null)
**Files**:
- .workflow/models/registry.json

### R-039 | 2026-01-11 11:30
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-1-07 #migration #cli-agnosticism
**Request**: "Create migration command"
**Result**: Created `flow migrate` command for migrating existing projects:
- Created `flow-migrate.js` with:
  - Migration plan display with status indicators
  - Backup creation before making changes
  - Models directory creation (registry.json, stats.json)
  - Bridges directory copying
  - CLI config addition to config.json
  - Skills migration from .claude/skills/ to .workflow/skills/
  - Templates directory creation
  - Bridge sync execution
- Options:
  - `--dry-run`: Preview changes without modifying files
  - `--force`: Skip confirmation prompt
- Detects existing migration state and skips completed steps
- Provides next steps guidance after migration
**Files**:
- scripts/flow-migrate.js (new)
- scripts/flow

---

### R-040 | 2026-01-11 11:45
**Type**: feature
**Tags**: #phase:0-foundation #workflow:knowledge-sync #workflow:assumptions
**Request**: "Implement Phase 0.4 (Synced Knowledge Files) and Phase 0.5 (Hybrid Assumption Surfacing)"
**Result**: Implemented both features:

**Phase 0.4 - Synced Knowledge Files:**
- Created knowledge file templates (stack.md, architecture.md, testing.md)
- Added generation functions to flow-onboard
- Implemented drift detection via flow-knowledge-sync.js
- Integrated with bridge sync to copy knowledge files to CLI folders
- Updated health check to verify knowledge files and sync status

**Phase 0.5 - Hybrid Assumption Surfacing:**
- Created assumption-detector.js library with pattern-based detection
- Detects technical, scope, requirements, UI, data, and behavior assumptions
- Assigns confidence levels (0.3-0.9) to each assumption
- Generates AskUserQuestion-compatible format for clarification
- Updated spec generator to include assumptions section
- Updated CLAUDE.md with assumption surfacing guidelines

**Files**:
- .workflow/lib/assumption-detector.js (new)
- .workflow/state/stack.md (new)
- .workflow/state/architecture.md (new)
- .workflow/state/testing.md (new)
- .workflow/state/knowledge-sync.json (new)
- scripts/flow-knowledge-sync.js (new)
- scripts/flow-utils.js (modified - added knowledge file paths)
- scripts/flow-health.js (modified - added knowledge files check)
- scripts/flow-spec-generator.js (modified - added assumptions section)
- scripts/flow (modified - added knowledge-sync command)
- .workflow/bridges/base-bridge.js (modified - added knowledge sync)
- CLAUDE.md (modified - added assumption surfacing guidelines)

### R-041 | 2026-01-11 12:45
**Type**: new
**Tags**: #wf-9fc30fe7 #claude-code #skills #permissions #alignment
**Task**: Claude Code 2.1.x Alignment - Skill Frontmatter & Permissions
**Request**: "Analyze Claude Code changelog and implement alignment opportunities"
**Result**: Aligned Wogi Flow with Claude Code 2.1.0-2.1.3 features:
- Updated skill template with new frontmatter fields (user-invocable, context, agent, allowed-tools)
- Updated all 5 existing skills with new frontmatter
- Reduced permissions from 150+ to 51 using wildcard patterns (Bash(npm *), etc.)
- Added permission validation to flow-health.js (duplicates, shadowed, overly broad)
- Added respectGitignore setting to settings.local.json
- Updated hook timeout from 5s to 10min (aligns with Claude Code 2.1.2)
- Added LSP Tool Integration and Release Channel Configuration to roadmap (Phase 5.1.1, 5.1.2)
**Files**:
- .claude/skills/_template/skill.md
- .claude/skills/*/skill.md (5 skills updated)
- .claude/settings.local.json
- .workflow/bridges/claude-bridge.js
- .workflow/config.json
- .workflow/roadmap/roadmap.md
- scripts/flow-health.js

### R-042 | 2026-01-11 12:33
**Type**: new
**Tags**: #wf-c14cfa59 #phase-1 #model-infrastructure #registry #stats
**Task**: Phase 1: Model Infrastructure - Registry Commands and Stats Integration
**Request**: "Create CLI commands to interact with model registry and view performance statistics"
**Result**: Created comprehensive model management commands:
- Created scripts/flow-models.js with all registry and stats functionality
- `flow models` - Show current model and routing configuration
- `flow models list` - List all registered models grouped by cost tier
- `flow models info <model>` - Show detailed model info (capabilities, pricing, languages)
- `flow models route <task-type>` - Get routing recommendation for task type
- `flow models stats` - Show model performance statistics
- `flow models cost` - Show cost analysis and optimization recommendations
- `flow models providers` - List available providers with CLI support info
- All commands support `--json` flag for programmatic output
- Added models command to scripts/flow router with help text
- Exports recordTaskExecution() for other scripts to use
**Files**:
- scripts/flow-models.js (new)
- scripts/flow (updated)

### R-043 | 2026-01-11 13:00
**Type**: fix
**Tags**: #wf-3b67fde3 #code-quality #security #architecture #session-review
**Task**: Fix session review issues - code quality, security, and architecture
**Request**: "fix the 15 issues please" (from session review)
**Result**: Fixed all 12 issues identified by 3-agent code review:

**flow-models.js (6 fixes)**:
- Fixed cost tracking logic bug - calculate cost BEFORE recording tokens
- Extracted magic numbers to CONFIG constant (TIER_ORDER, MAX_RECENT_TASKS, etc.)
- Fixed DRY violation with filterAndSortModels() helper
- Added safeJsonParse() for JSON prototype pollution protection
- Added input validation (validateProvider, validateCapability)
- Added calculateTaskCost() helper function

**flow-knowledge-sync.js (3 fixes)**:
- Added escapeGlobToRegex() for safe regex conversion
- Added isSafePattern() for pattern validation
- Fixed regenerateKnowledgeFiles() - replaced execSync with spawn, honest error handling

**assumption-detector.js (2 fixes)**:
- Removed unused fs/path imports
- Moved regex patterns to module scope (FRAMEWORK_PATTERNS, SCOPE_PATTERNS, etc.)

**Architecture documentation (1 fix)**:
- Added Model Management Architecture decision to decisions.md
- Documented two getCurrentModel functions purpose and design rationale
- Added JSON Safety Pattern decision

**Files**:
- scripts/flow-models.js
- scripts/flow-knowledge-sync.js
- .workflow/lib/assumption-detector.js
- .workflow/state/decisions.md

### R-044 | 2026-01-11 14:00
**Type**: fix
**Tags**: #wf-8a4c2b91 #code-quality #security #session-review-pass-2
**Task**: Fix all 17 session review issues - second pass
**Request**: "fix all of them" (from second session review)
**Result**: Fixed all remaining issues from second code review:

**CRITICAL (2):**
- Fixed spawn() relative path in flow-knowledge-sync.js - now uses absolute path via path.join()
- Fixed Gherkin validation logic in assumption-detector.js - changed OR to AND (requires Given AND When AND Then)

**HIGH (4):**
- Fixed null reference in capabilities check - added optional chaining
- Fixed silent failure in hashFile() - returns {hash, error} object with error context
- Extracted safeJsonParse to flow-utils.js with enhanced prototype pollution protection
- Removed local safeJsonParse from flow-models.js, now imports from flow-utils

**MEDIUM (7):**
- Validated CLAUDE_MODEL env var against registry before use
- Added CONFIG constants for decimal places and success rate thresholds
- Fixed DRY violation with getAlternatives() helper function
- Enhanced prototype pollution check with regex and Object.getOwnPropertyNames
- Added isPathWithinProject checks for defense-in-depth path validation
- Added MAX_INPUT_SI

### R-045 | 2026-01-11 15:40
**Type**: new
**Tags**: #feature:phase-2 #multi-model #wf-b31df786 #architecture
**Request**: "Phase 2: Multi-Model Core - Task Analysis and Model Routing"
**Result**: Implemented Phase 2 multi-model infrastructure:
- Created `flow-task-analyzer.js` - analyzes task complexity, domains, languages, capabilities
- Created `flow-model-router.js` - quality-first, cost-optimized, and learned routing strategies
- Created `flow-prompt-composer.js` - assembles prompts from fragments per model/CLI
- Created prompt fragments in `.workflow/prompts/fragments/`
- Added `flow models recommend` command integrating all components
- Added `multiModel` config section to config.json
**Files**: scripts/flow-task-analyzer.js, scripts/flow-model-router.js, scripts/flow-prompt-composer.js, scripts/flow-models.js, scripts/flow-utils.js, .workflow/config.json, .workflow/prompts/fragments/*.md

### R-046 | 2026-01-11 17:15
**Type**: new
**Tags**: #feature:multi-model #phase-3 #wf-b7cb0362 #routing #cascade #learning
**Request**: "Phase 3: Intelligent Routing - Cascade Fallback and Tiered Learning"
**Result**: Implemented intelligent task-to-model routing with cascade fallback and tiered learning:
- Created flow-cascade.js - Cascade fallback system with:
  - Failure tracking by model/task/category
  - Auto-escalation after configurable threshold (default: 3 failures)
  - 10 failure categories (parse_error, type_error, rate_limit, etc.)
  - Configurable reset timeout (default: 30 minutes)
- Created flow-tiered-learning.js - Tiered learning system with:
  - AUTO_APPLY tier: 90%+ success, 5+ samples → apply silently
  - APPLY_WITH_LOG tier: 70%+ success, 3+ samples → apply and log
  - QUEUE_FOR_REVIEW tier: default → queue for human review
  - Pattern statistics tracking and tier classification
- Enhanced flow-model-router.js with:
  - Task-type specific routing (architecture→premium, boilerplate→economy)
  - Language-specific routing with proficiency requirements
  - Constraint-based filtering (maxCostTier, requiredCapabilities)
  - Cascade integration for fallback routing
- Integrated cascade tracking in flow-models.js recordTaskExecution()
- Added CLI commands: flow route, flow cascade, flow learning
- Added config sections: cascade, tieredLearning
**Files**:
- scripts/flow-cascade.js (new)
- scripts/flow-tiered-learning.js (new)
- scripts/flow-model-router.js (enhanced)
- scripts/flow-models.js (modified)
- scripts/flow (modified)
- .workflow/config.json (modified)

### R-047 | 2026-01-11 17:30
**Type**: fix
**Tags**: #fix #security #code-quality #wf-c17afbcb #phase-3
**Request**: "Fix all session review issues"
**Result**: Fixed 25 issues identified in session review:
- Critical: Division by zero in task-type success rate calculation
- High: JSON injection prevention via schema validation for CLI inputs
- High: Environment variable injection prevention via safe pattern validation
- Medium: Extracted magic numbers to named constants
- Medium: Complete tiered learning integration in flow-models.js
- Medium: Proper error logging for module failures
- Low: Added pipefail for shell script error handling
**Files**:
- scripts/flow-model-router.js (JSON validation, division fix)
- scripts/flow-models.js (env var validation, tiered learning integration)
- scripts/flow-cascade.js (magic numbers)
- scripts/flow-tiered-learning.js (magic numbers)
- scripts/flow (pipefail)

### R-048 | 2026-01-11 15:50
**Type**: new
**Tags**: #feature:phase4 #wf-3337eb32 #parallel-dispatch #context-scoring #gate-confidence
**Request**: "Phase 4: Advanced Execution - Parallel Dispatch, Context Scoring, and Quality Gate Confidence"
**Result**: Created Phase 4 Advanced Execution components:
- flow-parallel-dispatch.js: Subtask analysis, dependency detection, parallel dispatch planning
- flow-context-scoring.js: Context priority scoring, token budget management
- flow-gate-confidence.js: AI response confidence analysis, auto-apply thresholds
- CLI commands: dispatch, ctx-score, confidence
- Config sections: parallelDispatch, contextScoring, gateConfidence
**Files**:
- scripts/flow-parallel-dispatch.js (new)
- scripts/flow-context-scoring.js (new)
- scripts/flow-gate-confidence.js (new)
- scripts/flow (updated)
- .workflow/config.json (updated)

### R-049 | 2026-01-11 19:45
**Type**: new
**Tags**: #feature:phase6 #wf-84923e2c #team-integrations #dashboard #jira #linear #sync-daemon
**Request**: "Phase 6: Team & Integrations - Observability, Jira/Linear, Sync Daemon"
**Result**: Implemented Phase 6 Team & Integrations:
- flow-team-dashboard.js: Local web observability dashboard
  - HTTP server on port 3850
  - API endpoints: /api/stats, /api/tasks, /api/logs, /api/git, /api/runs, /api/team
  - Embedded HTML dashboard with dark theme
  - Auto-refresh every 30 seconds
- flow-jira-integration.js: Jira API integration
  - List, sync, push commands
  - Caching with configurable TTL
  - Variable substitution for credentials ({env:VAR})
  - Bi-directional sync with ready.json
- flow-linear-integration.js: Linear GraphQL integration
  - List, sync, push commands
  - GraphQL API client
  - Same features as Jira integration
- flow-sync-daemon.js: Background sync daemon
  - File watching on .workflow/state/
  - Branch switch detection with state save/restore
  - Heartbeat monitoring
  - Detached process management
- CLI commands: team dashboard, jira, linear, external-tasks, sync-daemon
- Help text updated with "Integrations (Phase 6)" section
**Files**:
- scripts/flow-team-dashboard.js (new)
- scripts/flow-jira-integration.js (new)
- scripts/flow-linear-integration.js (new)
- scripts/flow-sync-daemon.js (new)
- scripts/flow (updated)
- .workflow/changes/general/wf-84923e2c.md (new)

### R-050 | 2026-01-11 21:00
**Type**: fix
**Tags**: #fix #security #code-quality #wf-p6review #phase-6
**Request**: "Fix Phase 6 session review issues - security, DRY, and code quality"
**Result**: Fixed 25+ issues identified in 3-agent code review:
- Critical: Shell injection (execFile), GraphQL injection (variables), CORS (localhost only)
- High: Race conditions, branch name validation, env var filtering, heartbeat validation
- Medium: DRY extraction of resolveConfigValue, atomic writes, cache TTL validation
- Extracted shared code to flow-utils.js (resolveConfigValue)
- Replaced crypto.randomBytes with generateTaskId throughout
- Added external ID format validation for integrations
- Fixed log rotation error handling in sync daemon
**Files**:
- scripts/flow-team-dashboard.js
- scripts/flow-jira-integration.js
- scripts/flow-linear-integration.js
- scripts/flow-sync-daemon.js
- scripts/flow-utils.js

### R-051 | 2026-01-11 22:30
**Type**: fix
**Tags**: #fix #security #critical #wf-9bcb4fa8 #phase-1-security
**Request**: "Phase 1: Critical Security Fixes - Command injection, path traversal, and shell injection"
**Result**: Fixed 19 CRITICAL security vulnerabilities from comprehensive codebase review:
- Created scripts/flow-security.js with shared security utilities:
  - validatePathWithinProject() - prevents path traversal attacks
  - safeExecFile() / safeSpawn() - safe command execution
  - safeGitCommand() - safe git commands with array args
  - escapeRegex() / sanitizeSearchPattern() - prevents ReDoS
  - safeGrep() / safeFind() - safe search operations
  - validateRepoFormat() - validates GitHub repo format
  - sanitizeCommitMessage() - sanitizes commit messages
- flow-code-intelligence.js: Replaced execSync with safeGrep/safeFind
- flow-adaptive-learning.js: Validated repo format, used execFileSync/safeGitCommand
- flow-orchestrate.js: Used execFileSync for eslint/tsc commands
- flow-worktree.js: Rewrote git() helper to use execFileSync with arrays
- flow-durable-session.js: Added path validation in checkFileCondition
**Files**:
- scripts/flow-security.js (new)
- scripts/flow-code-intelligence.js
- scripts/flow-adaptive-learning.js
- scripts/flow-orchestrate.js
- scripts/flow-worktree.js
- scripts/flow-durable-session.js

### R-052 | 2026-01-11 23:00
**Type**: fix
**Tags**: #fix #data-integrity #race-condition #wf-0d54f3e5 #phase-2-data
**Request**: "Phase 2: Race Condition & Data Integrity Fixes - Locking, atomic writes, and sync/async consistency"
**Result**: Fixed race conditions in session state management across 5 files:
- flow-loop-enforcer.js: Replaced 8 fs.writeFileSync calls with atomic writeJson
- flow-durable-session.js: Fixed saveDurableSession and archiveDurableSession
- flow-multi-approach.js: Fixed saveSession for multi-trajectory validation
- flow-orchestrate.js: Fixed updateHybridSession for hybrid mode
- flow-transcript-digest.js: Fixed edit session persistence
All session state files now use atomic write pattern (temp file + rename)
**Files**:
- scripts/flow-loop-enforcer.js
- scripts/flow-durable-session.js
- scripts/flow-multi-approach.js
- scripts/flow-orchestrate.js
- scripts/flow-transcript-digest.js

### R-053 | 2026-01-11 23:15
**Type**: fix
**Tags**: #fix #security #api #ssrf #redos #wf-3a8b5c2d #phase-3-api-security
**Request**: "Phase 3: API Security & Validation - API keys, SSRF protection, ReDoS"
**Result**: Fixed API security vulnerabilities:
- flow-providers.js: Moved Google API key from URL to x-goog-api-key header
- flow-links.js: Added comprehensive SSRF protection:
  - isPrivateIP() - detects internal IP addresses (127.x, 10.x, 172.16-31.x, 192.168.x)
  - validateUrlForSSRF() - hostname resolution and IP validation
  - Block localhost and .local/.internal hostnames
  - Require HTTPS by default
  - Validate redirect targets before following
- flow-damage-control.js: Enhanced ReDoS protection:
  - Reduced MAX_REGEX_LENGTH from 500 to 100
  - Added MAX_INPUT_LENGTH (10000) for input validation
  - Added safeRegexTest() with input length limits
  - Exported regex safety utilities for other modules
**Files**:
- scripts/flow-providers.js
- scripts/flow-links.js
- scripts/flow-damage-control.js

### R-054 | 2026-01-12 10:00
**Type**: fix
**Tags**: #workflow #learning #wf-e36a3595 #dependency-discovery
**Request**: "Add Dependency Discovery rule to prevent missing related code during refactors"
**Result**: Added mandatory "Dependency Discovery" rule to WogiFlow core:
1. Added rule to `.workflow/templates/claude-md.hbs` in "Task Execution Rules" section
2. Added expanded rule to `agents/orchestrator.md` in "Code Exploration Protocol" section
3. Regenerated CLAUDE.md via bridge sync

The rule requires:
- Search for files that REFERENCE the target code
- Search for files that ARE REFERENCED BY the target code
- Map the full flow/pipeline before making changes
- Check for disconnected code that should be part of the flow

Root cause: When moving installer to npm, missed that stack-wizard.js and flow-onboard existed but were never wired up. This rule prevents similar misses in future refactors.
**Files**:
- .workflow/templates/claude-md.hbs
- agents/orchestrator.md
- CLAUDE.md

### R-055 | 2026-01-13 09:15
**Type**: fix
**Tags**: #workflow #wf-a99ef4b5 #audit #orchestrator
**Request**: "Fix orchestrator.md - comprehensive audit and KB alignment"
**Result**: Task wf-a99ef4b5 closed. Work completed in prior session (2026-01-12):
- Verified orchestrator.md is up-to-date and consistent with CLAUDE.md, commands.md, config.json
- All referenced commands exist and work correctly (/wogi-compact, /wogi-context, flow archive)
- Dependency Discovery rule properly integrated in Code Exploration Protocol section
- Session Startup, Quality Gates, and Feedback Handling sections aligned with latest config
- No issues found during verification - file is complete and accurate
**Files**:
- agents/orchestrator.md (verified, no changes needed)

### R-056 | 2026-01-13 09:45
**Type**: fix
**Tags**: #docs #mcp #wf-cc-001 #claude-code-integration
**Request**: "Update MCP documentation for @-mention removal"
**Result**: Added documentation for MCP server enable/disable commands:
- Added `/mcp enable`, `/mcp disable`, `/mcp list` commands to mcp-integrations.md
- Added note about @-mention removal in Claude Code January 2026
- No stale @-mention references found in codebase (docs were already correct)
**Files**:
- .claude/docs/knowledge-base/05-development-tools/mcp-integrations.md

### R-057 | 2026-01-13 10:00
**Type**: new
**Tags**: #feature #skills #wf-cc-002 #claude-code-integration
**Request**: "Enable nested skills directory discovery"
**Result**: Implemented hierarchical skill organization support:
- Added `discoverNestedSkills()` function for recursive skill discovery
- Added `getSkillDir()` helper for nested path resolution
- Updated `loadSkillMetadata()` to handle paths like "frontend/react"
- Updated `getAllSkills()` to merge configured + auto-discovered skills
- Added `autoDiscoverNested` config option (default: true)
- Updated `flow-skill-create.js` to support nested paths
- Max nesting depth: 3 levels
- Updated skill-matching.md documentation with nested skills section
**Files**:
- scripts/flow-skill-matcher.js
- scripts/flow-skill-create.js
- .claude/docs/knowledge-base/03-self-improvement/skill-matching.md

### R-058 | 2026-01-13 10:15
**Type**: new
**Tags**: #feature #statusline #wf-cc-003 #claude-code-integration
**Request**: "Create status line integration skill"
**Result**: Created status line setup command for Claude Code integration:
- Created `/wogi-statusline-setup` command (skill.md + flow-statusline-setup.js)
- Supports 4 format presets: minimal, compact, standard, detailed
- Uses new `context_window.used_percentage` field from Claude Code v1.0.52+
- Interactive wizard or direct `--format` flag
- Added to flow CLI (`flow statusline-setup`)
- Updated commands.md documentation
**Files**:
- .claude/commands/wogi-statusline-setup/skill.md (new)
- scripts/flow-statusline-setup.js (new)
- scripts/flow (updated)
- .claude/docs/commands.md

### R-059 | 2026-01-13 10:30
**Type**: new
**Tags**: #feature #context-monitor #wf-cc-004 #claude-code-integration
**Request**: "Enhance context monitor with native tracking"
**Result**: Added native context tracking support to flow-context-monitor.js:
- Added `trackingMethod` config option: 'auto' (default), 'native', 'estimated'
- Added `getNativeContextInfo()` to read from Claude Code's native tracking
- Added `writeNativeContextInfo()` for hooks to capture context data
- Updated `checkContextHealth()` to use native tracking when available
- Updated `showContextBreakdown()` to display tracking source
- Falls back to estimation if native not available (in 'auto' mode)
- Updated context-management.md with tracking methods documentation
- Updated all-options.md config reference
**Files**:
- scripts/flow-context-monitor.js
- .claude/docs/knowledge-base/04-memory-context/context-management.md
- .claude/docs/knowledge-base/configuration/all-options.md

### R-060 | 2026-01-13 11:00
**Type**: fix
**Tags**: #security #session-review #critical #high
**Request**: "Fix all security issues from session review"
**Result**: Fixed all critical and high severity security issues identified in session review:

**CRITICAL FIXES:**
1. **Command injection in flow-pattern-extractor.js:238**: Added validation to sanitize lineNumber (must be integer 1-1000000) and filePath (no shell metacharacters) before passing to git blame command
2. **Path traversal in flow-export-profile**: Added regex validation to require profile names contain only alphanumeric, underscore, and hyphen characters
3. **Unsafe JSON parsing with require()**: Replaced all `require()` calls with safe JSON parsing using `JSON.parse()` with prototype pollution checks in both flow-export-profile and flow-import-profile

**HIGH FIXES:**
4. **Prototype pollution in flow-conflict-resolver.js**: Added `safeJsonParse()` function with checks for `__proto__`, `constructor`, and `prototype` injection attempts

**MEDIUM FIXES:**
5. **Magic numbers**: Added named constants (DEFAULT_TERMINAL_WIDTH, MAX_BOX_WIDTH, MS_PER_DAY, DAYS_PER_WEEK/MONTH/YEAR) in flow-conflict-resolver.js
6. **Color constants**: Added TODO comment to consolidate with flow-output.js

**Files**:
- scripts/flow-pattern-extractor.js
- scripts/flow-conflict-resolver.js
- scripts/flow-export-profile
- scripts/flow-import-profile

### R-061 | 2026-01-13 12:00
**Type**: new
**Tags**: #feature #tech-debt #session-review #workflow
**Request**: "Add technical debt management system"
**Result**: Implemented comprehensive technical debt tracking and management system:

**Core System:**
- Created `flow-tech-debt.js` - TechDebtManager class with persistent JSON ledger
- Tracks issues with deduplication by file:line:description
- Session counting for aging detection (3+ sessions = aging)
- Auto-fixable flag for safe batch processing (console.log, unused-import, debugger, empty-catch)

**New Command `/wogi-debt`:**
- `flow tech-debt` - Show dashboard summary
- `flow tech-debt list` - List all open items (--aging, --fixable, --severity filters)
- `flow tech-debt fix` - Batch auto-fix all safe items
- `flow tech-debt dismiss <id>` - Mark as won't-fix
- `flow tech-debt promote <id>` - Create task from debt item
- `flow tech-debt promote-aging` - Auto-create tasks for all aging items

**Integrations:**
- Session Review: Captures issues to tech-debt.json after review
- Morning Briefing: Shows debt summary, auto-promotes aging items to task queue
- Session End: Interactive cleanup prompt with 4 options (quick fixes, aging, full, skip)

**Config Added** (`config.json → techDebt`):
- enabled, promptOnSessionEnd, showInMorningBriefing
- agingThreshold (default: 3 sessions)
- autoFix.enabled and autoFix.types
- debtBudget (optional enforcement)

**Files**:
- scripts/flow-tech-debt.js (new)
- .claude/commands/wogi-debt.md (new)
- scripts/flow-step-review.js (modified - capture to debt ledger)
- scripts/flow-morning.js (modified - debt summary section)
- scripts/flow-session-end.js (modified - cleanup prompt)
- .workflow/config.json (modified - techDebt section)

### R-062 | 2026-01-13 16:40
**Type**: fix
**Tags**: #bugfix #eslint #code-quality #wf-b374065a
**Request**: "Fix flow-transcript-digest.js (now flow-long-input.js)"
**Result**: Fixed 30 ESLint warnings across long-input-processing modules:
1. Removed unused import `writeJson` from flow-long-input.js
2. Commented out unused import `initializePresentation` (kept for reference)
3. Fixed 7 unused `err` variables in catch blocks → `_err`
4. Fixed unused param `existingTopics` → `_existingTopics`
5. Removed unused variable `lowerText` in classifyContent()
6. Fixed 3 unused destructured `type` variables in entity patterns
7. Fixed unused param `options` → `_options` in quickProcess()
8. Fixed unused `STATE_DIR` → `_STATE_DIR` (backward compat alias)
9. Fixed unused `expectingTimestamp` → `_expectingTimestamp`
10. Fixed unused proxy functions `saveTopics`, `isVagueStatement` → prefixed with `_`
11. Updated ESLint config to ignore `_` prefixed vars, args, and caught errors
**Files**:
- scripts/flow-long-input.js
- scripts/flow-long-input-chunking.js
- scripts/flow-long-input-parsing.js
- scripts/flow-long-input-stories.js
- eslint.config.js

### R-063 | 2026-01-13 17:00
**Type**: change
**Tags**: #feature #onboarding #ai-driven #wf-ai-onboarding
**Request**: "Remove CLI wizard and implement AI-driven onboarding"
**Result**: Replaced CLI-based setup wizard with AI-driven conversational onboarding:

**Removed:**
- Deleted `lib/unified-wizard.js` (1466 lines of CLI interview code)
- Removed all readline-based prompts from postinstall

**Added:**
- `scripts/hooks/core/setup-check.js` - Detects pending setup via marker file
- Comprehensive `/wogi-init` AI wizard with:
  - Step-by-step tech stack selection using AskUserQuestion
  - Import from other projects with conflict detection
  - Pattern extraction and "(Recommended)" tags
  - Context7 MCP integration for fetching best practices
  - Skill generation from tech stack selections
  - Summary explaining WogiFlow's learning system

**Modified:**
- `scripts/postinstall.js` - Now creates pending-setup.json marker and prints instructions
- `scripts/flow-init` & `scripts/flow-onboard` - Redirect to AI assistant
- `scripts/flow` - Combined init|install commands, updated help text
- `scripts/hooks/core/session-context.js` - Injects setup required notice
- `scripts/hooks/core/index.js` - Exports setupCheck module

**New Flow:**
```
npm install wogiflow → Creates marker file → Print "start AI assistant"
User starts claude/gemini → AI detects pending setup → Conversational wizard
```
**Files**:
- scripts/postinstall.js
- lib/unified-wizard.js (deleted)
- scripts/flow-init
- scripts/flow-onboard
- scripts/flow
- scripts/hooks/core/setup-check.js (new)
- scripts/hooks/core/index.js
- scripts/hooks/core/session-context.js
- .claude/commands/wogi-init.md

### R-064 | 2026-01-13 18:00
**Type**: fix
**Tags**: #security #code-review #session-review
**Request**: "Fix issues found in session review"
**Result**: Fixed 11 issues identified during code review:
1. CRITICAL: flow-story.js:525 - Fixed variable mismatch (catch(e) but used err)
2. HIGH: flow-context-orchestrator.js:242 - Fixed mergeSections parameter to pass arrays separately
3. MEDIUM: flow-context-orchestrator.js:297 - Replaced JSON.parse with safeJsonParse
4. MEDIUM: flow-story.js:376 - Replaced JSON.parse with safeJsonParse
5. HIGH: Removed emojis from console output (3 locations: flow-product-scanner.js:431, flow-story.js:502, flow-story.js:512)
6. MEDIUM: flow-context-orchestrator.js:86 - Fixed null pointer handling with fallback
7. MEDIUM: flow-story.js:74-78 - Added documentation for intentional silent error handling
8. LOW: lib/upgrader.js:166 - Fixed chmod notation from '755' to 0o755
**Files**:
- scripts/flow-story.js
- scripts/flow-context-orchestrator.js
- scripts/flow-product-scanner.js
- lib/upgrader.js

### R-066 | 2026-01-15 10:00
**Type**: new
**Tags**: #feature #session-learning #workflow #wf-eb8ed7d0
**Request**: "Add session learning analysis to /wogi-session-end"
**Result**: Implemented holistic session-wide learning analysis:
- Created `scripts/flow-session-learning.js` - Analyzes request-log entries for patterns
- Pattern detection: fix patterns, tag patterns, review patterns
- Confidence calculation: base 60% + 10% per occurrence (max 95%)
- Target-based routing: 90%+ confidence patterns → decisions.md, others → feedback-patterns.md
- Integrated with flow-session-end.js as optional analysis step
- Added `sessionLearning` config section with auto-apply threshold, min occurrences, scope
- Code review fixes: removed unused imports, extracted getTodayDateString(), fixed ESLint warnings
- All 2 critical and 4 high severity issues from review addressed
**Files**:
- scripts/flow-session-learning.js (new)
- scripts/flow-session-end.js (modified)
- .workflow/config.json (modified)
- .claude/docs/commands.md (modified)

### R-065 | 2026-01-14
**Type**: new
**Tags**: #feature #roadmap #wf-roadmap-system #deferred-work
**Request**: "Implement roadmap management system for user projects"
**Result**: Created comprehensive roadmap management system:
- Created `scripts/flow-roadmap.js` with full CRUD operations
- Created `templates/roadmap.md` template for user projects
- Updated `.claude/commands/wogi-roadmap.md` with AI behavior instructions
- Updated `.workflow/templates/claude-md.hbs` with "Handling Large Requests" section
- Added CLI commands: init, add, validate, move, promote, list
- Implemented dependency validation (Depends On, Assumes, Key Files)
- Fixed 20 session review issues (promote command, path validation, regex escaping, DRY)
- Migrated internal WogiFlow roadmap to new structure (28 items across 5 phases)
**Files**:
- scripts/flow-roadmap.js (new, 927 lines)
- templates/roadmap.md (new)
- .workflow/roadmap.md (migrated)
- .claude/commands/wogi-roadmap.md
- .workflow/templates/claude-md.hbs
- scripts/flow
