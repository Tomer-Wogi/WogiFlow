# [wf-gitignore] Default .workflow/ to gitignored in target projects with opt-in tracking

## User Story
**As a** WogiFlow user installing the package in my project
**I want** all `.workflow/` files to be gitignored by default
**So that** my workflow state, session data, and task history don't accidentally get committed to shared repos, while retaining the option to track shared knowledge files if I choose

## Description
Currently, `postinstall.js` creates `.workflow/` directories and state files but does NOT add any `.gitignore` entries to the target project. This means all WogiFlow runtime data (ready.json, session-state.json, prompt-history.json, task specs, review artifacts, etc.) can accidentally get committed to git.

The fix adds a `.gitignore` update to postinstall that excludes all `.workflow/` and `.claude/` runtime files by default. Users who want to track shared knowledge files (app-map.md, decisions.md, request-log.md) can opt in via a config option or by manually editing their `.gitignore`.

## Acceptance Criteria

### Scenario 1: Fresh install adds .gitignore entries
**Given** a project without WogiFlow installed
**When** the user runs `npm install wogiflow`
**Then** postinstall appends a WogiFlow section to the project's `.gitignore`
**And** the section includes entries for `.workflow/state/`, `.workflow/tmp/`, `.workflow/memory/`, `.workflow/changes/`, `.workflow/verifications/`, `.workflow/specs/`, `.workflow/checkpoints/`, `.workflow/bugs/`, `.workflow/reviews/`, `.workflow/corrections/`, `.workflow/epics/`, `.workflow/plans/`, `.claude/settings.local.json`, `.claude/plans/`
**And** the section is clearly delimited with `# WogiFlow (auto-managed)` header and `# End WogiFlow` footer

### Scenario 2: Existing .gitignore is preserved
**Given** a project with an existing `.gitignore` containing user entries
**When** the user runs `npm install wogiflow`
**Then** the existing entries are preserved
**And** the WogiFlow section is appended at the end
**And** duplicate entries are not created

### Scenario 3: Repeat install does not duplicate entries
**Given** a project where WogiFlow is already installed and .gitignore has the WogiFlow section
**When** the user runs `npm install wogiflow` again (e.g., npm update)
**Then** the existing WogiFlow section is replaced in-place (not duplicated)
**And** any entries added since the last install outside the managed section are preserved

### Scenario 4: No .gitignore exists — create one
**Given** a project with no `.gitignore` file
**When** the user runs `npm install wogiflow`
**Then** a new `.gitignore` is created with the WogiFlow section

### Scenario 5: Config option to track shared knowledge files
**Given** a user who wants to commit shared knowledge files to git
**When** they set `config.git.trackSharedFiles: true` (or run a workflow command)
**Then** the managed .gitignore section adds negation patterns for:
  - `!.workflow/state/app-map.md`
  - `!.workflow/state/decisions.md`
  - `!.workflow/state/function-map.md`
  - `!.workflow/state/api-map.md`
  - `!.workflow/state/request-log.md`
  - `!.workflow/state/feedback-patterns.md`
  - `!.workflow/config.json`

### Scenario 6: Preuninstall cleans up .gitignore
**Given** WogiFlow is installed and .gitignore has the managed section
**When** the user runs `npm uninstall wogiflow`
**Then** the WogiFlow section is removed from `.gitignore`
**And** other entries in the file are preserved

## Technical Notes

### Files to Modify
- `scripts/postinstall.js` — Add `updateGitignore()` function called from `main()`
- `scripts/preuninstall.js` — Add `cleanupGitignore()` function called during uninstall
- `.workflow/config.json` — Add `git.trackSharedFiles` config key (default: false)

### Implementation Approach
- Use sentinel comments to identify the managed section:
  ```
  # WogiFlow (auto-managed — do not edit this section)
  .workflow/state/
  .workflow/tmp/
  .workflow/memory/
  ...
  # End WogiFlow
  ```
- On update: find existing section by sentinels, replace content between them
- On fresh install: append section to end of file
- On uninstall: remove everything between sentinels (inclusive)
- Read config.json (if exists) to check `git.trackSharedFiles` for negation patterns

### Gitignore Entries (Default)
```gitignore
# WogiFlow (auto-managed — do not edit this section)
.workflow/state/
.workflow/tmp/
.workflow/memory/
.workflow/changes/
.workflow/verifications/
.workflow/specs/
.workflow/checkpoints/
.workflow/bugs/
.workflow/reviews/
.workflow/corrections/
.workflow/epics/
.workflow/plans/
.claude/settings.local.json
.claude/plans/
# End WogiFlow
```

### When `trackSharedFiles: true`
```gitignore
# WogiFlow (auto-managed — do not edit this section)
.workflow/state/
.workflow/tmp/
.workflow/memory/
.workflow/changes/
.workflow/verifications/
.workflow/specs/
.workflow/checkpoints/
.workflow/bugs/
.workflow/reviews/
.workflow/corrections/
.workflow/epics/
.workflow/plans/
.claude/settings.local.json
.claude/plans/
# WogiFlow shared knowledge (tracked)
!.workflow/config.json
!.workflow/state/app-map.md
!.workflow/state/decisions.md
!.workflow/state/function-map.md
!.workflow/state/api-map.md
!.workflow/state/request-log.md
!.workflow/state/feedback-patterns.md
# End WogiFlow
```

### Security
- Validate the gitignore path is within the project root (prevent path traversal)
- Use `fs.readFileSync`/`fs.writeFileSync` wrapped in try-catch per security patterns
- Don't fail the install if .gitignore update fails (warn only)

## Test Strategy
- [ ] Manual: Fresh `npm install wogiflow` in a new project — verify .gitignore created
- [ ] Manual: Install in project with existing .gitignore — verify entries appended, existing preserved
- [ ] Manual: `npm update wogiflow` — verify section replaced, not duplicated
- [ ] Manual: `npm uninstall wogiflow` — verify section removed cleanly
- [ ] Manual: Set `git.trackSharedFiles: true`, reinstall — verify negation patterns added
- [ ] Automated: `node --check scripts/postinstall.js` and `node --check scripts/preuninstall.js`

## Dependencies
- None

## Complexity
Medium — 2 files modified (postinstall.js, preuninstall.js), 1 config key added. Well-defined boundaries. Main risk is edge cases in .gitignore parsing (BOM, trailing newlines, Windows line endings).
