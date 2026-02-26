# /wogi-extract-review - Zero-Loss Extraction with Automated Pipeline

Extract tasks from long input with 100% capture rate, then automatically process them into organized stories — all in one seamless flow.

**Scope**: This command does NOT modify source code files. It processes input text into structured stories in `ready.json`. All file modifications happen downstream via `/wogi-start`.

## Purpose

When processing transcripts, meeting notes, or long prompts, this command ensures NOTHING is missed by running a fully automated pipeline:

1. **Extract** — Capture EVERY distinct statement (zero-loss, 5 extraction strategies)
2. **Review** — Auto-confirm high-confidence items, present medium/low for batch review
3. **Topics** — Group confirmed statements into logical topics
4. **Map** — Associate every statement to a topic
5. **Orphans** — Detect and resolve unmapped statements
6. **Contradictions** — Auto-resolve with temporal ordering, ask user only when uncertain
7. **Clarify** — Collect ALL questions in one batch, present to user
8. **Stories** — Generate stories with user story format, acceptance criteria, and source tracing
9. **Export** — Add stories to `ready.json` and save to `.workflow/changes/`

**The user's only touchpoint**: answering clarifying questions (if any). Zero manual commands needed.

## Philosophy

**OLD approach (lossy):** Input → Filter → Filter → Output (70-80% lost)
**NEW approach (zero-loss, automated):** Input → Capture All → Dedupe → Auto-Review → Topics → Map → Orphans → Contradictions → Clarify → Stories → ready.json (100% captured, zero manual steps)

## For Claude — Automated Orchestration Protocol

When this command is invoked (directly or via longInputGate auto-routing), you MUST orchestrate the entire pipeline automatically. Follow these steps in sequence:

### Phase 1: Extract (Zero-Loss)

```javascript
const { extractZeroLoss } = require('./scripts/flow-zero-loss-extraction');
const result = extractZeroLoss(inputText);
```

Display to user:
```
Extracted N statements using 5 strategies.
Breakdown: X high-confidence, Y medium, Z low, W filler.
```

### Phase 2: Auto-Review

```javascript
const { autoReview, batchConfirm, autoComplete } = require('./scripts/flow-extraction-review');
const reviewResult = autoReview(result);
```

This auto-confirms high-confidence items and dismisses filler. Display to user:

```
Auto-Review:
  ✓ X high-confidence items confirmed
  ✓ W filler items dismissed
  ? Y medium-confidence items for review
  ? Z low-confidence items for review
```

**If medium/low items exist**, present them as a numbered batch using `AskUserQuestion`:
- Medium items: numbered list, user can approve all or reject specific numbers
- Low items: numbered list with AI recommendation per item

After user responds, call:
```javascript
batchConfirm(confirmedIds, rejectedIds);
const completionResult = autoComplete();
const confirmedTasks = completionResult.confirmed_tasks;
```

**If NO medium/low items** (all were high or filler), call `autoComplete()` directly.

### Phase 3: Topic Extraction (AI-Driven)

Read the confirmed tasks and generate topics. Group related statements into coherent topics. Create a topics array:

```javascript
const topics = [
  { title: "User Authentication", keywords: ["login", "auth", "password"], description: "..." },
  { title: "Dashboard Layout", keywords: ["dashboard", "layout", "widgets"], description: "..." }
];
```

### Phase 4: Run Full Pipeline (Passes 2-4)

```javascript
const { runFullPipeline } = require('./scripts/flow-long-input');
const pipelineResult = runFullPipeline({
  transcript: inputText,
  topics: topics,
  contentType: 'transcript'
});
```

This chains: statement mapping → orphan check → contradiction resolution.

Display summary:
```
Pipeline Complete:
  Topics: N
  Statements mapped: X/Y (Z% coverage)
  Orphans: A found, B resolved, C new topics created
  Contradictions: D found, E auto-resolved, F need clarification
```

### Phase 5: Clarification Questions (User Touchpoint)

Check `pipelineResult.clarification_questions`. If any exist:

