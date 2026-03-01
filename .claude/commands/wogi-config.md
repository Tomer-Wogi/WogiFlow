---
description: "View or modify workflow configuration"
---
View or modify workflow configuration.

**View config:** `/wogi-config`
Shows current settings from `.workflow/config.json`

**Toggle settings:** `/wogi-config [setting] [on/off]`

Available settings:
- `storybook on/off` - Auto-generate Storybook stories for new components
- `hooks on/off` - Enable/disable pre-commit git hooks
- `tests-before-commit on/off` - Run tests before each commit

Examples:
```
/wogi-config
→ Shows all current settings

/wogi-config storybook on
→ Enables Storybook auto-generation
→ Updates componentRules.autoGenerateStorybook: true

/wogi-config hooks on
→ Runs: ./scripts/flow setup-hooks install

/wogi-config tests-before-commit on
→ Updates testing.runBeforeCommit: true
```

Output for view:
```
⚙️ Workflow Configuration

Quality Gates:
  feature: tests, appMapUpdate, requestLogEntry
  bugfix: tests, requestLogEntry

Testing:
  Run after task: off
  Run before commit: off
  Browser tests: off

Components:
  Auto Storybook: off
  Require app-map entry: on

Hooks:
  Pre-commit: not installed

Use /wogi-config [setting] on/off to change.
```
