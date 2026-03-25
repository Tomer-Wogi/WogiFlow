# Project Roadmap

Future work and deferred phases. Items here are ideas/plans, not yet refined into stories.

**Auto-managed by WogiFlow** - Items are added when large features are broken into phases.

---

## Now (Current Focus)

<!-- Items actively being worked on. Usually maps to stories in ready.json -->

---

## Next (Ready to Plan)

<!-- Items to tackle after current work. Ready to be promoted to stories. -->

### WogiFlow Auto-Testing Suite (Epic: wf-eda35519)

**Status:** Planned — Epic created with 6 stories in backlog
**Created:** 2026-03-10
**Depends On:** None (extends existing quality gates, WebMCP, project analyzer)

**What It Does:**
Adds comprehensive auto-testing to WogiFlow: auto-generates tests from spec acceptance criteria during `/wogi-start`, runs them as quality gates on task completion, and provides `/wogi-test` command for on-demand verification. Covers UI testing (Playwright MCP accessibility tree), API testing (direct HTTP, zero dependencies), and data integrity chain (API response ↔ UI rendering).

**Key Principles:**
- **Conditional/opt-in** — Auto-detected during onboarding, zero overhead when disabled
- **Zero external accounts** — Playwright is MIT/npm, API tests use native fetch()
- **Auto-detection** — Project scan determines frontend/backend/fullstack → enables correct test modes
- **Self-configuring** — `/wogi-test` installs missing dependencies on first use

**Stories (in dependency order):**
1. `wf-a89f4901` — Testing Infrastructure & Auto-Detection
2. `wf-63d980fc` — Test Generation Subagent (Step 1.7 in pipeline)
3. `wf-9024aad9` — UI Testing via Playwright MCP (parallel with 4)
4. `wf-8df22d40` — API Testing Suite (parallel with 3)
5. `wf-f640ff98` — Data Integrity Chain (API↔UI)
6. `wf-eb696bab` — /wogi-test Command & Quality Gate Integration

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

**Status:** COMPLETE. Client-side (wf-ec88195b, 2026-02-25). Server-side pgvector dedup + priority detection + GitHub issues (wf-e50c90c7, 2026-02-26).
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

### WogiFlow for Teams — Paid SaaS Extension (Option B: Thin Adapter + Server-Side)

**Status:** Planned
**Created:** 2026-02-22
**Updated:** 2026-02-26 (Architecture decision: Option B — thin adapter, server-side team logic)
**Depends On:** None (existing hook architecture is the extension point)
**Architecture:** Option B — thin adapter interface in the free `wogiflow` package (login/logout + API client), all team logic lives server-side in `wogiflow-cloud`. No private npm package (`@wogiflow/teams` is NOT needed).

**Architecture Decision (2026-02-26):**
The free `wogiflow` npm package contains a thin "team adapter" layer:
- `flow login` / `flow logout` commands — clean toggle that connects/disconnects a project to a team
- API client for team server communication (HTTP calls only)
- Login adds `team` section to config, enables sync hooks
- Logout removes `team` section, reverts to local-only, keeps all local state intact
- All real team logic (sync engine, permissions, approvals, marketplace) stays server-side
- **No team code in the free repo** — strict boundary enforced

**Benefits over @wogiflow/teams npm approach:**
- No private npm package to manage or distribute
- No team code ships in any client package
- Easier to update team features without requiring CLI updates
- Open source repo never touches team logic
- Users don't need to install a separate package — `flow login` just works

**Revenue Model:**
- Solo WogiFlow: Free forever (everything that exists today, MIT license)
- Teams: Per-seat pricing (cloud sync, team rules, approval flow, templates, dashboard)
- Enterprise: Higher per-seat + SSO/SAML, audit logs, self-hosted option
- Marketplace: Revenue share with verified publishers (70/30)

**Repo Structure:**
```
Repo 1: wogi-flow (existing, public, MIT, npm: wogiflow)
  - All existing code unchanged
  - Thin team adapter: login/logout + API client (HTTP calls only)
  - No team logic — just the interface to connect

Repo 2: wogiflow-cloud (private monorepo)
  packages/
    server/      → API server (Node.js + PostgreSQL) — ALL team logic here
    dashboard/   → Web app (wogiflow.com)
    shared/      → Shared TypeScript types and constants
```

