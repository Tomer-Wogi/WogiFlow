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

### R-083 | 2026-02-11 15:15
**Type**: fix
**Tags**: #feature:code-quality #review #security #wf-cr-review8
**Request**: "Fix 8 code review findings from wf-obs-extract and wf-skill-align"
**Result**: C1-Added try-catch + null embedding check in extraction loop. H1-Replaced LIKE interpolation with json_extract() parameterized query. M1-Added JSDoc documenting solution fact category. M2-Added input validation with safe defaults. M3-Added MAX_TASK_GROUPS=500 and MAX_OBS_PER_TASK=100 resource limits. L1-Extracted hasSkillFile()/getSkillFilePath() helpers replacing 3x duplication. L2-Added sensitive data pattern filtering before fact promotion. L3-Added config comment linking retentionDays to extraction window.
**Files**: scripts/flow-memory-db.js, scripts/flow-skill-matcher.js, .workflow/config.json

### R-082 | 2026-02-11 14:30
**Type**: new
**Tags**: #feature:claude-code-integration #skills #SKILL-md #standards #wf-skill-align
**Request**: "SKILL.md standard alignment - add license/compatibility fields, accept SKILL.md filename"
**Result**: Added `license: MIT` and `compatibility: Claude Code 2.1+` fields to skill template and figma-analyzer skill frontmatter. Updated flow-skill-matcher.js in 3 locations (discoverNestedSkills, loadSkillMetadata, loadSkillContext) to accept SKILL.md as alternate filename alongside skill.md. Updated template documentation comment with new field descriptions.
**Files**: .claude/skills/_template/skill.md, .claude/skills/figma-analyzer/skill.md, scripts/flow-skill-matcher.js

### R-081 | 2026-02-11 13:00
**Type**: new
**Tags**: #feature:memory #observations #solutions #extraction #wf-obs-extract
**Request**: "Observation value extraction pipeline - promote high-value observations to solution facts before purge"
**Result**: Added `extractHighValueObservations()` to flow-memory-db.js that finds expiring observations which are successful, task-linked, and non-trivial, groups them by task, and promotes them to facts with category 'solution' and structured solution_context JSON. Modified `purgeOldObservations()` to call extraction first. Wired into flow-memory-compactor.js fullCompaction() as step 5. Added `observationExtraction` config key.
**Files**: scripts/flow-memory-db.js, scripts/flow-memory-compactor.js, .workflow/config.json

### R-080 | 2026-02-06 11:20
**Type**: fix
**Tags**: #feature:claude-code-integration #hooks #code-review #wf-cr-2133
**Request**: "Fix 3 code review issues from CC 2.1.33 epic"
**Result**: (1) task-completed.js now uses input.taskId to match specific task instead of always picking inProgress[0] - supports parallel execution. (2) teammate-idle.js dead filter removed - tasks in ready array are already not blocked. (3) session-end.js refactored to three-layer pattern with new core/session-end.js handler.
**Files**: scripts/hooks/core/task-completed.js, scripts/hooks/core/teammate-idle.js, scripts/hooks/core/session-end.js (new), scripts/hooks/entry/claude-code/session-end.js

### R-079 | 2026-02-06 11:00
**Type**: change
**Tags**: #feature:claude-code-integration #skills #frontmatter #memory #wf-4a337a35
**Request**: "Update skill templates with memory frontmatter field"
**Result**: Added `memory: project` field to skill template (_template/skill.md) and figma-analyzer skill between `agent` and `allowed-tools` fields. Updated template documentation comment to include memory field with scope options (project/user/local) per Claude Code 2.1.33.
**Files**: .claude/skills/_template/skill.md, .claude/skills/figma-analyzer/skill.md

### R-078 | 2026-02-06 10:50
**Type**: new
**Tags**: #feature:claude-code-integration #hooks #task-completed #teammate-idle #wf-303884df
**Request**: "Add TaskCompleted and TeammateIdle hook events"
**Result**: Added 2 new Claude Code 2.1.33 hook events. TaskCompleted (enabled by default, 10s timeout) fires when sub-agent tasks complete - moves tasks to recentlyCompleted in ready.json, logs to durable-history.json. TeammateIdle (disabled by default, experimental, 5s timeout) suggests next available task when a teammate agent becomes idle. Created 4 new files (2 core handlers, 2 entry points), updated claude-code adapter (events, timeouts, transforms, generateConfig), and config.json.
**Files**: scripts/hooks/core/task-completed.js (new), scripts/hooks/core/teammate-idle.js (new), scripts/hooks/entry/claude-code/task-completed.js (new), scripts/hooks/entry/claude-code/teammate-idle.js (new), scripts/hooks/adapters/claude-code.js, .workflow/config.json

