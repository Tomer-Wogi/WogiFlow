# /wogi-extract-review - Zero-Loss Task Extraction with Mandatory Review

Extract tasks from long input with 100% capture rate and mandatory human review.

## Purpose

When processing transcripts, meeting notes, or long prompts, this command ensures NOTHING is missed by:
1. Capturing EVERY distinct statement (no filtering)
2. Deduplicating similar items
3. Requiring explicit human review and confirmation
4. Only proceeding when user confirms the list is complete

## Philosophy

**OLD approach (lossy):** Input → Filter → Filter → Output (70-80% lost)
**NEW approach (zero-loss):** Input → Capture All → Dedupe → Review → Confirm → Output (100% captured)

## Usage

```bash
# Start zero-loss extraction
flow extract-zero-loss start

# Or pipe content
cat transcript.txt | flow extract-zero-loss start

# Check review status
flow extract-zero-loss status

# View items by category
flow extract-zero-loss show pending
flow extract-zero-loss show high      # High confidence items
flow extract-zero-loss show medium    # Medium confidence
flow extract-zero-loss show low       # Low confidence
flow extract-zero-loss show filler    # Potential filler

# Review actions
flow extract-zero-loss confirm <id>           # Confirm as task
flow extract-zero-loss remove <id> "<reason>" # Remove (reason required!)
flow extract-zero-loss merge <src> <target>   # Merge duplicate

# Bulk actions
flow extract-zero-loss confirm-high           # Confirm all high-confidence
flow extract-zero-loss dismiss-filler         # Dismiss filler items

# Complete review (MANDATORY before proceeding)
flow extract-zero-loss complete

# Get confirmed tasks
flow extract-zero-loss tasks
```

## Review Workflow

### Step 1: Start Extraction
```
flow extract-zero-loss start < transcript.txt
```

This extracts EVERYTHING from the input using multiple strategies:
- Sentence boundaries
- Line breaks
- Speaker changes
- List items (bullets, numbers)
- Comma-separated items with action verbs

### Step 2: Quick Review High-Confidence Items
```
flow extract-zero-loss show high
```

These items almost certainly contain tasks. Review and confirm or adjust.

### Step 3: Review Medium-Confidence Items
```
flow extract-zero-loss show medium
```

Many valid tasks here. Review carefully.

### Step 4: Review Low-Confidence Items
```
flow extract-zero-loss show low
```

Some may be tasks phrased informally. Don't skip!

### Step 5: Handle Filler (Optional)
```
flow extract-zero-loss dismiss-filler
```

Dismiss conversational filler like "um", "okay", "thanks".

### Step 6: Confirm Completeness (MANDATORY)
```
flow extract-zero-loss complete
```

User must explicitly confirm the task list is complete before proceeding.

## Integration with Long-Input Processing

After zero-loss extraction and review:
1. Confirmed tasks become the input for topic extraction
2. Topics are generated from the confirmed task list
3. Standard 4-pass processing continues

```bash
# Full flow
cat transcript.txt | flow extract-zero-loss start
flow extract-zero-loss confirm-high
# ... manual review ...
flow extract-zero-loss complete
flow long-input topics    # Now uses confirmed tasks
flow long-input pass2
flow long-input pass3
flow long-input pass4
```

## Why This Matters

> "When I work with my employees, when we have a meeting, even if it takes an hour or two, when I give a task, an employee will write it down, add a comment on Figma, add it to Jira, write it down in his notebook, but nothing is getting missed."

This system ensures:
- **100% capture rate** - Nothing is auto-filtered
- **Explicit confirmation** - User reviews everything
- **Audit trail** - Track what was confirmed vs removed
- **Reason required** - Can't remove without explanation

## Confidence Levels

Items are scored (not filtered!) by confidence:

**High Confidence** - Contains explicit requirement signals:
- "We need to add..."
- "Should display..."
- "Must have..."
- "I would like..."
- "Change X to Y"

**Medium Confidence** - Contains softer signals:
- "Maybe we could..."
- "What if we..."
- "Going to need..."

**Low Confidence** - No clear signals but may be tasks:
- Short statements
- Questions
- Partial sentences

**Filler** - Conversational noise (still captured!):
- "Um", "Okay", "Thanks"
- "Can you hear me?"
- "Makes sense"

## Files

| File | Location |
|------|----------|
| Extraction module | `scripts/flow-zero-loss-extraction.js` |
| Review module | `scripts/flow-extraction-review.js` |
| Review session | `.workflow/tmp/long-input/review-session.json` |

## For Claude

When processing long transcripts:

1. **Always use zero-loss extraction** for meeting transcripts and reviews
2. **Present items by confidence level** to the user
3. **Never skip low-confidence items** - user must explicitly dismiss
4. **Require completeness confirmation** before proceeding to topic extraction
5. **Log all confirmed tasks** for audit trail

The goal is **100% task capture rate**, not 90%.
