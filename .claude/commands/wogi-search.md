---
description: "Search the request log by tag or keyword"
---
Search the request log by tag or keyword. Provide search term: `/wogi-search #screen:login`

Search `.workflow/state/request-log.md` for:
- Tags: `#screen:name`, `#component:name`, `#feature:name`, `#bug:id`
- Keywords: Any text in request or result fields

Output matching entries with context:
```
🔍 Search: #screen:login

Found 3 entries:

R-045 | 2024-01-15 14:32
Type: change
Tags: #screen:login #component:AuthForm
Request: "Add forgot password link"
Result: Added link, routes to /forgot-password
Files: LoginScreen.tsx, routes.ts

R-038 | 2024-01-14 09:15
Type: fix
Tags: #screen:login #bug:BUG-003
Request: "Fix password visibility toggle"
Result: Fixed icon state, added aria-label
Files: LoginForm.tsx

R-032 | 2024-01-13 11:20
Type: new
Tags: #screen:login
Request: "Create login screen"
Result: Basic login form with email/password
Files: LoginScreen.tsx, LoginForm.tsx
```
