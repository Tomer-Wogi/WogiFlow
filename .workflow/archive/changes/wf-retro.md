# [wf-retro] /wogi-retrospective — Session Learning Extraction and Capture

## User Story
**As a** WogiFlow user finishing a work session or sprint
**I want** a structured retrospective that extracts lessons from what happened
**So that** we continuously improve our processes and prevent repeated mistakes

## Description
`/wogi-session-end` logs completed work but doesn't facilitate reflection. When a user says "what went well?", "what can we improve?", or "let's do a retro", there's no structured workflow. This command guides a retrospective that reads session history, identifies patterns, and captures actionable improvements.

## Acceptance Criteria

### Scenario 1: Full session retrospective
**Given** the user has completed work in the current session
**When** they invoke `/wogi-retrospective`
**Then** the system reads:
  - `request-log.md` for recent entries (since last session end)
  - `last-review.json` for recent review findings
  - `corrections/` for recent corrections
  - `feedback-patterns.md` for recurring patterns
**And** presents a structured summary:
  - What was completed (from request-log)
  - What issues were found (from reviews/corrections)
  - What patterns are emerging (from feedback-patterns)
  - Bypass count (from session state)

### Scenario 2: Guided reflection questions
**Given** the retrospective summary is displayed
**When** the system presents reflection questions
**Then** it asks:
  - "What went well this session that we should keep doing?"
  - "What was frustrating or could be improved?"
  - "Did any rules get violated that need strengthening?"
  - "Any new conventions to establish?"
**And** captures user responses

### Scenario 3: Lessons extracted and captured
**Given** the user has answered reflection questions
**When** lessons are identified
**Then** for each lesson:
  - If it's a new rule → route to `/wogi-decide` flow
  - If it's a pattern to promote → route to `/wogi-learn` flow
  - If it's a process improvement → add to `feedback-patterns.md`
  - If it's praise → acknowledge and move on
**And** a retro summary is saved to `.workflow/reviews/retro-YYYY-MM-DD.md`

### Scenario 4: Quick retrospective
**Given** the user says "quick retro" or uses `--quick` flag
**When** `/wogi-retrospective --quick` is invoked
**Then** it shows only: completions count, issues count, bypass count
**And** asks one question: "Anything to capture before we move on?"

### Scenario 5: No session history
**Given** no recent work has been done (empty request-log since last session)
**When** `/wogi-retrospective` is invoked
**Then** it displays: "No recent work to reflect on. Start working with `/wogi-start` first."

## Technical Notes

### Files to Create
- `.claude/commands/wogi-retrospective.md` — The skill definition

### Files to Read (at runtime)
- `.workflow/state/request-log.md` — Work history
- `.workflow/state/last-review.json` — Last review findings
- `.workflow/state/feedback-patterns.md` — Recurring patterns
- `.workflow/corrections/` — Correction reports
- `.workflow/state/pending-corrections.json` — Unresolved corrections

### Output
- `.workflow/reviews/retro-YYYY-MM-DD.md` — Retrospective summary

### Trigger Phrases (for /wogi-start routing)
- "let's do a retro"
- "what went well"
- "what can we improve"
- "session retrospective"
- "review what happened"
- "lessons learned"

## Test Strategy
- [ ] Manual: Run after a session with completed tasks — verify summary
- [ ] Manual: Answer reflection questions — verify lessons captured
- [ ] Manual: Run `--quick` — verify abbreviated flow
- [ ] Manual: Run with no history — verify graceful message
- [ ] Automated: `node --check` on command file

## Dependencies
- wf-decide (retro routes new rules to /wogi-decide)
- wf-learn (retro routes pattern promotions to /wogi-learn)
- wf-route-learn (routing update)

## Complexity
Medium — 1 new command file. Reads multiple state files. Main complexity is synthesizing a useful summary from disparate sources.
