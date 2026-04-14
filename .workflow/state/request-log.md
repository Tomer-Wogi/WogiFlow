# Request Log

Automatic log of all requests that changed files. Searchable by tags.

**Search examples:**
```bash
grep -A5 "#screen:login" .workflow/state/request-log.md
grep -A5 "#component:Button" .workflow/state/request-log.md
grep -A5 "Type: fix" .workflow/state/request-log.md
```

---

### R-275 | 2026-04-14
**Type**: refactor
**Tags**: #component:wogi-start #component:pre-tool-use #component:phase-read-gate
**Task**: wf-4375a420
**Request**: "Split wogi-start into phase-loaded router with hook enforcement"
**Result**: Split 16,500-token wogi-start.md into ~3,400-token router + 5 phase files loaded on-demand. Created phase-read-gate.js that blocks Edit/Write/Bash until the phase instruction file is read. Wired into PreToolUse hook. Updated continuation prompt and CLAUDE.md template.
**Files**: .claude/commands/wogi-start.md, .claude/commands/wogi-start-continuation.md, .claude/docs/phases/01-explore.md, .claude/docs/phases/02-spec.md, .claude/docs/phases/03-implement.md, .claude/docs/phases/04-verify.md, .claude/docs/phases/05-complete.md, scripts/hooks/core/phase-read-gate.js, scripts/hooks/entry/claude-code/pre-tool-use.js, .workflow/templates/partials/auto-features.hbs, CLAUDE.md

### R-274 | 2026-04-11
**Type**: new
**Tags**: #workspace #manager #enforcement #role-boundary
**Task**: wf-e7bc0176
**Request**: "Manager role boundary gate — mechanical enforcement"
**Result**: Created manager-boundary-gate.js — a PreToolUse gate that mechanically enforces the manager's role boundaries in workspace mode. Uses allowlist approach: only explicitly whitelisted read operations are permitted in member repos. Edit/Write on member files → blocked (100% reliable, path-based). Read/Glob/Grep → allowed for .workflow/state/, blocked for source code. Bash → if command contains member repo path, must match read-only allowlist (cat .workflow/, git log/status/diff, curl); everything else blocked. Integrated into pre-tool-use.js alongside other enforcement gates. Handles macOS symlinks (/tmp → /private/tmp). Denial messages redirect to dispatch pattern. 14/14 test cases passing.
**Files**: scripts/hooks/core/manager-boundary-gate.js (new), scripts/hooks/entry/claude-code/pre-tool-use.js

### R-273 | 2026-04-11
**Type**: fix
**Tags**: #security #code-quality #review-findings
**Task**: wf-1f7dc11e
**Request**: "Fix 7 review findings from session review"
**Result**: Fixed all 7 findings: (1) postinstall.js rewriteHookPaths simplified from fragile regex open/close quoting to clean extract-join-wrap pattern. (2) flow-mcp-capabilities.js CLI cache command now validates input with prototype pollution protection + length limits (name: 120, description: 200 chars). (3) task-completed.js validates WOGI_WORKSPACE_ROOT with isAbsolute + existsSync before using as write path. (4) workspace.js documented message format updated to include verified, evidenceTier, timestamp fields + trust model explanation. (5) flow-mcp-capabilities.js discovery function has documented intentional divergence from plugin-registry. (6) Cache sanitization enforces length limits and strips backticks from descriptions. (7) changedFiles in workspace messages limited to 20 files, 200 char paths, newlines stripped.
**Files**: scripts/postinstall.js, scripts/flow-mcp-capabilities.js, scripts/hooks/core/task-completed.js, lib/workspace.js

### R-272 | 2026-04-11
**Type**: fix
**Tags**: #workspace #monorepo #hooks #quality-enforcement #worker-protocol
**Task**: wf-ad948a4b
**Request**: "Workspace failure prevention: monorepo hooks, worker protocols, quality enforcement"
**Result**: Four fixes from real workspace failure analysis: (1) Monorepo hook path fix — rewriteHookPaths() now uses absolute quoted paths via PACKAGE_ROOT instead of relative node_modules/ paths, fixing MODULE_NOT_FOUND in monorepo setups where npm hoists packages. (2) Worker-rules restructuring — escalation section restructured with Step 1-2-3 protocol (check .workspace/state/ → ask peers → only then escalate). Peer-first section expanded to include resource requests (credentials, test accounts). (3) Stop-don't-degrade rule — autonomous mode now explicitly forbids marking tasks done without required verification evidence. Workers must report BLOCKED, not DONE, when verification is impossible. (4) Structured task-complete workspace message — task-completed hook now writes verified JSON completion messages to .workspace/messages/ when in workspace mode, fulfilling the promised "automatic return path."
**Files**: scripts/postinstall.js, lib/workspace.js, scripts/hooks/core/task-completed.js

### R-271 | 2026-04-11
**Type**: new
**Tags**: #mcp #sub-agents #orchestration #explore-phase
**Task**: wf-1b508dba
**Request**: "MCP capability discovery system for sub-agents"
**Result**: Created flow-mcp-capabilities.js — a discovery/classification/caching system that enables sub-agents to leverage available MCP tools. Capability categories are generic (documentation-lookup, browser-interaction, design-files, etc.) and matched by tool signatures, not hardcoded server names. Role-to-capability mapping ensures each agent role only sees relevant tools. The AI orchestrator classifies tools at first use (only it can inspect the tool catalog), caches results for the session, and generates role-specific prompt fragments. Integrated into explore-agents.md as a pre-launch step. Added mcpCapabilities config section. Source: CC 2.1.101 sub-agent MCP inheritance fix.
**Files**: scripts/flow-mcp-capabilities.js (new), .claude/docs/explore-agents.md, .workflow/config.json

### R-270 | 2026-04-10
**Type**: new
**Tags**: #verification #hypothesis #bug-investigation #enforcement
**Task**: wf-b3b54c62
**Request**: "Hypothesis verification gate — block premature 'fixed' claims"
**Result**: Added Phase 2.5 (Hypothesis Verification Gate) to wogi-bug.md between Phase 2 (investigation) and Phase 3 (populate report). Gate mandates hypothesis → verify → confirm → THEN communicate pattern. Blocked phrases ("fixed", "should work", "go refresh") are gated behind verification evidence. Strengthened Bug-Specific Execution section with anti-premature-confidence rule and re-verification requirement. Added config.enforcement.hypothesisGate toggle to flow-config-defaults.js (enabled by default). Added recordHypothesisVerification() and isHypothesisVerified() functions to flow-hypothesis-generator.js for tracking verification state. Source: Wogi Hub manager retrospective mistakes #2, #3 (~35K tokens wasted on premature "fixed" claims).
**Files**: .claude/commands/wogi-bug.md, scripts/flow-config-defaults.js, scripts/flow-hypothesis-generator.js

### R-269 | 2026-04-10
**Type**: new
**Tags**: #epic #retrospective #verification-gates #workspace #token-efficiency
**Request**: "Create implementation tasks for 8 WogiFlow improvements from Wogi Hub retrospectives"
**Result**: Created epic-retro-improvements with 8 stories in ready.json. Priorities: P0 — hypothesis verification gate (wf-b3b54c62), blast-radius for all L1+ (wf-ddf13cf4), scope-confidence gate (wf-6fd43d0f). P1 — decision-authority framework (wf-b35f14e8), skill prompt compression (wf-c65b2ef5), cross-repo enum verification (wf-b3d01071), dispatch verification (wf-60b96ed4). P2 — constructor-mock drift detection (wf-f3f84c4d). Total: 34 acceptance criteria across 8 stories derived from 3 retrospective documents (manager, backend worker, frontend worker) covering a 30-hour Wogi Hub session.
**Files**: .workflow/state/ready.json, .workflow/state/request-log.md

### R-268 | 2026-04-10
**Type**: fix
**Tags**: #statusline #docs #review-fix #cli-parsing
**Task**: wf-426b6e05
**Request**: "Fix 5 review findings in statusline setup"
**Result**: Fixed 5 review findings: (1) Updated Detailed format example in wogi-statusline-setup.md to match actual output — now shows `[WT]` indicator, `task.title`, and `% used` instead of stale `Ctx: 45% (85k remaining)`. (2) Aligned "Full Context" recommended format to match actual `detailed` preset including worktree conditional, task conditional, and task.title. (3) Removed implicit reference to non-existent `remaining_tokens` variable (was in the example from finding 1). (4) Added missing-value and flag-eating detection for `--refresh-interval` CLI arg — now errors early if followed by another flag or missing entirely. (5) Success message for `--format` now mentions preserved refreshInterval when one exists.
**Files**: .claude/commands/wogi-statusline-setup.md, scripts/flow-statusline-setup.js

### R-267 | 2026-04-09
**Type**: feature
**Tags**: #claude-code #statusline #compatibility #refreshInterval #2.1.97
**Task**: wf-d0c2ea2b
**Request**: "Update claude-code-compatibility.md for 2.1.97 and add refreshInterval support to flow-statusline-setup.js"
**Result**: Added refreshInterval support to flow-statusline-setup.js: new `--refresh-interval N` CLI flag (standalone or combined with --format), interactive setup prompt (default 5s), parseRefreshInterval validator (0–3600), buildStatusLine helper that preserves existing fields so --format no longer wipes refresh interval (and vice versa), refresh status displayed in --show, updated --help with new flag and examples, detailed preset now uses `workspace.git_worktree` indicator. Added 2.1.97 section to claude-code-compatibility.md documenting 21 changes with WogiFlow impact analysis: Stop hook long-session fix (CRITICAL — routing enforcement was degrading), subagent worktree cwd leak fix (HIGH — parallel execution bug), refreshInterval adoption, workspace.git_worktree variable, compaction transcript dedup, MCP HTTP/SSE 50MB/hr leak fix, 429 backoff, rate-limit upgrade options, YAML boolean slash command fix, additionalDirectories mid-session, permission rules proto names, Bash hardening, focus view, running indicator, image compression alignment, transcript size improvements, per-block token accuracy, OTEL TRACEPARENT, context-low transient warning, Bedrock SigV4, MCP OAuth ADFS. Added version row `2.9.2+ | 2.1.97+` to compatibility table. Updated wogi-statusline-setup.md with refreshInterval docs and workspace.git_worktree vs worktree.* distinction. Last-updated bumped to 2026-04-09.
**Files**: scripts/flow-statusline-setup.js, .claude/docs/claude-code-compatibility.md, .claude/commands/wogi-statusline-setup.md

### R-266 | 2026-03-25
**Type**: refactor
**Tags**: #consistency #paths #audit
**Task**: wf-9175e882
**Request**: "Migrate 90 files from manual path.join to PATHS constants"
**Result**: Migrated 121 files from manual path.join('.workflow'...) constructions to PATHS constants. Added 22 new PATHS entries to flow-paths.js (verifications, logs, bridges, evals, reviews, etc.). Replaced WORKFLOW_DIR/STATE_DIR/PROJECT_ROOT with PATHS.workflow/PATHS.state/PATHS.root. Simplified path.join(PATHS.workflow, 'X') to PATHS.X where constants exist. Net -57 lines. All 121 files pass syntax check. Preserved parameter-based projectRoot patterns (worktrees, hooks) and excluded npm lifecycle files.
**Files**: scripts/flow-paths.js + 120 other files (see git diff --stat)

### R-265 | 2026-03-25
**Type**: fix
**Tags**: #security #review-findings #enforcement #null-safety
**Task**: wf-b8d8d13c
**Request**: "Fix 14 review findings from session commits"
**Result**: Fixed 2 critical enforcement bypass (raw JSON.parse → safeJsonParseString + truthiness → strict === false), fixed phaseGate config path mismatch (hooks.rules.intelligence → hooks.rules), added config.json mtime staleness check, fixed hooks removal regression (null default), added null guards in flow-long-input.js (6 locations) and flow-run-trace.js (2 locations), PID-scoped tmp files, deep-merge for nested keys, dedup at push, DRY extraction of buildEnforcementFromConfig. 18/18 tests pass, hook latency 3.2ms.
**Files**: scripts/flow-hook-status.js, scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/flow-hooks.js, scripts/flow-long-input.js, scripts/flow-run-trace.js, scripts/flow-task-checkpoint.js

### R-264 | 2026-03-25
**Type**: refactor
**Tags**: #performance #hooks #hot-path
**Task**: wf-7e82ca13
**Request**: "Aggregate hook state into single pre-computed status file"
**Result**: Created flow-hook-status.js aggregating all hook state into single file. Pre-tool-use.js now reads 1 file instead of 6-8 per tool call. Fast-path (all gates disabled): 1.9ms. Full path: 3.0ms. Both under 5ms target. Made captureCurrentPrompt() fire-and-forget, debounced trackChangedFile() with setImmediate batching.
**Files**: scripts/flow-hook-status.js (new), scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/flow-start.js, scripts/hooks/core/task-completed.js, scripts/hooks/core/phase-gate.js, scripts/hooks/core/routing-gate.js, scripts/flow-task-checkpoint.js, scripts/hooks/entry/claude-code/user-prompt-submit.js

### R-263 | 2026-03-25
**Type**: refactor
**Tags**: #security #json-parse #prototype-pollution
**Task**: wf-154d4643
**Request**: "Migrate raw JSON.parse to safeJsonParse across scripts/"
**Result**: Migrated 22 raw JSON.parse calls across 16 files to safeJsonParse/safeJsonParseString. Fixed 3 P0 crash-risk locations (no try/catch). Removed redundant manual prototype pollution checks (flow-config-loader.js, flow-decisions-merge.js). Zero `JSON.parse(fs.readFileSync(...))` remains in scripts/. All 18 tests pass.
**Files**: scripts/flow-long-input.js, scripts/flow-run-trace.js, scripts/flow-hooks.js, scripts/flow-version-check.js, scripts/flow-session-end.js, scripts/flow-cascade.js, scripts/flow-multi-approach.js, scripts/flow-config-interactive.js, scripts/flow-health.js, scripts/flow-pattern-extractor.js, scripts/registries/contract-scanner.js, scripts/flow-decisions-merge.js, scripts/flow-skill-generator.js, scripts/hooks/core/research-gate.js, scripts/flow-config-loader.js

### R-262 | 2026-03-25
**Type**: chore
**Tags**: #security #naming #performance #dependencies
**Task**: wf-fbffee09
**Request**: "Quick wins: npm audit fix + naming docs + catch(e) fixes"
**Result**: Fixed flatted prototype pollution vulnerability (3.4.1→3.4.2), fixed catch(e) bug in 3 files where param was `e` but body used `err` (flow-lsp.js, flow-skill-learn.js, flow-prd-manager.js), documented `_err` convention in naming-conventions.md, moved fast-path fs.existsSync before getConfig() in observation-capture.js, bumped @babel/parser 7.29.0→7.29.2. 0 npm audit vulnerabilities.
**Files**: scripts/flow-lsp.js, scripts/flow-skill-learn.js, scripts/flow-prd-manager.js, scripts/hooks/core/observation-capture.js, .claude/rules/code-style/naming-conventions.md, package.json, package-lock.json

### R-261 | 2026-03-25
**Type**: chore
**Tags**: #compatibility #claude-code #hooks #providers #env-scrub
**Request**: "Claude Code 2.1.83 compatibility updates"
**Result**: Added CwdChanged/FileChanged to UNUSED_SUPPORTED_EVENTS, documented ENV_SCRUB impact on hybrid mode providers and correction detector, added ENV_SCRUB graceful degradation to flow-correction-detector.js, updated claude-code-compatibility.md with full 2.1.83 section covering managed-settings.d, new hook events, ENV_SCRUB, --channels limitations, TaskOutput deprecation, MEMORY.md 25KB cap, plugin userConfig, WebFetch Claude-User agent.
**Files**: scripts/hooks/adapters/claude-code.js, scripts/flow-correction-detector.js, scripts/flow-providers.js, .claude/docs/claude-code-compatibility.md

### R-260 | 2026-03-24
**Type**: fix
**Tags**: #hook:task-gate #hook:commit-log-gate #error-handling
**Task**: wf-4a4d63f8
**Request**: "Fix two bugs: task-gate misleading 'no active task' error when task exists without routedAt; commit-log-gate assumes request-log.md is git-trackable but .workflow/ may be gitignored"
**Result**: Bug 1: Added routing-proof detection in checkTaskGate — when getActiveTask() returns null but a task IS in inProgress, returns specific 'task_missing_routing_proof' error with actionable fix instructions. Bug 2: Changed commit-log-gate from checking git staging (stagedFiles.some) to checking file content (fs.readFileSync + includes(taskId)), respecting .gitignore.
**Files**: scripts/hooks/core/task-gate.js, scripts/hooks/core/commit-log-gate.js

### R-259 | 2026-03-18
**Type**: new
**Tags**: #compaction #hooks #context-management #post-compact #checkpoint
**Request**: "Make /wogi-pre-compact redundant — seamless auto-compaction"
**Result**: Three changes to make auto-compaction safe: (1) Added "Compact Instructions" section to CLAUDE.md template telling Claude Code's native compactor to preserve WogiFlow state (task ID, criteria, phase, changed files). (2) Enriched PostCompact hook with acceptance criteria from task-checkpoint.json, changed files from checkpoint or git diff, and last request-log entry number — giving AI everything needed to continue seamlessly. (3) Added continuous file tracking in post-tool-use.js (writes to task-checkpoint.json after every Edit/Write) and criteria persistence when durable session initializes. Updated Context Management section in template to document that /wogi-pre-compact is now optional.
**Files**: .workflow/templates/claude-md.hbs, scripts/hooks/core/post-compact.js, scripts/hooks/entry/claude-code/post-tool-use.js, scripts/flow-task-checkpoint.js, CLAUDE.md

### R-258 | 2026-03-18
**Type**: change
**Tags**: #methodology #verification #quality-gates #wogi-start
**Request**: "Strengthen Step 3.55 for 'remove/fix all X' tasks — inventory-before-and-after approach"
**Result**: Replaced vague semantic verification with mandatory 3-phase inventory methodology: (A) pre-implementation inventory — read files and classify by PURPOSE not pattern, display numbered checklist, get user confirmation, (B) implementation against concrete inventory, (C) post-implementation re-inventory + diff. Generalizes across all removal types (mock data, console.log, hardcoded URLs, deprecated APIs, etc.). Key insight: AI must commit to a numbered inventory BEFORE starting work — cannot later claim done when items remain.
**Files**: .claude/commands/wogi-start.md

### R-257 | 2026-03-18
**Type**: new
**Tags**: #hooks #enforcement #quality-gates #request-log #registry
**Request**: "Mechanical enforcement for request-log and registry updates — pre-commit blocking gate + auto registry scan"
**Result**: (1) Created commit-log-gate.js core module — blocks `git commit` when active task exists but request-log.md not in staged changes. Whitelists: no active task, merge commits, state-only commits, gate disabled. (2) Wired into pre-tool-use.js after routing gate, fail-open on errors. (3) Added auto registry scan in post-tool-use.js — fires after every successful `git commit` regardless of task level, removing AI dependency for registry updates. (4) Added `enforcement.commitLogGate.enabled: true` config toggle.
**Files**: scripts/hooks/core/commit-log-gate.js (new), scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/entry/claude-code/post-tool-use.js, .workflow/config.json

### R-256 | 2026-03-17
**Type**: fix
**Tags**: #bugfix #architecture #prompt-history
**Request**: "Fix prompt history — implement Approach B (flat array architecture)"
**Result**: Rewrote flow-prompt-capture.js from task-keyed (v1) to flat chronological array (v2). Fixed all 3 bugs: (1) First prompt no longer lost — capturePrompt() always saves with taskId: null, tagRecentPrompts() retrospectively tags after task creation. (2) Stale taskId detected — getCurrentTaskId() cross-checks durable-session against ready.json inProgress. (3) All prompts stored — captureCurrentPrompt() always saves. Added v1→v2 auto-migration on first load. Backward-compatible API: getTaskPromptHistory() filters flat array, processTaskCompletion() signature unchanged, markTaskCompleted() is graceful no-op. New CLI: capture (no taskId needed), tag, migrate commands. 5/5 functional tests pass.
**Files**: scripts/flow-prompt-capture.js

### R-255 | 2026-03-17
**Type**: fix
**Tags**: #review #bugfix #security #quality
**Request**: "Fix 6 review findings round 3"
**Result**: (1) CRITICAL — imported getTodayDate from flow-output.js into flow-standards-learner.js (pre-existing bug, never worked). (2) MEDIUM — moved title-strip into task-completed withLock callback, simplified clearProgress to only delete file (no more unlocked ready.json mutation). (3) LOW — replaced raw JSON.parse with safeJsonParseString in progress tracker CLI. (4) LOW — changed updateTitle to opt-in (=== true). (5) LOW — removed unnecessary PATHS/safeJsonParse aliases in post-compact.js section 5.
**Files**: scripts/flow-standards-learner.js, scripts/flow-progress-tracker.js, scripts/hooks/core/task-completed.js, scripts/hooks/core/post-compact.js

### R-254 | 2026-03-17
**Type**: new
**Tags**: #progress #ux #statusline
**Request**: "Build progress tracking system for long-running tasks"
**Result**: Built flow-progress-tracker.js with state management + ASCII progress bar formatting. Added progress tracking protocol to wogi-start.md (phase mapping for 5 phases, checkpoint format, state file updates). Added progress sections to wogi-review.md and wogi-audit.md with phase mappings. Integrated auto-clear into task-completed hook. Progress state written to .workflow/state/task-progress.json, task title in ready.json prefixed with [N/M] for status line visibility. Format: [████░░░░░░] 40% Phase 2: AI Review — Agent 3/6 complete.
**Files**: scripts/flow-progress-tracker.js (new), scripts/hooks/core/task-completed.js, .claude/commands/wogi-start.md, .claude/commands/wogi-review.md, .claude/commands/wogi-audit.md

### R-253 | 2026-03-17
**Type**: fix
**Tags**: #review #bugfix #quality
**Request**: "Fix 5 delta review findings"
**Result**: (1) Cleaned compactPath/compactFs aliases to standard path/fs names in post-compact.js (block-scoped, not function-scoped — reviewer was wrong about reuse). (2) Removed [-]? optional hyphen from patternKey regex — hyphens required for exact table matching. (3) Made fuzzy threshold proportional: max(3, ceil(words*0.5)). (4) Added promotionFailed counter separate from tracking. (5) Added backtick fence and angle bracket stripping to sanitizeForMarkdown.
**Files**: scripts/hooks/core/post-compact.js, scripts/flow-standards-learner.js, scripts/flow-audit.js

### R-252 | 2026-03-17
**Type**: change
**Tags**: #review #learning #rules #enforcement
**Request**: "Wire pattern promotion + enforcement gap functionality into /wogi-review"
**Result**: Wired the audit pattern promotion pipeline into /wogi-review at two integration points: (1) Phase 3 enhanced with step 3.3 — after standards check, violations are clustered and fed through recordAuditPattern() / checkEnforcementGap() for pattern tracking, auto-promotion, and enforcement gap detection. (2) Phase 5.4 learning capture replaced with full promotion pipeline — all findings (not just standards) feed into the same infrastructure as /wogi-audit, including enforcement gap investigation with root cause analysis (too vague, too long, outdated, no enforcement, contradictory, pre-existing) and suggested fixes. Reviews and audits now share the same promotion counter — a pattern found 2x in audits + 1x in review hits the threshold and auto-promotes.
**Files**: .claude/commands/wogi-review.md

### R-251 | 2026-03-17
**Type**: fix
**Tags**: #review #security #bugfix #dry
**Request**: "Fix 9 review findings from code review"
**Result**: Fixed all 9 findings: (1) CRITICAL — path ReferenceError in post-compact.js section 5 — added const compactPath = require('node:path') in correct scope. (2-3) HIGH — ReDoS in flow-standards-learner.js — added escapeRegex() import and applied to all 3 regex construction sites (checkEnforcementGap, recordViolationPattern, promoteToDecisions). (4) MEDIUM — markdown/prompt injection — added sanitizeForMarkdown() and applied to all cluster data interpolated into decisions.md. (5) MEDIUM — DRY violation — deleted mapCategoryForPromotion() and buildPromotionRuleTemplate() from flow-audit.js, now imports from flow-standards-learner.js. (6) MEDIUM — silent promotion failure — added PROMOTION_FAILED status with failureReason instead of misleading TRACKING. (7) Deferred — raw JSON.stringify in post-compact.js acceptable for isolated try block. (8) LOW — extracted SYSTEMIC_THRESHOLD and MEDIUM_THRESHOLD constants. (9) LOW — separated patternId check from fuzzy description matching, added stopword filter.
**Files**: scripts/flow-standards-learner.js, scripts/flow-audit.js, scripts/hooks/core/post-compact.js

### R-250 | 2026-03-17
**Type**: new
**Tags**: #audit #learning #rules #enforcement
**Request**: "Add pattern promotion step to /wogi-audit — AI clustering, enforcement gap investigation, auto-promotion"
**Result**: Built 3-phase pattern promotion system in /wogi-audit. Phase 1: AI-as-judge semantic clustering of findings (Sonnet agent groups semantically similar findings into canonical patterns). Phase 2: Cross-reference with decisions.md (enforcement gaps), feedback-patterns.md (count tracking + auto-promotion), and last-audit.json (recurrence detection). Phase 3: Enforcement gap investigation — when a rule exists but is still violated, investigates WHY (too vague, too long, outdated, no enforcement, contradictory, pre-existing) and recommends action (rewrite, split, add to standards gate, backfill). Extended flow-standards-learner.js with checkEnforcementGap() and recordAuditPattern(). Added promote subcommand to flow-audit.js. Updated wogi-audit.md with Step 4.5 (3 phases), expanded Step 5 menu (investigate gaps, apply promotions), and enriched last-audit.json schema (patterns, enforcementGaps, promotions fields).
**Files**: scripts/flow-standards-learner.js, scripts/flow-audit.js, .claude/commands/wogi-audit.md, .workflow/specs/wf-6a06eafd.md

### R-249 | 2026-03-17
**Type**: change
**Tags**: #compatibility #hooks #models #claude-code
**Request**: "Review Claude Code 2.1.76 + 2.1.77 release notes and update WogiFlow"
**Result**: Updated for 2.1.77 compatibility: (1) Sonnet 4.6 maxOutputTokens 64k→128k in model registry. (2) Added 2.1.77 soft version gate. (3) Added compaction circuit breaker awareness to PostCompact hook (tracks rapid compactions, warns at 3+). (4) Added 2.1.76 + 2.1.77 sections to compatibility doc with all relevant impacts. (5) Updated hook events table with InstructionsLoaded + PostCompact. (6) Updated worktree comparison table with sparse checkout. (7) Verified PreToolUse allow/deny behavior is correct — no code change needed. (8) Verified compound bash permissions are single-command patterns — no impact. (9) Confirmed Elicitation hooks already listed in UNUSED_SUPPORTED_EVENTS.
**Files**: .workflow/models/registry.json, scripts/flow-version-check.js, scripts/hooks/core/post-compact.js, .claude/docs/claude-code-compatibility.md

