Show full project overview.

Run `./scripts/flow status` to see the overview.

Options:
- `--json` - Output JSON for programmatic access

Related: `/wogi-morning` for session-focused briefing with suggested next action.

Gather information from:
1. `.workflow/state/ready.json` - Task counts by status
2. `.workflow/changes/` - Active features
3. `.workflow/bugs/` - Open bugs
4. `.workflow/state/app-map.md` - Component count
5. `git status` - Branch and uncommitted changes
6. `.workflow/state/request-log.md` - Recent activity (last 5 entries)

7. `scripts/flow-agent-teams.js` - Agent Teams state (if enabled)

**Agent Teams Status** (auto-detected from environment):

When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` or `CLAUDE_CODE_AGENT_TEAMS=1` is set, also display:
- Current role (lead/teammate)
- Active teammates and their current tasks
- Files currently being worked on across all teammates
- Any file conflicts detected

Run `node scripts/flow-agent-teams.js status` for detailed teammate state.

Output format:
```
📊 Project Status

Tasks:
  Ready: 5 | In Progress: 2 | Blocked: 1 | Completed: 12

Features:
  • auth (3 tasks remaining)
  • user-profile (1 task remaining)

Bugs: 2 open

Components: 24 mapped

Git:
  Branch: feature/auth
  Uncommitted: 3 files

Agent Teams:
  Mode: active (lead)
  Teammates: 2 active, 1 idle
  Files in progress: 5

Recent Activity:
  • R-045: Added login form validation
  • R-044: Fixed password reset flow
  • R-043: Created Button component
```
