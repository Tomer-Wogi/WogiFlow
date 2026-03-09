# Project Decisions

Project-specific rules that agents must follow. Updated when user gives feedback.

---

## Component Architecture

### Component Reuse Policy
**Added**: Project initialization
**Rule**: Always check `app-map.md` before creating any component. Prefer adding variants over creating new components.

### Reuse Enforcement is Project-Type-Aware (2026-03-09)
**Source**: Developer report — 25+ duplicate components created because reuse checks only covered `**/components/**` and `**/ui/**` paths
**Rule**: Reuse detection MUST cover ALL reusable code, not just UI components.

**What counts as reusable (by project type):**
- **Frontend**: components, UI primitives, layouts, modals, widgets, shared feature code
- **Backend**: services, middleware, models, schemas, validators, routes, controllers, repositories
- **Universal**: utils, helpers, lib, shared, hooks, composables, API clients, types, constants

**Enforcement points (3 layers):**
1. **Explore phase** (Agent 1): Domain-keyword search — extract keywords from task title, search codebase for existing implementations BEFORE planning
2. **Reuse gate** (post-explore): If reuse candidates found with purpose overlap → STOP and ask user before proceeding to spec/implementation
3. **Standards gate** (post-implementation): `collectReuseCandidates()` catches anything missed

**Path configuration**: `config.componentReuse.patterns` (explicit override) or `config.componentReuse.extraPatterns` (additive). Defaults auto-detect from `config.projectType`.

### App-Map Completeness: Scan Before Write (2026-03-09)
**Source**: Developer report — 19 components missed across sessions, then 3 more missed during manual fix because AI relied on conversation context instead of filesystem
**Rule**: Before writing to `app-map.md`, ALWAYS run a filesystem scan first. Never reconstruct the component list from conversation memory alone.

**Required steps before any app-map.md write:**
1. Glob scan all source directories (e.g., `src/ui/*/`, `src/components/**/`, `src/pages/*/`, `src/modals/*/`, `src/layouts/*/`)
2. Compare scan results against current `app-map.md` entries
3. Add components present in filesystem but absent from app-map
4. Remove entries present in app-map but absent from filesystem

**Alternatively**: Run `/wogi-map-scan` which performs steps 1-4 automatically.

**Why**: Conversation context is incomplete — components from previous sessions are not in memory. Only a filesystem scan guarantees completeness.

### Variant Naming Convention
**Rule**: Use consistent variant names:
- Size: `sm`, `md`, `lg`, `xl`
- Intent: `primary`, `secondary`, `danger`, `success`, `warning`
- State: `default`, `hover`, `active`, `disabled`

---

## Coding Standards

### Security Patterns (2026-01-11)
**Source**: Session review findings

1. **File Read Safety**
   - Always wrap `fs.readFileSync()` in try-catch, even after `fileExists()` check
   - Reason: Race conditions, permission changes, symlink issues can still cause failures

2. **JSON Parsing Safety**
   - Use `safeJsonParse()` from flow-utils.js instead of raw `JSON.parse()`
   - Validate parsed structure has expected fields before use
   - Check for `__proto__`, `constructor`, `prototype` injection

3. **Template Substitution Safety**
   - Block access to `__proto__`, `constructor`, `prototype` keys
   - Use `Object.prototype.hasOwnProperty.call()` for property access
   - Example: See `applyTemplate()` in flow-prompt-composer.js

4. **Path Safety**
   - Validate patterns before `path.join()` with user/config data
   - Use `isPathWithinProject()` for defense-in-depth
   - Glob-to-regex: Use `[^/]*` not `.*` to prevent path separator matching

5. **Module Dependencies**
   - Check for circular dependencies when refactoring shared functions
   - Node.js handles circular deps but can cause undefined exports during load

### Code Quality Patterns (2026-01-12)
**Source**: Session review findings

