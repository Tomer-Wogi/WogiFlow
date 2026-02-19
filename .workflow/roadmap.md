# Project Roadmap

Future work and deferred phases. Items here are ideas/plans, not yet refined into stories.

**Auto-managed by WogiFlow** - Items are added when large features are broken into phases.

---

## Now (Current Focus)

<!-- Items actively being worked on. Usually maps to stories in ready.json -->

---

## Next (Ready to Plan)

<!-- Items to tackle after current work. Ready to be promoted to stories. -->

### Phase 0.1.2: Claude Template

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System (Completed)

**Assumes:**
- CLI Template System implemented
- Handlebars rendering working

**Key Files:**
- `scripts/flow-bridge.js` - Template renderer
- `.workflow/cli/templates/claude.hbs` - New template location

**Implementation Plan:**
1. Migrate current CLAUDE.md generation to template
2. Add progressive discovery references
3. Test sync command

---

### Phase 0.1.6: Sync Command

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 0.1.1: CLI Template System (Completed)

**Assumes:**
- Template system implemented
- All CLI templates created (0.1.2-0.1.5)

**Key Files:**
- `scripts/flow` - Add sync subcommand
- `scripts/flow-bridge.js` - Sync logic

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

### PR with Media — Auto-Create Rich PRs

**Status:** Deferred
**Created:** 2026-02-08
**Depends On:** Story 4: Debug Browser (Playwright fallback + artifact capture)

**Assumes:**
- Playwright fallback is working with video recording
- Debug sessions save screenshots and videos to `.workflow/debug-sessions/`
- `gh` CLI is installed and authenticated

**Problem:**
PRs are text-only. After implementing a feature, there's no automated way to include before/after screenshots, demo videos, or inline change annotations.

**Solution:**
Auto-create PRs with rich media:
- Summary from task spec (acceptance criteria as checklist)
- Before/after screenshots from debug sessions
- Demo video from Playwright recording
- Inline change annotations (what changed and why)

**Key Files:**
- `scripts/flow-pr-media.js` - New file: PR generation with media
- `.claude/commands/wogi-pr.md` - New command file
- `.workflow/debug-sessions/` - Source for screenshots/video

**Implementation Plan:**
1. Create `flow-pr-media.js` that:
   - Reads task spec for PR summary
   - Finds debug session artifacts (screenshots, video)
   - Uploads media as GitHub release assets or inline base64
   - Generates PR body with embedded media
2. Create `/wogi-pr` command that:
   - Generates PR with `gh pr create`
   - Attaches task completion report
   - Embeds before/after screenshots
   - Links demo video
3. Add config for media preferences (max screenshots, video format)

**Example PR Body:**
```markdown
## Summary
- [x] Login form validates email format
- [x] Error messages display below inputs
- [x] Submit disables during API call

## Demo
![Demo Video](link-to-recording.webm)

## Screenshots
| Before | After |
|--------|-------|
| ![before](iter-1.png) | ![after](iter-final.png) |

## Changes
- `src/components/LoginForm.tsx` — Added validation logic
- `src/api/auth.ts` — Added error response types
```

---

---

## Later (Future Phases)

<!-- Deferred items from large feature breakdowns. Includes dependency tracking. -->

### Phases 0.1.3-0.1.5, 0.1.7-0.1.10: Multi-CLI Support (CANCELLED)

**Status:** Cancelled
**Cancelled:** 2026-02-19
**Reason:** Multi-CLI support was never implemented. These phases described Codex, Gemini CLI, OpenCode, Cursor, and Kimi templates, hook integrations, installer updates, CLI detection, and a multi-CLI adapter system. None of this code was ever written. Dead references were cleaned up in wf-f0a3106f. If multi-CLI support is revisited in the future, it should start fresh with a new epic based on current CLI landscapes.

---

### Phase 5.1.1: Release Channel Configuration

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 5.1: npm Package Distribution (Completed)

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
**Depends On:** Phase 5.1: npm Package Distribution (Completed)

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
**Depends On:** Phase 5.1: npm Package (Completed), Phase 0.1: CLI Agnosticism

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

