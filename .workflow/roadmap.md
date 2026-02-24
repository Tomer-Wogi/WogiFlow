# Project Roadmap

Future work and deferred phases. Items here are ideas/plans, not yet refined into stories.

**Auto-managed by WogiFlow** - Items are added when large features are broken into phases.

---

## Now (Current Focus)

<!-- Items actively being worked on. Usually maps to stories in ready.json -->

---

## Next (Ready to Plan)

<!-- Items to tackle after current work. Ready to be promoted to stories. -->

### Community Knowledge System — Free User Knowledge Sharing

**Status:** Planned
**Created:** 2026-02-23
**Depends On:** None (builds on existing session hooks and state files)
**Architecture:** Client-side in free `wogiflow` package + server-side in `wogiflow-cloud` repo. Server infrastructure becomes the foundation Teams builds on.

**What It Does:**
WogiFlow accumulates valuable learnings locally (model adapter profiles, error recovery strategies, coding patterns). Currently these stay on each user's machine. Community Knowledge shares universally-valuable, anonymous learnings across ALL free WogiFlow users — not just Teams.

**Key Principles:**
- **Server-side AI curation** — No manual human review. AI agents (Haiku/Sonnet/Opus hybrid) categorize, deduplicate, evaluate quality, and decide what gets promoted to Global Knowledge.
- **`/wogi-suggest` command** — Users submit ideas, feature requests, and improvement suggestions while working.
- **Privacy-first** — Anonymous (UUID), opt-in, no code ever leaves the machine.

**What Gets Shared (5 Categories):**

| Category | Sent (anonymous) | Users Get Back |
|----------|-----------------|----------------|
| Model Intelligence | Model name + strength/weakness/adjustment | "Claude Sonnet: add explicit step numbering for multi-step tasks" |
| Error Recovery | Error category + strategy + success rate | "IMPORT_ERROR with Sonnet: use explicit_imports strategy (87%)" |
| Pattern Convergence | Pattern name + rule text (no project context) | "90% of users converge on: wrap fs.readFileSync in try-catch" |
| Session Statistics | Aggregated only: avg tasks/session, failure types | "Most used model: Claude Sonnet 4.5 (62% of sessions)" |
| Skill Learnings | Skill name + pattern/anti-pattern text | "figma-analyzer: always specify frame ID for better results" |

**Never sent:** Code snippets, file paths, project names, user names, task descriptions, acceptance criteria, request-log content.

**Server-Side AI Curation Pipeline (5 Stages):**

| Stage | Model | Purpose |
|-------|-------|---------|
| 1. Intake | Haiku | Validate, classify, strip PII |
| 2. Dedup | Haiku + embeddings | Semantic similarity search (pgvector) |
| 3. Quality | Sonnet | Score accuracy, universality, actionability, novelty |
| 4. Consolidation | Sonnet | Merge near-duplicates into stronger entries |
| 5. Promotion | Opus (borderline) | Auto-promote (score >= 7.0, 3+ reports) or flag for review |

**Cost estimate:** ~$0.01-0.03 per submission. At 1000/day = ~$10-30/day.

**Relation to Teams:** This system is distinct from Teams (which adds team-level sync, dashboards, paid features). Community Knowledge benefits all free users. The server infrastructure (API, DB, AI pipeline) becomes the foundation Teams Phase T1+ builds on.

---

#### Phase C1: Community Knowledge Foundation (2 sprints)

**Status:** COMPLETE. Client-side (wf-0c000481, 2026-02-25). Server-side API + DB + AI curation pipeline (wf-ebb51efe, 2026-02-24). Maintainer dashboard + admin API + CloudFormation (wf-b7220e8b, 2026-02-25).
**Created:** 2026-02-23
**Depends On:** None

**Scope:**

*Server (wogiflow-cloud repo):*
- API endpoints: `POST /api/community/contribute`, `GET /api/community/knowledge`, `POST /api/community/suggest`
- PostgreSQL schema: `community_submissions`, `global_knowledge`, `user_suggestions`, `curation_log`
- AI Curation Pipeline (Stages 1-5) with Haiku/Sonnet/Opus hybrid model selection
- Basic maintainer dashboard: suggestion backlog + flagged items queue

*Client (free wogiflow package):*
- `scripts/flow-community.js` — Push/pull community knowledge logic
- `.claude/commands/wogi-suggest.md` — Slash command for user suggestions
- Session-end hook addition — Collect and push anonymized learnings (fire-and-forget, 5s timeout)
- Session-start hook addition — Pull curated knowledge, merge into local state (24h cache)
- Config schema addition — `community` section (enabled, categories, serverUrl, cacheTtl)
- PII stripping — Replace file paths with `[PATH]`, project names with `[PROJECT]`, strip request-log content
- Opt-in flow — Clear explanation of what's shared and what's never shared
- Anonymous ID — UUID v4 stored in `~/.wogiflow/anon-id`

