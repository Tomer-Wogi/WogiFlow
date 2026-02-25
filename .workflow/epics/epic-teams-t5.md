# Epic: T5 — Marketplace & Global Knowledge

**ID**: epic-teams-t5
**Status**: In Progress
**Created**: 2026-02-27
**Depends On**: T4 (Approval Flow) COMPLETE, C1-C2 (Community Knowledge) COMPLETE

## Overview

Marketplace for templates, skills, and knowledge packs with browse/search/install, publisher verification program, star ratings, and download tracking. Global Knowledge team curation layer extends Community Knowledge (C1-C2) with team-level promotion flow. Team model intelligence aggregation and memory export.

## Stories

| # | ID | Title | Priority | Dependencies | Status |
|---|-----|-------|----------|-------------|--------|
| S1 | wf-66f269ee | Marketplace Schema + Listings API | P1 | None | Ready |
| S2 | wf-daaf0644 | Marketplace Search + Install Flow | P1 | S1 | Ready |
| S3 | wf-97851770 | Publisher Program + Verification | P2 | S1 | Ready |
| S4 | wf-cbb3004e | Marketplace Dashboard UI | P2 | S1, S2, S3 | Ready |
| S5 | wf-71b0ba7a | Global Knowledge — Team Curation Layer | P1 | C1-C2, T4-S2 | Ready |
| S6 | wf-f8896007 | Team Model Intelligence + Memory Export | P2 | T3-S3, S5 | Ready |

## Execution Order

```
S1 (Schema + CRUD) ─────┬──→ S2 (Search + Install) ──┬──→ S4 (Dashboard UI)
                         └──→ S3 (Publisher)      ────┘
S5 (Global Knowledge) ──────→ S6 (Model Intelligence)
```

S1 and S5 can run in parallel (independent). S4 waits for S1-S3. S6 waits for S5.

## Key Deliverables

- 2 new DB migrations (014_marketplace, 015_publishers, 016_global_knowledge_promotions)
- 4 new route files (marketplace, marketplace-public, global-knowledge, model-intelligence)
- 3 new lib files (marketplace, global-knowledge, model-intelligence)
- 5+ new dashboard pages (marketplace browse, detail, my listings, installed, admin)
- Integration with existing T4 approval flow for knowledge promotion
- Integration with existing C1-C2 community knowledge tables

## Progress

- [ ] S1: Marketplace Schema + Listings API
- [ ] S2: Marketplace Search + Install Flow
- [ ] S3: Publisher Program + Verification
- [ ] S4: Marketplace Dashboard UI
- [ ] S5: Global Knowledge — Team Curation Layer
- [ ] S6: Team Model Intelligence + Memory Export