### R-248 | 2026-03-13
**Type**: fix
**Tags**: #review #bugfix #security #performance
**Request**: "Code review of v1.9.8–v1.9.10 changes"
**Result**: 4-agent parallel review found 8 findings (1 critical, 6 medium, 1 low). Fixed 7: (1) CRITICAL — flow-health.js config variable out of scope causing gitignore health check to always fail silently. (2) Misleading comment in context-estimator ("relax" → "recalibrate"). (3) Dead ternary in flow-gitignore.js. (4) Raw JSON.parse → safeJsonParse in context-estimator. (5) syncGitignore now only runs for relevant config keys. (6) Removed unused ccVersion variable. (7) Module-level cache for .version-check.json reads. Deferred 1: getNestedValue DRY refactor (cross-file).
**Files**: scripts/flow-health.js, scripts/flow-context-estimator.js, scripts/flow-gitignore.js, scripts/flow-config-loader.js

### R-247 | 2026-03-13
**Type**: new
**Tags**: #compatibility #context #version #cc-2175
**Task**: wf-7c9e6eec
**Request**: "Claude Code 2.1.75 compatibility improvements"
**Result**: (1) Token estimation recalibration: raised safe threshold 75%→80% and emergency 90%→92% behind 2.1.75+ soft gate (reads cached version from .version-check.json). Users with accurate token counting get ~5% more working context before compaction. (2) Version gates: added 2.1.75 to soft gates with health report showing 1M context default, accurate token estimation, hook source display, memory timestamps. Only applies when user hasn't explicitly overridden thresholds in config.
**Files**: scripts/flow-context-estimator.js, scripts/flow-version-check.js, scripts/flow-health.js

### R-246 | 2026-03-13
**Type**: new
**Tags**: #gitignore #config #health #developer-experience
**Task**: wf-bda315c0
**Request**: "Auto-add .gitignore entries when config changes enable features with runtime artifacts"
**Result**: Created declarative gitignore auto-management system. Config-to-gitignore mapping in RUNTIME_ARTIFACT_MAP (testing.uiProvider=playwright-mcp → .playwright-mcp/, testing.enabled → .workflow/verifications/ + .workflow/tests/generated/, webmcp.enabled → .workflow/webmcp/). Triggers on config write via setConfigValue/setConfigValueSync. Health check in /wogi-health warns on missing entries. Append-only, idempotent, grouped under "# WogiFlow runtime (auto-managed)" comment. Also runs during install.
**Files**: scripts/flow-gitignore.js (new), scripts/flow-config-loader.js, scripts/flow-health.js, scripts/flow-utils.js, lib/installer.js

### R-245 | 2026-03-13
**Type**: refactor
**Tags**: #audit-sweep #security #hooks #duplication #dead-code #config
**Task**: wf-b524b712 (epic: audit sweep)
**Request**: "Fix all 57 audit findings across 7 dimensions"
**Result**: Completed 6 of 7 audit stories (deferred modernization sweep as low-priority). Key changes: (1) Deleted 6 legacy bash scripts + flow-file-ops.js, (2) Removed @modelcontextprotocol/sdk, updated sql.js to ^1.14.1, (3) Eliminated 3 identical inline color() functions → import from flow-output.js, (4) Consolidated inline crypto ID generation → generateHashId(), (5) Replaced duplicate getProjectRoot/isValidTaskId with imports from flow-utils, (6) Created shared stdin reader for hooks, cached RegExp in component-check, fixed observation-capture redundant config reads, (7) Wired logHookError to post-tool-use.js, (8) Replaced direct config reads with getConfig() in flow-health/flow-long-input/flow-workflow-steps/flow-skill-generator, (9) Removed --resume dead stub and crossMapConsistency TODO
**Files**: 47 files changed — scripts/flow-done(deleted), scripts/flow-health(deleted), scripts/flow-ready(deleted), scripts/flow-start(deleted), scripts/flow-status(deleted), scripts/flow-story(deleted), scripts/flow-file-ops.js(deleted), scripts/hooks/entry/shared/read-stdin.js(new), package.json, scripts/flow-memory-compactor.js, scripts/flow-entropy-monitor.js, scripts/flow-memory-sync.js, scripts/flow-orchestrate-llm.js, scripts/flow-peer-review.js, scripts/flow-context-estimator.js, scripts/flow-script-resolver.js, scripts/flow-export-scanner.js, scripts/flow-orchestrate.js, scripts/flow-consistency-check.js, scripts/flow-health.js, scripts/flow-workflow-steps.js, scripts/hooks/core/component-check.js, scripts/hooks/core/observation-capture.js, scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/entry/claude-code/post-tool-use.js, scripts/hooks/entry/claude-code/session-start.js, and more

---

### R-244 | 2026-03-13
**Type**: fix
**Tags**: #script:flow-health #refactor:config-loading
**Request**: "Fix direct config loading and bare JSON.parse issues in flow-health.js and 5 other scripts"
**Result**: Fixed `flow-health.js` line 131 — replaced `require(PATHS.config)` with `getConfig()` (added `getConfig` to imports). Verified flow-workflow-steps.js, flow-correct.js, flow-safety.js, flow-providers.js, and flow-entropy-monitor.js already use `getConfig()` correctly. All 6 files pass `node --check`.
**Files**: scripts/flow-health.js

---

### R-243 | 2026-03-12
**Type**: fix
**Tags**: #security #hooks #quality-gates #docs
**Task**: wf-b2c5f11f
**Request**: "Fix 12 review findings from wf-8f430179 and wf-f96598bc code review"
**Result**: Fixed all 12 findings: (1) newline/backslash injection bypass in git whitelist regex, (2) destructive git flags (-D, --force, --hard) passing whitelist, (3) appMapUpdate→registryUpdate in flow-config-defaults.js, (4) lazy registry manager import, (5) missing cwd in spawnSync, (6) stdout pollution fix using stderr SCAN_RESULT marker, (7) deprecation warning for old appMapUpdate gate name, (8) updated 11 doc/agent files with registryUpdate references, (9) updated legacy Python flow-done script
**Files**: scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/flow-done.js, scripts/flow-done, scripts/flow-config-defaults.js, agents/developer.md, agents/reviewer.md, agents/orchestrator.md, .claude/docs/config-reference.md, .claude/docs/knowledge-base/02-task-execution/03-verification.md, .claude/docs/knowledge-base/02-task-execution/trade-offs.md, .claude/docs/knowledge-base/02-task-execution/README.md, .claude/docs/knowledge-base/02-task-execution/05-session-review.md, .claude/docs/knowledge-base/configuration/all-options.md, .claude/docs/knowledge-base/configuration/README.md, .claude/commands/wogi-onboard.md

---

### R-242 | 2026-03-12
**Type**: fix
**Tags**: #registry #quality-gate #routing #hooks #product-fix
**Task**: wf-f96598bc
**Request**: "Fix all registry maps not updating automatically after task completion + whitelist read-only git commands in routing gate"
**Result**: Replaced no-op `appMapUpdate` gate with programmatic `registryUpdate` gate in flow-done.js that runs `flow registry-manager scan` on ALL active registries (app-map, function-map, api-map, schema-map, service-map). Compares map file timestamps before/after scan to report what was updated. Handles backward compat (both `appMapUpdate` and `registryUpdate` gate names trigger the same logic). Updated config.schema.json default gates. Added read-only git command whitelist in pre-tool-use.js routing gate — allows git status/log/diff/branch/show/rev-parse/remote/tag/ls-files/describe before routing, with shell chaining operator detection to prevent abuse. Updated wogi-start.md docs, CLAUDE.md template, and regenerated CLAUDE.md.
**Files**: scripts/flow-done.js, scripts/hooks/entry/claude-code/pre-tool-use.js, .workflow/config.schema.json, .claude/commands/wogi-start.md, .workflow/templates/claude-md.hbs, CLAUDE.md

### R-241 | 2026-03-12
**Type**: fix
**Tags**: #command #research #config #auto-trigger
**Task**: wf-8f430179
**Request**: "Fix /wogi-research auto-trigger ignoring config.json research settings"
**Result**: Added Step 0: Config Loading (mandatory config read before all phases) with question-type classification via triggers map, depth resolution, and format flag application. Added Output Checklist (mandatory self-verification of structured output sections). Added `triggers` section to config schema mapping question types to depth levels. Updated Configuration docs with new triggers key and requireVerificationFormat.
**Files**: .claude/commands/wogi-research.md, .workflow/config.schema.json

### R-240 | 2026-03-11
**Type**: new
**Tags**: #config #cli #interactive #product-fix
**Task**: wf-04eb6705
**Request**: "Interactive npx flow config command"
**Result**: Created flow-config-interactive.js with 13 important options displayed with labels, descriptions, current values, and default markers. Supports subcommands: show (default), set (delegates to flow-config-set.js), export (JSON overrides only), reset (clear to defaults). Color-coded output with `*` marker for custom overrides. Added `--json` flag for machine-readable output. Wired into flow CLI as `flow config` command.
**Files**: scripts/flow-config-interactive.js (new), scripts/flow

### R-239 | 2026-03-11
**Type**: new
**Tags**: #hooks #error-handling #unified #product-fix
**Task**: wf-05828958
**Request**: "Unified hook error handling system"
**Result**: Created flow-hook-errors.js with error classification (LOAD_FAILURE, FILE_IO, CORRUPTED_STATE, PERMISSION_ERROR, TIMEOUT, CONFIG_ERROR, CRITICAL), per-hook fail mode policy registry (4 hooks, 15 operations), formatHookError() and logHookError() utilities. Integrated into all 3 entry hooks (session-start, pre-tool-use, stop) replacing ad-hoc console.error calls. User-facing messages include error type, description, and resolution instructions.
**Files**: scripts/flow-hook-errors.js (new), scripts/hooks/entry/claude-code/session-start.js, scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/entry/claude-code/stop.js

### R-238 | 2026-03-11
**Type**: new
**Tags**: #version-check #session-start #hooks #product-fix
**Task**: wf-2920202e
**Request**: "Version compatibility check at session start"
**Result**: Created flow-version-check.js with once-per-install check. Integrated into session-start.js hook. Warns only below hard minimum (2.1.23). Stores check state in .workflow/state/.version-check.json keyed by WogiFlow version. Soft feature gates (2.1.50+, 2.1.72+) degrade gracefully without warnings.
**Files**: scripts/flow-version-check.js (new), scripts/hooks/entry/claude-code/session-start.js

### R-237 | 2026-03-11
**Type**: new
**Tags**: #uninstall #manifest #data-safety #product-fix
**Task**: wf-a17c1c86
**Request**: "Manifest-based safe uninstall for skills, rules, docs, hooks"
**Result**: Added `.claude/.wogiflow-manifest.json` tracking all WogiFlow-owned files. postinstall.js generates manifest after copying resources. preuninstall.js reads manifest and only deletes listed files, preserving user-created content. Falls back to legacy behavior with warning if no manifest exists. installer.js updates manifest when /wogi-init adds skills.
**Files**: scripts/postinstall.js, scripts/preuninstall.js, lib/installer.js

### R-236 | 2026-03-11
**Type**: fix
**Tags**: #config #community-sync #migration #product-fix
**Task**: wf-6633986f
**Request**: "Config inconsistency: communitySync.enabled and community.sync.enabled contradict each other"
**Result**: Fixed three issues: (1) Added conflict detection in applyConfigCompatShim() — warns when community.sync.enabled and communitySync.enabled have different values, (2) Added master toggle enforcement in getSyncConfig() — community.enabled: false now forces sync disabled, (3) Migration now deletes deprecated community.sync key after processing to prevent future confusion.
**Files**: scripts/flow-config-loader.js, scripts/flow-community-sync.js

### R-235 | 2026-03-11
**Type**: fix
**Tags**: #prompt-capture #durable-session #hooks #product-fix
**Task**: wf-76fe56a7
**Request**: "Fix BUG-005: prompt-history.json captures zero prompts"
**Result**: Added durable-session.json creation in session-start.js when an active task exists in ready.json. Fixes two issues: (1) first prompt always dropped because durable-session.json didn't exist yet when user-prompt-submit fired, (2) prompts dropped after context compaction/session restart because session file was archived but never recreated. Uses same pattern as post-tool-use.js bridge but triggers earlier in the lifecycle.
**Files**: scripts/hooks/entry/claude-code/session-start.js

### R-234 | 2026-03-11
**Type**: fix
**Tags**: #routing #enforcement #product-fix #hooks
**Task**: wf-5cc1e323
**Request**: "Investigate and fix routing enforcement — product-level solution"
**Result**: Fixed 4 root causes of routing bypass: (1) Added WebSearch + WebFetch to GATED_TOOLS in routing-gate.js — AI could previously use these to answer without routing. (2) Raised stop hook max attempts from 3 to 10 — AI could previously escape routing enforcement by persisting through 3 stop attempts. (3) Added WebSearch + WebFetch to PreToolUse routing gate condition — matching the GATED_TOOLS set. (4) Shortened implementation-gate routing enforcement message from 20+ lines to 1 razor-sharp directive — verbose messages gave AI text to rationalize around.
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/core/implementation-gate.js, scripts/hooks/entry/claude-code/stop.js, scripts/hooks/entry/claude-code/pre-tool-use.js

### R-233 | 2026-03-11
**Type**: fix
**Tags**: #security #routing #login #review-fix
**Task**: wf-420e640e
**Request**: "Fix 20 review findings from routing bypass + login/logout review"
**Result**: Fixed all 20 findings: closed durable-session bypass hole, added task.id validation (path traversal), added routedAt to sync moveTask(), replaced raw JSON.parse with safe parsing, enforced HTTPS-only, added response size limit, validated server URLs before browser open, added login/logout dispatch to scripts/flow, fixed variable shadowing, cursor math, type guards, null checks, terminal raw mode cleanup, --api-base validation, backward compat for pre-routedAt tasks, moved fs to top-level require, corrected inaccurate comments, fixed truncated help text
**Files**: scripts/hooks/core/task-gate.js, scripts/flow-utils.js, lib/commands/team-connection.js, lib/commands/login.js, scripts/flow

### R-232 | 2026-03-11
**Type**: new
**Tags**: #detection #config #quality-gates #rules #wf-f3a1ec3d
**Request**: "Project-Type-Aware Configuration Pipeline"
**Result**: Implemented weighted scoring detection (Option C) replacing boolean OR — framework deps=0.95, directories=0.25, threshold=0.5. Fixes false fullstack detection for frontend-only projects with src/routes/. Added detection.overrides in config + NL support via /wogi-config ("this project has no UI"). Activated probeProject() during onboard for port detection. Project-type-aware config defaults strip irrelevant sections (UI for backend, API for frontend). Quality gates skip irrelevant checks (uiVerification for backend). Rules sync skips component-reuse.md for backend.
**Files**: scripts/flow-project-analyzer.js, scripts/flow-config-defaults.js, scripts/flow-config-loader.js, scripts/flow-done.js, lib/installer.js, .workflow/bridges/base-bridge.js, .workflow/config-reference.json, .claude/rules/code-style/naming-conventions.md

---

### R-231 | 2026-03-11
**Type**: fix
**Tags**: #review-fix #security #logic #integration #wf-c22a8988
**Request**: "Fix 20 review findings from /wogi-review"
**Result**: Fixed 17/20 findings (3 non-autoFixable documented). HIGH: replaced raw JSON.parse with safeJsonParse (3 instances), fixed hasRegressions &&→|| logic bug, fixed processExited promise hang, removed shell:true injection, fixed profile.testCommand path, added testing config keys, wired profile loading in gate. MEDIUM: removed unused imports (2 files), fixed scenario mutation, fixed global regex, added ReDoS guard, documented runFailToPass limitation. LOW: removed TOCTOU pattern, removed unused param, fixed flattenTreeToText array handling.
**Files**: scripts/flow-test-discovery.js, scripts/flow-scenario-engine.js, scripts/flow-test-api.js, scripts/flow-test-ui.js, scripts/flow-verification-profile.js, .workflow/config.json

---

### R-230 | 2026-03-11
**Type**: feature
**Tags**: #testing #ai-matching #discovery #wf-ee8bae96
**Request**: "Upgrade flow-test-discovery.js to use AI semantic matching instead of Jaccard"
**Result**: Added AI-based semantic matching pipeline: prepareAIMatchingData() generates structured prompts for the AI to do semantic criteria→test matching, applyAIMatchResults() integrates AI results. Added heuristic extraction fallback for non-standard frameworks (Go TestXxx, Python test_xxx, Ruby RSpec, template literals). Jaccard kept as automated/CI fallback. New --prepare-ai CLI flag. 10 exported functions.
**Files**: scripts/flow-test-discovery.js

---

### R-229 | 2026-03-10
**Type**: fix
**Tags**: #hooks #routing-gate #security #bypass
**Request**: "Investigate why Bash tool calls bypass the routing gate hook"
**Result**: Found root cause: `.routing-cleared` marker had a 5-minute TTL, creating a window where any user message sent within 5 min of a `/wogi-*` command bypassed routing entirely. Fix: (1) Reduced TTL from 5 min to 15 sec — skill chains complete within seconds, new user turns always take longer. (2) UserPromptSubmit now actively deletes the cleared marker on non-wogi-command prompts (belt-and-suspenders).
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/entry/claude-code/user-prompt-submit.js

