<!-- PINS: bug-protocol, bug-cli, bug-investigation, bug-phases, bug-population, bug-severity, bug-creation, bug-execution, bug-specific-execution, bug-learning, bug-discovery, bug-output, bug-configuration, bug-comparison -->

Create a bug report with full investigation and execution. Provide title: `/wogi-bug Login button not responding`

**This is NOT a passive template creator.** You are an AI investigator. Your job is to:
1. **Investigate** the bug (search codebase, analyze errors, form hypotheses)
2. **Populate** every field in the bug report with real findings
3. **Create** the bug file via CLI
4. **Route** to `/wogi-start` for structured fix execution

## Quick Reference
<!-- PIN: bug-cli -->

```
/wogi-bug "Login button not responding"
/wogi-bug "Null pointer in Profile API" --priority P0
/wogi-bug "Auth token refresh fails intermittently" --severity critical
```

## CLI Options

Run `./scripts/flow bug "<title>"` to create the bug file.

- `--from <task-id>` - Task ID that discovered this bug (auto-populated if task in progress)
- `--priority <P>` - Priority P0-P4 (auto-boosted to P1 if discovered during task)
- `--severity <level>` - Severity: critical, high, medium, low (default: medium)
- `--json` - Output JSON

---

## Bug Investigation Protocol (MANDATORY)
<!-- PIN: bug-investigation -->

**Do NOT just create a file with empty `[placeholder]` brackets.** You are the investigator. Follow this protocol to populate every field with real data.

### Phase 1: Understand the Report
<!-- PIN: bug-phases -->

Parse the user's bug description and extract:

1. **Symptom**: What the user observes (error message, wrong behavior, crash)
2. **Context**: Where it happens (screen, flow, API endpoint, CLI command)
3. **Trigger**: What action causes it (click, submit, navigate, specific input)
4. **Frequency**: Always, sometimes, first-time-only, race condition

If the report is vague, ask up to 3 clarifying questions using AskUserQuestion:
- "Can you describe what you see when this happens?"
- "Does this happen every time, or only sometimes?"
- "What were you doing right before it happened?"

**Skip questions if:** The report is clear enough to investigate, OR you discovered the bug yourself during task work.

### Phase 2: Codebase Investigation (Multi-Agent)

Launch 2-3 parallel investigation agents to search the codebase.

**Graceful fallback**: If Task sub-agents are unavailable, perform the same investigation steps sequentially using Grep, Glob, and Read tools directly. The investigation MUST happen regardless of agent availability.

#### Agent 1: Error Source Finder

Launch as `Task` with `subagent_type=Explore`:

```
Investigate bug: "[BUG_TITLE]"

Symptom: [parsed symptom]
Context: [parsed context]

1. Search for error messages mentioned in the report
   - Grep for exact error text
   - Grep for related error patterns
2. Find the file(s) where this behavior originates
   - Search for component/function names from the context
   - Trace the code flow from UI to data layer
3. Identify the specific function/line where the bug likely lives
4. Check git log for recent changes to these files (last 2 weeks)

Return:
- Suspected source file(s) with line numbers
- Recent changes that may have introduced the bug
- Code flow from trigger to symptom
```

#### Agent 2: Pattern & History Checker

Launch as `Task` with `subagent_type=Explore`:

```
Check for patterns related to bug: "[BUG_TITLE]"

1. Read .workflow/state/feedback-patterns.md
   - Look for similar bug patterns
   - Check if this type of bug has occurred before
2. Read .workflow/state/decisions.md
   - Check if there's a rule that should have prevented this
3. Search .workflow/bugs/ for similar past bugs
   - Check resolution of similar bugs
4. Read .workflow/state/request-log.md (last 20 entries)
   - Check if recent work touched the affected area

Return:
- Similar past bugs (if any) with their resolutions
- Relevant patterns from feedback-patterns.md
- Relevant rules from decisions.md that may apply
- Recent work that may be related
```

#### Agent 3: Dependency Impact Analyzer (conditional)

Launch as `Task` with `subagent_type=Explore` — only when severity is **high** or **critical** (controlled by `config.bugFlow.investigationAgents.dependencyAnalyzer.minSeverity`):

