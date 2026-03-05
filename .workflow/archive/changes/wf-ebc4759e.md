# wf-ebc4759e — Skill System Overhaul
<!-- Formerly: wf-skill-overhaul -->

## User Story
**As a** WogiFlow user onboarding a project
**I want** skills to be complete, relevant, and focused on what makes MY code better
**So that** the AI agent produces production-quality code consistent with my team's standards from day one

## Description
The current skill system has several gaps: skills are generated with placeholder content requiring a manual enhancement step, only 3 skills are loaded per task regardless of relevance, and skill content mixes generic best practices (which Claude already knows) with team-specific conventions (which are the actual high-value content). This overhaul restructures skills to prioritize team knowledge, auto-fetches library documentation via Context7 MCP during onboarding, removes the arbitrary top-3 cap, adds version-aware refresh, and separates content layers so team conventions never get crowded out by generic docs.

## Acceptance Criteria

### Scenario 1: All relevant skills loaded (no arbitrary cap)
**Given** a task that touches React + Zustand + React Router + Prisma (4 skills)
**When** the skill matcher runs
**Then** ALL 4 skills are loaded (not capped at 3)
**And** skills are filtered by a relevance score threshold (not a count limit)
**And** the `maxSkills` parameter is replaced with `minRelevanceScore` in `flow-skill-matcher.js`

### Scenario 2: Context7 runs automatically during onboarding
**Given** a user runs `/wogi-setup-stack` or `/wogi-onboard`
**And** Context7 MCP is available
**When** skills are generated for detected technologies
**Then** Context7 is called for each skill to fetch library documentation
**And** the documentation is written into `library-reference.md` (not patterns.md)
**And** no placeholder content remains in any skill file
**And** the separate `--fetch-docs` step is no longer needed

### Scenario 3: Context7 unavailable fallback
**Given** a user runs onboarding
**And** Context7 MCP is NOT available (offline, rate limited, not configured)
**When** skills are generated
**Then** skills are created with `incomplete: true` in frontmatter
**And** a warning is displayed: "Skills created without library docs. Run /wogi-setup-stack --refresh-docs when Context7 is available"
**And** the system retries on next `/wogi-rescan` if Context7 becomes available

### Scenario 4: Separated content layers
**Given** a generated skill directory
**When** I inspect the file structure
**Then** the skill has these distinct content layers:
  - `skill.md` — metadata, triggers, description
  - `knowledge/conventions.md` — team conventions, code style, integration patterns (highest priority)
  - `knowledge/anti-patterns.md` — mistakes to avoid (from corrections + reviews)
  - `knowledge/library-reference.md` — Context7-sourced API docs (supplementary)
  - `knowledge/learnings.md` — accumulated knowledge from actual work
**And** when loaded into context, conventions and anti-patterns are loaded BEFORE library reference
**And** if token budget is tight, library-reference.md is the first to be trimmed (not conventions)

### Scenario 5: Version-aware refresh on rescan
**Given** a project with existing skills generated at React 18.2 and Prisma 4.x
**When** the user runs `/wogi-rescan` and package.json now shows React 19.0 and Prisma 6.x
**Then** only React and Prisma skills have their `library-reference.md` re-fetched from Context7
**And** Zustand (unchanged version) is NOT re-fetched
**And** conventions.md and anti-patterns.md are NEVER overwritten by refresh
**And** the skill frontmatter records `libraryVersion` and `lastRefreshed` timestamps

### Scenario 6: Team knowledge prioritized over generic docs
**Given** a skill with both conventions.md (team rules) and library-reference.md (Context7 docs)
**When** the skill context is loaded for a task
**Then** the loading order is: skill.md → conventions.md → anti-patterns.md → learnings.md → library-reference.md
**And** library-reference.md content is labeled "Library Reference (supplementary)" in the context
**And** if conventions.md says "always use server components for data fetching" and library-reference.md shows client-side patterns, the conventions take precedence

### Scenario 7: Onboarding captures team conventions
**Given** the user runs `/wogi-onboard` on an existing project with code
**When** the onboarding analyzes existing code patterns
**Then** detected conventions are written to `knowledge/conventions.md` for each relevant skill
**And** conventions include: import patterns, file structure conventions, error handling style, naming patterns
**And** these are marked as `source: onboard-detected` to distinguish from user-specified rules

## Technical Notes

### Files to Change
- `scripts/flow-skill-matcher.js` — Replace `maxSkills: 3` with `minRelevanceScore` threshold; reorder content loading priority
- `scripts/flow-skill-generator.js` — Add Context7 auto-fetch during generation; restructure output directories; add `library-reference.md` layer; remove placeholder content generation
- `scripts/flow-tech-options.js` — Already has Context7 IDs, verify all are current
- `scripts/flow-stack-wizard.js` — Wire Context7 auto-fetch into wizard completion flow
- `scripts/flow-onboard.js` — Add convention detection from existing code; wire Context7
- `scripts/flow-skill-learn.js` — Update to respect new content layer structure
- `.workflow/config.json` — Add `skills.minRelevanceScore`, `skills.autoFetchDocs`, `skills.contentPriority`

### Boundaries (DO NOT modify)
- `scripts/flow-skill-create.js` — Interactive wizard, out of scope
- `scripts/flow-cli.js` — CLI routing, out of scope
- MCP tool definitions — Context7 MCP is external

### Architecture
- Context7 calls happen sequentially (one skill at a time) to avoid context overflow
- Each Context7 fetch targets ~5000 tokens max per skill
- Version tracking uses semver comparison from package.json
- Content priority order is configurable via `config.skills.contentPriority`

## Consumer Impact

| Consumer | Impact | Required Change |
|----------|--------|-----------------|
| flow-spec-generator.js | NEEDS-UPDATE | Uses loadSkillContext() — verify it handles new return shape |
| flow-knowledge-router.js | SAFE | Imports from flow-skill-learn.js which adapts internally |
| Pre-commit hook | SAFE | Calls flow-skill-learn.js which adapts internally |
| /wogi-setup-stack command | NEEDS-UPDATE | Must trigger Context7 after skill generation |
| /wogi-rescan command | NEEDS-UPDATE | Must check version changes and trigger selective refresh |

Total: 5 consumers, 0 breaking, 3 need update
Migration strategy: In-place update (no API changes)

## Test Strategy
- [ ] Unit: Skill matcher loads all relevant skills above threshold (no cap)
- [ ] Unit: Content layers loaded in correct priority order
- [ ] Integration: Onboarding → skill generation → Context7 fetch → complete skills
- [ ] Integration: Rescan detects version bump → selective refresh
- [ ] Manual: Verify generated skill quality on a real project

## Dependencies
- Track A (wf-cr-rv222b series) — Script consolidation should be done first so we're working on clean code

## Complexity
High — Touches 7+ files, changes skill architecture, integrates MCP, adds version tracking

## Out of Scope
- Changing the hub-spoke architecture (it's solid)
- Adding new technology definitions to flow-tech-options.js
- Skill marketplace / registry integration (skills.sh)
- Changing the learning system (flow-skill-learn.js core logic)
- Token budget optimization (we optimize for code quality, not token savings)