### R-228 | 2026-03-10 23:30
**Type**: refactor
**Tags**: #models #registry #capabilities #refactor
**Task**: wf-0276fbff
**Request**: "Wire up capabilities as authoritative model knowledge source"
**Result**: Separated model system concerns. registry.json slimmed to infrastructure-only (providers, routing, costTiers, per-model structural fields). Per-model knowledge (languages, bestFor, contextPreferences, capabilities, taskScores, strengths, limitations) moved to capabilities/*.json. Unified loader in flow-model-types.js merges both transparently. flow-instruction-richness.js switched from duplicate loader to shared loadRegistry(). All 8 models have capability JSON files. YAML files removed.
**Files**: scripts/flow-model-types.js, scripts/flow-instruction-richness.js, .workflow/models/registry.json, .workflow/models/capabilities/*.json (8 files), lib/installer.js, package.json

---

### R-227 | 2026-03-10 22:00
**Type**: docs
**Tags**: #config #documentation #onboarding
**Request**: "Create config reference document with all possible overrides"
**Result**: Created `.claude/docs/config-reference.md` — comprehensive reference of all config.json overrides organized by category (scripts, testing, enforcement, quality gates, commits, hooks, execution, review, research, etc.) with copy-paste presets (minimal, standard, full testing, maximum quality). Added cross-reference in `commands.md`.
**Files**: `.claude/docs/config-reference.md` (new), `.claude/docs/commands.md`
**Task**: wf-8c169eb5

### R-226 | 2026-03-10 21:30
**Type**: fix
**Tags**: #testing #security #quality-gates #review-fix
**Request**: "Fix 8 review findings from Auto-Testing Suite"
**Result**: (1) Fixed shell injection in flow-done.js — taskId validated via `validateTaskId()` before interpolation, paths use `JSON.stringify()`. (2) Fixed import paths — `path.join(__dirname, ...)` instead of relative `./scripts/...`. (3) Replaced 7 raw `JSON.parse()` with `safeJsonParse`/`safeJsonParseString` across 3 files. (4) Replaced manual `existsSync`+`readFileSync`+`JSON.parse` with `safeJsonParse(filePath, null)` (handles read+parse safely). (5) Added `timeout: 120000` to all spawnSync calls. (6) Deduplicated uiVerification/apiVerification gates (~80 lines → ~50 lines unified). (7) All 4 files pass `node --check`.
**Files**: `scripts/flow-done.js`, `scripts/flow-test-api.js`, `scripts/flow-test-generate.js`, `scripts/flow-test-integrity.js`
**Task**: wf-1a11b65c

### R-225 | 2026-03-10 19:15
**Type**: refactor
**Tags**: #learning-system #decisions #product-feedback #rules
**Request**: "Product vs project learning separation: create product-feedback.md, clean decisions.md, fix rules distribution, update learning system"
**Result**: (1) Created `.workflow/state/product-feedback.md` for WogiFlow product-level learnings. (2) Cleaned `decisions.md` from 577→70 lines — removed 8 duplicates and 15 product-level rules. (3) Moved 7 project-specific rules files to `.claude/rules/_internal/`, updated `copyDir()` to skip `_` prefixed dirs. (4) Added Step 0.5 "Product vs Project Classification" to `wogi-decide.md`, `wogi-learn.md`, `wogi-bug.md`, `wogi-correction.md`, and `wogi-start.md` — all learning entry points now classify before writing. (5) Prevention verified: all learning commands route through classification gate before writing to any state file.
**Files**: `.workflow/state/product-feedback.md`, `.workflow/state/decisions.md`, `.workflow/state/feedback-patterns.md`, `.claude/commands/wogi-decide.md`, `.claude/commands/wogi-learn.md`, `.claude/commands/wogi-bug.md`, `.claude/commands/wogi-correction.md`, `.claude/commands/wogi-start.md`, `.claude/rules/_internal/*` (7 files moved), `lib/utils.js`
**Task**: wf-9f983be6

### R-224 | 2026-03-10 14:00
**Type**: fix
**Tags**: #bugfix:silent-fallback #component:flow-community #component:wogi-suggest
**Request**: "Fix submitSuggestion() always returning true regardless of delivery status"
**Result**: Changed `submitSuggestion()` return type from `boolean` to `{ delivered: boolean, queued: boolean }` object. Server 2xx → `{ delivered: true, queued: false }`, server error/unreachable → `{ delivered: false, queued: true }`, empty input → `false`. Object return is truthy for backward compatibility. Updated `wogi-suggest.md` caller to use richer result for accurate user feedback (delivered vs queued). No `submitBug()` function exists — pattern is unique to `submitSuggestion()`.
**Files**: scripts/flow-community.js, .claude/commands/wogi-suggest.md
**Task**: wf-a951ef22

### R-223 | 2026-03-10 12:00
**Type**: new
**Tags**: #feature:compatibility #component:flow-health #component:flow-wiring-verifier #component:flow-parallel #docs:compatibility
**Request**: "Adapt WogiFlow for Claude Code 2.1.72 — leverage ExitWorktree, Agent model param, fd auto-approval, effort levels, /plan description, worktree fixes"
**Result**: 1) Updated flow-health.js with 2.1.72 detection (ExitWorktree, model param, fd, lsof diagnostics). 2) Updated flow-wiring-verifier.js to use fd/fdfind with find fallback for faster file search. 3) Updated explore-agents.md with model parameter routing guidance for hybrid mode. 4) Updated wogi-finalize.md with ExitWorktree integration for clean worktree exit. 5) Updated wogi-plan.md with /plan description pass-through. 6) Added effort level optimization table to wogi-start.md (L3→low, L2→medium, L1/L0→high). 7) Updated flow-parallel.js docs noting worktree isolation is production-ready. 8) Added comprehensive 2.1.72 section to claude-code-compatibility.md. Verified HTML comments/PIN markers are safe (not used in CLAUDE.md or injected context). Verified settings.json has no agent prompts to wipe.
**Files**: scripts/flow-health.js, scripts/flow-wiring-verifier.js, scripts/flow-parallel.js, .claude/commands/wogi-finalize.md, .claude/commands/wogi-plan.md, .claude/commands/wogi-start.md, .claude/docs/explore-agents.md, .claude/docs/claude-code-compatibility.md
**Task**: wf-e861ee97

### R-222 | 2026-03-09 16:15
**Type**: new
**Tags**: #feature:verification #component:flow-wiring-verifier #component:flow-done
**Request**: "Add removal-impact detection to wiring verifier — detect orphaned consumer references when exports/types/identifiers are removed"
**Result**: Added `verifyRemovalImpact()` to flow-wiring-verifier.js. Detects removed exports, type union members, string literal IDs (tab/route/section keys), and component references from git diff. Searches codebase for consumers still referencing removed items. Wired into integrationWiring quality gate in flow-done.js — runs automatically for all WogiFlow users. Added CLI `removal-check` subcommand. Updated wogi-start.md Step 3.6 documentation.
**Files**: scripts/flow-wiring-verifier.js, scripts/flow-done.js, .claude/commands/wogi-start.md
**Task**: wf-638612a5

### R-221 | 2026-03-09 15:30
**Type**: fix
**Tags**: #fix:review-findings #component:flow-done #component:wogi-review #component:config
**Request**: "Fix 9 post-review findings: non-blocking gates, Phase 5.3c bypass, path/security issues"
**Result**: Fixed 8 of 9 findings, waived 1 (truncateOutput redaction — low risk for local CLI). Removed unused getRefinementCount import. Moved learningEnforcement/resolutionPopulated from required to optional in bugfix gates. Fixed process.cwd()→PATHS.workflow. Added validateTaskId() at top of runQualityGates. Rewrote Phase 5.3c to route through /wogi-start. Added smokeTest 0-file differentiation. Added explicit degradation messaging to gate catch blocks. Removed TOCTOU fileExists() pattern.
**Files**: scripts/flow-done.js, .workflow/config.json, .claude/commands/wogi-review.md, .workflow/state/last-review.json
**Task**: wf-c7cf3b50

### R-220 | 2026-03-09 14:30
**Type**: fix
**Tags**: #fix:review-findings #fix:routing-bypass #component:wogi-review #component:flow-done #component:config
**Request**: "Fix 9 review findings + systemic routing bypass in wogi-review Phase 5.3b"
**Result**: Rewrote wogi-review.md Phase 5.3b to route fix work through /wogi-start instead of manual ready.json editing (root cause of recurring routing bypass). Fixed 7 code findings: added 'fix' task type to qualityGates config (cl-001), implemented learningEnforcement/resolutionPopulated/smokeTest gates (cl-002), cached checkOutstandingFindings to avoid double call (cl-003), added warning log for missing verifier modules (cl-004), documented fallback-to-feature behavior (cl-005), truncated err.message from external verifiers (cl-006), removed dead config.testing code (cl-007). Fixed _err→err naming in user-prompt-submit.js.
**Files**: .claude/commands/wogi-review.md, scripts/flow-done.js, .workflow/config.json, .claude/commands/wogi-start.md, scripts/hooks/entry/claude-code/user-prompt-submit.js, .workflow/state/last-review.json
**Task**: wf-8166e9e9

### R-219 | 2026-03-09 12:15
**Type**: fix
**Tags**: #fix:quality-gates #component:flow-done #component:config
**Request**: "Harden quality gates — wire verifiers, add pre-release and outstanding-findings checks"
**Result**: Wired integrationWiring and standardsCompliance gates to actual verifier modules in flow-done.js (were falling through to "manual check"). Added outstandingFindings gate (reads last-review.json for unresolved critical/high). Added preRelease gate (checks findings + lint + typecheck). Added chore/release gate definitions to config. Updated decisions.md, wogi-start.md, github-releases.md.
**Files**: scripts/flow-done.js, .workflow/config.json, .workflow/state/decisions.md, .claude/commands/wogi-start.md, .claude/rules/operations/github-releases.md
**Task**: wf-cc94c959

### R-218 | 2026-03-09 10:40
**Type**: fix
**Tags**: #fix:reuse-enforcement #component:component-check #component:explore-agents #component:wogi-start
**Task**: wf-94cfba5a
**Request**: "Fix reuse enforcement gaps — project-type-aware, domain-keyword search, pre-implementation reuse gate"
**Result**: Four fixes: (1) component-check.js now has project-type-aware default patterns covering frontend (components, UI, modals, layouts, pages/shared), backend (services, middleware, models, schemas, validators, routes, controllers, repositories), and universal (utils, helpers, lib, shared, hooks, API clients, types, constants) — instead of hardcoded `**/components/**` and `**/ui/**`. (2) Agent 1 in explore-agents.md now has mandatory domain-keyword search as first step — extracts keywords from task title, Globs and Greps for matching files before checking registries. (3) Added REUSE GATE after explore phase in wogi-start.md — if reuse candidates found with purpose overlap, blocks implementation until user decides (use/extend/create new). (4) loadComponentIndex() now falls back to building a minimal index from all *-map.md files when component-index.json doesn't exist, instead of returning null.
**Files**: scripts/hooks/core/component-check.js, .claude/docs/explore-agents.md, .claude/commands/wogi-start.md, .workflow/state/decisions.md

### R-217 | 2026-03-09 10:22
**Type**: fix
**Tags**: #fix:community #component:flow-community
**Task**: wf-edbc0a4b
**Request**: "Fix getWogiFlowVersion() reading host project's package.json instead of WogiFlow's"
**Result**: Replaced `path.join(__dirname, '..', 'package.json')` with `require.resolve('wogiflow/package.json')` which correctly resolves to the installed WogiFlow package. Added fallback for source repo development that validates `pkg.name === 'wogiflow'` before using the relative path. Affects wogiflowVersion in suggestions, community data, and HTTP User-Agent header.
**Files**: scripts/flow-community.js

### R-216 | 2026-03-09 10:12
**Type**: fix
**Tags**: #fix:process #component:decisions
**Task**: wf-57eed008
**Request**: "Add decisions.md rule: scan filesystem before writing app-map.md"
**Result**: Added "App-Map Completeness: Scan Before Write" rule to decisions.md under Component Architecture. Rule mandates Glob scan of all source directories before any app-map.md write — prevents relying on incomplete conversation context. Based on developer report of 19+3 missed components.
**Files**: .workflow/state/decisions.md

### R-215 | 2026-03-09 10:05
**Type**: fix
**Tags**: #fix:review-findings #fix:routing-gate #fix:security #fix:postinstall #fix:installer
**Task**: wf-985f7342
**Request**: "Fix all 7 review findings from /wogi-review session"
**Result**: (1) hasActiveTask() changed from fail-open to fail-closed in routing-gate.js — prevents corrupted ready.json from bypassing routing. (2) Fixed comment-code mismatch in user-prompt-submit.js — clarified that routing flag is skipped for /wogi-* commands. (3) Renamed _parseErr to err in user-prompt-submit.js (naming convention). (4) Wrapped raw JSON.parse in postinstall.js:137 with try-catch. (5) Replaced existsSync+writeFileSync with atomic {flag:'wx'}+EEXIST in both postinstall.js and installer.js for .workflow/package.json creation. (6) Added user-facing warning on failure in postinstall.js instead of silent DEBUG-only log. (7) Added decisions.md entry documenting hasActiveTask() removal rationale.
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/entry/claude-code/user-prompt-submit.js, scripts/postinstall.js, lib/installer.js, .workflow/state/decisions.md

### R-214 | 2026-03-09 10:00
**Type**: fix
**Tags**: #fix:esm #fix:hooks #fix:onboarding #p0
**Task**: wf-a4a2e279
**Request**: "Fix ESM/CJS interop failure — SessionStart crashes on projects with type: module"
**Result**: Added .workflow/package.json with {"type": "commonjs"} to prevent Node.js from inheriting ESM from project root. Updated three entry points: (1) .workflow/package.json created in repo, (2) lib/installer.js creates it during onboarding, (3) scripts/postinstall.js creates it during npm install. Also added .workflow/package.json to npm files array in package.json.
**Files**: .workflow/package.json, lib/installer.js, scripts/postinstall.js, package.json

### R-213 | 2026-03-08 10:00
**Type**: fix
**Tags**: #security #routing #hooks #bypass
**Task**: wf-a98644b7
**Request**: "Investigate and fix routing gate bypass when active task exists"
**Result**: Found two bypass points in routing-gate.js that made the routing gate completely inert when any in-progress task existed: (1) setRoutingPending() skipped setting the flag when hasActiveTask() returned true, (2) checkRoutingGate() auto-cleared the flag when hasActiveTask() returned true. Both removed. Now every new user message sets the routing-pending flag regardless of active tasks, and only a /wogi-* skill invocation clears it. Updated stale comment in user-prompt-submit.js.
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/entry/claude-code/user-prompt-submit.js

### R-212 | 2026-03-07 12:00
**Type**: fix
**Tags**: #security #permissions #settings
**Task**: wf-879b16f1
**Request**: "Review Claude Code release changelog for WogiFlow impact; fix security issues found"
**Result**: Analyzed full changelog for breaking changes, opportunities, and problems. Found and fixed security violation: `Bash(git clean *)` in settings.local.json auto-allowed destructive git clean commands, violating security-patterns.md Section 6. Also removed redundant `Bash(test *)` now auto-approved natively by Claude Code. Identified opportunities: cron scheduling tools for periodic tasks, /loop command compatibility.
**Files**: .claude/settings.local.json

### R-211 | 2026-03-06 18:00
**Type**: fix
**Tags**: #fix:installer #fix:version #script:postinstall #script:flow-hooks #bridge:claude-bridge #script:flow-health
**Task**: wf-995ceac9
**Request**: "Fix _wogiFlowVersion staleness in settings.json"
**Result**: _wogiFlowVersion in settings.json was hardcoded at 1.5.9 since initial install, never updated on upgrades. Fixed all 3 version-reading paths (postinstall.js, claude-bridge.js, flow-hooks.js) to read from package.json as canonical source with settings.json fallback. Updated stale value. Added WogiFlow version to health check output.
**Files**: scripts/postinstall.js, .workflow/bridges/claude-bridge.js, scripts/flow-hooks.js, .claude/settings.json, scripts/flow-health.js

### R-210 | 2026-03-06 17:00
**Type**: refactor
**Tags**: #refactor:config #script:installer #script:config-loader #script:hooks #script:auto-context
**Task**: wf-e84bff5c
**Request**: "Config restructuring: merge enforcement overlap, merge validation overlap, consolidate strictMode x3, merge componentRules overlap, consolidate scattered learning, split context grab-bag, move tdd under execution"
**Result**: Restructured .workflow/config.json eliminating 7 categories of duplication. Updated 12 hook/script consumers with new canonical paths and fallbacks. Added backward compat shim with shallow copies. Review found 7 issues (3 high, 1 medium, 3 low), fixed 5. Key fixes: 7 stale config path refs in flow-auto-context.js, compat shim guards moved to sub-key level, shared references fixed with shallow copies.
**Files**: .workflow/config.json, .workflow/config.schema.json, lib/installer.js, scripts/flow-config-loader.js, scripts/flow-auto-context.js, scripts/flow-constants.js, scripts/flow-context-compact/expander.js, scripts/flow-context-compact/summary-tree.js, scripts/flow-context-compact/section-extractor.js, scripts/flow-start.js, scripts/flow-standards-gate.js, scripts/flow-review-passes/structure.js, scripts/hooks/core/task-gate.js, scripts/hooks/core/scope-gate.js, scripts/hooks/core/todowrite-gate.js, scripts/hooks/core/routing-gate.js, scripts/hooks/core/loop-check.js, scripts/hooks/core/implementation-gate.js, scripts/hooks/core/component-check.js

### R-209 | 2026-03-06 13:00
**Type**: fix
**Tags**: #fix:config #fix:hooks #script:installer #hook:user-prompt-submit
**Task**: wf-9d709284
**Request**: "Enable hooks by default, add granular promptCapture and correctionDetection flags"
**Result**: Changed hooks.enabled default to true. Intelligence features (sessionContext, componentReuse, promptCapture, correctionDetection, validation) and key lifecycle features (taskCompleted, setup) now enabled by default. Enforcement features (taskGating, routingGate, implementationGate, etc.) remain disabled by default — users opt in. Added promptCapture and correctionDetection as explicit granular flags under hooks.rules.intelligence. Hook checks these flags before capturing prompts or spawning detection.
**Files**: lib/installer.js, scripts/hooks/entry/claude-code/user-prompt-submit.js

### R-208 | 2026-03-06 12:00
**Type**: fix
**Tags**: #fix:learning #script:correction-detector #script:session-end #script:session-context #hook:user-prompt-submit
**Task**: wf-b581af28
**Request**: "Fix correction detector: remove regex, make AI-only (language-agnostic). Add learning loop closure at session-end. Add real-time surfacing of repeated corrections."
**Result**: Rewrote flow-correction-detector.js — removed all regex patterns, detection is now AI-only via Haiku (works in any language). Hook spawns background detection process (non-blocking). Session-end now pipes corrections to feedback-patterns.md via flow-auto-learn instead of just displaying and clearing. Session-context surfaces repeated correction types (2+ same type) in real-time.
**Files**: scripts/flow-correction-detector.js, scripts/hooks/entry/claude-code/user-prompt-submit.js, scripts/flow-session-end.js, scripts/hooks/core/session-context.js

### R-207 | 2026-03-06 00:00
**Type**: fix
**Tags**: #fix:config #script:flow-watch #docs:commands #docs:knowledge-base
**Task**: wf-9405d4da
**Request**: "Fix all hardcoded tsc --noEmit references across WogiFlow"
**Result**: Replaced hardcoded `tsc --noEmit` with dynamic `config.scripts.typecheck` in 4 locations: wogi-guided-edit.md, wogi-review.md, knowledge-base/03-verification.md, and scripts/flow-watch. The bash script now reads the typecheck command from `.workflow/config.json` at runtime with fallback. Prevents wrong typecheck on projects using TS Project References. Released as v1.8.5.
**Files**: .claude/commands/wogi-guided-edit.md, .claude/commands/wogi-review.md, .claude/docs/knowledge-base/02-task-execution/03-verification.md, scripts/flow-watch

### R-206 | 2026-03-04 04:30
**Type**: fix
**Tags**: #fix:core #hook:routing-gate #hook:pre-tool-use #bug:chained-skills
**Task**: wf-6e9967fc
**Request**: "Fix routing gate blocking when /wogi-start chains to /wogi-extract-review"
**Result**: Added "routing-cleared" marker mechanism to routing-gate.js. When clearRoutingPending() runs (on /wogi-* Skill invocation), it writes a short-lived marker file (5-min TTL). setRoutingPending() and isRoutingPending() check for this marker and skip/return-false when present. This prevents UserPromptSubmit from re-setting the routing flag during chained skill execution. Also added .routing-cleared to ALWAYS_STALE_PATTERNS in session-context.js for state folder hygiene.
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/core/session-context.js

### R-205 | 2026-03-04 04:00
**Type**: new
**Tags**: #feature:core #hook:session-end #hook:session-context #module:state-hygiene
**Task**: wf-ce5624e4
**Request**: "State folder hygiene — clean files from .workflow/state/ that don't belong to WogiFlow"
**Result**: Enhanced cleanStaleFiles() in session-context.js with comprehensive whitelist (80+ known state files), known directory list, always-stale patterns (PID locks), and 7-day age threshold for unknown files. Cleanup runs on both session start and session end. Unknown files older than 7 days are auto-removed; recent unknowns generate warnings.
**Files**: scripts/hooks/core/session-context.js, scripts/hooks/core/session-end.js

### R-204 | 2026-03-03 23:30
**Type**: fix
**Tags**: #feature:import #script:flow-import-profile #script:flow-decisions-merge
**Request**: "Fix decisions.md combine logic during import — truncated bash script causes garbled rules"
**Result**: The bash script `flow-import-profile` was truncated at line 929 (mid-printf) during a previous context crash. Option 2 (manual resolution) and option 3 (replace entirely) were completely missing, along with the case/if closing blocks. Fixed by completing the truncated code: option 2 now properly iterates conflicts, builds resolutions JSON, calls `flow-decisions-merge.js manual`; option 3 does a flat copy; added wildcard handler for invalid input; added no-conflicts auto-merge and no-existing-file fallback. The Node.js merge helper was already correct.
**Files**: scripts/flow-import-profile

### R-203 | 2026-03-03 23:00
**Type**: fix
**Tags**: #performance:context-window #command:wogi-start #rules:frontmatter
**Request**: "Context window limits blocking all work — tasks get stuck, compaction can't save"
**Result**: Root cause: wogi-start.md was 1,935 lines (~82KB, ~20K tokens) loaded on every task start. Combined with CLAUDE.md, rules, and system prompt, 50-60% of context consumed before any work. Fix: (1) Slimmed wogi-start.md from 1,935 to 286 lines (82% reduction) by removing output templates, config JSON, ASCII diagrams, verbose examples — zero behavioral rules lost. (2) Moved explore phase agent prompts to explore-agents.md and TDD protocol to tdd-mode.md (loaded on-demand). (3) Fixed 3 rules files that were always-loaded without frontmatter (dual-repo-management, document-structure, README) — added alwaysApply:false with proper globs. Net: ~25-30% more context available per session.
**Files**: .claude/commands/wogi-start.md, .claude/docs/explore-agents.md (new), .claude/docs/tdd-mode.md (new), .claude/rules/architecture/dual-repo-management.md, .claude/rules/architecture/document-structure.md, .claude/rules/README.md

### R-202 | 2026-03-03 21:30
**Type**: fix
**Tags**: #feature:onboarding #feature:compaction #bug:naming-scanner #bug:checkpoint-recovery
**Request**: "Fix naming convention scanner including WogiFlow internal files + fix context compaction recovery"
**Result**: Two bugs fixed: (1) Added .workflow/** and .claude/** to IGNORE_PATTERNS in flow-pattern-extractor.js and exclusion list in flow-project-analyzer.js so WogiFlow's own kebab-case files don't inflate naming convention detection during onboard. (2) Added checkpoint recovery to session-context.js — now loads task-checkpoint.json at session start, surfaces recovery info to the AI, and cleans up stale checkpoints for tasks that no longer exist.
**Files**: scripts/flow-pattern-extractor.js, scripts/flow-project-analyzer.js, scripts/hooks/core/session-context.js
**Tasks**: wf-d9304f42, wf-133037a1

### R-201 | 2026-03-03 19:30
**Type**: fix
**Tags**: #feature:general #hygiene:state-folder #hook:session-start #installer
**Task**: wf-23ec374a
**Request**: "Fix state folder hygiene — gitignore catch-all, prompt-history template, stale file cleanup"
**Result**: Replaced individual .gitignore entries with `.workflow/state/*` catch-all + exclusions for templates/subdirs. Created `prompt-history.json.template`. Added prompt-history to both `lib/installer.js` and `scripts/postinstall.js`. Added `cleanStaleFiles()` to session-context.js that removes `.routing-pending-pid-*` and `.claude-md-regen-version` on session start. Added `sessionCleanup` config toggle.
**Files**: `.gitignore`, `lib/installer.js`, `scripts/postinstall.js`, `scripts/hooks/core/session-context.js`, `.workflow/config.json`, `.workflow/state/prompt-history.json.template`

### R-200 | 2026-03-03 18:25
**Type**: new
**Tags**: #feature:general #component:completion-summary #hook:task-completed
**Request**: "Add task completion summaries — auto-generate a structured summary file when tasks complete"
**Result**: Created `flow-task-completion-summary.js` with summary generation logic. Modified `task-completed.js` hook to call it as fire-and-forget. Added `completionSummaries` config key under `hooks.rules`. Summaries written to `.workflow/completed/<feature>/wf-XXXXXXXX-completed.md` with: acceptance criteria pass/fail, files changed, verification results, review findings, lessons learned.
**Files**: scripts/flow-task-completion-summary.js, scripts/hooks/core/task-completed.js, .workflow/config.json, .workflow/changes/general/wf-c9530a01.md

### R-199 | 2026-03-03 15:00
**Type**: fix
**Tags**: #feature:plugin-system #component:plugin-registry #review
**Request**: "Code review of plugin registration system (commit 629bfee)"
**Result**: Multi-pass review (4 passes: structure, logic, security, integration) found 19 findings (11 high, 6 medium, 2 low). All fixed:
- Security: path traversal prevention, atomic writes, API key leak prevention, prototype pollution guards, name sanitization
- Logic: dedup in scan, null guards, preserve registeredAt, fix trigger scoring, fix color() args
- Structure: extracted deactivateStaleMcpPlugins() from session-start to registry module, hoisted imports, added config schema
- Standards: catch variable naming
**Files**: scripts/flow-plugin-registry.js, scripts/hooks/entry/claude-code/session-start.js, .claude/commands/wogi-start.md, .workflow/config.schema.json

---

### R-198 | 2026-03-03 14:00
**Type**: new
**Tags**: #feature:plugin-system #component:plugin-registry
**Request**: "Build generic plugin registration system for /wogi-start routing"
**Result**: Created plugin registration infrastructure:
- `scripts/flow-plugin-registry.js` — core registry CRUD, MCP discovery, trigger matching, CLI interface
- `.claude/commands/wogi-register.md` — slash command for plugin registration with 5-step discovery flow
- `config.json` — added `plugins` config section (enabled, autoScanOnSessionStart, webSearchFallback)
- `session-start.js` — auto-scans for unregistered MCP servers, deactivates gone servers
- `wogi-start.md` — Step 0.2 plugin routing at triage time with trigger matching
- `claude-md.hbs` — added /wogi-register to Essential Commands, NL Detection, User Commands
**Files**: scripts/flow-plugin-registry.js, .claude/commands/wogi-register.md, .workflow/config.json, scripts/hooks/entry/claude-code/session-start.js, .claude/commands/wogi-start.md, .workflow/templates/claude-md.hbs, .workflow/templates/partials/user-commands.hbs, CLAUDE.md

---

### R-197 | 2026-03-01 13:45
**Type**: new
**Tags**: #skills #prebuilt #freshness #sub-agent #onboarding
**Tasks**: wf-e8548b57, wf-e8548b57-01, wf-e8548b57-02, wf-e8548b57-03, wf-e8548b57-04
**Request**: "Ship pre-built skill templates for top 30 libraries + sub-agent isolation for unknown libraries + documentation freshness tracking"
**Result**: (1) Created 31 pre-built skill templates in templates/skills/ with real patterns, anti-patterns, and conventions for: react, next, vue, angular, svelte, tailwindcss, express, nestjs, fastify, hono, prisma, sequelize, mongoose, drizzle, typeorm, jest, vitest, playwright, cypress, mocha, zod, typescript, graphql, eslint, django, flask, fastapi, sqlalchemy, pytest, docker, terraform. (2) Modified flow-skill-generator.js to check pre-built templates first — copies instantly instead of generating via Context7. Added getPrebuiltSkillPath(), copyPrebuiltSkill(), listPrebuiltSkills(). (3) Updated flow-stack-wizard.js to show pre-built vs generated counts. (4) Added sub-agent isolation docs to wogi-setup-stack.md for unknown library generation. (5) Created flow-skill-freshness.js for documentation freshness tracking with CLI and programmatic API. (6) Integrated freshness alerts into wogi-morning.md briefing template.
**Files**: templates/skills/**/*, scripts/flow-skill-generator.js, scripts/flow-skill-freshness.js, scripts/flow-stack-wizard.js, scripts/flow, .claude/commands/wogi-setup-stack.md, .claude/commands/wogi-morning.md

---

### R-196 | 2026-03-01 12:00
**Type**: fix
**Tags**: #commands #frontmatter #skill-discovery
**Tasks**: wf-e0297540
**Request**: "Add YAML frontmatter with description to all 67 wogi-*.md command files for Skill tool discovery"
**Result**: Added YAML frontmatter with short description field to all 67 .claude/commands/wogi-*.md files. Fixed nested quote issues and unquoted descriptions in 6 pre-existing files. All 67 files validated. Released as v1.6.3.
**Files**: .claude/commands/wogi-*.md (67 files)

---

### R-195 | 2026-02-28 14:45
**Type**: change
**Tags**: #hooks #adapter #claude-code #http-transport #worktree #config-change
**Tasks**: wf-2db50af6, wf-761dade9
**Request**: "Enable WorktreeCreate/WorktreeRemove/ConfigChange hook events and add HTTP hook transport option for Claude Code 2.1.63 compatibility"
**Result**: (1) Added WorktreeCreate, WorktreeRemove, ConfigChange to CLAUDE_CODE_EVENTS array and generateConfig() — all 10 hooks now generated. Entry point scripts already existed. (2) Added buildHookEntry() helper and transportConfig parameter to generateConfig(). HTTP transport emits type:'http' with url/headers/allowedEnvVars. SessionStart forced to 'command' (HTTP not supported). Updated flow-hooks.js caller to pass transport config from config.hooks. Backwards compatible — default is 'command'.
**Files**: scripts/hooks/adapters/claude-code.js, scripts/hooks/adapters/base-adapter.js, scripts/flow-hooks.js

---

### R-194 | 2026-02-27 22:00
**Type**: fix
**Tags**: #security #routing #enforcement #session-continuation
**Task**: wf-2b1ab455
**Request**: "Close Edit/Write routing gate bypass — session continuation loophole. AI bypassed routing after session continuation by editing ready.json directly (exempt from task gate, not covered by routing gate) to create fake tasks."
**Result**: Added Edit, Write, NotebookEdit to routing gate's GATED_TOOLS set in routing-gate.js. Updated pre-tool-use.js routing gate condition to include Edit/Write/NotebookEdit. Added setRoutingPending() call in session-start.js as defense-in-depth. Added explicit "Session Continuation Is NOT Routing Bypass" rule to decisions.md. Updated CLAUDE.md template with stronger post-compaction/continuation language. Regenerated CLAUDE.md.
**Files**: `scripts/hooks/core/routing-gate.js`, `scripts/hooks/entry/claude-code/pre-tool-use.js`, `scripts/hooks/entry/claude-code/session-start.js`, `.workflow/state/decisions.md`, `.workflow/templates/claude-md.hbs`, `CLAUDE.md`

### R-193 | 2026-02-27 21:46
**Type**: fix
**Tags**: #review #security #code-quality #routing #audit
**Task**: wf-cr-a7f201
**Request**: "Fix all 14 review findings from code review of routing gaps + NL review + audit implementation"
**Result**: Fixed 14 findings across 4 files: 4 high (SHA regex blocks HEAD in getFilesBetweenCommits, SESSION_ID path injection in routing-gate, unbounded stdin + raw JSON.parse in stop.js, 5x raw JSON.parse in flow-audit.js), 7 medium (D- score asymmetry, blocklist date validation replaced with allowlist, loadFileContent path traversal, ReDoS from config patterns, raw JSON.parse in routing-gate isRoutingPending and incrementStopAttempts, bare catch block), 3 low (system grep replaced with git grep, misleading stdin comment in score command, ROUTING_FLAG_TTL_MS comment updated).
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/entry/claude-code/stop.js, scripts/flow-review.js, scripts/flow-audit.js

### R-192 | 2026-02-27 23:30
**Type**: new
**Tags**: #workflow #routing #review #audit #enforcement
**Task**: wf-1bd2a207
**Request**: "Fix 5 routing enforcement gaps + enhance /wogi-review with NL scoping + add /wogi-audit"
**Result**: Part A: Fixed 5 routing enforcement gaps (fail-closed error handling in routing-gate.js and pre-tool-use.js, session ID fallback using shared file, counter-based stop enforcement with 3 attempts, fail-closed stop hook). Part B: Added natural language scope resolution to /wogi-review (session-based, feature-based, branch-based, time-based, path-based). Created /wogi-audit command with 7-dimension parallel analysis (architecture, dependencies, duplication, performance, consistency, modernization, tech debt) and weighted health scoring. Updated config.json, templates, and CLAUDE.md.
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/entry/claude-code/stop.js, scripts/flow-review.js, scripts/flow-audit.js, .claude/commands/wogi-review.md, .claude/commands/wogi-audit.md, .workflow/config.json, .workflow/templates/claude-md.hbs, .workflow/templates/partials/user-commands.hbs, CLAUDE.md

### R-191 | 2026-02-27 22:00
**Type**: fix
**Tags**: #review #codebase-review #bugfix #performance #security
**Task**: wf-cr-e13894
**Request**: "Fix all 25 review findings from comprehensive codebase review"
**Result**: Fixed all 25 findings across 14 files: 3 critical (exponentialBackoff ignored, race condition in trackTaskComplete, WASM init on every hook), 8 high (wrong field name in ready.json access, non-atomic writes, renamed config key, redundant getProjectRoot calls, missing caching), 9 medium (DRY violations, non-atomic writes in 3 files, overflow archiving, read-modify-write race, config consolidation), 5 low (regex tightening, stdout pollution, missing config keys, raw JSON.parse security violations).
**Files**: scripts/flow-utils.js, scripts/flow-session-state.js, scripts/flow-parallel.js, scripts/flow-long-input.js, scripts/flow-durable-session.js, scripts/flow-start.js, scripts/flow-cascade.js, scripts/flow-memory-blocks.js, scripts/flow-memory-sync.js, scripts/hooks/core/observation-capture.js, scripts/hooks/core/loop-check.js, scripts/hooks/core/task-gate.js, scripts/hooks/core/task-completed.js, scripts/hooks/core/scope-gate.js

