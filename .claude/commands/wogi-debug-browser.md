WebMCP-powered browser debugging - uses structured tool calls instead of screenshots for precise, token-efficient UI investigation.

## Usage

```
/wogi-debug-browser "description of the UI issue"
/wogi-debug-browser "login form doesn't submit"
/wogi-debug-browser "dashboard shows wrong data after refresh"
```

## How It Works

1. **Load WebMCP tools** from `.workflow/webmcp/tools.json`
2. **Analyze** the issue description to plan an investigation strategy
3. **Execute** structured tool calls to navigate, inspect, and interact with the page
4. **Diagnose** the issue based on tool responses
5. **Report** findings with evidence and recommended fixes

## Prerequisites

- WebMCP tools generated: Run `flow webmcp-generate scan` first
- Chrome 146+ with WebMCP DevTrial enabled
- `navigator.modelContext` API available in the target browser

## Execution Steps

### Step 1: Load WebMCP Tools

Read `.workflow/webmcp/tools.json` and check tool availability.

**If tools are available (toolCount > 0):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 WebMCP Browser Debug
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issue: "[ARGUMENTS]"

WebMCP Tools Loaded: N tools
Framework: [react|vue|svelte|unknown]

Planning investigation strategy...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**If tools are NOT available (toolCount === 0 or file missing):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ WebMCP Not Available
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No WebMCP tools found. This could mean:

1. Tools haven't been generated yet
   → Run: flow webmcp-generate scan

2. No UI components detected in this project
   → This project may not have interactive components

3. Chrome 146+ not available
   → WebMCP requires Chrome 146+ with DevTrial flag

Alternative debugging approaches:
  • /wogi-debug-hypothesis "[issue]" - Parallel code investigation
  • /wogi-trace "[feature]" - Code flow trace
  • Manual browser DevTools inspection

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If tools are not available, STOP here. Do not proceed with WebMCP debugging.

### Step 2: Plan Investigation Strategy

Analyze the issue description (from ARGUMENTS) and the available WebMCP tools to create an investigation plan.

**Strategy generation:**

1. Parse the issue description for keywords:
   - Component names (form, button, modal, table, etc.)
   - Actions (submit, click, load, navigate, scroll)
   - States (error, empty, loading, disabled)

2. Match keywords against available WebMCP tools:
   - Find tools that target the mentioned components
   - Identify read-only tools for inspection (readOnlyHint: true)
   - Identify interaction tools for reproduction (readOnlyHint: false)

3. Create ordered investigation plan:
   ```
   Investigation Plan:
     1. [inspect] Use read_[component]_state to check current state
     2. [interact] Use [action]_[component] to reproduce the issue
     3. [inspect] Use read_[component]_state to check state after interaction
     4. [compare] Compare expected vs actual state
   ```

**Display:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Investigation Plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Relevant Tools Found: M of N total
  • read_login_form_state (inspect)
  • submit_login_form (interact)
  • update_login_form (interact)

Steps:
  1. Inspect initial component state
  2. Reproduce the reported issue
  3. Inspect post-interaction state
  4. Analyze discrepancies

Executing investigation...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 3: Execute Tool Calls

For each step in the investigation plan, describe the WebMCP tool call that would be executed.

**Tool Call Format (WebMCP standard):**

```javascript
// Read state (inspection)
navigator.modelContext.callTool({
  name: "read_login_form_state",
  arguments: {}
});
// Returns: { email: "", password: "", submitDisabled: true, errors: [] }

// Interact (reproduction)
navigator.modelContext.callTool({
  name: "update_login_form",
  arguments: { field: "email", value: "test@example.com" }
});

// Interact (trigger)
navigator.modelContext.callTool({
  name: "submit_login_form",
  arguments: {}
});

// Read state again (post-interaction)
navigator.modelContext.callTool({
  name: "read_login_form_state",
  arguments: {}
});
// Returns: { email: "test@example.com", password: "", submitDisabled: false, errors: ["Password required"] }
```

**Important**: Since WebMCP tools execute in the browser context, you are describing the tool calls to be made. The actual execution happens when the user runs these in a Chrome 146+ session with WebMCP enabled.

**For each tool call, display:**

