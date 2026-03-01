---
description: "Check for drift between app-map and codebase"
---
Check for drift between app-map and codebase.

Verifies that all components listed in app-map.md still exist at their specified paths.

Output:
```
🔍 Checking app-map for drift...

Checking 12 mapped components...

  ✓ Button → components/ui/Button
  ✓ Input → components/ui/Input
  ✓ Card → components/ui/Card
  ✗ OldHeader → components/layout/OldHeader (NOT FOUND)
  ✓ Avatar → components/ui/Avatar
  ✗ DeprecatedModal → components/Modal (NOT FOUND)
  ...

Found 2 orphaned entries:
  • OldHeader - file not found at components/layout/OldHeader
  • DeprecatedModal - file not found at components/Modal

Recommendation:
  Remove these from app-map.md or update paths if moved.
```

If no drift:
```
🔍 Checking app-map for drift...

Checking 12 mapped components...
  ✓ All 12 components verified

✓ No drift detected. App-map is in sync with codebase.
```
