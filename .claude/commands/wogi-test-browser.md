Execute browser tests using Claude's Chrome integration.

## Usage

- `/wogi-test-browser [flow-name]` - Run specific flow
- `/wogi-test-browser all` - Run all flows
- `/wogi-test-browser --list` - List available flows
- `/wogi-test-browser --check` - Check Chrome connection status
- `/wogi-test-browser --debug [flow-name]` - Run flow with auto-fix on failure

## Prerequisites

**Before running browser tests, ensure:**

1. **Chrome integration is active**
   - Start Claude Code with: `claude --chrome`
   - Or enable via `/chrome` command in an existing session

2. **Claude in Chrome extension is installed**
   - Version 1.0.36 or higher required
   - Install from: https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn

3. **Test flows exist**
   - Located in `.workflow/tests/flows/*.json`
   - Use template: `templates/browser-test-flow.json`

## How It Works

Test flows are JSON files that define a sequence of browser actions:

```json
{
  "name": "login-flow",
  "description": "Test the login process",
  "baseUrl": "http://localhost:3000",
  "steps": [
    { "action": "navigate", "url": "/login" },
    { "action": "wait", "selector": ".login-form" },
    { "action": "type", "selector": "#email", "value": "test@example.com" },
    { "action": "type", "selector": "#password", "value": "password123" },
    { "action": "click", "selector": "button[type=submit]" },
    { "action": "verify", "selector": ".dashboard", "exists": true },
    { "action": "screenshot", "name": "login-success" }
  ]
}
```

## Step Types

| Action | Description | Parameters |
|--------|-------------|------------|
| **navigate** | Open a URL | `url` - path or full URL |
| **wait** | Wait for element | `selector`, `timeout` (optional) |
| **type** | Enter text | `selector`, `value` |
| **click** | Click element | `selector` |
| **verify** | Check element | `selector`, `exists` or `contains` |
| **screenshot** | Capture screen | `name` |

## Execution

When you run a test flow:

1. **Check Chrome connection** - Verify Chrome integration is active
2. **Load the flow** - Parse the JSON test definition
3. **Execute each step** using Chrome MCP tools:
   - `navigate` → Opens the URL in browser
   - `click` → Clicks the specified element
   - `type` → Types text into input fields
   - `wait` → Polls for selector to appear
   - `verify` → Reads DOM to check conditions
   - `screenshot` → Captures current state
4. **Report results** - Show pass/fail for each step

## Output Examples

**Successful run:**
```
🧪 Running: login-flow

1. ✓ Navigate to /login
2. ✓ Wait for .login-form
3. ✓ Type email: test@example.com
4. ✓ Type password: ********
5. ✓ Click submit button
6. ✓ Verify .dashboard exists
7. ✓ Screenshot: login-success

Result: PASS ✓

All 7 steps completed successfully.
```

**Failed run:**
```
🧪 Running: login-flow

1. ✓ Navigate to /login
2. ✓ Wait for .login-form
3. ✓ Type email: test@example.com
4. ✓ Type password: ********
5. ✓ Click submit button
6. ✗ Verify .dashboard exists
   Expected: Element to exist
   Actual: Element not found after 5s timeout

Result: FAIL ✗

Screenshot saved: login-flow-failure.png
```

## When Chrome Is Not Connected

If Chrome integration isn't active, you'll see:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Chrome Integration Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Browser testing requires Claude Code's Chrome integration.

To enable:
1. Install the Claude in Chrome extension
2. Start Claude Code with: claude --chrome
3. Run /chrome to verify connection

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Creating Test Flows

1. Create a JSON file in `.workflow/tests/flows/`
2. Define steps that test a user journey
3. Include meaningful descriptions
4. Add verification steps to confirm expected behavior
5. End with a screenshot to document the final state

## Configuration

Browser testing settings in `.workflow/config.json`:

```json
{
  "browserTesting": {
    "enabled": true,
    "runOnTaskComplete": true,
    "runForUITasks": true,
    "autoRun": false,
    "timeout": 30000,
    "screenshotOnFailure": true,
    "baseUrl": "http://localhost:3000"
  }
}
```

## Auto-Suggestion

When `runOnTaskComplete` is enabled and you complete a task that modified UI files, WogiFlow will suggest running relevant browser tests to verify your changes work correctly.

## Debug Mode

Use `--debug` flag to enable autonomous debugging when a test fails:

```
/wogi-test-browser --debug login-flow
```

When debug mode is enabled:
1. Run the test flow normally
2. If any step fails, automatically enter debug loop
3. Read console errors, analyze the failure
4. Attempt to fix the code
5. Re-run the flow to verify the fix
6. Repeat until passing or max iterations reached

This combines the structured test flow with the autonomous debugging capabilities of `/wogi-debug-browser`.

## Related

- `flow browser-exec <flow>` - CLI command for generating execution plans
- `flow browser-suggest <task-id>` - Suggest tests for a specific task
- `/wogi-debug-browser "description"` - Autonomous debugging from natural language
- `/chrome` - Check Chrome integration status
