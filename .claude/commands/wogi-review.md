Comprehensive code review with verification gates, AI analysis, and **STRICT project standards enforcement** (v4.0).

Auto-detects when to use multi-pass (4 sequential passes) vs parallel (3 agents) based on file count and security patterns. Includes mandatory standards compliance check that BLOCKS completion if project conventions are violated.

**Triggers**: `/wogi-review`, `/wogi-session-review`, "please review", "review what we did", "code review"

## Usage

```bash
/wogi-review                  # Full review (auto-detects if multipass needed)
/wogi-review --commits 3      # Include last 3 commits
/wogi-review --staged         # Only staged changes
/wogi-review --skip-verify    # Skip verification gates (AI only)
/wogi-review --verify-only    # Only run verification gates
/wogi-review --multipass      # Force multi-pass review mode
/wogi-review --no-multipass   # Disable auto multi-pass detection
/wogi-review --skip-standards     # Skip project standards compliance check
/wogi-review --skip-optimization  # Skip solution optimization suggestions
```

## Review Phases (v4.0)

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-review                                                │
├─────────────────────────────────────────────────────────────┤
│  Phase 1: Verification Gates                                 │
│     → Spec verification, lint, typecheck, tests              │
│                                                              │
│  Phase 2: AI Review (multi-pass or parallel)                 │
│     → Code/Logic, Security, Architecture analysis            │
│                                                              │
│  Phase 3: Standards Compliance [STRICT]                      │
│     → decisions.md, app-map.md, naming-conventions.md        │
│     → BLOCKS completion if violations found                  │
│                                                              │
│  Phase 4: Solution Optimization [NON-BLOCKING]               │
│     → Technical alternatives, UX improvements                │
│     → Suggestions only - not violations                      │
│                                                              │
│  Phase 5: Post-Review Workflow                               │
│     → Fix loop, learning, task creation                      │
└─────────────────────────────────────────────────────────────┘
```

## Review Modes

### Parallel Mode
Runs 3 AI agents simultaneously for faster results. Used for simple reviews.

### Multi-Pass Mode (Auto-Enabled)
Runs 4 sequential passes with context isolation. **Auto-enabled when:**
- 5+ files changed
- Security-sensitive files detected (auth, credential, .env)
- Security patterns in content (password, token, secret, etc.)
- API/service files detected

Best for thorough reviews:

```
Pass 1: Structure (Haiku)      → File organization, naming, anti-patterns
Pass 2: Logic (Sonnet)         → Business logic, edge cases
Pass 3: Security (Sonnet)*     → OWASP, injection, credentials
Pass 4: Integration (Sonnet)*  → Breaking changes, contracts

* = Conditional - only runs if patterns detected
```

Multi-pass advantages:
- Each pass starts with fresh context (no bias from previous findings)
- Later passes can focus on files flagged by earlier passes
- Early exit on critical issues saves resources
- Better for large codebases or security-sensitive changes

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-review                                                │
├─────────────────────────────────────────────────────────────┤
│  1. Identify changed files (git diff)                        │
│  2. VERIFY: Run verification gates                           │
│     → Spec verification (all deliverables exist?)            │
│     → Lint, typecheck, test checks                           │
│  3. CHECK: Should multi-pass be enabled?                     │
│     → 5+ files? Security files? API files? → YES = multi-pass│
│     → Otherwise → NO = parallel mode                         │
│  4. REVIEW:                                                  │
│     IF multi-pass: Run 4 sequential passes                   │
│        Pass 1: Structure (Haiku) → Pass 2: Logic (Sonnet)    │
│        Pass 3: Security (Sonnet) → Pass 4: Integration       │
│     ELSE: Launch 3 parallel AI agents                        │
│  5. Consolidate results into single report                   │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Verification Gates

Run automated tools first to catch obvious issues quickly:

### Spec Verification (if task has spec)

If reviewing a task with a spec file, run spec verification FIRST:

```bash
node scripts/flow-spec-verifier.js verify wf-XXXXXXXX
```

This ensures all files promised in the spec actually exist before reviewing code quality.

### Standard Verification Gates

```bash
# Run configured verification commands
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50  # If tests exist
```

**Output:**
```
═══════════════════════════════════════
VERIFICATION GATES
═══════════════════════════════════════
✓ Spec: 5/5 deliverables exist
✓ Lint: passed
✗ TypeCheck: 2 errors
  → src/utils.ts:45 - Property 'x' does not exist
  → src/api.ts:12 - Type 'string' not assignable to 'number'
