---
description: "Manage the pending prompts queue — save requests for later while Claude is busy."
effort: low
---
Manage the pending prompts queue — save requests for later while Claude is busy.

**Triggers**: `/wogi-pending`, "save this for later", "add to pending"

## Usage

```bash
/wogi-pending "fix the header alignment"   # Add item to queue
/wogi-pending --list                       # Show all pending items
/wogi-pending --clear 3                    # Remove item #3
/wogi-pending --clear-all                  # Clear entire queue
```

## How It Works

### Adding Items

When invoked with a prompt string:
1. Read `.workflow/state/pending-prompts.json`
2. Append new item with auto-incrementing ID, prompt text, timestamp
3. Save file
4. Display: "Saved to pending queue (#N). Will process after current task completes."

### Listing Items

When invoked with `--list` or no args:
1. Read pending-prompts.json
2. Display numbered list with timestamps
3. Show count: "N items pending"

### Processing (Auto-triggered)

After any task completes (via task-completed hook):
1. Check if pending-prompts.json has items
2. If yes, display:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PENDING QUEUE (N items)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   1. "fix the header alignment" (added 15m ago)
   2. "API returns 500 on empty input" (added 12m ago)
   3. "wrong color on submit button" (added 8m ago)
   ...

   I've analyzed these items for dependencies and grouping:

   Group A (related — header/UI fixes):
     #1 fix header alignment
     #3 wrong color on submit button
     → Process together as one task

   Group B (separate — API bug):
     #2 API returns 500 on empty input
     → Process as individual task

   Proposed order: Group B first (bug fix), then Group A (UI)

   Ready to start? [Y/adjust/skip]
   ```
3. User approves or adjusts
4. Each group/item goes through `/wogi-start` individually

### Key Principles

- Items are NEVER compressed or merged without user approval
- Each item preserves its original wording exactly
- Grouping is suggested but user decides
- Processing is one-at-a-time through /wogi-start (not one big batch)
- The queue persists across sessions (saved to disk)

ARGUMENTS: {args}
