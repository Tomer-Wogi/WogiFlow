---
description: "Run auto-tests: UI verification, API testing, data integrity checks"
---
Run the WogiFlow Auto-Testing Suite — UI verification, API testing, data integrity checks, and generated test execution.

**Triggers**: `/wogi-test`, "run tests", "verify tests", "test this task"

## Usage

```bash
/wogi-test                          # Run all tests for current/recent task
/wogi-test wf-XXXXXXXX             # Run tests for specific task
/wogi-test --all                    # Run full test suite
/wogi-test --ui                     # UI tests only
/wogi-test --api                    # API tests only
/wogi-test --integrity              # Data integrity chain only
/wogi-test --setup                  # Configure testing (re-run detection + probe profile)
/wogi-test --profile                # Display current verification profile
/wogi-test --generate wf-XXXXXXXX  # Regenerate tests for a task
```

## Command Flow

### Step 1: Parse Arguments

Parse `$ARGUMENTS` to extract:
- **Task ID**: A `wf-XXXXXXXX` pattern → target task
- **Flags**: `--ui`, `--api`, `--integrity`, `--all`, `--setup`, `--profile`, `--generate`
- **No args**: Use current in-progress task from `ready.json`

```javascript
// Pseudo-logic for argument parsing
const args = '$ARGUMENTS'.trim().split(/\s+/);
let taskId = null;
let flags = { ui: false, api: false, integrity: false, all: false, setup: false, profile: false, generate: false };

for (const arg of args) {
  if (/^wf-[a-f0-9]{8}$/i.test(arg)) {
    taskId = arg;
  } else if (arg === '--ui') flags.ui = true;
  else if (arg === '--api') flags.api = true;
  else if (arg === '--integrity') flags.integrity = true;
  else if (arg === '--all') flags.all = true;
  else if (arg === '--setup') flags.setup = true;
  else if (arg === '--profile') flags.profile = true;
  else if (arg === '--generate') flags.generate = true;
}
```

If no task ID provided, read `.workflow/state/ready.json` and use the first task in `inProgress`. If none in progress, use the most recent task in `recentlyCompleted`.

### Step 2: Check Testing Configuration (Auto-Setup on First Use)

Read config via:
```bash
node -e "const { getConfig } = require('./scripts/flow-utils'); const c = getConfig(); console.log(JSON.stringify(c.testing || {}))"
```

If `config.testing.enabled` is `false` (or not set), **auto-trigger the setup flow** — do NOT just show info and stop. The user ran `/wogi-test` because they want to test. Guide them through setup seamlessly:

**Step 2a: Detect project type**
```bash
node -e "const { detectProjectType } = require('./scripts/flow-project-analyzer'); const r = detectProjectType(); console.log(JSON.stringify(r))"
```

**Step 2b: Show detection results and ask ONE question**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  First-Time Testing Setup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I scanned your project and detected:

  Project type: [fullstack / frontend / backend / library]
  UI framework: [React / Vue / etc. or "none"]
  API framework: [Express / NestJS / etc. or "none"]
  Test framework: [vitest / jest / etc. or "none detected"]

Based on this, I recommend:
  Testing mode: [full / ui / api / unit]
  [If UI] Packages needed: @playwright/mcp + Chromium browser
  [If API only] No extra packages needed

Shall I enable testing and install what's needed? [Y/n/customize]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Step 2c: Based on user response:**

- **Yes (or enter)** → Proceed to auto-configure:
  1. Determine mode from detection: hasUI+hasAPI → `"full"`, hasUI only → `"ui"`, hasAPI only → `"api"`, neither → `"unit"`
  2. Update `.workflow/config.json`: set `testing.enabled: true`, `testing.mode`, and `testing.detected` fields
  3. Check dependencies: `node -e "const d = require('./scripts/flow-testing-deps'); console.log(JSON.stringify(d.checkDeps('[mode]')))"`
  4. If deps missing → install them: `node -e "const d = require('./scripts/flow-testing-deps'); console.log(JSON.stringify(d.installDeps('[mode]')))"`
  5. If UI mode → also configure Playwright MCP in settings (show user the MCP config to add)
  6. Generate verification profile: `node -e "const { probeProject } = require('./scripts/flow-verification-profile'); probeProject().then(() => console.log('Profile generated')).catch(err => console.error(err.message))"`
  7. Show confirmation and **continue to Step 5 (run tests)**

- **Customize** → Ask for:
  - Preferred mode (ui/api/full/unit)
  - Base URLs (UI: default localhost:3000, API: default localhost:3001)
  - Start commands (optional)
  - Then configure and install accordingly

- **No** → Skip setup, show how to enable later:
  ```
  OK — testing stays disabled. To enable later:
    /wogi-test --setup
  ```

**IMPORTANT**: After successful setup, do NOT stop. Continue directly to Step 5 and run the tests the user originally asked for. The whole point is that `/wogi-test` works in one invocation even on first use.

### Step 2.5: Handle `--profile` Flag (Display Verification Profile)

If `--profile` was passed, display the current verification profile and **STOP**:

