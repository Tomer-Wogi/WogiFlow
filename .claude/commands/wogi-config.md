---
description: "View or modify workflow configuration with natural language"
effort: medium
---
Smart configuration management for WogiFlow.

## Usage

`/wogi-config` — Show current configuration overview
`/wogi-config [feature] [on/off]` — Toggle a feature
`/wogi-config [preset]` — Apply a preset
`/wogi-config show [key]` — Show specific config value
`/wogi-config set [key] [value]` — Set a specific config key

## How It Works

1. Read `.workflow/config-reference.json` for feature definitions, aliases, and presets
2. Match the user's natural language to features or presets using aliases
3. Apply all dependent config changes automatically
4. Show what was changed with before/after values
5. Save to `.workflow/config.json`

## When the user says something like:

- "enable testing" → Match feature `testing`, set `testing.enabled: true`, prompt for mode
- "make it strict" → Match preset `strict`, apply all enforcement settings
- "turn on storybook" → Match feature `storybook`, set `componentReuse.autoGenerateStorybook: true`
- "enable TDD" → Match preset `tdd`, enable testing + TDD enforcement
- "I want full testing" → Match preset `full-testing`, enable all test modes
- "relax the enforcement" → Match preset `relaxed`, disable strict enforcement
- "enable parallel" → Match preset `parallel`, enable bulk orchestrator with worktrees
- "turn off hooks" → Match feature `hooks`, set `hooks.enabled: false`
- "enable research" → Match feature `research`, set `research.enabled: true`, prompt for depth
- "enable security scanning" → Match feature `security-scan`, set scanning options

## Implementation Steps

1. Load `.workflow/config-reference.json`
2. Load current `.workflow/config.json`
3. Parse user intent from ARGUMENTS
4. Match against features (by name or aliases) and presets (by name or aliases)
5. Determine if enabling (`on`, `enable`, `true`, no qualifier) or disabling (`off`, `disable`, `false`, `turn off`)
6. For features being **enabled**: apply `dependencies.sets` and ask `dependencies.prompts` if present
7. For features being **disabled**: set the `configPath` key to `false`
8. For presets: apply all `sets` values directly
9. Deep-merge changes into config.json (preserve existing keys, only change specified ones)
10. Save config.json
11. Display summary:
    ```
    Configuration updated:

    testing.enabled: false → true
    testing.mode: (not set) → "auto"
    testing.discovery.enabled: false → true

    3 settings changed.
    ```

## View Mode (no arguments)

When invoked without arguments, display a grouped overview by reading current `.workflow/config.json` and cross-referencing with `.workflow/config-reference.json`:

```
WogiFlow Configuration

Enforcement:
  strict mode .............. on
  task gating .............. off
  scope gating ............. off
  routing gate ............. off
  loop enforcement ......... off

Testing:
  enabled .................. off
  mode ..................... (not set)
  TDD ...................... off
  discovery ................ off
  scenarios ................ off
  generation ............... off
  webmcp ................... off

Research:
  enabled .................. off
  explore phase ............ off
  research depth ........... (not set)
  agents enabled ........... 0/5

Execution:
  parallel ................. off
  bulk orchestrator ........ off
  spec mode ................ off

Components:
  reuse checking ........... off
  auto storybook ........... off

Hooks:
  enabled .................. off
  session context .......... off
  validation ............... off
  task completed ........... off

Automation:
  auto-log ................. on (default)
  auto-update-app-map ...... on (default)

Plugins:
  enabled .................. off

Security:
  scan before commit ....... off

Use /wogi-config [feature|preset] to change settings.
Available presets: strict, relaxed, fast, research-heavy, full-testing, tdd, parallel
```

## Deep-Merge Logic

When setting nested config keys:
```javascript
// Set "testing.discovery.enabled" to true
// This should create the full path if it doesn't exist:
// { testing: { discovery: { enabled: true } } }
function deepSet(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined || current[parts[i]] === null) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}
```

When reading nested config values:
```javascript
function deepGet(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}
```

## Matching Algorithm

1. Normalize user input to lowercase, trim whitespace
2. Check for exact feature name match (e.g., "testing", "storybook", "tdd")
3. Check for exact preset name match (e.g., "strict", "relaxed", "fast")
4. Check feature aliases for substring/fuzzy match
5. Check preset aliases for substring/fuzzy match
6. If multiple matches, prefer exact name matches over alias matches
7. If still ambiguous, list all matches and ask user to clarify

## Disable Logic

When the user says "off", "disable", "turn off", or "false":
- For features: set the `configPath` to `false`. Do NOT apply `dependencies.sets` (those are for enabling).
- For presets: there is no "disable" — suggest the opposite preset (e.g., "strict" → suggest "relaxed")

## Integration with Verification Profile

When enabling testing features, check if a verification profile exists:
- If yes: use detected values (framework, baseUrl, etc.) to auto-populate testing config
- If no: suggest running `/wogi-test --setup` after enabling

## Multiple Features

The user can enable multiple features in one command:
- "enable testing and hooks" → Match both, apply both sets of dependencies
- "turn on storybook and tdd" → Match both features

ARGUMENTS: {args}
