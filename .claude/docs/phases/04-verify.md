# Phase: Verification (Steps 3.55–3.9)

Instructions for the verification phase. Loaded on-demand when phase transitions to `validating`.

## Step 3.55: Inventory-Based Verification (for "remove/fix/replace all X" tasks)

**Activates when**: The task involves removing, cleaning up, fixing, or replacing ALL instances of something (e.g., "remove all mock data", "fix all console.log", "replace all hardcoded URLs", "remove all deprecated APIs").

**The problem this solves**: Pattern-based search (grep, regex) only finds instances that match a naming convention. Semantic variants — inline hardcoded arrays, helper functions that wrap the target, useState initializers with fake data, constants not named with the expected prefix — are invisible to pattern search. In practice, pattern search finds ~60-70% of instances. The AI then declares "done" and the remaining 30-40% persist undetected. This has caused repeated false completions (3-4x on a single project).

**Core principle**: For each file in scope, ask **"does anything in this file serve the PURPOSE of [what we're removing]?"** — regardless of what it's named. Reason about function, not strings.

**Procedure (3 phases — ALL mandatory)**:

### Phase A: Pre-Implementation Inventory (BEFORE any code changes)

1. **Identify all files in scope** — every file that could contain instances of [X]. Use both:
   - Pattern search (grep/glob) for syntactic matches
   - File-by-file reading of components/pages/modules that CONSUME data related to [X]

2. **For each file, answer the semantic question**: "Does anything in this file serve the purpose of [what we're removing]?" Examples by task type:

   | Task Type | Semantic Question | What Pattern Search Misses |
   |-----------|-------------------|---------------------------|
   | Remove mock data | "Where does this component get its displayed data? Is it from an API call or a local constant/array/useState?" | Inline arrays (`const customers = [{...}]`), useState initializers (`useState([...POLICY_DATA])`), export constants not named `MOCK_*` |
   | Remove console.log | "What in this file produces output to any channel?" | `console.warn`, `console.debug`, `debugger`, `alert()`, custom logger wrappers |
   | Replace hardcoded URLs | "What string values in this file resolve to network addresses?" | URLs built from concatenation, template literals, env var fallbacks with hardcoded defaults |
   | Remove deprecated API | "What in this file provides the same FUNCTIONALITY as the deprecated API?" | Wrapper functions, polyfills, compatibility shims, re-implementations |
   | Fix all raw JSON.parse | "What in this file deserializes JSON?" | Utility functions that call JSON.parse internally, library wrappers |

3. **Trace data-providing imports one level (MANDATORY)**:

   The semantic scan in step 2 catches inline instances but gives a free pass to imported values. Imported constants, configurations, and helpers can contain the exact thing you're looking for — hidden behind one level of indirection and a legitimate-sounding name (`DEFAULT_*`, `INITIAL_*`, `FALLBACK_*`, `BASE_*`).

   **For every import statement in each scoped file**, classify it:

   | Import Type | Example | Action |
   |-------------|---------|--------|
   | **Data-providing** | `import { RATE_OPTIONS } from './constants'` | MUST read the source file and apply the semantic question to its contents |
   | **Utility/function** | `import { formatDate } from './utils'` | Skip — unless the function wraps or returns the target pattern |
   | **Type/interface** | `import type { Customer } from './types'` | Skip — types don't contain runtime data |
   | **Style/asset** | `import styles from './styles.module.css'` | Skip |
   | **Component** | `import { Button } from './ui'` | Skip — unless it's a wrapper that embeds the target pattern |

   **How to classify**: If the import provides a value that gets **rendered, displayed, logged, passed to an API, or used as configuration** — it's data-providing. Read its source.

   **Anti-pattern — naming convention bias**: Constants named `DEFAULT_*`, `INITIAL_*`, `FALLBACK_*`, `CONFIG_*`, `BASE_*` look legitimate but are often hardcoded placeholders. The name is NOT evidence of legitimacy. Only the source is.

   **Rule**: Any imported value that contributes to **user-visible output** and resolves to a hardcoded literal (not an API call, env var, or database query) is an instance of [X] — regardless of what it's named or which directory it lives in.