```
  [Step 1/4] Inspecting login_form state...
  Tool: read_login_form_state
  Args: {}
  Expected response: Current form field values, validation state, error messages

  [Step 2/4] Reproducing issue: filling form partially...
  Tool: update_login_form
  Args: { field: "email", value: "test@example.com" }
  Expected response: Confirmation of field update

  [Step 3/4] Triggering submission...
  Tool: submit_login_form
  Args: {}
  Expected response: Form submission result or error

  [Step 4/4] Checking post-submit state...
  Tool: read_login_form_state
  Args: {}
  Expected response: Updated state with any errors or success indicators
```

### Step 4: Analyze and Diagnose

Based on the tool definitions and the issue description, analyze potential root causes:

1. **State Analysis**: What state transitions should happen vs what's likely broken
2. **Tool Coverage**: Are there tools covering the problematic interaction?
3. **Missing Tools**: Are there gaps in tool coverage that suggest missing functionality?
4. **Annotation Clues**: Do tool annotations (destructiveHint, idempotentHint) suggest side effects?

### Step 5: Generate Diagnosis Report

Produce a structured diagnosis report.

**Output Format:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔬 DIAGNOSIS REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issue: "[original description]"

📊 Investigation Summary:
   Tools used: N tool calls
   Components inspected: [list]
   Interactions tested: [list]

🎯 Findings:

  Finding 1: [Description]
    Evidence: [Tool response or state comparison]
    Severity: Critical | High | Medium | Low

  Finding 2: [Description]
    Evidence: [Tool response or state comparison]
    Severity: Critical | High | Medium | Low

🔍 Root Cause Analysis:
   Most likely: [description of root cause]
   Confidence: High | Medium | Low
   Evidence: [what supports this conclusion]

💡 Recommended Fixes:

  1. [Specific code change recommendation]
     File: [path/to/file]
     Why: [reasoning]

  2. [Alternative approach if applicable]

🧪 Verification:
   After fixing, verify with these WebMCP tool calls:
   1. [tool call to verify fix]
   2. [tool call to verify no regression]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 6: Offer Next Steps

```
Next steps:
  [1] Create a bug task for the findings (/wogi-bug)
  [2] Fix the issue directly (/wogi-start)
  [3] Run additional investigation with different tools
  [4] Generate a test flow to prevent regression (/wogi-test-browser)
```

Use AskUserQuestion to present these options.

## Tool Matching Heuristics

When matching issue descriptions to WebMCP tools:

| Issue Keywords | Tool Pattern | Action |
|---------------|-------------|--------|
| form, input, field | `read_*_state`, `update_*` | Inspect + interact |
| button, click, submit | `click_*`, `submit_*` | Trigger action |
| navigation, page, route | `navigate_*`, `click_*_link` | Navigate |
| modal, dialog, popup | `open_*`, `close_*`, `toggle_*` | Toggle visibility |
| table, list, data | `read_*_state` | Inspect data |
| error, validation | `read_*_state` | Check error fields |
| loading, spinner | `read_*_state` | Check loading state |

## Integration with Other Commands

| Command | Relationship |
|---------|-------------|
| `/wogi-debug-hypothesis` | Use for code-level investigation (no browser needed) |
| `/wogi-trace` | Use for understanding code flow |
| `/wogi-test-browser` | Use for automated test flows after fixing |
| `/wogi-bug` | Create bug task from diagnosis findings |

## Configuration

Controlled by `.workflow/config.json`:

```json
{
  "webmcp": {
    "toolsPath": ".workflow/webmcp/tools.json",
    "fallbackEnabled": true,
    "maxToolCalls": 20,
    "reportPath": ".workflow/debug-reports/"
  }
}
```

## Token Efficiency

WebMCP approach vs screenshot approach:
- **Screenshot**: ~1500 tokens per image + vision model processing
- **WebMCP**: ~50-200 tokens per tool call + structured JSON response
- **Savings**: ~89% token reduction for typical debug session (10 interactions)

This structured approach also provides:
- Deterministic state inspection (no OCR/vision ambiguity)
- Programmatic interaction (no coordinate-based clicking)
- Repeatable investigation steps (tool calls can be replayed)
