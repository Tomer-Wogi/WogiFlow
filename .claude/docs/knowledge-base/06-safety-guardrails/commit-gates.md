# Commit Gates

Approval workflow for commits.

---

## Purpose

Commit gates ensure:
- Important changes are reviewed
- Small fixes can auto-commit
- Different rules for different change types
- Quality gates pass before commit

---

## Configuration

```json
{
  "commits": {
    "requireApproval": {
      "feature": true,          // Features need approval
      "bugfix": false,          // Bugfixes auto-commit
      "refactor": true,         // Refactors need approval
      "docs": false             // Docs auto-commit
    },
    "autoCommitSmallFixes": true,
    "smallFixThreshold": 3,     // Max files for "small"
    "squashTaskCommits": true,
    "commitMessageFormat": "conventional"
  }
}
```

---

## Approval Flow

### When Approval Required

```
Changes ready to commit
         ↓
┌─────────────────────────────────────────┐
│ Check task type                         │
│ requireApproval[type] === true?         │
├─────────────────────────────────────────┤
│ YES → Continue to approval              │
│ NO  → Check if small fix               │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│ Files changed > smallFixThreshold?      │
├─────────────────────────────────────────┤
│ YES → Require approval                  │
│ NO  → Auto-commit if enabled           │
└─────────────────────────────────────────┘
```

### Approval Prompt

```
Changes to commit:

  M src/services/AuthService.ts
  A src/components/LoginForm.tsx
  A src/components/LoginForm.test.tsx
  M src/routes/index.tsx

Files changed: 4

This is a feature task (approval required).

Ready to commit these changes? [y/n]
```

---

## Task Types

| Type | Default | Use For |
|------|---------|---------|
| `feature` | Approval | New functionality |
| `bugfix` | Auto | Bug fixes |
| `refactor` | Approval | Code restructuring |
| `docs` | Auto | Documentation only |

---

## Small Fix Auto-Commit

When `autoCommitSmallFixes` is true:

```json
{
  "commits": {
    "autoCommitSmallFixes": true,
    "smallFixThreshold": 3
  }
}
```

If changes affect ≤ 3 files AND task type allows:
```
✓ Auto-committed small fix (2 files)
  Commit: abc1234 "fix(auth): correct password validation"
```

---

## Commit Message Format

### Conventional Commits

```json
{
  "commits": {
    "commitMessageFormat": "conventional"
  }
}
```

Format: `type(scope): message`

Examples:
- `feat(auth): add login form`
- `fix(dashboard): correct chart rendering`
- `refactor(api): simplify error handling`

### Simple

```json
{
  "commits": {
    "commitMessageFormat": "simple"
  }
}
```

Format: Just a message
- `Add login form`
- `Fix chart rendering`

---

## Squashing

When `squashTaskCommits` is true:

```json
{
  "commits": {
    "squashTaskCommits": true
  }
}
```

Multiple commits during a task are squashed into one on completion:

```
During task:
  abc1234 feat(auth): initial AuthService
  def5678 feat(auth): add LoginForm
  ghi9012 feat(auth): connect to API

After squash:
  jkl3456 feat(auth): add user authentication
```

---

## Quality Gates Before Commit

Quality gates run before commit is created:

```json
{
  "qualityGates": {
    "feature": {
      "require": ["tests", "lint", "typecheck"]
    }
  }
}
```

### Gate Failure

```
Running quality gates...
  ✓ tests passed
  ✗ lint failed
    Error: 3 lint errors found

Quality gates failed. Fix issues before committing.
```

---

## Bypass Options

### Skip Approval (Not Recommended)

```bash
# Only use in emergencies
git add -A && git commit -m "emergency fix" --no-verify
```

### Temporary Override

Task completion handles commits automatically via the `/wogi-start` pipeline. To skip approval for a specific task type, configure it in `config.json`:

```json
{
  "commits": {
    "requireApproval": {
      "bugfix": false
    }
  }
}
```

---

## Hooks Integration

Works with git hooks:

```json
{
  "hooks": {
    "preCommit": true
  }
}
```

Pre-commit hook runs:
1. Quality gates
2. Security scan
3. Any custom checks

---

## Commit Template

When approval is required, a template is used:

```
feat(scope): brief description

Detailed description of changes...

wf-a1b2c3d4

Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Audit Trail

All commits are logged:

```markdown
### R-047 | 2024-01-15 14:30
**Type**: new
**Commit**: abc1234
**Approved**: Yes
**Files**: 4
```

---

## Best Practices

1. **Keep Features Under Review**: Always approve features
2. **Trust Small Fixes**: Auto-commit for quick fixes
3. **Use Conventional Commits**: Better changelogs
4. **Squash When Done**: Clean git history
5. **Run Quality Gates**: Don't skip verification

---

## Troubleshooting

### Commit Blocked

Check:
- Quality gates status
- Task type and approval settings
- File count vs threshold

### Wrong Commit Type

The task type is determined during task creation. To change it, update the task's `type` field in `ready.json` before completion.

### Squash Failed

If squash fails:
```bash
# Manual squash
git rebase -i HEAD~N
```

---

## Related

- [Quality Gates](../02-task-execution/03-verification.md) - Gate details
- [Security Scanning](./security-scanning.md) - Pre-commit security
- [Configuration](../configuration/all-options.md) - All settings