**Key Files (client-side, free package):**
- `scripts/flow-community.js` — Push/pull logic
- `.claude/commands/wogi-suggest.md` — Command definition
- `scripts/hooks/entry/claude-code/session-end.js` — Add community push call
- `scripts/hooks/entry/claude-code/session-start.js` — Add community pull call
- `lib/installer.js` — Add community config defaults
- `.workflow/config.json` schema — Add `community` section
- `.workflow/templates/claude-md.hbs` — Add `/wogi-suggest` to command reference

**Key Files (server, wogiflow-cloud repo):**
- `packages/server/routes/community.js` — API endpoints
- `packages/server/curation/pipeline.js` — AI curation orchestrator
- `packages/server/curation/stages/intake.js` — Stage 1
- `packages/server/curation/stages/dedup.js` — Stage 2
- `packages/server/curation/stages/quality.js` — Stage 3
- `packages/server/curation/stages/consolidation.js` — Stage 4
- `packages/server/curation/stages/promotion.js` — Stage 5
- `packages/server/db/migrations/001_community.sql` — Schema
- `packages/dashboard/app/community/` — Maintainer dashboard pages

**DB Schema:**
- `community_submissions` — Incoming contributions with pipeline tracking
- `global_knowledge` — Curated entries served to users (with pgvector embeddings)
- `user_suggestions` — Ideas/bugs/improvements from `/wogi-suggest`
- `curation_log` — Full audit trail of pipeline decisions with cost tracking

**Config Addition:**
```json
{
  "community": {
    "enabled": false,
    "anonymousId": null,
    "categories": {
      "modelIntelligence": true,
      "errorRecovery": true,
      "patternConvergence": true,
      "sessionStatistics": true,
      "skillLearnings": true
    },
    "pushOnSessionEnd": true,
    "pullOnSessionStart": true,
    "cacheTtlHours": 24,
    "serverUrl": "https://api.wogiflow.com"
  }
}
```

---

#### Phase C2: Community Intelligence (1 sprint)

**Status:** Client-side COMPLETE (wf-ec88195b, 2026-02-25). Server-side (pgvector dedup, priority detection, dashboard stats) remaining.
**Created:** 2026-02-23
**Depends On:** Phase C1: Community Knowledge Foundation

**Scope:**
- Embedding-based dedup with pgvector (semantic similarity thresholds: >0.92 exact, 0.75-0.92 near-match, <0.75 new)
- Community priority detection — suggestions with 10+ votes auto-flagged for maintainer
- "Community suggests: ..." surfacing in local sessions (informational, not enforced)
- Community stats on maintainer dashboard (active contributors, knowledge entries, suggestion trends)
- GitHub issue auto-creation for accepted suggestions (`gh issue create` from dashboard)
- Offline queue — `~/.wogiflow/pending-suggestions.json`, sent on next session-start

**Key Files (server):**
- `packages/server/curation/stages/dedup.js` — Enhanced with pgvector
- `packages/server/routes/community.js` — Priority detection endpoints
- `packages/dashboard/app/community/stats.js` — Community analytics

**Key Files (client):**
- `scripts/flow-community.js` — "Community suggests" local surfacing
- Session-start hook — Merge community knowledge into local model adapters, failure learnings

---

### WogiFlow for Teams — Paid SaaS Extension (Option B: Separate Repo)

**Status:** Planned
**Created:** 2026-02-22
**Depends On:** None (existing hook architecture is the extension point)
**Architecture:** Option B — separate private repo (`wogiflow-cloud`) with `@wogiflow/teams` npm package extending the free `wogiflow` package via hooks.

**Revenue Model:**
- Solo WogiFlow: Free forever (everything that exists today, MIT license)
- Teams: Per-seat pricing (cloud sync, team rules, approval flow, templates, dashboard)
- Enterprise: Higher per-seat + SSO/SAML, audit logs, self-hosted option
- Marketplace: Revenue share with verified publishers (70/30)

**Repo Structure:**
```
Repo 1: wogi-flow (existing, public, MIT, npm: wogiflow)
  - All existing code unchanged
  - Add minimal extension points for Teams hooks
  - Export internal APIs Teams needs (state readers, config helpers)

Repo 2: wogiflow-cloud (new, private monorepo)
  packages/
    client/      → npm: @wogiflow/teams (extends wogiflow via hooks)
    server/      → API server (Node.js + PostgreSQL)
    dashboard/   → Next.js web app (wogiflow.com)
    shared/      → Shared TypeScript types and constants
```

