Submit a suggestion, feature request, or improvement idea for WogiFlow.

Your suggestion is sent anonymously to the WogiFlow community server where AI agents evaluate and prioritize it. Popular suggestions get fast-tracked for implementation.

## Usage

```
/wogi-suggest "The spec phase should support attaching Figma mockups"
/wogi-suggest "It would be great if wogi-review could suggest test cases"
/wogi-suggest --type=bug "Standards check false positive on utility files"
```

## Options

- `--type=idea` (default) — Feature request or new idea
- `--type=bug` — Something broken in WogiFlow itself
- `--type=improvement` — Existing feature could be better

## What Happens

1. Validate the suggestion is non-empty
2. Attach metadata: WogiFlow version, anonymous UUID, timestamp
3. Send to `POST /api/community/suggest` (5-second timeout)
4. Show confirmation: "Suggestion submitted. Thanks for helping improve WogiFlow!"
5. If offline: queue to `~/.wogiflow/pending-suggestions.json` and show "Suggestion queued — will be sent on next session start."
6. Queued suggestions are automatically retried on next session-start hook

## Steps

1. **Parse arguments**: Extract suggestion text and optional `--type` flag
2. **Check community config**: Read `config.community.enabled`
   - If `community.enabled` is `false`: Show message explaining how to enable community features, then still attempt submission (suggestions don't require full community to be enabled — anyone can suggest improvements)
3. **Validate suggestion**: Must be non-empty after trimming
4. **Check consent**: If `~/.wogiflow/consent-acknowledged` doesn't exist, display consent message first, then acknowledge
5. **Submit suggestion**: Call `submitSuggestion(text, type, config)` from `scripts/flow-community.js`
6. **Display result**:

**Success output:**
```
Suggestion submitted. Thanks for helping improve WogiFlow!

Type: idea
Content: "The spec phase should support attaching Figma mockups"
```

**Queued output (offline):**
```
Suggestion queued — will be sent on next session start.

Type: idea
Content: "The spec phase should support attaching Figma mockups"
Queued to: ~/.wogiflow/pending-suggestions.json
```

**Empty suggestion:**
```
Please provide a suggestion. Example:
  /wogi-suggest "Add dark mode support to the dashboard"
```

## Implementation

```javascript
const { submitSuggestion, isConsentAcknowledged, acknowledgeConsent, getConsentMessage } = require('../../scripts/flow-community');
const { getConfig } = require('../../scripts/flow-utils');

// 1. Parse args
const args = ARGUMENTS || '';
const typeMatch = args.match(/--type=(idea|bug|improvement)/);
const type = typeMatch ? typeMatch[1] : 'idea';
const text = args.replace(/--type=\w+/, '').replace(/^["']|["']$/g, '').trim();

// 2. Validate
if (!text) {
  // Show empty suggestion message
  return;
}

// 3. Check consent
if (!isConsentAcknowledged()) {
  // Display consent message, then acknowledge
  console.log(getConsentMessage());
  acknowledgeConsent();
}

// 4. Submit
const config = getConfig();
const success = await submitSuggestion(text, type, config);

// 5. Display result
```

## Privacy

- Suggestions are sent with an anonymous UUID (no personal info)
- No code, file paths, or project names are included
- WogiFlow version is attached for context
- AI agents on the server evaluate suggestions for quality and feasibility