1. **Catch Block Variable Naming**
   - **Standard**: Use `err` for all catch blocks in this codebase
   - Avoid: `e`, `error`, `ex`, `exception` - these cause confusion with loop variables
   - Example: `catch (err) { console.error(err.message); }`
   - Bad: `arr.map(e => e.value)` inside a `catch (err)` block using `e.message` (typo!)
   - Reason: Standardizing on `err` prevents mix-ups with iterator variables like `e`

2. **Single Source of Truth for Constants**
   - Avoid duplicating model/configuration objects across files
   - Import from one canonical location instead
   - Example: `getModelContextPreferences()` in flow-instruction-richness.js
   - Reason: Prevents drift and makes updates simpler

3. **Named Constants for Magic Numbers**
   - Define constants for threshold values, percentages, limits
   - Example: `COVERAGE_THRESHOLDS = { default: 0.7, comprehensive: 0.85, concise: 0.5 }`
   - Reason: Self-documenting code, easier maintenance

---

## UI/UX Decisions

<!-- Add UI/UX decisions here -->

---

## Architecture Decisions

### Quality Gates Must Be Wired, Not Placeholders (2026-03-09)
**Source**: Two projects shipped with unresolved MUST_FIX findings because quality gates fell through to "manual check" instead of calling existing verifier modules.
**Rule**: Every gate listed in `config.qualityGates` MUST have an automated implementation in `flow-done.js`. No gate may fall through to "manual check" if a verifier module exists.

**Enforcement points:**
1. `integrationWiring` gate → calls `verifyWiring()` from `flow-wiring-verifier.js`
2. `standardsCompliance` gate → calls `runTaskStandardsCheck()` from `flow-standards-gate.js`
3. `outstandingFindings` gate → reads `last-review.json` for unresolved critical/high findings
4. `preRelease` gate → checks outstanding findings + lint + typecheck before releases

**Task types MUST have gates:**
- `chore` tasks require: `requestLogEntry`, `outstandingFindings`
- `release` tasks require: `requestLogEntry`, `outstandingFindings`, `preRelease`
- No task type should default to zero gates (fail-open)

**Why**: Verifier modules existed for wiring and standards checking but were never called from the quality gate loop. Tasks completed "successfully" with known MUST_FIX findings because `chore` type had no gate definition, defaulting to the `feature` gates which also fell through to manual check.

### hasActiveTask() Removal from Routing Gate (2026-03-09)
**Source**: Code review finding — hasActiveTask() bypass allowed skipping /wogi-start
**Rule**: The routing gate MUST NOT check hasActiveTask() to skip or auto-clear the routing-pending flag.

**Rationale**: Two bypass vectors existed:
1. `setRoutingPending()` skipped setting the flag when an in-progress task existed
2. `checkRoutingGate()` auto-cleared the flag when an in-progress task existed

Both violated CLAUDE.md's rule: "Continue where we left off still requires /wogi-start." Every new user message must route through a /wogi-* command regardless of active tasks.

**Additionally**: `hasActiveTask()` now returns `false` on error (fail-closed) instead of `true` (fail-open), preventing corrupted ready.json from creating a false bypass signal.

### Subagent Model Selection Policy (2026-02-18)
**Source**: User decision — use Sonnet 4.6 to reduce costs where Opus isn't needed
**Rule**: When spawning Task tool subagents, prefer `model: "sonnet"` for routine work. Only use Opus for tasks requiring deep reasoning.

**Use Sonnet 4.6 for:**
- Explore agents (file searches, codebase exploration)
- Bash agents (running commands, git operations)
- Routine code edits and single-file fixes
- Code reviews of small/medium changes
- Documentation tasks
- Straightforward feature implementation

**Keep Opus 4.6 for:**
- Architecture planning and complex multi-file refactors
- Ambiguous requirements needing judgment and clarification
- Deep debugging and root cause analysis
- Long-context reasoning across many files (Opus scores 76% vs 18.5% on long-context retrieval)
- Multi-agent coordination
- Expert-level reasoning (GPQA: Opus 91.3% vs Sonnet 74.1%)

