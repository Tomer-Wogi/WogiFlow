# T5-S2: Marketplace Search + Install Flow

**ID**: wf-daaf0644
**Epic**: epic-teams-t5
**Type**: Story (L1)
**Priority**: P1
**Repo**: wogiflow-cloud
**Branch**: feature/teams-t2

## User Story

As a WogiFlow team member, I want to search the marketplace and install packages, so that I can quickly adopt proven templates, skills, and knowledge packs.

## Description

Add public discovery endpoints (browse, search, filter), the install/uninstall flow, star ratings, and download tracking. These are the consumer-facing APIs that the dashboard (S4) will use.

## Acceptance Criteria

### AC1: Public Browse/Search API
Given any authenticated user
When they search the marketplace
Then these endpoints work:
- `GET /api/marketplace/browse` — Browse all published listings (paginated, 20/page)
- `GET /api/marketplace/browse?type=template&tags=react&q=auth` — Filter by type, tags, text search
- `GET /api/marketplace/browse?sort=stars|downloads|newest` — Sort options
- `GET /api/marketplace/:slug` — Get public listing detail with latest version + stats
- Only `published: true` listings are returned
- Response includes: name, slug, description, type, version, stars_avg, stars_count, downloads, tags, verified badge, publisher team name

### AC2: Install/Uninstall Flow
Given a published listing
When a team admin installs it
Then:
- `POST /api/teams/:teamId/marketplace/install` — Install listing (body: { listingId, versionId? })
- Creates `marketplace_installs` record
- Increments `downloads` count on listing (atomic `UPDATE SET downloads = downloads + 1`)
- Returns the version content JSONB for client to apply
- `DELETE /api/teams/:teamId/marketplace/installs/:installId` — Uninstall
- `GET /api/teams/:teamId/marketplace/installs` — List installed packages
- Prevents duplicate installs of same listing (UNIQUE on listing_id + team_id)

### AC3: Star Ratings
Given an installed listing
When a user rates it
Then:
- `POST /api/marketplace/:listingId/reviews` — Add review (rating 1-5, optional body)
- `GET /api/marketplace/:listingId/reviews` — List reviews (paginated)
- One review per user per listing (UPSERT)
- After each review, recalculate `stars_avg` and `stars_count` on the listing (trigger or application-level)
- Rating is required, body is optional (max 2000 chars)

### AC4: Download Stats + Trending
Given marketplace activity
When stats are queried
Then:
- `GET /api/marketplace/stats` — Top 10 by downloads, top 10 by stars, newest 10
- Download count is maintained atomically
- Stats endpoint is cacheable (no auth required, public)

## Technical Notes

### Files to Create
- `packages/server/routes/marketplace-public.js` — Public browse/search endpoints (no team context)

### Files to Modify
- `packages/server/lib/marketplace.js` — Add search, install, review, stats logic
- `packages/server/routes/marketplace.js` — Add team-scoped install/uninstall endpoints

### Patterns
- Text search: use PostgreSQL `ts_vector` + `ts_query` or `ILIKE` with trigram for simple implementation
- Pagination: `LIMIT $1 OFFSET $2` with total count header
- Atomic counters: `UPDATE SET downloads = downloads + 1` (no SELECT-then-UPDATE)
- Review aggregation: compute on write (`AVG(rating)` update on listing after review INSERT)

## Dependencies
- T5-S1 (marketplace schema + listings API)

## Test Strategy
- Test search with various filters and sort orders
- Test install flow including duplicate prevention
- Test review UPSERT and rating recalculation
- Test pagination boundary cases