4. **Produce a numbered inventory** and display it to the user:
   ```
   ━━━ PRE-IMPLEMENTATION INVENTORY ━━━
   Found N instances of [X] across M files:

     1. [file:lines] — [description] [TYPE: syntactic|semantic|import-traced]
     2. [file:lines] — [description] [TYPE: syntactic|semantic|import-traced]
     ...

   Total: N instances (S syntactic, M semantic)
   Confirm inventory is complete before proceeding? [Y/adjust]
   ```

5. **Wait for user confirmation** that the inventory is complete. If the user identifies missing items, add them. This step is CRITICAL — it commits the AI to a concrete scope that can be verified later.

### Phase B: Implementation

6. Implement the removal/fix/replacement for EVERY item in the inventory. Each inventory item becomes a trackable unit of work.

### Phase C: Post-Implementation Re-Inventory (AFTER all changes)

7. **Re-run the SAME semantic scan** from Phase A (including import tracing from step 3) on the SAME set of files. Do NOT downgrade to pattern-only search.

8. **Diff the inventories**:
   ```
   ━━━ POST-IMPLEMENTATION VERIFICATION ━━━
   Re-scanned M files for [X]:

     1. [file:lines] — [description]          → REMOVED ✓
     2. [file:lines] — [description]          → REMOVED ✓
     3. [file:lines] — [description]          → STILL PRESENT ✗
     ...

   Result: N/N removed (0 remaining)
   ```

9. **If ANY items remain** → task is NOT done. Fix the remaining items and re-verify. Do NOT proceed to quality gates with remaining items.

10. **If new instances are discovered** during re-scan (including via import tracing) that weren't in the original inventory → add them, fix them, and note them as "discovered during verification."

**Why this works**: The inventory creates a concrete, numbered checklist BEFORE implementation. The AI cannot claim "done" when the post-inventory shows items still present — the evidence is in the conversation. The pre/post diff is unfakeable.

**Skip conditions**: Tasks that target a specific file or a small known set (e.g., "remove the mock import in Dashboard.tsx") don't need the full inventory — they're scoped enough already. The inventory is for "all X" / "every X" / "clean up X everywhere" tasks.

## Step 3.56: Skeptical Evaluator Gate (L2+ tasks, when `config.skepticalEvaluator.enabled`)

**The problem this solves**: The same agent that wrote the code verifies its own work in Step 3.5. Anthropic's harness design research found that "separating the agent doing the work from the agent judging it proves to be a strong lever" and that "tuning standalone evaluators toward skepticism is far more tractable than making a generator critical of its own work." This is "confident praise bias" — the implementer always thinks it did a good job.

**Activates when**: `config.skepticalEvaluator.enabled` (default: true) AND task level is L2 or higher (not L3 trivial tasks).

**Procedure**:

1. **Spawn a skeptical evaluator sub-agent** (separate from the implementation agent):
   ```
   Agent({
     subagent_type: "code-reviewer",
     model: "sonnet",  // Use a different model for diversity
     prompt: <see below>
   })
   ```

2. **Evaluator prompt** (tuned toward skepticism):
   ```
   You are a SKEPTICAL code evaluator. Your job is to find problems, not praise.
   Assume the implementation has gaps until proven otherwise.

   ## Task Specification
   <read and paste the spec from .workflow/specs/wf-XXXXXXXX.md>

   ## Implementation Diff
   <git diff of all changed files>

   ## Your Job

   For EACH acceptance criterion in the spec:
   1. Read the criterion carefully
   2. Find the EXACT code that implements it (cite file:line)
   3. Grade: PASS (fully works), PARTIAL (code exists but incomplete), FAIL (not implemented)
   4. If PARTIAL or FAIL: explain exactly what's missing

   IMPORTANT: "Code exists" is NOT the same as "criterion is met."
   A service that exists but is never called = FAIL.
   A component that renders but doesn't handle the specified edge case = PARTIAL.
   Only grade PASS when the criterion is FULLY satisfied end-to-end.

   ## Output Format
   Return JSON:
   {
     "criteria": [
       { "criterion": "...", "grade": "PASS|PARTIAL|FAIL", "evidence": "file:line", "issue": "..." }
     ],
     "overallPass": true/false,
     "criticalIssues": ["..."]
   }
   ```

