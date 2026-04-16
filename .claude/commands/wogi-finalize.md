---
description: "Branch finalization workflow - merge, PR, or discard decision"
effort: medium
---
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

### Step 2.5: Merge-Plan Gate (when `mergePlan.threshold` exceeded)

**Activates when** the branch carries more commits than `config.finalization.mergePlan.threshold` (default **5**) OR the diff is flagged cross-repo by the workspace manifest. The gate writes — and requires the AI to fill in — `.workflow/scratch/merge-plan.md`. The gate exists because the "1-2h mostly mechanical" audit that predicted a 27-conflict merge (wogi-hub, 2026-04-16) counted commits-per-file without reading diff content; the fix is to force per-commit action assignment in a file.

**Mechanical invariants (gate blocks on violation):**

1. For every commit in `git log <base>..<branch>`, the plan MUST contain one line starting with the short SHA and a tagged action. No commits in an "unaccounted" bucket.
2. Allowed actions: `port | adapt | skip-style | superseded | skip-with-reason`.
3. `git log <base>..<branch> | wc -l` MUST equal the count of SHA-prefixed lines in the plan. Mismatch → hard-stop until reconciled.
4. `skip-with-reason` entries MUST include a one-line reason after a `—` (em dash).

**Structural-change detection (before plan write):**

Run the structure-change sensor (`scripts/flow-structure-sensor.js`) on the diff. If ≥ `config.finalization.mergePlan.restructureThreshold` (default **20%**) of changed files match one of these restructure patterns, display a STRUCTURAL CHANGE warning at the top of the plan and bias the default action for affected commits to `adapt`:

| Pattern | Example | Meaning |
|---------|---------|---------|
| `X.tsx` deleted + `X/X.tsx` added | `Card.tsx` → `Card/Card.tsx` | folder-per-component |
| `X.ts` deleted + `<dir>/X.ts` added at deeper depth | `utils.ts` → `utils/date.ts` | split into submodule |
| `X` deleted + `X.<ext>` added elsewhere | `types.ts` → `types/index.ts` | barrel introduction |

**Procedure:**

```bash
# 1. Gather commit list
git log --pretty='%h %s' <base>..<branch> > .workflow/scratch/.merge-plan-commits.txt

# 2. Run structure sensor
node node_modules/wogiflow/scripts/flow-structure-sensor.js <base>..<branch> > .workflow/scratch/.merge-plan-sensor.json

# 3. Write .workflow/scratch/merge-plan.md using the template below,
#    one SHA-prefixed line per commit. Read the FULL diff of each commit
#    (not just the subject line) before assigning an action — that is
#    the whole point of this gate.

# 4. Verify the mechanical invariant
test "$(git log --oneline <base>..<branch> | wc -l)" -eq \
     "$(grep -cE '^[a-f0-9]{7,}\s' .workflow/scratch/merge-plan.md)"
```

**Plan template** (write verbatim, then fill each row by reading the full diff):

```markdown
# Merge plan: <branch> → <base>

Commits: N (from `git log <base>..<branch>`)
Structural-change sensor: <WARN|clean>  — N/M files match restructure patterns
Cross-repo impact: <list workspace members affected, or "single-repo">

## Per-commit actions

| SHA | Subject | Action | Notes |
|-----|---------|--------|-------|
| abc1234 | feat: add login form | port | — |
| def5678 | refactor: split Card.tsx into Card/ | adapt | folder-per-component restructure |
| ghi9012 | chore: lint fixes | skip-style | — |
| jkl3456 | revert: roll back header | skip-with-reason | superseded by mno7890 |

## Structural risks

<leave empty if sensor is clean; otherwise list each pattern hit>

## Content risks

<list overlaps in shared types, DTOs, API surface that need manual review>
```

**When the plan is complete**, the gate verifies the commit-count invariant (step 4) and proceeds to Step 3 (options). If invariant fails, the command stops with the reconciliation command printed.

**Skip conditions:**
- `config.finalization.mergePlan.enabled: false` — opt-out for users who don't want the gate
- Branch commits ≤ threshold AND single-repo — small merges don't need a plan

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

**If Claude Code worktree** (EnterWorktree session): Use the `ExitWorktree` tool (Claude Code 2.1.72+) to cleanly leave the worktree session after merging. This is preferred over manual git worktree cleanup when operating inside a Claude Code-managed worktree.

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

# If WogiFlow worktree: uses flow-worktree.js discardWorktree()
# If Claude Code worktree (EnterWorktree): use ExitWorktree tool to cleanly exit
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
    },
    "mergePlan": {
      "enabled": true,
      "threshold": 5,
      "restructureThreshold": 0.20,
      "alwaysForCrossRepo": true
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
| `mergePlan.enabled` | `true` | Require per-commit merge plan on large or cross-repo merges |
| `mergePlan.threshold` | `5` | Commit count above which the merge plan is required |
| `mergePlan.restructureThreshold` | `0.20` | % of changed files matching restructure patterns that triggers a structural-change warning |
| `mergePlan.alwaysForCrossRepo` | `true` | Require the plan on any cross-repo merge regardless of commit count |

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
