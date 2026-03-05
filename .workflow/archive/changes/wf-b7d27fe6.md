# Story: T2-S1 — DB Schema + Sync API Endpoints

**ID**: wf-b7d27fe6
**Type**: Story
**Feature**: teams
**Priority**: P1
**Parent Epic**: wf-55372124 (Phase T2)
**Depends On**: Phase T1 (wf-b2532240) — COMPLETE
**Branch**: feature/teams-t2 (in wogiflow-cloud, branched from feature/teams-t1)

## User Story

As a team backend developer, I want the database schema and REST API endpoints for state sync, so that client hooks can push/pull project state reliably.

## Description

This is the foundation story for Phase T2. It creates the DB tables for tracking synced state, version vectors, and change logs, plus the REST API endpoints that clients call during session-start (pull) and session-end (push). No sync logic yet — just the data layer and transport.

## Acceptance Criteria

### AC1: Sync state tables exist
Given the 004_sync.sql migration
When applied to the database
Then tables `sync_state`, `sync_changes`, `sync_locks` exist with correct columns, indexes, and constraints

### AC2: Project state can be stored
Given a team with a project
When the server receives a PUT to `/api/sync/:projectId/state/:fileKey`
Then the state is stored with version, hash, and timestamp
And the previous version is preserved in `sync_changes`

### AC3: Project state can be retrieved
Given stored project state for `decisions.md`
When a client sends GET `/api/sync/:projectId/state/:fileKey`
Then the current state content is returned with version and ETag header
And if client sends `If-None-Match` with matching ETag, 304 is returned

### AC4: Batch state pull works
Given a project with 5 synced files
When a client sends GET `/api/sync/:projectId/state?since=<timestamp>`
Then only files changed since that timestamp are returned
And each file includes its version, hash, and content

### AC5: Change log records all mutations
Given a state update via PUT
When the update is processed
Then a record in `sync_changes` captures: who, what, when, previous version, new version
And the audit_log also receives an entry

### AC6: Auth and membership enforced
Given a user who is NOT a member of the project's team
When they call any `/api/sync/:projectId/*` endpoint
Then they receive 403 Forbidden
And the attempt is logged in audit_log

### AC7: Input validation on state payloads
Given a PUT request with state content
When the content exceeds 1MB or contains invalid structure
Then a 400 error is returned with descriptive message
And prototype pollution patterns are rejected

### AC8: Sync lock table supports task claiming
Given the `sync_locks` table
When a lock is requested for `ready.json` entry `wf-abc123`
Then it is granted with TTL and holder info
And concurrent lock requests for the same entry return 409 Conflict

### AC9: File key validation
Given the sync API
When a client requests a fileKey not in the allowed list
Then a 400 error is returned
And only these fileKeys are accepted: `decisions`, `ready`, `app-map`, `function-map`, `api-map`, `schema-map`, `service-map`, `feedback-patterns`, `config`, `progress`, `roadmap`, `registry-manifest`, `tech-debt`, `corrections`, `project-spec`, `stack`, `architecture`, `testing`

### AC10: Rate limiting on sync endpoints
Given the sync endpoints
When a client exceeds 60 requests per minute per project
Then subsequent requests receive 429 Too Many Requests
And the rate limit is tracked per-user per-project

### AC11: Unit tests cover all endpoints
Given the sync API
When tests are run
Then all 8+ endpoints have tests covering happy path, auth failure, validation, and edge cases

### AC12: Migration is idempotent
Given the 004_sync.sql migration
When run multiple times
Then it succeeds without error (using IF NOT EXISTS / ON CONFLICT patterns)

## Technical Notes

### DB Schema — 004_sync.sql

```sql
-- Canonical project state (one row per file per project)
CREATE TABLE sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,           -- 'decisions', 'ready', 'app-map', etc.
  content TEXT NOT NULL,            -- Full file content
  content_hash TEXT NOT NULL,       -- SHA256 of content (for ETag)
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, file_key)
);

-- Change log (append-only history)
CREATE TABLE sync_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  previous_hash TEXT,               -- null for first version
  new_hash TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id),
  change_type TEXT NOT NULL DEFAULT 'update', -- 'create', 'update', 'delete'
  diff_summary TEXT,                -- Optional: human-readable summary
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Entry-level locks (for task claiming in ready.json)
CREATE TABLE sync_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  entry_id TEXT NOT NULL,           -- e.g., task ID 'wf-abc123'
  locked_by UUID NOT NULL REFERENCES users(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- TTL-based (default: 30 min)
  UNIQUE(project_id, file_key, entry_id)
);

CREATE INDEX idx_sync_state_project ON sync_state(project_id);
CREATE INDEX idx_sync_state_updated ON sync_state(project_id, updated_at);
CREATE INDEX idx_sync_changes_project ON sync_changes(project_id, file_key, created_at DESC);
CREATE INDEX idx_sync_locks_expires ON sync_locks(expires_at);
CREATE INDEX idx_sync_locks_project ON sync_locks(project_id, file_key);
```

### API Endpoints — routes/sync.js

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/:projectId/state` | Batch pull (with `?since=` filter) |
| GET | `/api/sync/:projectId/state/:fileKey` | Get single file state |
| PUT | `/api/sync/:projectId/state/:fileKey` | Push file state |
| DELETE | `/api/sync/:projectId/state/:fileKey` | Delete file state |
| POST | `/api/sync/:projectId/locks` | Acquire entry lock |
| DELETE | `/api/sync/:projectId/locks/:lockId` | Release lock |
| GET | `/api/sync/:projectId/locks` | List active locks |
| GET | `/api/sync/:projectId/changes` | Get change log |

### Files to Create

- `packages/server/db/004_sync.sql` — Migration
- `packages/server/lib/sync.js` — Sync data access layer
- `packages/server/lib/validate-sync.js` — Sync-specific validators (or extend validate.js)
- `packages/server/routes/sync.js` — API route handler
- `packages/server/tests/unit/sync.test.js` — Unit tests
- `deploy/cloudformation.yaml` — Add SyncFunction Lambda + routes

### Files to Modify

- `deploy/cloudformation.yaml` — New Lambda function + API Gateway routes
- `packages/server/lib/validate.js` — Add sync validators (or create validate-sync.js)

### Boundaries (DO NOT modify)

- `packages/server/lib/auth.js` — Use as-is
- `packages/server/lib/oauth.js` — Use as-is
- `packages/server/lib/device-auth.js` — Use as-is
- `packages/server/db/003_teams.sql` — Do not alter T1 schema
- All community/curation code — Do not touch

## Test Strategy

- **Unit tests**: All sync.js functions with mocked DB
- **Endpoint tests**: Each route with valid auth, invalid auth, validation errors
- **Lock tests**: Concurrent lock attempts, TTL expiry, release
- **ETag tests**: 304 Not Modified responses, If-None-Match header handling

## Verification Commands

```bash
node --check packages/server/lib/sync.js
node --check packages/server/routes/sync.js
cd packages/server && node --test tests/unit/sync.test.js
```

## Complexity

Medium-High (new DB tables + 8 endpoints + validation + tests)