### R-190 | 2026-02-28 22:15
**Type**: new
**Tags**: #workflow #setup #cross-repo
**Task**: wf-a702e434
**Request**: "Set up independent WogiFlow workflows in 3 repos"
**Result**: Installed wogiflow as devDependency in wogiflow-cloud and wogiflow-portal, triggering full postinstall bootstrap. Created tailored config.json, decisions.md, and registry maps for each repo. Cloud: api-map (180+ endpoints), function-map (36 libs), schema-map (22 migrations), service-map. Portal: app-map (6 pages), lightweight config (no lint/typecheck/tests). Generated CLAUDE.md and settings.local.json for both. Updated partner-versions.json across all 3 repos for mutual awareness.
**Files**: (wogiflow-cloud) .workflow/config.json, .workflow/state/*.md, .workflow/state/*.json, CLAUDE.md, .claude/settings.local.json, package.json; (wogiflow-portal) same; (wogi-flow) .workflow/state/partner-versions.json

---

<!-- Entries below. Format: R-001, R-002, etc. -->

### R-189 | 2026-02-28 18:00
**Type**: new
**Tags**: #feature:architecture #rules #decisions #dual-repo #version-awareness
**Task**: wf-c22771dd
**Request**: "Document dual-repo architecture rules and set up cross-repo version awareness"
**Result**: Created formal dual-repo management documentation: (1) `.claude/rules/architecture/dual-repo-management.md` — repo ownership, code separation, version management, interface contracts, change propagation rules, release order, verification checklists. (2) Added "Dual-Repo Architecture" decision to `decisions.md` — independent semver, mutual version awareness, OSS-first release policy. (3) Created `.workflow/state/partner-versions.json` in both wogi-flow and wogiflow-cloud — each repo knows the other's current version, package name, and compatibility range. (4) Documented the public API surface that cloud depends on (exported functions, hook interfaces, state file formats, config keys).
**Files**: `.claude/rules/architecture/dual-repo-management.md`, `.workflow/state/decisions.md`, `.workflow/state/partner-versions.json`, `../wogiflow-cloud/.workflow/state/partner-versions.json`

### R-188 | 2026-02-27 16:00
**Type**: new
**Tags**: #feature:reuse-detection #script:flow-semantic-match #script:flow-standards-checker #script:flow-standards-gate #config
**Request**: "Implement Reuse Detection System — AI-as-Judge + Full Registry Coverage"
**Result**: Replaced score-driven auto-blocking with AI-as-Judge + user choice pattern. Added: (1) schemas/services keyword domains in flow-semantic-match.js. (2) `findReuseCandidates()` with 30% pre-filter threshold. (3) `checkApiDuplication()`, `checkRegistryDuplication()`, `parseSchemaMap()`, `parseServiceMap()`, `parseGenericMap()` in flow-standards-checker.js. (4) `discoverAllRegistries()` with manifest + disk fallback. (5) `collectReuseCandidates()` scans ALL registries. (6) `formatReuseCandidatesForAI()` generates structured AI context in flow-standards-gate.js. (7) Updated config with `aiAsJudge`, `preFilterThreshold`, `allRegistries` keys. (8) Updated wogi-start.md Agent 5 and Step 3.7 for AI-as-Judge flow. Backward compatible: `aiAsJudge: false` reverts to old threshold blocking.
**Files**: scripts/flow-semantic-match.js, scripts/flow-standards-checker.js, scripts/flow-standards-gate.js, .workflow/config.json, .claude/commands/wogi-start.md, .workflow/state/request-log.md

### R-187 | 2026-02-26 18:00
**Type**: fix
**Tags**: #feature:export-import #script:flow-export-profile #script:flow-import-profile #command:wogi-export #command:wogi-import
**Request**: "Review and fix import/export functionality — ensure export captures all generic enforcement artifacts but excludes session-specific data"
**Result**: Comprehensive review found 7 categories of artifacts missing from export/import. Fixed: (1) `.claude/rules/` now exports recursively (was only matching top-level *.md, missing security/, code-style/, architecture/, operations/ subdirs). (2) Added skill definitions export (`.claude/skills/*/skill.md`). (3) Added review agent checklists (`.workflow/agents/`). (4) Added tech stack export (`.claude/docs/stack.md`). (5) Added workflow HBS templates (`.workflow/templates/`). (6) Added story/bug/task templates (`templates/`). (7) Added state init templates (`.workflow/state/*.template`). Removed app-map from `--full` (project-specific). Updated both slash command docs to v3.0.
**Files**: `scripts/flow-export-profile`, `scripts/flow-import-profile`, `.claude/commands/wogi-export.md`, `.claude/commands/wogi-import.md`

### R-186 | 2026-02-27 15:00
**Type**: new
**Tags**: #feature:teams #epic:epic-teams-t4 #phase:T4 #repo:wogiflow-cloud
**Task**: epic-teams-t4
**Request**: "Continue with the next teams phase on the roadmap — T4: Approval Flow"
**Result**: Completed entire T4 epic (6 stories) via `/wogi-bulk` orchestrator. Batch 1: S1 Pattern Aggregation Engine (ae93fa8). Batch 2: S2 Approval Request System (002f876). Batch 3 (parallel): S3 Review Queue Dashboard (53eca72), S4 Promotion Paths (5195f0e), S6 Team Analytics Dashboard (3b3b605). Batch 4: S5 Notification System (d682239). 20+ new files: pattern aggregation engine, approval CRUD (8 endpoints), review queue dashboard, 4 promotion pipelines (correction→decision, pattern→rule, learning→knowledge, team→global), notification system (in-dashboard + AWS SES email), team analytics dashboard (Chart.js, 6 metric endpoints). All on feature/teams-t2 branch in wogiflow-cloud.
**Files**: `packages/server/aggregation/pattern-engine.js`, `packages/server/aggregation/promotion-engine.js`, `packages/server/aggregation/promotions/*.js`, `packages/server/lib/approvals.js`, `packages/server/lib/approval-requests.js`, `packages/server/lib/notifications.js`, `packages/server/lib/email.js`, `packages/server/lib/analytics.js`, `packages/server/routes/approvals.js`, `packages/server/routes/patterns.js`, `packages/server/routes/notifications.js`, `packages/server/routes/analytics.js`, `packages/dashboard/approvals.html`, `packages/dashboard/approvals.js`, `packages/dashboard/analytics.html`, `packages/dashboard/analytics.js`, `packages/dashboard/notifications.js`, `packages/server/db/010_approval_flow.sql`, `packages/server/db/011_approval_comments.sql`, `packages/server/db/013_notifications.sql`

### R-185 | 2026-02-25 15:34
**Type**: new
**Tags**: #feature:workflow #command:wogi-finalize #config #research:superpowers
**Task**: wf-7b6dae6e
**Request**: "Add branch finalization workflow, TDD enforcement, and plugin marketplace to roadmap — from superpowers comparison research"
**Result**: Four actions from superpowers vs WogiFlow research: (1) Enabled TDD enforcement in config (`tdd.enforced: true`, `defaultForTypes: ["bugfix"]`). (2) Created `/wogi-finalize` command — guides merge/PR/discard decision after worktree task completion, with auto-PR generation, squash options, and config-driven behavior. Added natural language detection and config section. (3) Analyzed anti-rationalization blocks — concluded not needed since mechanical hooks already prevent bypass; edge cases manageable. (4) Added plugin marketplace manifest to roadmap Ideas section at low priority.
**Files**: `.claude/commands/wogi-finalize.md`, `.workflow/config.json`, `.workflow/templates/claude-md.hbs`, `CLAUDE.md`, `.workflow/roadmap.md`

### R-184 | 2026-02-26 23:45
**Type**: new
**Tags**: #feature:workflow #component:flow-context-estimator #command:wogi-review-fix #config
**Task**: wf-911123c5
**Request**: "Implement smart auto-compaction for review-fix sessions — dynamic context-aware batching"
**Result**: Added dynamic context-aware batching to review-fix sessions. Extended `flow-context-estimator.js` with finding-level estimation functions: `estimateFindingContextCost()` calculates context per finding based on severity/complexity, `calculateDynamicBatchSize()` packs findings into available context, `createFindingBudget()` splits all findings into sub-agent batches. Updated `wogi-review-fix.md` with "Context-Aware Orchestrated Mode" — when 10+ findings exist, the orchestrator spawns sub-agents with fresh context per batch instead of processing everything in one conversation. Batch sizes are dynamic (not hardcoded), calculated from finding complexity. Progress tracked in state file that survives compaction/interruption. Enabled `smartCompaction` in config and added `contextBudget` config to `reviewFix`. Tested with actual 37 T3 findings → 3 batches of 9/12/16 findings.
**Files**: `scripts/flow-context-estimator.js`, `.claude/commands/wogi-review-fix.md`, `.workflow/config.json`, `.workflow/state/ready.json`, `.workflow/state/pending-skill.json`

### R-183 | 2026-02-26 23:30
**Type**: fix
**Tags**: #feature:teams #security #architecture #component:db #component:cloudformation #component:shared
**Task**: wf-rv-t1sec002, wf-rv-t1infra5, wf-rv-t1refact
**Request**: "Fix 3 remaining review findings from T1 review"
**Result**: (1) SSL cert verification: enabled rejectUnauthorized by default, configurable via DB_SSL_REJECT_UNAUTHORIZED env var. (2) VPC migration: full VPC with private subnets, NAT Gateway, VPC endpoints, 11 Lambdas in VPC, DB restricted to Lambda SG only (was 0.0.0.0/0). (3) Shared utilities: created lib/shared.js with parseJsonBody, getClientIp, getSecretCached — 81 duplications removed across 20 files. 370 tests passing.
**Files**: `packages/server/lib/db.js`, `deploy/cloudformation.yaml`, `packages/server/lib/shared.js` (new), 20+ route/lib files refactored

### R-182 | 2026-02-26 22:00
**Type**: new
**Tags**: #feature:teams #epic:epic-teams-t3 #component:team-rules #component:templates #component:knowledge #component:integrations #component:jira #component:github
**Task**: epic-teams-t3 (wf-a01e3149, wf-9eb7323a, wf-8203b06b, wf-2d0af595, wf-98c1c0b2, wf-e8d21b8e)
**Request**: "Plan and implement T3: Team Knowledge + Integrations phase from the roadmap"
**Result**: Implemented all 6 stories of Phase T3 in wogiflow-cloud repo. S1: Team Rules CRUD with rule cascade (enforced/overridable), category management, sync status. S2: Team Templates system with export/apply/versioning/defaults. S3: Knowledge Sharing with model learnings, skill learnings, model profiles, shared configs, session hooks for push/pull. S4: Integration Framework with BaseAdapter pattern, AES-256-GCM credential encryption, HMAC-SHA256 webhook verification, adapter registry. S5: Jira Integration with OAuth 2.0 3LO, webhook handling, bidirectional sync, description-to-AC parsing (5 strategies), configurable field mapping. S6: GitHub Integration with OAuth, issues/PRs/push webhook handling, PR linking, commit attribution, label-to-priority mapping. 4 DB migrations (005-008), 39 new files total, 370 tests passing.
**Files**: `packages/server/db/005_team_rules.sql`, `006_team_templates.sql`, `007_integrations.sql`, `008_knowledge.sql`, `packages/server/lib/team-rules.js`, `templates.js`, `integrations.js`, `knowledge-sync.js`, `packages/server/routes/team-rules.js`, `templates.js`, `integrations.js`, `webhooks.js`, `team-knowledge.js`, `packages/server/integrations/base-adapter.js`, `index.js`, `jira-adapter.js`, `jira-field-mapper.js`, `github-adapter.js`, `github-field-mapper.js`, `packages/client/flow-team-templates.js`, `lib/knowledge-client.js`, `hooks/task-completed-cloud.js`, `packages/dashboard/team-rules.html`, `team-rules.js`, `templates.html`, `templates.js`, `integrations.html`, `integrations.js`, `knowledge.html`, `knowledge.js`, `jira-config.html`, `jira-config.js`, `github-config.html`, `github-config.js`, `packages/server/tests/unit/integrations.test.js` (modified: `validate.js`, `teams.js`, `session-start-cloud.js`, `session-end-cloud.js`, `index.html`, `cloudformation.yaml`)

### R-181 | 2026-02-26 14:00
**Type**: new
**Tags**: #feature:workflow #component:longInputGate #component:installer #component:upgrader #component:wogi-start
**Task**: wf-07b0059a
**Request**: "Enable longInputGate by default and add auto-routing"
**Result**: Enabled longInputGate as default for all installs (enabled: true, lineThreshold: 60). Added longInputGate section to installer.js configContent so fresh installs get it. Added upgrade migration in upgrader.js that flips enabled: false → true for existing installs. Updated this project's config.json. Added Step 0.1 "Long Input Detection" to wogi-start.md that auto-invokes /wogi-extract-review when prompt exceeds 60 lines.
**Files**: `lib/installer.js`, `lib/upgrader.js`, `.workflow/config.json`, `.claude/commands/wogi-start.md`, `CLAUDE.md` (regenerated)

### R-180 | 2026-02-25 16:00
**Type**: fix
**Tags**: #feature:workflow #component:routing-gate #component:implementation-gate #component:stop-hook #component:claude-md
**Task**: wf-fa82f23d
**Request**: "Harden routing enforcement — close post-compaction bypass gap"
**Result**: Closed the gap where AI could bypass mandatory /wogi-start routing after context compaction by responding from compressed memory without calling any tools. Implemented 4 hardening layers: (1) Hardened generateRoutingContext() in implementation-gate.js with explicit post-compaction warning and stronger "STOP" messaging, (2) Added compaction routing anchor to wogi-compact.md so routing instruction survives context compression, (3) Added routing enforcement to Stop hook — if AI tries to stop with routing-pending flag still set, it's caught and forced to route through /wogi-start, (4) Added "Post-Compaction Routing (CRITICAL)" section to claude-md.hbs template and regenerated CLAUDE.md. Full verification chain confirmed: no race conditions, no infinite loops, session-isolated flags.
**Files**: `scripts/hooks/core/implementation-gate.js`, `scripts/hooks/entry/claude-code/stop.js`, `.claude/commands/wogi-compact.md`, `.workflow/templates/claude-md.hbs`, `CLAUDE.md` (regenerated), `.workflow/state/ready.json`

### R-177 | 2026-02-26 04:00
**Type**: new
**Tags**: #feature:teams #component:auth #component:oauth #component:device-auth #component:teams #component:projects #infra:cloudformation
**Task**: wf-b2532240
**Request**: "Phase T1: Teams Foundation — OAuth, teams, CLI device auth"
**Result**: Built the full Teams Foundation in wogiflow-cloud on feature/teams-t1 branch. Created 003_teams.sql DB migration with 8 tables (users, teams, team_members, projects, refresh_tokens, oauth_state, device_codes, audit_log). Implemented JWT auth (RS256, 15min TTL) + opaque refresh tokens (30 days, rotated on use). Added GitHub and Google OAuth 2.0 flows with one-time state tokens. Implemented RFC 8628 Device Authorization Grant for CLI auth with rate limiting. Built Teams CRUD with role hierarchy (owner>admin>member>viewer) and Projects CRUD with per-team slug uniqueness. Updated CloudFormation with 4 new Lambda functions, API routes, and 3 secrets. Created dashboard login.html and device.html pages. 150 unit tests passing.
**Files**: `packages/server/db/003_teams.sql` (new), `packages/server/lib/auth.js` (new), `packages/server/lib/oauth.js` (new), `packages/server/lib/device-auth.js` (new), `packages/server/lib/teams.js` (new), `packages/server/routes/auth.js` (new), `packages/server/routes/device-auth.js` (new), `packages/server/routes/teams.js` (new), `packages/server/routes/projects.js` (new), `packages/server/lib/validate.js`, `packages/server/package.json`, `deploy/cloudformation.yaml`, `packages/dashboard/login.html` (new), `packages/dashboard/device.html` (new), `packages/server/tests/unit/auth.test.js` (new), `packages/server/tests/unit/device-auth.test.js` (new), `packages/server/tests/unit/teams.test.js` (new), `packages/server/tests/unit/validate-teams.test.js` (new)

### R-176 | 2026-02-26 00:00
**Type**: new
**Tags**: #feature:community #component:pipeline-worker #component:admin-api #component:embeddings #component:github-api
**Task**: wf-e50c90c7
**Request**: "Phase C2 Server-Side — pgvector dedup, priority detection, GitHub issues"
**Result**: Replaced Haiku text-based dedup with pgvector cosine similarity in pipeline-worker.js (thresholds: >0.92 exact dup, 0.75-0.92 near match, <0.75 new). Added embedding generation via OpenAI text-embedding-3-small at intake, promotion, and consolidation stages. Added suggestion dedup (>0.85 similarity merges, increments vote_count). Added priority detection (10+ votes auto-flags priority_flagged column). Added GitHub issue auto-creation on suggestion accept via lib/github.js. Added /api/admin/priority endpoint. Created db/002_pgvector_indexes.sql with HNSW indexes on all 3 tables. Added GitHubToken secret to CloudFormation.
**Files**: `packages/server/curation/pipeline-worker.js`, `packages/server/routes/admin.js`, `packages/server/lib/embeddings.js` (new), `packages/server/lib/github.js` (new), `packages/server/db/002_pgvector_indexes.sql` (new), `deploy/cloudformation.yaml`

### R-175 | 2026-02-25 17:00
**Type**: fix
**Tags**: #feature:security #feature:community #component:flow-community #component:flow-script-resolver #component:extension-registry #component:session-start #component:flow-regression
**Task**: wf-cr-b25f16
**Request**: "Fix 20 review findings from v1.5.13 multi-pass code review"
**Result**: Fixed 15 of 20 findings across 5 files. Security: replaced all raw JSON.parse with safeJsonParseString (prototype pollution), added SSRF protection (isAllowedServerUrl blocking RFC-1918/link-local), added HTTP response body size limit (512KB), added PII stripping to suggestions, fixed script resolver config override validation to check ALL tokens, added extension name regex validation. Logic: fixed mergeModelIntelligence empty-detail bug and insert-point -1 bug, added 500-char cap on inbound community data. Integration: wired pullOnSessionStart config toggle. Structure: removed unused getConfig import, memoized getWogiFlowVersion. Deferred 5 findings: pushOnSessionEnd unwired (separate scope), blocking await (intentional), retry duplicates (low impact), file decomposition (structural refactor), anonymousId config cleanup (harmless).
**Files**: `scripts/flow-community.js`, `scripts/flow-script-resolver.js`, `scripts/hooks/core/extension-registry.js`, `scripts/hooks/entry/claude-code/session-start.js`, `scripts/flow-regression.js`

### R-174 | 2026-02-25 12:15
**Type**: new
**Tags**: #feature:script-resolver #component:flow-script-resolver #hook:session-start
**Task**: wf-f837a262
**Request**: "Add centralized script resolver to replace hardcoded npm/npx commands"
**Result**: Created flow-script-resolver.js utility that auto-detects package manager from lockfiles and resolves script names from package.json with alias matching (e.g., typecheck → type-check). Replaced hardcoded npm/npx commands in 7 flow scripts (task-enforcer, spec-generator, orchestrate, verify, step-coverage, regression, start). Added scripts config section to config.json with null defaults for auto-detection. Added session-start drift detection that warns when expected scripts are missing. Updated installer to ship resolver-compatible config to new projects.
**Files**: scripts/flow-script-resolver.js (new), scripts/flow-task-enforcer.js, scripts/flow-spec-generator.js, scripts/flow-orchestrate.js, scripts/flow-verify.js, scripts/flow-step-coverage.js, scripts/flow-regression.js, scripts/flow-start.js, scripts/hooks/entry/claude-code/session-start.js, .workflow/config.json, lib/installer.js

### R-173 | 2026-02-25 02:30
**Type**: new
**Tags**: #feature:community #component:flow-community #hook:session-start
**Task**: wf-ec88195b
**Request**: "Phase C2 Client-Side — Community Knowledge Local Surfacing"
**Result**: Added community knowledge merge system — pulled knowledge is now merged into local model adapters (Community Learnings section), adaptive-learning.json (communityStrategies key), and feedback-patterns.md (community- prefixed informational entries). Idempotent merging prevents duplicates. Session-start hook calls merge after pull.
**Files**: scripts/flow-community.js, scripts/hooks/entry/claude-code/session-start.js

### R-172 | 2026-02-25 01:15
**Type**: new
**Tags**: #feature:teams-extension #component:extension-registry #hook:postinstall
**Task**: wf-dcf132cb
**Request**: "Free Package Extension Points — Enable Teams Hook Integration"
**Result**: Added minimal extension points for @wogiflow/teams: extension registry in core hooks, Teams package detection in postinstall, team config section with schema, verified all state reader functions exported.
**Files**: scripts/hooks/core/extension-registry.js (new), scripts/hooks/core/index.js, scripts/postinstall.js, lib/installer.js, .workflow/config.json, .workflow/config.schema.json

### R-171 | 2026-02-25 00:30
**Type**: new
**Tags**: #feature:community #component:flow-community #command:wogi-suggest
**Task**: wf-0c000481
**Request**: "Community Knowledge System — Phase C1 Client-Side Foundation"
**Result**: Implemented client-side foundation for anonymous community knowledge sharing. Created flow-community.js with 9 exports (collectShareableData, stripPII, pushToServer, pullFromServer, getOrCreateAnonId, submitSuggestion, retryPendingSuggestions, loadCommunityCache, saveCommunityCache). Created /wogi-suggest slash command. Integrated community pull into session-start hook and community push into /wogi-session-end command. Added community config section to config.json, config.schema.json, and installer.js. Updated NLD table and CLAUDE.md with wogi-suggest. All operations fire-and-forget with 5s timeout, PII-stripped, opt-in only.
**Files**: scripts/flow-community.js (new), .claude/commands/wogi-suggest.md (new), .workflow/config.json, .workflow/config.schema.json, lib/installer.js, scripts/hooks/entry/claude-code/session-start.js, scripts/hooks/core/session-context.js, .claude/commands/wogi-session-end.md, .workflow/templates/claude-md.hbs, CLAUDE.md

### R-170 | 2026-02-24 19:00
**Type**: fix
**Tags**: #feature:hooks #component:claude-code-adapter #bug:wf-3f291f2d
**Task**: wf-3f291f2d
**Request**: "Fix invalid hook keys (Setup, TaskCompleted, TeammateIdle, ConfigChange) in Claude Code settings"
**Result**: Removed 4 invalid hook event registrations from claude-code adapter. Added CLAUDE_CODE_EVENTS allowlist limited to 6 official hooks (SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionEnd). Added safety filter in generateConfig() that validates all hooks against the allowlist before output. Cleaned local settings.local.json. Entry scripts kept for future use.
**Files**: scripts/hooks/adapters/claude-code.js, .claude/settings.local.json

### R-169 | 2026-02-24 18:55
**Type**: new
**Tags**: #feature:community #testing:unit #testing:smoke #server:wogiflow-cloud
**Task**: wf-ebb51efe
**Request**: "Build and run comprehensive tests for wogiflow-cloud server"
**Result**: Created test suite with 52 unit tests (extractJson, validate, response) and 12 live smoke tests against api.wogi.ai. All 64 tests pass. Zero additional dependencies — uses node:test and node:assert.
**Files** (wogiflow-cloud repo):
- `packages/server/tests/unit/extract-json.test.js` (created — 13 tests)
- `packages/server/tests/unit/validate.test.js` (created — 26 tests covering contributions + suggestions)
- `packages/server/tests/unit/response.test.js` (created — 13 tests)
- `packages/server/tests/smoke.js` (created — 12 live endpoint tests)
- `packages/server/package.json` (modified — added test script)
- `packages/server/curation/pipeline-worker.js` (modified — exported extractJson)

### R-168 | 2026-02-24 18:10
**Type**: fix
**Tags**: #feature:workflow #hook:routing-gate #security:enforcement
**Task**: wf-19b06f22
**Request**: "Extend routing gate hook to block Read/Glob/Grep before wogi-* routing — close enforcement gap"
**Result**: Fixed enforcement gap where Read/Glob/Grep tools could bypass the routing gate. Updated 5 files: settings.local.json (PreToolUse matcher), settings.json (template matcher), routing-gate.js (GATED_TOOLS set + block message), pre-tool-use.js (condition expansion), claude-code.js adapter (matcher string). Also fixed dead-letter issue where EnterPlanMode was in GATED_TOOLS but missing from settings.local.json matcher.
**Files**: .claude/settings.local.json, .claude/settings.json, scripts/hooks/core/routing-gate.js, scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/adapters/claude-code.js

### R-167 | 2026-02-24 09:35
**Type**: fix
**Tags**: #feature:community #infra:aws #project:wogiflow-cloud #security #review
**Task**: wogiflow-cloud code review fixes
**Request**: "Fix all 28 review findings from /wogi-review on wogiflow-cloud server"
**Result**: Fixed 18 of 28 findings across 10 files. Key changes: shared response.js helper with X-Content-Type-Options (DRY), credential cache TTL (15min) for rotation support, fail-closed pipeline (parse errors reject/archive), atomic idempotent SQS claim, double-settle prevention in HTTP client, tightened UUID regex, ISO 8601 date validation, health check Lambda + DLQ alarm + API throttling in CloudFormation. 10 findings deferred as TODOs (RDS public access, API auth, SSL cert, CORS, pagination). All endpoints tested and verified. CloudFormation stack updated successfully.
**Files**: wogiflow-cloud/packages/server/ (lib/response.js NEW, lib/db.js, lib/anthropic.js, lib/validate.js, routes/contribute.js, routes/knowledge.js, routes/suggest.js, curation/pipeline-worker.js), wogiflow-cloud/deploy/ (deploy.sh, cloudformation.yaml)

### R-166 | 2026-02-24 08:55
**Type**: new
**Tags**: #feature:community #infra:aws #project:wogiflow-cloud
**Task**: Phase C1 Server Deployment
**Request**: "Deploy WogiFlow Cloud server infrastructure to AWS"
**Result**: Deployed full serverless infrastructure to AWS eu-west-1: RDS PostgreSQL 16.6 (db.t4g.micro) with pgvector, 4 Lambda functions (contribute, knowledge, suggest, pipeline-worker), API Gateway HTTP with custom domain api.wogi.ai, SQS FIFO queue with DLQ, Secrets Manager for credentials. Fixed 5 bugs during deployment: RDS SSL cert validation, prototype pollution false positive, Sonnet model ID (20250514→20250929), curation_log CHECK constraint, and AI response JSON parsing. Full 5-stage AI curation pipeline verified end-to-end — test contribution auto-promoted to Global Knowledge with quality score 7.5.
**Files**: wogiflow-cloud/packages/server/ (lib/db.js, lib/anthropic.js, lib/validate.js, routes/*.js, curation/pipeline-worker.js), wogiflow-cloud/deploy/ (cloudformation.yaml, deploy.sh, migrate.sh), wogiflow-cloud/packages/server/db/001_community.sql

### R-165 | 2026-02-24 10:00
**Type**: change
**Tags**: #feature:security #component:claude-bridge #component:settings-local
**Task**: wf-6c8d7b3e
**Request**: "Tighten wildcard permission rules in settings template"
**Result**: Replaced broad `git reset *` and `git restore *` wildcards with scoped safe variants (`git reset HEAD *`, `git reset --soft *`, `git restore --staged *`). Destructive operations (--hard, restore ., clean -f) now require manual user approval. Updated security-patterns.md section 6 with new examples. Updated local settings.local.json to match.
**Files**: .workflow/bridges/claude-bridge.js, .claude/settings.local.json, .claude/rules/security/security-patterns.md

### R-164 | 2026-02-24 00:30
**Type**: fix
**Tags**: #feature:review #command:guided-edit #command:triage #command:extract-review
**Task**: wf-2de507ce
**Request**: "Fix 10 review findings from wf-dff7f8ec audit"
**Result**: Fixed all 10 findings: (1-2) Replaced invalid task ID prefixes wf-ge-/wf-tr- with proper generateTaskId() calls, (3) Added abort handling to guided-edit, (4) Added empty fix queue guard to triage, (5-6) Added missing task schema fields (status/priority/createdAt/startedAt), (7) Expanded validation matrix to cover .ts/.tsx/.json, (8) Made step 6 conditional on invocation context, (9) Scoped standalone task check to guided-edit feature, (10) Elevated scope note to top of extract-review.
**Files**: .claude/commands/wogi-guided-edit.md, .claude/commands/wogi-triage.md, .claude/commands/wogi-extract-review.md

### R-163 | 2026-02-23 23:00
**Type**: change
**Tags**: #feature:workflow #command:guided-edit #command:triage #command:extract-review
**Task**: wf-dff7f8ec
**Request**: "Audit & fix all wogi-* command flows for workflow integration"
**Result**: Audited all 61 wogi-* command files across 3 tiers. Found 0 dead script references (847+ references validated). Fixed 2 workflow violations: (1) wogi-guided-edit.md — added task gating and post-edit validation requirements, (2) wogi-triage.md — added mandatory task creation before fix execution. Clarified wogi-extract-review.md task conversion flow. Verified routing table completeness (all commands routable via NLD or wogi-start catalog). Confirmed pattern consistency (no old terminology). ARGUMENTS placement correct in all files.
**Files**: .claude/commands/wogi-guided-edit.md, .claude/commands/wogi-triage.md, .claude/commands/wogi-extract-review.md

### R-162 | 2026-02-23 22:00
**Type**: change
**Tags**: #feature:hybrid #command:hybrid #command:hybrid-setup #command:hybrid-status #command:hybrid-edit #command:hybrid-off
**Task**: wf-dc55c22b
**Request**: "Overhaul wogi-hybrid — multi-model routing, cloud model support, workflow integration"
**Result**: Fixed crash bug in flow-hybrid-detect.js (e→err). Rewrote all 5 hybrid commands to frame hybrid as multi-model execution (local LLMs + cloud models). Removed 4 non-existent script references. Added smart model routing table to config.json (cheapest/mid-tier/planner tiers). Implemented wogi-hybrid-edit.md with plan viewing/editing. Added workflow integration docs (phase gating, explore, standards). Added 4 hybrid decision rules to decisions.md (when to use, model selection, failure escalation, security).
**Files**: scripts/flow-hybrid-detect.js, .claude/commands/wogi-hybrid.md, .claude/commands/wogi-hybrid-setup.md, .claude/commands/wogi-hybrid-status.md, .claude/commands/wogi-hybrid-edit.md, .claude/commands/wogi-hybrid-off.md, .workflow/state/decisions.md, .workflow/config.json

### R-161 | 2026-02-23 21:00
**Type**: new
**Tags**: #feature:workflow #hook:phase-gate #hook:pre-tool-use #template:claude-md
**Task**: wf-b9f5b675
**Request**: "State machine workflow enforcement — replace prompt-based enforcement with programmatic hook-based phase gating, strip CLAUDE.md bloat, add just-in-time context injection"
**Result**: Created phase-gate state machine (7 phases: idle→routing→exploring→spec_review→coding→validating→completing→idle). Integrated into PreToolUse hook to block Edit/Write/Bash based on current phase. Added UserPromptSubmit context injection, session-start stale phase cleanup, task-completed phase reset. Stripped CLAUDE.md from 1,073 to 348 lines (68% reduction) via template rewrite. Added flow-phase.js CLI wrapper and phase transition table in wogi-start.md.
**Files**: scripts/hooks/core/phase-gate.js (new), scripts/flow-phase.js (new), scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/entry/claude-code/user-prompt-submit.js, scripts/hooks/entry/claude-code/session-start.js, scripts/hooks/core/task-completed.js, scripts/hooks/adapters/claude-code.js, .workflow/templates/claude-md.hbs, .workflow/templates/partials/user-commands.hbs, .workflow/templates/partials/auto-features.hbs, CLAUDE.md, .workflow/config.json, .claude/commands/wogi-start.md

### R-160 | 2026-02-23 15:30
**Type**: new
**Tags**: #feature:workflow #command:wogi-start #triage:conversation
**Task**: wf-12a93915
**Request**: "Add conversation mode to wogi-start triage — open-ended discussion with no side effects"
**Result**: Added Conversation classification to /wogi-start triage. Detection signals for brainstorming, explaining, exploring ideas. Behavior rules: read-only tools allowed, no file writes, no task creation, no guilt messaging. Natural exit when user says "let's build it". Updated template, CLAUDE.md, and command flowcharts.
**Files**: .claude/commands/wogi-start.md, .workflow/templates/claude-md.hbs, .claude/docs/knowledge-base/02-task-execution/command-flowcharts.md, CLAUDE.md

### R-159 | 2026-02-23 10:00
**Type**: fix
**Tags**: #feature:routing #hook:pre-tool-use #hook:routing-gate
**Task**: wf-routing-v2
**Request**: "Fix WogiFlow routing bypass — Claude Code enters plan mode instead of routing through /wogi-start"
**Result**: Added EnterPlanMode to routing gate (core + entry + adapter matcher), expanded installer fallback CLAUDE.md with Task Gating section, added hook integrity health checks (matcher freshness, script existence, CLAUDE.md routing content)
**Files**: scripts/hooks/core/routing-gate.js, scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/adapters/claude-code.js, lib/installer.js, scripts/flow-health.js, package.json

### R-158 | 2026-02-22 20:30
**Type**: fix
**Tags**: #workflow #security #review-findings #stale-arguments #P0
**Task**: wf-cr-7f42a1
**Request**: "Fix 42 review findings AND fix stale skill ARGUMENTS persistence bug"
**Result**: Fixed 35+ review findings across 15 files. Key fixes: (1) Prototype pollution protection in readJson/getConfig/getRawConfig via checkForDangerousKeys, (2) TOCTOU race in routing-gate clearRoutingPending, (3) TTL staleness check for routing flag, (4) String-type task normalization in task-completed hook, (5) Path traversal prevention in all registry scanners, (6) ReDoS prevention in Prisma regex, (7) N+1 file read caching in TypeORM entities and package.json, (8) All catch variable naming standardized to err, (9) Raw JSON.parse replaced with readJson/safeJsonParse throughout, (10) Stale ARGUMENTS persistence bug fixed — removed scope from completedSkills output, added explicit stale ARGUMENTS warning in session context, (11) Bounded request-log read in session-context, (12) Lazy registry list computation in worktree-lifecycle, (13) Active flag in registry manifest.
**Files**: scripts/flow-utils.js, scripts/hooks/core/routing-gate.js, scripts/hooks/core/task-completed.js, scripts/hooks/core/session-context.js, scripts/hooks/core/worktree-lifecycle.js, scripts/flow-checkpoint.js, scripts/flow-health.js, scripts/registries/schema-registry.js, scripts/registries/service-registry.js, scripts/flow-task-enforcer.js, scripts/flow-config-set.js, scripts/flow-failure-learning.js, scripts/flow-context-estimator.js, scripts/flow-peer-review.js, scripts/flow-registry-manager.js

### R-157 | 2026-02-22 17:15
**Type**: new
**Tags**: #workflow #hooks #routing-gate #enforcement #P0
**Task**: wf-2c28480c
**Request**: "Add routing gate hook — programmatic enforcement that blocks Bash/tool calls before a /wogi-* command has been invoked"
**Result**: Created routing gate hook that programmatically blocks Bash calls before routing through /wogi-* commands. UserPromptSubmit sets .routing-pending flag (skipped when active task exists). PreToolUse blocks Bash if flag is set, clears flag on any Skill(wogi-*) invocation. Fail-open design with config toggle. Prevents AI from bypassing mandatory routing rule.
**Files**: scripts/hooks/core/routing-gate.js (CREATE), scripts/hooks/entry/claude-code/user-prompt-submit.js, scripts/hooks/entry/claude-code/pre-tool-use.js, .workflow/config.json

### R-156 | 2026-02-22 16:35
**Type**: fix
**Tags**: #workflow #skills #session-context #re-execution #P0
**Task**: wf-a3c1e8b2
**Request**: "Fix skill re-execution bug — prevent stale session reminders from re-triggering one-time skills like /wogi-review"
**Result**: Fixed critical bug where Claude Code re-injects invoked skills with original ARGUMENTS after context compaction, causing expensive one-time actions (/wogi-review) to re-execute after every task. Three-part fix: (1) session-context.js detects completed reviews from last-review.json and injects "DO NOT re-execute" counter-instruction, (2) wogi-review.md gets ONE-TIME EXECUTION marker, (3) wogi-review-fix.md gets ONE-TIME EXECUTION marker. Root cause: Claude Code's session tracking persists skill invocations with ARGUMENTS in system-reminders — WogiFlow cannot control this behavior, so it mitigates with counter-instructions.
**Files**: scripts/hooks/core/session-context.js, .claude/commands/wogi-review.md, .claude/commands/wogi-review-fix.md

### R-155 | 2026-02-22 09:42
**Type**: fix
**Tags**: #review #security #registry #safeJsonParse #fix
**Task**: wf-cr-3day22
**Request**: "Fix 15 review findings from 3-day comprehensive review"
**Result**: Fixed 10 of 15 findings (3 critical, 4 high, 3 medium). C1: removed wrong activatePlugins() args in task-completed.js. C2+H4: deduplicated getActiveRegistries() — single source of truth in flow-utils.js. C3: regenerated registry-manifest.json with all 5 registries. H1-H3: replaced raw JSON.parse with safeJsonParse in schema-registry, service-registry, and flow-skill-generator. H5: cached getActiveRegistries() in flow-section-index.js. H7: fixed version type mismatch in installer.js. M1: added debug logging to empty catch in flow-consistency-check.js. M2: added path traversal guard in service-registry.js. 5 findings deferred (M3: regex non-regression, M4/M5/H6: low-impact, already handled by try-catch).
**Files**: scripts/hooks/core/task-completed.js, scripts/flow-registry-manager.js, scripts/flow-utils.js, scripts/registries/schema-registry.js, scripts/registries/service-registry.js, scripts/flow-skill-generator.js, scripts/flow-section-index.js, scripts/flow-consistency-check.js, lib/installer.js, .workflow/state/registry-manifest.json

### R-154 | 2026-02-22 14:30
**Type**: refactor
**Tags**: #scanner #registry #manifest #wiring #dynamic-discovery
**Task**: wf-927db36d
**Request**: "Registry Manifest Wiring — migrate all 46+ consuming systems to dynamic registry discovery"
**Result**: Migrated 10 consuming files from hardcoded registry references to dynamic discovery via `getActiveRegistries()`, `getRegistryPaths()`, and `getRegistryMapFiles()` from flow-utils.js. Layer 1 (Foundation): flow-utils.js — added 3 central functions reading registry-manifest.json with fallback to 3 defaults. Layer 4 (Quality): flow-health.js (dynamic required files), flow-context-monitor.js (dynamic context breakdown), flow-section-index.js (dynamic index generation + change detection + stats), flow-consistency-check.js (generic table parser for additional registries + orphan detection), flow-standards-checker.js (dynamic STANDARDS_FILES). Layer 5 (Hooks): worktree-lifecycle.js (dynamic essential state files), task-completed.js (RegistryManager.scanAll() replaces hardcoded scanners). Layer 6 (Templates): claude-md.hbs + auto-features.hbs (updated references to all active registries, added schema-map/service-map/registry-manifest to file locations). Layer 7 (Misc): flow-checkpoint.js (dynamic state snapshots). Also updated lib/installer.js to generate initial registry-manifest.json during install. Regenerated CLAUDE.md. All backwards-compatible with try/catch fallbacks.
**Files**: scripts/flow-utils.js, scripts/flow-health.js, scripts/flow-context-monitor.js, scripts/flow-section-index.js, scripts/flow-consistency-check.js, scripts/flow-standards-checker.js, scripts/flow-checkpoint.js, scripts/hooks/core/worktree-lifecycle.js, scripts/hooks/core/task-completed.js, lib/installer.js, .workflow/templates/claude-md.hbs, .workflow/templates/partials/auto-features.hbs, CLAUDE.md

### R-153 | 2026-02-22 12:30
**Type**: new
**Tags**: #scanner #registry #service #nestjs #express #django #go
**Task**: wf-c7a3804f
**Request**: "Architecture/Service Registry Plugin — NestJS, Django, Go service/controller detection"
**Result**: Created ServiceRegistry plugin extending RegistryPlugin. Implements 4 framework scanners: (1) NestJS — parses @Controller, @Get/@Post/@Put/@Patch/@Delete, @Injectable, @Module, @UseGuards decorators; extracts route prefixes, methods, DI dependencies, module imports/exports. (2) Express/Fastify — detects router.get/post/etc and app.get/post/etc patterns plus middleware exports. (3) Django — detects ViewSet, APIView, View, Serializer classes with inheritance parsing. (4) Go — detects HTTP handler functions and HandleFunc registrations. Produces service-map.md (Controllers, Services, Middleware, Modules tables) and service-index.json. Auto-activates when backend framework detected in stack or package.json. Prune removes deleted service files. Already in ALLOWED_REGISTRY_FILES allowlist.
**Files**: scripts/registries/service-registry.js (new)

### R-152 | 2026-02-22 12:00
**Type**: new
**Tags**: #scanner #registry #schema #prisma #typeorm #database
**Task**: wf-65ea1bdb
**Request**: "Schema/Model Registry Plugin — Prisma, TypeORM, Django model detection"
**Result**: Created SchemaRegistry plugin extending RegistryPlugin. Prisma scanner handles both multi-file (prismaSchemaFolder) and single-file schemas. Parses model/enum blocks, @relation directives, @@index/@@unique, datasource provider, and previewFeatures from generator blocks. TypeORM scanner detects @Entity classes, parses @Column fields and @OneToMany/@ManyToOne/@OneToOne/@ManyToMany relations. Produces schema-map.md (Models table with fields/relations/indexes + Enums table + metadata) and schema-index.json. Auto-activates when ORM detected via stack.orm, package.json (prisma, typeorm, drizzle-orm, sequelize, mongoose), or manage.py. Prune removes entries for deleted schema files. Already in ALLOWED_REGISTRY_FILES allowlist.
**Files**: scripts/registries/schema-registry.js (new)

### R-151 | 2026-02-22 11:00
**Type**: fix
**Tags**: #workflow #conventions #task-ids #system-level #code-prevention
**Task**: wf-4346ab1a
**Request**: "Fix stale task cleanup, move naming convention to system-level, add code-level prevention for descriptive task IDs"
**Result**: Three fixes: (1) Fixed epics.json cross-references — renamed wf-schema-registry→wf-65ea1bdb, wf-service-registry→wf-c7a3804f. Root cause analysis: /wogi-review is stateless (no idempotency check) which allowed 3-day review to be re-attempted. (2) Added Task ID Format rule to claude-md.hbs template — now ships with every WogiFlow installation as a system-level rule, not just per-project decisions.md. Regenerated CLAUDE.md. (3) Added code-level prevention: validateReadyDataIds() in saveReadyData()/saveReadyDataAsync() rejects descriptive IDs at write time; fixed flow-tech-debt.js wf-debt- prefix to use generateTaskId(); replaced flow-long-input-stories.js local generateWorkflowId() with canonical generateTaskId(); tightened permissive isValidTaskId() regex in flow-context-estimator.js and flow-peer-review.js from /[a-zA-Z0-9_-]+/ to strict /wf-[a-f0-9]{8}/ format.
**Files**: .workflow/state/epics.json, .workflow/templates/claude-md.hbs, CLAUDE.md, scripts/flow-utils.js, scripts/flow-tech-debt.js, scripts/flow-long-input-stories.js, scripts/flow-context-estimator.js, scripts/flow-peer-review.js

### R-150 | 2026-02-22 10:00
**Type**: fix
**Tags**: #workflow #conventions #task-ids #naming
**Task**: wf-7129cf56
**Request**: "Enforce task ID naming convention — rename descriptive IDs to hash format, add validation rules, prevent workflow bypass"
**Result**: (1) Renamed 4 descriptive task IDs to proper hash format: wf-skill-overhaul→wf-ebc4759e, wf-manifest-wiring→wf-927db36d, wf-schema-registry→wf-65ea1bdb, wf-service-registry→wf-c7a3804f. Updated ready.json IDs, specPaths, and dependsOn references. Renamed 4 spec .md files. Added "Formerly" comments to all 4 files. (2) Added "Task ID Naming Convention" rule to decisions.md — all IDs must use generateTaskId(), never manual descriptive names. (3) Added "Mandatory Workflow Routing" rule to decisions.md — zero exemptions for routing through /wogi-* commands. (4) Added feedback patterns for both violations (descriptive-task-ids: 20+ count, PROMOTED; workflow-bypass-research: 1, PROMOTED by user escalation).
**Files**: .workflow/state/ready.json, .workflow/changes/wf-ebc4759e.md, .workflow/changes/wf-927db36d.md, .workflow/changes/wf-65ea1bdb.md, .workflow/changes/wf-c7a3804f.md, .workflow/state/decisions.md, .workflow/state/feedback-patterns.md

### R-149 | 2026-02-22 09:00
**Type**: refactor
**Tags**: #skills #consolidation #deduplication
**Task**: wf-skill-consolidate
**Request**: "Consolidate skill scripts — delete deprecated creator, deduplicate utilities, unify discovery"
**Result**: 4 consolidation changes: (1) Deleted flow-skill-creator.js (572 lines, deprecated) and rerouted CLI `flow skill detect/list` to flow-skill-matcher.js. (2) Deduplicated ensureDir() in flow-skill-generator.js and flow-memory-db.js — now import from flow-file-ops.js. (3) Replaced local discoverSkills()/parseSkillMd() in flow-skill-learn.js (74 lines) with thin adapter over flow-skill-matcher.js getAllSkills(). (4) Replaced local listSkills() in flow-skill-create.js (42 lines) with getAllSkills() from flow-skill-matcher.js. Cleaned up unused discoverSkills import from flow-knowledge-router.js.
**Files**: scripts/flow-skill-creator.js (deleted), scripts/flow (CLI routing), scripts/flow-skill-generator.js, scripts/flow-memory-db.js, scripts/flow-skill-learn.js, scripts/flow-skill-create.js, scripts/flow-knowledge-router.js

### R-148 | 2026-02-22 07:15
**Type**: fix
**Tags**: #review #performance #optimization
**Task**: wf-cr-rv222b
**Request**: "Fix 2 additional review findings from dismissed investigation — array grouping optimization"
**Result**: Replaced multiple `.filter()` passes with single-pass `.reduce()` in 3 files (4 locations): (1) flow-zero-loss-extraction.js — 4 filter passes for confidence grouping → single reduce. (2) flow-prompt-composer.js — 4 filter passes for fragment purpose grouping → single reduce (2 locations). (3) flow-model-router.js — 2 filter passes for capable/incapable model split → single reduce. Finding 6 (skill script consolidation) deferred — TODO already exists in flow-skill-create.js:8-10.
**Files**: scripts/flow-zero-loss-extraction.js, scripts/flow-prompt-composer.js, scripts/flow-model-router.js

### R-147 | 2026-02-22 06:30
**Type**: fix
**Tags**: #review #security #performance #docs
**Task**: wf-cr-rv222
**Request**: "Fix 18 review findings from 3-day comprehensive review (session 2)"
**Result**: Fixed 10 findings across 6 files: (1) postinstall.js — wrapped bare fs.copyFileSync in try-catch. (2) session-context.js — cached getReadyData() to avoid triple file read on session init. (3) commands.md — fixed markdown formatting break (missing newline in Memory section header). (4) commands.md — replaced 9 phantom CLI commands with actual node script invocations. (5) commands.md — removed duplicate /wogi-compact and /wogi-trace entries. (6) flow-pattern-extractor.js — added path traversal validation to _getGitBlameDate and _getGitFileDate. (7) flow-standards-gate.js — added spec content validation before extractFilesToChange. (8) registry-manifest.json — clarified component registry activation condition. Dismissed 8 findings as false positives or pre-existing non-critical debt.
**Files**: scripts/postinstall.js, scripts/hooks/core/session-context.js, .claude/docs/commands.md, scripts/flow-pattern-extractor.js, scripts/flow-standards-gate.js, .workflow/state/registry-manifest.json

### R-146 | 2026-02-22 03:30
**Type**: change
**Tags**: #docs #readme #knowledge-base #commands
**Task**: wf-0a744cdd
**Request**: "Rewrite README as concise feature summary with KB deep-links — cleanup outdated KB, fix phantom commands"
**Result**: Full README rewrite from 261 to 153 lines. 28-row feature table with one-liner descriptions covering all current capabilities. Commands grouped into 15 categories. Deleted outdated workflow-steps.md (described non-existent YAML engine). Removed phantom /wogi-done from commands.md. Added 8 undocumented commands (/wogi-decide, /wogi-learn, /wogi-retrospective, /wogi-log, /wogi-skill-learn, /wogi-setup-stack, /wogi-models-setup, /wogi-bulk-loop). Updated future-features.md — moved implemented features to Shipped section (19 entries). All 11 KB deep-links verified valid.
**Files**: README.md, .claude/docs/commands.md, .claude/docs/knowledge-base/02-task-execution/workflow-steps.md (deleted), .claude/docs/knowledge-base/future-features.md

### R-145 | 2026-02-22 02:00
**Type**: fix
**Tags**: #workflow #routing #enforcement #wogi-start
**Task**: wf-routing-fix
**Request**: "Remove the 'proceed directly' exemption category from wogi-start routing docs — make routing unconditional with zero exemptions"
**Result**: Removed the root cause of workflow routing bypasses. Changed 3 sections in wogi-start.md: (1) Replaced routing principle #3 "Some requests need no command at all" with "Every request gets routed — no exemptions", (2) Removed the entire "Proceed directly (no command needed)" section that listed questions/operational/quick-fix exemptions, (3) Updated "push to github" example from "Execute git push directly (no command needed)" to "Invoke /wogi-start (wogi-start internally decides)". Verified claude-md.hbs template and user-commands.hbs already had correct framing. Regenerated CLAUDE.md via bridge sync.
**Files**: .claude/commands/wogi-start.md, CLAUDE.md (regenerated)

### R-144 | 2026-02-22 01:00
**Type**: fix
**Tags**: #review #fix #regression #3-day-review
**Task**: wf-cr-3day21
**Request**: "Review everything we've done in the past three days — make sure nothing is broken, no regression, no orphan files, no loopholes"
**Result**: 5-phase comprehensive review of 10 commits across 42+ files (3-day scope). 30 findings from 6 parallel agents. Fixed 18 findings: removed dead Levenshtein code from standards-checker, fixed catch variable naming in postinstall.js, wrapped bare readFileSync in api-index and function-index exportRegistry, fixed Windows path.sep bug in pattern-extractor, added path validation for --project flag, anchored scanner-base exclude regexes, removed dead ternary in installer.js, broadened JSON.parse detection regex, fixed 5 doc inconsistencies (wogi-decide config keys, wogi-rescan similarity ref, session-review model names, wogi-start config value, flow-review help text), added deprecation comment for zombie config key, added plugin warning in registry-manager. 6 findings verified as false positives. 3 deferred to wf-manifest-wiring. 3 accepted as low-risk.
**Files**: scripts/flow-standards-checker.js, scripts/postinstall.js, scripts/flow-api-index.js, scripts/flow-function-index.js, scripts/flow-pattern-extractor.js, scripts/flow-review.js, scripts/flow-registry-manager.js, scripts/flow-scanner-base.js, lib/installer.js, .workflow/config.json, .claude/commands/wogi-decide.md, .claude/commands/wogi-rescan.md, .claude/commands/wogi-start.md, .claude/docs/knowledge-base/02-task-execution/05-session-review.md

### R-143 | 2026-02-21 21:30
**Type**: feature
**Tags**: #scanner #semantic-matching #standards #config
**Task**: wf-semantic-wire
**Request**: "Wire AI-Judge Semantic Matching Into All Reuse Consumers"
**Result**: Replaced fixed 80% similarity thresholds with AI-driven semantic matching across all consumers. Updated flow-standards-checker.js (checkComponentDuplication + checkFunctionDuplication use calculateCombinedSimilarity with match levels), flow-standards-gate.js (removed legacy threshold normalization), lib/installer.js (added semanticMatching defaults). Updated 8 documentation files to replace ">80%" with configurable semantic language. Regenerated CLAUDE.md via bridge sync.
**Files**: scripts/flow-standards-checker.js, scripts/flow-standards-gate.js, lib/installer.js, .claude/commands/wogi-start.md, .claude/commands/wogi-review.md, .claude/commands/wogi-review-fix.md, .claude/commands/wogi-onboard.md, .claude/commands/wogi-rescan.md, .workflow/templates/partials/auto-features.hbs, .claude/docs/knowledge-base/02-task-execution/05-session-review.md, CLAUDE.md

### R-142 | 2026-02-21 18:00
**Type**: fix
**Tags**: #review #security #performance #config #architecture
**Task**: wf-cr-210221
**Request**: "Fix all 52 review findings from session review"
**Result**: Applied 18 auto-fixable fixes across security (path traversal, allowlist, safeJsonParse, prototype pollution), performance (Promise.all, RegExp cache, Levenshtein DP, Set dedup), code logic (main() guard, dead code, timestamp storage), architecture (Agent 6 consistency, WebMCP update), and config (missing keys). 4 findings deferred as not auto-fixable. 1 false positive dismissed.
**Files**: scripts/hooks/core/worktree-lifecycle.js, scripts/flow-registry-manager.js, scripts/flow-api-index.js, scripts/flow-function-index.js, scripts/postinstall.js, scripts/hooks/core/session-context.js, scripts/flow-scanner-base.js, scripts/flow-standards-checker.js, scripts/registries/component-registry.js, .workflow/config.json, .claude/commands/wogi-start.md, .claude/commands/wogi-review-fix.md, .claude/commands/wogi-morning.md

### R-141 | 2026-02-21 17:00
**Type**: feature
**Tags**: #workflow #enforcement #rule-pipeline #wogi-decide #wogi-morning
**Request**: "Rule-to-Action Pipeline — after /wogi-decide creates a rule, scan for violations and route fixes through /wogi-start"
**Result**: Added mandatory violation scan to wogi-decide.md with 3 routing options (quick-fix/story/epic based on count). Added rule violations section and auto-promoted rules section to wogi-morning.md. Updated claude-md.hbs and auto-features.hbs templates. Regenerated CLAUDE.md.
**Files**: .claude/commands/wogi-decide.md, .claude/commands/wogi-morning.md, .workflow/templates/claude-md.hbs, .workflow/templates/partials/auto-features.hbs, CLAUDE.md

### R-140 | 2026-02-21 16:00
**Type**: feature
**Tags**: #workflow #consumer-impact #agent-6 #wogi-start #story-writer
**Request**: "Consumer Impact Analysis — bake mandatory pre-refactoring consumer validation into WogiFlow"
**Result**: Added Agent 6 (Consumer Impact Analyzer) to wogi-start.md explore phase. MANDATORY for refactor/migration/architecture tasks. Maps all consumers (imports, references, configs, docs, tests) before code changes. Hard-blocks on failure for refactor tasks. Added consumer impact section to story-writer.md. Updated auto-features.hbs template with Agent 6 and consumer migration check.
**Files**: .claude/commands/wogi-start.md, agents/story-writer.md, .workflow/templates/partials/auto-features.hbs

### R-139 | 2026-02-21 15:00
**Type**: feature
**Tags**: #scanner #registry #plugin-architecture #manifest #component-scanner
**Task**: wf-ext-registry
**Epic**: epic-universal-registry (Story 2/5)
**Request**: "Extensible Registry Architecture — plugin-based registry system with auto-activation per stack"
**Result**: Created `flow-registry-manager.js` with RegistryPlugin base class, RegistryManager orchestrator, getActiveRegistries() helper, and CLI. Created 3 plugin adapters: function-registry.js (wraps FunctionScanner), api-registry.js (wraps APIScanner), component-registry.js (new ComponentScanner for React/Vue/Svelte). Added `registries` config array alongside old-format keys for backwards compat. Generates `registry-manifest.json` for dynamic discovery by consuming systems. 22/22 tests passing across all 9 acceptance criteria.
**Files**: scripts/flow-registry-manager.js (NEW), scripts/registries/function-registry.js (NEW), scripts/registries/api-registry.js (NEW), scripts/registries/component-registry.js (NEW), .workflow/config.json, lib/installer.js

### R-138 | 2026-02-21 14:45
**Type**: feature
**Tags**: #scanner #framework-resolver #file-patterns #prisma #nestjs #django #go #rust
**Task**: wf-fwk-discovery
**Epic**: epic-universal-registry (Story 1/5)
**Request**: "Replace hardcoded FILE_PATTERNS with stack-aware dynamic discovery"
**Result**: Created `flow-framework-resolver.js` with FRAMEWORK_PATTERNS mapping for 11 frameworks (Prisma, TypeORM, Sequelize, Drizzle, Mongoose, NestJS, Django, FastAPI, Flask, Go, Rust). Enhanced `globFiles()` in flow-pattern-extractor.js with `matchesGlobPattern()` supporting 6 pattern types (extension, compound extension, exact filename, suffix, directory-scoped, ancestor directory-scoped). Wired resolver into `extractPatterns()` — calls `detectStack()` then `resolvePatterns()` to additively merge framework patterns with base FILE_PATTERNS. Graceful fallback if stack detection fails.
**Files**: scripts/flow-framework-resolver.js (NEW), scripts/flow-pattern-extractor.js

### R-137 | 2026-02-21 13:30
**Type**: feature
**Tags**: #map-sync #function-map #api-map #app-map #pruning #deletion-sync
**Task**: wf-mapsync
**Request**: "Ensure WogiFlow updates maps when components/functions/APIs are deleted or renamed — not just when added"
**Result**: Added `prune()` methods to flow-function-index.js and flow-api-index.js that auto-remove entries whose source files no longer exist. Updated wogi-start.md, CLAUDE.md, and templates to instruct AI to update maps on deletions/renames, not just additions.
**Files**: scripts/flow-function-index.js, scripts/flow-api-index.js, .claude/commands/wogi-start.md, CLAUDE.md, .workflow/templates/claude-md.hbs, .workflow/templates/partials/auto-features.hbs

### R-136 | 2026-02-21 13:00
**Type**: refactor
**Tags**: #config #installer #standards #similarity-threshold #dead-code
**Task**: wf-cfgaudit
**Request**: "Config.json audit fixes: remove dead sections, fix similarity threshold, enrich installer"
**Result**: Removed 7 dead config sections (skillGeneration, autoLearning, tieredLearning, testing, planning, export, figmaAnalyzer — 89 lines). Fixed similarity threshold bug (config had value `80` but code expected `0.8`, making the check non-functional). Added two-tier similarity system: >= 0.8 blocks as must-fix, 0.6-0.8 warns and lets user decide. Added threshold normalization to handle both percentage and decimal formats. Enriched installer default config from 9 lines to comprehensive defaults covering enforcement, tasks, loops, qualityGates, standardsCompliance, validation, commits, hooks, smartCompaction, review, planMode, research, and 10+ more essential sections.
**Files**: `.workflow/config.json`, `scripts/flow-standards-checker.js`, `scripts/flow-standards-gate.js`, `lib/installer.js`

### R-135 | 2026-02-21 12:30
**Type**: new
**Tags**: #review #origin-tracing #learning-signal #same-session
**Task**: wf-origintrace
**Request**: "Add origin task tracing — same-session annotation, originTask references, and learning signal detection for review fixes"
**Result**: Added `originTaskTracing` config block with toggles for same-session annotation, origin tracing, and learning signals. Modified wogi-review Phase 5.3c to detect same-session reviews and annotate completed tasks with `reviewFindings` instead of creating standalone tasks; added `originTask` field to `wf-rv-` tasks with git-based origin resolution; added learning signal detection that fires when same task type/feature generates 3+ fixes. Updated wogi-review-fix and wogi-triage with matching `originTask` field and learning signal checks.
**Files**: `.workflow/config.json`, `.claude/commands/wogi-review.md`, `.claude/commands/wogi-review-fix.md`, `.claude/commands/wogi-triage.md`, `.workflow/changes/wf-origintrace.md`

### R-134 | 2026-02-21 12:00
**Type**: new
**Tags**: #review #triage #review-fix #batch #severity-routing
**Task**: wf-reviewfix
**Request**: "Implement Enhanced Post-Review Fix Workflow — severity routing, persistent tasks, batch mode"
**Result**: Added `reviewFix` config block, rewrote wogi-review Phase 5 with 4-option severity-aware prompt and persistent task creation (wf-rv- prefix), added --pending batch mode to wogi-review-fix with grouping/sorting, added --batch and --source review filters to wogi-triage with aligned task format.
**Files**: `.workflow/config.json`, `.claude/commands/wogi-review.md`, `.claude/commands/wogi-review-fix.md`, `.claude/commands/wogi-triage.md`

### R-133 | 2026-02-21 11:30
**Type**: change
**Tags**: #onboarding #postinstall #welcome-message
**Task**: wf-postinstall
**Request**: "Add post-install welcome message with setup guidance for wogi-init and wogi-onboard"
**Result**: Updated postinstall.js welcome message to distinguish between new projects (/wogi-init or "setup wogiflow") and existing projects (/wogi-onboard). Added descriptive subtitles for each option.
**Files**: `scripts/postinstall.js`

### R-132 | 2026-02-21 10:45
**Type**: new
**Tags**: #enforcement #scope-gate #boundaries #spec-generator #story-template
**Task**: wf-boundaries
**Request**: "Add boundary declarations to task specs"
**Result**: Added "## Boundaries (DO NOT MODIFY)" section to story template (flow-story.js). Added boundary extraction to spec generator (flow-spec-generator.js) that parses ## Boundaries from spec content. Added runtime boundary enforcement to scope-gate.js — checks boundaries BEFORE scope whitelist, generates BOUNDARY VIOLATION messages when agent tries to edit protected files. Added getSessionBoundaries() to flow-durable-session.js for reading boundaries from session state. Updated wogi-start.md Step 1.5 to mention boundary declarations in spec generation. Inspired by PAUL framework's boundary system.
**Files**: `scripts/flow-story.js`, `scripts/hooks/core/scope-gate.js`, `scripts/flow-spec-generator.js`, `scripts/flow-durable-session.js`, `.claude/commands/wogi-start.md`

### R-131 | 2026-02-21 10:25
**Type**: fix
**Tags**: #enforcement #routing #wogi-start #conversational-followup #P0
**Task**: wf-conv-followup
**Request**: "Add conversational follow-up handling to /wogi-start"
**Result**: Added "Conversational follow-ups" category to /wogi-start's Request Categories (Decision Guide). When /wogi-start receives short responses like "yes", "no", "go ahead", "approved", "option 2", it now looks back at conversation context to identify what the user is responding to, then acts accordingly. Added 4 new examples covering affirmative, directive, option selection, and negative follow-ups. Updated user-commands.hbs partial to list "Conversational follow-up" as an internal triage category. Regenerated CLAUDE.md via bridge sync.
**Files**: `.claude/commands/wogi-start.md`, `.workflow/templates/partials/user-commands.hbs`, `CLAUDE.md` (regenerated), `.workflow/changes/wf-conv-followup.md`

### R-130 | 2026-02-21 10:15
**Type**: fix
**Tags**: #enforcement #task-gating #templates #routing #NLD #P0
**Task**: wf-16d64c68
**Request**: "Amend /wogi-start routing rule to allow Natural Language Detection commands"
**Result**: Fixed routing conflict between unconditional /wogi-start rule and Natural Language Detection table. The rule now says: "route through a /wogi-* command" instead of "route through /wogi-start specifically." NLD matches (e.g., "show tasks" → /wogi-ready, "code review" → /wogi-review) are valid routing that satisfies the mandatory gate. /wogi-start is the universal fallback for messages that don't match the NLD table. Updated Task Gating section with NLD-first examples, NLD section with explicit "satisfies routing requirement" note, Universal Entry Point with two-step routing (check NLD → fallback to /wogi-start), and /wogi-start description changed from "MANDATORY for ALL messages" to "Universal Fallback Router." Regenerated CLAUDE.md via bridge sync.
**Files**: `.workflow/templates/claude-md.hbs`, `.workflow/templates/partials/user-commands.hbs`, `CLAUDE.md` (regenerated)

### R-129 | 2026-02-21 10:00
**Type**: fix
**Tags**: #enforcement #task-gating #templates #bypass-prevention #P0
**Task**: wf-dbccc898
**Request**: "Remove /wogi-start bypass loophole — make routing unconditionally mandatory"
**Result**: Fixed 3 locations in CLAUDE.md templates that allowed the AI to self-classify requests and skip /wogi-start. (1) Task Gating Step 1 in claude-md.hbs: Replaced "NO - Handle normally" exception with unconditional routing requirement. Added explicit anti-bypass language: "If you find yourself thinking 'this is just a question, I can skip /wogi-start' — that thought is the exact bypass this rule exists to prevent." (2) Universal Entry Point in claude-md.hbs: Changed from describing routing categories as if AI should self-classify, to explicitly stating they describe what /wogi-start does internally with "DO NOT use this to self-classify" warning. Added question/operational examples alongside implementation examples. (3) /wogi-start description in user-commands.hbs: Changed trigger from "any implementation request" to "EVERY user message", renamed "Request Triage" to "Internal Triage (handled by /wogi-start, NOT by you)", added prefix warning. Regenerated CLAUDE.md via bridge sync. Verified old loophole language ("Proceed normally without task gating", "Handle normally") is completely absent from generated output.
**Files**: `.workflow/templates/claude-md.hbs`, `.workflow/templates/partials/user-commands.hbs`, `CLAUDE.md` (regenerated)

### R-128 | 2026-02-20 20:10
**Type**: fix
**Tags**: #review #code-review-findings #learning #commands #wogi-decide #wogi-learn #wogi-retrospective #wogi-start #templates #config #P0
**Task**: wf-cr-a88584
**Request**: "Fix 18 review findings from learning-epic commit"
**Result**: Fixed all 18 findings (5 high, 9 medium, 4 low) from code review of learning-epic commit. Key fixes: (1) Updated templates (claude-md.hbs + user-commands.hbs) instead of direct CLAUDE.md edits, ran bridge sync (ARCH01, ARCH05). (2) Removed "review what happened" trigger conflict with /wogi-review (CL01). (3) Added input sanitization for user-supplied rule text in /wogi-decide (SEC01). (4) Added --threshold floor >= 2 and --quick final confirmation in /wogi-learn (SEC02). (5) Required follow-on rule verb for "from now on" trigger (SEC06). (6) Added question priority order for retro max-3 cap (CL05). (7) Added --since date validation (SEC04). (8) Fixed corrections path consistency and empty dir fallback (CL03, ARCH06). (9) Delegated duplicate checking to /wogi-decide --from-pattern (CL08). (10) Added decide/learning/retrospective config blocks with canonical threshold comment (ARCH03, ARCH04). (11) Added user confirmation before writing violations to ready.json (SEC03). (12) Changed retro filename to include HHMMSS (CL07).
**Files**: `.claude/commands/wogi-decide.md`, `.claude/commands/wogi-learn.md`, `.claude/commands/wogi-retrospective.md`, `.claude/commands/wogi-start.md`, `.workflow/templates/claude-md.hbs`, `.workflow/templates/partials/user-commands.hbs`, `.workflow/config.json`, `CLAUDE.md` (regenerated via bridge sync)

### R-127 | 2026-02-20 19:25
**Type**: new
**Tags**: #learning #commands #epic #wogi-decide #wogi-learn #wogi-retrospective #routing #P1
**Task**: wf-learning-epic (wf-decide, wf-learn, wf-retro, wf-route-learn)
**Request**: "Create interactive learning commands — /wogi-decide, /wogi-learn, /wogi-retrospective"
**Result**: Created 3 new slash commands and updated routing. `/wogi-decide` handles "from now on" rule creation with clarifying questions and duplicate detection. `/wogi-learn` promotes feedback patterns to decision rules with browse, incident, and bulk modes. `/wogi-retrospective` provides guided session reflection that reads request-log, reviews, corrections, and patterns to extract lessons. Updated `/wogi-start` Command Catalog with 3 new entries + 4 routing examples. Updated CLAUDE.md Natural Language Detection table with trigger phrases for all 3 commands. Updated `/wogi-help` with new "Learning & Rules" section.
**Files**: `.claude/commands/wogi-decide.md` (new), `.claude/commands/wogi-learn.md` (new), `.claude/commands/wogi-retrospective.md` (new), `.claude/commands/wogi-start.md`, `.claude/commands/wogi-help.md`, `CLAUDE.md`

### R-126 | 2026-02-20 17:30
**Type**: fix
**Tags**: #hooks #task-gate #review #component:wogi-review #workflow-bypass #P0
**Task**: wf-fc196fcf
**Request**: "Fix post-review fix loop bypassing task gating and implementation gate not blocking"
**Result**: Fixed Phase 5 of `/wogi-review` to create a tracked fix task (`wf-cr-XXXXXX`) in `ready.json` inProgress BEFORE applying any review fixes, and move it to recentlyCompleted after completion. This ensures the PreToolUse task-gate allows edits during the fix loop (active task exists) and blocks subsequent untracked edits (no active task after completion). Added explicit handling for "Review manually" option (no task created, user directed to `/wogi-start`). Updated Reference Detail section with Step 0 (Create Fix Task) and Step 4 (Complete Fix Task). Deliberately kept `implementation-gate.js` as a soft hint (not hard block) to avoid deadlock where Claude can't read prompts to invoke `/wogi-start`. The existing `task-gate.js` already hard-blocks Edit/Write at PreToolUse level when no active task exists.
**Files**: `.claude/commands/wogi-review.md`, `.workflow/changes/wf-fc196fcf.md`

### R-125 | 2026-02-20 17:00
**Type**: fix
**Tags**: #hooks #esm #commonjs #compatibility #postinstall #P0
**Task**: wf-esm-compat
**Request**: "Fix ESM compatibility: hooks fail in projects with type:module"
**Result**: Added `scripts/package.json` with `{ "type": "commonjs" }` to the WogiFlow package. This tells Node.js to treat all `.js` files under `scripts/` as CommonJS regardless of the project's root `package.json` setting. The file is automatically copied to target projects during postinstall via the existing `copyDir()` mechanism. Fixes `ReferenceError: require is not defined in ES module scope` for all 34+ hook files.
**Files**: `scripts/package.json` (new)

### R-124 | 2026-02-20 16:30
**Type**: fix
**Tags**: #review #component:wogi-review #code-review-findings #quality #P1
**Task**: wf-cr-2639a7
**Request**: "Fix 19 review findings from wf-2639ad7d"
**Result**: Fixed all 19 findings from comprehensive code review of wogi-review.md. Key fixes: (1) Added Architecture Note explaining runtime vs AI instruction layers (ARCH-001, critical). (2) Aligned Phase 2.5 skip conditions and Phase 3 blocking behavior across all document sections (CL-001, CL-002). (3) Added boundary markers for decisions.md content injection (SEC-001). (4) Added fix loop iteration cap of 3 cycles (SEC-002). (5) Removed duplicate Pass Module API section (ARCH-002/CL-005). (6) Changed model=haiku to model=sonnet per policy (PR-001). (7) Added multi-pass return path to Phases 2.5-5 (CL-003). (8) Added archive/sign-off to Phase 5 (CL-004). (9) Added audit trail for --skip-standards (SEC-003). (10) Added --commits N validation note (SEC-004). (11) Added .gitignore note for findings files (SEC-005). (12) Replaced magic number 80 with config reference (PR-002). (13) Added #component:wogi-review tag (PR-003). (14) Synced Options table (CL-006). (15) Added per-agent minimums note (SEC-006). (16) Fixed agent paths to .workflow/agents/ (ARCH-004). (17) Updated multi-pass output format [Haiku]→[Sonnet].
**Files**: `.claude/commands/wogi-review.md`, `.workflow/state/request-log.md`

### R-123 | 2026-02-20 15:42
**Type**: fix
**Tags**: #review #wogi-review #component:wogi-review #phases #enforcement #agents #project-rules #performance #adversarial #git-claims #standards #optimization #post-review #P1
**Task**: wf-2639ad7d
**Request**: "Fix wogi-review to execute all 5 designed phases"
**Result**: Restructured wogi-review.md skill document to enforce all 5 phases sequentially. Added: (1) MANDATORY 5-PHASE PROTOCOL with explicit checkpoints, (2) project-rules agent spawning from decisions.md, (3) performance agent spawning from config, (4) adversarial minimum findings enforcement, (5) Phase 2.5 git-verified claim checking, (6) Phase 5 post-review workflow with fix loop and learning. Previously only ~40% of the review design executed.
**Files**: .claude/commands/wogi-review.md

### R-122 | 2026-02-20 13:30
**Type**: fix
**Tags**: #hooks #implementation-gate #context-injection #postinstall #npm-update #security #P0 #v1.4.5
**Task**: wf-cr-hookfmt
**Request**: "Fix hooks: context injection instead of blocking, review findings, npm update propagation"
**Result**: Three major fixes: (1) **Context injection architecture** — Changed implementation gate from BLOCKING prompts to injecting `additionalContext` that tells Claude to route through `/wogi-start`. Prompts pass through with routing context, `/wogi-start` handles classification with AI understanding. (2) **Review findings fixed** — HIGH: Added `safeJsonParseString` to pre-tool-use.js (prototype pollution protection), removed 200-char prompt truncation from routing context. MEDIUM: Removed dead config keys (`softMode`, `mode: "warn"`) and dead function (`isSoftModeEnabled`). (3) **npm update propagation** — Fixed postinstall.js to ALWAYS overwrite WogiFlow-owned files (scripts, commands, docs, rules, settings hooks) instead of merge mode that silently skipped updates. Bumped `_wogiFlowVersion` in settings.json to 1.4.5.
**Files**: `scripts/hooks/core/implementation-gate.js`, `scripts/hooks/entry/claude-code/pre-tool-use.js`, `scripts/hooks/entry/claude-code/user-prompt-submit.js`, `scripts/postinstall.js`, `.claude/settings.json`, `.workflow/config.json`, `scripts/test-hook-chain.js`, `package.json`

### R-121 | 2026-02-20 10:30
**Type**: fix
**Tags**: #hooks #implementation-gate #adapter #UserPromptSubmit #P0 #bugfix
**Task**: wf-hook-fmt
**Request**: "Fix UserPromptSubmit hook response format and remove regex classification"
**Result**: Fixed two critical bugs preventing the implementation gate from working in target projects: (1) **Wrong response format** — `transformUserPromptSubmit()` in the Claude Code adapter returned `{ continue: false, hookSpecificOutput: { decision: "block" } }` but Claude Code expects top-level `{ decision: "block", reason: "..." }`. `continue: false` stops the entire session, not a single prompt. Fixed to correct format. (2) **Removed regex classification from gate** — Once blocking worked, regex patterns were too aggressive (blocked questions, exploration). Replaced entire classification logic in `checkImplementationGate()` with simple binary check: active task → allow, /wogi-* command → allow, no task → block with message to use /wogi-start. The regex patterns (IMPLEMENTATION_PATTERNS, EXPLORATION_PATTERNS, etc.) are preserved for `classifyRequest()` used by /wogi-start routing, but no longer used for blocking decisions. Verified with comprehensive edge case testing.
**Files**: `scripts/hooks/adapters/claude-code.js`, `scripts/hooks/core/implementation-gate.js`

### R-120 | 2026-02-20 09:30
**Type**: fix
**Tags**: #hooks #postinstall #npm #settings #P0 #bugfix
**Task**: wf-hook-reg
**Request**: "Fix hooks not being registered in target projects after npm install"
**Result**: Fixed P0 bug where WogiFlow hooks never fired in target projects. Root cause: `.claude/settings.json` (which registers hooks with Claude Code) was neither included in the npm package nor copied during postinstall. Fix: (1) Added `.claude/settings.json` to `package.json → files` array so it's included in npm package; (2) Added settings.json merge logic to `postinstall.js → copyClaudeResources()` — handles fresh installs (direct copy), existing non-WogiFlow settings (merge hooks in), already-managed settings (skip), and parse errors (overwrite); (3) Added Step 4.6 to `/wogi-init` that runs `flow hooks setup` as a safety net to generate `settings.local.json` with absolute paths.
**Files**: `package.json`, `scripts/postinstall.js`, `.claude/commands/wogi-init.md`

### R-119 | 2026-02-20 06:50
**Type**: fix
**Tags**: #code-review #security #hooks #config-change #worktree #quality
**Task**: wf-cr-2341a2
**Request**: "Fix all 13 code review findings from wf-1c1fa2d8 and wf-2341ad82"
**Result**: Fixed 11 actionable findings (7 medium, 4 low). Key fixes: replaced raw JSON.parse with safeJsonParseString in config-change entry hook; fixed misleading sync message with accurate bridgeState caching; added path validation (defense-in-depth); aligned entry hook to use adapter.transformResult pattern; removed unused imports; added hooks.rules.configChange config toggle with gate check; fixed TeammateIdle timeout mismatch (10→5); improved detectNativeWorktree to use path segment matching; registered config-change in core/index.js. 2 informational findings noted (no code change needed).
**Files**: `scripts/hooks/core/config-change.js`, `scripts/hooks/entry/claude-code/config-change.js`, `scripts/hooks/adapters/claude-code.js`, `scripts/hooks/core/index.js`, `scripts/flow-worktree.js`, `.workflow/config.json`, `.claude/settings.json`

### R-118 | 2026-02-20 06:25
**Type**: new
**Tags**: #explore-phase #agents #shift-left #standards #risk
**Task**: wf-2341ad82
**Request**: "Add two new explore phase agents: Risk & History Analyzer and Standards Preview"
**Result**: Added Agent 4 (Risk & History Analyzer) and Agent 5 (Standards Preview) to the explore phase. Agent 4 queries feedback-patterns.md, corrections/, decisions.md, and memory-db for past failures and rejected approaches related to the current task type/files. Agent 5 pre-computes which standards will be enforced, checks component duplication against app-map, and outputs a targeted compliance checklist before coding. Both are local-only (no web), run in parallel with existing 3 agents. Updated config.json with `riskHistory` and `standardsPreview` agent toggles.
**Files**: `.claude/commands/wogi-start.md`, `.workflow/config.json`, `CLAUDE.md`, `.workflow/templates/partials/auto-features.hbs`

### R-117 | 2026-02-20 06:15
**Type**: change
**Tags**: #compatibility #claude-code #models #hooks #worktree #settings
**Task**: wf-1c1fa2d8
**Request**: "Claude Code compatibility updates for latest release"
**Result**: 7 improvements: (1) Added Sonnet 4.6 1M context to model registry/providers/caller, (2) Created ConfigChange hook for mid-session config sync, (3) Added native worktree detection to prevent nesting, (4) Created settings.json for shared hook config (plugin pattern), (5) Updated compatibility docs with managed settings, worktree, simple mode naming, (6) Registered ConfigChange in adapter and settings, (7) Added version 1.5.0+ row to compatibility table.
**Files**: `.workflow/models/registry.json`, `scripts/flow-model-caller.js`, `.workflow/prompts/fragments/output-format-claude.md`, `scripts/hooks/core/config-change.js` (new), `scripts/hooks/entry/claude-code/config-change.js` (new), `scripts/hooks/adapters/claude-code.js`, `.claude/settings.local.json`, `.claude/settings.json` (new), `scripts/flow-worktree.js`, `.claude/docs/claude-code-compatibility.md`

### R-116 | 2026-02-20 00:40
**Type**: release
**Tags**: #release #v1.4.2 #github
**Task**: wf-rel-142
**Request**: "Push to GitHub and create a release"
**Result**: Bumped version to 1.4.2, pushed 5 commits (aea28b2..967e165) to master, created tag v1.4.2, and published GitHub release. Release covers: dead multi-CLI code removal, Codex review fixes (P0-P2), and 3 medium-severity code review fixes.
**Files**: package.json

---

### R-115 | 2026-02-20 00:30
**Type**: fix
**Tags**: #quality #review-findings #hooks #verification #schema
**Task**: wf-cr-6b2aa8
**Request**: "Fix 3 medium-severity code review findings from wf-6b2aa8d3 review"
**Result**: Fixed 3 medium-severity + 1 low-severity review findings: (1) Fixed skipped+passed semantic conflict — hook adapter claude-code.js:246 treated skipped as passing (OR'd with passed), contradicting flow-verify.js which sets passed:false+skipped:true for missing tools. Changed adapter to only check `coreResult.passed`. Added `skipped` to GateResult constructor and toJSON. (2) Removed dead `browserTesting` block from config.schema.json (35 lines). (3) Removed dead `bridgePath` variable with no-op `.replace('-', '-')` from flow-bridge.js. (4) Removed orphaned `suggestBrowserTests` config key (related to removed browserTesting feature).
**Files**: scripts/hooks/adapters/claude-code.js, scripts/flow-verify.js, scripts/flow-bridge.js, .workflow/config.schema.json, .workflow/config.json

---

### R-114 | 2026-02-20 00:15
**Type**: fix
**Tags**: #quality #codex-review #consistency #verification #dead-code
**Task**: wf-6b2aa8d3
**Request**: "Fix all Codex review findings (P0-P2) and remove remaining dead config/code"
**Result**: Fixed 8 Codex review findings. [P0] Rewrote cross-artifact consistency parsers to handle actual map formats (heading+metadata and multi-column tables) instead of strict 2-column tables - now finds 10 real entries. [P1] Fixed flow-bridge.js sync arg parsing to skip flags when looking for CLI type. [P1] Fixed flow-review.js --verify-only to exit(1) when gates fail. [P1] Marked adversarial review config as AI-instruction-only (not runtime-enforced). [P2] Fixed bridge status config path. [P2] Fixed 3 broken KB links. [P2] Fixed flow-verify.js treating missing tool as pass. Removed 4 dead config keys (parallelDispatch, browserTesting, tdd, onboard.temporal). Deleted dead hook (long-input-gate.js). Cleaned references in 4 command files.
**Files**: scripts/flow-consistency-check.js, scripts/flow-bridge.js, scripts/flow-review.js, scripts/flow-verify.js, scripts/flow-skill-matcher.js, scripts/hooks/core/long-input-gate.js (deleted), .workflow/config.json, .claude/docs/knowledge-base/02-task-execution/01-task-planning.md, .claude/docs/knowledge-base/02-task-execution/external-integrations.md, .claude/docs/knowledge-base/03-self-improvement/long-input-processing.md, .claude/commands/wogi-onboard.md, .claude/commands/wogi-init.md, .claude/commands/wogi-test-browser.md

---

### R-113 | 2026-02-19 23:30
**Type**: refactor
**Tags**: #cleanup #dead-code #multi-cli #documentation
**Task**: wf-f0a3106f
**Request**: "Remove all dead multi-CLI support code and false claims"
**Result**: Removed all dead references to Gemini CLI, Codex, Cursor, OpenCode, Kimi. Deleted GEMINI.md, AGENTS.md, agents-md.hbs template, .gemini/ and .codex/ directories, 2 dead scripts (flow-operational-scanner.js, flow-quality-guard.js). Updated README to claim Claude Code only. Fixed dead code in flow-utils.js, constants.js, flow-hooks.js, flow-init, flow-start.js, config.schema.json, base-bridge.js, model registry, package.json keywords, wogi-research.md examples. Cancelled multi-CLI roadmap phases. Fixed broken config path in flow-start.js.
**Files**: README.md, GEMINI.md (deleted), AGENTS.md (deleted), .workflow/templates/agents-md.hbs (deleted), scripts/flow-utils.js, scripts/hooks/core/constants.js, scripts/flow-hooks.js, scripts/flow-init, scripts/flow-start.js, scripts/flow-operational-scanner.js (deleted), scripts/flow-quality-guard.js (deleted), .workflow/config.schema.json, .workflow/bridges/base-bridge.js, .workflow/roadmap.md, .workflow/models/registry.json, .gitignore, lib/installer.js, .claude/docs/knowledge-base/configuration/all-options.md, .claude/commands/wogi-research.md, package.json, .gemini/ (deleted), .codex/ (deleted), .workflow/changes/cli-bridges/ (deleted)

---

### R-112 | 2026-02-19 23:15
**Type**: release
**Tags**: #release #npm #github #v1.4.1
**Request**: "Update GitHub and create a release (make sure we see the new readme on GitHub and npm)"
**Result**: Created v1.4.1 patch release to ensure updated README is visible on both GitHub and npm. Bumped version to 1.4.1, pushed to master, created tag, published GitHub release and npm package.
**Files**: package.json, package-lock.json

### R-111 | 2026-02-19 22:45
**Type**: docs
**Tags**: #documentation #knowledge-base #readme #v1.4.0
**Task**: wf-docs-v140
**Request**: "Make sure we updated knowledge base and readme files to match what we have"
**Result**: Comprehensive documentation update for all 6 v1.4.0 features across 7 files. Updated README.md with new Core Features table entries, file structure, and feature sections. Updated knowledge base: session-review (adversarial review, git-verified claims, standards compliance), specification-mode ([NEEDS CLARIFICATION] markers), verification (TDD mode, cross-artifact consistency, git-verified claims), project-learning (decision amendment tracking), all-options (5 new config sections), commands.md (decision tracker and consistency CLI).
**Files**: README.md, .claude/docs/knowledge-base/02-task-execution/05-session-review.md, .claude/docs/knowledge-base/02-task-execution/specification-mode.md, .claude/docs/knowledge-base/02-task-execution/03-verification.md, .claude/docs/knowledge-base/03-self-improvement/project-learning.md, .claude/docs/knowledge-base/configuration/all-options.md, .claude/docs/commands.md

### R-110 | 2026-02-19 22:00
**Type**: fix
**Tags**: #code-review #security #quality #flow-utils #consistency
**Task**: wf-cr-remain
**Request**: "Fix all remaining code review findings"
**Result**: Fixed last 4 review findings. (1) safeJsonParse now rejects top-level arrays with Array.isArray check. (2) safeJsonParse error messages use project-relative paths instead of leaking absolute filesystem paths. (3) DRY refactor: extracted readMapFile() and isHeaderRow() helpers in flow-consistency-check.js, eliminating ~40 lines of duplicated file-reading boilerplate across 3 parse functions. (4) Orphan warnings now respect orphanMode:'block' config for users who want strict map coverage enforcement.
**Files**: scripts/flow-utils.js, scripts/flow-consistency-check.js, .workflow/state/ready.json

### R-109 | 2026-02-19 21:45
**Type**: fix
**Tags**: #code-review #security #quality #decision-tracking #consistency
**Task**: wf-cr-02881a
**Request**: "Code review and fix all findings from wf-02881aba"
**Result**: Multi-pass code review (Structure/Logic/Security) found 16 issues (1 critical, 5 high, 8 medium, 2 low). Fixed 14 of 16 (2 pre-existing low-priority deferred). CRITICAL: CLI `record` broken with requireImpactAssessment=true, fixed config default to false. HIGH: removed 2 unused imports (execSync, info), added atomic writeLog with try-catch, tightened listPattern regex to avoid prose false-matches, added isPathWithinProject validation for config logFile path. MEDIUM: validated AMENDMENT_SOURCES, fixed orphans CLI default dirs inconsistency, cached parsed map results to avoid double I/O, added symlink skip + depth limit to directory scanner, added type guard on amendment fields, added path boundary check in checkFileExists, added TODO for unimplemented crossMapConsistency.
**Files**: scripts/flow-decision-tracker.js, scripts/flow-consistency-check.js, .workflow/config.json, .workflow/state/ready.json

### R-108 | 2026-02-19 21:02
**Type**: new
**Tags**: #review #tdd #spec-generation #decision-tracking #consistency #config #competitor-research
**Task**: wf-02881aba
**Request**: "Implement all 6 competitor-inspired improvements"
**Result**: Implemented 6 improvements from competitor research (BMAD-METHOD, OpenSpec/Spec Kit, Task Master Dev): (1) Adversarial review minimum findings - added config.review.minFindings (default 3) and agent prompt suffix enforcing minimum findings with clean-justification type (wogi-review.md v5.0). (2) [NEEDS CLARIFICATION] markers in spec generation - 5 categories (assumption, ambiguity, missing-context, dependency-unknown, edge-case), blocks implementation until resolved (wogi-start.md). (3) Git-verified claim checking in code review - Phase 2.5 cross-references spec deliverables against git diff, missing files are BLOCKERs (wogi-review.md). (4) Test-first mode (opt-in TDD) - Step 2.5 TDD Mode Check with test-first execution loop, framework detection, --tdd flag (wogi-start.md). (5) Decision amendment tracking - new script flow-decision-tracker.js with record/history/stats/diff CLI and programmatic API. (6) Cross-artifact consistency analysis - new script flow-consistency-check.js validates app-map/function-map/api-map against codebase, orphan detection. All config keys added to config.json.
**Files**: .workflow/config.json, .claude/commands/wogi-review.md, .claude/commands/wogi-start.md, scripts/flow-decision-tracker.js (new), scripts/flow-consistency-check.js (new), .workflow/state/ready.json

### R-107 | 2026-02-19 22:30
**Type**: fix
**Tags**: #audit #tech-debt #documentation #config #templates #hooks
**Task**: wf-full-audit
**Request**: "Fix all 37 audit findings - zero tech debt"
**Result**: Fixed all 37 audit findings across two sessions. CRITICAL (4): Created function-map.md + api-map.md with templates, created .workflow/agents/security.md, removed duplicate enforcement-rules.hbs from CLAUDE.md template, updated progress.md. HIGH (9): Deleted duplicate roadmap, added 19 commands to commands.md, fixed wogi-statusline-setup (dir→flat), added YAML frontmatter to github-releases.md, added npm publish step to decisions.md, fixed README broken links, fixed hybrid templates path, documented disabled validation. MEDIUM (16): Deleted 5 empty bug templates, created figma-analyzer learnings.md, added 3 commands to natural language table, created .workflow/tests/flows/, documented 3 architectural decisions, promoted try-catch rule, updated pipeline diagram with 6 missing steps (Context Check, Explore Phase, Clarifying Questions, Approval Gate, Standards Compliance), cleaned ~25 junk permission entries from settings.local.json, documented config tasks/loops duplication, archived 13 completed roadmap items, fixed Phase 6.0 claim, updated claude-code-compatibility.md for 2.1.33+, deleted .workflow/tmp leftover. LOW (8): Created self-maintenance rule, updated architecture.md, confirmed templates not orphaned, registered TeammateIdle hook (disabled), documented strictMode naming collision, fixed Phase 0.1.1 roadmap. DEFERRED (4): flow-long-input.js splitting, skill scripts consolidation, flow-orchestrate --resume, flow-utils.js splitting (all large refactoring efforts).
**Files**: .workflow/templates/partials/auto-features.hbs, .workflow/templates/partials/enforcement-rules.hbs (deleted), .workflow/templates/claude-md.hbs, .workflow/config.json, .claude/settings.local.json, .claude/docs/architecture.md, .claude/docs/claude-code-compatibility.md, .claude/docs/commands.md, .claude/rules/operations/github-releases.md, .claude/rules/architecture/self-maintenance.md (new), .workflow/state/function-map.md (new), .workflow/state/api-map.md (new), .workflow/state/function-map.md.template (new), .workflow/state/api-map.md.template (new), .workflow/agents/security.md (new), .workflow/state/decisions.md, .workflow/state/progress.md, .workflow/roadmap.md, .workflow/state/ready.json, README.md, CLAUDE.md, .claude/commands/wogi-statusline-setup.md, .claude/skills/figma-analyzer/knowledge/learnings.md (new), .workflow/tests/flows/.gitkeep (new)

### R-106 | 2026-02-19 20:30
**Type**: fix
**Tags**: #command:review #code-quality #security
**Task**: wf-cr-review9
**Request**: "Fix all code review findings from session review"
**Result**: Fixed all 18 review findings across 5 files: 2 CRITICAL (config defaults, phase ordering), 3 HIGH (path traversal, emergencyThreshold docs, heading bloat), 8 MEDIUM (quality gates, framework detection, UI extensions, shell injection, JSON.parse safety, pipeline diagram, quality gates example, task-type skip), 5 LOW (timestamp, TodoWrite cleanup, Playwright clarification). Zero tech debt remaining.
**Files**: .workflow/config.json, .claude/commands/wogi-start.md, .claude/commands/wogi-onboard.md, .claude/commands/wogi-init.md, CLAUDE.md, .workflow/state/ready.json

### R-105 | 2026-02-19 20:15
**Type**: fix
**Tags**: #command:start #task-tracking
**Task**: wf-todo-cleanup
**Request**: "Add TodoWrite cleanup step to wogi-start finalization"
**Result**: Added Step 5.2 to wogi-start finalization: close out all remaining TodoWrite items before completing a task. Prevents stale in_progress/pending items from persisting across context compactions.
**Files**: .claude/commands/wogi-start.md

### R-104 | 2026-02-19 20:05
**Type**: new
**Tags**: #command:start #webmcp #automation
**Task**: wf-webmcp-s8
**Request**: "Auto-generate WebMCP tools on component creation"
**Result**: Added Step 5.7 to wogi-start post-completion pipeline. When new UI components are created and WebMCP is enabled, auto-runs flow-webmcp-generator.js scan to generate tool definitions. Updated CLAUDE.md Task Execution Pipeline diagram and auto-feature descriptions.
**Files**: .claude/commands/wogi-start.md, CLAUDE.md

### R-103 | 2026-02-19 19:55
**Type**: new
**Tags**: #command:start #quality-gates #webmcp
**Task**: wf-webmcp-s7
**Request**: "Add WebMCP verification to wogi-start quality gates"
**Result**: Added optional webmcpVerification quality gate to wogi-start Step 4. Detects UI file changes (*.tsx, *.jsx, *.vue, *.svelte), checks WebMCP tool coverage for changed components. Non-blocking gate (suggestions only). Added to config.json feature optional gates.
**Files**: .claude/commands/wogi-start.md, .workflow/config.json

### R-102 | 2026-02-19 19:40
**Type**: change
**Tags**: #command:init #command:onboard #webmcp
**Task**: wf-webmcp-s4
**Request**: "Wire WebMCP into init/onboard flows"
**Result**: Added WebMCP capability detection to wogi-onboard (detects frontend frameworks, adds webmcp/browserTesting config sections, auto-generates tool definitions). Added WebMCP config to wogi-init stack wizard (adds config sections when frontend framework selected).
**Files**: .claude/commands/wogi-onboard.md, .claude/commands/wogi-init.md

### R-101 | 2026-02-19 19:30
**Type**: new
**Tags**: #command:test-browser #webmcp
**Task**: wf-webmcp-s6
**Request**: "Rewrite wogi-test-browser with WebMCP test flows"
**Result**: Created .claude/commands/wogi-test-browser.md with WebMCP-powered test flow protocol. Test flows defined as JSON sequences of tool calls with assertion engine (equals, contains, truthy, regex, etc.). Generates structured pass/fail reports. Includes --generate mode for auto-creating test flows from tool definitions. Registered in wogi-start, wogi-help, CLAUDE.md triggers.
**Files**: .claude/commands/wogi-test-browser.md (new), .claude/commands/wogi-start.md, .claude/commands/wogi-help.md, CLAUDE.md

### R-100 | 2026-02-19 19:20
**Type**: new
**Tags**: #command:debug-browser #webmcp
**Task**: wf-webmcp-s5
**Request**: "Rewrite wogi-debug-browser with WebMCP backend"
**Result**: Created .claude/commands/wogi-debug-browser.md with WebMCP-powered debug protocol. Uses structured tool calls from tools.json instead of screenshots. 6-step workflow: load tools, plan investigation, execute tool calls, analyze, diagnose, report. Graceful fallback when WebMCP unavailable. Registered in wogi-start command catalog, wogi-help, and CLAUDE.md trigger phrases. Added DEBUGGING section to help.
**Files**: .claude/commands/wogi-debug-browser.md (new), .claude/commands/wogi-start.md, .claude/commands/wogi-help.md, CLAUDE.md

### R-099 | 2026-02-19 19:00
**Type**: new
**Tags**: #script:webmcp-generator #webmcp
**Task**: wf-webmcp-s3
**Request**: "Create WebMCP tool generator script (flow-webmcp-generator.js)"
**Result**: Created flow-webmcp-generator.js extending BaseScanner. Scans app-map.md for interactive components, detects framework (React/Vue/Svelte), generates WebMCP tool definitions with verb_object naming, JSON Schema Draft 7 inputSchema, and annotations. Outputs to .workflow/webmcp/tools.json. CLI: flow webmcp-generate scan|show|export.
**Files**: scripts/flow-webmcp-generator.js (new), scripts/flow (edit), .workflow/webmcp/tools.json (generated)

### R-098 | 2026-02-19 18:45
**Type**: change
**Tags**: #config:models #registry
**Task**: wf-d239fcac
**Request**: "Add Claude Sonnet 4.6 to model registry"
**Result**: Added claude-sonnet-4-6 entry to registry.json with correct pricing, capabilities, and context preferences. Updated default routing primary to claude-sonnet-4-6. Updated byTaskType routing (feature, bugfix, refactor) and byLanguage (typescript). Updated costTiers standard preferredModels.
**Files**: .workflow/models/registry.json

### R-097 | 2026-02-19 18:30
**Type**: refactor
**Tags**: #config:browser #cleanup
**Task**: wf-webmcp-s2
**Request**: "Remove old browser testing code (Playwright, Chrome extension, screenshot commands)"
**Result**: Deleted 11 files (5 core scripts, 2 commands, 2 test flows, 1 template, 1 gitkeep). Cleaned 3 config sections from config.json. Removed browser references from flow-done.js, flow-workflow-steps.js, flow-task-enforcer.js, flow CLI. Updated CLAUDE.md, 7 docs/knowledge-base files, wogi-help.md, tester agent. Removed playwright dependency. 28 files changed, 3,438 deletions.
**Files**: scripts/flow-browser-*.js, .claude/commands/wogi-*-browser.md, .workflow/config.json, CLAUDE.md, and 20+ more

### R-096 | 2026-02-19 18:00
**Type**: new
**Tags**: #feature:init-onboard #wf-init-s5 #epic:epic-init-onboard #wogi-init #reference-import #cross-project #path-sanitization
**Request**: "Enhance wogi-init reference project path (Epic: Complete Init/Onboard 100% Coverage, Story 5/5)"
**Result**: Expanded wogi-init.md "Other project folder" section from simple scan to comprehensive 6-phase Reference Import Pipeline. Phase 1: Reference stack detection with user confirmation (match/partially/just-patterns). Phase 2: Deep pattern extraction across all 10 categories. Phase 3: Interactive conflict resolution with auto/manual/skip options. Phase 4: Template extraction + function/API registry scanning + product scanning. Phase 5: Skill generation from reference stack with Context7 fetch-extract-flush loop. Phase 6: State file persistence with cross-project path sanitization (sanitizeRefPath converts absolute paths to ref: prefixed relative paths). All state files (decisions.md, function-map.md, api-map.md, app-map.md) label entries as [ref] Reference Patterns. Error handling for each phase. wogi-init.md now 1105 lines total.
**Files**: .claude/commands/wogi-init.md

### R-095 | 2026-02-19 17:45
**Type**: new
**Tags**: #feature:init-onboard #wf-init-s4 #epic:epic-init-onboard #wogi-onboard #temporal-analysis #legacy-detection #migration
**Request**: "Rewrite wogi-onboard for mature/existing project analysis (Epic: Complete Init/Onboard 100% Coverage, Story 4/5)"
**Result**: Complete rewrite of wogi-onboard.md from 329 lines to 808 lines. Added 7 phases with progress indicators throughout. Phase 2 adds temporal pattern classification (current/transitional/legacy) using git-based dates with configurable thresholds (currentMonths: 6, transitionalMonths: 18). Conflict resolution now uses temporal awareness: auto-resolves when current beats legacy, or >70% dominance. Added "Both (migration in progress)" option with special MIGRATION decision format in decisions.md. Phase 4 expanded to generate all state files: stack.md, product.md, decisions.md, function-map.md, api-map.md, app-map.md, templates, ready.json, request-log.md, progress.md. Added config generation (Phase 6) with commit style detection and CI/CD detection. Added comprehensive error handling for all phases and edge cases (monorepo, large codebase, already-onboarded). Added onboard.temporal config section.
**Files**: .claude/commands/wogi-onboard.md, .workflow/config.json

### R-094 | 2026-02-19 17:30
**Type**: new
**Tags**: #feature:init-onboard #wf-init-s3 #epic:epic-init-onboard #template-extraction #file-classification #representative-selection
**Request**: "Add template extraction from reference/existing projects (Epic: Complete Init/Onboard 100% Coverage, Story 3/5)"
**Result**: Created scripts/flow-template-extractor.js (~450 lines). Implements full template extraction pipeline: (1) File classification into 6 types (component, service, test, route, hook, config) using extension, path patterns, and content markers. (2) Representative file selection with scoring algorithm — structural completeness (40%), git-based recency (30%), median line-count proximity (30%). (3) Template generation that strips implementation bodies leaving structure with // [IMPLEMENTATION], {/* [JSX_CONTENT] */}, // [TEST_BODY] markers. (4) Atomic save with temp+rename. (5) formatTemplateDecisions() generates decisions.md entries referencing extracted templates. Integrated into wogi-init.md (step 10, reference project path) and wogi-onboard.md (step 12, self-analysis path). Smoke tested: 3 types extracted from WogiFlow project (component, hook, config), templates saved correctly.
**Files**: scripts/flow-template-extractor.js (new), .claude/commands/wogi-init.md, .claude/commands/wogi-onboard.md