**Four-Layer Knowledge Architecture:**
```
Layer 4: GLOBAL     — All WogiFlow users (model tips, known issues, context tricks)
Layer 3: TEAM       — Organization rules, standards, templates, shared skills
Layer 2: PROJECT    — decisions.md, registries, ready.json, request-log, feedback-patterns
Layer 1: USER       — session-state, preferences, draft corrections, local memory
```

**Rule resolution:** Lower layers override higher (project beats team), but team admins can mark rules as "enforced" (cannot be overridden).

---

#### Phase T1: Foundation (Sprint 1-2)

**Status:** Planned
**Depends On:** None

**Scope:**
- PostgreSQL schema + migrations (orgs, users, projects, members, audit_log)
- Auth system: OAuth 2.0 (GitHub, Google, email) + CLI device authorization flow
- Basic REST API: orgs, users, projects, members, invites
- `flow auth login` / `flow team projects` CLI commands in @wogiflow/teams
- Web dashboard: login, org creation, member invite
- Auth token storage: `~/.wogiflow/auth.json`

**Key Files (new repo):**
- `packages/server/db/migrations/001_foundation.sql`
- `packages/server/routes/auth.js`, `routes/orgs.js`, `routes/projects.js`
- `packages/client/flow-cloud-auth.js` — CLI auth (device flow, OAuth)
- `packages/client/flow-team.js` — Team management CLI
- `packages/dashboard/app/` — Next.js pages

**Minimal changes to free wogiflow:**
- `lib/installer.js` — Detect @wogiflow/teams, auto-register its hooks
- `scripts/flow-utils.js` — Export state reader APIs for Teams to consume
- `.workflow/config.json` schema — Add empty `team` section

---

#### Phase T2: State Sync + Task Management (Sprint 3-4)

**Status:** Planned
**Depends On:** Phase T1: Foundation

**Scope:**
- Bidirectional sync engine for all project-level state:
  - `decisions.md` (append + admin merge)
  - Registry maps: `app-map.md`, `function-map.md`, `api-map.md`, `schema-map.md`, `service-map.md` (last-write-wins per entry)
  - `ready.json` (task-level locking for claiming)
  - `feedback-patterns.md` (append-only)
  - `epics.json` (epic-level locking)
  - `config.json` (admin-controlled push)
  - `progress.md` (append-only per user)
  - `roadmap.md` (section-level merge via PIN system)
  - `registry-manifest.json` (merge registries)
- Gap files also synced:
  - `tech-debt.json` (bidirectional, item merge)
  - `decision-amendments.json` (append-only → audit_log table)
  - `pending-corrections.json` (push to approval queue)
  - `corrections/CORR-*.md` (push as structured records)
  - `specs/project.md`, `stack.md`, `architecture.md`, `testing.md` (bidirectional, last-write-wins)
  - `damage-control.yaml` (admin push, enforced)
- Session hooks: pull on start (non-blocking), push on end (queue if offline)
- Task claiming/locking (prevent two people starting same task)
- Task assignment model (assigned vs unassigned pool)
- Live team presence (heartbeat every 5min + WebSocket)
- `flow team tasks` / `flow team status` CLI commands
- Offline-first: local state is source of truth, sync in background
- Cloud-first for task claiming and admin approvals only

**Sync behavior:**
- Offline: show warning "Working in offline mode", queue operations
- Online: session-start pulls, session-end pushes, periodic push every N minutes
- Handle "file doesn't exist yet" gracefully (some learning files are created on first use)
- Regenerate locally post-sync: `section-index.json`, `component-index.json`, `export-map.json`
- After pulling `decisions.md`: run `flow-rules-sync.js` to regenerate `.claude/rules/`

**Key Files (new repo):**
- `packages/client/flow-cloud-sync.js` — Bidirectional sync engine
- `packages/client/hooks/session-start-cloud.js` — Pull team rules + project state
- `packages/client/hooks/session-end-cloud.js` — Push state changes
- `packages/client/hooks/task-completed-cloud.js` — Sync task status
- `packages/server/sync/engine.js` — Server-side sync (CRDT or last-write-wins)
- `packages/server/routes/sync.js` — State sync API endpoints

**DB tables:**
- `decision_rules`, `registry_entries`, `request_log_entries`, `tasks`
- `tech_debt_items`, `corrections`

---

#### Phase T3: Team Knowledge + Integrations (Sprint 5-6)

**Status:** Planned
**Depends On:** Phase T2: State Sync

