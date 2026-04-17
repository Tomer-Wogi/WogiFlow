---
description: "Manage plans - strategic initiatives coordinating epics and features"
effort: medium
---
Manage plans - strategic initiatives that coordinate epics and features.

## Overview

Plans (pl-XXXXXXXX) are the highest level in the work hierarchy. They represent strategic initiatives like roadmap items, quarterly goals, or major product launches.

```
Plan (pl-XXXXXXXX) - Strategic initiative
├── Epic (ep-XXXXXXXX) - Large initiative
│   └── Feature (ft-XXXXXXXX) - Coherent capability
│       └── Story (wf-XXXXXXXX) - Implementation spec
└── Feature (ft-XXXXXXXX) - Standalone capability (no epic)
    └── Story (wf-XXXXXXXX) - Implementation spec
```

## Commands

### Create Plan
```bash
node node_modules/wogiflow/scripts/flow-plan.js create "<title>"

# With goal
node node_modules/wogiflow/scripts/flow-plan.js create "<title>" --goal "Ship by Q2"
```

Example:
```bash
node node_modules/wogiflow/scripts/flow-plan.js create "Q1 2026 Product Roadmap"
```

### List Plans
```bash
node node_modules/wogiflow/scripts/flow-plan.js list

# JSON output
node node_modules/wogiflow/scripts/flow-plan.js list --json
```

### Show Plan Details
```bash
node node_modules/wogiflow/scripts/flow-plan.js show <planId>
```

### Add Epic or Feature to Plan
```bash
# Add epic
node node_modules/wogiflow/scripts/flow-plan.js add <planId> <epicId>

# Add standalone feature
node node_modules/wogiflow/scripts/flow-plan.js add <planId> <featureId>
```

Example:
```bash
node node_modules/wogiflow/scripts/flow-plan.js add pl-a1b2c3d4 ep-e5f6g7h8
node node_modules/wogiflow/scripts/flow-plan.js add pl-a1b2c3d4 ft-i9j0k1l2
```

### Remove Item from Plan
```bash
node node_modules/wogiflow/scripts/flow-plan.js remove <planId> <itemId>
```

### Check Progress
```bash
node node_modules/wogiflow/scripts/flow-plan.js progress <planId>
```

### Delete Plan
```bash
node node_modules/wogiflow/scripts/flow-plan.js delete <planId>
```

## File Structure

Plans are stored as markdown files in `.workflow/plans/`:

```markdown
# Plan: Q1 2026 Product Roadmap

## Goal
Ship user authentication and payment features by end of Q1.

## Description
Strategic initiative to complete core product features.

## Success Criteria
- [ ] User authentication live in production
- [ ] Payment integration complete
- [ ] 95% test coverage

## Items

### Epics
- ep-auth1234  # Authentication System

### Features
- ft-payment5  # Payment Processing (standalone)

## Timeline
| Phase | Description | Target |
|-------|-------------|--------|
| Phase 1 | Authentication | Feb 2026 |
| Phase 2 | Payments | Mar 2026 |

## Status: inProgress
## Progress: 35%
```

## Auto-Completion

When all epics and features in a plan are completed:
1. Plan status automatically changes to `completed`
2. Progress updates to 100%
3. Plan file is archived to `.workflow/archive/plans/YYYY-MM/`

## Cascade Completion

Progress flows up through the hierarchy:
```
Story completes → Feature completes → Epic completes → Plan completes
```

Each level auto-completes when all children are done.

## Workflow Example

```bash
# 1. Create a plan for a strategic initiative
node node_modules/wogiflow/scripts/flow-plan.js create "Q1 2026 Product Roadmap"
# Creates: pl-a1b2c3d4

# 2. Create epics for major workstreams
node node_modules/wogiflow/scripts/flow-epics.js create ep-auth --title "Authentication"

# 3. Add epics to plan
node node_modules/wogiflow/scripts/flow-plan.js add pl-a1b2c3d4 ep-auth

# 4. Or add standalone features
node node_modules/wogiflow/scripts/flow-feature.js create "Quick Win Feature"
node node_modules/wogiflow/scripts/flow-plan.js add pl-a1b2c3d4 ft-quick123

# 5. Work proceeds normally via stories
/wogi-start wf-story-xyz

# 6. Check overall progress
node node_modules/wogiflow/scripts/flow-plan.js progress pl-a1b2c3d4
```

## Use Cases

| Use Case | Plan Contains |
|----------|---------------|
| Quarterly Roadmap | Multiple epics across teams |
| Product Launch | Epics + standalone features |
| Technical Debt Sprint | Features only |
| Single Epic Focus | One epic reference |

## Status Icons

| Icon | Status |
|------|--------|
| · | Ready (0%) |
| → | In Progress (1-99%) |
| ✓ | Completed (100%) |

## Integration with Claude Code /plan

When entering plan mode for strategic thinking, you can pass a description directly to Claude Code's `/plan` command (2.1.72+):

```
/plan <description>
```

This enters plan mode AND immediately starts working on the described plan, rather than entering an empty plan mode. WogiFlow gates `EnterPlanMode` behind routing — so `/wogi-plan` should be used instead of bare `/plan` to ensure task tracking.

When `/wogi-plan` is invoked with a description argument, it should:
1. Create the plan structure in `.workflow/plans/`
2. Enter Claude Code plan mode with the description: `EnterPlanMode` with the plan context

## Anti-Deferral Rule (MANDATORY — v2.24.0+)

**When creating a plan from user input, EVERY item the user provided MUST become a tracked epic or feature within the plan.**

You must NEVER:
- Create epics for items 1-3 and silently skip items 4-7 because you judged them as "enhancements" or "long-term"
- Label items as "deferred" and exclude them from the plan
- Apply your own filter to decide which items deserve tracking

You MAY:
- Assign different priorities (P0/P1/P2/P3) — but ALL items get epics/features
- Suggest an execution order — but ALL items are tracked in the plan
- Ask the user "Should I defer items 4-7?" — explicit user consent is the ONLY valid reason to exclude items

**If the user provides 7 items, the plan MUST contain 7 tracked sub-items (epics or features, possibly grouped where every item appears as a criterion).** Verify with a reconciliation count before proceeding.

## P0 Specification-Quality Gates (v2.24.0+)

When creating a plan from user input, apply the same P0 gates `/wogi-story` uses (`scripts/flow-story-gates.js`):

1. **Long Input Gate** — ≥40 lines or ≥5 items → route to `/wogi-extract-review`
2. **Item Reconciliation** — ≥3 items → enumerate manifest + verify every item maps
3. **Consumer Impact** — refactor keywords trigger a grep; ≥5 breaking consumers → recommend phased migration
4. **Scope-Confidence** — extract "new X"/"existing Y"/"the Z service" claims; classify against codebase; surface contradictions as Pending Clarifications
5. **Intent Bootstrap Coordination** — schedule IGR bootstrap if missing (don't re-prompt)

All fail-open.

## Tips

- **Plans are for strategic visibility** - Track high-level progress
- **Mix epics and features** - Plans can contain both
- **Keep plans time-bound** - Quarterly or milestone-based
- **Review progress regularly** - Good for stakeholder updates
- **Archive completed plans** - They move to archive automatically
