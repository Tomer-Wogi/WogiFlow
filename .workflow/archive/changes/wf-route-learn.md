# [wf-route-learn] Update /wogi-start routing to detect learning/rule intents

## User Story
**As a** WogiFlow user who says "from now on..." or "let's learn from this"
**I want** `/wogi-start` to automatically detect my intent and route to the right command
**So that** I don't need to know specific command names — natural language just works

## Description
Update the /wogi-start Command Catalog and routing logic to recognize learning/rule/retrospective intents and route them to the new `/wogi-decide`, `/wogi-learn`, and `/wogi-retrospective` commands.

## Acceptance Criteria

### Scenario 1: Rule creation intent detected
**Given** a user says "from now on, always use TypeScript strict mode"
**When** `/wogi-start` processes the request
**Then** it routes to `/wogi-decide` with the user's full prompt as argument

### Scenario 2: Learning intent detected
**Given** a user says "we keep making this mistake, let's learn from it"
**When** `/wogi-start` processes the request
**Then** it routes to `/wogi-learn` with the user's full prompt as argument

### Scenario 3: Retrospective intent detected
**Given** a user says "what went well this session?" or "let's do a retro"
**When** `/wogi-start` processes the request
**Then** it routes to `/wogi-retrospective` with the user's full prompt as argument

### Scenario 4: Natural language detection in CLAUDE.md
**Given** the Natural Language Command Detection table in CLAUDE.md
**When** a user says trigger phrases for the new commands
**Then** CLAUDE.md's phrase table includes entries for all 3 new commands

### Scenario 5: Ambiguous intent still asks
**Given** a user says something that could be a rule OR implementation (e.g., "we should add validation")
**When** `/wogi-start` can't distinguish
**Then** it asks the user: "Is this (1) A new rule/convention to document, or (2) An implementation request?"

## Technical Notes

### Files to Modify
- `.claude/commands/wogi-start.md` — Add 3 new rows to Command Catalog table
- `CLAUDE.md` — Add trigger phrases to Natural Language Command Detection table
- `scripts/hooks/core/implementation-gate.js` — Add new trigger phrases to `isWogiCommand()` detection (if applicable)

### New Command Catalog Entries
```
| `/wogi-decide` | Creates/updates project rules with clarifying questions | User says "from now on", "let's make a rule", "always/never do X", "update our rules" |
| `/wogi-learn` | Promotes feedback patterns to decision rules | User says "let's learn from this", "we keep making this mistake", "extract lessons" |
| `/wogi-retrospective` | Guided session reflection with lesson capture | User says "retro", "what went well", "what can we improve", "lessons learned" |
```

### New Natural Language Detection Entries (CLAUDE.md)
```
| "from now on", "make it a rule", "standardize on", "the convention is" | `/wogi-decide` |
| "learn from this", "we keep making", "promote pattern", "extract lessons" | `/wogi-learn` |
| "retro", "what went well", "what can we improve", "lessons learned" | `/wogi-retrospective` |
```

## Test Strategy
- [ ] Manual: Say "from now on always use strict mode" — verify routes to /wogi-decide
- [ ] Manual: Say "let's learn from what happened" — verify routes to /wogi-learn
- [ ] Manual: Say "let's do a retro" — verify routes to /wogi-retrospective
- [ ] Manual: Say "we should add validation to the form" — verify asks for clarification

## Dependencies
- wf-decide, wf-learn, wf-retro (commands must exist before routing to them)

## Complexity
Low — Text changes to 2-3 markdown files. No JS code changes needed (routing is AI-driven from the Command Catalog).