3. **Process evaluator results**:
   - If `overallPass: true` → proceed to Step 3.6
   - If `overallPass: false` → **iteration loop** (see below)

4. **Generator-Evaluator Iteration Loop** (when evaluator finds issues):
   - Feed the evaluator's `criticalIssues` and failed criteria back to the implementation context
   - Fix the identified issues (targeted fixes, not re-implementation)
   - Re-run the evaluator on the updated diff
   - **Max iterations**: `config.skepticalEvaluator.maxIterations` (default: 3)
   - If still failing after max iterations → proceed to Step 3.6 anyway but **flag the unresolved issues** in the completion report

5. **Calibration** (when `config.skepticalEvaluator.calibration` is true):
   - Before spawning the evaluator, check `.workflow/state/eval-calibration.json` for calibration examples
   - If examples exist, inject 2-3 into the evaluator prompt as few-shot examples:
     - One high-scoring example (what a PASS looks like)
     - One low-scoring example (what a FAIL looks like)
   - This prevents score drift — the evaluator is anchored to concrete examples

**Configuration**:
```json
{
  "skepticalEvaluator": {
    "enabled": true,
    "maxIterations": 3,
    "model": "sonnet",
    "calibration": true,
    "skipForL3": true
  }
}
```

**Why this works**: The evaluator has NO emotional investment in the code. It reads the spec and the diff cold. It's explicitly prompted to be skeptical. And because it's a separate sub-agent, it has a fresh context — no accumulated "I already know this works" bias from the implementation phase.

## Step 3.58: Runtime Verification Gate — Auto-Test Generation (MANDATORY)

**Activates when**: ANY code file is changed. This is the DEFAULT — not optional.

Run detection: `node node_modules/wogiflow/scripts/flow-runtime-verification.js task-type [changed-files...]`

This returns the task type: `frontend`, `backend`, `fullstack`, or `other`. For `frontend` and `fullstack`, UI browser tests are generated. For `backend` and `fullstack`, API integration tests are generated. For `other`, standard static verification applies.

**The problem this solves**: AI workers mark tasks as "done" based on static evidence (TypeScript compiles, build succeeds) without verifying the feature actually works end-to-end. This leads to repeated failed iterations. Auto-generated tests catch these failures BEFORE the user does.

**DEFAULT BEHAVIOR**: For every task, WogiFlow auto-generates and runs verification tests as part of the execution loop. Tests are written to `tests/verification/` and persist as regression guards. This is ON by default — disable with `config.runtimeVerification.enabled: false`.

### Auto-Test Generation Flow

```
For EACH acceptance criterion in the spec:
  1. Classify: Is this a UI behavior, API behavior, or internal logic?
  2. Generate: Write a test that exercises the criterion
  3. Implement: Write the actual code
  4. Run: Execute the test — it MUST pass
  5. If FAIL → debug, fix, re-run (max 5 retries)
  6. Persist: Test file stays in tests/verification/ as regression guard
```

**This is NOT TDD** (where tests come first and must fail initially). This is **post-implementation verification** — the test is generated from the criterion, the code is written, then the test validates the code works. The key difference: TDD tests are written before code; verification tests are written alongside code and run after.

---

### FRONTEND: Browser Test Generation (Playwright + WebMCP)

**Activates when**: Changed files match `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.css`, `*.styled.*`

**The problem this solves**: AI workers mark UI tasks as "done" based on static evidence without ever opening a browser. (See: Pipeline Rules case study — 5 failed iterations, same bug.)

**BANNED verification methods** — these NEVER count as evidence for UI tasks:

