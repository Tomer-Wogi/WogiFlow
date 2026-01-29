Quick capture an idea or bug without interrupting your current work. Provide a brief title: `/wogi-capture Add dark mode toggle`

**v2.1**: Auto-Grouping + **Routing** (certain → roadmap, uncertain → discussion queue)

## Usage

```bash
/wogi-capture "Your idea or bug here"
/wogi-capture "Bug: login fails on Safari"
```

Just provide a brief title. That's it.

## Routing (v2.1)

Ideas are automatically routed based on certainty:

- **Certain ideas** (clear action) → Added to `roadmap.md`
- **Uncertain ideas** (questions, "maybe") → Added to `discussion-queue.md`

### Auto-Detection

The system detects uncertainty from:
- **Question marks**: "should we add GraphQL?"
- **Hedging words**: "maybe", "might", "could", "perhaps"
- **Tentative phrases**: "what if", "should we", "thinking about", "wondering"

### Examples

```
/wogi-capture "add dark mode toggle"
→ Certain (explicit action) → Roadmap

/wogi-capture "should we maybe use GraphQL?"
→ Uncertain (question + "maybe") → Discussion queue

/wogi-capture "refactor auth" --certain
→ Forced to roadmap

/wogi-capture "add caching" --idea
→ Forced to discussion queue
```

### Routing Flags

- `--certain` - Force routing to roadmap
- `--idea` - Force routing to discussion queue
- `--no-route` - Disable routing, just add to backlog

## Auto-Grouping (v2.0)

When you capture multiple related items at once, they're automatically grouped:

```
/wogi-capture "change send button to blue, change cancel button to blue, change delete button to blue"
→ ONE capture: "Update button colors" (3 items grouped)

/wogi-capture "fix login bug, add dark mode, update footer"
→ THREE captures (unrelated items split)

/wogi-capture "change header to blue, change footer to blue, fix the login bug"
→ TWO captures: color changes grouped, bug fix separate
```

### Grouping Heuristics

Items are grouped when they share:
- **Same action type**: color changes, size changes, text updates
- **Same target**: button, header, form, etc.
- **Same item type**: bugs with bugs, features with features

### Disable Grouping

Use `--no-group` to create separate items without grouping:
```bash
/wogi-capture "change all buttons to blue, fix the form" --no-group
→ TWO captures (no grouping applied)
```

## What Happens

1. **Parse input** - Split by commas, "and", numbered lists
2. **Analyze items** - Extract action type, target component, item type
3. **Group related** - Combine similar items above threshold
4. **Detect certainty** - Check for uncertainty signals
5. **Route** - Certain → roadmap, uncertain → discussion queue
6. **Auto-detect type** from keywords:
   - "bug", "fix", "broken", "error", "crash", "fails" → `bug`
   - Everything else → `feature`
7. **Auto-tag** from current context (if a task is in progress)

## Files

| Certainty | Destination |
|-----------|-------------|
| Certain | `.workflow/roadmap.md` |
| Uncertain | `.workflow/state/discussion-queue.md` |
| No routing | `.workflow/state/ready.json` (backlog) |

### Discussion Queue Format

```markdown
## Pending Review

### 2026-01-29
- [ ] Should we refactor the auth system? (captured: 10:30)
- [ ] Maybe add GraphQL support? (captured: 11:15)

## Reviewed
<!-- Moved items go here with decision -->
```

## CLI Usage

```bash
node scripts/flow-capture.js "Add dark mode toggle"
node scripts/flow-capture.js "Bug: login fails" --json
node scripts/flow-capture.js "maybe add caching?" --idea
node scripts/flow-capture.js "refactor auth" --certain
```

## Options

- `--type <type>` - Force type (bug/feature) instead of auto-detect
- `--tags <tags>` - Add comma-separated tags
- `--json` - Output JSON instead of minimal confirmation
- `--no-group` - Disable auto-grouping (create separate items)
- `--certain` - Force routing to roadmap
- `--idea` - Force routing to discussion queue
- `--no-route` - Disable routing, just add to backlog

## Configuration

In `config.json`:
```json
{
  "capture": {
    "autoGroup": true,         // Enable/disable auto-grouping
    "groupingThreshold": 0.5,  // Similarity threshold (0-1)
    "maxGroupSize": 5,         // Max items per group
    "routing": {
      "enabled": true,           // Enable routing
      "defaultCertainty": "certain", // Default when not detected
      "autoDetect": true         // Auto-detect from text
    }
  }
}
```
