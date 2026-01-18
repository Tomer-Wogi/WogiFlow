Manage features - coherent product capabilities that group related stories.

## Overview

Features (ft-XXXXXXXX) sit between epics and stories in the work hierarchy. They represent complete product capabilities that can be independently delivered.

```
Plan (pl-XXXXXXXX) - Strategic initiatives
└── Epic (ep-XXXXXXXX) - Large initiative, 15+ files
    └── Feature (ft-XXXXXXXX) - Coherent capability
        └── Story (wf-XXXXXXXX) - Implementation spec
            └── Sub-task (wf-XXXXXXXX-NN) - Atomic work
```

## Commands

### Create Feature
```bash
node scripts/flow-feature.js create "<title>"

# With parent epic
node scripts/flow-feature.js create "<title>" --parent ep-a1b2c3d4
```

Example:
```bash
node scripts/flow-feature.js create "User Authentication Flow"
```

### List Features
```bash
node scripts/flow-feature.js list

# JSON output
node scripts/flow-feature.js list --json
```

### Show Feature Details
```bash
node scripts/flow-feature.js show <featureId>
```

### Add Story to Feature
```bash
node scripts/flow-feature.js add-story <featureId> <storyId>
```

Example:
```bash
node scripts/flow-feature.js add-story ft-a1b2c3d4 wf-e5f6g7h8
```

### Remove Story from Feature
```bash
node scripts/flow-feature.js remove-story <featureId> <storyId>
```

### Check Progress
```bash
node scripts/flow-feature.js progress <featureId>
```

### Delete Feature
```bash
node scripts/flow-feature.js delete <featureId>
```

## File Structure

Features are stored as markdown files in `.workflow/features/`:

```markdown
# Feature: User Authentication Flow

## Description
Allow users to securely log in with email/password.

## User Value
**As a** user
**I want** to log in securely
**So that** I can access my account

## Stories
- wf-a1b2c3d4  # Login form implementation
- wf-e5f6g7h8  # Password reset flow

## Parent
epic: ep-x9y8z7w6

## Status: inProgress
## Progress: 50%
```

## Auto-Completion

When all stories in a feature are completed:
1. Feature status automatically changes to `completed`
2. Progress updates to 100%
3. Feature file is archived to `.workflow/archive/features/YYYY-MM/`
4. Parent epic progress is recalculated

## Linking to Other Work Items

```bash
# Link feature to epic
node scripts/flow-epics.js add-feature <epicId> <featureId>

# Or when creating feature
node scripts/flow-feature.js create "Title" --parent ep-a1b2c3d4
```

## Workflow Example

```bash
# 1. Create an epic for a major initiative
node scripts/flow-epics.js create ep-auth --title "Authentication System"

# 2. Create features for each capability
node scripts/flow-feature.js create "Login Flow" --parent ep-auth
# Creates: ft-a1b2c3d4

# 3. Create stories for the feature
/wogi-story "Build login form"
# Creates: wf-e5f6g7h8

# 4. Link story to feature
node scripts/flow-feature.js add-story ft-a1b2c3d4 wf-e5f6g7h8

# 5. Implement the story
/wogi-start wf-e5f6g7h8

# 6. Check progress
node scripts/flow-feature.js progress ft-a1b2c3d4
```

## Status Icons

| Icon | Status |
|------|--------|
| · | Ready (0%) |
| → | In Progress (1-99%) |
| ✓ | Completed (100%) |

## Tips

- **Features represent user-facing capabilities** - Not technical components
- **Keep features small enough to ship independently** - 2-5 stories each
- **Link features to epics for large initiatives** - Provides visibility
- **Progress auto-updates** - No need to manually track
