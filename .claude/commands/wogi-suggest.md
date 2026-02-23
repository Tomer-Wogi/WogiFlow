Submit a suggestion, idea, or bug report for WogiFlow itself. Your input helps improve WogiFlow for all users.

## Usage

```bash
/wogi-suggest "The spec phase should support attaching Figma mockups"
/wogi-suggest "It would be great if wogi-review could suggest test cases"
/wogi-suggest --type=bug "Standards check false positive on utility files"
```

## Options

- `--type <type>` - Suggestion type: `idea` (default), `bug`, `improvement`, `ux_feedback`, `documentation`

## What Happens

1. **Check community enabled** - Read `config.community.enabled`
   - If **disabled**: Show opt-in prompt (consent flow) and ask user to enable first
   - If **enabled**: Continue

2. **Check consent** - Verify community consent has been acknowledged
   - If **not acknowledged**: Show consent message and ask user to confirm
   - After confirmation: Call `acknowledgeConsent()` from `flow-community.js`

3. **Validate input** - Ensure suggestion text is non-empty and meaningful
   - Reject empty or single-word suggestions
   - Reject suggestions that are clearly project-specific (contain file paths)

4. **Submit suggestion** - Call `submitSuggestion(text, type, config)` from `flow-community.js`
   - Attaches: anonymous UUID, WogiFlow version, timestamp, type
   - If server reachable: Submit immediately
   - If offline: Queue to `~/.wogiflow/pending-suggestions.json` for retry on next session start

5. **Confirm** - Show confirmation to user

## Implementation

```javascript
const path = require('path');
const { getConfig, safeJsonParse } = require('./scripts/flow-utils');
const config = getConfig();

// Step 1: Check community enabled
if (!config.community?.enabled) {
  const { getConsentMessage, acknowledgeConsent } = require('./scripts/flow-community');
  // Show consent message and ask user to enable
  // After user confirms: acknowledgeConsent()
  // Update config.community.enabled = true
  return;
}

// Step 2: Check consent acknowledged
const { hasConsentAcknowledged, acknowledgeConsent, getConsentMessage } = require('./scripts/flow-community');
if (!hasConsentAcknowledged()) {
  // Show consent message
  const message = getConsentMessage();
  // Ask user to confirm
  // On confirm: acknowledgeConsent()
  return;
}

// Step 3: Validate
const text = ARGUMENTS.replace(/^--type=\w+\s*/, '').replace(/^["']|["']$/g, '').trim();
const type = ARGUMENTS.match(/--type=(\w+)/)?.[1] || 'idea';

if (!text || text.length < 5) {
  // Show: "Please provide a meaningful suggestion (at least 5 characters)"
  return;
}

// Step 4: Submit
const { submitSuggestion } = require('./scripts/flow-community');
const result = await submitSuggestion(text, type, config);

// Step 5: Confirm
if (result.queued) {
  // Show: "Suggestion queued (offline). Will be submitted on next session start."
} else {
  // Show: "Suggestion submitted. Thanks for helping improve WogiFlow!"
}
```

## Output

**Success:**
```
Suggestion submitted. Thanks for helping improve WogiFlow!

Type: idea
Text: "The spec phase should support attaching Figma mockups"
```

**Queued (offline):**
```
Suggestion queued — will be submitted on next session start.

Type: improvement
Text: "It would be great if wogi-review could suggest test cases"
```

**Community not enabled:**
```
Community sharing is not enabled.

Community Knowledge Sharing

WogiFlow can share anonymous learnings with other users:
- Model intelligence (which models work best for what)
- Error recovery strategies
- Universal coding patterns

What is NEVER shared:
- Your code, file paths, or project names
- Task descriptions or acceptance criteria
- Personal information of any kind

Enable community sharing? [y/n]
Per-category controls available in config.json
```

## Suggestion Types

| Type | Description | Use When |
|------|-------------|----------|
| `idea` | New feature request (default) | "WogiFlow should support X" |
| `bug` | Something broken in WogiFlow | "The review command crashes when..." |
| `improvement` | Existing feature could be better | "The spec phase would benefit from..." |
| `ux_feedback` | Confusing or awkward workflow | "The approval gate is confusing because..." |
| `documentation` | Missing or unclear docs | "The wogi-hybrid docs don't mention..." |

## Privacy

- Suggestions are sent with your anonymous UUID only (no names, emails, or identifiers)
- File paths and project names are stripped before sending
- Suggestions are reviewed by AI curation agents on the server
- Popular suggestions (10+ votes) are auto-flagged for the maintainer

## Configuration

In `.workflow/config.json`:
```json
{
  "community": {
    "enabled": true,
    "serverUrl": "https://api.wogiflow.com"
  }
}
```

## Related

- `/wogi-session-end` - Community push happens automatically at session end
- `/wogi-capture` - Quick-capture ideas for YOUR project (not WogiFlow suggestions)
