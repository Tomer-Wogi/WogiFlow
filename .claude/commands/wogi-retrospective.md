Guided session retrospective that extracts lessons from recent work. Invoke when user says "let's do a retro", "what went well", "what can we improve", or "lessons learned".

## Usage

```bash
/wogi-retrospective            # Full retrospective
/wogi-retrospective --quick    # Quick summary + one question
```

## Trigger Phrases

Auto-routed from `/wogi-start` when user says:
- "let's do a retro"
- "what went well"
- "what can we improve"
- "session retrospective"
- "lessons learned"

## How It Works

### Step 0: Check for Session History

Read `.workflow/state/request-log.md` and check for recent entries (since last session end or last retro).

**If no recent work:**
```
No recent work to reflect on.

Start working with `/wogi-start` first, then run a retro
after completing some tasks.
```
Stop here.

### Step 1: Gather Session Data

Read these files to build a session picture:

1. **`.workflow/state/request-log.md`** — Recent entries (since last session end marker or last 10 entries)
   - Extract: task IDs, types, results, files changed
2. **`.workflow/state/last-review.json`** — Last review findings (if exists)
   - Extract: finding count, severities, categories
3. **`.workflow/corrections/`** — Recent correction reports
   - Extract: patterns, root causes, lessons
4. **`.workflow/state/feedback-patterns.md`** — Recurring patterns
   - Extract: high-count patterns, recently added patterns
5. **`.workflow/state/ready.json`** — Task completion data
   - Extract: recently completed tasks, in-progress tasks

### Step 2: Present Session Summary

```
Session Retrospective
=====================

Completed Work:
  - [N] tasks completed
  - [List task titles from request-log/ready.json recentlyCompleted]

Issues Found:
  - [N] review findings ([X] critical, [Y] high, [Z] medium)
  - [N] corrections recorded
  - [List significant issues]

Emerging Patterns:
  - [Pattern name] ([N] occurrences) — [description]
  - [Pattern name] ([N] occurrences) — [description]

Workflow Health:
  - Bypass attempts: [N] (from session context)
  - Tasks completed via workflow: [N]
```

### Step 3: Guided Reflection Questions

Use `AskUserQuestion` to ask reflection questions. Ask 2-3 questions max based on what's relevant:

**Always ask:**
1. "What went well this session that we should keep doing?"
   - Options: specific things user can select, plus "Other" for free text

**Ask if issues were found:**
2. "What was frustrating or could be improved?"
   - Options: based on actual issues found in the data

**Ask if patterns are emerging:**
3. "Any conventions or rules that should be established from this session?"
   - Options: based on patterns near promotion threshold

**Ask if rule violations occurred:**
4. "Did any existing rules get violated that need strengthening?"
   - Options: based on review findings matching decisions.md rules

**Maximum 3 questions per retro. Priority order when all conditions apply:**
1. Q1 (always — "what went well")
2. Q4 (violations — most actionable)
3. Q3 (patterns — near promotion)
4. Q2 (frustrations — least actionable)

**Pick top 3 by this priority order.**

### Step 4: Process Responses and Capture Lessons

For each user response, classify and route:

| Response Type | Action |
|---------------|--------|
| New rule/convention | Route to `/wogi-decide` flow |
| Pattern to promote | Route to `/wogi-learn` flow |
| Process improvement | Add to `feedback-patterns.md` |
| Positive feedback | Acknowledge and note in retro summary |
| Specific fix needed | Create task in `ready.json` backlog |

### Step 5: Save Retro Summary

Create `.workflow/reviews/retro-YYYY-MM-DD-HHMMSS.md` (include time to avoid same-day collisions):

```markdown
# Session Retrospective — YYYY-MM-DD

## Session Summary
- Tasks completed: N
- Issues found: N (X critical, Y high)
- Corrections: N
- Bypass attempts: N

## Completed Work
- [task-id]: [title] — [result]
- [task-id]: [title] — [result]

## Issues & Patterns
- [issue/pattern summary]

## Reflection
### What went well
[User's response]

### What could improve
[User's response]

### Actions Taken
- [Action 1]: [what was done — rule created / pattern promoted / task created]
- [Action 2]: [what was done]

## Metrics
- Review findings resolved: N/M
- Patterns promoted: N
- New rules created: N
```

### Step 6: Update Request Log

```markdown
### R-[NNN] | [YYYY-MM-DD HH:MM]
**Type**: new
**Tags**: #retro #learning
**Request**: "Session retrospective"
**Result**: Retro completed. [N] lessons captured. [M] actions taken.
**Files**: `.workflow/reviews/retro-YYYY-MM-DD-HHMMSS.md`
```

### Step 7: Closing

```
Retrospective Complete

Summary saved to: .workflow/reviews/retro-YYYY-MM-DD-HHMMSS.md

Actions taken:
- [N] new rules created (via /wogi-decide)
- [N] patterns promoted (via /wogi-learn)
- [N] improvement items captured
- [N] tasks created for fixes

Next session will benefit from these learnings.
```

---

## Quick Retrospective (`--quick`)

When invoked with `--quick`:

1. Read the same data sources (Step 1)
2. Display abbreviated summary:

```
Quick Retro
===========
Completed: [N] tasks
Issues: [N] findings
Bypasses: [N]
```

3. Ask one question:

```
Anything to capture before we move on?
1. No, all good
2. Yes, I want to add a rule
3. Yes, I want to note a pattern
4. Yes, I have feedback
```

4. Route response and save minimal retro file
5. Done

---

## Options

- `--quick` — Abbreviated flow: summary + one question
- `--since YYYY-MM-DD` — Retro for work since specific date. **Validate**: must match `/^\d{4}-\d{2}-\d{2}$/`. Reject any other format.
- `--no-save` — Don't save retro file (just display)

## Configuration

In `config.json`:
```json
{
  "retrospective": {
    "maxQuestions": 3,
    "autoSuggestRules": true,
    "saveReviewFile": true,
    "quickModeDefault": false
  }
}
```

## Files

| Action | File |
|--------|------|
| Read | `.workflow/state/request-log.md` |
| Read | `.workflow/state/last-review.json` |
| Read | `.workflow/corrections/*.md` |
| Read | `.workflow/state/feedback-patterns.md` |
| Read | `.workflow/state/ready.json` |
| Write | `.workflow/reviews/retro-YYYY-MM-DD-HHMMSS.md` |
| Write | `.workflow/state/request-log.md` |
| May invoke | `/wogi-decide` (for new rules) |
| May invoke | `/wogi-learn` (for pattern promotions) |