| Banned Method | What it proves | Why it's insufficient |
|---|---|---|
| `grep` deployed bundle for function names | Code included in build | Function may never execute or render wrong |
| `tsc --noEmit` passes | Types are correct | Type-correct code can have wrong runtime behavior |
| `vite build` succeeds | Modules resolve | Build success says nothing about UX |
| "I read the code and it's logically correct" | Nothing | Author is worst possible judge of own work |
| `aws s3 sync` completes | Files hosted | Hosting ≠ functioning |

**Evidence Tiers** — every verification claim must be classified:

| Tier | Name | Sufficient alone? |
|---|---|---|
| 0 | STATIC (compile, build, lint) | NEVER |
| 1 | STRUCTURAL (file exists, imported, route registered) | NEVER |
| 2 | OBSERVATIONAL (page loads, feature renders) | Yes (display-only) |
| 3 | INTERACTIVE (click/type/submit → observed result persists) | Yes (behavioral) |
| 4 | AUTOMATED (Playwright/WebMCP test passes) | Yes (strongest) |

**Minimum: Tier 2 for display criteria, Tier 3 for behavioral criteria.**

#### Skeptical Evaluator (B5 — wf-15175dbc)

**When to use**: every L1+ task at validating phase. Forces three enumeration passes before "done" is allowed: UI fields, API parameters, state keys.

Run:
```js
const { buildSkepticalPrompt, parseSkepticalOutput } = require('scripts/flow-skeptical-evaluator');
const built = buildSkepticalPrompt({ specMarkdown, diffText, changedFiles, commitMessage, taskId });
// spawn Agent with built.systemPrompt + built.userPrompt
const result = parseSkepticalOutput(agentResponse, { taskId });
if (!result.ok) { /* surface blockers + unverifiedClaims to user */ }
```

The evaluator's built-in pre-checks (BEL grep + spec-bundle grep) are surfaced in the user prompt so the sub-agent is grounded in mechanical data, not vibes. Every finding the evaluator produces must carry `evidenceTier` (0–4) + `confidencePct` (95/85/75) per `.workflow/rubrics/confidence-tiers.md`. Confidence-75 findings auto-flag as `UNVERIFIED`.

Config: `intentGroundedReasoning.skepticalEvaluator.enabled` (default true).

#### Spec-String Bundle Grep (B4 — wf-07046456)

**When to use**: every L1+ task at Tier-3 verification. Extracts the "string bundle" from the spec (backtick IDs, quoted strings, file paths, constants, route paths) and greps each against the diff + changed files + built bundle.

Run: `const { extractSpecStrings, verifySpecBundleCoverage, formatSpecBundleResult } = require('scripts/flow-completion-truth-gate');`

Per-category coverage thresholds (defaults):
- File paths: 100% (every file the spec names must appear in the diff)
- Route paths: 100%
- Constants: 80%
- Backtick IDs: 80%
- Quoted strings: 70% (allows for paraphrasing of error messages that were prototypes)

Report the diff: any category below threshold surfaces the missing strings. The user either adds the missing implementation or updates the spec.

#### DOM Field Inventory Snapshot (B3 — wf-f9431ef6)

**When to use**: Any task that modifies a form, filter, wizard step, settings panel, or other UI surface containing `<input>`, `<select>`, `<textarea>`, or custom input components.

Follow the protocol in `.workflow/templates/tier3-dom-field-inventory.md`:

1. **Before**: snapshot the field inventory (name, label, type, default, required, validation, visibility) → `.workflow/verifications/<taskId>/dom-inventory-before.md`
2. **After**: re-snapshot with the new code → `.workflow/verifications/<taskId>/dom-inventory-after.md`
3. **Diff**: classify each field as preserved / modified / vanished / added → `.workflow/verifications/<taskId>/dom-diff.md`
4. **Reconcile** against the task spec — any vanished/modified/added field that isn't named in an AC must be surfaced to the user before proceeding.

This catches "silent field vanishing" bugs (see `feedback-patterns.md`) that lint + typecheck + smoke-test all miss because the missing field has no consumer in the critical path.

#### Verification Method Selection

Run: `node node_modules/wogiflow/scripts/flow-runtime-verification.js method`

