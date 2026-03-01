---
description: "Check workflow health and report issues"
---
Check workflow health and report issues.

Verify:
1. **Required files exist**:
   - `.workflow/config.json`
   - `.workflow/state/ready.json`
   - `.workflow/state/request-log.md`
   - `.workflow/state/app-map.md`
   - `.workflow/state/decisions.md`
   - `CLAUDE.md`

2. **JSON validity**:
   - Parse config.json - report if invalid
   - Parse ready.json - report if invalid

3. **App-map sync**:
   - Check if components in app-map exist in codebase
   - Report orphaned entries

4. **Git status**:
   - Check for uncommitted workflow files

Output:
```
🏥 Workflow Health

Files:
  ✓ config.json
  ✓ ready.json
  ✓ request-log.md
  ✓ app-map.md
  ✓ decisions.md
  ✓ CLAUDE.md

Validation:
  ✓ config.json valid
  ✓ ready.json valid

Sync:
  ⚠ 2 components in app-map not found in codebase

Overall: Healthy (1 warning)
```
