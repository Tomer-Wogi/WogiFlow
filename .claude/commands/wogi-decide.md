---
description: "Interactive rule creation for 'from now on' and 'make it a rule' requests"
---
Interactive rule creation with clarifying questions. Invoke when user says "from now on...", "let's make it a rule", "always do X", "never do Y", or "standardize on...".

## Usage

```bash
/wogi-decide "from now on, always use error boundaries in React components"
/wogi-decide "the convention should be kebab-case for all config files"
/wogi-decide                # Interactive mode — asks what rule to create
```

## Trigger Phrases

Auto-routed from `/wogi-start` when user says:
- "from now on..."
- "let's make it a rule..."
- "always do X" / "never do Y"
- "the convention should be..."
- "we should standardize on..."
- "update our rules to..."
- "add a rule for..."

## How It Works

### Step 1: Parse the Rule Intent

Extract from the user's input:
- **What**: The rule statement (what to do or not do)
- **Scope hint**: Any mentioned scope (all files? specific types? specific feature?)
- **Strength**: Mandatory ("always", "never", "must") vs advisory ("prefer", "try to", "when possible")

### Step 2: Check for Duplicate Rules

**BEFORE asking clarifying questions**, check for existing similar rules:

1. Read `.workflow/state/decisions.md`
2. Search for keywords from the proposed rule
3. If a similar rule exists (same topic, same intent):

```
A similar rule already exists:

> [Existing rule statement from decisions.md]
(Added: [date], Section: [section])

Options:
1. Update the existing rule (modify scope, wording, or exceptions)
2. Create a new separate rule (if genuinely different)
3. Cancel (rule already covered)
```

Use `AskUserQuestion` to present these options.

### Step 3: Assess Clarity

Evaluate if the rule needs clarification. **Skip questions if the rule is already clear and specific.**

A rule is clear when it has:
- Specific action (what to do)
- Obvious scope (when it applies)
- No ambiguity in interpretation

**Examples of clear rules (skip to Step 4):**
- "Catch blocks must use `err` not `e`" — Clear action, obvious scope
- "All file names must be kebab-case" — Clear action, universal scope
- "Never commit .env files" — Clear prohibition, obvious scope

**Examples of ambiguous rules (ask questions):**
- "Always use error boundaries" — Which components? All? Only pages?
- "We should validate inputs" — Which inputs? Client-side? Server-side? Both?
- "Use TypeScript strict mode" — New files only? Existing files too?

### Step 4: Ask Clarifying Questions (if needed)

Only ask questions that are genuinely needed. Use `AskUserQuestion` with up to 4 questions:

