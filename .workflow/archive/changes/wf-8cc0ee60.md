# Story: T2-S2 — Server-Side Sync Engine

**ID**: wf-8cc0ee60
**Type**: Story
**Feature**: teams
**Priority**: P1
**Parent Epic**: wf-55372124 (Phase T2)
**Depends On**: wf-b7d27fe6 (T2-S1: DB Schema + API)
**Branch**: feature/teams-t2 (in wogiflow-cloud)

## User Story

As a team member, I want the server to intelligently merge state changes from multiple team members, so that concurrent edits don't overwrite each other and each file type uses the right merge strategy.

## Description

This story adds the merge engine that sits behind the sync API. When a client pushes state, the server doesn't just overwrite — it applies a file-type-aware merge strategy. The engine handles: append-only files (feedback-patterns, progress), last-write-wins files (registries, config), and structured merge files (decisions.md with sections, ready.json with entries).

## Acceptance Criteria

### AC1: Append-only merge for feedback-patterns
Given two team members push feedback-patterns.md concurrently
When the server processes both pushes
Then both entries are preserved (appended)
And no data is lost

### AC2: Last-write-wins for registry maps
Given two team members push app-map.md with different entries
When the server processes both pushes
Then the latest push wins for conflicting entries
And non-conflicting entries from both are preserved

### AC3: Entry-level merge for ready.json
Given member A claims task wf-001 and member B adds task wf-002
When the server processes both pushes
Then both changes are preserved (different entries)
And task wf-001 shows as claimed by member A

### AC4: Admin-only push for config.json
Given a member with role 'member' attempts to push config.json
When the server processes the push
Then it is rejected with 403
And only 'admin' or 'owner' role can push config

### AC5: Version conflict detection
Given a client pushes with version N
When the server's current version is N+1 (someone else updated)
Then the server returns 409 Conflict with the current version
And the client can re-fetch, re-merge, and retry

### AC6: Diff generation for change log
Given a state update
When the merge completes
Then a human-readable diff summary is stored in sync_changes
And includes: added lines, removed lines, changed sections

### AC7: Section-level merge for decisions.md
Given decisions.md with PIN-marked sections
When two users edit different sections
Then both edits are preserved (non-conflicting sections merge cleanly)
And if same section is edited, latest wins with conflict marker

### AC8: Merge strategies are configurable per project
Given a project's sync config
When an admin sets a custom merge strategy for a file
Then the server uses that strategy instead of the default

## Technical Notes

### Files to Create

- `packages/server/sync/engine.js` — Core merge engine
- `packages/server/sync/strategies/append-only.js` — Append merge
- `packages/server/sync/strategies/last-write-wins.js` — LWW merge
- `packages/server/sync/strategies/entry-level.js` — JSON entry merge
- `packages/server/sync/strategies/section-merge.js` — PIN-aware markdown merge
- `packages/server/tests/unit/sync-engine.test.js` — Engine tests

### Files to Modify

- `packages/server/routes/sync.js` — Wire engine into PUT handler
- `packages/server/lib/sync.js` — Add merge method calls

### Default Strategy Map

```javascript
const MERGE_STRATEGIES = {
  'decisions': 'section-merge',
  'ready': 'entry-level',
  'app-map': 'last-write-wins',
  'function-map': 'last-write-wins',
  'api-map': 'last-write-wins',
  'schema-map': 'last-write-wins',
  'service-map': 'last-write-wins',
  'feedback-patterns': 'append-only',
  'config': 'admin-push',
  'progress': 'append-only',
  'roadmap': 'section-merge',
  'registry-manifest': 'last-write-wins',
  'tech-debt': 'entry-level',
  'corrections': 'append-only',
  'project-spec': 'last-write-wins',
  'stack': 'last-write-wins',
  'architecture': 'last-write-wins',
  'testing': 'last-write-wins'
};
```

## Complexity

High (multiple merge strategies, conflict detection, section parsing)