### Phase 6.0: Team Collaboration Backend

**Status:** Deferred
**Created:** 2026-01-14
**Depends On:** None

**Assumes:**
- AWS backend infrastructure ready (Cognito, API Gateway)
- Subscription model defined

**Key Files (to create):**
- `scripts/flow-team.js` - Team login, logout, setup selection
- `scripts/flow-team-sync.js` - Knowledge sync with backend
- `scripts/flow-team-dashboard.js` - Team status display

**Context When Deferred:**
Features require:
- Active AWS backend (api.wogi-flow.com)
- Subscription/payment system
- Team invite code generation

**Commands (to implement):**
- `/wogi-team login <code>` - Join team with invite
- `/wogi-team logout` - Leave team
- `/wogi-team sync` - Manual knowledge sync
- `/wogi-team proposals` - View/vote on rule proposals
- `/wogi-team status` - Connection and sync status

**Implementation Plan:**
1. Create team scripts (flow-team.js, flow-team-sync.js, flow-team-dashboard.js)
2. Activate AWS backend infrastructure
3. Implement subscription validation
4. Create team invite flow
5. Test knowledge sync across team members
6. Create command files for slash commands

---

### Phase 6.1: Team Observability Web UI

**Status:** Deferred
**Created:** 2026-01-13
**Depends On:** Phase 6.0: Team Collaboration Backend

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

### Phase 7: Visual Review Session

**Status:** Deferred
**Created:** 2026-01-20
**Depends On:** None

**Assumes:**
- ffmpeg available for audio/video processing
- OpenAI API key available for Whisper transcription
- Existing long-input-gate patterns can be extended for task detection

**Problem:**
When reviewing designs (Figma, browser, etc.), users speak feedback and tasks aloud. Currently employees manually write down every comment, transcripts alone lack visual context ("this button" = which button?), and there's no automated task extraction.

**Solution:**
Record screen + audio → Extract tasks with visual context → Generate WogiFlow stories

**Key Files:**
- `scripts/flow-visual-review.js` - Main orchestrator
- `scripts/flow-visual-review-media.js` - Audio/frame extraction (ffmpeg)
- `scripts/flow-visual-review-transcribe.js` - Whisper API integration
- `scripts/flow-visual-review-correlate.js` - Timestamp alignment
- `scripts/flow-visual-review-detect.js` - Task detection (extends long-input patterns)
- `scripts/flow-visual-review-confirm.js` - Interactive confirmation (figma-confirm pattern)
- `.claude/commands/wogi-visual-review.md` - Command documentation
- `.claude/skills/visual-review/skill.md` - Skill definition

**Modifications to Existing:**
- `flow-long-input-parsing.js` - Export pattern constants for reuse
- `flow-story.js` - Add `visualReferences` field support
- `flow-utils.js` - Add PATHS for visual review assets
- `.workflow/config.json` - Add `visualReview` config section

**Storage Structure:**
```
.workflow/
├── assets/visual-review-{sessionId}/    # Screenshots
├── changes/visual-review-{sessionId}/   # Stories
└── tmp/visual-review/{sessionId}/       # Processing temp files
```

**Config Schema:**
```json
{
  "visualReview": {
    "enabled": true,
    "transcriptionBackend": "openai",
    "confidenceThresholds": { "autoAdd": 0.85, "confirm": 0.6 },
    "keyframeInterval": 2000,
    "maxScreenshotsPerTask": 3
  }
}
```

**Implementation Phases:**
1. Foundation: Orchestrator, audio extraction, Whisper transcription, frame extraction
2. Task Detection: Extend long-input patterns, timestamp correlation, confidence scoring
3. Interactive Confirmation: Readline-based flow (approve/edit/skip/combine)
4. Story Generation: Extend flow-story.js, embed screenshots, update ready.json
5. Live Capture (Future): Browser extension integration, real-time capture

