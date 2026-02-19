# Project-Level Learning

How WogiFlow learns project-specific patterns and conventions.

---

## Overview

Project-level learning captures:
- Coding patterns unique to your project
- Architectural decisions
- Team conventions
- Feedback history

These are stored in `.workflow/state/` and applied to all future work.

---

## decisions.md

The primary store for project-specific patterns.

### Structure

```markdown
# Project Decisions

## Tech Stack
- **Language**: TypeScript
- **Framework**: Next.js
- **Database**: PostgreSQL (Prisma)

## Conventions
- Use functional components
- All API calls through `lib/api.ts`
- State management with Zustand

## Patterns

### API Calls
Always use the axios wrapper from `lib/api.ts`:
```typescript
import { api } from '@/lib/api';
const data = await api.get('/users');
```

### Error Boundaries
Wrap page components with ErrorBoundary:
```typescript
<ErrorBoundary fallback={<ErrorPage />}>
  <PageContent />
</ErrorBoundary>
```

## Anti-Patterns

### ❌ Direct fetch calls
Don't use raw fetch - use the api wrapper for error handling.

### ❌ Class components
Use functional components with hooks.
```

### How It's Updated

1. **During Correction**: AI offers to persist pattern
2. **Manual Edit**: User adds patterns directly
3. **Automatic Extraction**: From repeated feedback
4. **On Onboarding**: From detected conventions

---

## Feedback Patterns

History of corrections stored in `feedback-patterns.md`.

### Structure

```markdown
# Feedback Patterns

## 2024-01-15

### Pattern: API Error Handling
**Trigger**: User corrected missing error handling
**Resolution**: Always wrap API calls in try/catch
**Persisted to**: decisions.md

### Pattern: Import Ordering
**Trigger**: User preferred specific import order
**Resolution**: React imports first, then third-party, then local
**Persisted to**: decisions.md
```

### Purpose

- Track correction history
- Identify recurring issues
- Feed into automatic learning

---

## Automatic Pattern Extraction

When `autoExtract` is enabled:

```json
{
  "skillLearning": {
    "autoExtract": true,
    "triggers": {
      "onCommit": true,
      "onTaskComplete": true,
      "onCompact": true
    },
    "minCorrectionsToLearn": 1
  }
}
```

### Extraction Process

1. **Trigger**: On configured events
2. **Analyze**: Review recent corrections and feedback
3. **Extract**: Identify patterns from corrections
4. **Propose**: Suggest adding to decisions.md
5. **Confirm**: User approves or rejects

---

## Request Log as Memory

The request log serves as institutional memory:

```markdown
### R-047 | 2024-01-15 14:30
**Type**: new
**Tags**: #screen:login #component:AuthService
**Request**: "Add user authentication"
**Result**: Created AuthService using existing api wrapper pattern
**Files**: src/services/AuthService.ts
```

### How It's Used

- **Context**: AI reads recent entries for patterns
- **Consistency**: Previous approaches inform new work
- **Audit Trail**: Track decisions over time

---

## Component Registry Growth

As new components are created:

1. **Added to app-map.md**: With descriptions and usage
2. **Preferred for Reuse**: AI checks before creating new
3. **Variant Detection**: Suggest variants over new components

```json
{
  "componentRules": {
    "preferVariants": true,
    "requireAppMapEntry": true
  }
}
```

---

## Correction Workflow

When user corrects the AI:

```
User: "Don't use raw fetch, use the api wrapper"
           ↓
AI: "I'll fix that. Should I persist this pattern?"
    Options:
    1. Add to decisions.md ← Best for project patterns
    2. Add to agents/developer.md
    3. Add to config.json
    4. Skip (one-time fix)
           ↓
User: "1"
           ↓
AI: Updates decisions.md with pattern
    Commits change
    Logs to feedback-patterns.md
```

---

## Configuration

```json
{
  "corrections": {
    "mode": "inline",              // Where to show corrections
    "detailPath": ".workflow/corrections"  // Detailed reports
  },
  "skillLearning": {
    "enabled": true,
    "minCorrectionsToLearn": 1    // Min corrections before extraction
  }
}
```

