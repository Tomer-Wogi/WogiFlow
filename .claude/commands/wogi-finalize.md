# /wogi-finalize - Branch Finalization Workflow

Guides the merge/PR/discard decision after completing work on a branch or worktree.

## When to Use

- After `/wogi-start` completes a task in a worktree
- When finishing work on any feature branch
- When you want a guided decision about what to do with a branch
- Automatically suggested at the end of worktree-based task execution

## Usage

```
/wogi-finalize                    # Auto-detect current branch
/wogi-finalize <branch-name>      # Finalize a specific branch
/wogi-finalize --worktree         # Finalize current worktree (cleanup included)
```

## Workflow

### Step 1: Gather Branch Context

1. Detect current branch (or use provided branch name)
2. Identify the base branch (main/master/develop)
3. Gather branch stats:

```bash
# Commits on this branch
git log --oneline <base>..<branch>

# Files changed
git diff --stat <base>..<branch>

# Diff summary
git diff --shortstat <base>..<branch>
```

4. Display summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRANCH FINALIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Branch: feature/wf-abc123-add-login
Base:   master
Commits: 3
Files changed: 5
Insertions: +142  Deletions: -23

Commits:
  abc1234 feat: add login form component
  def5678 feat: add auth API integration
  ghi9012 test: add login flow tests

Task: wf-abc123 — Add login form (COMPLETED)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 2: Pre-Finalization Checks

Before presenting options, verify the branch is ready:

1. **Tests pass** — Run test suite if configured
2. **No uncommitted changes** — All work is committed
3. **No merge conflicts** — Check if base branch has diverged

```
Pre-finalization checks:
  Tests:              PASSED (12/12)
  Uncommitted changes: None
  Merge conflicts:     None (base is 0 commits ahead)
```

If checks fail, display warnings and suggest fixes before proceeding.

### Step 3: Present Options

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
What would you like to do with this branch?

  [1] Merge to master
      Squash commits and merge directly. Best for solo work
      or small changes that don't need review.

  [2] Create Pull Request
      Push branch and create a PR on GitHub. Best for team
      review, CI checks, or documentation of changes.

  [3] Keep branch alive
      Don't merge yet. Branch stays for continued work
      or future review.

  [4] Discard branch
      Delete branch and all changes. Use when the approach
      was wrong or work is no longer needed.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Option 1: Merge to Master

```bash
# Switch to base branch
git checkout master

# Squash merge (default) or regular merge
git merge --squash <branch>
# OR: git merge <branch>  (when squash=false)

# Commit with task reference
git commit -m "feat: Complete wf-XXXXXXXX - [title]"

# Delete the branch
git branch -d <branch>
```

**If worktree mode**: Use `flow-worktree.js` `commitAndMerge()` which handles all of this.

**Config**: `config.worktree.squashOnMerge` controls squash behavior (default: true).

After merge, ask:
```
Merged to master. Push to remote?
  [y] Yes, push now
  [n] No, I'll push later
```

### Option 2: Create Pull Request

```bash
# Push branch to remote
git push -u origin <branch>

# Create PR using gh CLI
gh pr create \
  --title "feat: [task title] (wf-XXXXXXXX)" \
  --body "$(cat <<'EOF'
## Summary
[Auto-generated from task spec and commit messages]

## Task
- Task ID: wf-XXXXXXXX
- Title: [title]
- Type: [feature/bugfix/refactor]

## Changes
[File diff summary]

## Test Plan
[From task spec test strategy, or auto-generated checklist]

Generated with [WogiFlow](https://github.com/user/wogi-flow)
EOF
)"
```

**PR body auto-population**:
1. Read task spec from `.workflow/changes/*/wf-XXXXXXXX.md`
2. Extract acceptance criteria as test plan checklist
3. Include commit list
4. Include file change summary

After PR creation, display the PR URL.

### Option 3: Keep Branch Alive

No action taken. Display:
```
Branch kept: feature/wf-abc123-add-login

To resume later:
  git checkout feature/wf-abc123-add-login
  /wogi-finalize  (when ready to merge)
```

**If worktree**: Keep worktree alive (don't cleanup). Warn about stale worktree cleanup:
```
Note: Stale worktrees are cleaned up after 24 hours.
To prevent cleanup, commit and push your changes.
```

### Option 4: Discard Branch

Confirmation required:
```
Are you sure you want to discard this branch?
This will delete 3 commits and 142 lines of work.

Type "discard" to confirm:
```

After confirmation:
```bash
# Switch to base branch
git checkout master

# Delete branch
git branch -D <branch>

# If worktree, also remove worktree
# Uses flow-worktree.js discardWorktree()
```

## Integration with Task Completion

When `/wogi-start` completes a task that was executed in a worktree, the finalization step replaces the current auto-merge behavior:

**Current behavior** (without `/wogi-finalize`):
- Success → auto `commitAndMerge()`
- Failure → auto `discardWorktree()`

**New behavior** (when `config.finalization.enabled: true`):
- Success → invoke `/wogi-finalize` to present options
- Failure → still auto `discardWorktree()` (no point keeping broken work)

**Skip conditions**:
- `config.finalization.enabled` is false → use current auto-merge behavior
- Task is L3 (subtask) → auto-merge (too small to warrant decision)
- Running in bulk mode (`/wogi-bulk`) → auto-merge (don't interrupt batch)
- `--auto-merge` flag on `/wogi-start` → skip finalization

## Config

```json
{
  "finalization": {
    "enabled": true,
    "defaultAction": "ask",
    "autoMergeForTypes": ["bugfix", "quick-fix"],
    "requirePRForTypes": [],
    "squashOnMerge": true,
    "prTemplate": {
      "includeTaskSpec": true,
      "includeCommitList": true,
      "includeFileSummary": true
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable branch finalization workflow |
| `defaultAction` | `"ask"` | `"ask"`, `"merge"`, `"pr"` — default behavior |
| `autoMergeForTypes` | `["bugfix", "quick-fix"]` | Task types that skip the prompt and auto-merge |
| `requirePRForTypes` | `[]` | Task types that must create a PR (useful for teams) |
| `squashOnMerge` | `true` | Squash commits when merging |
| `prTemplate` | `{...}` | What to include in auto-generated PR body |

## Examples

```
User: "finalize this branch"
→ /wogi-finalize (auto-detect current branch)

User: "create a PR for my changes"
→ /wogi-finalize (user will pick option 2)

User: "merge to master"
→ /wogi-finalize (user will pick option 1)

User: "discard this branch"
→ /wogi-finalize (user will pick option 4)
```
