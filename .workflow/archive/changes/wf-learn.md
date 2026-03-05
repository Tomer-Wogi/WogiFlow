# [wf-learn] /wogi-learn — Interactive Pattern Promotion from Feedback to Decisions

## User Story
**As a** WogiFlow user who notices recurring patterns or mistakes
**I want** to explicitly promote learned patterns into project rules
**So that** the team benefits from accumulated experience without waiting for automatic promotion thresholds

## Description
Currently, WogiFlow only promotes patterns to `decisions.md` automatically when the same violation occurs 3+ times in `feedback-patterns.md`. There's no way for a user to say "we've learned this lesson, let's make it official" and have a structured workflow capture it. This command bridges that gap — it reads accumulated patterns, lets the user select which to promote, and generates proper decision rules.

## Acceptance Criteria

### Scenario 1: View accumulated patterns
**Given** `feedback-patterns.md` has recorded patterns from past reviews and corrections
**When** the user invokes `/wogi-learn`
**Then** it displays patterns sorted by occurrence count:
  - Pattern name, count, last occurrence date
  - Grouped by category (code-style, security, architecture, etc.)
  - Highlights patterns near promotion threshold (count >= 2)

### Scenario 2: Promote a specific pattern
**Given** the user selects a pattern to promote
**When** they confirm the promotion
**Then** the system generates a decision rule from the pattern:
  - Extracts the pattern description → rule statement
  - Extracts violation examples → verification criteria
  - Asks: "Any additional scope or exceptions to add?"
  - Writes to `decisions.md` with source: "promoted-pattern"
**And** marks the pattern as promoted in `feedback-patterns.md`

### Scenario 3: Learn from specific incident
**Given** a user says "let's learn from what just happened" after a bug fix or review
**When** `/wogi-learn` is invoked with context
**Then** it reads recent request-log entries and corrections
**And** identifies what went wrong and what the preventive rule should be
**And** proposes a decision rule for user approval

### Scenario 4: Bulk promotion
**Given** multiple patterns have high occurrence counts
**When** the user invokes `/wogi-learn --all`
**Then** it shows all promotable patterns (count >= threshold)
**And** the user can approve/reject each one
**And** approved patterns are batch-written to `decisions.md`

### Scenario 5: No patterns to promote
**Given** `feedback-patterns.md` is empty or all patterns are already promoted
**When** the user invokes `/wogi-learn`
**Then** it displays: "No patterns to promote. Patterns are recorded during code reviews and corrections."

## Technical Notes

### Files to Create
- `.claude/commands/wogi-learn.md` — The skill definition

### Files to Read (at runtime)
- `.workflow/state/feedback-patterns.md` — Source of learned patterns
- `.workflow/state/decisions.md` — Target for promoted rules (check for duplicates)
- `.workflow/state/request-log.md` — Recent work context
- `.workflow/corrections/` — Correction reports with lessons learned

### Trigger Phrases (for /wogi-start routing)
- "let's learn from this"
- "we keep making this mistake"
- "promote this pattern"
- "what have we learned?"
- "extract lessons"
- "capture this learning"

## Test Strategy
- [ ] Manual: Run `/wogi-learn` with patterns in feedback-patterns.md — verify display
- [ ] Manual: Promote a pattern — verify it appears in decisions.md
- [ ] Manual: Run after a bug fix — verify it identifies the lesson
- [ ] Manual: Run with empty feedback-patterns — verify graceful message
- [ ] Automated: `node --check` on command file

## Dependencies
- wf-route-learn (routing update should include this command)

## Complexity
Medium — 1 new command file. Main complexity is parsing feedback-patterns.md and generating proper decision rules from pattern data.