---

## Correction Reports

For significant bugs, create detailed reports:

```bash
/wogi-correction

# Creates detailed report with:
# - Root cause analysis
# - Fix description
# - Prevention pattern
# - Files affected
```

### Report Structure

```markdown
# Correction Report: Auth Token Refresh

## Issue
API calls failed after token expiration

## Root Cause
No token refresh logic in api wrapper

## Fix Applied
Added interceptor to refresh expired tokens

## Prevention Pattern
All API wrappers should include token refresh:
```typescript
api.interceptors.response.use(null, async (error) => {
  if (error.response?.status === 401) {
    await refreshToken();
    return api.request(error.config);
  }
  throw error;
});
```

## Persisted To
- decisions.md (pattern added)
- lib/api.ts (code updated)
```

---

## Decision Amendment Tracking

All changes to `decisions.md` are tracked with an audit trail in `.workflow/state/decision-amendments.json`.

### What's Tracked

Each amendment records:
- **Timestamp**: When the change was made
- **Section**: Which section of decisions.md was affected
- **Action**: `add`, `modify`, `remove`, `promote`, or `deprecate`
- **Rationale**: Why the change was made (required when `requireRationale: true`)
- **Source**: Origin of the change (`manual`, `auto-promoted`, `review-finding`, `user-feedback`, `competitor-inspired`)
- **Impact Assessment**: What this change affects (optional)

### Configuration

```json
{
  "decisions": {
    "amendmentTracking": {
      "enabled": true,
      "logFile": ".workflow/state/decision-amendments.json",
      "requireRationale": true,
      "requireImpactAssessment": false,
      "trackSource": true
    }
  }
}
```

### CLI Usage

```bash
# Record an amendment
node scripts/flow-decision-tracker.js record "Coding Standards" add "Added TDD enforcement rule"

# View history (most recent first)
node scripts/flow-decision-tracker.js history
node scripts/flow-decision-tracker.js history "Security" --limit 10

# View statistics
node scripts/flow-decision-tracker.js stats

# View specific amendment
node scripts/flow-decision-tracker.js diff amend-a1b2c3d4

# JSON output
node scripts/flow-decision-tracker.js history --json
node scripts/flow-decision-tracker.js stats --json
```

### Programmatic API

```javascript
const { recordAmendment, getHistory, getStats } = require('./scripts/flow-decision-tracker');

// Record a change
recordAmendment({
  section: 'Security Patterns',
  action: 'add',
  rationale: 'Added path traversal protection rule',
  source: 'review-finding'
});

// Get history for a section
const history = getHistory('Security', 10);

// Get statistics
const stats = getStats();
```

### Integration with Learning Loop

When review findings lead to rule changes:
1. Review finds a recurring issue
2. Pattern is promoted to `decisions.md`
3. Amendment is automatically recorded with source `auto-promoted`
4. Future reviews check the new rule

---

## Best Practices

1. **Persist Important Corrections**: Don't skip the prompt
2. **Be Specific**: Include code examples when helpful
3. **Use Categories**: Organize patterns in decisions.md
4. **Include Anti-Patterns**: Document what NOT to do
5. **Review Regularly**: Clean up outdated patterns
6. **Check Amendment History**: Use `flow-decision-tracker.js history` to understand rule evolution

---

## Troubleshooting

### Patterns Not Applied

Check if pattern is in decisions.md:
```bash
grep -i "pattern-keyword" .workflow/state/decisions.md
```

### Too Many Prompts

Reduce correction prompts:
```json
{
  "corrections": {
    "mode": "inline"  // vs "detailed"
  }
}
```

### Pattern Conflicts

If patterns conflict:
1. Check decisions.md for contradictions
2. Remove outdated patterns
3. Clarify with specific examples

---

## Related

- [Skill Learning](./skill-learning.md) - Framework-level patterns
- [Model Learning](./model-learning.md) - Per-model optimization
- [Task Execution](../02-task-execution/) - Where patterns apply