**Priority order** (use the first available):

**1. WebMCP Browser Verification (DEFAULT — preferred)**

When `config.webmcp.enabled` or a browser MCP server is detected in `.mcp.json`:

For EACH acceptance criterion:
1. Navigate to the affected page via `mcp_browser_navigate`
2. Screenshot BEFORE: `mcp_browser_screenshot()`
3. Perform the user action (click, type, select, submit)
4. Wait 2-3 seconds for async updates
5. Screenshot AFTER: `mcp_browser_screenshot()`
6. Assert DOM state: `mcp_browser_evaluate("document.querySelector(...)")`
7. Record in Behavioral Evidence Log

**High-risk tasks** (state mutation detected — useMutation, invalidateQueries, onMutate):
- After all criteria verified, wait 3 seconds
- Screenshot again — check state persisted after refetch
- Reload page: `mcp_browser_navigate` to same URL
- Wait for networkidle
- Screenshot — check state survived page reload
- If state reverted → the server didn't persist, or refetch overwrote it → FAIL

**2. Playwright Test Generation (secondary)**

When Playwright/Puppeteer is in dependencies but no WebMCP:
1. Auto-generate a Playwright test from acceptance criteria
2. Write test to `tests/verification/verify-{taskId}.spec.ts`
3. Instruct the user: "Run `npx playwright test tests/verification/verify-{taskId}.spec.ts --headed` to verify"
4. If the project has CI, the test persists as a regression guard

**3. User Verification Checklist (fallback — always available)**

When neither WebMCP nor Playwright is available:

Present a checklist to the user:
```
━━━ USER VERIFICATION CHECKLIST ━━━
I cannot verify UI behavior from the CLI. Please check:

□ 1. Navigate to [page]
□ 2. [criterion 1 — specific action + expected result]
□ 3. [criterion 2 — specific action + expected result]
□ Wait 3 seconds after each action
□ Refresh the page and verify changes persisted

Reply "verified" when all checks pass, or describe what's broken.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**CRITICAL**: The agent MUST wait for the user's "verified" response before marking the task complete. Do NOT proceed to quality gates without verification.

#### Behavioral Evidence Log (BEL)

Before marking ANY UI task complete, produce a BEL:

```
━━━ BEHAVIORAL EVIDENCE LOG ━━━
Task: wf-XXXXXXXX
Method: WEBMCP / PLAYWRIGHT / USER_CHECKLIST
Verified on: localhost:5173

