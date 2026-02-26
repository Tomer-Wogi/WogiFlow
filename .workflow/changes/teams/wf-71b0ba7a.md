# T5-S5: Global Knowledge — Team Curation Layer

**ID**: wf-71b0ba7a
**Epic**: epic-teams-t5
**Type**: Story (L1)
**Priority**: P1
**Repo**: wogiflow-cloud
**Branch**: feature/teams-t2

## User Story

As a team admin, I want to promote community knowledge entries to enforced team rules, so that valuable global patterns are automatically adopted by my team.

## Description

Extends the Community Knowledge system (Phase C1-C2) with a team-level curation layer (Layer 3). Team admins can browse community knowledge, promote entries to team rules (using the existing approval flow from T4), and manage which global patterns apply to their team. This bridges Layer 4 (Global/Community) with Layer 3 (Team).

## Acceptance Criteria

### AC1: Team Knowledge Browse API
Given an authenticated team member
When they browse available community knowledge
Then:
- `GET /api/teams/:teamId/global-knowledge` — List community knowledge entries relevant to the team
- Entries come from `global_knowledge` table (Phase C1)
- Response includes: category, content, quality_score, report_count, already_promoted (boolean)
- Filter by category: model_intelligence, error_recovery, pattern_convergence, skill_learnings
- Sort by quality_score DESC (default), newest, most_reported

### AC2: Promote to Team Rule
Given a team admin viewing community knowledge
When they promote an entry
Then:
- `POST /api/teams/:teamId/global-knowledge/:entryId/promote` — Create approval request for promotion
- Creates an `approval_requests` record with request_type='knowledge_promotion', content containing the global knowledge entry
- Uses existing T4 approval flow — goes through review queue
- On approval, creates a `team_rules` entry with the knowledge content
- Rule is marked as `source: 'community_knowledge'` and `enforced: false` (admin can later enforce)
- Tracks `global_knowledge_promotions` (team_id, global_knowledge_id, team_rule_id, promoted_at)

### AC3: Global Knowledge Promotions Schema (migration 016)
Given the database
When migration 016 runs
Then:
- `global_knowledge_promotions` table: (id UUID PK, team_id REFERENCES teams, global_knowledge_id UUID REFERENCES global_knowledge, approval_request_id UUID REFERENCES approval_requests, team_rule_id UUID REFERENCES team_rules, promoted_at TIMESTAMPTZ DEFAULT NOW())
- Index on (team_id, global_knowledge_id) UNIQUE — prevent duplicate promotions

### AC4: Promotion Dashboard
Given the team dashboard
When an admin navigates to "Global Knowledge"
Then:
- `/knowledge.html` extended with "Community Knowledge" tab
- Card list of available community entries with quality score badge
- "Promote to Team Rule" button → confirmation dialog
- "Already Promoted" badge on entries the team has adopted
- Filter/sort controls

### AC5: Dismiss/Ignore Flow
Given a team admin
When they don't want a community entry
Then:
- `POST /api/teams/:teamId/global-knowledge/:entryId/dismiss` — Mark as dismissed for this team
- Dismissed entries don't appear in browse (filterable)
- `dismissed_global_knowledge` tracking (team_id, global_knowledge_id, dismissed_at, reason?)

## Technical Notes

### Files to Create
- `packages/server/db/016_global_knowledge_promotions.sql` — Migration
- `packages/server/routes/global-knowledge.js` — Team-scoped global knowledge endpoints
- `packages/server/lib/global-knowledge.js` — Promotion logic, dismiss logic

### Files to Modify
- `packages/dashboard/knowledge.html` — Add Community Knowledge tab
- `packages/dashboard/knowledge.js` — Add community browse + promote UI logic

### Patterns
- Reuse T4 approval flow: creating an approval_request triggers the existing review queue
- Reuse promotion-engine: add a new `knowledge_promotion` handler (or extend existing `knowledge_contribution`)
- Follow existing `team-knowledge.js` route pattern
- Community entries from `global_knowledge` table (Phase C1) — read-only from this team's perspective

## Dependencies
- Phase C1-C2 (Community Knowledge — `global_knowledge` table must exist)
- T4-S2 (Approval Request System — for promotion flow)
- T3-S1 (Team Rules — for rule creation on approval)

## Test Strategy
- Test browse filtering and pagination
- Test promote flow end-to-end (promote → approval → team rule)
- Test duplicate promotion prevention
- Test dismiss flow
- Test that promoted entries show "Already Promoted" badge
