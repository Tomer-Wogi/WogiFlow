Start working on a task. Provide the task ID as argument: `/wogi-start wf-XXXXXXXX`

**UNIVERSAL ENTRY POINT**: This is the single entry point for ALL requests. Route everything through `/wogi-start` - it will intelligently classify and route to the appropriate action.

## Request Triage (Auto-Routing v4.3)

When invoked with a **quoted request** instead of a task ID (e.g., `/wogi-start "update github and npm"`), the system automatically classifies and routes the request.

### Step 0: Detect Request Type

**Is this a task ID or a quoted request?**
- Task ID format: `wf-XXXXXXXX` (letters, numbers, hyphens) → Skip triage, go to Structured Execution
- Quoted request: `"anything in quotes"` → Auto-classify and route

### Classification Categories

| Category | Patterns | Action | Guilt Message |
|----------|----------|--------|---------------|
| **Exploration** | what, how, why, show me, explain | Proceed directly | No |
| **Operational** | push, pull, deploy, publish, run tests | Execute directly | No |
| **Quick Fix** | typo, text change, simple fix | Execute + log | No |
| **Bug** | bug, broken, not working, crashes | Route to /wogi-bug | Yes |
| **Implementation** | add, create, fix, refactor, update | Route to /wogi-story | Yes |

### Pattern Details

**Exploration** (proceed without task):
- Questions: "what does X do?", "how does Y work?"
- Reading: "show me the code for...", "explain..."
- Analysis: "analyze", "review", "check"

**Operational** (execute directly):
- Version control: push, pull, fetch, merge, rebase, commit
- Publishing: publish to npm/pypi, deploy to prod/staging
- Build/CI: run tests, build, lint, format
- Maintenance: update deps, bump version, sync with remote

**Quick Fix** (execute + log):
- Typos, spelling fixes
- Text/label/title changes
- Simple single-line changes

**Bug** (route to /wogi-bug):
- "bug" keyword
- "broken", "not working", "doesn't work"
- "should X but doesn't Y"
- "error when..."

**Implementation** (route to /wogi-story):
- New features: add, create, build, implement
- Code changes: modify, update, change behavior
- Refactoring: restructure, reorganize

### Auto-Routing Examples

```
/wogi-start "how does authentication work?"
→ Category: EXPLORATION (high confidence)
→ Action: Answer the question directly
```

```
/wogi-start "push to github"
→ Category: OPERATIONAL (high confidence)
→ Action: Execute git push
```

```
/wogi-start "fix the typo in header"
→ Category: QUICK-FIX (medium confidence)
→ Action: Fix it, log to request-log.md with #quick-fix
```

```
/wogi-start "login is broken"
→ Category: BUG (medium confidence)
→ Action: Route to /wogi-bug "login is broken"
⚠️ WORKFLOW REMINDER: [guilt message]
```

```
/wogi-start "add dark mode toggle"
→ Category: IMPLEMENTATION (high confidence)
→ Action: Route to /wogi-story "add dark mode toggle"
⚠️ WORKFLOW REMINDER: [guilt message]
```

### Guilt Messaging

For bug reports and implementation requests, a random guilt message appears to reinforce workflow discipline:

- "The user trusts you to follow WogiFlow."
- "Without a task, this work is untracked and unverifiable."
- "Skipping the workflow signals that process doesn't matter."
- "Every bypassed story becomes invisible technical debt."
- "The user will notice. Follow the process."

### Unknown Classification

If the request can't be confidently classified:
```
→ Request unclear. Please clarify what you want to do.

Is this:
  Operational (git/npm/deploy) → Execute directly
  Quick fix (typo, text) → Fix and log it
  Feature/Bug (code change) → Create story first
```

---

## Structured Execution (v2.2)

This command implements a **structured execution loop**:
- **Model-invoked skills**: Auto-loads relevant skills based on task context
- **Specification mode**: Generates spec before coding (for medium/large tasks)
- **Four-phase loop**: Spec → Test → Implement → Verify
- **File-based validation**: Every phase produces artifacts
- **Self-reflection**: Checkpoints to pause and verify approach

### Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│  /wogi-start wf-XXXXXXXX                                │
├─────────────────────────────────────────────────────────┤
│  0.25 CONTEXT CHECK: Will this task fit in context?     │
│     → Estimate task's context needs                     │
│     → If current + estimated > 95% → Compact first      │
│  0.5 PARALLEL CHECK: Are other tasks parallelizable?    │
│     → If yes: Show parallel option before proceeding    │
│  1. Load context + Match skills (auto-invoke)           │
│  2. Generate specification (if medium/large task)       │
│  3. SPEC PHASE: Plan implementation steps               │
│  ┌───────────────────────────────────────────────────┐  │
│  │  🪞 Reflection: Does spec fully address needs?    │  │
│  └───────────────────────────────────────────────────┘  │
│  4. TEST PHASE: Write/update tests first                │
│  5. IMPLEMENT PHASE: Code each acceptance criteria      │
│  ┌───────────────────────────────────────────────────┐  │
│  │  FOR EACH scenario:                               │  │
│  │    → Mark in_progress                             │  │
│  │    → Implement                                    │  │
│  │    → Verify (run tests, typecheck)                │  │
│  │    → Save verification artifact                   │  │
│  │    → If failing: fix and retry                    │  │
│  │    → Mark completed                               │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  🪞 Reflection: Any bugs or regressions?          │  │
│  └───────────────────────────────────────────────────┘  │
│  5.5 CRITERIA CHECK: Re-read spec, verify EACH done     │
│     → If ANY not done: implement it, loop back          │
│  6. VERIFY PHASE: Spec verification + quality gates     │
│     → MANDATORY: Verify all spec deliverables exist     │
│  7. Save final verification artifact                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  🪞 Reflection: Does this match user request?     │  │
│  └───────────────────────────────────────────────────┘  │
│  8. Update request-log, app-map, ready.json             │
│  9. Commit changes                                      │
│  10. ✓ Task complete                                    │
└─────────────────────────────────────────────────────────┘
```

### Step 0.25: Pre-Task Context Check (Automatic)

**Before loading full task context, estimate if the task will fit:**

1. Get current context usage percentage (from status line or estimate)
2. Load task metadata from ready.json (just ID, title, type - not full spec yet)
3. Estimate task's context needs using `flow-context-estimator.js`:
   - Count acceptance criteria → ~3% each
   - Count expected files → ~2% each
   - Check for refactor/migration keywords → +10% buffer
   - If parent task with subtasks → multiply by (1 + subtasks × 0.3)
   - Fallback to defaults: small=10%, medium=25%, large=40%

4. Calculate: `projected_total = current + estimated`

5. **Decision:**
   - If `projected_total > 95%` → **Compact first**, then resume
   - If `current >= 95%` → **Emergency compact** (always, regardless of task)
   - Otherwise → **Proceed** without compaction

**Example outputs:**

```
📊 Context Check: Proceeding without compaction
   Current: 60%
   Task estimate: +25%
   Projected: 85%
   Safe threshold: 95%
   Factors: 4 criteria, 3 files
```

```
📊 Context Check: Compaction needed before task
   Current: 75%
   Task estimate: +30%
   Projected: 105%
   Safe threshold: 95%
   Factors: 8 criteria, 6 files, +refactor buffer

