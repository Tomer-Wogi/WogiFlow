# Plan Management

Strategic initiatives that coordinate epics and features.

---

## Purpose

Plans are the highest level in the WogiFlow work hierarchy. They represent strategic initiatives like quarterly roadmaps, product launches, or major milestones. Plans group epics and standalone features under a single tracking umbrella with progress rollup.

---

## Work Hierarchy

```
Plan (pl-XXXXXXXX) - Strategic initiative
  Epic (ep-XXXXXXXX) - Large initiative
    Feature (ft-XXXXXXXX) - Coherent capability
      Story (wf-XXXXXXXX) - Implementation spec
  Feature (ft-XXXXXXXX) - Standalone capability (no epic)
    Story (wf-XXXXXXXX) - Implementation spec
```

---

## Slash Command

```bash
/wogi-plan "Q1 Roadmap"              # Create a new plan
/wogi-plan "Q1 Roadmap" --goal "Ship by Q2"  # With goal
```

The `/wogi-plan` command routes through `/wogi-start` and creates a plan with the given title.

---

## CLI Commands

**Script**: `scripts/flow-plan.js`

```bash
# Create a plan
node scripts/flow-plan.js create "<title>"
node scripts/flow-plan.js create "<title>" --goal "Ship by Q2"

# List all plans
node scripts/flow-plan.js list
node scripts/flow-plan.js list --json

# Show plan details
node scripts/flow-plan.js show <planId>

# Add epic or standalone feature to plan
node scripts/flow-plan.js add <planId> <epicId>
node scripts/flow-plan.js add <planId> <featureId>

# Remove item from plan
node scripts/flow-plan.js remove <planId> <itemId>

# Check progress
node scripts/flow-plan.js progress <planId>

# Delete plan
node scripts/flow-plan.js delete <planId>
```

---

## How It Works

### Plan Files

Plans are stored as markdown files in `.workflow/plans/`:

```markdown
# Plan: Q1 2026 Product Roadmap

## Goal
Ship user authentication and payment features by end of Q1.

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

### Cascade Completion

Progress flows up through the hierarchy automatically:

```
Story completes -> Feature completes -> Epic completes -> Plan completes
```

Each level auto-completes when all its children are done. When all epics and features in a plan reach 100%, the plan status changes to `completed` and it is archived to `.workflow/archive/plans/YYYY-MM/`.

### Status Icons

| Icon | Status |
|------|--------|
| `·` | Ready (0%) |
| `->` | In Progress (1-99%) |
| `v` | Completed (100%) |

---

## Typical Workflow

```bash
# 1. Create a plan for a strategic initiative
node scripts/flow-plan.js create "Q1 2026 Product Roadmap"
# Creates: pl-a1b2c3d4

# 2. Create epics for major workstreams
node scripts/flow-epics.js create ep-auth --title "Authentication"

# 3. Add epics to the plan
node scripts/flow-plan.js add pl-a1b2c3d4 ep-auth

# 4. Add standalone features
node scripts/flow-feature.js create "Quick Win Feature"
node scripts/flow-plan.js add pl-a1b2c3d4 ft-quick123

# 5. Work proceeds via stories as normal
/wogi-start wf-story-xyz

# 6. Check overall progress
node scripts/flow-plan.js progress pl-a1b2c3d4
```

---

## Use Cases

| Use Case | Plan Contains |
|----------|---------------|
| Quarterly Roadmap | Multiple epics across teams |
| Product Launch | Epics + standalone features |
| Technical Debt Sprint | Features only |
| Single Epic Focus | One epic reference |

---

## Best Practices

1. **Keep plans time-bound** -- Use quarterly or milestone-based scoping
2. **Mix epics and features** -- Plans can contain both for flexibility
3. **Review progress regularly** -- Good for stakeholder updates
4. **Let auto-completion work** -- Do not manually set plan status; it cascades from children
5. **Archive naturally** -- Completed plans move to the archive automatically

---

## Related

- [Task Planning](./01-task-planning.md) - Story-level planning within features
- [Execution Loop](./02-execution-loop.md) - How stories are executed
- [Task Completion](./04-completion.md) - How task completion cascades upward