```
Analyze impact of bug in: "[AFFECTED_FILE]"

1. Find all files that IMPORT from the affected file
2. Find all files that the affected file IMPORTS
3. Check if the bug could cascade to other features
4. Identify test files that cover this code

Return:
- Dependency map (who uses this, what does this use)
- Cascade risk assessment
- Existing test coverage
```

**Launch all applicable agents in parallel** (single message, multiple Task calls).

**If investigation fails to identify a clear root cause**, consider escalating to `/wogi-debug-hypothesis` which spawns parallel agents to investigate competing theories about the root cause.

### Phase 3: Populate Bug Report
<!-- PIN: bug-population -->

Using the investigation results, populate EVERY field:

#### Bug Summary
Write 1-2 sentences describing:
- What is broken (specific behavior)
- What is the impact (who is affected, severity of impact)

**Example:**
> The login form submits but silently fails when the email contains a `+` character. Users with plus-addressed emails (e.g., user+tag@gmail.com) cannot log in, receiving no error message.

#### Reproduction
- **Steps to Reproduce**: Concrete numbered steps, not vague descriptions
- **Expected Behavior**: What should happen (reference spec or existing behavior)
- **Actual Behavior**: What actually happens (include error messages, screenshots if available)
- **Environment**: Fill in relevant fields (Node version from package.json, OS from context)

#### Root Cause Analysis
- **What Went Wrong**: Technical explanation based on code investigation (reference specific files and lines)
- **Why Did This Happen**: Check applicable boxes based on your analysis
- **Source of the Problem**: For AI-assisted bugs, identify if the root cause was a prompt issue, logic gap, or missing context

#### Fix Approaches
Propose at least 2 approaches with:
- Description of the fix
- Pros and cons
- Files affected (specific paths)
- Choose and justify the recommended approach

#### Acceptance Criteria
Write real Given/When/Then scenarios. At minimum 3 scenarios:
- **Scenario 1**: The bug is fixed (test the exact trigger)
- **Scenario 2**: No regression (test related functionality)
- **Scenario 3**: Edge cases (test boundary conditions the bug revealed)

Add more scenarios if the bug has multiple distinct failure modes.

#### Prevention & Learning
- **How to Prevent**: Specific actionable prevention steps
- **Learnings to Capture**: Draft the actual learning entries (not just "[describe]")

### Phase 4: Severity Assessment
<!-- PIN: bug-severity -->

Auto-assess severity based on investigation:

| Severity | Criteria |
|----------|----------|
| **Critical** | Data loss, security vulnerability, complete feature broken, no workaround |
| **High** | Major feature degraded, workaround exists but painful |
| **Medium** | Feature partially broken, easy workaround exists |
| **Low** | Cosmetic, minor inconvenience, edge case only |

Override user-provided severity if investigation reveals it's more/less severe:
```
Note: Upgraded severity from medium to high.
Reason: Investigation shows this affects all users with special characters in email,
not just plus-addressed emails as originally reported.
```

### Phase 5: Create Bug File + Verify Population
<!-- PIN: bug-creation -->

Run the CLI to create the file:
```bash
./scripts/flow bug "<populated title>" --priority <P> --severity <severity>
```

Then **immediately edit the generated file** to replace all `[placeholder]` brackets with your investigation findings from Phase 3. The CLI creates the template; you fill it in.

**Verification (MANDATORY)**: After editing, grep the bug file for remaining `[placeholder]` or `[Step` or `[What` brackets. If ANY remain, you missed a field — go back and populate it. The bug file must have zero placeholder brackets before proceeding.

### Phase 6: Route to Execution
<!-- PIN: bug-execution -->

After the bug file is created and populated:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bug Report Created: wf-XXXXXXXX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Title: [title]
Priority: P[X] | Severity: [severity]
Suspected Source: [file:line]
Fix Approach: [chosen approach name]
Acceptance Criteria: [N] scenarios

File: .workflow/bugs/wf-XXXXXXXX.md
Added to ready.json: yes

