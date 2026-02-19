WebMCP-powered browser testing - defines test flows as structured tool call sequences with expected-vs-actual assertions. Token-efficient alternative to screenshot comparison.

## Usage

```
/wogi-test-browser                        # Run all test flows
/wogi-test-browser "login flow"           # Run specific test flow
/wogi-test-browser --generate "checkout"  # Generate test flow for a feature
/wogi-test-browser --list                 # List available test flows
```

## How It Works

1. **Load WebMCP tools** from `.workflow/webmcp/tools.json`
2. **Load test flows** from `.workflow/tests/flows/`
3. **Execute** each flow as an ordered sequence of tool calls
4. **Assert** expected state vs actual tool responses
5. **Report** pass/fail per step with structured evidence

## Prerequisites

- WebMCP tools generated: Run `flow webmcp-generate scan` first
- Chrome 146+ with WebMCP DevTrial enabled
- `navigator.modelContext` API available in the target browser

## Execution Steps

### Step 1: Load Tools and Test Flows

Read `.workflow/webmcp/tools.json` and scan `.workflow/tests/flows/` for flow definitions.

**If tools are available and flows exist:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 WebMCP Browser Tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WebMCP Tools: N tools loaded
Test Flows: M flows found
Framework: [react|vue|svelte|unknown]

Running test flows...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**If tools are NOT available:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ WebMCP Not Available
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No WebMCP tools found. To enable browser testing:

1. Generate tools: flow webmcp-generate scan
2. Ensure Chrome 146+ with DevTrial flag
3. Re-run: /wogi-test-browser

Alternative: Use unit tests or manual testing.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**If no test flows exist:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 No Test Flows Found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No test flows in .workflow/tests/flows/

To generate a test flow:
  /wogi-test-browser --generate "feature name"

This will create a test flow template based on your
WebMCP tool definitions for the specified feature.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 2: Test Flow Format

Test flows are JSON files in `.workflow/tests/flows/`:

```json
{
  "name": "Login Form Test",
  "description": "Verify login form submission and validation",
  "created": "2026-02-19T...",
  "steps": [
    {
      "id": "step-1",
      "description": "Check initial form state",
      "tool": "read_login_form_state",
      "arguments": {},
      "assertions": [
        { "path": "email", "expected": "", "operator": "equals" },
        { "path": "password", "expected": "", "operator": "equals" },
        { "path": "submitDisabled", "expected": true, "operator": "equals" }
      ]
    },
    {
      "id": "step-2",
      "description": "Fill email field",
      "tool": "update_login_form",
      "arguments": { "field": "email", "value": "user@example.com" },
      "assertions": []
    },
    {
      "id": "step-3",
      "description": "Fill password field",
      "tool": "update_login_form",
      "arguments": { "field": "password", "value": "secure123" },
      "assertions": []
    },
    {
      "id": "step-4",
      "description": "Verify form is submittable",
      "tool": "read_login_form_state",
      "arguments": {},
      "assertions": [
        { "path": "email", "expected": "user@example.com", "operator": "equals" },
        { "path": "submitDisabled", "expected": false, "operator": "equals" }
      ]
    },
    {
      "id": "step-5",
      "description": "Submit form",
      "tool": "submit_login_form",
      "arguments": {},
      "assertions": [
        { "path": "success", "expected": true, "operator": "equals" }
      ]
    }
  ]
}
```

**Assertion Operators:**

| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Strict equality | `{ "path": "count", "expected": 5 }` |
| `not_equals` | Not equal | `{ "path": "errors", "expected": [] }` |
| `contains` | String/array contains | `{ "path": "message", "expected": "success" }` |
| `not_contains` | Does not contain | `{ "path": "errors", "expected": "fatal" }` |
| `truthy` | Value is truthy | `{ "path": "isLoaded" }` |
| `falsy` | Value is falsy | `{ "path": "hasErrors" }` |
| `greater_than` | Numeric comparison | `{ "path": "items.length", "expected": 0 }` |
| `matches` | Regex match | `{ "path": "email", "expected": "^.+@.+$" }` |

### Step 3: Execute Test Flows