**Rationale**: Sonnet 4.6 scores within 1.2% of Opus on SWE-bench at 1/5th the cost ($3/$15 vs $15/$75 per 1M tokens). Opus orchestrates and catches gaps.

### Dual-Repo Architecture (2026-02-28)
**Source**: User directive — formalize dual-repo management for wogi-flow + wogiflow-cloud
**Rule**: Two repos, independent versions, mutual version awareness. OSS (`wogi-flow` / npm `wogiflow`) and Cloud (`wogiflow-cloud` / `@wogiflow/teams`) are separate packages with separate release cycles.

**Key constraints:**
1. **No teams code in the free repo** — all team logic lives in `wogiflow-cloud`. The free repo provides extension points only.
2. **Independent semver** — each repo versions independently. The client declares compatibility via peerDependencies (`wogiflow >= X.Y.Z`).
3. **Cross-repo version file** — each repo maintains `.workflow/state/partner-versions.json` recording the other's last-known version. Updated on every release.
4. **OSS releases first** — if cloud needs a new OSS feature/export, release OSS first, then cloud.
5. **Interface contract** — exported functions, hook interfaces, state file formats, and config keys used by cloud are documented in `.claude/rules/architecture/dual-repo-management.md`. Changes to these require updating the cloud client.

**Verification**: Before releasing either repo, check `partner-versions.json` and grep the other repo for consumers of changed interfaces.

### WebMCP Integration (2026-02-19)
**Source**: Epic epic-webmcp — full replacement of Playwright/Chrome browser testing
**Rule**: Use WebMCP (W3C `navigator.modelContext` API) for all browser interaction. Old Playwright/Chrome extension code has been removed.

**Key files**:
- `.claude/commands/wogi-debug-browser.md` — WebMCP-powered debugging
- `.claude/commands/wogi-test-browser.md` — WebMCP-powered test flows
- `scripts/flow-webmcp-generator.js` — Auto-generates WebMCP tool definitions from components

**Pattern**: When user reports a UI issue, suggest `/wogi-debug-browser`. Do NOT reference Playwright, Chrome extension, or screenshot-based testing.

### AI Catalog & Context7 Integration (2026-02-18)
**Source**: Skill generation pipeline implementation
**Rule**: When generating skills for detected frameworks, use a two-source pipeline:
1. **skills.sh** (preferred): `npx skills add <framework> --agent claude-code`
2. **Context7** (fallback): Fetch docs via MCP `resolve-library-id` + `get-library-docs`

**Config**: `config.skillGeneration.sources` controls priority and enablement.

### Try-Catch File Reads (Promoted 2026-02-19)
**Source**: 4+ occurrences in feedback-patterns.md
**Problem**: `fs.readFileSync()` called without try-catch, even after `fs.existsSync()` check. Race conditions and permission changes can cause failures.
**Rule**: ALWAYS wrap `fs.readFileSync()` in try-catch. Use `safeJsonParse()` from flow-utils.js for JSON files.
**Verification**: Search for bare `readFileSync` without surrounding try-catch during code review.

---

## Task ID Convention

### Task ID Naming Convention (2026-02-22)
**Source**: 20+ violations — AI created descriptive IDs like `wf-skill-overhaul` instead of hash-based IDs
**Origin**: wf-7129cf56
**Problem**: AI manually typed descriptive task IDs instead of using `generateTaskId()` from flow-utils.js. Descriptive IDs fail `validateTaskId()` (strict regex `/^wf-[a-f0-9]{8}$/i`), break sub-task numbering (`wf-XXXXXXXX-NN`), and are inconsistent with the system design.
**Rule**: All task IDs MUST be generated by `generateTaskId()` from flow-utils.js. Never manually type a task ID. Format: `wf-[8 lowercase hex chars]`. Descriptive names go in the `title` field, not the `id` field.
**Verification**:
1. Every new task ID must pass `validateTaskId()` — regex: `/^wf-[a-f0-9]{8}$/i`
2. Check that no task in ready.json has an ID containing letters beyond a-f
3. Sub-task IDs follow `wf-XXXXXXXX-NN` format (parent must be hex)
**Example**:
  - WRONG: `wf-skill-overhaul`, `wf-manifest-wiring`, `wf-schema-registry`
  - RIGHT: `wf-ebc4759e`, `wf-927db36d`, `wf-65ea1bdb`