**Login/Logout Flow:**
```
npx flow login                    # Authenticate with email
  → OAuth flow (GitHub/Google/email)
  → Server returns team config + API endpoints
  → Adds team section to .workflow/config.json
  → Enables sync hooks (session-start pull, session-end push)
  → State files get server backing (bidirectional sync)

npx flow logout                   # Revert to local-only
  → Removes team section from config
  → Disables sync hooks
  → All local state preserved (nothing lost)
  → Works exactly like free WogiFlow again
```

**What changes after login:**
| Aspect | Free (default) | After `flow login` |
|--------|----------------|---------------------|
| State files | Local `.workflow/state/` only | Local + synced to team server |
| Knowledge base | Community only (local) | Community + team shared knowledge |
| Config | `config.json` with local settings | Adds `team` section with team ID, role |
| Reviews | Local review reports | Reviews visible to team |
| Decisions/rules | Per-project only | Team rules inherited + local overrides |
| Marketplace | N/A | Access to team marketplace |

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

**Status:** COMPLETE (wf-b2532240, 2026-02-26). OAuth 2.0 (GitHub + Google), JWT RS256 + opaque refresh tokens, RFC 8628 device auth, teams/projects CRUD, PostgreSQL schema (8 tables), CloudFormation (4 Lambdas), dashboard login + device approval pages, 150 unit tests.
**Depends On:** None

**Scope:**
- PostgreSQL schema + migrations (orgs, users, projects, members, audit_log)
- Auth system: OAuth 2.0 (GitHub, Google, email) + CLI device authorization flow
- Basic REST API: orgs, users, projects, members, invites
- `flow auth login` / `flow team projects` CLI commands in @wogiflow/teams
- Web dashboard: login, org creation, member invite
- Auth token storage: `~/.wogiflow/auth.json`

**Key Files (wogiflow-cloud):**
- `packages/server/db/003_teams.sql` — 8 tables with indexes/constraints
- `packages/server/lib/auth.js` — JWT + refresh tokens + auth middleware
- `packages/server/lib/oauth.js` — GitHub + Google OAuth + user upsert
- `packages/server/lib/device-auth.js` — RFC 8628 device code management
- `packages/server/lib/teams.js` — Team/member/project CRUD + audit log
- `packages/server/lib/validate.js` — 6 new validators
- `packages/server/routes/auth.js` — OAuth authorize/callback + refresh
- `packages/server/routes/device-auth.js` — Device auth flow endpoints
- `packages/server/routes/teams.js` — Teams CRUD + member management
- `packages/server/routes/projects.js` — Projects CRUD under teams
- `packages/dashboard/login.html` — OAuth login page
- `packages/dashboard/device.html` — Device code approval page
- `deploy/cloudformation.yaml` — 4 new Lambdas, secrets, API routes

**Minimal changes to free wogiflow:**
- `lib/installer.js` — Detect @wogiflow/teams, auto-register its hooks
- `scripts/flow-utils.js` — Export state reader APIs for Teams to consume
- `.workflow/config.json` schema — Add empty `team` section

---

#### Phase T2: State Sync + Task Management (Sprint 3-4)

**Status:** COMPLETE (wf-55372124, 2026-02-26). 5 stories: S1 DB schema + sync API (wf-b7d27fe6), S2 server-side merge engine (wf-8cc0ee60), S3 task claiming/locking/assignment (wf-669671eb), S4 client sync hooks + offline queue (wf-7ee14d40), S5 team presence + status (wf-9976667c). 363 tests passing, feature/teams-t2 branch.
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

**Status:** COMPLETE (epic-teams-t3, 6 stories, 2026-02-26). S1 Team Rules CRUD (wf-a01e3149), S2 Team Templates (wf-9eb7323a), S3 Knowledge Sharing (wf-8203b06b), S4 Integration Framework (wf-2d0af595), S5 Jira Integration (wf-98c1c0b2), S6 GitHub Integration (wf-e8d21b8e). 39 new files, 370 tests passing.
**Depends On:** Phase T2: State Sync (COMPLETE)

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

**Status:** COMPLETE (epic-teams-t4, 6 stories, 2026-02-27). S1 Pattern Aggregation Engine (wf-5e7d92b2), S2 Approval Request System (wf-8188b390), S3 Review Queue Dashboard (wf-d8e65112), S4 Promotion Paths (wf-0c966f37), S5 Notification System (wf-5cc1b1a5), S6 Team Analytics Dashboard (wf-6c425e29). 20+ new files across server/dashboard. Post-review: 43 findings, 35+ fixed across 16 files (wf-cr-t4rv01).
**Depends On:** Phase T3: Team Knowledge (COMPLETE)

