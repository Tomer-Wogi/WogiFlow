---
description: View and edit the current hybrid execution plan
---

# Edit Hybrid Execution Plan

View the current execution plan and modify steps before running.

## Step 1: Load Current Plan

```bash
if [ -f ".workflow/state/current-plan.json" ]; then
    echo "═══════════════════════════════════════════════════════════"
    echo "              CURRENT EXECUTION PLAN"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    jq -r '
      "Task: \(.taskId // "unknown")",
      "Executor: \(.executor // "not set")",
      "Steps: \(.steps | length)",
      "",
      (.steps | to_entries[] | "  Step \(.key + 1): [\(.value.status // "pending")] \(.value.description // "unnamed")\n    Model: \(.value.model // "default")\n    Files: \(.value.files // [] | join(", "))\n")
    ' .workflow/state/current-plan.json
    echo "═══════════════════════════════════════════════════════════"
else
    echo ""
    echo "No active execution plan."
    echo ""
    echo "A plan is created when you start a task with hybrid mode enabled."
    echo "Use /wogi-hybrid to enable hybrid mode first, then /wogi-start a task."
    echo ""
fi
```

## Edit Options

If a plan exists, tell me what you'd like to change:

### Modify Steps
1. **Add a step** — "Add a step to create unit tests after step 3"
2. **Remove a step** — "Remove step 4, I'll handle that manually"
3. **Modify a step** — "Change step 2 to use React Hook Form instead"
4. **Reorder steps** — "Move step 5 before step 3"

### Change Execution
5. **Change model for a step** — "Use Sonnet for step 3 instead of Haiku"
6. **Change model for all** — "Use GPT-4o-mini for all remaining steps"
7. **Mark step as manual** — "I'll do step 4 myself, skip it"
8. **Change to parallel** — "Run steps 2 and 3 in parallel"

### Plan Management
9. **Save plan** — Save current plan to reuse later
10. **Discard plan** — Cancel execution and discard plan
11. **Reset plan** — Regenerate plan from task spec

## How Plan Editing Works

When you request a change:
1. I read the current plan from `.workflow/state/current-plan.json`
2. Apply your modifications
3. Show the updated plan for confirmation
4. Save the updated plan
5. Execution continues from where it left off

## Plan File Format

Plans are stored at `.workflow/state/current-plan.json`:

```json
{
  "taskId": "wf-XXXXXXXX",
  "executor": "claude-3-5-haiku-latest",
  "routing": "smart",
  "createdAt": "ISO timestamp",
  "steps": [
    {
      "id": 1,
      "description": "Create UserCard component",
      "model": "claude-3-5-sonnet-latest",
      "status": "pending",
      "files": ["src/components/UserCard.tsx"],
      "context": "Template + patterns from app-map",
      "verification": ["lint", "typecheck"]
    }
  ]
}
```

## Example Requests

```
"Add a step to create unit tests after the service"
"Remove step 3, I'll handle that manually"
"Change step 2 to use Sonnet instead of Haiku"
"Make steps 1-3 run in parallel"
"Use GPT-4o-mini for all documentation steps"
```

What would you like to change?
