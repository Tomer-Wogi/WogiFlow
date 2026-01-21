Comprehensive code review with verification gates and AI analysis. Auto-detects when to use multi-pass (4 sequential passes) vs parallel (3 agents) based on file count and security patterns.

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

## Phase 2: AI Review (3 Parallel Agents)

### Agent 1: Code & Logic Review
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

For each issue found, report:
- File and line number
- Issue type (quality/logic/dry/error/smell)
- Severity (critical/high/medium/low)
- Description and recommendation
```

### Agent 2: Security Review
Launch a Task agent with subagent_type=Explore focusing on:
- **Input Validation**: User inputs sanitized?
- **Authentication/Authorization**: Proper access controls?
- **Injection Risks**: SQL, XSS, command injection?
- **Sensitive Data**: Passwords, tokens, PII exposed?
- **Error Messages**: Do errors leak sensitive info?

Refer to `agents/security.md` for OWASP Top 10 checklist.

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

For each issue found, report:
- File and line number
- Vulnerability type
- Severity (critical/high/medium/low)
- Description and remediation
```

### Agent 3: Architecture & Conflicts
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

For each issue found, report:
- File and line number
- Issue type (reuse/pattern/redundancy/conflict/dead-code)
- Severity (critical/high/medium/low)
- Description and recommendation
```

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

4. **Launch 3 agents in parallel** (single message with 3 Task tool calls):
   - Agent 1: Code & Logic (subagent_type=Explore)
   - Agent 2: Security (subagent_type=Explore)
   - Agent 3: Architecture (subagent_type=Explore)

5. **Wait for all agents to complete**

6. **Consolidate and display results**:

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

## Phase 3: Post-Review Workflow

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

## Phase 4: Store Findings & Create Tasks

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

## Phase 5: Learning Loop

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