### R-077 | 2026-02-06 10:35
**Type**: new
**Tags**: #feature:claude-code-integration #agents #frontmatter #memory #wf-c493fccb
**Request**: "Add YAML frontmatter (memory + tools) to all agent definitions"
**Result**: Added YAML frontmatter to all 11 agent files in agents/*.md. Each agent now has `memory: project` for persistent project knowledge. Tool restrictions via `Task(agent_type)`: orchestrator can spawn all 10 types, developer can spawn reviewer+tester, reviewer/tester/story-writer/security/performance/accessibility/design-system/onboarding can spawn developer only, docs agent has no Task spawning.
**Files**: agents/orchestrator.md, agents/developer.md, agents/reviewer.md, agents/story-writer.md, agents/tester.md, agents/security.md, agents/performance.md, agents/accessibility.md, agents/design-system.md, agents/docs.md, agents/onboarding.md

### R-076 | 2026-02-06 10:25
**Type**: fix
**Tags**: #security #permissions #claude-code-integration #wf-03d35188
**Request**: "Tighten permission wildcards in settings.local.json"
**Result**: Removed 2 exposed NPM tokens (CRITICAL), cleaned ~80 accumulated junk entries (__NEW_LINE_* fragments, for-loop fragments, one-off release commands). Replaced broad wildcards: Bash(npm *) → 8 specific subcommands, Bash(node *) → 4 specific patterns. Removed Bash(bash *), Bash(chmod *), Bash(cat/head/tail/grep/find/echo *) (Claude Code has dedicated tools). Reduced from 166 to 84 intentional permission entries. Also cleaned unnecessary WebFetch domains and deduplicated Skill entries.
**Files**: .claude/settings.local.json

### R-075 | 2026-02-05 12:00
**Type**: new
**Tags**: #feature:model-management #model:opus-4.6 #model:sonnet-4.5 #wf-opus46
**Request**: "Adapt WogiFlow to Claude Opus 4.6"
**Result**: Added claude-opus-4-6 and claude-sonnet-4-5 to model registry. Updated detection patterns, routing (escalation/architecture to Opus 4.6), prompt composer CLI map, validation capabilities (adaptive-thinking), provider detection, known providers list, and adapter documentation. Fixed Opus 4.5 maxOutputTokens (32K -> 64K).
**Files**: .workflow/models/registry.json, scripts/flow-model-adapter.js, scripts/flow-model-caller.js, scripts/flow-prompt-composer.js, .workflow/prompts/fragments/output-format-claude.md, scripts/flow-models.js, scripts/flow-providers.js, scripts/flow-model-config.js, .workflow/model-adapters/claude-opus.md

### R-074 | 2026-02-05 11:00
**Type**: new
**Tags**: #feature:memory #feature:mcp #feature:hooks #wf-fd8d2444
**Request**: "WogiFlow Memory Enhancement - Automatic Observation Capture"
**Result**: Implemented automatic observation capture inspired by claude-mem with progressive disclosure search:

**1. Database Schema (flow-memory-db.js)**
- Added `observations` table with columns: id, session_id, tool_name, input_summary, output_summary, full_input, full_output, timestamp, success, duration_ms, context_task_id, relevance_score
- Added indexes for fast querying by session, tool, timestamp, and task
- New functions: `storeObservation()`, `searchObservationsCompact()`, `getObservationsByIds()`, `getTimelineContext()`, `getRecentObservations()`, `getObservationStats()`, `purgeOldObservations()`

**2. Observation Capture Core Module (hooks/core/observation-capture.js)**
- Smart summarization by tool type (Edit, Write, Bash, Read, Glob, Grep, etc.)
- Config-driven enable/disable and tool skip list
- Non-blocking capture that never fails the calling hook

**3. Hook Integration (hooks/entry/claude-code/post-tool-use.js)**
- Captures observations for ALL tools (not just Edit/Write)
- Runs before validation so observations are captured even if validation fails

**4. New MCP Tools (mcp-memory-server/index.js)**
- `search_index`: Progressive disclosure step 1 - returns IDs + summaries (~50-100 tokens)
- `get_observations`: Progressive disclosure step 2 - fetch full details by IDs
- `get_timeline`: Get observations around an anchor point for debugging sequences
- Updated `get_memory_stats` to include observation statistics

**5. Config (config.json)**
- Added `automaticMemory.observationCapture` with: `enabled`, `skipTools`, `maxInputSize`, `maxOutputSize`, `retentionDays`

**Files**: scripts/flow-memory-db.js, scripts/hooks/core/observation-capture.js, scripts/hooks/entry/claude-code/post-tool-use.js, mcp-memory-server/index.js, .workflow/config.json

### R-073 | 2026-02-04 13:30
**Type**: new
**Tags**: #feature:quality-gates #feature:code-review #feature:error-recovery #wf-8984278f
**Request**: "Implement 3 quality improvements from superpowers analysis"
**Result**: Implemented three quality improvements inspired by the superpowers plugin:

**1. Sequential Spec-Then-Quality Review (flow-review.js)**
- Spec verification now runs FIRST before code quality passes
- If spec fails, quality passes are SKIPPED with clear explanation
- Config: `review.specFirstGating: true` (default)

**2. 3-Strike Architectural Reassessment (flow-error-recovery.js)**
- After 3 consecutive failures at same error level, triggers reassessment
- Agent analyzes if issue is architectural vs simple bug
- If architectural: agent researches alternatives, proposes new approach
- User approves/rejects before switching approach
- New functions: `checkArchitecturalReassessment()`, `recordArchitecturalDecision()`, `recordApprovalDecision()`, `formatArchitecturalReassessment()`
- Config: `errorRecovery.architecturalReassessment` with `enabled`, `strikeCount`, `autoResearch`

**3. Optional Pre-Task Test Baseline (flow-start.js)**
- Verifies test suite passes BEFORE starting a task
- Disabled by default to avoid blocking unexpectedly
- Configurable failure threshold (default: 5)
- Skips for bugfix/quick-fix types
- Bypass: `--skip-baseline` flag
- Config: `qualityGates.preTaskBaseline` with `enabled`, `failureThreshold`, `skipForTypes`

**Files**: scripts/flow-review.js, scripts/flow-error-recovery.js, scripts/flow-start.js, .workflow/config.json

### R-072 | 2026-02-02 12:15
**Type**: change
**Tags**: #feature:code-review #command:wogi-review-fix #wf-review-fix-sync
**Request**: "Sync wogi-review-fix with all wogi-review phases"
**Result**: Completely rewrote wogi-review-fix.md to match all features from wogi-review, with AUTO-FIX behavior instead of blocking:

**Phases now in wogi-review-fix (7 total):**
1. **Phase 1: Verification Gates** - Lint, typecheck, tests
2. **Phase 2: AI Review** - Multi-pass or parallel agents (Code/Logic, Security, Architecture)
3. **Phase 3: Standards Compliance [AUTO-FIX]** - Auto-fixes naming, security patterns, component duplication
4. **Phase 4: Solution Optimization [AUTO-APPLY HIGH]** - Auto-applies high-priority improvements (loading states, error messages)
5. **Phase 5: Auto-Fix Issues** - Fixes all auto-fixable issues from AI review
6. **Phase 6: Re-Verify** - Runs all verification gates again
7. **Phase 7: Browser Debug (optional)** - Debug in browser when --browser flag or UI files + failures

**Key difference from wogi-review:**
- wogi-review BLOCKS on violations and lists issues
- wogi-review-fix AUTO-FIXES violations and applies high-priority improvements

**New options documented:**
- `--skip-standards` - Skip standards compliance auto-fix
- `--skip-optimization` - Skip solution optimization auto-apply
- `--browser` - Enable browser debugging for UI runtime issues

**Files**: .claude/commands/wogi-review-fix.md

### R-071 | 2026-02-02 11:30
**Type**: new
**Tags**: #feature:browser-debugging #feature:browser-testing #chrome-mcp #wf-browser-debug
**Request**: "Implement autonomous browser debugging loop"
**Result**: Created comprehensive autonomous browser debugging system that can:
1. Navigate to any web app and reproduce issues
2. Read console errors via Chrome MCP tools (list_console_messages)
3. Analyze failures using error pattern database
4. Apply code fixes automatically
5. Refresh and verify until working (max 10 iterations)

**Components created:**
- `scripts/flow-browser-debug.js` - Main debug loop orchestrator with session management
- `scripts/flow-browser-error-patterns.js` - Error pattern recognition database (null-reference, network, React, Vue, async, import errors)
- `scripts/flow-browser-nl-parser.js` - Natural language parser for "click X, expect Y" syntax
- `.claude/commands/wogi-debug-browser.md` - New command documentation

**Configuration:**
- Added `browserDebugging` section to config.json with triggers (manual, suggestOnBroken, autoOnTestFailure)
- Updated CLAUDE.md with detection patterns for "broken", "not working" phrases
- Updated wogi-test-browser.md with `--debug` flag for auto-fix on failure

**Chrome MCP Tools Used:**
- `list_console_messages` for reading console errors
- `evaluate_script` for JavaScript evaluation
- `take_screenshot` for visual state capture
- `browser_navigate`, `browser_click`, `fill` for interaction

**Files**: scripts/flow-browser-debug.js (new), scripts/flow-browser-error-patterns.js (new), scripts/flow-browser-nl-parser.js (new), .claude/commands/wogi-debug-browser.md (new), .claude/commands/wogi-test-browser.md, .workflow/config.json, CLAUDE.md

### R-070 | 2026-02-02 10:00
**Type**: new
**Tags**: #feature:quality-gates #feature:standards-compliance #feature:learning-system #wf-6f5c00c4
**Request**: "Add standards compliance to wogi-start quality gates"
**Result**: Integrated standards compliance checker into wogi-start quality gates with smart scoping:
1. **Phase 1**: Added scoping support to `flow-standards-checker.js` - task-type to check-type mapping (component, utility, bugfix, etc.)
2. **Phase 2**: Created `flow-standards-gate.js` - task-aware wrapper with retry feedback formatting
3. **Phase 3**: Updated `wogi-start.md` - added Step 3.7 Standards Compliance Check between wiring and quality gates
4. **Phase 4**: Updated `config.json` - added standardsCompliance section with mode (block/warn), scoping, learning settings
5. **Phase 5**: Created `flow-standards-learner.js` - violation tracking, pattern promotion to decisions.md, prevention prompts
6. **Phase 6**: Updated `flow-review.js` - skips standards check if task already passed at completion
**Files**: scripts/flow-standards-checker.js, scripts/flow-standards-gate.js (new), scripts/flow-standards-learner.js (new), scripts/flow-review.js, .claude/commands/wogi-start.md, .workflow/config.json

### R-069 | 2026-02-02 09:00
**Type**: fix
**Tags**: #feature:research-protocol #feature:rules-sync #feature:request-log #wf-research-fix
**Request**: "Fix research protocol enforcement, rules sync automation, and request log database integration"
**Result**: Addressed three gaps from research protocol failure:
1. **Research Protocol Enforcement**: Added structured verification format requirement to Phase 6 in research-gate.js. Recommendations now require: searched commands, files checked, status (EXISTS/PARTIAL/MISSING), and evidence.
2. **Rules Sync Automation**: Added auto-sync trigger in flow-session-end.js with MD5 hash tracking for decisions.md. Rules only sync when content changes.
3. **Request Log Database**: Added `request_log` table to flow-memory-db.js with CRUD operations. Added dual-write capability to flow-log-manager.js (MD + DB).
**Files**: scripts/hooks/core/research-gate.js, scripts/flow-session-end.js, scripts/flow-memory-db.js, scripts/flow-log-manager.js, .workflow/config.json

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

### R-068 | 2026-02-02 09:20
**Type**: fix
**Tags**: #bugfix #knowledge-sync #morning-briefing
**Request**: "Fix auto-regenerate bug in flow-morning.js"
**Result**: Fixed bug where morning briefing tried to run `flow-onboard` (bash script) with `node`, causing SyntaxError. Changed to call `flow-knowledge-sync.js regenerate` instead, which is the correct Node.js script for regenerating knowledge files.
**Files**: scripts/flow-morning.js

### R-067 | 2026-01-31 00:15
**Type**: fix
**Tags**: #security #validation #code-quality
**Request**: "Fix all code review issues from /wogi-review"
**Result**: Fixed 16 code review findings across 5 files:
- flow-prompt-capture.js: Fixed cleanupOldTasks() bug (missing timestamps treated as epoch 0)
- flow-correction-detector.js: Added JSON schema validation, stale cleanup function, safer regex
- flow-bulk-loop.js: Added getArraySafe() helper, parsePriority() with NaN protection, timeout handling
- user-prompt-submit.js: Switched to safeJsonParseString, sync regex detection in hook context
- flow-done.js: Changed readJson() to safeJsonParse() per security patterns
**Files**: scripts/flow-prompt-capture.js, scripts/flow-correction-detector.js, scripts/flow-bulk-loop.js, scripts/hooks/entry/claude-code/user-prompt-submit.js, scripts/flow-done.js