**Possible questions (ask only what's ambiguous):**

1. **Scope**: "When does this apply?"
   - All files / specific file types / specific feature areas / new code only
2. **Exceptions**: "Are there cases where this should NOT apply?"
   - Yes (describe) / No exceptions / Not sure yet
3. **Verification**: "How should we check compliance?"
   - Code review / Lint rule / Manual check / Automated test
4. **Rationale** (only if not obvious): "Why is this important?"
   - Helps future developers understand the rule

**Do NOT ask all 4 questions every time.** For most rules, 0-2 questions suffice.

### Step 5: Write the Rule to decisions.md

**Input sanitization**: Before writing, enforce these guards on user-supplied rule text:
- Maximum 500 characters for the rule statement
- Strip markdown structural characters (`---`, `##`, HTML comments `<!-- -->`) from user-supplied text
- Escape any markdown headings within the rule body (prefix with `\`)
- This prevents accidental or malicious structural alteration of decisions.md

Read `.workflow/state/decisions.md` and add the rule to the appropriate section.

**Section mapping:**
- Code style / naming → "Coding Standards"
- Component / UI patterns → "Component Architecture"
- Security practices → "Coding Standards > Security Patterns"
- Architecture / design → "Architecture Decisions"
- File / folder organization → "File/Folder Structure"
- Process / workflow → "Operational Procedures"
- Review / cleanup → "Review & Cleanup Procedures"

**Rule format:**

```markdown
### [Rule Title] (YYYY-MM-DD)
**Source**: user-decision
**Scope**: [when this applies]
> [Clear, actionable rule statement]

**Rationale**: [why this rule exists]
**Exceptions**: [when this does NOT apply, or "None"]
**Verification**: [how to check compliance]
```

### Step 6: Scan for Existing Code Violations (MANDATORY)

**After writing the rule, ALWAYS scan for existing violations.** The user's expectation when creating a rule is that the entire codebase should comply. Skipping the scan means the rule exists on paper but not in practice.

1. Use Grep to search for patterns that violate the new rule
2. Cap display at 50 violations — if more exist, warn user about scope
3. Display results:

**If NO violations found:**
```
✓ No existing violations found. Codebase already complies with this rule.
```

**If violations found (N > 0):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ EXISTING VIOLATIONS FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rule: "[Rule Title]"
Violations: N across M files

Files affected:
  - path/to/file1.ts (3 violations)
  - path/to/file2.ts (1 violation)
  ...

Options:
[1] Fix all violations now (Recommended)
    Routes through /wogi-start with full quality gates.
    Small fixes → inline task. Structural changes → story/epic.

[2] Apply rule to new code only (grandfather existing)
    No changes made. Future code must comply.

[3] Defer to morning briefing
    Violations saved for review during next /wogi-morning.
    Good when you're mid-task and don't want to context-switch.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use `AskUserQuestion` to present options.

**Option 1 — Fix all violations now (route through `/wogi-start`):**

This is the key integration point. Do NOT create tasks directly in ready.json. Instead:

1. Assess the scope of violations:
   - **Small** (1-5 mechanical fixes, same pattern): Route as inline fix via `/wogi-start`
   - **Medium** (6-15 files or behavioral changes): Route as story via `/wogi-start` → `/wogi-story`
   - **Large** (15+ files or structural refactoring): Route as epic via `/wogi-start` → `/wogi-epics`

2. Invoke `/wogi-start` with a descriptive request:
   ```
   /wogi-start "Align codebase with new rule: [rule title]. Fix N violations across M files."
   ```

3. `/wogi-start` handles classification, story creation, quality gates, and execution — the same as any other implementation request. This ensures:
   - Proper task tracking (logged, traceable)
   - Quality gates (lint, typecheck, tests)
   - Consumer impact analysis (for structural changes)
   - Criteria completion verification

**Option 2 — Grandfather existing:**
- No changes made
- Rule applies to new code only
- Log the decision: add `**Grandfathered**: [date] — N existing violations in M files left as-is` to the rule entry in decisions.md

**Option 3 — Defer to morning briefing:**
- Save violation data to `.workflow/state/pending-rule-violations.json`:
  ```json
  {
    "ruleTitle": "[Rule Title]",
    "ruleDate": "[ISO date]",
    "violationCount": N,
    "fileCount": M,
    "files": ["path/to/file1.ts", "path/to/file2.ts"],
    "pattern": "[grep pattern used]",
    "section": "[section in decisions.md]"
  }
  ```
- `/wogi-morning` will surface this in the "RULE VIOLATIONS" section (see wogi-morning.md)
- User can decide to fix during their next work session

### Step 7: Update Request Log

Add entry to `.workflow/state/request-log.md`:

```markdown
### R-[NNN] | [YYYY-MM-DD HH:MM]
**Type**: new
**Tags**: #rule #decisions
**Request**: "Create rule: [rule title]"
**Result**: Added rule to decisions.md ([section])
**Files**: `.workflow/state/decisions.md`[, `.workflow/state/ready.json` if fix task created]
```

### Step 8: Confirm

```
Rule created: "[Rule Title]"
Section: [section in decisions.md]
Scope: [scope]
Violations: [N found → action taken] OR [0 — codebase compliant]

This rule will be enforced in future code reviews and task execution.
```

## Options

- `--quick` — Skip clarifying questions, write rule directly from input
- `--from-pattern` — Create rule from a pattern in feedback-patterns.md (used by /wogi-learn)

## Configuration

In `config.json`:
```json
{
  "decide": {
    "requireRationale": true,
    "scanForViolations": true,
    "maxClarifyingQuestions": 4,
    "violationRouting": {
      "quickFixThreshold": 3,
      "storyThreshold": 10,
      "epicThreshold": 25
    }
  }
}
```

## Files

| Action | File |
|--------|------|
| Read (duplicate check) | `.workflow/state/decisions.md` |
| Write (new rule) | `.workflow/state/decisions.md` |
| Read (violation scan) | Codebase files via Grep |
| Write (log) | `.workflow/state/request-log.md` |
| Write (deferred violations) | `.workflow/state/pending-rule-violations.json` (if Option 3) |

**Note**: Fix tasks are NOT created directly in ready.json. Instead, violations are routed through `/wogi-start` which handles classification (task/story/epic) and proper task creation with quality gates.
