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
node scripts/flow-plan.js create "<title>"

# With goal
node scripts/flow-plan.js create "<title>" --goal "Ship by Q2"
```

Example:
```bash
node scripts/flow-plan.js create "Q1 2026 Product Roadmap"
```

### List Plans
```bash
node scripts/flow-plan.js list

# JSON output
node scripts/flow-plan.js list --json
```

### Show Plan Details
```bash
node scripts/flow-plan.js show <planId>
```

### Add Epic or Feature to Plan
```bash
# Add epic
node scripts/flow-plan.js add <planId> <epicId>

# Add standalone feature
node scripts/flow-plan.js add <planId> <featureId>
```

Example:
```bash
node scripts/flow-plan.js add pl-a1b2c3d4 ep-e5f6g7h8
node scripts/flow-plan.js add pl-a1b2c3d4 ft-i9j0k1l2
```

### Remove Item from Plan
```bash
node scripts/flow-plan.js remove <planId> <itemId>
```

### Check Progress
```bash
node scripts/flow-plan.js progress <planId>
```

### Delete Plan
```bash
node scripts/flow-plan.js delete <planId>
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
node scripts/flow-plan.js create "Q1 2026 Product Roadmap"
# Creates: pl-a1b2c3d4

# 2. Create epics for major workstreams
node scripts/flow-epics.js create ep-auth --title "Authentication"

# 3. Add epics to plan
node scripts/flow-plan.js add pl-a1b2c3d4 ep-auth

# 4. Or add standalone features
node scripts/flow-feature.js create "Quick Win Feature"
node scripts/flow-plan.js add pl-a1b2c3d4 ft-quick123

# 5. Work proceeds normally via stories
/wogi-start wf-story-xyz

# 6. Check overall progress
node scripts/flow-plan.js progress pl-a1b2c3d4
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

## Tips

- **Plans are for strategic visibility** - Track high-level progress
- **Mix epics and features** - Plans can contain both
- **Keep plans time-bound** - Quarterly or milestone-based
- **Review progress regularly** - Good for stakeholder updates
- **Archive completed plans** - They move to archive automatically