### Mandatory Workflow Routing (2026-02-22)
**Source**: AI launched Task agent directly for research without routing through `/wogi-*` command
**Origin**: wf-7129cf56
**Problem**: The AI bypassed the mandatory `/wogi-start` routing by launching a Task agent directly to research task ID usage. This violates the core WogiFlow principle that ALL work must be tracked through `/wogi-*` commands. The bypass was detected by the user, not by the system.
**Rule**: The AI agent MUST NEVER launch Task agents, read files, or perform any action in response to a user request without first routing through a `/wogi-*` command. Even research questions go through `/wogi-research`. Even simple explorations go through `/wogi-start`. There are zero exemptions. If you find yourself thinking "this is just a quick lookup, I can skip the workflow" — that thought is the exact bypass this rule exists to prevent.
**Verification**:
1. Every user message must be routed through a `/wogi-*` command before any tool calls
2. The Skill tool must be invoked before any Task, Read, Grep, or Glob tool on a new user request
3. If the Natural Language Detection table matches → use that specific command
4. If no match → route through `/wogi-start` as the universal fallback
**Example**:
  - WRONG: User asks "how is the task ID used?" → AI launches Task agent directly
  - RIGHT: User asks "how is the task ID used?" → AI invokes `/wogi-start "how is the task ID used?"` → wogi-start routes to research

### Session Continuation Is NOT Routing Bypass (2026-02-27)
**Source**: AI bypassed routing after session continuation in another project — direct user report
**Origin**: wf-2b1ab455
**Problem**: When a session auto-continues with "Continue with the last task" or resumes from context compaction, the AI rationalizes that "continuing" prior work grants implicit permission to skip `/wogi-start`. It goes into autopilot — directly editing ready.json and state files to create fake tasks, then editing code files without routing. This produces untracked, inconsistent work and wastes tokens.
**Rule**: Session continuation, context resumption, and "continue where we left off" are NEVER implicit routing bypass. Every session start requires `/wogi-start` routing before any tool use. There are zero exceptions:
- "Continue with the last task" → still requires `/wogi-start`
- "Pick up where we left off" → still requires `/wogi-start`
- Resuming from compacted context → still requires `/wogi-start`
- Having compressed memory of prior work → still requires `/wogi-start`
- Knowing the answer from context → still requires `/wogi-start`
**Enforcement**: The routing gate now blocks Edit, Write, and NotebookEdit in addition to Read, Glob, Grep, Bash, and EnterPlanMode. SessionStart hook sets routing-pending flag as defense-in-depth. The AI cannot manually edit ready.json to create tasks — that path is now blocked by the routing gate.
**Verification**:
1. After session start or continuation, check that the FIRST tool call is Skill(skill="wogi-start")
2. Any Edit/Write call before routing should be blocked by the PreToolUse hook
3. Any attempt to edit .workflow/state/ready.json before routing should be blocked
**Example**:
  - WRONG: Session continues → AI reads context summary → AI edits ready.json directly → AI starts coding
  - RIGHT: Session continues → AI invokes Skill(skill="wogi-start", args="continue wf-XXXXXXXX") → routing gate clears → normal execution

---

## File/Folder Structure

<!-- Add structure rules here -->

---

## Continuous Learning Protocol (2026-01-30)

**Source**: User feedback - the learning system exists but wasn't being used
**Priority**: CRITICAL - This is the core purpose of WogiFlow

The user installed WogiFlow so the AI learns from mistakes and improves over time. This requires THREE mandatory behaviors:

---

### Part 1: Pre-Task Pattern Check (BEFORE starting any work)