```javascript
if (pipelineResult.clarification_questions.length > 0) {
  // Present ALL questions in one batch using AskUserQuestion
  // Contradiction questions: "You said X but later said Y. Which do you prefer?"
  // Orphan questions: "You mentioned X — which feature does this relate to?"
}
```

Use `AskUserQuestion` to present all questions at once. After user answers, apply resolutions:

```javascript
const { resolveContradictionWithChoice } = require('./scripts/flow-long-input');
// For each contradiction answer:
resolveContradictionWithChoice(contradictionId, userChoice);
```

**If zero clarification questions**, skip this phase entirely — fully autonomous.

### Phase 6: Generate Stories and Export

```javascript
const { generateAndExportStories } = require('./scripts/flow-long-input-stories');
const exportResult = await generateAndExportStories({ featureName: 'extract-review' });
```

Display final summary:
```
Pipeline Complete!
  Input: N raw statements
  Output: M stories added to ready.json

  Stories:
  1. wf-XXXXXXXX — "Story Title" (X criteria, Y% coverage)
  2. wf-XXXXXXXX — "Story Title" (X criteria, Y% coverage)

  Files saved to: .workflow/changes/extract-review/
  Run /wogi-start to begin implementing.
```

## Confidence Levels

Items are scored (not filtered!) by confidence:

**High Confidence** — Contains explicit requirement signals:
- "We need to add...", "Should display...", "Must have..."
- "I would like...", "Change X to Y"

**Medium Confidence** — Contains softer signals:
- "Maybe we could...", "What if we...", "Going to need..."

**Low Confidence** — No clear signals but may be tasks:
- Short statements, Questions, Partial sentences

**Filler** — Conversational noise (still captured!):
- "Um", "Okay", "Thanks", "Can you hear me?", "Makes sense"

## Contradiction Auto-Resolution

Contradictions are resolved automatically using temporal ordering:

1. **Correction phrases** ("actually", "instead", "no wait", "scratch that") → later statement wins (high confidence)
2. **Same speaker** → +15% confidence boost
3. **Later position** → +10% confidence for significant distance
4. **Additive patterns** ("also add X") → NOT a contradiction, both kept
5. **Auto-resolve at >= 0.8 confidence** → silently resolved
6. **Below 0.8 confidence** → presented as clarifying question to user

The superseded statement is marked and excluded from story generation.

## Files

| File | Location |
|------|----------|
| Extraction engine | `scripts/flow-zero-loss-extraction.js` |
| Review module | `scripts/flow-extraction-review.js` |
| Long-input pipeline | `scripts/flow-long-input.js` |
| Story generation | `scripts/flow-long-input-stories.js` |
| Review session | `.workflow/tmp/long-input/review-session.json` |
| Active digest | `.workflow/tmp/long-input/active-digest.json` |

## Advanced Mode (Manual CLI)

For power users who want step-by-step control:

```bash
# Step 1: Extract
flow extract-zero-loss start < transcript.txt

# Step 2: Review manually
flow extract-zero-loss show high
flow extract-zero-loss confirm-high
flow extract-zero-loss show medium
flow extract-zero-loss show low
flow extract-zero-loss dismiss-filler
flow extract-zero-loss complete

# Step 3: Run pipeline passes manually
flow long-input topics
flow long-input pass2
flow long-input pass3
flow long-input pass4

# Step 4: Generate and export stories
flow long-input generate-stories
flow long-input present
flow long-input finalize
```

## Why This Matters

> "When I work with my employees, when we have a meeting, even if it takes an hour or two, when I give a task, an employee will write it down, add a comment on Figma, add it to Jira, write it down in his notebook, but nothing is getting missed."

This system ensures:
- **100% capture rate** — Nothing is auto-filtered
- **Zero manual commands** — AI orchestrates the entire pipeline
- **Smart contradiction resolution** — Later statements override earlier ones
- **One user touchpoint** — Only clarifying questions when AI can't auto-resolve
- **Audit trail** — Track what was confirmed, removed, or auto-resolved
- **Source tracing** — Every story traces back to original statements
