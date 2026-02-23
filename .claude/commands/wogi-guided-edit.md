Guide through multi-file changes step by step.

Usage:
- `/wogi-guided-edit "rename Button to BaseButton"` - Start guided edit
- `/wogi-guided-edit --from schema.prisma` - Detect affected files from schema change

## Examples

```
/wogi-guided-edit "rename UserService to UserManager"
/wogi-guided-edit "replace console.log with logger.debug"
/wogi-guided-edit "find deprecated API calls"
/wogi-guided-edit "update all imports from @old/lib to @new/lib"
```

## Task Gating

This command modifies files. It MUST operate within one of these contexts:

1. **Within `/wogi-start`** (preferred): When invoked as part of an active task, the task already exists in `ready.json` inProgress. Proceed directly — task lifecycle is managed by the parent command.
2. **Standalone invocation**: Before editing files, check `ready.json` for an active inProgress task with `feature: "guided-edit"`. If no guided-edit task exists, create one:
   ```json
   {
     "id": "[call generateTaskId('Guided edit: [description]')]",
     "title": "Guided edit: [description]",
     "type": "fix",
     "feature": "guided-edit",
     "status": "in_progress",
     "priority": "P2",
     "createdAt": "[ISO timestamp]",
     "startedAt": "[ISO timestamp]"
   }
   ```
   Add to `ready.json` inProgress before any file modifications. Store the task ID in the session file for cleanup.

## Workflow

1. **Analyze**: Find all files affected by the change
2. **Plan**: Show list of files with match counts
3. **Step Through**: For each file:
   - Show current match locations
   - Show proposed diff (if replace operation)
   - User: approve / reject / skip
4. **Apply**: Make approved changes
   - **After each file edit**, validate by file type:
     - `.js` files: `node --check <file>` + ESLint
     - `.ts`/`.tsx` files: `npx tsc --noEmit` + ESLint
     - `.json` files: JSON parse check
     - Other types: skip validation
   - Do NOT proceed to next file until current file passes validation
5. **Summary**: Show completion stats
6. **Complete task** (standalone invocation only): If a guided-edit task was created in step 2, move it from inProgress to recentlyCompleted in `ready.json`. If running within `/wogi-start` (case 1), skip — the parent command manages task lifecycle.

## Abort Handling

When the user issues `abort`/`q`, or the session is abandoned mid-edit:
1. Move the guided-edit task from inProgress to recentlyCompleted with a note: "Aborted after N/M files"
2. The session file (`.workflow/state/guided-edit-session.json`) retains progress for potential resume
3. Do NOT leave tasks stuck in inProgress — always clean up on exit

## Commands During Session

Once a session starts, use these commands:

| Command | Action |
|---------|--------|
| `next` / `n` | Show next file to review |
| `approve` / `a` | Approve and apply changes |
| `reject` / `r` | Reject file, skip changes |
| `skip` / `s` | Skip for now (review later) |
| `status` | Show progress |
| `abort` / `q` | Cancel session |

## Session Persistence

Progress is saved to `.workflow/state/guided-edit-session.json`. You can:
- Close Claude and resume later
- Use `status` to see where you left off
- Use `abort` to cancel and start fresh

## Use Cases

### Large Refactors
Rename a component across 20+ files with confidence:
```
/wogi-guided-edit "rename Button to BaseButton"
```

### Library Upgrades
Update imports everywhere:
```
/wogi-guided-edit "replace import { X } from 'old-lib' with import { X } from 'new-lib'"
```

### Code Cleanup
Find and review deprecated patterns:
```
/wogi-guided-edit "find componentWillMount"
```

### Schema Changes
After changing an entity, update all related files:
```
/wogi-guided-edit "find UserEntity"
```

## Claude's Role

When running this command, Claude will:

1. Parse the description to understand the operation
2. Run the script to find affected files
3. Present each file for your review
4. Apply changes only when you approve
5. Track progress and provide summary

The goal is methodical, confident multi-file editing with human oversight.