**Before starting ANY task**, check for known issues:

```
1. Read feedback-patterns.md
   → Look for patterns related to this type of task
   → Check "Pending Patterns" section for recent issues

2. Read relevant sections of decisions.md
   → Search for rules related to this task type
   → Check if there are documented procedures to follow

3. Check corrections/ directory
   → Look for recent corrections in this area
   → Learn from past mistakes before repeating them
```

**Example**: Before doing a release:
- Check feedback-patterns.md for "release" patterns → Found: "Release Process Failure"
- Check decisions.md for release procedures → Found: "GitHub Release Workflow"
- Follow the documented procedure instead of improvising

**If you skip this check and make a preventable mistake, that's a learning system failure.**

---

### Part 2: Post-Failure Capture (AFTER any failure occurs)

**When ANY of these happen, you MUST capture the learning:**

| Failure Type | Examples |
|--------------|----------|
| **Code error** | Bug introduced, tests fail, lint errors |
| **Process error** | Skipped step, wrong order, forgot requirement |
| **Judgment error** | Wrong assumption, misunderstood requirement |
| **Tool error** | Used wrong command, wrong flags, race condition |
| **Knowledge gap** | Didn't know about existing component/pattern |
| **Verification skip** | Claimed done without checking |

**Capture process:**

```
1. STOP - Don't just fix it and move on

2. DIAGNOSE - Ask yourself:
   - What exactly went wrong?
   - What did I do (or not do) that caused this?
   - What should I have done instead?
   - Was there a learning file I should have checked first?
   - Is this the first time, or has this happened before?

3. RECORD - Add to feedback-patterns.md:
   | Date | Pattern | Description | Count | Action |
   |------|---------|-------------|-------|--------|
   | [today] | [short-name] | [what went wrong and why] | 1 | Monitor |

4. If this is a REPEATED issue (count >= 3):
   → Create a rule in decisions.md
   → Mark pattern as PROMOTED in feedback-patterns.md
   → The rule must include VERIFICATION STEPS
```

**Self-diagnosis questions to ask after every failure:**

1. "Did I check feedback-patterns.md before starting?" → If no, that's the root cause
2. "Did I check decisions.md for existing rules?" → If no, that's the root cause
3. "Did I follow the documented procedure?" → If no, why not?
4. "Did I verify my work before claiming done?" → If no, add verification
5. "Is there a pattern here I've seen before?" → If yes, it needs a rule

---

### Part 3: Pattern Promotion (Learning Loop)

**When the same failure happens 3+ times:**

```
Pattern Count Reaches 3
    ↓
Create Rule in decisions.md:
    - Clear description of what to do/not do
    - WHY this matters (the failures it prevents)
    - VERIFICATION steps to confirm compliance
    - Examples of correct vs incorrect behavior
    ↓
Mark as PROMOTED in feedback-patterns.md
    ↓
Future sessions will see the rule and follow it
```

**Rule template:**
```markdown
### [Rule Name] (YYYY-MM-DD)
**Source**: [X] failures recorded in feedback-patterns.md
**Problem**: [What kept going wrong]
**Rule**: [What to do instead]
**Verification**: [How to check you followed the rule]
**Example**:
  - WRONG: [what was happening]
  - RIGHT: [what should happen]
```

---

### Part 4: User Frustration Detection (Escalation)

**When the user expresses frustration about repeated issues:**

Phrases that indicate this:
- "This keeps happening"
- "I told you this before"
- "You keep forgetting X"
- "How many times..."
- "This failed again"
- Any tone of frustration about repetition

**Required response:**

1. **Acknowledge** - Don't be defensive
2. **Investigate** - Check learning files for what should have been known
3. **Diagnose** - Why wasn't the learning system used?
4. **Fix** - Create/strengthen the rule
5. **Verify** - Test that the fix works

**This is an escalation** - it means Parts 1-3 failed. Treat it seriously.

---

### Types of Failures to Track

