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

### Step 6: Check for Existing Code Violations (Optional)

After writing the rule, optionally scan for existing violations:

1. Use Grep to search for patterns that violate the new rule
2. If violations found (N > 0):

```
Found N existing violations of this new rule.

Options:
1. Create a fix task for existing violations
2. Apply rule to new code only (grandfather existing)
3. Fix them right now (if small count)
```

Use `AskUserQuestion` to present options.

If user chooses option 1:
- Create a task in `ready.json` backlog: "Fix N violations of [rule name]"

### Step 7: Update Request Log

Add entry to `.workflow/state/request-log.md`:

```markdown
### R-[NNN] | [YYYY-MM-DD HH:MM]
**Type**: new
**Tags**: #rule #decisions
**Request**: "Create rule: [rule title]"
**Result**: Added rule to decisions.md ([section])
**Files**: `.workflow/state/decisions.md`
```

### Step 8: Confirm

```
Rule created: "[Rule Title]"
Section: [section in decisions.md]
Scope: [scope]

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
    "maxClarifyingQuestions": 4
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
| Write (fix task) | `.workflow/state/ready.json` (if violations found) |
