# Branch Finalization

Guided merge, PR, or discard decision for completed branches and worktrees.

---

## Purpose

After completing work on a feature branch or worktree, `/wogi-finalize` presents a structured decision workflow instead of auto-merging. It gathers branch context, runs pre-finalization checks, and offers four options: merge, create PR, keep alive, or discard.

---

## Configuration

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
| `defaultAction` | `"ask"` | `"ask"`, `"merge"`, or `"pr"` |
| `autoMergeForTypes` | `["bugfix", "quick-fix"]` | Task types that skip the prompt and auto-merge |
| `requirePRForTypes` | `[]` | Task types that must create a PR |
| `squashOnMerge` | `true` | Squash commits when merging |
| `prTemplate` | `{...}` | Controls auto-generated PR body content |

---

## How It Works

### Step 1: Gather Branch Context

The command detects the current branch, identifies the base branch (main/master/develop), and collects stats: commit count, files changed, insertions, and deletions.

```
Branch: feature/wf-abc123-add-login
Base:   master
Commits: 3
Files changed: 5
Insertions: +142  Deletions: -23
```

### Step 2: Pre-Finalization Checks

Before presenting options, it verifies:
- Tests pass (if configured)
- No uncommitted changes
- No merge conflicts with the base branch

If checks fail, warnings are displayed with suggested fixes.

### Step 3: Choose an Action

Four options are presented:

| Option | Description |
|--------|-------------|
| **Merge to master** | Squash merge and delete the branch. Best for solo or small changes. |
| **Create Pull Request** | Push branch and create a GitHub PR. Best for team review or CI. |
| **Keep branch alive** | No action taken. Branch remains for continued work. |
| **Discard branch** | Delete branch and all changes. Requires typing "discard" to confirm. |

---

## Merge Behavior

When merging, the command:
1. Checks out the base branch
2. Squash merges (or regular merge when `squashOnMerge: false`)
3. Commits with a task reference: `feat: Complete wf-XXXXXXXX - [title]`
4. Deletes the feature branch
5. Optionally pushes to remote

In worktree mode, this delegates to `flow-worktree.js` `commitAndMerge()`.

---

## PR Generation

When creating a pull request, the command:
1. Pushes the branch to the remote
2. Auto-populates the PR body from the task spec in `.workflow/changes/`
3. Extracts acceptance criteria as a test plan checklist
4. Includes commit list and file change summary
5. Creates the PR via `gh pr create`

---

## Integration with Task Completion

When `/wogi-start` completes a task in a worktree:

| Condition | Behavior |
|-----------|----------|
| `finalization.enabled: true` | Invokes `/wogi-finalize` to present options |
| `finalization.enabled: false` | Uses auto-merge (legacy behavior) |
| Task is L3 (subtask) | Auto-merge (too small for a decision) |
| Running in `/wogi-bulk` mode | Auto-merge (no batch interruptions) |
| `--auto-merge` flag on `/wogi-start` | Skips finalization |
| Task failed | Auto-discard worktree |

---

## Commands

| Command | Purpose |
|---------|---------|
| `/wogi-finalize` | Auto-detect current branch and finalize |
| `/wogi-finalize <branch-name>` | Finalize a specific branch |
| `/wogi-finalize --worktree` | Finalize current worktree with cleanup |

---

## Best Practices

1. **Use PRs for team projects** -- Set `requirePRForTypes: ["feature", "refactor"]` to enforce review
2. **Auto-merge small fixes** -- The default `autoMergeForTypes: ["bugfix", "quick-fix"]` keeps velocity high
3. **Squash by default** -- Keeps master history clean; disable for detailed commit preservation
4. **Run before session end** -- Avoid leaving stale branches; worktrees are cleaned up after 24 hours

---

## Related

- [Task Completion](./04-completion.md) - Post-task workflow
- [Session Review](./05-session-review.md) - End-of-session workflow
- [Commit Gates](../06-safety-guardrails/commit-gates.md) - Pre-commit safety checks