### R-093 | 2026-02-19 16:56
**Type**: new
**Tags**: #feature:init-onboard #wf-init-s2 #epic:epic-init-onboard #pattern-extraction #deep-mode #git-blame
**Request**: "Extend pattern extractor with missing categories and deep mode (Epic: Complete Init/Onboard 100% Coverage, Story 2/5)"
**Result**: Extended flow-pattern-extractor.js from 4 to 10 pattern categories. Added 6 new extractors: extractTypePatterns (interface prefix, type naming, enum naming, generics), extractExportPatterns (default/named, barrel files, module system), extractTestPatterns (file naming, organization, assertions, mocking, setup), extractFolderPatterns (feature-first vs type-first, co-location, index files), extractCommentPatterns (doc style, inline, headers, TODOs), extractConfigPatterns (env style, validation, defaults). Expanded extractApiPatterns with response envelope detection (data-meta, result-status), pagination patterns (page-limit, cursor, offset), error format detection (error-message, errors-array, code-message), and HTTP status code conventions. Wired _getGitFileDate() with caching for deep mode — patterns scored by git commit dates instead of unreliable file mtime. Added _currentAnalysisMode module-level variable set by extractPatterns(). Updated getPatternDescription() with 60+ new descriptions. All 8 acceptance criteria verified.
**Files**: scripts/flow-pattern-extractor.js

