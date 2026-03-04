# Browser Debugging and Testing

WebMCP-powered browser debugging and test flows using structured tool calls.

---

## Purpose

WogiFlow provides two commands for browser-based work:
- `/wogi-debug-browser` -- Investigate UI issues through structured tool calls
- `/wogi-test-browser` -- Define and run test flows with expected-vs-actual assertions

Both use the WebMCP standard (Chrome 146+ `navigator.modelContext` API) instead of screenshots, providing deterministic state inspection at a fraction of the token cost.

---

## Prerequisites

1. WebMCP tools generated: Run `flow webmcp-generate scan`
2. Chrome 146+ with WebMCP DevTrial enabled
3. `navigator.modelContext` API available in the target browser

---

## Configuration

```json
{
  "webmcp": {
    "enabled": true,
    "toolsPath": ".workflow/webmcp/tools.json",
    "fallbackEnabled": true,
    "maxToolCalls": 20,
    "reportPath": ".workflow/debug-reports/"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable WebMCP features |
| `toolsPath` | `".workflow/webmcp/tools.json"` | Location of generated tool definitions |
| `fallbackEnabled` | `true` | Allow fallback to non-WebMCP debugging |
| `maxToolCalls` | `20` | Maximum tool calls per debug session |
| `reportPath` | `".workflow/debug-reports/"` | Where diagnosis reports are saved |

---

## Browser Debugging (`/wogi-debug-browser`)

### Usage

```bash
/wogi-debug-browser "login form doesn't submit"
/wogi-debug-browser "dashboard shows wrong data after refresh"
```

### How It Works

1. **Load tools** from `.workflow/webmcp/tools.json`
2. **Plan investigation** -- Match issue keywords to available tools
3. **Execute tool calls** -- Navigate, inspect, and interact with the page
4. **Diagnose** -- Analyze state transitions and tool responses
5. **Report** -- Produce a structured diagnosis with findings, root cause, and fixes

### Tool Matching

The command maps issue keywords to WebMCP tool patterns:

| Issue Keywords | Tool Pattern | Action |
|---------------|-------------|--------|
| form, input, field | `read_*_state`, `update_*` | Inspect + interact |
| button, click, submit | `click_*`, `submit_*` | Trigger action |
| navigation, page, route | `navigate_*`, `click_*_link` | Navigate |
| modal, dialog, popup | `open_*`, `close_*`, `toggle_*` | Toggle visibility |
| table, list, data | `read_*_state` | Inspect data |
| error, validation | `read_*_state` | Check error fields |

### Diagnosis Report

The output includes:
- Investigation summary (tools used, components inspected)
- Findings with severity ratings
- Root cause analysis with confidence level
- Recommended code fixes with file paths
- Verification steps using WebMCP tool calls

### Fallback

If WebMCP tools are not available, the command suggests alternatives:
- `/wogi-debug-hypothesis` for code-level investigation
- `/wogi-trace` for code flow analysis
- Manual browser DevTools inspection

---

## Browser Testing (`/wogi-test-browser`)

### Usage

```bash
/wogi-test-browser                        # Run all test flows
/wogi-test-browser "login flow"           # Run a specific test flow
/wogi-test-browser --generate "checkout"  # Generate test flow for a feature
/wogi-test-browser --list                 # List available test flows
```

### Test Flow Format

Test flows are JSON files in `.workflow/tests/flows/`:

```json
{
  "name": "Login Form Test",
  "description": "Verify login form submission and validation",
  "steps": [
    {
      "id": "step-1",
      "description": "Check initial form state",
      "tool": "read_login_form_state",
      "arguments": {},
      "assertions": [
        { "path": "email", "expected": "", "operator": "equals" },
        { "path": "submitDisabled", "expected": true, "operator": "equals" }
      ]
    },
    {
      "id": "step-2",
      "description": "Fill email field",
      "tool": "update_login_form",
      "arguments": { "field": "email", "value": "user@example.com" },
      "assertions": []
    }
  ]
}
```

### Assertion Operators

| Operator | Description |
|----------|-------------|
| `equals` | Strict equality |
| `not_equals` | Not equal |
| `contains` | String/array contains value |
| `not_contains` | Does not contain |
| `truthy` | Value is truthy |
| `falsy` | Value is falsy |
| `greater_than` | Numeric comparison |
| `matches` | Regex match |

### Execution Rules

- Steps run sequentially (order matters for stateful UI)
- If a step fails with `stopOnFail: true` (default), remaining steps are skipped
- Set `stopOnFail: false` to collect all failures in one run

### Test Report

After all flows complete:

```
Summary:
  Flows: 3 total | 2 passed | 1 failed
  Steps: 15 total | 13 passed | 1 failed | 1 skipped
  Assertions: 22 total | 20 passed | 2 failed

Failed Assertions:
  Checkout Flow > Step 4: Verify cart total
    Expected: 29.99
    Actual: 0
```

### Generating Test Flows

Use `--generate` to create a template from existing WebMCP tools:

```bash
/wogi-test-browser --generate "checkout"
```

This matches tools related to the feature, creates a happy-path flow with state inspections, and saves to `.workflow/tests/flows/checkout-test.json`.

---

## Token Efficiency

| Approach | Tokens per Interaction | 10-Step Session |
|----------|----------------------|-----------------|
| Screenshot-based | ~1500 (image + vision) | ~15,000 |
| WebMCP tool calls | ~50-200 (JSON) | ~750-2,000 |

Additional benefits: deterministic results (no OCR ambiguity), programmatic interaction (no coordinate clicking), and repeatable steps (tool calls can be replayed).

---

## Best Practices

1. **Generate tools first** -- Always run `flow webmcp-generate scan` before debugging
2. **Regenerate after UI changes** -- New components need new tool definitions
3. **Review generated tests** -- Auto-generated flows are templates; adjust assertions before relying on them
4. **Combine with code debugging** -- Use `/wogi-debug-browser` for UI state, `/wogi-debug-hypothesis` for logic
5. **Keep flows small** -- One flow per feature keeps failures easy to diagnose

---

## Related

- [Code Traces](./code-traces.md) - Understanding code flow
- [MCP Integrations](./mcp-integrations.md) - Other MCP tool integrations
- [Guided Edit](./guided-edit.md) - AI-assisted code editing
