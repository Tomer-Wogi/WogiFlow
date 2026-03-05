# [wf-decide] /wogi-decide — Interactive Rule Creation with Clarifying Questions

## User Story
**As a** WogiFlow user who wants to establish a project convention
**I want** a structured workflow when I say "from now on, always do X"
**So that** the rule is properly scoped, documented with rationale, and enforced in future tasks

## Description
When a user says "from now on...", "let's make it a rule...", "always do X", or "never do Y", the current system has no structured flow. The intent falls through as exploration (lost) or misrouted to /wogi-story (wrong). This command creates a structured workflow that captures rules with proper scope, rationale, exceptions, and enforcement criteria.

## Acceptance Criteria

### Scenario 1: User creates a new rule
**Given** a user says "from now on, always use error boundaries in React components"
**When** `/wogi-decide` is invoked (directly or via `/wogi-start` routing)
**Then** the workflow asks clarifying questions:
  - Scope: "When does this apply?" (all components? only page-level? only ones with async?)
  - Rationale: "Why is this important?" (crash isolation? user experience?)
  - Exceptions: "Are there cases where this should NOT apply?"
  - Verification: "How should we check compliance?" (code review? lint rule? manual?)
**And** waits for user answers before proceeding

### Scenario 2: Duplicate rule detection
**Given** a similar rule already exists in `decisions.md`
**When** `/wogi-decide` processes the new rule
**Then** it shows the existing rule and asks:
  - "A similar rule exists: [quote]. Do you want to: (1) Update the existing rule, (2) Create a new one, (3) Cancel?"

### Scenario 3: Rule is written to decisions.md
**Given** the user has answered all clarifying questions
**When** the rule is confirmed
**Then** the rule is added to `decisions.md` in the appropriate section with:
  - Rule statement (clear, actionable)
  - Scope (when it applies)
  - Rationale (why)
  - Exceptions (if any)
  - Verification steps (how to check)
  - Created date and source ("user decision" vs "promoted from pattern")
**And** the request-log is updated

### Scenario 4: Rule with no clarification needed
**Given** a user provides a very clear, scoped rule like "catch blocks must use `err` not `e`"
**When** `/wogi-decide` detects no ambiguity
**Then** it confirms the rule directly without excessive questions
**And** adds it to `decisions.md`

### Scenario 5: Rule affects existing code (scope assessment)
**Given** a new rule that could conflict with existing code
**When** `/wogi-decide` processes it
**Then** it searches the codebase for violations of the new rule
**And** reports: "Found N existing violations. Do you want to: (1) Create a fix task for existing violations, (2) Apply rule to new code only, (3) Cancel?"

## Technical Notes

### Files to Create
- `.claude/commands/wogi-decide.md` — The skill definition (slash command)

### Files to Modify
- `.claude/commands/wogi-start.md` — Add `/wogi-decide` to Command Catalog table
- `.workflow/state/decisions.md` — Target for rule additions (at runtime)

### Rule Format in decisions.md
```markdown
### [Rule Title] (YYYY-MM-DD)
**Scope**: [when this applies]
**Source**: user-decision | promoted-pattern
> [Clear rule statement]

**Rationale**: [why this rule exists]
**Exceptions**: [when this does NOT apply, or "None"]
**Verification**: [how to check compliance]
```

### Trigger Phrases (for /wogi-start routing)
- "from now on..."
- "let's make it a rule..."
- "always do X" / "never do Y"
- "the convention should be..."
- "we should standardize on..."
- "update our rules to..."
- "add a rule for..."

## Test Strategy
- [ ] Manual: Say "from now on, always use TypeScript strict mode" — verify questions asked
- [ ] Manual: Create a rule that already exists — verify duplicate detection
- [ ] Manual: Create clear unambiguous rule — verify minimal questions
- [ ] Manual: Verify rule appears in decisions.md with correct format
- [ ] Automated: `node --check` on command file

## Dependencies
- wf-route-learn (routing update should include this command)

## Complexity
Medium — 1 new command file, 1 routing update. Main complexity is the clarifying question logic and duplicate detection.