**Scope:**
- Pattern aggregation engine (cross-user pattern detection)
- Approval request system (8 CRUD + action endpoints, role-based access)
- Review queue dashboard (GitHub dark theme, bulk actions, detail panel)
- 4 promotion pipelines (correction→decision, pattern→rule, learning→knowledge, team→global)
- Notification system (in-dashboard + AWS SES email, 30s polling, preferences)
- Team analytics dashboard (Chart.js, 6 metric endpoints, date range selection)

**Key Files (wogiflow-cloud):**
- `packages/server/aggregation/pattern-engine.js` — Cross-user pattern detection
- `packages/server/aggregation/promotion-engine.js` — 4 promotion pipelines
- `packages/server/lib/approvals.js` — Approval lifecycle management
- `packages/server/lib/notifications.js` — Event-driven notifications
- `packages/server/lib/analytics.js` — Aggregation queries
- `packages/server/routes/approvals.js` — 8 endpoints
- `packages/server/routes/notifications.js` — 6 endpoints
- `packages/server/routes/analytics.js` — 6 endpoints
- `packages/dashboard/approvals.html` + `.js` — Review queue UI
- `packages/dashboard/analytics.html` + `.js` — Analytics charts

**DB tables:**
- `aggregated_patterns`, `pattern_occurrences`, `approval_requests` (S1)
- `approval_comments` (S2)
- `notifications`, `notification_preferences` (S5)

---

#### Phase T5: Marketplace & Global Knowledge (Sprint 9-10)

**Status:** COMPLETE (epic-teams-t5, 2026-02-27). 6 stories, 4 batches. 3 DB migrations (014-016), 4 new route files, 3 new lib files, 5 dashboard pages. 6440+ lines of code across 25 files.
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

**Status:** COMPLETE (epic-teams-t6, 7 stories, 2026-02-28). S1 Team Dashboard (wf-e6dcbe53), S2 Project Health Dashboard (wf-8882f678), S3 Cross-Project Search (wf-7136dcd6), S4 Anomaly Detection & Review Insights (wf-d442d1f1), S5 Onboarding Intelligence (wf-2fb327a9), S6 Enterprise Tier (wf-74ca67ad), S7 Documentation & Launch Materials (wf-6c2ea871). All 7 stories committed. Full Teams roadmap (T1-T6) COMPLETE.
**Depends On:** Phase T5: Marketplace (COMPLETE)

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

#### Free Package Extension Points (Thin Team Adapter)

**Status:** PARTIALLY COMPLETE (wf-dcf132cb, 2026-02-25 — config schema + hook registration done)
**Updated:** 2026-02-26 (Architecture change: replaced @wogiflow/teams detection with thin adapter)
**Depends On:** None

**Scope:** Changes to the free `wogiflow` package to enable team connectivity:

**Already done:**
1. **`scripts/flow-utils.js`** — State reader functions exported
2. **`.workflow/config.json` schema** — Empty `team: {}` section with `projectId`, `orgId`, `enabled` fields
3. **`scripts/hooks/core/index.js`** — Extension hook registration

**Still needed (new architecture):**
4. **`scripts/flow-team-adapter.js`** — Thin API client for team server communication (HTTP calls only, no team logic)
5. **`flow login` / `flow logout` CLI commands** — OAuth flow, config toggle, hook enable/disable
6. **Session hooks update** — When team is connected: pull on start, push on end (delegates to server API)
7. **Remove** `@wogiflow/teams` detection from `lib/installer.js` — no longer needed (thin adapter replaces npm package approach)

These are backwards-compatible. Free users see no change. `flow login` is the only entry point to team features.

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

### Consolidate Executable Code: Merge .workflow/lib/ and .workflow/bridges/ into scripts/

**Priority**: Medium
**Status**: Idea — bundle with next major version (2.0)
**Created**: 2026-03-10
**Source**: Developer proposal, reviewed and approved for deferral

**Problem:** `.workflow/` mixes executable code (`lib/`, `bridges/`) with project data (`state/`, `config.json`, `templates/`). This violates clean separation of concerns.

**Proposal:** Move all executable code to `scripts/` so `.workflow/` contains ONLY data, state, config, and templates:
- `.workflow/lib/assumption-detector.js` → `scripts/lib/assumption-detector.js`
- `.workflow/lib/config-substitution.js` → `scripts/lib/config-substitution.js`
- `.workflow/lib/failure-categories.js` → `scripts/lib/failure-categories.js`
- `.workflow/bridges/base-bridge.js` → `scripts/bridges/base-bridge.js`
- `.workflow/bridges/claude-bridge.js` → `scripts/bridges/claude-bridge.js`
- `.workflow/bridges/index.js` → `scripts/bridges/index.js`