**Dependencies:**
- Required: `ffmpeg`, OpenAI API key
- Optional: `whisper-cpp` (local transcription), Claude browser extension (live capture)

---

---

## Ideas (Exploration)

<!-- Nice-to-have, not committed. No dependencies tracked yet. -->

### Plan Management System

**Priority**: Medium
**Status**: Needs Discussion

A formal system for creating, tracking, and cleaning up implementation plans.

**Current State**:
- `.claude/plans/` exists but is informal (just exempted from task gating)
- No creation workflow, no cleanup after implementation
- Claude Code 2.1.9 added `plansDirectory` setting (their feature)

**Potential Features**:
- `flow plan create "title"` - Create plan from template
- `flow plan list` - Show active plans
- `flow plan archive <id>` - Archive completed plan
- `flow plan status` - Show plan → implementation tracking
- Auto-archive when linked tasks complete

**Open Questions (Needs User Input)**:
- Should plans be Wogi Flow's responsibility or delegate to CLI?
- What's the plan lifecycle? Draft → Approved → Implementing → Done → Archived?
- Should plans link to tasks/stories in ready.json?
- Cleanup: auto-archive vs manual vs never delete?

**Why Deferred**: Needs discussion with user before design decisions.

---

### Structured JSON Contract

**Why deferred**: Local LLMs can't reliably produce JSON. Current flow-response-parser.js handles messy output.

---

### SQLite Telemetry

**Why deferred**: JSON files work fine for 50 runs/day. Would reconsider if users need complex queries.

---

### Move npm to @wogi Organization

**Why deferred**: Current `wogiflow` package works fine. Migration adds complexity (scoped package, update all docs). Consider when team grows or branding matters.

---

### `/wogi-learn` - Learning Opportunity Command

**Priority**: Low
**Status**: Idea

Explain current work using 80/20 rule for non-technical PMs learning as they build.

**Input**: None (uses current context)
**Output**: Simple explanation of what we're building and why

**Use Case**: PMs who are "vibe coding" often don't fully understand what's being built. This command provides educational context about:
- What the current task is doing
- Why we're making these changes
- Key concepts being used (80/20 rule - most important 20% of concepts)
- How it fits into the bigger picture

**Implementation Ideas**:
- Analyze current task context
- Identify key technical concepts
- Generate beginner-friendly explanations
- Highlight architectural decisions

**Why Deferred**: Lower priority than core workflow features.

---

### Voice Input Integration

**Priority**: Low

**Why deferred**: Feature complexity vs immediate value. Requires external dependencies (sox, whisper-cpp) and has UX challenges (no native way to inject transcript as Claude prompt).

**When to revisit**:
- When MCP supports audio input tools
- When Claude Code gets native voice input
- If user demand increases

**Original scope**:
- Record audio via sox
- Transcribe via whisper-cpp (local) or OpenAI/Groq APIs
- Output transcript for user to paste as prompt
- Auto-trigger long-input-gate for long transcripts

---

## Completed

<!-- Archive of completed roadmap items for reference -->

### Phase 0.1.1: CLI Template System

**Implemented:** 2026-01-13 (as CLI Bridge system)
**Files:** `scripts/flow-bridge.js`, `scripts/flow-bridge-state.js`, `.workflow/templates/claude-md.hbs`, `.workflow/templates/partials/`
**Notes:** Implemented as `flow bridge sync` command with Handlebars rendering. Generates Claude Code instructions (CLAUDE.md).

---

### Phase 1.1: Formalized Model Registry

**Implemented:** 2026-01-11 (R-042)
**Files:** `scripts/flow-models.js`, `.workflow/models/registry.json`

---

### Phase 1.2: Enhanced Model Stats

**Implemented:** 2026-01-11 (R-042)
**Files:** `scripts/flow-models.js`, `.workflow/models/stats.json`

---

### Phase 2.1: Multi-Model Mode

**Implemented:** 2026-01-11 (R-045)
**Files:** `scripts/flow-task-analyzer.js`, `scripts/flow-model-router.js`, `scripts/flow-prompt-composer.js`

