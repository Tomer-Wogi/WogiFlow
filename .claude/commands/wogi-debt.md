---
description: "View and manage technical debt across sessions"
---
View and manage technical debt across sessions.

**Triggers**: `/wogi-debt`, "show debt", "technical debt", "debt status"

## Usage

```bash
/wogi-debt                  # Show debt summary dashboard
/wogi-debt list             # List all open items
/wogi-debt list --aging     # Show items seen 3+ sessions
/wogi-debt list --fixable   # Show auto-fixable items
/wogi-debt fix              # Run auto-fixes (batch all at once)
/wogi-debt dismiss <id>     # Mark as won't-fix
/wogi-debt promote <id>     # Create task from debt item
/wogi-debt promote-aging    # Create tasks for all aging items
```

## How It Works

Technical debt is captured automatically from `/wogi-session-review` and persisted to `.workflow/state/tech-debt.json`. Each issue tracks:

- **File and line**: Where the issue was found
- **Severity**: critical, high, medium, low
- **Sessions seen**: How many sessions this issue has persisted
- **Auto-fixable**: Whether safe batch fixing is possible

### Issue Aging

Issues that persist across multiple sessions are flagged as "aging":
- **Session 1-2**: Normal tracking
- **Session 3+**: Marked as aging, shown in warnings
- **Auto-promotion**: Aging items can auto-create tasks

### Auto-Fixable Issues

Certain issue types can be safely batch-fixed:
- `console.log` statements → Remove line
- `debugger` statements → Remove line
- Unused imports → Remove import
- Empty catch blocks → Add comment

When you run `/wogi-debt fix`, ALL auto-fixable items are processed at once.

## Execution Steps

When `/wogi-debt` is invoked:

1. **Load tech debt data** from `.workflow/state/tech-debt.json`
2. **Parse arguments** to determine action (list, fix, dismiss, promote)
3. **Execute action**:
   - `list`: Filter and display issues based on flags
   - `fix`: Run auto-fix engine on all fixable items
   - `dismiss`: Mark issue as won't-fix
   - `promote`: Create task in ready.json from debt item
4. **Display results** with severity colors and counts

## Output Format

### Summary Dashboard
```
╔══════════════════════════════════════════════════════════╗
║  Technical Debt Dashboard                                 ║
╚══════════════════════════════════════════════════════════╝

Summary: 15 open items
  Critical: 0  High: 2  Medium: 5  Low: 8

⚠ 3 items aging (3+ sessions)
✓ 6 auto-fixable items available

Commands:
  flow tech-debt list          List all items
  flow tech-debt list --aging  Show aging items
  flow tech-debt fix           Run auto-fixes
```

### List View
```
━━━ All Open Issues ━━━
  [td-001] scripts/utils.js:45 (low)
      console.log statement
      Fix: Remove debugging statement

  [td-002] scripts/main.js:234 (medium) ⚠ 5 sessions
      Magic number should be named constant
      Fix: Extract to TIMEOUT_MS

Total: 15 items
```

## Integration Points

- **Session Review**: Issues captured after `/wogi-session-review`
- **Morning Briefing**: Debt summary shown in `/wogi-morning`
- **Session End**: Optional cleanup prompt in `/wogi-session-end`
- **Task System**: Aging items auto-promoted to ready.json

## Config Options

In `.workflow/config.json`:

```json
{
  "techDebt": {
    "enabled": true,
    "promptOnSessionEnd": true,
    "showInMorningBriefing": true,
    "agingThreshold": 3,
    "autoFix": {
      "enabled": true,
      "types": ["console.log", "unused-import", "debugger", "empty-catch"]
    }
  }
}
```

## When No Debt Found

```
╔══════════════════════════════════════════════════════════╗
║  Technical Debt Dashboard                                 ║
╚══════════════════════════════════════════════════════════╝

Summary: 0 open items
  ✓ No technical debt tracked

Run /wogi-session-review to scan for issues.
```