| Category | Examples | Capture? |
|----------|----------|----------|
| **Process failures** | Skipped steps, wrong order, forgot verification | YES |
| **Code bugs** | Logic errors, missing error handling, race conditions | YES |
| **Knowledge gaps** | Didn't know about existing component, pattern, or rule | YES |
| **Assumption errors** | Made assumption without verifying | YES |
| **Tool misuse** | Wrong command, wrong flags, wrong sequence | YES |
| **Scope creep** | Did more than asked, changed unrelated code | YES |
| **Communication** | Misunderstood requirement, didn't ask clarifying question | YES |
| **Verification skips** | Claimed done without testing, didn't check output | YES |

---

### Why This Matters

The user installed WogiFlow specifically for these benefits:
- **Accountability**: Every mistake is tracked and learned from
- **Improvement**: The AI gets better over time, not worse
- **Trust**: The user can rely on the AI to not repeat mistakes
- **Efficiency**: Less time spent on preventable errors

**When you skip the learning system:**
- You repeat mistakes that were already solved
- The user loses trust
- The learning files become useless
- WogiFlow's core value proposition fails

**The learning system only works if you USE it.**

---

## Task Sizing

### Story Size Validation (2026-02-06)
**Source**: Epic misclassified as single story (wf-a29aa0a3 created as L1 with 20 files)
**Problem**: `/wogi-story` creates stories without checking if the request exceeds story-level scope. The size assessment table in CLAUDE.md was skipped.

**Rule**: Before creating ANY story via `/wogi-story`, count the expected files and distinct concern areas:

| Files | Concerns | Level | Action |
|-------|----------|-------|--------|
| 1-5   | 1        | L2 Task | Create story, proceed |
| 5-15  | 1-3      | L1 Story | Create story with AC, get approval |
| 15+   | 3+       | L0 Epic | **STOP** - decompose into stories first |

**Verification checklist** (before writing the story):
1. List all files that will be changed
2. Count distinct areas of concern (e.g., hooks, agents, config, security)
3. If files > 15 OR concerns > 3 → Route to epic decomposition instead
4. If borderline (10-15 files, 2-3 concerns) → Ask user preference

**Example**:
- WRONG: Create single story "Adapt to CC 2.1.33" touching 20 files across 6 areas
- RIGHT: Create epic with 4 stories: hooks (7 files), agents (11 files), permissions (1 file), skills (2 files)

---

## Operational Procedures

### GitHub Release Workflow (2026-01-30)
**Source**: Repeated failures (10+ times) in npm publish automation
**Priority**: Critical - prevents wasted releases and broken npm versions

**Problem**: Running `git push` followed immediately by `gh release create` causes a race condition. The release tag gets created on the remote's HEAD before the push fully propagates, pointing to an old commit.