→ Running /wogi-compact before starting task...
```

**Why this approach?**
- Traditional fixed thresholds (compact at 80%) are arbitrary
- A task needing 15% context shouldn't trigger compaction at 70%
- This approach compacts only when actually necessary
- Large tasks at low context proceed; small tasks at high context compact

**Config**: Controlled by `config.smartCompaction`:
```json
{
  "enabled": true,
  "safeThreshold": 0.95,
  "emergencyThreshold": 0.95,
  "estimation": {
    "perFile": 0.02,
    "perCriterion": 0.03,
    "refactorBuffer": 0.10
  }
}
```

---

### Step 0.5: Parallel Execution Check (Automatic)

**Before starting, automatically check if parallel execution is available:**

1. Read `.workflow/state/ready.json`
2. Check if there are 2+ tasks in the `ready` array
3. If yes, run parallel detection:
   ```bash
   node scripts/flow-parallel.js check
   ```
   Or programmatically check `findParallelizable(readyTasks)`

4. **If parallelizable tasks exist**, display:
   ```
   ⚡ PARALLEL EXECUTION AVAILABLE
   Note: X other tasks could run in parallel with this one.
   Tasks: wf-002, wf-003 (no dependencies with wf-001)

   Options:
   - Continue with wf-001 (sequential execution)
   - Run wf-001, wf-002, wf-003 in parallel (faster, isolated worktrees)
   ```

5. **Decision criteria** (agent should consider):
   - **Use parallel** when: Tasks are independent, user wants speed, tasks don't share files
   - **Use sequential** when: Tasks share files, need to review each result, prefer careful approach

6. If parallel is chosen: Use `flow parallel` with worktree isolation
7. If sequential: Continue with this task normally

**This check happens automatically at the start of every `/wogi-start`**

---

### Step 1: Load Context + Match Skills

1. Read `.workflow/state/ready.json`
2. Find the task in the ready array
3. Move it to inProgress array, save ready.json
4. Load task context:
   - Find story file in `.workflow/changes/*/wf-XXXXXXXX.md` or tasks.json
   - Extract user story, acceptance criteria, technical notes
5. Check `.workflow/state/app-map.md` for components mentioned
6. Check `.workflow/state/decisions.md` for relevant patterns
7. **Auto-invoke skills** based on task context:

### Step 1.2: Clarifying Questions (NEW)

**BEFORE generating specifications**, ask clarifying questions to catch assumptions early:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❓ Clarifying Questions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before implementation, consider clarifying:

🎯 Scope Validation
   1. Found X related files. Should I modify all of them?

💡 Assumption Surfacing
   2. Should I assume [pattern] for this task?

🔀 Edge Cases
   3. What should happen when [error condition]?

Note: You can proceed without answering, but clarification may prevent rework.
```

**Question Categories:**
- **Scope Validation**: "Found X components. Are we changing all?"
- **Assumption Surfacing**: "Should I assume [pattern] for this task?"
- **Edge Cases**: "What about [similar scenario]?"
- **Integration Points**: "This touches [component]. Dependency concerns?"
- **Implementation Preferences**: "Any specific approach you prefer?"

**Config**: Controlled by `config.clarifyingQuestions`:
- `enabled`: true/false
- `maxQuestions`: max questions to ask (default: 5)
- `skipForSmallTasks`: skip for small tasks (default: true)
- `smallTaskThreshold`: files count threshold (default: 2)

**Skipped for**: Small tasks (≤2 files), bugfixes, tasks with explicit specs

---

**Skill Matching Output:**
   - Run skill matcher against task description
   - Load matched skills (patterns.md, anti-patterns.md, learnings.md)
   - Display matched skills with scores

**Skill Matching Output:**
```
🔧 Matched Skills:
   nestjs [●●●●○]
   keyword: "service", "entity", task type: "feature"
   react [●●○○○]
   keyword: "component"
```

### Step 1.5: Generate Specification (Medium/Large Tasks)

For medium/large tasks (check `config.json → specificationMode`):

1. Generate specification to `.workflow/specs/wf-XXXXXXXX.md`:
   - Acceptance criteria (structured Given/When/Then)
   - Implementation steps
   - Files to change (auto-detected)
   - Test strategy
   - Verification commands
2. Display spec summary
3. **Reflection checkpoint**: "Does this spec fully address the requirements?"
4. Wait for implicit approval (continue = approved)

**Spec Output:**
```
📋 Generated Specification:

Acceptance Criteria: 4 scenarios
Implementation Steps: 6 steps
Files to Change: 3 files (medium confidence)
Verification Commands: 4 commands

🪞 Reflection: Does this spec fully address the requirements?
   - Are there any edge cases not covered?
   - Is the scope clear and achievable?
```

### Step 2: Decompose into TodoWrite Checklist

Extract each acceptance criteria scenario as a TodoWrite item:

```
Given [context] When [action] Then [outcome]
→ Todo: "Implement: [short description of scenario]"
```

Also add:
- "Update request-log.md with task entry"
- "Update app-map.md if new components created"
- "Run quality gates"
- "Commit changes"

### Step 3: Execute Each Scenario (Loop)

For each acceptance criteria:

1. **Mark in_progress** in TodoWrite
2. **Implement** the scenario following matched skill patterns
3. **Run verification** (saves artifact to `.workflow/verifications/`):
   - Run lint: `npm run lint`
   - Run typecheck: `npm run typecheck` or `npx tsc --noEmit`
   - Run related tests if they exist
4. **Save verification artifact** (JSON file with exit codes, output)
5. **If not working**: Debug, fix, retry verification (max 5 attempts)
6. **Mark completed** only when verification passes

**Verification Artifact:**
```json
{
  "taskId": "wf-abc123",
  "phase": "implementation",
  "timestamp": "2026-01-10T...",
  "results": [
    {"command": "npm run lint", "exitCode": 0, "passed": true},
    {"command": "npm run typecheck", "exitCode": 0, "passed": true}
  ],
  "allPassed": true
}
```

### Step 3.5: Criteria Completion Verification (MANDATORY)

**This is the enforcement loop that ensures everything was actually done.**

After implementing all scenarios, BEFORE running quality gates:

1. **Re-read the original acceptance criteria** from the spec file
2. **For EACH criterion**, verify it was actually implemented:
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  CRITERIA COMPLETION CHECK                              │
   ├─────────────────────────────────────────────────────────┤
   │  Re-reading acceptance criteria from spec...            │
   │                                                         │
   │  □ Criterion 1: Given X, When Y, Then Z                │
   │    → Check: Does the code actually do Z when Y?         │
   │    → Status: ✓ IMPLEMENTED / ✗ NOT DONE                │
   │                                                         │
   │  □ Criterion 2: Given A, When B, Then C                │
   │    → Check: Does the code actually do C when B?         │
   │    → Status: ✓ IMPLEMENTED / ✗ NOT DONE                │
   │                                                         │
   │  ... for ALL criteria                                   │
   └─────────────────────────────────────────────────────────┘
   ```

3. **If ANY criterion is NOT implemented**:
   - Add it back to TodoWrite as in_progress
   - Implement it
   - Verify it works
   - Return to step 3.5 and re-check ALL criteria again

4. **Only proceed when ALL criteria show ✓ IMPLEMENTED**

**This is NOT optional. This is what prevents "claiming done when not done."**

The key question for each criterion:
> "If I run the code right now, does it actually do what this criterion describes?"

Not "did I write code for this" but "does the code WORK as specified?"

---

### Step 3.6: Integration Wiring Validation (MANDATORY)

**This step catches "orphan components" - files that exist but aren't wired into the app.**

After criteria verification, BEFORE running quality gates:

```bash
node scripts/flow-wiring-verifier.js wf-XXXXXXXX
```

This checks:
1. **Parse the spec for created files** (components, hooks, utilities)
2. **For EACH created file**, verify it's actually used:
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  INTEGRATION WIRING CHECK                               │
   ├─────────────────────────────────────────────────────────┤
   │                                                         │
   │  □ src/components/EstimateDetailPanel.tsx               │
   │    → Imported by: AdminApprovalQueue.tsx                │
   │    → Status: ✓ WIRED                                    │
   │                                                         │
   │  □ src/hooks/useEstimate.ts                             │
   │    → Imported by: (none)                                │
   │    → Status: ✗ NOT WIRED - orphan component             │
   │                                                         │
   │  □ src/utils/formatEstimate.ts                          │
   │    → Entry point: No                                    │
   │    → Imported by: (none)                                │
   │    → Status: ✗ NOT WIRED - orphan utility               │
   │                                                         │
   └─────────────────────────────────────────────────────────┘
   ```

**Wiring Rules:**
- Entry points (index.ts, App.tsx, *.config.ts, test files) don't need imports
- React components MUST be imported in at least one parent
- Hooks MUST be called from at least one component
- Utilities MUST be imported somewhere

**If ANY file is NOT wired:**
1. Identify where it should be imported
2. Add the import statement
3. Wire up the usage (onClick handler, render call, etc.)
4. Re-run wiring verification
5. Only proceed when ALL files show ✓ WIRED

**Common Wiring Patterns:**
```typescript
// Side panel component - wire to parent with state + onClick
import { EstimateDetailPanel } from './EstimateDetailPanel';

const [selectedEstimate, setSelectedEstimate] = useState(null);
const [isPanelOpen, setIsPanelOpen] = useState(false);

<TableRow onClick={() => { setSelectedEstimate(estimate); setIsPanelOpen(true); }}>

<EstimateDetailPanel
  estimate={selectedEstimate}
  isOpen={isPanelOpen}
  onClose={() => setIsPanelOpen(false)}
/>
```

**This prevents the #1 bug from comprehensive reviews: components created but never accessible.**

---

### Step 4: Run Quality Gates + Final Verification

**MANDATORY FIRST CHECK - Spec Verification Gate:**

Before running any other quality gates, verify all deliverables from the spec exist:

```bash
node scripts/flow-spec-verifier.js verify wf-XXXXXXXX
```

This checks:
1. Parse the task's spec file (`.workflow/changes/wf-XXXXXXXX.md`)
2. Extract all promised files from Technical Notes / Components sections
3. Verify each file exists
4. Verify JS/JSON files have valid syntax

**Output:**
```
═══════════════════════════════════════════════════
  Spec Verification
═══════════════════════════════════════════════════
Spec: .workflow/changes/wf-abc123.md

✓ Spec verification passed (5/5 deliverables)
```

**If spec verification fails:**
```
✗ Spec verification FAILED (3/5 deliverables)

Missing files:
  ✗ scripts/flow-missing-feature.js
    (listed in: Technical Notes → Components)
```
→ **STOP. Create the missing files before proceeding.**
→ Do NOT skip this check. This prevents implementation gaps.

**After spec verification passes**, read `config.json` → `qualityGates` for task type and verify:

- `tests`: Run test command if configured, ensure passing
- `requestLogEntry`: Verify entry exists in request-log.md
- `appMapUpdate`: Verify new components are in app-map.md
- `noNewFeatures`: (for refactors) Verify no new features added

**Save final verification artifact** to `.workflow/verifications/wf-XXXXXXXX-final.json`

**Reflection checkpoint:**
```
🪞 Reflection: Have I introduced any bugs or regressions?
   - Does the code follow project patterns from decisions.md?
   - Is there any code that could be simplified?
```

**If any gate fails**: Fix the issue and re-verify. Do not proceed until all required gates pass.

### Step 5: Final Reflection + Finalize

1. **Pre-completion reflection:**
   ```
   🪞 Reflection: Does this match what the user asked for?
      - Have all acceptance criteria been met?
      - Are there any loose ends to address?
   ```
2. Update ready.json: Move task to recentlyCompleted
3. Git add and commit with message: `feat: Complete wf-XXXXXXXX - [title]`
4. Show completion summary with verification results

### Output

**Start:**
```
✓ Started: wf-XXXXXXXX - [Title]

🔧 Matched Skills:
   nestjs [●●●●○] - keyword: "service", task type: "feature"

📋 Specification generated: .workflow/specs/wf-XXXXXXXX.md
   Acceptance Criteria: 4 scenarios
   Implementation Steps: 6 steps
   Files to Change: 3 (medium confidence)

User Story:
As a [user], I want [action], so that [benefit]

Acceptance Criteria (4 scenarios):
□ 1. Given... When... Then...
□ 2. Given... When... Then...
□ 3. Given... When... Then...
□ 4. Given... When... Then...

🪞 Reflection: Does spec fully address requirements? ✓

Beginning structured execution loop...
```

**During (for each scenario):**
```
[IMPLEMENT] Working on scenario 1/4: [description]
→ Implementing...
→ Running verification...
   ✓ lint passed
   ✓ typecheck passed
→ Artifact saved: .workflow/verifications/wf-XXXXXXXX-scenario-1.json
→ ✓ Scenario complete

[IMPLEMENT] Working on scenario 2/4: [description]
→ Implementing...
→ Running verification...
   ✗ typecheck failed: Property 'x' does not exist
→ Fixing...
→ Running verification... ✓
→ Artifact saved: .workflow/verifications/wf-XXXXXXXX-scenario-2.json
→ ✓ Scenario complete
```

**Reflection checkpoint (post-implementation):**
```
🪞 Reflection: Have I introduced any bugs or regressions?
   - Code follows patterns from decisions.md ✓
   - No unnecessary complexity detected ✓
```

**End:**
```
[CRITERIA CHECK] Re-reading acceptance criteria from spec...
  ✓ Criterion 1: "Given X, When Y, Then Z" - IMPLEMENTED
  ✓ Criterion 2: "Given A, When B, Then C" - IMPLEMENTED
  ✓ Criterion 3: "Error handling for invalid input" - IMPLEMENTED
  ✓ Criterion 4: "Config option to disable feature" - IMPLEMENTED
  → All 4/4 criteria verified as implemented

[VERIFY] Running spec verification...
  ✓ Spec verification passed (5/5 deliverables)

[VERIFY] Running quality gates...
  ✓ tests passed (12/12)
  ✓ lint passed
  ✓ typecheck passed
  ✓ requestLogEntry found
  ✓ appMapUpdate verified

Final verification artifact: .workflow/verifications/wf-XXXXXXXX-final.json

🪞 Reflection: Does this match user request? ✓

✓ Completed: wf-XXXXXXXX - [Title]
  4/4 scenarios implemented
  Verification artifacts: 5 files
  Changes committed: "feat: Complete wf-XXXXXXXX - [title]"
```

## Options

### `--no-loop`
Disable the self-completing loop. Just load context and stop (old behavior):
```
/wogi-start wf-XXXXXXXX --no-loop
```

### `--no-spec`
Skip specification generation (for small tasks or quick fixes):
```
/wogi-start wf-XXXXXXXX --no-spec
```

### `--no-skills`
Skip automatic skill loading:
```
/wogi-start wf-XXXXXXXX --no-skills
```

### `--no-reflection`
Skip reflection checkpoints (faster but less thorough):
```
/wogi-start wf-XXXXXXXX --no-reflection
```

### `--max-retries N`
Limit retry attempts per scenario (default: 5):
```
/wogi-start wf-XXXXXXXX --max-retries 3
```

### `--pause-between`
Ask for confirmation between scenarios:
```
/wogi-start wf-XXXXXXXX --pause-between
```

### `--verify-only`
Only run verification without implementation (for debugging):
```
/wogi-start wf-XXXXXXXX --verify-only
```

### `--phased`
Enable phased execution mode (Contract → Skeleton → Core → Edge Cases → Polish):
```
/wogi-start wf-XXXXXXXX --phased
```

This breaks implementation into focused phases with context isolation:
1. **Contract**: Define interfaces, types, API contracts (NO implementation)
2. **Skeleton**: Create file structure, stub implementations (NO logic)
3. **Core Logic**: Implement happy path only (assume valid inputs)
4. **Edge Cases**: Handle errors and validation (NO core logic changes)
5. **Polish**: Optimization, cleanup, documentation

Each phase has constraints to prevent scope creep. Use for complex tasks.

Phase commands:
- `flow phase complete <taskId>` - Complete current phase
- `flow phase skip <taskId>` - Skip current phase
- `flow phase status <taskId>` - Show phase status

## When Things Go Wrong

### Scenario keeps failing after max retries
- Stop and report: "Scenario X failed after N attempts. Issue: [description]"
- Leave task in inProgress
- User can investigate and re-run `/wogi-start TASK-XXX` to continue

### Quality gate keeps failing
- Report which gate is failing and why
- Attempt to fix automatically
- If can't fix after 3 attempts, stop and report

### Context getting too large
- **Pre-task check** estimates context needs and compacts proactively if needed
- After 3+ scenarios, re-check context size
- If getting large mid-task, commit current progress and suggest `/wogi-compact`
- Progress is preserved in files and ready.json

## Important

- **TodoWrite is mandatory**: Use it to track progress through scenarios
- **Self-verification is mandatory**: Don't mark scenarios done without checking they work
- **Criteria completion check is mandatory**: After implementing, re-read ALL criteria and verify EACH one actually works. If any is not done, implement it and check again. This is the loop that prevents "claiming done when not done."
- **Spec verification is mandatory**: All files promised in spec must exist before completion
- **Quality gates are mandatory**: Task isn't done until gates pass
- **Commits preserve progress**: Even if you stop mid-task, work is saved