Starting structured fix execution...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Then immediately invoke `/wogi-start wf-XXXXXXXX`** to begin the structured fix execution loop.

The bug report IS the specification. `/wogi-start` uses the acceptance criteria from the bug file just like it would from a story spec. (Note: `specificationMode.skipFor` includes `"bugfix"` in config.json — this is intentional because the bug report itself serves as the spec.)

---

## Bug-Specific Execution (Inside /wogi-start)
<!-- PIN: bug-specific-execution -->

When `/wogi-start` runs on a bug task, these additional steps apply:

### Explore Phase: Verify Root Cause

Before implementing the fix, verify the root cause hypothesis:

1. Read the bug file's Root Cause Analysis section
2. Trace the code path described in the analysis
3. Confirm or update the hypothesis
4. If hypothesis is wrong, update the bug file and re-analyze

### Implementation: Fix + Prevent

For each acceptance criterion:
1. Implement the fix
2. Add regression test (if test infrastructure exists)
3. Run verification

### Bug Status Lifecycle

Keep the bug file's Status field in sync with ready.json:
- When `/wogi-start` begins: Update bug file `**Status**: Open` to `**Status**: In Progress`
- When fix is verified: Update bug file `**Status**: In Progress` to `**Status**: Fixed`
- If fix fails: Keep `**Status**: In Progress`

### Post-Fix: Learning Enforcement (MANDATORY Quality Gate)
<!-- PIN: bug-learning -->

**This is what makes bug fixing a learning opportunity.**
See also: CLAUDE.md Continuous Learning Protocol (Part 2: Post-Failure Capture) for the project-wide learning system this integrates with.

After all acceptance criteria pass, BEFORE completing the task:

**Note**: The quality gates `learningEnforcement` and `resolutionPopulated` in `config.qualityGates.bugfix` are instruction-driven — the AI reads the config and self-enforces these steps. They are not validated by a script; they are enforced by following this protocol.

#### Step 1: Populate Resolution Section

Edit the bug file's Resolution section:
```markdown
## Resolution
- **Fixed in**: [commit hash]
- **Root cause confirmed**: yes/no - [was initial analysis correct?]
- **Learnings applied**: [what was added to decisions.md/skills?]
- **Tests added**: [what tests were added?]
```

#### Step 2: Capture Learnings to feedback-patterns.md

Check if this bug type has a pattern:
```markdown
| [date] | [pattern-name] | [what went wrong] | [count] | [action] |
```

- If pattern exists: increment count
- If count >= 3: promote to `decisions.md` rule
- If new pattern: add with count = 1

#### Step 3: Evaluate Prevention Rules

Ask yourself:
1. "Could a coding standard have prevented this?" → Add to `decisions.md`
2. "Could a pre-task check have caught this?" → Add to `feedback-patterns.md`
3. "Could better test coverage have caught this?" → Note in test strategy
4. "Is this a recurring pattern?" → Create or strengthen a rule

#### Step 4: Cross-Reference

- If bug was discovered during a task (`discovered-from`): Add a note to that task's log entry
- If bug reveals a gap in a skill: Update the skill's `learnings.md`
- If bug was in recently-changed code: Flag in feedback-patterns as "regression"

**The task is NOT complete until Steps 1-4 are done.** This is a mandatory quality gate.

---

## Bug Discovered During Task Work
<!-- PIN: bug-discovery -->

When a bug is found while working on another task:

### Auto-Detection Signals
- Test failure on unrelated code
- Error in a file you didn't modify
- User reports something broken that isn't part of current task

### Inline Bug Creation

```
Bug discovered while working on wf-XXXXXXXX.

Creating bug report for: "[description]"
This bug will be tracked separately from the current task.
```

1. Run the investigation protocol (Phase 1-5) — but lighter:
   - Skip Agent 3 (dependency analysis) unless critical severity
   - Limit to 3 search operations (grep/glob) and 2 file reads maximum
   - Still populate ALL fields (no placeholders)
2. Create bug file with `--from wf-XXXXXXXX`
3. **Do NOT start the bug fix** — return to current task
4. Bug is added to `ready.json` for later execution

