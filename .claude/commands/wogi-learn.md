---
description: "Interactive pattern promotion from feedback to decisions"
effort: medium
---
Interactive pattern promotion from feedback to decisions. Invoke when user says "let's learn from this", "we keep making this mistake", "promote this pattern", or "what have we learned?".

## Usage

```bash
/wogi-learn                    # Show all patterns, select to promote
/wogi-learn --all              # Bulk promote all qualifying patterns (count >= 3)
/wogi-learn "learn from what just happened"  # Learn from recent incident
```

## Trigger Phrases

Auto-routed from `/wogi-start` when user says:
- "let's learn from this"
- "we keep making this mistake"
- "promote this pattern"
- "what have we learned?"
- "extract lessons"
- "capture this learning"

## How It Works

### Step 0.5: Product vs Project Classification (MANDATORY)

Before promoting ANY pattern, determine where it belongs:

**PRODUCT-LEVEL** (improves WogiFlow for ALL users):
- Fixes how a `/wogi-*` command behaves → fix the command `.md` file
- Changes how hooks/scripts work → fix the script code
- Improves task execution, routing, quality gates → fix wogi-start.md or the relevant command
- Applies to every project using WogiFlow, not just this one

**PROJECT-LEVEL** (specific to THIS project):
- Team coding conventions (naming, formatting, architecture preferences)
- Project-specific procedures (release process, deployment, review checklists)
- Technology choices unique to this project

**How to decide**: Ask "Would a completely different project using WogiFlow also need this rule?" If YES → product-level. If NO → project-level.

**Product-level actions:**
- If it's a command behavior fix → edit the `.claude/commands/wogi-*.md` file directly
- If it's a coding pattern all projects should follow → add to `.claude/rules/` (shipped to users)
- If it needs investigation → add to `.workflow/state/product-feedback.md`
- Do NOT write product-level learnings to `decisions.md` — that file is per-project and doesn't propagate

**Project-level actions:**
- Promote to `.workflow/state/decisions.md` (the normal flow below)

This classification applies to ALL modes (A, B, C) and to Step 3 (Promote a Pattern).

### Step 1: Load Pattern Data

