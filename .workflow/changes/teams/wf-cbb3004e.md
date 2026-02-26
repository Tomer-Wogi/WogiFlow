# T5-S4: Marketplace Dashboard UI

**ID**: wf-cbb3004e
**Epic**: epic-teams-t5
**Type**: Story (L1)
**Priority**: P2
**Repo**: wogiflow-cloud
**Branch**: feature/teams-t2

## User Story

As a WogiFlow team member, I want a marketplace dashboard to browse, search, install, and rate packages, so that I can discover and adopt team resources visually.

## Description

Build the dashboard UI for the marketplace: browse page with search/filter, listing detail page, install button, star ratings, and a publisher management page for admins. Follows the existing GitHub-dark-themed dashboard pattern.

## Acceptance Criteria

### AC1: Browse Page
Given the marketplace dashboard
When a user navigates to the marketplace
Then:
- `/marketplace.html` page with search bar, type filter tabs (All, Templates, Skills, Knowledge Packs)
- Card grid layout showing listings: name, description, type badge, stars, downloads, verified badge
- Sort dropdown: Most Popular, Highest Rated, Newest
- Tag cloud/filter chips
- Pagination (20 per page)
- Responsive layout matching existing dashboard theme

### AC2: Listing Detail Page
Given a marketplace listing
When a user clicks on it
Then:
- Detail view shows: name, description, readme (markdown rendered), publisher team, version history, reviews
- Install button (for team admins) or "Installed" badge if already installed
- Star rating widget (1-5 stars, click to rate)
- Review section with existing reviews and "Write a Review" form
- Version selector dropdown showing changelog per version

### AC3: My Listings Page (Publisher)
Given a verified publisher team
When they navigate to "My Listings"
Then:
- List of own team's listings with status (draft, published)
- Create new listing button → form with name, description, type, tags
- Edit listing → update form + version management
- Publish/Unpublish toggle button
- Version upload form: version string + content JSON + changelog

### AC4: Installed Packages Page
Given a team
When they navigate to "Installed"
Then:
- List of installed marketplace packages with: name, type, installed date, version
- Uninstall button per package
- Update available indicator (if newer version exists)

### AC5: Admin Publisher Management
Given a platform admin
When they navigate to publisher management
Then:
- List of pending publisher applications
- Approve/Reject buttons with reason field for rejections
- List of all verified publishers

## Technical Notes

### Files to Create
- `packages/dashboard/marketplace.html` — Browse + search UI
- `packages/dashboard/marketplace.js` — Client-side logic
- `packages/dashboard/marketplace-detail.html` — Listing detail page (or modal)
- `packages/dashboard/marketplace-my.html` — Publisher's own listings
- `packages/dashboard/marketplace-my.js` — Publisher client logic

### Patterns
- Follow existing dashboard pattern: vanilla JS + fetch API + GitHub dark theme
- Markdown rendering: use a lightweight markdown renderer (or server-side render)
- Star rating widget: CSS-only stars with JS click handler
- Reuse notification polling pattern from approvals dashboard

## Dependencies
- T5-S1 (schema), T5-S2 (search/install APIs), T5-S3 (publisher)

## Test Strategy
- Visual verification of all pages
- Test search/filter interaction
- Test install/uninstall flow from UI
- Test star rating widget
- Test publisher listing management
