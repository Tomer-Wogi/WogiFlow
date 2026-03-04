# Quick Capture

Capture ideas and bugs without interrupting your current work.

---

## Purpose

The `/wogi-capture` command lets you quickly log an idea, bug, or feature request without breaking your flow. Instead of stopping to create a full task, you provide a brief title and the system handles classification, grouping, and routing.

Use it when:
- You notice a bug while working on something else
- You have an idea you want to remember but do not want to act on now
- You want to batch-capture multiple related items at once

---

## Configuration

Controlled by the `capture` key in `.workflow/config.json`:

```json
{
  "capture": {
    "autoGroup": true,
    "groupingThreshold": 0.5,
    "maxGroupSize": 5,
    "routing": {
      "enabled": true,
      "defaultCertainty": "certain",
      "autoDetect": true
    }
  }
}
```

- **autoGroup** -- Automatically group related items captured together
- **groupingThreshold** -- Similarity threshold (0-1) for grouping items
- **maxGroupSize** -- Maximum items per group
- **routing.enabled** -- Enable certainty-based routing
- **routing.autoDetect** -- Auto-detect certainty from text signals

---

## How It Works

### Capture Flow

1. **Parse input** -- Split by commas, "and", or numbered lists
2. **Analyze items** -- Extract action type, target component, and item type
3. **Group related** -- Combine similar items above the grouping threshold
4. **Detect certainty** -- Check for uncertainty signals in the text
5. **Route** -- Certain items go to the roadmap, uncertain items go to the discussion queue
6. **Auto-detect type** -- Keywords like "bug", "fix", "broken", "error", "crash", "fails" mark an item as a bug; everything else defaults to feature
7. **Auto-tag** -- If a task is currently in progress, tags from that context are applied

### Certainty Detection

The system routes items based on how certain the captured text sounds:

| Signal | Example | Route |
|--------|---------|-------|
| Clear action | "add dark mode toggle" | Roadmap (certain) |
| Question mark | "should we add GraphQL?" | Discussion queue (uncertain) |
| Hedging words | "maybe add caching" | Discussion queue (uncertain) |
| Tentative phrases | "what if we refactored auth" | Discussion queue (uncertain) |

Uncertainty signals include: question marks, and words like "maybe", "might", "could", "perhaps", "what if", "should we", "thinking about", "wondering".

### Auto-Grouping

When you capture multiple items at once, related items are grouped automatically:

```
/wogi-capture "change send button to blue, change cancel button to blue, change delete button to blue"
  -> ONE capture: "Update button colors" (3 items grouped)

/wogi-capture "fix login bug, add dark mode, update footer"
  -> THREE captures (unrelated items kept separate)

/wogi-capture "change header to blue, change footer to blue, fix the login bug"
  -> TWO captures: color changes grouped, bug fix separate
```

Items are grouped when they share the same action type (color changes, size changes), the same target (buttons, headers), or the same item type (bugs with bugs).

---

## Commands

```bash
/wogi-capture "Your idea or bug here"
/wogi-capture "Bug: login fails on Safari"
/wogi-capture "refactor auth" --certain
/wogi-capture "should we maybe use GraphQL?" --idea
/wogi-capture "change all buttons to blue, fix the form" --no-group
```

### Flags

| Flag | Description |
|------|-------------|
| `--type <type>` | Force type (bug/feature) instead of auto-detect |
| `--tags <tags>` | Add comma-separated tags |
| `--json` | Output JSON instead of minimal confirmation |
| `--no-group` | Disable auto-grouping (create separate items) |
| `--certain` | Force routing to roadmap |
| `--idea` | Force routing to discussion queue |
| `--no-route` | Disable routing, just add to backlog |

---

## File Destinations

| Certainty | Destination File |
|-----------|-----------------|
| Certain | `.workflow/roadmap.md` |
| Uncertain | `.workflow/state/discussion-queue.md` |
| No routing | `.workflow/state/ready.json` (backlog array) |

### Discussion Queue Format

The discussion queue collects uncertain items for later review:

```markdown
## Pending Review

### 2026-01-29
- [ ] Should we refactor the auth system? (captured: 10:30)
- [ ] Maybe add GraphQL support? (captured: 11:15)

## Reviewed
<!-- Moved items go here with decision -->
```

---

## CLI Usage

The capture system is also available as a standalone script:

```bash
node scripts/flow-capture.js "Add dark mode toggle"
node scripts/flow-capture.js "Bug: login fails" --json
node scripts/flow-capture.js "maybe add caching?" --idea
node scripts/flow-capture.js "refactor auth" --certain
```

---

## Best Practices

1. **Keep captures brief** -- A short title is enough; details can be added later when the item becomes a task
2. **Use auto-grouping for batch captures** -- Comma-separate related items to let the system group them
3. **Let certainty detection work** -- Phrase uncertain ideas as questions so they route to the discussion queue for later review
4. **Review the discussion queue periodically** -- Use `/wogi-morning` or check `.workflow/state/discussion-queue.md` to triage uncertain items
5. **Use --no-route for pure backlog items** -- When you know an item should go straight to the backlog without routing

---

## Related

- [Task Planning](./01-task-planning.md) -- Creating full tasks and stories
- [Session Review](./05-session-review.md) -- End-of-session review
- [Trade-offs](./trade-offs.md) -- Decision-making patterns