**Impact:** 6 files to move, 7 import paths to update. Breaking change for installed users.

**Migration strategy:**
1. Add re-export shims at old paths with deprecation warnings (non-breaking interim step)
2. In next major version (2.0), remove shims and old paths
3. Migration script in `postinstall.js` for upgrade path

**Why deferred:** Low ROI for standalone change. No bugs, no confusion, no capability unlocked. Dual-repo coordination needed (wogiflow-cloud imports from free package). Bundle with other 2.0 breaking changes.

---

### Cloud Rule Sync via InstructionsLoaded Hook

**Priority**: Low
**Status**: Idea
**Created**: 2026-03-05
**Source**: Claude Code release adaptations — InstructionsLoaded hook brainstorm

When a team is connected (`flow login`), use the InstructionsLoaded hook to detect stale team rules. On instructions load, check if locally-cached team rules are older than a configurable TTL (e.g., 1 hour). If stale, pull fresh rules from the team server and merge into local `.claude/rules/`. This would complement the session-start pull by catching rule changes mid-session (e.g., when CLAUDE.md is reloaded after a bridge sync).

**Depends On**: Teams Phase T3 (Team Knowledge) — requires team rules sync infrastructure
**Scope**: Add team rule staleness check to `scripts/hooks/core/instructions-loaded.js`, integrate with `flow-team-adapter.js` API client.

---

### Claude Code Plugin Marketplace Manifest

**Priority**: Low
**Status**: Idea
**Created**: 2026-02-25
**Source**: Comparison research with obra/superpowers

Create a `.claude-plugin/plugin.json` manifest to enable distribution via the Claude Code plugin marketplace alongside the existing npm distribution. Superpowers uses this for one-line installs (`/plugin install superpowers@superpowers-marketplace`). Would give WogiFlow a second discovery/install channel.

**Scope:**
- Create `.claude-plugin/plugin.json` with plugin metadata
- Create `hooks/hooks.json` for hook registration
- Ensure SessionStart hook works via plugin system (currently works via `.claude/settings.json`)
- Test plugin install/uninstall lifecycle
- Submit to `anthropic/claude-code-plugins` marketplace (or equivalent)

**Why Low Priority:** npm distribution works well. Plugin marketplace is an additional channel, not a replacement. Do after all Teams phases are complete.

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

### Claude Code 2.1.81 Compatibility Update

**Status:** Deferred
**Created:** 2026-03-21
**Depends On:** None

**Scope:**
1. Update compatibility table in `claude-code-compatibility.md` for 2.1.78-2.1.81
2. Add `--bare` mode detection (like existing `CLAUDE_CODE_SIMPLE` detection in `session-context.js:271-279`)
3. Document `--bare` in compatibility notes — what breaks (hooks, CLAUDE.md, skills, auto-memory), when to use it, and the `ANTHROPIC_API_KEY` requirement

**Template:** Follow the `CLAUDE_CODE_SIMPLE` story (`wf-5ba8e282`) as the exact pattern for `--bare` detection.

---

### Claude Code --channels Integration (Discussion)

**Status:** Deferred — discuss in future session
**Created:** 2026-03-21
**Depends On:** wogiflow-cloud maturity

**Scope:**
1. Document `--channels` setup guide for headless/CI WogiFlow sessions (forwarding tool approval prompts to phone)
2. Evaluate `--channels` as wogiflow-cloud team approval mechanism — team leads approve tool calls from dashboard/phone. Aligns with teams approval workflow concept.

**Notes:** `--channels` requires channel servers that declare the permission capability. wogiflow-cloud could act as a channel server. WogiFlow's current "channels" references are unrelated (npm release channels, notification channels).

---

### Claude Code --bare for Programmatic Execution (Discussion)

**Status:** Deferred — discuss in future session
**Created:** 2026-03-21
**Depends On:** 2.1.81 compatibility update above

**Scope:**
Explore using `claude --bare -p "..."` for scripted, no-improvisation Claude execution within WogiFlow:
- CI/CD automated reviews (`flow ci-review`)
- Hybrid mode enhancement: Opus plans, `--bare` executes atomic edits
- Batch sub-task execution in `/wogi-bulk-loop`

**Key insight:** `--bare` strips all ambient context (CLAUDE.md, hooks, skills, auto-memory). Claude only knows what's in the prompt — no improvisation beyond the instruction. Requires `ANTHROPIC_API_KEY` (no OAuth).

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