```bash
node -e "
const { loadProfile } = require('./scripts/flow-verification-profile');
const profile = loadProfile();
if (!profile) {
  console.log('No verification profile found. Run: /wogi-test --setup');
} else {
  console.log(JSON.stringify(profile, null, 2));
}
"
```

Format the output as a readable summary showing detected capabilities (test runner, E2E, API, Docker, database, CI, etc.) and the recommended verification strategy per task type.

### Step 3: Handle `--setup` Flag (Reconfigure)

If `--setup` was passed, this is an explicit reconfiguration request. Use the same flow as Step 2 (auto-setup), but ALWAYS run it even if testing is already enabled. This lets users:
- Change testing mode (e.g., switch from `ui` to `full`)
- Re-detect after adding backend/frontend to their project
- Install missing deps after a fresh `npm install` that lost node_modules

After reconfiguration, also regenerate the verification profile:
```bash
node -e "
const { probeProject } = require('./scripts/flow-verification-profile');
probeProject().then(p => console.log(JSON.stringify({ success: true, detected: {
  testRunner: p.testRunner.framework || 'none',
  e2e: p.e2e.framework || 'none',
  api: p.api.detected,
  docker: p.docker.available,
  database: p.database.type || 'none',
  ci: p.ci.platform || 'none'
}}))).catch(err => console.error(JSON.stringify({ error: err.message })));
"
```

Show confirmation:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Testing Reconfigured ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mode: [mode] (was: [old mode])
UI provider: playwright-mcp
API provider: direct-http (zero deps)
Dependencies: all installed ✓
Verification profile: regenerated ✓

Run /wogi-test to execute tests.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 4: Handle `--generate` Flag

If `--generate` was passed:

```bash
node -e "
const { generateTestScaffold } = require('./scripts/flow-test-generate');
const result = generateTestScaffold('TASK_ID');
console.log(JSON.stringify(result, null, 2));
"
```

Display generated test info and **STOP** — do not run tests, just generate.

### Step 5: Run Tests (Main Flow)

Determine which test types to run:

| Flag | Action |
|------|--------|
| `--ui` | Run UI tests only |
| `--api` | Run API tests only |
| `--integrity` | Run integrity tests only |
| `--all` | Run all 3 types |
| No flag | Run based on `config.testing.mode`: `ui`→UI only, `api`→API only, `full`→all 3, `auto`→detect and run applicable |

#### Run UI Tests
```bash
node -e "
const { runUITests } = require('./scripts/flow-test-ui');
runUITests('TASK_ID').then(r => console.log(JSON.stringify(r))).catch(err => console.error(JSON.stringify({error: err.message})));
"
```

#### Run API Tests
```bash
node -e "
const { runAPITests } = require('./scripts/flow-test-api');
runAPITests('TASK_ID').then(r => console.log(JSON.stringify(r))).catch(err => console.error(JSON.stringify({error: err.message})));
"
```

#### Run Integrity Tests
```bash
node -e "
const { runIntegrityTests } = require('./scripts/flow-test-integrity');
runIntegrityTests('TASK_ID').then(r => console.log(JSON.stringify(r))).catch(err => console.error(JSON.stringify({error: err.message})));
"
```

### Step 6: Display Results

After all tests complete, display a unified summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test Results — wf-XXXXXXXX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UI Tests:     [passed]/[total] passed ([failed] failed)
API Tests:    [passed]/[total] passed
Integrity:    [matched]/[total] matched ([missing] missing fields)

Failed:
  ✗ [type]: [description of failure]
  ✗ [type]: [description of failure]

Reports: .workflow/verifications/wf-XXXXXXXX-*.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If ALL tests pass:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test Results — wf-XXXXXXXX ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UI Tests:     [total]/[total] passed
API Tests:    [total]/[total] passed
Integrity:    [total]/[total] matched

All tests passed!

Reports: .workflow/verifications/wf-XXXXXXXX-*.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 7: Run Generated Tests (if applicable)

If `config.testing.generation.autoGenerate` is true and generated tests exist for the task:

```bash
# Check if generated test directory exists
ls .workflow/tests/generated/TASK_ID/ 2>/dev/null
```

If tests exist, run them with the project's test runner:
```bash
npm test -- .workflow/tests/generated/TASK_ID/
```

Include results in the summary:
```
Generated Tests: [passed]/[total] passed
```

## Important Notes

- Testing is **disabled by default** — zero overhead for projects that don't use it
- All test scripts gracefully handle missing dependencies and report what's needed
- Reports are saved to `.workflow/verifications/` for quality gate consumption
- The quality gates `generatedTestsPass`, `uiVerification`, and `apiVerification` in `flow-done.js` will automatically run these same tests when closing a task via `/wogi-start`
- **Verification Profile**: The `--setup` flag (and first-time auto-setup) generates a verification profile at `.workflow/state/verification-profile.json`. This profile auto-detects test runners, E2E frameworks, OpenAPI specs, Docker, databases, CI config, and more. Test scripts (`flow-test-api.js`, `flow-test-ui.js`, `flow-test-integrity.js`) read from this profile to provide smart defaults (base URLs, start commands, spec files) instead of using hardcoded values. Explicit `config.json` overrides always take precedence over profile-detected values.
- Use `--profile` to display the current verification profile without running tests
