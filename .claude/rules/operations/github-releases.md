---
description: "GitHub release workflow - prevents race conditions in npm publish"
alwaysApply: false
globs: package.json
---

# GitHub Release Workflow

**Source**: Repeated failures (10+ times) in npm publish automation
**Priority**: Critical - prevents wasted releases and broken npm versions

## Problem

Running `git push` followed immediately by `gh release create` causes a race condition. The release tag gets created on the remote's HEAD before the push fully propagates, pointing to an old commit.

## Pre-Release Quality Gate (MANDATORY)

Before ANY release, verify the codebase is in a releasable state:

1. **Check outstanding findings**: Read `.workflow/state/last-review.json` — if unresolved critical/high findings exist, STOP and fix them first
2. **Run lint** (if configured): `npm run lint`
3. **Run typecheck** (if configured): `npm run typecheck`
4. **Verify no uncommitted changes**: `git status` should be clean

The `preRelease` and `outstandingFindings` quality gates in `flow-done.js` enforce this automatically for `release` type tasks. For manual releases, check these yourself.

## Correct Procedure

```bash
# 0. Verify codebase is releasable (pre-release gate)
# (automated by flow-done.js for release-type tasks)

# 1. Push commits first
git push origin master

# 2. Create tag LOCALLY on the correct commit
git tag vX.Y.Z HEAD

# 3. Push the tag explicitly
git push origin vX.Y.Z

# 4. THEN create the release (it will use the existing tag)
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

## Never Do This

```bash
# BAD - race condition, tag may point to wrong commit
git push origin master && gh release create vX.Y.Z ...
```

## Recovery Procedure

If a release fails with wrong version:

1. Delete the bad release: `gh release delete vX.Y.Z --yes`
2. Delete the bad remote tag: `git push origin --delete vX.Y.Z`
3. Delete local tag if exists: `git tag -d vX.Y.Z`
4. Follow the correct procedure above

## Verification

Before creating the release, verify:
```bash
git show vX.Y.Z --quiet --format="%H"  # Should match HEAD
git show vX.Y.Z:package.json | grep version  # Should show X.Y.Z
```

---
Last updated: 2026-01-30
