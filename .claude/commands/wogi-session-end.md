Properly end a work session.

Steps:
1. **Check request-log** - Ensure all changes are logged
2. **Check log size** - If over 50 entries, suggest archiving
3. **Check app-map** - If new components created, verify they're added
4. **Update progress.md** - Add handoff notes for next session
5. **Commit changes** - Stage and commit all workflow files
6. **Community push** - If `config.community.enabled` and `config.community.pushOnSessionEnd`, push anonymous learnings
7. **Offer to push** - Ask if should push to remote

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

Community knowledge...
  ✓ Pushed 3 learnings (model intelligence, error recovery, skill learnings)

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

## Step 6: Community Knowledge Push

After committing changes, check if community sharing is enabled and push anonymous learnings.

**Implementation:**

```javascript
const path = require('path');
const { safeJsonParse } = require('./scripts/flow-utils');
const configPath = path.join(process.cwd(), '.workflow/config.json');
const config = safeJsonParse(configPath, {});

if (config.community?.enabled && config.community?.pushOnSessionEnd !== false) {
  const {
    collectShareableData,
    pushToServer
  } = require('./scripts/flow-community');

  try {
    // collectShareableData already strips PII and adds metadata
    const payload = collectShareableData(config);
    const dataKeys = payload.data ? Object.keys(payload.data) : [];
    const categoryCount = dataKeys.filter(k => {
      const v = payload.data[k];
      return v && (Array.isArray(v) ? v.length > 0 : typeof v === 'object' && Object.keys(v).length > 0);
    }).length;

    if (categoryCount > 0) {
      // pushToServer adds anonId internally
      await pushToServer(payload, config);
      // Show: ✓ Pushed N learnings (category names)
    } else {
      // Show: ℹ No new learnings to share
    }
  } catch (err) {
    // Show: ⚠ Community push skipped — server unreachable
    // Never block session end for community push failures
  }
} else {
  // Skip silently — community not enabled
}
```

**Behavior:**
- Skip silently if `community.enabled` is false (no output)
- Skip silently if `community.pushOnSessionEnd` is false
- Collect data from enabled categories only
- Strip all PII before sending (emails, paths, project names)
- Fire-and-forget with 5s timeout — never blocks session end
- On failure: show brief warning, continue with push-to-remote step

**Output when enabled:**
```
Community knowledge...
  ✓ Pushed 3 learnings (model intelligence, error recovery, skill learnings)
```

**Output on failure:**
```
Community knowledge...
  ⚠ Community push skipped — server unreachable
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
