Autonomous browser debugging loop that navigates to your app, identifies issues, fixes code, and verifies - all automatically.

## Usage

```
/wogi-debug-browser "description of expected behavior"
/wogi-debug-browser --url http://localhost:3000 "click Login, expect dashboard"
```

## Prerequisites

**Chrome integration must be active:**
1. Start Claude Code with: `claude --chrome`
2. Or run `/chrome` in an existing session
3. Claude in Chrome extension v1.0.36+ required

## How It Works

When you describe what should happen, the debug loop:

1. **Navigates** to your app
2. **Tries** the expected action
3. **Checks** if it worked
4. If not:
   - **Reads** console errors
   - **Analyzes** the failure
   - **Fixes** the code
   - **Refreshes** and verifies
5. **Repeats** until working (max 10 iterations)

## Input Formats

### Natural Language (Recommended)
```
/wogi-debug-browser "click the Login button, expect to see the dashboard"
/wogi-debug-browser "select a project, click Pull Tasks, expect task list to appear"
/wogi-debug-browser "fill in email and password, submit form, should redirect to home"
```

### With URL
```
/wogi-debug-browser --url http://localhost:3000/login "enter credentials, click submit"
```

## Debug Loop Protocol

When executed, follow this autonomous loop:

```
┌─────────────────────────────────────────────────────────┐
│  AUTONOMOUS DEBUG LOOP                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  FOR EACH ITERATION (max 10):                          │
│                                                         │
│  1. 📸 Screenshot current state                        │
│                                                         │
│  2. 📋 Read console errors                             │
│     → Use list_console_messages or check devtools      │
│                                                         │
│  3. 🎯 Try the expected action                         │
│     → Parse natural language into browser actions      │
│     → Execute: navigate, click, type, wait, verify     │
│                                                         │
│  4. ✅ Did it work?                                    │
│     → YES: Exit loop with PASS                         │
│     → NO: Continue to step 5                           │
│                                                         │
│  5. 🔍 Analyze failure                                 │
│     → Identify primary error from console              │
│     → Map to known error patterns                      │
│     → Determine likely cause and file                  │
│                                                         │
│  6. 🔧 Apply fix                                       │
│     → Edit the source file                             │
│     → Use safe patterns (null checks, etc.)            │
│     → Keep fixes minimal and targeted                  │
│                                                         │
│  7. ⏳ Wait for hot reload (2s default)               │
│     → Or manually refresh if needed                    │
│                                                         │
│  8. 🔄 Return to step 1                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Exit Conditions

| Condition | Result | Action |
|-----------|--------|--------|
| Expected behavior works | ✅ PASS | Report success, list fixes |
| Max iterations reached | ❌ FAIL | Report what was tried |
| Cannot proceed (auth, server down) | ⚠️ BLOCKED | Report blocker |

## Chrome MCP Tools Used

### Navigation & Interaction
- `browser_navigate` / `navigate` - Open URLs
- `browser_click` / `click` - Click elements
- `browser_type` / `fill` - Type into inputs
- `press_key` - Keyboard presses

### Debugging
- `list_console_messages` - Read console errors
- `evaluate_script` - Run JavaScript in browser
- `take_screenshot` - Capture current state
- `take_snapshot` - DOM accessibility snapshot

### Verification
- DOM element checks
- Text content verification
- URL matching

## Error Pattern Recognition

The debug loop recognizes common errors:

| Error Type | Example | Auto-Fix |
|------------|---------|----------|
| Null reference | `Cannot read properties of undefined` | Add optional chaining |
| Network | `Failed to fetch`, `404`, `CORS` | Check server, URL |
| React | `Each child should have key` | Add key prop |
| Vue | `Property not defined` | Check data/methods |
| Import | `Cannot find module` | Check path/install |

## Example Session

**Input:**
```
/wogi-debug-browser "In my task app at localhost:3000, select a project and click Pull Tasks, expect to see a list of tasks"
```

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 BROWSER DEBUG SESSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

URL: http://localhost:3000
Expected: select a project and click Pull Tasks, expect to see a list of tasks
Max iterations: 10

📸 Iteration 1:
   → Navigating to http://localhost:3000
   → Screenshot captured
   → Clicking project dropdown
   → Selecting first project
   → Clicking 'Pull Tasks' button
   → Checking for task list...

🔴 FAIL: Task list not appearing

📋 Console Errors (1 found):
   → Uncaught TypeError: Cannot read properties of undefined (reading 'map')
     at TaskList.tsx:45

🔍 Analysis:
   - Type: null-reference
   - Confidence: high
   - Likely causes:
     • Data not loaded yet (missing loading state)
     • API response shape different than expected

💡 Suggested Fix:
   Add optional chaining to prevent null reference

🔧 Applying fix to src/components/TaskList.tsx...
   Line 45: tasks.map(...) → tasks?.map(...)

⏳ Waiting for hot reload (2s)...

📸 Iteration 2:
   → Refreshing page
   → Selecting project
   → Clicking 'Pull Tasks'
   → Checking for task list...

🟢 PASS: Task list now appearing with 5 tasks!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ DEBUG SESSION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issue: undefined.map() error in TaskList.tsx
Fix: Added optional chaining (tasks?.map)
Iterations: 2
Time: 45 seconds

Files modified:
  - src/components/TaskList.tsx

Would you like me to commit this fix?
```

## Configuration

In `.workflow/config.json`:

```json
{
  "browserDebugging": {
    "enabled": true,
    "maxIterations": 10,
    "iterationTimeout": 60000,
    "screenshotOnEachIteration": true,
    "autoRefreshAfterFix": true,
    "hotReloadWaitMs": 2000,
    "consoleErrorPatterns": true,
    "saveDebugSession": true,
    "sessionSavePath": ".workflow/debug-sessions/",
    "triggers": {
      "manual": true,
      "suggestOnBroken": true,
      "autoOnTestFailure": false
    },
    "naturalLanguage": {
      "enabled": true,
      "useAppMap": true
    }
  }
}
```

## Natural Language Support

The parser understands:

**Actions:**
- `click`, `press`, `tap`, `select` - Click elements
- `type`, `enter`, `fill` - Input text
- `navigate`, `go to`, `visit` - Open URLs
- `wait`, `pause` - Wait for elements/time
- `scroll to` - Scroll to elements
- `hover over` - Mouse hover

**Expectations:**
- `expect`, `see`, `should see` - Element visible
- `contains`, `has`, `shows` - Text content
- `not see`, `hidden` - Element not visible
- `url is`, `redirected to` - URL check

**Connectors:**
- `,` (comma)
- `then`
- `and then`

## Integration with Test Flows

Debug sessions can be saved as reusable test flows:

```
/wogi-debug-browser --save-as "login-flow" "click Login, enter credentials, expect dashboard"
```

This creates `.workflow/tests/flows/login-flow.json` for future regression testing.

## Troubleshooting

### Chrome Not Connected
```
Run: claude --chrome
Or: /chrome to check status
```

### No Console Errors But Still Failing
- Take screenshot to see visual state
- Check for non-error warnings
- Try `evaluate_script` to inspect DOM

### Hot Reload Not Working
- Increase `hotReloadWaitMs` in config
- Try manual page refresh
- Check if dev server is running

### Max Iterations Reached
- Review the session log
- Check if issue is environmental (server, auth)
- Try more specific selectors

## Related Commands

- `/wogi-test-browser <flow>` - Run predefined test flows
- `/chrome` - Check Chrome connection status
- `flow browser-debug --list` - List debug sessions
- `flow browser-patterns "error"` - Diagnose specific error