**Scope:**
- Team rules CRUD (web dashboard)
- Rule cascade: team → project (CTO pushes rule → all projects get it on next session)
- Enforced vs overridable rules
- Team templates: export from project (`flow team export-template`), apply to new projects
  - Template includes: decisions.md, .claude/rules/, config.json, skills, specs/stack.md, specs/architecture.md, damage-control.yaml
- CTO rule push notifications
- Model adapter learnings shared at team level (`.workflow/model-adapters/*.md`)
- Model profiles shared at team level
- Unified model registry per team
- Skill learnings shared at team level (`.claude/skills/*/knowledge/*.md`)
- CLAUDE.md templates (`.hbs` files) synced as team-level config
- Review checklists (`.workflow/agents/*.md`) shared via templates
- Hook configuration synced as team-level enforced config
- **Jira integration**: OAuth connect, webhook inbound, bidirectional sync (ticket → task → completion → Jira update)
- **GitHub integration**: issues → tasks, PR linking, commit attribution
- **Bitbucket integration**: issues → tasks (lower priority)

**Jira mapping:** Issue Key → externalId, Summary → title, Description → AI-parsed AC, Assignee → matched by email, Priority → P0-P4, Status → configurable transitions

**Unmatched Jira assignee:** Block sync until admin maps user on dashboard

**Key Files (new repo):**
- `packages/server/routes/team-rules.js`, `routes/templates.js`
- `packages/server/integrations/jira-adapter.js`, `github-adapter.js`, `bitbucket-adapter.js`, `base-adapter.js`
- `packages/dashboard/app/team-rules/`, `app/templates/`, `app/integrations/`

**DB tables:**
- `team_rules`, `team_templates`
- `model_learnings`, `model_profiles`, `skill_learnings`
- `integrations`, `external_task_mappings`

---

#### Phase T4: Approval Flow (Sprint 7-8)

**Status:** Planned
**Depends On:** Phase T3: Team Knowledge

**Scope:**
- Pattern aggregation engine (cross-user pattern detection)
- Pending review queue on web dashboard (like PR review)
- Approve/Modify/Dismiss with comments and audit trail
- Auto-flagging: pattern appears across 3+ users → surfaces for admin review
- Promotion paths:
  - Project correction → Project decision
  - Project pattern (3+ occurrences) → Team rule
  - User model learning → Team knowledge
  - Team pattern (cross-project) → Global knowledge candidate
- Notification system (email + in-dashboard)
- Bulk approve for low-risk patterns
- Command metrics aggregation for team analytics dashboard
- Gate confidence trends for quality analytics

**Key Files (new repo):**
- `packages/server/routes/reviews.js`
- `packages/server/aggregation/pattern-engine.js`
- `packages/dashboard/app/reviews/`

**DB tables:**
- `feedback_patterns` (extended with `users_affected`, `status`)
- Reuse `audit_log` for all approval decisions

---

#### Phase T5: Marketplace & Global Knowledge (Sprint 9-10)

**Status:** Planned
**Depends On:** Phase T4: Approval Flow, Phase C1-C2 (Community Knowledge)

**Scope:**
- Marketplace listings: browse, search, install templates/skills/knowledge-packs
- Verified publisher program (apply + portfolio review before publishing)
- Star ratings + usage stats + download counts + version pinning
- **Global Knowledge (Teams layer):** Extends Community Knowledge (Phase C1-C2) with team-level curation:
  - Team admins can promote community knowledge to enforced team rules
  - Team-specific knowledge layer (Layer 3) builds on community layer (Layer 4)
  - Community infrastructure (API, DB, AI pipeline) is reused — no duplication
- Aggregated model adapter learnings shared at team level (extends community model intelligence)
- Memory DB: keep local, but add `flow memory export-team` to extract high-value observations

**Note:** Phase 5.2 (Skill Library Marketplace) from the existing roadmap is ABSORBED into this phase.
**Note:** The Global Knowledge foundation (collection, AI curation, distribution) is now in Phase C1-C2 (Community Knowledge). This phase adds team-level extensions on top of that foundation.

**Key Files (new repo):**
- `packages/server/routes/marketplace.js`, `routes/global.js`
- `packages/server/curation/knowledge-pipeline.js`
- `packages/client/flow-marketplace.js`
- `packages/dashboard/app/marketplace/`

**DB tables:**
- `marketplace_listings`, `marketplace_reviews`
- `global_knowledge`

---

#### Phase T6: Polish & Launch (Sprint 11-12)

**Status:** Planned
**Depends On:** Phase T5: Marketplace

