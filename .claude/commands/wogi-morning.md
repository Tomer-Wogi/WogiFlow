Show a morning briefing with everything needed to start the day.

Run `./scripts/flow morning` to generate the briefing.

This command gathers context from:
1. `.workflow/state/session-state.json` - Where you left off
2. `.workflow/state/ready.json` - Pending tasks sorted by priority
3. `.workflow/state/progress.md` - Key context and blockers
4. Git log - Changes since last session

Output includes:
```
MORNING BRIEFING

Last active: Mon Jan 6, 10:30 AM (14 hours ago)

WHERE YOU LEFT OFF
  Task: wf-a1b2c3d4 - User Profile Page
  Status: in_progress
  Files: src/components/Profile.tsx, src/api/user.ts

KEY CONTEXT
  - API endpoint for preferences not ready yet
  - Using shadcn/ui for modal components

BLOCKERS
  - Waiting on backend team for /preferences endpoint

RULE VIOLATIONS (deferred from rule creation)
  Rule: "Split Prisma schema into domain files" (added 2026-02-20)
  Violations: 4 across 1 file
  → Fix now? Routes through /wogi-start with quality gates.
  → Dismiss? Grandfathers existing violations.

NEW RULES LEARNED (auto-promoted from patterns)
  Rule: "Always wrap fs.readFileSync in try-catch" (promoted: 3 occurrences)
  Violations: 2 across 2 files
  → Fix now? Routes through /wogi-start with quality gates.
  → Dismiss? Grandfathers existing violations.

CHANGES SINCE LAST SESSION
  - 2 new commits
  - 1 new bug filed

RECOMMENDED NEXT
  1. [P0] wf-a1b2c3d4: User Profile Page (in progress)
  2. [P1] wf-c3d4e5f6: Fix null check in API
  3. [P2] wf-e5f6g7h8: Add dark mode toggle

SUGGESTED PROMPT
  Continue implementing wf-a1b2c3d4: User Profile Page.

  Context:
  - API endpoint not ready yet
  - Using shadcn/ui for modal

  Files to review:
  - src/components/Profile.tsx
```

Options:
- `--json` - Output JSON for programmatic access

## Rule Violations Section (Implementation Details)

The RULE VIOLATIONS section surfaces two types of deferred rule compliance issues:

### Source 1: Deferred violations from `/wogi-decide`

When a user creates a rule and chooses "Defer to morning briefing" (Option 3), violations are saved to `.workflow/state/pending-rule-violations.json`.

**On morning briefing:**
1. Read `pending-rule-violations.json`
2. For each pending entry, display the rule name, date, violation count, and files
3. Prompt user with `AskUserQuestion`:
   - **Fix now**: Invoke `/wogi-start "Align codebase with rule: [rule title]. Fix N violations."` — routes through full quality gates
   - **Dismiss**: Remove from pending file, add `**Grandfathered**` note to the rule in decisions.md
   - **Defer again**: Keep in pending file for next morning

### Source 2: Auto-promoted rules from `/wogi-learn`

When patterns in `feedback-patterns.md` reach promotion threshold (default: 3 occurrences) and get auto-promoted to rules in decisions.md, the violations that triggered the pattern are likely still in the codebase.

**On morning briefing:**
1. Read `decisions.md` for rules with `**Source**: Promoted pattern` added since `lastBriefingAt` timestamp (from `session-state.json`)
2. For each newly promoted rule, scan for existing violations using the rule's `**Verification**` field as a grep guide
3. If violations found, display and prompt same as Source 1

### User Interaction

For each rule violation entry, use `AskUserQuestion`:

```
RULE VIOLATIONS

  1. "Split Prisma schema into domain files" (added 2 days ago)
     4 violations across 1 file
     [Fix now] [Dismiss] [Defer]

  2. "Always wrap fs.readFileSync in try-catch" (auto-promoted yesterday)
     2 violations across 2 files
     [Fix now] [Dismiss] [Defer]
```

**"Fix now" always routes through `/wogi-start`** — never creates tasks directly. This ensures proper classification (task/story/epic), quality gates, and tracking.

### Timestamp tracking:

To determine "since last session" for auto-promoted rules, store and read the last briefing timestamp:

1. **At briefing start**: Read `lastBriefingAt` from `.workflow/state/session-state.json`
2. **Use as cutoff**: Rules in `decisions.md` with dates after `lastBriefingAt` are "new since last session"
3. **At briefing end**: Write current ISO timestamp to `session-state.json` as `lastBriefingAt`

```javascript
// Read
const sessionState = safeJsonParse('.workflow/state/session-state.json', {});
const lastBriefing = sessionState.lastBriefingAt || '1970-01-01T00:00:00.000Z';

// Write (after briefing completes)
sessionState.lastBriefingAt = new Date().toISOString();
fs.writeFileSync('.workflow/state/session-state.json', JSON.stringify(sessionState, null, 2));
```

### After processing:
- Remove fixed/dismissed entries from `pending-rule-violations.json`
- Add "Grandfathered" note to dismissed rules
- Keep deferred entries for next morning

Configuration in `.workflow/config.json`:
```json
"morningBriefing": {
  "enabled": true,
  "showLastSession": true,
  "showChanges": true,
  "showRecommendedTasks": 3,
  "generatePrompt": true,
  "showBlockers": true,
  "showKeyContext": true,
  "showRuleViolations": true,
  "showAutoPromotedRules": true
}
```

Set `enabled: false` to disable this command.