### R-092 | 2026-02-19 16:45
**Type**: new
**Tags**: #feature:init-onboard #wf-init-s1 #epic:epic-init-onboard #persistence-pipeline #pattern-extraction #function-map #api-map
**Request**: "Wire persistence pipeline and state file generation (Epic: Complete Init/Onboard 100% Coverage, Story 1/5)"
**Result**: Created epic-init-onboard with 5 stories. Implemented Story 1 (wf-init-s1): (1) Wired formatAsDecisions() and resolutionsToDecisions() into wogi-init.md reference project path — patterns now persist to decisions.md. (2) Added FunctionScanner.scan()/save()/generateMap() and APIScanner.scan()/save()/generateMap() to wogi-init.md Step 4.3. (3) Added app-map.md population from component extraction data. (4) Updated Step 4.3 checklist to require ALL 6 state files: ready.json, decisions.md, app-map.md, function-map.md, api-map.md, request-log.md. (5) Wired conflict resolver (both auto and interactive modes) into reference import path. (6) Rewrote wogi-onboard.md from 100-line stub to 301-line implementation with 7 phases: Project Analysis, Deep Pattern Extraction, Project Interview, Persistence Pipeline, Skill Generation, Config Generation, Summary.
**Files**: .claude/commands/wogi-init.md, .claude/commands/wogi-onboard.md, .workflow/state/ready.json, .workflow/state/epics.json, .workflow/changes/general/wf-init-s1.md, .workflow/changes/general/wf-init-s2.md, .workflow/changes/general/wf-init-s3.md, .workflow/changes/general/wf-init-s4.md, .workflow/changes/general/wf-init-s5.md