**Scope:**
- Team dashboard: presence, health analytics, activity feed
- Project Health Dashboard: compliance rate, pattern velocity, debt trends, registry coverage, throughput
- Cross-project search (`flow team search "date formatting"`)
- Anomaly detection (5x more corrections than average, debt growing 3x faster)
- Session summaries for team leads
- Onboarding score for new team members
- Smart template suggestions during `flow onboard` ("This looks like Next.js + Prisma, your team has a matching template")
- Review insights (top recurring findings across team)
- Enterprise tier: SSO/SAML, audit log exports, self-hosted option prep
- Documentation + launch materials

**Key Files (new repo):**
- `packages/dashboard/app/analytics/`, `app/health/`, `app/search/`
- `packages/server/analytics/anomaly-detection.js`

---

#### Free Package Extension Points (Minimal Changes)

**Status:** COMPLETE (wf-dcf132cb, 2026-02-25)
**Depends On:** None

**Scope:** Small changes to the free `wogiflow` package to enable Teams extension:

1. **`lib/installer.js`** — Detect `@wogiflow/teams` in node_modules, auto-register its hooks in `.claude/settings.local.json`
2. **`scripts/flow-utils.js`** — Ensure state reader functions are exported (most already are)
3. **`.workflow/config.json` schema** — Add empty `team: {}` section with `projectId`, `orgId`, `enabled` fields
4. **`scripts/hooks/core/index.js`** — Add extension hook registration (allow Teams to register additional core hooks)

These are backwards-compatible. Free users see no change.

---

## Later (Future Phases)

<!-- Deferred items from large feature breakdowns. Includes dependency tracking. -->


### Phase 5.2: Skill Library Marketplace

**Status:** Absorbed into WogiFlow for Teams → Phase T5
**Created:** 2026-01-13
**Notes:** Marketplace functionality is now part of the Teams product (Phase T5: Marketplace & Global Knowledge). Includes verified publisher program, ratings, version pinning, and revenue share model.

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


### Move npm to @wogi Organization

**Why deferred**: Current `wogiflow` package works fine. Migration adds complexity (scoped package, update all docs). Consider when team grows or branding matters.

---

### `/wogi-explain` - PM Education Command

**Priority**: Low
**Status**: Idea

Explain current work using 80/20 rule for non-technical PMs learning as they build. (Note: `/wogi-learn` name is taken — it handles pattern promotion to decision rules.)

**Input**: None (uses current context)
**Output**: Simple explanation of what we're building and why

**Use Case**: PMs who are "vibe coding" often don't fully understand what's being built. This command provides educational context about:
- What the current task is doing
- Why we're making these changes
- Key concepts being used (80/20 rule - most important 20% of concepts)
- How it fits into the bigger picture

**Why Deferred**: Lower priority than core workflow features.

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

### Phase 0.1.2: Claude Template

**Implemented:** 2026-02-22 (discovered during roadmap audit)
**Files:** `.workflow/templates/claude-md.hbs`, `.workflow/templates/partials/`, `scripts/flow-bridge.js`
**Notes:** CLAUDE.md generation uses Handlebars templates with partials. `flow bridge sync` regenerates from templates.

---

### Phase 0.1.6: Sync Command

**Implemented:** 2026-02-22 (discovered during roadmap audit)
**Files:** `scripts/flow-bridge.js`
**Notes:** `flow bridge sync` command detects active CLIs and generates all CLI-specific files. Includes `sync`, `status`, `list` subcommands.

---

### Phase 0.2: Failure Category Enum

**Implemented:** 2026-02-22 (discovered during roadmap audit)
**Files:** `.workflow/lib/failure-categories.js`
**Notes:** Formalized FailureCategory with 14+ categories including code, description, severity, escalate flag, patterns, and strategy. Used by flow-adaptive-learning.js.

---

### Phase 0.3: Variable Substitution in Config

**Implemented:** 2026-02-22 (discovered during roadmap audit)
**Files:** `scripts/flow-utils.js` (`resolveConfigValue()`)
**Notes:** Supports `{env:VAR}` for environment variables and `{file:path}` for file-based secrets. Applied during config loading.

---

### Phase 5.1.2: LSP Tool Integration

**Implemented:** 2026-02-22 (discovered during roadmap audit)
**Files:** `scripts/flow-lsp.js` (923 lines)
**Notes:** Full LSP client wrapper with TypeScript Language Server detection, stdin/stdout protocol handling, initialization, and request/response management.

---

### Plan Management System

**Implemented:** 2026-02-22 (discovered during roadmap audit)
**Files:** `scripts/flow-plan.js`, `.claude/commands/wogi-plan.md`
**Notes:** Full plan CRUD with creation, linking to epics/features, archival, and status tracking.

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