✓ Tests: 15/15 passed

Gate Summary: 1 failed (typecheck)
```

If spec verification or critical gate failures exist, report them immediately before AI review.

## Phase 2: AI Review (Dynamic Agent System)

Review agents are organized in three tiers: **core** (always run), **optional** (configurable), and **project-rules** (auto-generated from decisions.md).

**Config**: Controlled by `config.review.agents`:
```json
{
  "review": {
    "agents": {
      "core": ["code-logic", "security", "architecture"],
      "optional": ["performance"],
      "projectRules": true,
      "projectRulesSource": "decisions.md",
      "maxParallelAgents": 6
    }
  }
}
```

Setting `projectRules: false` gives the legacy 3-agent behavior.

### Core Agents (Always Run)

#### Agent: Code & Logic Review
Launch a Task agent with subagent_type=Explore focusing on:
- **Code Quality**: Naming conventions, readability, structure
- **Logic Correctness**: Algorithm correctness, edge case handling
- **DRY Violations**: Duplicated logic that should be extracted
- **Error Handling**: Are errors caught and handled appropriately?
- **Code Smells**: Long methods, deep nesting, magic numbers

Prompt template:
```
Review the following files for code quality and logic issues:
[FILE_LIST]

Check for:
1. Naming conventions - are names clear and consistent?
2. Logic correctness - any bugs or edge cases missed?
3. DRY violations - any duplicated code?
4. Error handling - are errors handled appropriately?
5. Code smells - long methods, deep nesting, magic numbers?

For each issue found, report as JSON:
{ "id": "finding-NNN", "file": "path", "line": N, "type": "quality|logic|dry|error|smell",
  "severity": "critical|high|medium|low", "category": "code-logic",
  "issue": "...", "recommendation": "...", "autoFixable": true|false,
  "agent": "code-logic" }
```

#### Agent: Security Review
Launch a Task agent with subagent_type=Explore focusing on:
- **Input Validation**: User inputs sanitized?
- **Authentication/Authorization**: Proper access controls?
- **Injection Risks**: SQL, XSS, command injection?
- **Sensitive Data**: Passwords, tokens, PII exposed?
- **Error Messages**: Do errors leak sensitive info?

Refer to `.workflow/agents/security.md` for OWASP Top 10 checklist.

Prompt template:
```
Security review of the following files:
[FILE_LIST]

Check for OWASP Top 10 vulnerabilities:
1. Injection (SQL, XSS, command injection)
2. Broken authentication
3. Sensitive data exposure
4. Security misconfiguration
5. Insufficient input validation

For each issue found, report as JSON:
{ "id": "finding-NNN", "file": "path", "line": N, "type": "vulnerability-type",
  "severity": "critical|high|medium|low", "category": "security",
  "issue": "...", "recommendation": "...", "autoFixable": true|false,
  "agent": "security" }
```

#### Agent: Architecture & Conflicts
Launch a Task agent with subagent_type=Explore focusing on:
- **Component Reuse**: Check `app-map.md` for existing components
- **Pattern Consistency**: Check `decisions.md` for coding patterns
- **Redundancies**: Similar implementations that could be consolidated
- **Conflicts**: Code that contradicts existing implementations
- **Dead Code**: Unused imports, variables, unreachable code

Prompt template:
```
Architecture review of the following files:
[FILE_LIST]

Check:
1. Read app-map.md - are there existing components that should be reused?
2. Read decisions.md - do changes follow established patterns?
3. Look for redundant implementations across the codebase
4. Look for conflicting code (different approaches to same problem)
5. Find dead code (unused imports, variables, unreachable code)