For each test flow, execute steps sequentially:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 Running: Login Form Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [1/5] Check initial form state
        Tool: read_login_form_state
        Assertions:
          ✓ email equals ""
          ✓ password equals ""
          ✓ submitDisabled equals true
        Result: PASS

  [2/5] Fill email field
        Tool: update_login_form({ field: "email", value: "user@example.com" })
        Result: PASS (no assertions)

  [3/5] Fill password field
        Tool: update_login_form({ field: "password", value: "secure123" })
        Result: PASS (no assertions)

  [4/5] Verify form is submittable
        Tool: read_login_form_state
        Assertions:
          ✓ email equals "user@example.com"
          ✗ submitDisabled equals false
            Expected: false
            Actual: true
            Reason: Form still shows submit disabled after filling fields
        Result: FAIL

  [5/5] Submit form (SKIPPED - previous step failed)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Execution Rules:**
- Steps run sequentially (order matters for stateful interactions)
- If a step fails and has `"stopOnFail": true` (default), remaining steps are SKIPPED
- If `"stopOnFail": false`, execution continues and collects all failures
- Tool call responses are captured for the assertion engine

### Step 4: Assertion Engine

For each assertion in a step:

1. Parse the tool response JSON
2. Navigate to the `path` using dot notation (e.g., `"items.0.name"`)
3. Apply the `operator` comparing actual vs expected
4. Record pass/fail with evidence

**Path Resolution:**
```javascript
// Response: { user: { profile: { name: "Alice" } } }
// Path: "user.profile.name"
// Resolved: "Alice"

// Response: { items: [{ id: 1 }, { id: 2 }] }
// Path: "items.0.id"
// Resolved: 1

// Path: "items.length"
// Resolved: 2
```

### Step 5: Generate Test Report

After all flows complete, produce a structured report.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 TEST REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Summary:
  Flows: 3 total | 2 passed | 1 failed
  Steps: 15 total | 13 passed | 1 failed | 1 skipped
  Assertions: 22 total | 20 passed | 2 failed

Results by Flow:

  ✓ Login Form Test (5/5 steps passed)
  ✓ Navigation Test (4/4 steps passed)
  ✗ Checkout Flow Test (4/6 steps, 1 failed, 1 skipped)

Failed Assertions:

  ✗ Checkout Flow Test > Step 4: Verify cart total
    Tool: read_cart_state
    Path: total
    Expected: 29.99
    Actual: 0
    Suggestion: Cart total not updating after add-to-cart.
                Check if state management dispatches correctly.

  ✗ Checkout Flow Test > Step 5: Submit order (SKIPPED)
    Reason: Previous step failed (stopOnFail: true)

Suggested Fixes:
  1. Investigate cart state management (read_cart_state returns total: 0)
  2. Check if add_to_cart tool triggers state update

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 6: Generate Test Flow (--generate mode)

When invoked with `--generate "feature name"`:

1. Read WebMCP tools from tools.json
2. Match tools related to the feature name
3. Generate a test flow template with:
   - Read-only tools for initial state inspection
   - Interaction tools for the happy path
   - Read-only tools for post-interaction assertions
4. Save to `.workflow/tests/flows/[feature-name]-test.json`

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Generated Test Flow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Feature: "checkout"
Matched Tools: 4 (read_cart_state, add_to_cart, remove_from_cart, submit_order)

Generated: .workflow/tests/flows/checkout-test.json
Steps: 6

Please review and adjust assertions before running.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Options

| Flag | Description |
|------|-------------|
| `--generate "name"` | Generate test flow template for a feature |
| `--list` | List all available test flows |
| `--verbose` | Show full tool responses in output |
| `--no-stop-on-fail` | Continue execution even after failures |
| `--report-json` | Output report as JSON to stdout |

## Integration with Other Commands

| Command | Relationship |
|---------|-------------|
| `/wogi-debug-browser` | Debug issues found by test failures |
| `/wogi-start` | Auto-suggest test runs after UI task completion |
| `flow webmcp-generate scan` | Regenerate tools after component changes |

## Configuration

Controlled by `.workflow/config.json`:

```json
{
  "webmcp": {
    "enabled": true,
    "toolsPath": ".workflow/webmcp/tools.json",
    "fallbackEnabled": true,
    "maxToolCalls": 20
  }
}
```

## Token Efficiency

- **Screenshot comparison**: ~3000 tokens per screenshot pair + vision processing
- **WebMCP assertions**: ~100 tokens per step (tool call + JSON assertion)
- **Savings**: ~95% token reduction for a 10-step test flow
- **Bonus**: Deterministic results (no visual diff ambiguity)
