Compact the conversation to free up context space using the recursive summary tree.

## Recursive Context Compaction

WogiFlow uses a hierarchical summary tree to manage context:

```
Root (overview)
├── Tasks Section (summary)
│   ├── Task 1 (details, expandable)
│   └── Task 2 (details, expandable)
├── Decisions Section (summary)
│   └── Decision details (expandable)
└── Files Section (summary)
    └── File changes (expandable)
```

## Before Compacting

1. **Update progress.md** with:
   - Current task being worked on
   - What's been done this session
   - Next steps
   - Any decisions made

2. **Ensure request-log is current** - All changes logged

3. **Save any in-progress work** - Commit or stash

## Automatic Context Saving

When compacting, the system automatically:
1. Builds a hierarchical summary tree of the session
2. Stores summaries at multiple levels (root → sections → details)
3. Applies relevance decay to older items
4. Enables on-demand expansion when details are needed later

## Format for Context Summary

Provide this information for the compaction system:

```
## Session Summary for Compaction

**Goal**: [What user wanted to accomplish]

**Completed**:
- [Task/change 1]
- [Task/change 2]

**In Progress**:
- TASK-XXX: [description] - [current state, what's left]

**Key Decisions**:
- [Decision 1]
- [Decision 2]

**Files Modified**:
- [file1.tsx] - [what changed]
- [file2.tsx] - [what changed]

**Next Steps**:
1. [Step 1]
2. [Step 2]

**Context to Preserve**:
- [Important context that should survive compaction]
```

## Context Pressure Monitoring

Check context pressure status:
- **Normal**: Under 50k tokens - no action needed
- **Warning**: 50k-80k tokens - consider compacting soon
- **Critical**: Over 80k tokens - compact immediately

## CLI Commands

```bash
# View tree stats
node scripts/flow-context-compact stats

# Check context pressure
node scripts/flow-context-compact pressure

# View serialized tree
node scripts/flow-context-compact show

# Manual compact
node scripts/flow-context-compact compact

# Compact and prune old nodes
node scripts/flow-context-compact compact --prune

# Get context for a query
node scripts/flow-context-compact context "authentication task"
```

After providing the summary, tell user: "Ready to compact. Please run /compact or continue and I'll auto-compact when needed."