### R-091 | 2026-02-19 15:00
**Type**: change
**Tags**: #feature:claude-code-integration #wf-a7c31f02 #ai-routing #research #auto-scan #auto-bulk
**Request**: "Finalize wogi-start AI catalog, mandatory research, auto-scan, auto-bulk"
**Result**: (1) Refined command catalog from 20 to 16 commands — removed session/admin commands (morning, ready, status, health, session-end, compact, roadmap, standup), added /wogi-feature, /wogi-plan, /wogi-review-fix, /wogi-extract-review. Added Internal Tools section for auto-invoked commands. Updated CLAUDE.md with split Work/Session command tables. (2) Made research mandatory in Explore Phase with cache — added mandatoryInExplorePhase and mandatoryForHistoryResearch config keys, added research cache functions (lookupCache, cacheResult, isResearchMandatory) to research-gate.js, added cache config with TTL. (3) Wired function/API registry auto-scan into task-completed.js — now calls FunctionScanner.scan() and APIScanner.scan() after task completion when config says autoUpdate:true. (4) Added auto-bulk invocation section to wogi-start.md and wogi-epics.md — after epic creation adds 2+ stories, auto-invoke /wogi-bulk.
**Files**: .claude/commands/wogi-start.md, .claude/commands/wogi-epics.md, CLAUDE.md, .workflow/config.json, scripts/hooks/core/research-gate.js, scripts/hooks/core/task-completed.js, .workflow/state/ready.json

### R-090 | 2026-02-19 11:45
**Type**: change
**Tags**: #feature:claude-code-integration #wf-1488a40e #triage #ai-routing
**Request**: "Replace regex-based triage with AI-driven command catalog routing"
**Result**: Reverted regex pattern arrays from implementation-gate.js (restored original 5-category gate). Replaced wogi-start.md triage section with AI-driven Command Catalog (v5.0) — 20 commands listed as tools for the model to choose from based on intent, not keyword matching. Updated CLAUDE.md natural language detection table to match (19 commands with descriptions). Routing logic now lives in the prompt, not in JS code.
**Files**: scripts/hooks/core/implementation-gate.js, .claude/commands/wogi-start.md, CLAUDE.md

### R-089 | 2026-02-19 11:00
**Type**: new
**Tags**: #feature:memory #wf-154914c4 #observation-capture #rejected-approach
**Request**: "Implement rejected-approach tagging on observations"
**Result**: Added exploration_status and rejection_reason columns to observations table. Wired into 7 files: schema migration, storeObservation, searchObservationsCompact, getObservationsByIds (new fields), new updateObservationStatus/markTaskObservationsCommitted/searchRejectedObservations functions, observation-capture auto-tags failures, post-tool-use explicit rejection tagging, task-completed marks committed, session-context surfaces warnings, loop-check detects approach thrashing (3+ same-file rejections/hour), extractHighValueObservations promotes rejection patterns to facts, compactor logging updated.
**Files**: scripts/flow-memory-db.js, scripts/hooks/core/observation-capture.js, scripts/hooks/entry/claude-code/post-tool-use.js, scripts/hooks/core/task-completed.js, scripts/hooks/core/session-context.js, scripts/hooks/core/loop-check.js, scripts/flow-memory-compactor.js, scripts/hooks/entry/claude-code/session-start.js, scripts/hooks/entry/claude-code/stop.js

### R-088 | 2026-02-19 10:22
**Type**: new
**Tags**: #feature:memory #roadmap #wf-070071af
**Request**: "Add rejected-approach tagging observation idea to roadmap"
**Result**: Added detailed roadmap item under Ideas section for rejected-approach tagging on observations. Includes problem statement, proposed 5-step enhancement, key files, rationale vs full Git Context Controller, and open questions. Inspired by OneContext / Git Context Controller video analysis.
**Files**: .workflow/roadmap.md

### R-087 | 2026-02-19 10:15
**Type**: fix
**Tags**: #feature:claude-code-integration #component:claude-code-adapter #hook:stop #wf-2d3b69b3
**Request**: "Fix Stop hook JSON schema validation error"
**Result**: Removed invalid `hookSpecificOutput` from all 3 return paths in `transformStop()` in claude-code.js adapter. Claude Code's schema only supports hookSpecificOutput for PreToolUse, UserPromptSubmit, and PostToolUse events. The meaningful fields (continue, stopReason, systemMessage) were already at the top level.
**Files**: scripts/hooks/adapters/claude-code.js

### R-086 | 2026-02-19 10:05
**Type**: change
**Tags**: #feature:model-registry #component:model-adapter #component:providers #wf-0d039921
**Request**: "Add Claude Sonnet 4.6 to model registry"
**Result**: Added 'claude-sonnet-4-6' and 'sonnet-4.6' to MODEL_PATTERNS in flow-model-adapter.js, added capabilities entry for claude-sonnet-4-6 in flow-providers.js MODEL_CAPABILITIES, added Sonnet 4.6 to Anthropic model selection list in flow-providers.js.
**Files**: scripts/flow-model-adapter.js, scripts/flow-providers.js

### R-085 | 2026-02-13 20:45
**Type**: fix
**Tags**: #feature:code-quality #review-fix #wf-cr-0f99c2
**Request**: "Fix 8 code review findings from wf-18fb7974 skill generation pipeline"
**Result**: Fixed 8 issues in flow-skill-generator.js and config: (1) TOCTOU race condition - replaced existsSync+readFileSync with try-read pattern, (2) silent catch blocks - added warning logging, (3) missing context7Id format validation - tightened regex to require /org/project format, (4) unprotected patterns.md read - wrapped in try-catch, (5) module.exports ordering - moved function definitions before exports, (6) config redundancy - removed duplicate tokensPerLibrary (covered by maxTokensPerFetch), (7) path traversal guard - added entry.name validation, (8) exit code - changed to exit(1) when no skills found.
**Files**: scripts/flow-skill-generator.js, .workflow/config.json, .workflow/config.schema.json