For each issue found, report as JSON:
{ "id": "finding-NNN", "file": "path", "line": N, "type": "reuse|pattern|redundancy|conflict|dead-code",
  "severity": "critical|high|medium|low", "category": "architecture",
  "issue": "...", "recommendation": "...", "autoFixable": true|false,
  "agent": "architecture" }
```

### Optional Agents (Configurable)

Optional agents run when listed in `config.review.agents.optional`.

#### Agent: Performance Review

Enabled when `"performance"` is in `config.review.agents.optional`.

Refer to `.workflow/agents/performance.md` for the full checklist.

Launch a Task agent with subagent_type=Explore:
```
Performance review of the following files:
[FILE_LIST]

Check for:
1. N+1 query patterns (loop with individual DB/API calls inside)
2. Blocking I/O in async contexts
3. Memory leaks (event listeners not cleaned up, large objects retained)
4. Sequential awaits that could be Promise.all
5. Large bundle imports when a small utility suffices
6. Missing memoization for expensive computations

For each issue found, report as JSON:
{ "id": "finding-NNN", "file": "path", "line": N, "type": "n-plus-1|blocking-io|memory-leak|sequential-await|bundle-size|memoization",
  "severity": "critical|high|medium|low", "category": "performance",
  "issue": "...", "recommendation": "...", "autoFixable": true|false,
  "agent": "performance" }
```

### Project-Rules Agents (Auto-Generated from decisions.md)

When `config.review.agents.projectRules` is `true`, additional agents are **automatically generated** from project rules:

**How it works:**

1. Before launching review agents, **read `decisions.md`**
2. Parse section headers (e.g., "## Component Architecture", "## Coding Standards")
3. For each category with substantive rules (at least 2 non-empty lines of actual rules), create a focused agent
4. Skip empty categories or headers without actionable rules

**For each qualifying category**, launch a Task agent with subagent_type=Explore:

```
Project Standards Review: [CATEGORY_NAME]

Review these files against these specific project rules:

---
[RULES EXTRACTED FROM decisions.md SECTION]
---

Files to review:
[FILE_LIST]

For each violation:
- File and line number
- Which rule was violated (quote the exact rule text)
- Severity: MUST_FIX (explicit mandate in the rule) or SUGGESTION (best practice)

Report as JSON:
{ "file": "path", "line": N, "type": "project-rule-violation",
  "severity": "high|medium", "issue": "...", "recommendation": "...",
  "rule": "quoted rule text", "category": "[CATEGORY_NAME]",
  "agent": "project-rules-[category-slug]" }
```

**Agent cap**: Total agents (core + optional + project-rules) is limited by `maxParallelAgents` (default: 6). If there are more project-rules categories than available slots, prioritize categories matching changed file types (e.g., "Security Patterns" for security-related files).

**Example**: If decisions.md has sections "Component Architecture", "Coding Standards", and "UI/UX Decisions" (empty), the review would launch:
- 3 core agents (code-logic, security, architecture)
- 1 optional agent (performance)
- 2 project-rules agents (Component Architecture, Coding Standards)
- Total: 6 agents (within limit)

## Execution Steps

When `/wogi-review` is invoked:

1. **Get changed files**:
   ```bash
   git diff --name-only HEAD  # Unstaged
   git diff --name-only --staged  # Staged
   git diff --name-only HEAD~N HEAD  # If --commits N specified
   ```

2. **Run verification gates** (unless --skip-verify):
   - **Spec verification** (if task has spec file) - verify all deliverables exist
   - Lint check
   - TypeScript type check
   - Test run (if configured)
   - Report any failures immediately (spec failures are blockers)

3. **Check if multi-pass should be auto-enabled** (unless --no-multipass):

   Auto-enable multi-pass if ANY of these conditions are met:
   - `--multipass` flag is provided
   - 5+ files changed
   - Any security-sensitive files (auth, credential, .env, security)
   - Security patterns detected in content (password, token, secret, api_key)
   - API/service files detected (*.api.ts, *.service.ts, /api/, /routes/)

   **If multi-pass is triggered**: Skip to "Multi-Pass Mode Execution" section below.

   **If parallel mode**: Continue with step 4.

4. **Determine agent lineup**:
   - Start with core agents from `config.review.agents.core` (default: code-logic, security, architecture)
   - Add optional agents from `config.review.agents.optional` (e.g., performance)
   - If `config.review.agents.projectRules` is true:
     - Read `decisions.md` using section-resolver PIN system for targeted parsing (avoids expensive full-file parsing for large decisions.md files)
     - For each category with substantive rules, create a project-rules agent
     - Cap total agents at `config.review.agents.maxParallelAgents` (default: 6)

5. **Launch all agents in parallel** (single message with N Task tool calls, subagent_type=Explore)

6. **Wait for all agents to complete**

7. **Persist findings to `.workflow/state/last-review.json`**:
   ```json
   {
     "reviewDate": "ISO-8601 timestamp",
     "mode": "parallel|multi-pass",
     "filesReviewed": ["path/to/file1.ts", "..."],
     "findings": [
       {
         "id": "finding-001",
         "severity": "critical|high|medium|low",
         "category": "quality|security|architecture|performance|project-rule",
         "file": "path/to/file.ts",
         "line": 45,
         "issue": "Description of the issue",
         "recommendation": "How to fix it",
         "autoFixable": false,
         "agent": "code-logic|security|architecture|performance|project-rules-[slug]"
       }
     ],
     "triaged": false
   }
   ```

8. **Consolidate and display results**:

```
╔══════════════════════════════════════════════════════════╗
║  Code Review                                              ║
╚══════════════════════════════════════════════════════════╝

