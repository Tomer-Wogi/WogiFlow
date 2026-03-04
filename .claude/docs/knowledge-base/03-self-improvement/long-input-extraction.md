# Long Input Extraction

Zero-loss extraction from transcripts, meeting notes, and long prompts into structured stories.

---

## Purpose

`/wogi-extract-review` is a fully automated pipeline that processes long input text into organized stories in `ready.json`. It ensures 100% capture rate by extracting every distinct statement, then deduplicating, reviewing, grouping into topics, resolving contradictions, and generating implementation stories -- all with minimal user intervention.

This command does NOT modify source code. It produces structured stories that are then implemented via `/wogi-start`.

---

## Configuration

```json
{
  "longInputGate": {
    "enabled": true,
    "charThreshold": 2000,
    "lineThreshold": 50,
    "smartDefault": true,
    "contentRules": {
      "transcript": "full",
      "spec": "full",
      "requirements": "full",
      "code": "skip",
      "default": "quick"
    },
    "supportedLanguages": ["en", "uk", "ru", "he"]
  }
}
```

The long input gate auto-triggers when input exceeds either threshold. When triggered with `"full"` mode, it routes to the extraction pipeline described here.

---

## How It Works

### The 9-Phase Pipeline

```
Input -> Extract -> Review -> Topics -> Map -> Orphans -> Contradictions -> Clarify -> Stories -> Export
```

**Phase 1: Extract** -- Capture every distinct statement using 5 extraction strategies. Zero filtering at this stage.

**Phase 2: Auto-Review** -- Auto-confirm high-confidence items, dismiss filler. Present medium/low confidence items in a batch for user review.

**Phase 3: Topics** -- Group confirmed statements into logical topics (AI-driven clustering).

**Phase 4: Map** -- Associate every confirmed statement to a topic.

**Phase 5: Orphans** -- Detect unmapped statements and resolve them (assign to existing topic or create new one).

**Phase 6: Contradictions** -- Detect conflicting statements and auto-resolve using temporal ordering. Ask user only when confidence is below 0.8.

**Phase 7: Clarify** -- Collect all remaining questions in one batch and present to user.

**Phase 8: Stories** -- Generate stories with user story format, acceptance criteria, and source tracing.

**Phase 9: Export** -- Add stories to `ready.json` and save specs to `.workflow/changes/`.

### User Touchpoint

The user's only interaction is answering clarifying questions (if any). When all items are high-confidence with no contradictions, the pipeline runs fully autonomously.

---

## Confidence Levels

Items are scored, not filtered:

| Level | Signals | Auto-Action |
|-------|---------|-------------|
| **High** | "We need to add...", "Should display...", "Must have..." | Auto-confirmed |
| **Medium** | "Maybe we could...", "What if we...", "Going to need..." | Presented for batch review |
| **Low** | Short statements, questions, partial sentences | Presented with AI recommendation |
| **Filler** | "Um", "Okay", "Thanks", "Can you hear me?" | Auto-dismissed |

---

## Contradiction Resolution

Contradictions are resolved automatically when possible:

1. **Correction phrases** ("actually", "instead", "scratch that") -- Later statement wins (high confidence)
2. **Same speaker** -- +15% confidence boost
3. **Later position** -- +10% confidence for significant distance
4. **Additive patterns** ("also add X") -- NOT a contradiction; both kept
5. **Confidence >= 0.8** -- Auto-resolved silently
6. **Confidence < 0.8** -- Presented as a clarifying question to the user

The superseded statement is marked and excluded from story generation.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `flow-zero-loss-extraction.js` | 5-strategy extraction engine |
| `flow-extraction-review.js` | Auto-review, batch confirm, completion |
| `flow-long-input.js` | 4-pass pipeline (topics, mapping, orphans, contradictions) |
| `flow-long-input-stories.js` | Story generation and export to ready.json |

### Temp Files

| File | Location |
|------|----------|
| Review session | `.workflow/tmp/long-input/review-session.json` |
| Active digest | `.workflow/tmp/long-input/active-digest.json` |
| Exported specs | `.workflow/changes/<feature-name>/` |

---

## Manual CLI Mode

For step-by-step control:

```bash
# Extract
flow extract-zero-loss start < transcript.txt

# Review
flow extract-zero-loss show high
flow extract-zero-loss confirm-high
flow extract-zero-loss show medium
flow extract-zero-loss dismiss-filler
flow extract-zero-loss complete

# Pipeline passes
flow long-input topics
flow long-input pass2
flow long-input pass3
flow long-input pass4

# Generate and export
flow long-input generate-stories
flow long-input present
flow long-input finalize
```

---

## Comparison with Long Input Gate

| Feature | Long Input Gate | Extract-Review |
|---------|----------------|----------------|
| Trigger | Automatic (threshold-based) | Manual command or gate-routed |
| Scope | Content classification + mode selection | Full extraction pipeline |
| Output | Routes to appropriate processor | Stories in `ready.json` |
| User input | None (automatic) | Clarifying questions only |

The long input gate is the detector; `/wogi-extract-review` is the processor. When the gate classifies content as `"full"` mode, it routes to this extraction pipeline.

---

## Best Practices

1. **Let the pipeline run** -- Avoid interrupting; the user touchpoint is designed to be minimal
2. **Trust temporal ordering** -- Later statements naturally supersede earlier ones in transcripts
3. **Review medium-confidence items** -- These are where human judgment adds the most value
4. **Check exported stories** -- Review `ready.json` after extraction before starting implementation
5. **Use for any long input** -- Works with transcripts, meeting notes, specs, and requirements docs

---

## Related

- [Long Input Processing](./long-input-processing.md) - The gate system and content classification
- [Project Learning](./project-learning.md) - How extracted patterns feed into decisions
- [Task Planning](../02-task-execution/01-task-planning.md) - Story-level planning after extraction