Read these files:
1. `.workflow/state/feedback-patterns.md` — Accumulated patterns with counts
2. `.workflow/state/decisions.md` — Existing rules (to check for duplicates)
3. `.workflow/corrections/*.md` — Recent correction reports with lessons (sorted by mtime; if directory doesn't exist or is empty, skip)

### Step 2: Choose Mode

**Mode A: Browse patterns** (default — no argument)
**Mode B: Learn from incident** (argument provided, e.g., "learn from what just happened")
**Mode C: Bulk promotion** (`--all` flag)

---

### Mode A: Browse Patterns

1. Parse `feedback-patterns.md` for all patterns in the "Pending Patterns" and "Patterns Log" sections
2. Sort by occurrence count (highest first)
3. Display:

```
Accumulated Patterns (N total):

Ready to Promote (count >= 3):
  1. [try-catch-file-reads] (4 occurrences) — File reads need try-catch
  2. [review-similar-code] (4 occurrences) — Check similar code when fixing bugs

Approaching Threshold (count 2):
  3. [use-safeJsonParse] (2 occurrences) — Use safeJsonParse instead of JSON.parse
  4. [extract-duplicate-logic] (2 occurrences) — Extract shared logic

Monitoring (count 1):
  5. [validate-shell-params] (1 occurrence) — Validate shell parameters
  ... (N more)

Which pattern would you like to promote? (Enter number, or "skip")
```

Use `AskUserQuestion` to let user select.

4. When user selects a pattern, go to **Step 3: Promote Pattern**.

### Mode B: Learn from Incident

1. Read `.workflow/state/request-log.md` — last 5 entries
2. Read recent files in `.workflow/corrections/*.md` (last 3 by modification time; if directory doesn't exist or is empty, analyze request-log only and note: "No correction reports found — analyzing request-log entries.")
3. Analyze what went wrong:
   - What was the task?
   - What failure occurred?
   - What was the root cause?
   - What should have been done differently?

4. Propose a rule:

```
Based on recent work, here's what I found:

Incident: [description from request-log/corrections]
Root Cause: [analysis]
Proposed Rule: "[rule statement]"

What should we do with this learning?
1. Create a project rule (routes to /wogi-decide flow)
2. Fix WogiFlow product behavior (edit command/script/template)
3. Add to feedback-patterns for monitoring first
4. Skip — not a recurring issue
```

Use `AskUserQuestion` to present options.

If option 1: Invoke `/wogi-decide --from-pattern` with the proposed rule (uses streamlined path, writes to project `decisions.md`). If user cancels within the /wogi-decide sub-flow, return to wogi-learn and display "Rule creation cancelled. Pattern not promoted."
If option 2: Apply the product-level fix directly — edit the relevant command `.md` file, script, or template. If the fix needs investigation, add to `.workflow/state/product-feedback.md`. Do NOT write to `decisions.md` (product fixes don't belong in per-project state).
If option 3: Add to `feedback-patterns.md` Pending Patterns section with count 1.
If option 4: No action taken.

### Mode C: Bulk Promotion

1. Parse `feedback-patterns.md` for patterns with count >= 3
2. For each qualifying pattern, display:

```
Bulk Promotion: N patterns qualify (count >= 3)

1. [try-catch-file-reads] (4x) — Promote? [Y/n]
   → Proposed rule: "Always wrap fs.readFileSync in try-catch"

2. [review-similar-code] (4x) — Promote? [Y/n]
   → Proposed rule: "When fixing a bug, search for similar patterns elsewhere"

Approve all? Or review individually?
```

Use `AskUserQuestion`:
- "Approve all" — Promote all qualifying patterns
- "Review individually" — Go through each one

For each approved pattern, run **Step 3: Promote Pattern**.

---

### Step 3: Promote a Pattern

Given a pattern to promote:

1. **Classify as product or project** (per Step 0.5):
   - If PRODUCT-LEVEL: Do NOT write to `decisions.md`. Instead, fix the relevant command/script/template directly, or add to `.workflow/state/product-feedback.md` if it needs investigation. Skip steps 2-5 below.
   - If PROJECT-LEVEL: Continue with the normal promotion flow below.

2. **Extract rule from pattern:**
   - Pattern description → Rule statement
   - Pattern count → Evidence for rationale
   - Correction examples → Verification criteria

3. **Delegate duplicate checking to `/wogi-decide --from-pattern`** which handles duplicate detection and the full rule-writing flow. This ensures a single source of truth for all rule-creation logic.

4. **Ask user for any additions:**

```
Promoting pattern: [pattern-name]

Proposed rule:
> [Rule statement derived from pattern]

Rationale: Occurred [N] times. [Brief description of why this matters]
Scope: [Inferred scope from pattern data]

Anything to add or change?
- Additional scope or exceptions?
- Specific verification steps?

(Press enter to accept as-is, or type modifications)
```

5. **Write to decisions.md** (PROJECT-LEVEL only):
   Use the same format as `/wogi-decide`:

```markdown
### [Rule Title] (YYYY-MM-DD)
**Source**: promoted-pattern ([N] occurrences in feedback-patterns.md)
**Scope**: [scope]
> [Rule statement]

**Rationale**: Pattern occurred [N] times. [description]
**Exceptions**: [exceptions or "None"]
**Verification**: [how to check]
```

6. **Mark as promoted in feedback-patterns.md:**
   Update the pattern's row:
   - Set "Promoted To" column to `decisions.md`
   - Set "Status" column to `PROMOTED`
   - Or move to "Promotion History" section

### Step 4: Update Request Log

```markdown
### R-[NNN] | [YYYY-MM-DD HH:MM]
**Type**: change
**Tags**: #learning #decisions #pattern-promotion
**Request**: "Promote pattern: [pattern-name]"
**Result**: Pattern promoted to decisions.md ([section]). [N] patterns reviewed.
**Files**: `.workflow/state/decisions.md`, `.workflow/state/feedback-patterns.md`
```

### Step 5: Summary

```
Learning Summary:
- Patterns reviewed: N
- Patterns promoted: M
- New rules added to decisions.md: M

These rules will be enforced in future code reviews and task execution.
```

## Edge Cases

### No patterns to promote
```
No patterns to promote.

Patterns are recorded during:
- Code reviews (/wogi-review)
- Corrections (/wogi-correction)
- Standards compliance checks

As patterns accumulate (count >= 3), they become eligible for promotion.
```

### All patterns already promoted
```
All qualifying patterns have already been promoted to decisions.md.

Monitoring [N] patterns with count < 3. They'll become eligible as occurrences increase.
```

## Options

- `--all` — Bulk promote all patterns with count >= threshold
- `--threshold N` — Override promotion threshold (default: 3, minimum: 2). Values below 2 are rejected to prevent noise promotion.
- `--quick` — Skip individual confirmation prompts, but still display count and require final confirmation: "About to promote N patterns — confirm? [Y/n]"

## Configuration

In `config.json`:
```json
{
  "learning": {
    "promotionThreshold": 3,
    "autoPromoteEnabled": false,
    "requireUserConfirmation": true
  }
}
```

## Files

| Action | File |
|--------|------|
| Read | `.workflow/state/feedback-patterns.md` |
| Read | `.workflow/state/decisions.md` |
| Read | `.workflow/corrections/*.md` |
| Read | `.workflow/state/request-log.md` (for incident mode) |
| Write | `.workflow/state/decisions.md` (new rules) |
| Write | `.workflow/state/feedback-patterns.md` (mark promoted) |
| Write | `.workflow/state/request-log.md` (log entry) |
