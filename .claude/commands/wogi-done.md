Complete a task manually. Provide the task ID: `/wogi-done wf-XXXXXXXX`

**Note:** This is usually not needed. `/wogi-start` now auto-completes tasks when all acceptance criteria pass and quality gates are met. Use `/wogi-done` only if:
- You used `--no-loop` with `/wogi-start`
- You want to force-complete a stuck task
- You're completing work done outside the loop

## Spec Verification Gate (v3.1)

Before running quality gates, `/wogi-done` verifies that all deliverables promised in the task's spec file exist. This prevents implementation gaps where specs list files that were never created.

**How it works:**
1. Finds spec file in `.workflow/changes/` matching the task ID
2. Parses spec to extract promised files (from tables, lists, code blocks)
3. Verifies each file exists and passes syntax validation
4. Blocks completion if any deliverables are missing

**Example failure:**
```
Running spec verification...

═══════════════════════════════════════════════════
  Spec Verification
═══════════════════════════════════════════════════

Spec: .workflow/changes/wf-abc123.md

✗ Spec verification FAILED (4/5 deliverables)

Missing files:
  ✗ scripts/flow-missing-feature.js
    (listed in: New Files)

To proceed anyway, use: --skip-spec-check
```

## Options

### `--skip-spec-check`
Skip spec verification (with warning). Use when:
- Spec has false positives (files that shouldn't be verified)
- You intentionally deferred creating some files

```bash
/wogi-done wf-XXXXXXXX --skip-spec-check
```

### `--force`
Force completion even if spec verification or quality gates fail. Use with caution:

```bash
/wogi-done wf-XXXXXXXX --force
```

## Steps

1. **Spec Verification** (if task has spec file)
   - Parse spec for promised deliverables
   - Verify each file exists
   - Verify JS/JSON files have valid syntax
   - Block if missing unless `--skip-spec-check`

2. **Quality Gates** (from config)
   - tests: Verify tests pass (run `npm test` if configured)
   - requestLogEntry: Check `.workflow/state/request-log.md` has entry
   - appMapUpdate: If new components, verify in app-map.md

3. **Task Movement**
   - Move task from inProgress to recentlyCompleted
   - Update lastUpdated timestamp

4. **Post-Completion**
   - Archive durable session if exists
   - Propagate progress to parent epics
   - Archive spec to `.workflow/specs/archived/`
   - Git commit if staged changes

## Output

```
Running spec verification...
✓ Spec verification passed (5/5 deliverables)

Running quality gates...
  ✓ tests passed
  ✓ requestLogEntry found
  ✓ appMapUpdate verified

✓ Completed: wf-XXXXXXXX

Committing changes...
✓ Changes committed: "feat: Complete wf-XXXXXXXX"
```

## Config Options

In `.workflow/config.json`:

```json
{
  "tasks": {
    "requireSpecVerification": true,
    "specVerification": {
      "validateSyntax": true,
      "allowSkipWithFlag": true,
      "parsePatterns": ["tables", "code-blocks", "lists"]
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `requireSpecVerification` | `true` | Enable spec verification gate |
| `validateSyntax` | `true` | Check JS/JSON files for syntax errors |
| `allowSkipWithFlag` | `true` | Allow `--skip-spec-check` flag |

If gates fail, show what needs to be fixed before completing.