Files Reviewed: N
  • path/to/file1.ts
  • path/to/file2.ts
  ...

═══════════════════════════════════════════════════════════
VERIFICATION GATES
═══════════════════════════════════════════════════════════
✓ Spec: 5/5 deliverables exist
✓ Lint: passed
✓ TypeCheck: passed
✓ Tests: 15/15 passed

═══════════════════════════════════════════════════════════
CODE & LOGIC REVIEW
═══════════════════════════════════════════════════════════
[Results from Agent 1]
✓ Good: [what's good]
⚠ Issue: [description] (file:line)

═══════════════════════════════════════════════════════════
SECURITY REVIEW
═══════════════════════════════════════════════════════════
[Results from Agent 2]
✓ Good: [what's secure]
⚠ Issue: [description] (file:line)

═══════════════════════════════════════════════════════════
ARCHITECTURE & CONFLICTS
═══════════════════════════════════════════════════════════
[Results from Agent 3]
✓ Good: [what follows patterns]
⚠ Issue: [description] (file:line)

═══════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════
Verification: 4/4 gates passed (spec, lint, typecheck, tests)
AI Review: N issues (X critical, Y high, Z medium, W low)

Top Recommendations:
1. [Most important fix]
2. [Second most important]
3. [Third most important]

Findings saved to: .workflow/state/last-review.json
Run /wogi-triage to walk through findings interactively.
```

## Multi-Pass Mode Execution

When multi-pass is triggered (auto-detected or via `--multipass`), execute **4 sequential passes** using Task agents. Each pass has fresh context and builds on previous findings.

**IMPORTANT**: Run passes SEQUENTIALLY, not in parallel. Each pass informs the next.

### Multi-Pass Execution Steps

1. **Get changed files** (same as parallel mode)

2. **Run verification gates** (same as parallel mode)

3. **Execute Pass 1: Structure** using Task agent (model=haiku for speed):

   Launch a Task agent with subagent_type=Explore, model=haiku:
   ```
   Analyze file structure and naming conventions for:
   [FILE_LIST]

   Check for:
   1. File naming conventions (kebab-case for files)
   2. Folder organization (components in components/, etc.)
   3. Anti-patterns from decisions.md
   4. Unused imports or dead code at top of files

   Return: List of files needing deeper review, structural issues found.
   ```

4. **Execute Pass 2: Logic** using Task agent (model=sonnet):

   Launch a Task agent with subagent_type=Explore focusing on files flagged by Pass 1:
   ```
   Deep logic review of:
   [FILES_FROM_PASS_1 or ALL_FILES if none flagged]

   Check for:
   1. Business logic correctness
   2. Edge cases and null checks
   3. Error handling patterns
   4. Async/await issues (missing await, unhandled promises)
   5. Race conditions

   Return: Logic issues with file:line, severity, and fix recommendation.
   ```

5. **Execute Pass 3: Security** (CONDITIONAL - only if security triggers detected):

   Skip if: No security-sensitive files AND no security patterns in content.

   Launch a Task agent with subagent_type=Explore:
   ```
   Security review of:
   [FILE_LIST]

   Check for OWASP Top 10:
   1. Injection (SQL, XSS, command injection)
   2. Broken authentication
   3. Sensitive data exposure (hardcoded secrets, tokens)
   4. Security misconfiguration
   5. Insufficient input validation

   Return: Vulnerabilities with severity, file:line, and remediation steps.
   ```

6. **Execute Pass 4: Integration** (CONDITIONAL - only if 5+ files OR API changes):

   Skip if: < 5 files AND no API/contract changes detected.

   Launch a Task agent with subagent_type=Explore:
   ```
   Integration review of:
   [FILE_LIST]

   Check for:
   1. Breaking API changes (function signatures, exports)
   2. Import/export mismatches
   3. Circular dependencies
   4. Type contract changes
   5. Cross-module state issues

   Return: Breaking changes, conflicts, and integration issues.
   ```

7. **Consolidate all pass results** into the multi-pass output format below.

### Legacy: CLI Module (Optional)

The pass modules in `scripts/flow-review-passes/` can also be used programmatically:

```javascript
const { runMultiPassReview } = require('./scripts/flow-review-passes');

const results = await runMultiPassReview({
  files: [{ path: 'src/api.ts', content: '...' }],
  config: {
    passes: ['structure', 'logic', 'security', 'integration'],
    earlyExitOnCritical: true,
    passForward: true
  }
});
```

### Multi-Pass Output Format

```
╔══════════════════════════════════════════════════════════╗
║  Multi-Pass Code Review                                   ║
╚══════════════════════════════════════════════════════════╝

Files Reviewed: N

═══════════════════════════════════════════════════════════
PASS 1: STRUCTURE [Haiku] ✓
═══════════════════════════════════════════════════════════
Duration: 2.3s | Files flagged: 3
• Naming issue: useGetData.ts should be use-get-data.ts
• Anti-pattern: console.log in production code (api.ts:45)

═══════════════════════════════════════════════════════════
PASS 2: LOGIC [Sonnet] ✓
═══════════════════════════════════════════════════════════
Duration: 5.1s | Issues: 2
• Missing null check: user.profile accessed without guard (user.ts:23)
• Async issue: Promise not awaited (api.ts:67)

═══════════════════════════════════════════════════════════
PASS 3: SECURITY [Sonnet] ✓
═══════════════════════════════════════════════════════════
Duration: 4.2s | Triggered by: API file detected
• No critical vulnerabilities found

═══════════════════════════════════════════════════════════
PASS 4: INTEGRATION [Sonnet] ⊘ SKIPPED
═══════════════════════════════════════════════════════════
Reason: < 5 files, no API contract changes

═══════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════
Passes: 3/4 executed (1 skipped)
Total Issues: 4 (0 critical, 1 high, 2 medium, 1 low)
```

### Pass Module API

The pass modules in `scripts/flow-review-passes/` can be used programmatically:

```javascript
const { runMultiPassReview } = require('./scripts/flow-review-passes');

const results = await runMultiPassReview({
  files: [{ path: 'src/api.ts', content: '...' }],
  config: {
    passes: ['structure', 'logic', 'security', 'integration'],
    earlyExitOnCritical: true,
    passForward: true  // Pass results to subsequent passes
  }
});
```

## Options

| Flag | Description |
|------|-------------|
| `--commits N` | Include last N commits in review scope |
| `--staged` | Only review staged changes |
| `--skip-verify` | Skip verification gates, AI review only |
| `--verify-only` | Only run verification gates, no AI review |
| `--security-only` | Only run security agent |
| `--quick` | Faster review with reduced thoroughness |
| `--multipass` | Use sequential multi-pass mode instead of parallel |
| `--no-early-exit` | Don't stop on critical issues (multi-pass only) |
| `--passes=<list>` | Specific passes to run (e.g., `structure,logic`) |

## When No Changes Found

If no changes are detected:
```
No changes found to review.

To review recent commits: /wogi-review --commits 3
To review specific files: Please stage them first with git add
```

## Phase 3: Standards Compliance (v4.0 - STRICT)

**This phase BLOCKS review completion if violations are found.** "All code must look like the same developer wrote it."

### What It Checks

| Source | What's Checked |
|--------|----------------|
| `decisions.md` | All documented coding rules and patterns |
| `app-map.md` | Component duplication (>80% similarity = violation) |
| `function-map.md` | Utility function duplication |
| `api-map.md` | API endpoint overlap |
| `naming-conventions.md` | File names (kebab-case), catch variables (`err` not `e`) |
| `security-patterns.md` | Raw JSON.parse, unprotected fs.readFileSync |

### Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 PROJECT STANDARDS COMPLIANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ decisions.md: passed
✗ app-map.md: Component duplication detected [MUST FIX]
   → Created: UserCard.tsx
   → Existing: ProfileCard.tsx (85% similar)
   → Fix: Add variant to ProfileCard instead

✓ function-map.md: passed
✓ api-map.md: passed
✗ naming-conventions: 1 violation [MUST FIX]
   → src/utils.ts:45 - Catch variable "e" should be "err"
   → Rule: naming-conventions.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 2 VIOLATIONS - Review blocked until fixed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Severity Levels

- **[MUST FIX]**: Blocks review. Must be resolved before completion.
- **[WARNING]**: Non-blocking but should be addressed.

### Skipping Standards Check

Use `--skip-standards` flag to bypass (not recommended):
```bash
/wogi-review --skip-standards
```

---

## Phase 4: Solution Optimization (v4.0 - NON-BLOCKING)

**This phase provides improvement suggestions - they are recommendations, NOT violations.**

Unlike Phase 3 (strict enforcement), Phase 4 suggests ways to make good code even better.

### What It Suggests

| Category | Patterns Detected |
|----------|-------------------|
| **Technical** | |
| Performance | filter+map chains, sequential awaits in loops |
| Modern JS | var usage, Promise chains vs async/await |
| Error handling | Empty catch blocks, generic error messages |
| React | Inline style objects, anonymous function props |
| **UX** | |
| Loading states | Async operations without visible feedback |
| Error messages | Technical errors shown to users |
| Accessibility | Missing alt attributes, click on div/span |
| Forms | Missing validation feedback, submit without disabled |

### Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 SOLUTION OPTIMIZATION SUGGESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 Technical (2):
   [Medium] Custom date formatting could use date-fns
      → utils/formatDate.ts reimplements existing library

   [Low] Array.filter().map() could be Array.reduce()
      → Minor perf improvement, optional

🎨 UX (2):
   [High] Form lacks loading state
      → User has no feedback during submission

   [Medium] Error messages are technical
      → "Failed to parse JSON" → "Invalid format"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary: 1 high, 1 medium, 1 low priority
These are suggestions only - not blocking.
```

### Priority Levels

- **[High]**: Strongly recommended improvement (UX impact, significant technical debt)
- **[Medium]**: Worth considering (maintainability, minor UX)
- **[Low]**: Nice to have (micro-optimizations, style preferences)

### Skipping Optimization Suggestions

Use `--skip-optimization` flag to skip this phase:
```bash
/wogi-review --skip-optimization
```

---

## Post-Review Workflow

After AI review completes, execute the fix-and-verify loop:

```
┌─────────────────────────────────────────────────────────────┐
│  POST-REVIEW WORKFLOW                                        │
├─────────────────────────────────────────────────────────────┤
│  1. TRACK: Convert issues to TodoWrite items                 │
│     → Critical/High: Individual todos                        │
│     → Medium/Low: Grouped by category                        │
│  2. FIX LOOP: For each issue:                                │
│     → Mark todo in_progress                                  │
│     → Apply fix                                              │
│     → Run targeted verification (lint/typecheck on file)     │
│     → Mark todo completed                                    │
│  3. RE-VERIFY: Run full verification gates again             │
│     → All gates must pass                                    │
│     → If new issues found, add to todo list                  │
│  4. ARCHIVE: Save review report to .workflow/reviews/        │
│  5. SIGN-OFF: User approves review complete                  │
└─────────────────────────────────────────────────────────────┘
```

### Step 1: Issue Tracking

After consolidating review results, convert to TodoWrite items:

```javascript
// Critical/High issues get individual todos
{ content: "Fix unbounded recursion in cascadeCompletion()", status: "pending" }
{ content: "Fix progress value inconsistency (0-1 vs 0-100)", status: "pending" }

// Medium/Low can be grouped
{ content: "Fix 3 DRY violations in file parsing", status: "pending" }
{ content: "Remove 2 unused imports", status: "pending" }
```

**Priority order for fixes:**
1. Critical (blocks functionality or security risk)
2. High (significant bugs or vulnerabilities)
3. Medium (code quality, maintainability)
4. Low (style, minor improvements)

### Step 2: Fix Loop

For each issue, follow this cycle:

```
┌──────────────────────────────────────┐
│  Mark todo: in_progress              │
│              ↓                       │
│  Read relevant file(s)               │
│              ↓                       │
│  Apply fix                           │
│              ↓                       │
│  Run targeted verification:          │
│    node --check <file>  (syntax)     │
│    npx eslint <file>    (lint)       │
│    npx tsc --noEmit     (types)      │
│              ↓                       │
│  If PASS → Mark todo: completed      │
│  If FAIL → Fix and retry             │
└──────────────────────────────────────┘
```

**Important**: Don't batch fixes. Complete and verify each fix before moving to the next.

### Step 3: Re-Verification

After all issues are fixed, run full verification again:

```bash
# Run all verification gates
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50

# Syntax check all modified files
node --check scripts/flow-*.js
```

If new issues are discovered during re-verification:
1. Add them to the todo list
2. Continue the fix loop
3. Re-verify again

### Step 4: Archive Review Report

Save the review report to `.workflow/reviews/`:

```
.workflow/reviews/
└── YYYY-MM-DD-HHMMSS-review.md
```

Report format:
```markdown
# Code Review Report

**Date**: YYYY-MM-DD HH:MM
**Files Reviewed**: N
**Review Mode**: parallel | multi-pass

## Verification Gates
- Lint: ✓/✗
- TypeCheck: ✓/✗
- Tests: ✓/✗

## Issues Found
| # | Severity | Issue | File:Line | Status |
|---|----------|-------|-----------|--------|
| 1 | Critical | ... | ... | Fixed |
| 2 | High | ... | ... | Fixed |

## Summary
- Issues found: N
- Issues fixed: N
- Gates passing: Y/Y
```

### Step 5: Sign-Off Gate

Before completing the review, ask for user approval:

```
═══════════════════════════════════════
REVIEW COMPLETE
═══════════════════════════════════════
Issues Found: 15
Issues Fixed: 15
Verification: All gates passing

Review report saved to: .workflow/reviews/2026-01-18-143022-review.md

Ready to proceed? (User approval required)
```

The review is not complete until the user confirms. This ensures:
- User is aware of all changes made
- User can request additional fixes
- User can reject fixes that change behavior unexpectedly

## Store Findings & Create Tasks

After review completes, store findings and create actionable tasks.

### Step 1: Store Each Finding as Bug

Save each finding to `.workflow/bugs/` using the bug template:

```bash
# For each finding, create a bug file
# wf-XXXXXXXX.md (8-char hash of finding description)
```

Bug file format:
```markdown
# Bug: [Issue title]

**ID**: wf-XXXXXXXX
**Severity**: Critical | High | Medium | Low
**Discovered**: review-YYYYMMDD-HHMMSS
**File**: path/to/file.ts:line
**Status**: open

## Description
[Issue description from review]

## Reproduction
Found during code review of [files reviewed]

## Fix
[Recommendation from review]
```

### Step 2: Create Tasks (Severity-Based Aggregation)

Apply smart aggregation based on severity and regression risk:

| Severity | Regression Risk | Action |
|----------|-----------------|--------|
| Critical | Any | Individual task (P0) |
| High | High risk | Individual task (P1) |
| High | Low risk | Aggregate with medium (P1) |
| Medium | Any | Aggregate together (P2) |
| Low | Any | Aggregate together (P3) |

**Regression risk indicators** (treat as High risk):
- Changes to shared utilities/helpers
- Changes to API contracts or types
- Changes to authentication/authorization
- Changes to data persistence
- Changes affecting multiple consumers

**Result**:
- Critical/high-risk issues → Individual tasks per issue
- Low-risk issues → One aggregated "Fix N low-risk review findings" task

### Step 3: Present Options to User

```
═══════════════════════════════════════
TASKS CREATED FROM REVIEW
═══════════════════════════════════════
Found 8 issues:
• 2 critical/high-risk → 2 separate tasks created
  - wf-abc12345: Fix SQL injection in user query (P0)
  - wf-def67890: Fix missing auth check in API (P1)
• 6 low-risk → 1 aggregated task created
  - wf-ghi11111: Fix 6 low-risk review findings (P2)

Options:
[1] Fix all - Start all tasks (/wogi-bulk)
[2] Fix critical first - Start critical/high tasks only
[3] Review tasks - Show in /wogi-ready, start manually
```

Use AskUserQuestion to present these options.

## Learning Loop

After presenting findings, trigger self-reflection to prevent future issues.

### Step 1: Self-Reflection Prompt

For each category of findings, ask:

```
═══════════════════════════════════════
LEARNING OPPORTUNITY
═══════════════════════════════════════
Review found patterns that could be prevented.

Analyzing what can be updated to prevent these in future...
```

### Step 2: Check Each Finding Against Knowledge Base

For each finding, evaluate:

| Finding Type | Check Against | Potential Update |
|--------------|---------------|------------------|
| Code pattern issue | `decisions.md` | Add new coding rule |
| Security issue | `.claude/rules/security/` | Add security pattern |
| Missing validation | skill patterns | Add anti-pattern |
| Component misuse | `app-map.md` | Add usage notes |
| Repeated mistake | `feedback-patterns.md` | Track for promotion |

### Step 3: Create Corrections

For preventable patterns, create correction records:

```bash
# Automatically create correction in .workflow/corrections/
# This feeds into feedback-patterns.md
```

Example correction:
```markdown
### CORR-XXX | 2026-01-21

**Pattern**: Missing try-catch around file reads
**Frequency**: Found in 3 places this review
**Prevention**: Add to security-patterns.md rule

**Action taken**: Updated .claude/rules/security/security-patterns.md
```

### Step 4: Check for Promotion Opportunities

If a pattern has occurred 3+ times in feedback-patterns.md:

```
═══════════════════════════════════════
PATTERN PROMOTION AVAILABLE
═══════════════════════════════════════
Pattern "missing-try-catch-file-reads" has occurred 4 times.

Promote to decisions.md as permanent coding rule? [Y/n]
```

### Step 5: Learning Summary

```
═══════════════════════════════════════
LEARNING CAPTURED
═══════════════════════════════════════
• Created correction: CORR-047 (missing null checks)
• Updated: .claude/rules/security/security-patterns.md
• Pattern "null-check-before-access" at 3 occurrences
  → Promoted to decisions.md ✓

Future reviews will check for these patterns.
```

## Auto-Fix Suggestions

For certain issue types, offer automated fixes:

| Issue Type | Auto-Fix Available |
|------------|-------------------|
| Unused imports | Yes - remove automatically |
| Missing try-catch | Yes - wrap in try-catch |
| Console.log in prod | Yes - remove or convert to logger |
| Missing null check | Suggest - show options |
| Logic bugs | No - require manual review |

When auto-fix is available:
```
⚠ Issue: Unused import 'color' in flow-plan.js:21

Auto-fix available: Remove unused import
Apply fix? [Y/n]
```

## Integration with Other Commands

- After `/wogi-done` - Optionally suggest review
- After major refactors - Recommend security review
- Before commits - Can be run as pre-commit check
- Replaces both `/wogi-session-review` and `/wogi-verify`