### R-084 | 2026-02-13 17:00
**Type**: new
**Tags**: #feature:skill-generation #context7 #skills-sh #context-overflow #wf-18fb7974
**Request**: "Wire skill generation pipeline: Context7 fetch-extract-flush, skills.sh source, context overflow prevention"
**Result**: Wired the broken Context7 doc-fetching pipeline with fetch-extract-flush pattern (sequential, 5K token cap per lib). Added skills.sh as alternate skill source with 5 framework mappings (React, Next.js, Vue, NestJS, React Native). Added --fetch-docs CLI handler to flow-skill-generator.js. Rewrote wogi-init.md and wogi-setup-stack.md with proper instructions. Added skillGeneration config key with context overflow prevention settings.
**Files**: scripts/flow-skill-generator.js, scripts/flow-tech-options.js, .claude/commands/wogi-init.md, .claude/commands/wogi-setup-stack.md, .workflow/config.json, .workflow/config.schema.json

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


### R-133 | 2026-02-21 08:35
**Type**: new
**Tags**: #feature:claude-code-compat #hook:worktree #hook:session-start #module:context-estimator #module:health
**Task**: wf-5ba8e282
**Request**: "Adapt WogiFlow for Claude Code 2.1.50 — SIMPLE mode detection, worktree hooks, context adjustments, health diagnostics"
**Result**: Added 5 features: (1) CLAUDE_CODE_SIMPLE detection with session warning, (2) CLAUDE_CODE_DISABLE_1M_CONTEXT context estimator threshold adjustment, (3) Health check 2.1.50 feature reporting with claude agents diagnostic, (4) WorktreeCreate/WorktreeRemove hooks for worktree lifecycle management, (5) Documentation of isolation: worktree for future parallel execution.
**Files**: scripts/hooks/core/session-context.js, scripts/flow-context-estimator.js, scripts/flow-health.js, scripts/hooks/adapters/claude-code.js, scripts/hooks/core/worktree-lifecycle.js (new), scripts/hooks/entry/claude-code/worktree-create.js (new), scripts/hooks/entry/claude-code/worktree-remove.js (new), scripts/flow-parallel.js

### R-135 | 2026-02-25 19:30
**Type**: new
**Tags**: #feature:community #component:admin-dashboard #component:admin-api #component:admin-auth #repo:wogiflow-cloud
**Task**: wf-b7220e8b
**Request**: "Community Knowledge Maintainer Dashboard — Admin API + Static UI"
**Result**: Built maintainer dashboard for the community knowledge system. Admin API with 10 endpoints (list/action suggestions, flagged items, knowledge, stats, pipeline). Static HTML + vanilla JS dashboard with 5 tabs (Overview, Suggestions, Flagged, Knowledge, Pipeline). Bearer token auth via AWS Secrets Manager with constant-time comparison. Updated CloudFormation template with AdminFunction Lambda, API Gateway routes (GET/POST /api/admin/{proxy+}), AdminApiKey secret, and Authorization CORS header.
**Files**: `wogiflow-cloud: packages/server/routes/admin.js`, `packages/server/lib/admin-auth.js`, `packages/dashboard/index.html`, `packages/dashboard/app.js`, `deploy/cloudformation.yaml`

### R-134 | 2026-02-25 18:00
**Type**: fix
**Tags**: #feature:security #feature:community #component:flow-community #component:flow-script-resolver #component:extension-registry #component:session-start #component:flow-regression #component:flow-utils
**Task**: wf-cr-a684a4
**Request**: "Fix 17 review findings from a684a46 code review — security hardening, logic fixes, architecture cleanup"
**Result**: Fixed 16 of 17 findings across 6 files. Critical: IPv6 SSRF bypass (bracket-delimited hostnames). High: response size TOCTOU (check before append), testFiles command injection (execFileSync + path validation). Medium: PII path coverage, path traversal in UNSAFE_CHARS, config override whitespace, mergeModelIntelligence insertion order, JSDoc accuracy. Low: try-catch, version cache, dedup scope, DNS-label regex, module-level imports, dead http import, parseInt consistency. Deferred: arch-001 (SSRF validator dedup with flow-links.js — architectural task).
**Files**: `scripts/flow-community.js`, `scripts/flow-regression.js`, `scripts/flow-script-resolver.js`, `scripts/hooks/core/extension-registry.js`, `scripts/hooks/entry/claude-code/session-start.js`, `scripts/flow-utils.js`

### R-147 | 2026-02-26 15:00
**Type**: feature
**Tags**: #feature:extract-review #component:flow-extraction-review #component:flow-long-input #component:flow-long-input-stories #command:wogi-extract-review
**Task**: wf-94bd09bb
**Request**: "Unify /wogi-extract-review into single end-to-end flow — combine zero-loss extraction, 4-pass pipeline, clarification questions, and story generation into one automated flow"
**Result**: Added autoReview(), batchConfirm(), autoComplete() to flow-extraction-review.js for automated batch review. Added runFullPipeline() to flow-long-input.js to chain passes 2-4 in one call. Added generateAndExportStories() to flow-long-input-stories.js for one-call story generation and ready.json export. Rewrote wogi-extract-review.md with 6-phase AI orchestration protocol. Old manual CLI preserved as advanced mode. User's only touchpoint: answering clarifying questions when AI can't auto-resolve contradictions.
**Files**: `scripts/flow-extraction-review.js`, `scripts/flow-long-input.js`, `scripts/flow-long-input-stories.js`, `.claude/commands/wogi-extract-review.md`

### R-148 | 2026-03-04 18:30
**Type**: docs
**Tags**: #docs:knowledge-base #docs:readme
**Task**: wf-6da73daf
**Request**: "Full documentation overhaul — update KB and README to match current codebase"
**Result**: Complete overhaul of 40+ documentation files. README.md updated (version, features, commands, file structure). 3 major KB rewrites (all-options.md config paths, completion.md removed /wogi-done, figma-analyzer.md rewritten for MCP). ~20 KB files fixed (config paths, task ID format, removed nonexistent commands). 10 new KB articles written (project-audit, eval-system, quick-capture, debug-hypothesis, peer-review, branch-finalization, plan-management, rules-management, browser-debugging, long-input-extraction). Category READMEs updated with new articles and correct config paths.
**Files**: `README.md`, `.claude/docs/knowledge-base/**/*.md` (40+ files)

### R-149 | 2026-03-04 19:30
**Type**: fix
**Tags**: #component:routing-gate #hook:user-prompt-submit
**Task**: wf-ecb9b9e7
**Request**: "Fix routing gate blocking explicit /wogi-* commands"
**Result**: Fixed bug where PreToolUse hook blocked tool calls inside explicitly invoked /wogi-* commands. Root cause: UserPromptSubmit only skipped SETTING the routing flag for /wogi-* prompts but didn't CLEAR an existing flag from a previous prompt. Fix: actively call clearRoutingPending() when the prompt IS a /wogi-* command.
**Files**: `scripts/hooks/entry/claude-code/user-prompt-submit.js`

### Plugin Action | 2026-03-04 19:57
**Plugin**: test-plugin | **Action**: take-screenshot | **Mode**: standalone
**Tags**: #plugin:test-plugin

### R-207 | 2026-03-05 12:02
**Type**: new
**Tags**: #figma #component:FigmaOrchestrator #component:FigmaRegistry #component:StateAnalyzer
**Request**: "Build multi-page Figma analysis pipeline with state inference"
**Result**: Created 3 new scripts: flow-figma-registry.js (accumulating component registry from Figma data), flow-figma-state-analyzer.js (structural diffing + state inference with confidence gating), flow-figma-orchestrator.js (page-by-page processing coordinator). Modified flow-figma-match.js to support --figma-registry flag. Updated skill.md with multi-page workflow docs.
**Files**: scripts/flow-figma-registry.js, scripts/flow-figma-state-analyzer.js, scripts/flow-figma-orchestrator.js, scripts/flow-figma-match.js, .claude/skills/figma-analyzer/skill.md

### R-233 | 2026-03-11
**Type**: feature
**Tags**: #auth #login #cli #teams
**Task**: wf-f70cb258
**Request**: "Wire flow login/logout to CLI router, add interactive project selection, write cloud API requirements"
**Result**: Wired login/logout as global commands in bin/flow. Rewrote login.js with device OAuth + interactive arrow-key project selection + auto-reconnect for saved projects. Updated help text in scripts/flow (removed old team subcommands, added login/logout). Created detailed API requirements doc for cloud developer at .workflow/specs/cloud-login-api-requirements.md covering 6 endpoints + web UI + data model.
**Files**: bin/flow, lib/commands/login.js, lib/commands/logout.js, scripts/flow, .workflow/specs/cloud-login-api-requirements.md

### R-234 | 2026-03-11
**Type**: fix
**Tags**: #security #hooks #routing
**Task**: wf-89ac1676
**Request**: "Fix routing bypass hole — AI can manually insert fake tasks into ready.json inProgress"
**Result**: Added routedAt timestamp to tasks entering inProgress via moveTaskAsync() and createQuickTask(). getActiveTask() now rejects tasks without routedAt or a routing receipt file. Verified: fake tasks blocked, legitimate tasks accepted, receipt fallback works.
**Files**: scripts/flow-utils.js, scripts/hooks/core/task-gate.js

### R-235 | 2026-03-11
**Type**: fix
**Tags**: #auth #login #cli #security
**Task**: wf-e984c24b
**Request**: "Re-do login/logout CLI wiring through proper pipeline — fix quality issues from unrouted implementation"
**Result**: Extracted shared team-connection.js module (DRY fix). Fixed: exec→execFile for URL opening (command injection), added prototype pollution guards on JSON.parse, added request timeouts, file permissions 0600 on token file, fixed escape key vs arrow key ambiguity, fixed logout HTTPS-only mismatch. Extracted ANSI constants.
**Files**: lib/commands/team-connection.js (new), lib/commands/login.js, lib/commands/logout.js, bin/flow, scripts/flow

### R-236 | 2026-03-25
**Type**: refactor
**Tags**: #audit #bulk #modernization #architecture #dependencies #tech-debt
**Task**: wf-dd90ada4, wf-780e9bcc, wf-23608f2f, wf-e175a561, wf-522109a6, wf-18c2bb6f, wf-14ce6d29, wf-42cc574d, wf-10279963
**Request**: "Bulk execute all 9 remaining audit tasks"
**Result**: Completed all 9 tasks in 4 batches (5 parallel + 1 sequential + 2 parallel + 1 final). Key outcomes: || to ?? migration (101 replacements, timeout=0 bug fix), flow-long-input extraction (3677→1103 LOC), eslint 10 + @huggingface/transformers upgrade, Promise wraps modernization (63 files), learning write centralization with dedup/locking, flow-done.js gate extraction (18 handlers), autoCompactPrompt decomposition, shared hook-runner (13 hooks) + BaseWorkflowStep (7 steps), tech-debt metrics update. Net: ~120 files changed, ~3000 LOC removed. All 18 tests pass.
**Files**: 120+ files across scripts/, .claude/rules/, .workflow/state/

### R-237 | 2026-03-25
**Type**: fix
**Tags**: #review #security #logic #integration
**Task**: wf-1dd106b5
**Request**: "Fix 18 review findings from bulk audit session"
**Result**: Fixed 10 valid findings, dismissed 2 false positives (lock release — finally blocks already present), dismissed 6 low-value documentation items. Key fixes: dead code removal (flow-done-report), failMode fallback (hook-runner), init() guards (flow-long-input-passes), raw JSON.parse→safeJsonParseString (flow-model-config), type guard on file_path (flow-damage-control), defense-in-depth config path validation, orchestrator bypass migration (flow-knowledge-router), duplicate hash ID fix.
**Files**: scripts/flow-done-report.js, scripts/hooks/entry/shared/hook-runner.js, scripts/flow-long-input-passes.js, scripts/flow-model-config.js, scripts/flow-damage-control.js, scripts/flow-config-loader.js, scripts/flow-knowledge-router.js

### R-238 | 2026-04-10
**Type**: feature
**Tags**: #blast-radius #explore #consumer-impact #context-estimator
**Task**: wf-ddf13cf4
**Request**: "Mandatory blast-radius analysis for ALL L1+ tasks"
**Result**: Widened Agent 6 (Consumer Impact) trigger from refactor/migration-only to ALL L1+ tasks. Updated wogi-start.md agent table, explore-agents.md trigger conditions and fallback rules, and flow-context-estimator.js to factor in blast-radius results (breakingCount * 1% + HIGH risk buffer). Results now persisted to `.workflow/state/blast-radius-{taskId}.json`.
**Files**: .claude/commands/wogi-start.md, .claude/docs/explore-agents.md, scripts/flow-context-estimator.js

### R-239 | 2026-04-10
**Type**: feature
**Tags**: #scope-gate #assumptions #explore #wogi-start
**Task**: wf-6fd43d0f
**Request**: "Scope-confidence gate — audit assumptions before multi-day plans"
**Result**: Added Step 1.45 to wogi-start.md between explore phase and spec generation. For L0/L1 tasks, extracts every scope assumption (new tables, APIs, services), verifies each against the codebase, classifies as VERIFIED/EXISTS/UNVERIFIABLE/CONTRADICTED, and presents findings to user before spec generation proceeds. Prevents scope inflation where plans assume things need to be built that already exist.
**Files**: .claude/commands/wogi-start.md

### R-240 | 2026-04-10
**Type**: feature
**Tags**: #decision-authority #config #wogi-start #wogi-decide
**Task**: wf-b35f14e8
**Request**: "Decision-authority framework — config-driven engineering vs product decisions"
**Result**: Created flow-decision-authority.js with classifyDecision(), batchClassify(), updateCategoryAuthority(). 7 decision categories (engineering, infrastructure, productBehavior, security, ux, naming, performance) with 4 authority levels (agent-decides, agent-decides-report-after, owner-decides, auto-fix-report-after). Added cross-cutting Decision Authority Framework to wogi-start.md. Wired /wogi-decide Step 0 for authority delegation ("fix those yourself"). Added decisionAuthority schema to config.schema.json. maxOwnerQuestionsPerBatch (default 5) prevents question flooding.
**Files**: scripts/flow-decision-authority.js (new), .claude/commands/wogi-start.md, .claude/commands/wogi-decide.md, .workflow/config.schema.json

### R-241 | 2026-04-10
**Type**: feature
**Tags**: #prompt-compression #continuation #session #context-optimization
**Task**: wf-c65b2ef5
**Request**: "Skill prompt compression — continuation mode for sequential tasks"
**Result**: Created wogi-start-continuation.md (3.4KB compressed prompt vs 59.7KB full — 94.4% reduction). Added sessionTasksStarted tracking and isContinuationTask() to flow-session-state.js. Added Step 0 continuation mode check to wogi-start.md that routes to compressed prompt for 2nd+ task in session. Compressed prompt retains ALL mandatory gates (explore, scope-confidence, decision authority, criteria check, skeptical evaluator, runtime verification, wiring, standards, quality gates, sprint reset).
**Files**: .claude/commands/wogi-start-continuation.md (new), scripts/flow-session-state.js, .claude/commands/wogi-start.md

### R-242 | 2026-04-10
**Type**: feature
**Tags**: #workspace #enum-verification #cross-repo #quality-gates
**Task**: wf-b3d01071
**Request**: "Cross-repo enum verification in workspace mode"
**Result**: Added crossRepoEnumVerification quality gate to workspace-gates.js. Gate detects cross-repo type/enum mapping keywords ('maps to', 'rename to', 'corresponds to', 'enum mapping', 'type mapping') in task text and decisions. When detected, blocks until both repos are grepped for actual enum values and displayed side-by-side. Prevents axis mismatch errors (e.g., payment cadence vs compensation model). Gate registered in WORKSPACE_GATES array and runWorkspaceGate switch.
**Files**: lib/workspace-gates.js

### R-243 | 2026-04-10
**Type**: feature
**Tags**: #workspace #dispatch-verification #quality-gates #narrate-without-execute
**Task**: wf-60b96ed4
**Request**: "Dispatch verification enforcement in workspace manager mode"
**Result**: Added dispatchVerification quality gate to workspace-gates.js. In manager mode, scans task output for dispatch-claim keywords ('dispatched', 'sent to worker', 'forwarded to', 'delegated to', 'spawned agent'). When claims detected, verifies corresponding Bash/Agent tool calls exist. Blocks completion if dispatch was narrated but never executed. Gate registered in WORKSPACE_GATES array and runWorkspaceGate switch.
**Files**: lib/workspace-gates.js

### R-244 | 2026-04-10
**Type**: feature
**Tags**: #standards-gate #constructor #test-mock #drift-detection
**Task**: wf-f3f84c4d
**Request**: "Constructor-to-test-mock drift detection in standards gate"
**Result**: Added checkConstructorMockDrift() to flow-standards-gate.js. When changed files include *.service.ts, *.controller.ts, etc., extracts constructor parameters, finds corresponding *.spec.ts files, verifies mock/provider setup includes all constructor params. Missing mocks flagged as must-fix violations. Integrated into runTaskStandardsCheck() — runs automatically alongside existing standards checks.
**Files**: scripts/flow-standards-gate.js

### R-245 | 2026-04-10
**Type**: fix
**Tags**: #review #security #architecture #logic #session
**Task**: wf-cfff76db
**Request**: "Fix 13 review findings from bulk session"
**Result**: Fixed all 13 findings: (1) sessionTasksStarted now resets in SessionStart hook via resetSessionTaskCounter(), (2) removed redundant toLowerCase() — patterns use /i flag, added array validation to batch CLI, tightened regex patterns to use compound terms, (3) specPath now validated with isPathWithinProject(), (6) blast-radius path now validates taskId before construction, (7) added 3 missing gates to continuation prompt (Inventory, Item Reconciliation, Scope-Confidence), (9) dispatchVerification gate degrades gracefully when toolCalls not tracked, (10) ReDoS-safe GWT counting via individual keyword minimum, (11) renamed duplicate "Step 0" to "Step 0a", (12) single source of truth for blocked flag, (13) removed TOCTOU fileExists guard. Finding 5 (raw JSON.parse in workspace-gates) is pre-existing and outside this diff scope.
**Files**: scripts/flow-session-state.js, scripts/flow-decision-authority.js, scripts/flow-context-estimator.js, scripts/flow-standards-gate.js, lib/workspace-gates.js, .claude/commands/wogi-start.md, .claude/commands/wogi-start-continuation.md, scripts/hooks/entry/claude-code/session-start.js

### R-246 | 2026-04-10
**Type**: new
**Tags**: #enforcement #deploy-gate #hooks #verification #mechanical-gates
**Task**: wf-584a91cf
**Epic**: epic-enforcement-gates
**Request**: "Implement Verification-Required Gate — mechanical enforcement that blocks deploys without verification"
**Result**: Created deploy-gate.js (core module) with: (1) PreToolUse hook blocks configurable deploy commands without HMAC-signed verification artifact, (2) anti-forgery via HMAC-SHA256 session key — direct Write of fake artifacts rejected, (3) source-file content hash (not git HEAD) so non-code changes don't invalidate artifacts, (4) high-water-mark route inventory (auto-add, never auto-remove), (5) P0/P1 task completion blocked without verification, (6) setup wizard via `flow deploy-gate init` that detects framework + deploy scripts, (7) all configurable via config.enforcement.deployGate. Also added defaults for all 4 enforcement gates (strikeEscalation, bugfixScope, revertFirst) to config-defaults.js.
**Files**: scripts/hooks/core/deploy-gate.js (new), scripts/flow-deploy-gate.js (new), .workflow/state/deploy-routes.json.template (new), scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/core/index.js, scripts/hooks/core/task-completed.js, scripts/flow-config-defaults.js

### R-247 | 2026-04-10
**Type**: new
**Tags**: #enforcement #strike-gate #hooks #mechanical-gates
**Task**: wf-71c0b857
**Epic**: epic-enforcement-gates
**Request**: "Implement Strike Escalation Gate — mechanical strike counter with blocking enforcement"
**Result**: Created strike-gate.js with: task-ID-grouped strike counter, strike 2 blocks Edit/Write until hypothesis documented, strike 3 auto-escalates L3→L2 requiring mini-spec, strike 4+ hard blocks with actionable escape options. Increments only on verification failure/task bounce/evaluator FAIL. Cross-gate integration: bugfix scope inventory satisfies hypothesis requirement. Production crash flag lowers thresholds.
**Files**: scripts/hooks/core/strike-gate.js (new), .workflow/state/strike-tracker.json.template (new), scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/core/index.js

### R-248 | 2026-04-10
**Type**: new
**Tags**: #enforcement #bugfix-scope #hooks #mechanical-gates
**Task**: wf-dee7022d
**Epic**: epic-enforcement-gates
**Request**: "Implement Bugfix Scope Gate — two-phase pre-classification and runtime scope monitoring"
**Result**: Created bugfix-scope-gate.js with: Phase 1 keyword extraction + feedback-patterns matching for pre-classification. Phase 2 PostToolUse file counter (excludes test/type files) triggers scope inventory requirement at threshold. Warn mode default, configurable to block. PostToolUse hook wired for L3 bugfix file tracking.
**Files**: scripts/hooks/core/bugfix-scope-gate.js (new), .workflow/state/bugfix-scope.json.template (new), scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/entry/claude-code/post-tool-use.js, scripts/hooks/core/index.js

### R-249 | 2026-04-10
**Type**: new
**Tags**: #enforcement #revert-first #deploy-history #mechanical-gates
**Task**: wf-f8e420e9
**Epic**: epic-enforcement-gates
**Request**: "Implement Revert-First Protocol — deploy history tracking and production crash workflow"
**Result**: Created flow-deploy-history.js with: production crash keyword detection + confidence scoring, revert recommendation generator with last-good commit info, crash decision recording, deploy history CLI (add/show/last-good/detect). Integrates with strike-gate via markProductionCrash() for threshold reduction. Deploy history populated by Gate 1. Off by default.
**Files**: scripts/flow-deploy-history.js (new), .workflow/state/deploy-history.json.template (new)

### R-250 | 2026-04-10
**Type**: new
**Tags**: #enforcement #scope-mutation #git-safety #fan-out #workspace #mechanical-gates
**Task**: wf-896fe249, wf-3b874a27, wf-ac7ea4e4
**Epic**: epic-enforcement-gates
**Request**: "Add scope mutation guard, destructive git safety net, fan-out escalation, verification breadth, workspace sovereignty"
**Result**: Gate 5: Scope Mutation Guard — agnostic, counts new files during fix tasks (threshold 2), detects deletion of pre-existing files, "broken ≠ remove" principle. Gate 6: Git Safety Net — auto-backup branch before git reset (>3 commits or >24h), auto-stash before checkout/restore, blocks git clean. Gate 3 Enhancement: fan-out escalation counts importers (258 for flow-utils.js) instead of pattern matching — fully agnostic. Gate 1 Enhancement: rejects verification artifacts that only cover login page, requires 3+ routes. Workspace sovereignty: workerGatesSovereign=true, managerCanSkipGates=false.
**Files**: scripts/hooks/core/scope-mutation-gate.js (new), scripts/hooks/core/git-safety-gate.js (new), scripts/hooks/core/bugfix-scope-gate.js, scripts/hooks/core/deploy-gate.js, scripts/hooks/entry/claude-code/pre-tool-use.js, scripts/hooks/entry/claude-code/post-tool-use.js, scripts/hooks/core/index.js, scripts/flow-config-defaults.js

### R-251 | 2026-04-13
**Type**: new
**Tags**: #igr #intent-grounded-reasoning #adversary #telemetry #completion-truth #enforcement #mechanical-gates #release
**Task**: wf-7104abc4, wf-209ae9f6, wf-c8021cb8
**Epic**: wf-b00262b1 (IGR), wf-7104abc4 (review fixes + enforcement hardening)
**Request**: "Build Intent-Grounded Reasoning (IGR) layer + fix all 22 review findings + harden WogiFlow's own rule enforcement with 4 mechanical gates + cut v2.13.0 release"
**Result**: Shipped IGR (8 stories — Gate Telemetry, Logic Adversary, Intent Bootstrap + trap-zone detector, Session Correction Memory, Intent Framing Pass, Architect Pass, Completion Truth Gate, Pipeline wiring + rollout). Default ON (intentGroundedReasoning.enabled=true). Adds 5 new pipeline steps (0.3, 1.15, 1.55, 1.57, 3.9), 7th explore agent (Intent & Domain Analyst), productCoherence eval dimension, /wogi-challenge + /wogi-gate-stats slash commands, flow-migrate-igr CLI, CLAUDE.md template partial. Self-review caught 22 findings — all fixed (3 high, 10 medium, 9 low). Track B added 4 mechanical enforcement gates: B1 standards-checker JSON.parse guard (when safeJsonParse importable), B2 catch-variable guard (catch (_X) where X != err), B3 PostToolUse template-change detector + flow-bridge clear-on-sync (three-layer compliant), B4 security-patterns.md §3 rewritten with copy-paste prototype-pollution guard pattern. All 18/18 tests pass; backward compat preserved (IGR-off mode byte-identical to v2.12.x).
**Files**: package.json (2.12.1→2.13.0), CLAUDE.md (regenerated), .workflow/config.{json,schema.json}, .workflow/templates/{claude-md.hbs, partials/intent-grounded-reasoning.hbs}, .workflow/agents/{architect,logic-adversary}.md, .workflow/rubrics/logic-constitution-v1.md, .workflow/epics/wf-b00262b1.md, templates/intent/{product,domain-model,glossary,user-journeys}.md.hbs, scripts/flow-{architect-pass,cli-utils,completion-truth-gate,gate-telemetry,intent-bootstrap,intent-framing,logic-adversary,migrate-igr,trap-zone}.js (new), scripts/flow-{bridge,correction-detector,done-gates,runtime-verification,standards-checker,standards-gate}.js (modified), scripts/hooks/core/template-change-detector.js (new), scripts/hooks/entry/claude-code/post-tool-use.js, .claude/commands/{wogi-challenge,wogi-gate-stats,wogi-eval,wogi-start}.md, .claude/docs/{gate-telemetry,intent-grounded-reasoning,explore-agents}.md, .claude/rules/security/security-patterns.md

### R-252 | 2026-04-13
**Type**: chore
**Tags**: #state-housekeeping #release-prep
**Task**: wf-7104abc4
**Request**: "Pre-release tree-clean: commit runtime state churn so the v2.13.0 tag has no uncommitted state"
**Result**: Committed runtime state mutations (model stats, pending-skill, prompt-history, registry-manifest, deleted pending-corrections) before tagging v2.13.0.
**Files**: .workflow/state/{pending-corrections,pending-skill,prompt-history,registry-manifest}.json, .workflow/models/stats.json, .workflow/models/stats.json.lock/info.json
