---
description: "Generate a CHANGELOG from request-log entries"
---
Generate a CHANGELOG from request-log entries.

Parse `.workflow/state/request-log.md` and group by type:
- `new` → Added
- `change` → Changed
- `fix` → Fixed
- `refactor` → Refactored
- `remove` → Removed

Output standard changelog format:
```markdown
# Changelog

## [Unreleased]

### Added
- Forgot password link on login page (R-045)
- User profile page with avatar upload (R-042)
- Button ghost variant (R-038)

### Changed
- Updated form validation to use react-hook-form (R-044)
- Improved error message styling (R-040)

### Fixed
- Password visibility toggle state (R-043)
- Mobile responsive issues on dashboard (R-039)

### Refactored
- Extracted AuthForm from LoginScreen (R-037)
```

Options:
- `/wogi-changelog` - All unreleased changes
- `/wogi-changelog v1.0` - Changes since v1.0 tag
- `/wogi-changelog --save` - Write to CHANGELOG.md file