CRITERION: "[text]"
  ACTION: Clicked "Route To" cell, selected "Design Department"
  EXPECTED: Cell updates to show "Design DEPARTMENT"
  OBSERVED: Cell shows "Design DEPARTMENT" with blue icon
  WAIT: 3 seconds — state persisted after refetch
  VERDICT: PASS
  EVIDENCE: Tier 3 (INTERACTIVE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The OBSERVED field MUST describe what was SEEN, not what the code theoretically produces.

#### Pre-Implementation "See Before You Touch" (modification tasks)

For tasks modifying existing UI (not greenfield):
1. Start dev server if not running
2. Navigate to the affected page
3. Screenshot/observe current state (BEFORE)
4. Document the baseline
5. Then implement changes
6. After implementation, compare BEFORE vs AFTER

#### Repeat Failure Protocol (Groundhog Day Detector)

When the SAME issue is reported in 2+ consecutive dispatches:

| Strike | Action |
|--------|--------|
| 1 | Normal fix + BEL |
| 2 | MANDATORY root cause analysis BEFORE coding. Change approach. Add console.log tracing. Tier 3+ evidence required. |
| 3 | HARD BLOCK: Cannot mark done without screenshot/console evidence. Must state what's DIFFERENT this time. |
| 4+ | ESCALATION: Acknowledge inability, suggest pair debugging with user. |

Run: `node node_modules/wogiflow/scripts/flow-runtime-verification.js repeat wf-XXXXXXXX`

#### Devil's Advocate Prompt

Before marking ANY task complete (frontend or backend), ask yourself:

> "Assume this is broken. What are the 3 most likely ways it could fail?"

Then CHECK each one:
1. Does the API actually accept these fields? (curl it or check the DTO)
2. Does the response include the fields I'm reading? (log the response)
3. Does the UI update persist after refetch/re-render? (wait 3 seconds and look again)
4. Is the request payload shape what the server expects? (compare DTO with frontend fetch)

If ANY is plausible and not verified → investigate before marking done.

---

### BACKEND: API Integration Test Generation

**Activates when**: Changed files match `*.controller.*`, `*.service.*`, `*.resolver.*`, `/routes/`, `/api/`, `*.dto.*`, `*.guard.*`, `*.middleware.*`

Run detection: `node node_modules/wogiflow/scripts/flow-runtime-verification.js api-detect [changed-files...]`

**For EACH acceptance criterion that involves an API endpoint**:

1. **Identify the endpoint**: method (GET/POST/PUT/PATCH/DELETE), path, expected request/response shape
2. **Generate an integration test** that:
   - Makes the actual HTTP request to the running dev server
   - Asserts the status code matches expected
   - Asserts the response body contains expected fields
   - For mutations (POST/PUT/PATCH/DELETE): re-fetches the resource to verify persistence
   - For auth-protected endpoints: includes the auth token
3. **Write the test** to `tests/verification/api-verify-{taskId}.test.js`
4. **Run the test**: `node --test tests/verification/api-verify-{taskId}.test.js`
5. **If test fails** → debug, fix the implementation, re-run (max 5 retries)
6. **Test persists** as a regression guard

**API Test Template** (generated per criterion):

```javascript
it('POST /api/pipeline-rules — creates a rule with correct fields', async () => {
  const res = await apiRequest('POST', '/api/pipeline-rules', {
    tagPattern: 'animation',
    routeTo: { type: 'department', id: 'dept-123' },
    mode: 'CLAIMABLE'
  });

  // Status check
  assert.equal(res.status, 201);

  // Response shape check
  assert.ok(res.data.id, 'Response missing field: id');
  assert.equal(res.data.tagPattern, 'animation');
  assert.equal(res.data.mode, 'CLAIMABLE');

  // Persistence check: re-fetch and verify stored
  const verify = await apiRequest('GET', `/api/pipeline-rules/${res.data.id}`);
  assert.equal(verify.status, 200);
  assert.equal(verify.data.tagPattern, 'animation');
});
```

**Boundary verification** (frontend↔backend):
When the task is `fullstack` (both UI and API files changed):
1. Generate BOTH browser tests AND API tests
2. The API test verifies the server accepts the payload shape the frontend sends
3. The browser test verifies the UI correctly displays the response shape the server returns
4. If either fails → the boundary contract is broken

**Quick verification via curl** (for manual checking):
The AI can also generate and run curl commands directly:
```bash
# Create a rule
curl -s -X POST http://localhost:3000/api/pipeline-rules \
  -H "Content-Type: application/json" \
  -d '{"tagPattern":"animation","routeTo":{"type":"department","id":"dept-123"},"mode":"CLAIMABLE"}'

# Verify it was stored
curl -s http://localhost:3000/api/pipeline-rules | jq '.[-1]'
```

---

### Configuration

```json
{
  "runtimeVerification": {
    "enabled": true,
    "autoGenerateTests": true,
    "frontend": {
      "method": "webmcp",
      "fallback": ["playwright", "checklist"],
      "devServerUrl": "http://localhost:5173"
    },
    "backend": {
      "method": "api-test",
      "fallback": ["curl", "checklist"],
      "baseUrl": "http://localhost:3000"
    },
    "testOutput": "tests/verification",
    "persistTests": true,
    "blockOnFailure": true
  }
}
```

**`autoGenerateTests: true`** (default) — Tests are generated for EVERY task. This is the core behavioral change: verification is not an afterthought, it's built into the execution loop.

**`persistTests: true`** (default) — Generated tests stay in `tests/verification/` as permanent regression guards. Over time, this builds an automated test suite from the actual use cases that were implemented.

**`blockOnFailure: true`** (default) — If generated tests fail, the task is NOT complete. The agent must fix the implementation until tests pass.

### Skip Conditions

- `config.runtimeVerification.enabled: false` → skip entirely (not recommended)
- Task has NO code files in changed set (docs-only, config-only) → skip
- Task is L3 trivial AND no UI/API files → skip

## Step 3.6: Integration Wiring Validation (MANDATORY)

Run `node node_modules/wogiflow/scripts/flow-wiring-verifier.js wf-XXXXXXXX`

**Forward wiring** — For each created file, verify it's imported/used somewhere:
- Entry points (index.ts, App.tsx, *.config.ts, tests) don't need imports
- Components MUST be imported in a parent. Hooks MUST be called. Utilities MUST be imported.
- If NOT wired: identify where to import, wire it up, re-verify.

**Removal impact** (v1.9.3) — For each removed export, type member, or identifier, verify no consumers still reference it:
- Runs automatically as part of the `integrationWiring` quality gate
- Detects orphaned references: removed type union members, exported names, component references, string literal IDs (e.g., tab IDs, route keys)
- If orphaned references found: update consumers to remove stale references, re-verify.
- CLI: `node node_modules/wogiflow/scripts/flow-wiring-verifier.js removal-check [files...]`

## Step 3.7: Standards Compliance Check (MANDATORY)

Run `node node_modules/wogiflow/scripts/flow-standards-gate.js wf-XXXXXXXX [changed-files...]`

Checks scoped by task type: component → naming/components/security. Utility → naming/functions/security. API → naming/api/security. Bugfix → naming/security. Feature → all. Refactor/migration → all + consumer-impact verification.

**Consumer impact check** (ALL L1+ tasks): The blast-radius analysis ran in the explore phase (Agent 6: Consumer Impact) and wrote results to `.workflow/state/blast-radius-{taskId}.json`. That file contains an array of consumer entries, each classified as BREAKING (must update), NEEDS-UPDATE (review), or SAFE (no change needed). Read the file and, for each entry with `classification: "BREAKING"`, verify the file listed in `path` was actually modified in this task's changeset (check `git diff --name-only`). If any BREAKING consumer is NOT in the diff → BLOCK task completion and surface to user.

**Reuse candidate check** (AI-as-Judge): Standards gate returns similar items from all registries. AI reasons about PURPOSE overlap (not just name). If purpose overlaps → ask user (use existing / extend / create new). If purpose clearly differs → proceed silently.

If violations found: fix, re-run, only proceed when all pass. Violations auto-recorded to `feedback-patterns.md`; 3+ occurrences → promoted to `decisions.md` (project-level) or fixed in WogiFlow base code (product-level). See `/wogi-decide` Step 0.5 for product vs project classification.

## Step 3.9: Completion Truth Gate (when `config.intentGroundedReasoning.enabled` and gate listed in `qualityGates`)

**Conditional** — runs when `completionTruth` appears in `config.qualityGates.<taskType>.require`. The gate is registered in `GATE_REGISTRY` as part of IGR Story 6; adding it to the task-type gate list is the enable switch per task type.

Audits every claimed-done acceptance criterion against tier-classified evidence stored on durable-session steps (`step.verificationProof`). When evidence is below `config.intentGroundedReasoning.completionTruthGate.minTierForDone` (default Tier 3 — INTERACTIVE), the gate:
- Returns `passed: false` (unless `blockFalseCompletion: false` soft mode)
- Emits a language-downgraded claim replacing "done/completed/deployed" with "implemented (unverified)"
- Records telemetry (`gateId: completion-truth-gate`) with per-criterion tier distribution

Coexists with the existing `verificationProof` gate (coarser boolean predecessor). Both fire; Truth Gate's message supersedes when both produce non-PASS.

See `scripts/flow-completion-truth-gate.js` and `.claude/docs/intent-grounded-reasoning.md`.

When IGR flag is OFF OR `completionTruth` is not in the gate list: SKIPPED. Existing quality-gate behavior preserved exactly.