---

### Phase 2.2: Prompt Fragment System

**Implemented:** 2026-01-11 (R-045)
**Files:** `scripts/flow-prompt-composer.js`, `.workflow/prompts/fragments/`

---

### Phase 3.1: Task Router

**Implemented:** 2026-01-11 (R-046)
**Files:** `scripts/flow-model-router.js`, `scripts/flow-task-analyzer.js`

---

### Phase 3.2: Cascade Fallback

**Implemented:** 2026-01-11 (R-046)
**Files:** `scripts/flow-cascade.js`

---

### Phase 3.3: Tiered Learning Thresholds

**Implemented:** 2026-01-11 (R-046)
**Files:** `scripts/flow-tiered-learning.js`

---

### Phase 4.1: Parallel Dispatch

**Implemented:** 2026-01-11 (R-048)
**Files:** `scripts/flow-parallel-dispatch.js`

---

### Phase 4.2: Context Priority Scoring

**Implemented:** 2026-01-11 (R-048)
**Files:** `scripts/flow-context-scoring.js`

---

### Phase 4.3: Quality Gate Confidence

**Implemented:** 2026-01-11 (R-048)
**Files:** `scripts/flow-gate-confidence.js`

---

### Phase 5.1: npm Package Distribution

**Implemented:** 2026-01-12
**Notes:** Published as `wogiflow` on npm, currently v1.2.0

---

### Phase 6.2: Jira/Linear Integration

**Implemented:** 2026-01-11 (R-049)
**Files:** `scripts/flow-jira-integration.js`, `scripts/flow-linear-integration.js`

---

### Phase 6.3: Background Sync Daemon

**Implemented:** 2026-01-11 (R-049)
**Files:** `scripts/flow-sync-daemon.js`

---

### Recursive Enhancement Protocol (All 6 Phases)

**Implemented:** Prior to 2026-01-09
**Notes:** All 6 phases implemented including multi-pass review, recursive context compaction, phased task execution, epic management, and error recovery with hypothesis generation.

---

### Hierarchical Work Items (Plans, Epics, Features, Stories)

**Implemented:** Prior to 2026-01-09
**Notes:** Full hierarchy from Plans down to Stories implemented in ready.json and workflow commands.

---

### Session Learning Analysis

**Implemented:** Prior to 2026-01-09
**Files:** `scripts/flow-adaptive-learning.js`

---

### Multi-CLI Support (6 CLIs)

**Implemented:** Prior to 2026-01-13
**Notes:** Support for Claude Code via bridge system. Multi-CLI support was planned but never implemented (cancelled in wf-f0a3106f).

---

### Function & API Registries

**Implemented:** Prior to 2026-01-13
**Files:** `.workflow/state/function-map.md`, `.workflow/state/api-map.md`
**Notes:** function-map.md and api-map.md registries with flow function-index and flow api-index scan commands.

---

### Standards Compliance (Phase 3 of Review)

**Implemented:** Prior to 2026-01-13
**Notes:** Multi-pass review includes standards compliance pass.

---

### Solution Optimization (Phase 4 of Review)

**Implemented:** Prior to 2026-01-13
**Notes:** Multi-pass review includes solution optimization pass.

---

### WebMCP Integration (Browser Testing)

**Implemented:** Prior to 2026-02-08
**Notes:** Replaced Playwright/Puppeteer approach. Browser testing via WebMCP integration is implemented. The "Browser Testing Integration" idea in the Ideas section (Playwright-based) is superseded by this.

---

### Agent Teams Integration

**Implemented:** Prior to 2026-01-13
**Notes:** Agent team coordination implemented for parallel review and task execution.

---

### Universal /wogi-start Entry Point

**Implemented:** Prior to 2026-01-13
**Files:** `.claude/commands/wogi-start.md`
**Notes:** Universal entry point routing exploration, operational, quick-fix, bug, and implementation requests to the appropriate action.

---

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