**Correct Procedure**:
```bash
# 1. Push commits first
git push origin master

# 2. Create tag LOCALLY on the correct commit
git tag vX.Y.Z HEAD

# 3. Push the tag explicitly
git push origin vX.Y.Z

# 4. THEN create the release (it will use the existing tag)
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

**NEVER do this**:
```bash
# BAD - race condition, tag may point to wrong commit
git push origin master && gh release create vX.Y.Z ...
```

**If a release fails**:
1. Delete the bad release: `gh release delete vX.Y.Z --yes`
2. Delete the bad remote tag: `git push origin --delete vX.Y.Z`
3. Delete local tag if exists: `git tag -d vX.Y.Z`
4. Follow the correct procedure above

**After release, publish to npm**:
```bash
# 5. Publish to npm (after release is created)
npm publish
```

**Verification**: Check that `git show vX.Y.Z` shows the expected commit with the correct package.json version. After npm publish, verify with `npm view wogiflow version`.

---

## Hybrid Mode (Multi-Model Execution)

### When to Use Hybrid vs Direct Execution (2026-02-23)
**Source**: Hybrid mode overhaul (wf-dc55c22b)
**Rule**: Use hybrid mode for tasks where cheaper models can execute with sufficient quality. Keep direct Opus execution for tasks requiring deep reasoning.

**Use hybrid for:**
- Simple file edits (typos, config changes, text updates) → cheapest tier
- Straightforward code generation (new components following established patterns) → mid-tier
- Documentation updates (README, comments, docs) → cheapest tier
- Test generation (following existing test patterns) → mid-tier

**Keep on Opus (don't delegate):**
- Complex multi-file refactoring
- Architecture decisions or design changes
- Tasks requiring understanding of cross-cutting concerns
- Debugging with unclear root cause
- Tasks with ambiguous requirements needing judgment

### Model Selection Guidelines (2026-02-23)
**Source**: Hybrid mode overhaul (wf-dc55c22b)
**Rule**: Select executor model based on task type using the routing table in `config.json → hybrid.routing`:

| Task Type | Model Tier | Rationale |
|-----------|-----------|-----------|
| simple-edit | cheapest | Minimal reasoning needed, pattern-based |
| code-generation | mid-tier | Needs code understanding but follows patterns |
| documentation | cheapest | Text generation with low complexity |
| refactoring | planner | Keep on Opus — too complex to delegate |

**Tier resolution**: Pick the first available model from the tier's model list. If no models available → escalate to next tier.

### Failure Escalation (2026-02-23)
**Source**: Hybrid mode overhaul (wf-dc55c22b)
**Rule**: When an executor model fails:
1. **First failure**: Retry with enhanced context (add more examples, patterns, constraints)
2. **Second failure**: Retry with a higher-tier model
3. **Third failure**: Escalate to Opus — the task is too complex for the executor

**Never**: Retry more than 3 times with the same model. Never silently skip a failed step.

### Hybrid Security (2026-02-23)
**Source**: Hybrid mode overhaul (wf-dc55c22b)
**Rule**: Security rules for multi-model execution:
- **Local LLMs**: Code never leaves the machine. Safe for proprietary code.
- **Cloud models**: API keys stored in environment variables, never committed to git.
- **Plan content**: Execution plans may contain file paths and code snippets. Plans are stored locally in `.workflow/state/current-plan.json` (gitignored).
- **No secret delegation**: Never include API keys, passwords, or secrets in execution plans sent to executor models.

---

## Memory Boundary

### Auto-Memory Boundary Enforcement (2026-02-26)
**Source**: User directive — agents occasionally ignore soft guidance; this must be mechanically enforced
**Origin**: wf-939ec61b
**Problem**: Claude Code auto-memory (`MEMORY.md`) persists across sessions outside WogiFlow's managed learning system. Agents may read stale auto-memory entries that contradict actively-maintained `.workflow/state/` files, causing incorrect behavior. Without enforcement, agents blend auto-memory with state files instead of treating state files as canonical.
**Rule**: `.workflow/state/` files are the SINGLE source of truth. When auto-memory conflicts with any state file, the state file wins unconditionally. Auto-memory may ONLY contain: user preferences, high-level architectural decisions, workflow style preferences. Auto-memory must NEVER contain: coding patterns, component knowledge, task history, bug patterns, function/API registries, or any information that belongs in `.workflow/state/`.
**Verification**:
1. Before acting on any information from MEMORY.md, cross-check against `decisions.md` and other relevant state files
2. If a conflict is found, follow the state file and disregard auto-memory
3. When learning new patterns or rules, write them to the appropriate `.workflow/state/` file — never to MEMORY.md
4. During code review, flag any instance where auto-memory content duplicates or contradicts state files
**Example**:
  - WRONG: MEMORY.md says "use camelCase for files" but decisions.md says "use kebab-case" — agent follows MEMORY.md
  - RIGHT: Agent detects the conflict, follows decisions.md (kebab-case), ignores MEMORY.md, and optionally removes the stale auto-memory entry

---

## Review & Cleanup Procedures

<!-- Project-specific review procedures go here -->

---

### 2026-01-02

Use kebab-case for all file names in this project

