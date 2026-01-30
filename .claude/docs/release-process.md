# WogiFlow Release Process

Complete checklist for releasing new versions of WogiFlow.

## Release Steps (2026-01-28)

When the user says "update GitHub" or "create a release", follow these steps:

### 1. Commit Changes
If there are uncommitted changes:
```bash
git add [files]
git commit -m "description"
```

### 2. Bump Version
```bash
npm version patch --no-git-tag-version
```
Use `minor` or `major` instead of `patch` for larger changes.

### 3. Commit Version Bump
```bash
git add package.json package-lock.json
git commit -m "chore: Bump version to X.X.X"
```

### 4. Push to GitHub
```bash
git push origin master
```

### 5. Create GitHub Release
```bash
gh release create vX.X.X --title "vX.X.X" --notes "Release notes here"
```

### 6. Publish to npm (CRITICAL)
```bash
npm publish
```

**This step is MANDATORY.** Do NOT rely on CI alone - always run locally to ensure the package is published.

### 7. Verify
```bash
npm view wogiflow version
```
Confirm the new version is live.

---

## Why Local npm Publish?

CI-triggered publishing can:
- Fail silently
- Have timing issues
- Miss authentication problems

Local publish ensures the release is complete and immediately verifiable.

---

## Release Types

| Type | Version | When |
|------|---------|------|
| Patch | `X.X.+1` | Bug fixes, small improvements |
| Minor | `X.+1.0` | New features, non-breaking changes |
| Major | `+1.0.0` | Breaking changes, major rewrites |
