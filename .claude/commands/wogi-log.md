---
description: "Add an entry to the request log"
---
Add an entry to the request log.

Usage: `/wogi-log` (interactive) or with parameters

Steps:
1. Get next entry number from request-log.md
2. Ask for or parse:
   - Type (new/change/fix/refactor/remove)
   - Request description
   - Result summary
   - Files changed
   - Tags (#screen:X, #component:Y, etc.)
3. Append to `.workflow/state/request-log.md`

Interactive:
```
📝 New Request Log Entry

Type? (new/change/fix/refactor/remove): change
Request: Added forgot password link to login
Result: Link added, routes to /forgot-password
Files changed: LoginScreen.tsx, routes.ts
Tags: #screen:login #feature:auth

✓ Added R-046 to request-log
```

Entry format:
```markdown
### R-046 | 2024-01-15 14:32
**Type**: change
**Tags**: #screen:login #feature:auth
**Request**: Added forgot password link to login
**Result**: Link added, routes to /forgot-password
**Files**: `LoginScreen.tsx`, `routes.ts`

---
```