### Priority Auto-Boost

Bugs discovered during task work get priority boost:

| Severity | Priority (inline) | Priority (standalone) |
|----------|-------------------|----------------------|
| Critical | P0 | P0 |
| High | P1 | P1 |
| Medium | P1 (boosted) | P2 (default) |
| Low | P2 | P2 |

If the bug blocks current task: flag as blocker in ready.json.

---

## Output Format
<!-- PIN: bug-output -->

### Full Investigation Output
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUG INVESTIGATION: [title]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase 1: Understanding Report
  Symptom: [parsed symptom]
  Context: [screen/flow/component]
  Trigger: [user action]
  Frequency: [always/sometimes/rare]

Phase 2: Codebase Investigation
  Agent 1 (Error Source): Found in [file:line]
  Agent 2 (Pattern Check): [similar bugs found / no matches]
  Agent 3 (Impact): [N files affected / skipped]

Phase 3: Bug Report Populated
  Summary: [1 sentence]
  Root Cause: [technical explanation]
  Fix Approach: [chosen approach]
  Acceptance Criteria: [N scenarios]

Phase 4: Severity Assessment
  Original: [user-provided or default]
  Assessed: [after investigation]
  Reason: [if changed]

Phase 5: File Created
  Path: .workflow/bugs/wf-XXXXXXXX.md
  Placeholder check: 0 remaining
  Ready: Added to ready.json

Phase 6: Routing
  → Starting /wogi-start wf-XXXXXXXX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Inline Bug Output (discovered during task)
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUG CAPTURED: [title]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ID: wf-XXXXXXXX
  Severity: [severity] | Priority: P1
  Discovered from: wf-YYYYYYYY
  Source: [file:line]
  Added to ready.json for later execution.

  Returning to current task...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Configuration
<!-- PIN: bug-configuration -->

Bug behavior is controlled by `.workflow/config.json`:

```json
{
  "bugFlow": {
    "investigationAgents": {
      "errorSourceFinder": { "enabled": true },
      "patternChecker": { "enabled": true },
      "dependencyAnalyzer": { "enabled": true, "minSeverity": "high" }
    },
    "autoRoute": true,
    "learningEnforcement": {
      "enabled": true,
      "requireResolution": true,
      "requireFeedbackPattern": true,
      "promotionThreshold": 3
    },
    "inlineDiscovery": {
      "maxSearchOperations": 3,
      "maxFileReads": 2,
      "autoPriorityBoost": true,
      "skipDependencyAnalysis": true
    },
    "severityOverride": {
      "enabled": true,
      "requireJustification": true
    }
  }
}
```

---

## Comparison: Bug vs Story
<!-- PIN: bug-comparison -->

| Aspect | `/wogi-story` | `/wogi-bug` |
|--------|--------------|-------------|
| **Input** | User describes desired feature | User describes broken behavior |
| **Investigation** | Explore phase (codebase + best practices + versions) | Bug investigation (error source + patterns + impact) |
| **Output** | Story spec with acceptance criteria | Bug report with root cause + fix approaches |
| **Execution** | Routes to `/wogi-start` | Routes to `/wogi-start` |
| **Quality Gates** | Criteria check, wiring check, standards | Same + learning enforcement + resolution |
| **Post-completion** | Update app-map, request-log | Same + feedback-patterns, prevention rules |

**Bugs are NOT second-class citizens.** They get the same structured execution loop as stories, plus additional learning enforcement.

---

## Important

- **Never leave `[placeholder]` brackets** in a bug file. Every field gets populated with real data. Verify with grep after editing.
- **Always route to `/wogi-start`** after creating the bug file. Bug reports without execution are waste.
- **Learning enforcement is mandatory.** The Prevention & Learning section is a quality gate, not optional documentation.
- **Severity assessment is based on investigation**, not just user perception. Override when evidence warrants it.
- **Inline discovery is lightweight** but still populates all fields. Speed does not mean empty templates.
- **Cross-reference discovered-from bugs** back to the source task for traceability.
- **Bug status lifecycle**: Keep the bug file's Status field in sync with ready.json throughout the fix process.
