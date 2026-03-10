# Project Decisions

Project-specific rules for the **wogi-flow** repository. These are conventions and decisions unique to THIS project, not WogiFlow product behavior.

**What belongs here:** Team conventions, project-specific architecture, repo-specific procedures.
**What does NOT belong here:** WogiFlow product behavior (fix the commands/scripts/templates instead), rules already in `.claude/rules/` (no duplication), rules already in CLAUDE.md.

---

## Architecture Decisions

### Dual-Repo Architecture (2026-02-28)
**Source**: User directive — formalize dual-repo management for wogi-flow + wogiflow-cloud
**Rule**: Two repos, independent versions, mutual version awareness. OSS (`wogi-flow` / npm `wogiflow`) and Cloud (`wogiflow-cloud` / `@wogiflow/teams`) are separate packages with separate release cycles.

**Key constraints:**
1. **No teams code in the free repo** — all team logic lives in `wogiflow-cloud`. The free repo provides extension points only.
2. **Independent semver** — each repo versions independently. The client declares compatibility via peerDependencies (`wogiflow >= X.Y.Z`).
3. **Cross-repo version file** — each repo maintains `.workflow/state/partner-versions.json` recording the other's last-known version. Updated on every release.
4. **OSS releases first** — if cloud needs a new OSS feature/export, release OSS first, then cloud.
5. **Interface contract** — exported functions, hook interfaces, state file formats, and config keys used by cloud are documented in `.claude/rules/_internal/dual-repo-management.md`. Changes to these require updating the cloud client.

**Verification**: Before releasing either repo, check `partner-versions.json` and grep the other repo for consumers of changed interfaces.

---

## Coding Standards

### Code Quality Patterns (2026-01-12)
**Source**: Session review findings

1. **Single Source of Truth for Constants**
   - Avoid duplicating model/configuration objects across files
   - Import from one canonical location instead
   - Reason: Prevents drift and makes updates simpler

2. **Named Constants for Magic Numbers**
   - Define constants for threshold values, percentages, limits
   - Example: `COVERAGE_THRESHOLDS = { default: 0.7, comprehensive: 0.85, concise: 0.5 }`
   - Reason: Self-documenting code, easier maintenance

---

## UI/UX Decisions

<!-- Add UI/UX decisions here -->

---

## File/Folder Structure

<!-- Add structure rules here -->

---

## Operational Procedures

### GitHub Release Workflow (2026-01-30)
**Source**: Repeated failures (10+ times) in npm publish automation
**Details**: See `.claude/rules/_internal/github-releases.md` for full procedure.

**Quick reference**:
1. `git push origin master`
2. `git tag vX.Y.Z HEAD`
3. `git push origin vX.Y.Z`
4. `gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."`
5. `npm publish`

---

## Review & Cleanup Procedures

<!-- Project-specific review procedures go here -->
