Properly end a work session.

Steps:
1. **Check request-log** - Ensure all changes are logged
2. **Check log size** - If over 50 entries, suggest archiving
3. **Check app-map** - If new components created, verify they're added
4. **Update progress.md** - Add handoff notes for next session
5. **Commit changes** - Stage and commit all workflow files
6. **Offer to push** - Ask if should push to remote

Output:
```
📤 Ending Session

Checking request-log...
  ✓ 3 entries added today
  ⚠ Log has 67 entries - consider: ./scripts/flow archive --keep 50

Checking app-map...
  ✓ 1 new component added (ProfileCard)

Updating progress.md...
  Added handoff notes

Committing...
  ✓ Committed: "chore: End session - 3 changes logged"

Push to remote? (y/n)
```

Progress.md handoff format:
```markdown
## Session End: 2024-01-15 17:30

### Completed
- TASK-012: Forgot password link
- Fixed BUG-004

### In Progress
- TASK-015: User profile (70% done)

### Next Session
- Finish profile page styling
- Start TASK-018

### Notes
- API endpoint for preferences not ready yet
- Decided to use shadcn/ui for modal
```

## Cross-Session Pattern Detection (v6.0)

At session end, the system analyzes request history across multiple sessions (default: 30 days) to detect repeated patterns.

### What It Detects

- Requests made 3+ times across different sessions
- Similar requests grouped by semantic matching (e.g., "run on localhost:3000" and "switch to port 3000")
- Development preferences, code style requests, workflow corrections

### Example Output

```
--- Cross-Session Patterns Detected ---

1. "Run the development server on localhost:3000"
   Occurrences: 5 times across 4 session(s)
   First seen: 2026-01-10, Last seen: 2026-01-27
   Category: Development Setup

Would you like to enforce any of these patterns as permanent rules?

Tip: Tell Claude "enforce pattern 1" or "enforce all" to make these permanent rules.
```

### Enforcing Patterns

When you say "enforce pattern 1" or similar:
1. Rule is added to `decisions.md` under the appropriate category
2. Rule is synced to `.claude/rules/` for Claude Code to auto-load
3. Pattern is tracked in `feedback-patterns.md` promotion history

### Configuration

In `.workflow/config.json`:
```json
"crossSessionLearning": {
  "enabled": true,
  "lookbackDays": 30,
  "minOccurrences": 3,
  "similarityThreshold": 0.5,
  "autoPromptOnSessionEnd": true,
  "saveTo": "both"  // "decisions", "rules", or "both"
}
```

### Disabling

Set `"enabled": false` in the config to disable cross-session pattern detection.
