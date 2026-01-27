Comprehensive code review with **automatic fixing**. Runs the full `/wogi-review` process, then automatically fixes all identified issues and re-verifies.

**Triggers**: `/wogi-review-fix`, "review and fix", "fix all issues"

## Usage

```bash
/wogi-review-fix              # Review + auto-fix all issues
/wogi-review-fix --dry-run    # Show what would be fixed (no changes)
/wogi-review-fix --no-verify  # Skip re-verification after fixes
/wogi-review-fix --commits 3  # Review last 3 commits + fix
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-review-fix                                            │
├─────────────────────────────────────────────────────────────┤
│  PHASE 1: REVIEW (same as /wogi-review)                      │
│     1. Identify changed files (git diff)                     │
│     2. Run verification gates (lint, typecheck, tests)       │
│     3. Run AI review (parallel or multi-pass)                │
│     4. Consolidate findings                                  │
│                                                              │
│  PHASE 2: AUTO-FIX                                           │
│     5. Categorize issues (auto-fixable vs manual)            │
│     6. For each auto-fixable issue:                          │
│        → Read file                                           │
│        → Apply fix                                           │
│        → Verify syntax (node --check)                        │
│        → Track result                                        │
│                                                              │
│  PHASE 3: RE-VERIFY                                          │
│     7. Run verification gates again                          │
│     8. Report: Fixed N, Manual M, Verification PASS/FAIL     │
└─────────────────────────────────────────────────────────────┘
```

## Auto-Fixable vs Manual Issues

### Auto-Fixable (will be fixed automatically)

| Issue Type | Fix Method |
|------------|------------|
| Unused imports | Remove the import line |
| Console.log in production | Remove or convert to proper logger |
| Missing try-catch (simple) | Wrap operation in try-catch |
| Naming convention violation | Rename file/variable to match convention |
| Missing null check (simple) | Add optional chaining `?.` or guard |
| Dead code / unreachable | Remove the dead code |
| Duplicate code (small) | Extract to shared function |

### Manual (will be listed for user attention)

| Issue Type | Why Manual |
|------------|------------|
| Logic bugs | Requires understanding intent |
| Security vulnerabilities | Requires careful review |
| Architecture issues | Requires design decisions |
| Breaking API changes | Requires coordination |
| Complex refactors | Requires validation |

## Execution Steps

### Step 1: Run Full Review

Execute the standard `/wogi-review` process:

```bash
# Get changed files
git diff --name-only HEAD

# Run verification gates
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50

# Run AI review (parallel or multi-pass based on file count)
# Collect all findings with file:line:issue:severity:suggestion
```

### Step 2: Categorize Findings

After review completes, categorize each finding:

```javascript
// Example finding structure
{
  file: "src/utils.ts",
  line: 45,
  issue: "Unused import 'lodash'",
  severity: "low",
  category: "unused-import",  // Auto-fixable
  suggestion: "Remove the unused import"
}
```

**Categorization rules:**
- `unused-import` → Auto-fix
- `console-log` → Auto-fix
- `missing-null-check` (single line) → Auto-fix
- `naming-convention` → Auto-fix
- `logic-error` → Manual
- `security-*` → Manual
- `architecture-*` → Manual

### Step 3: Fix Loop

For each auto-fixable issue, in order of file (to batch edits):

```
For each file with issues:
  1. Read the file
  2. For each issue in this file:
     a. Apply the fix using Edit tool
     b. Log: "Fixed: [issue] in [file:line]"
  3. Verify file syntax: node --check [file] (for JS/TS)
  4. If syntax fails:
     - Rollback edit
     - Move issue to "Manual" list
     - Log: "Fix failed, moved to manual: [issue]"
```

### Step 4: Re-Verification

After all fixes applied:

```bash
# Run verification gates again
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50  # If tests exist

# Syntax check all modified files
node --check [modified files]
```

### Step 5: Summary Report

```
╔══════════════════════════════════════════════════════════╗
║  Review + Fix Complete                                    ║
╚══════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════
FIXES APPLIED (12 issues)
═══════════════════════════════════════════════════════════
✓ src/utils.ts:45 - Removed unused import 'lodash'
✓ src/api.ts:23 - Removed console.log
✓ src/api.ts:67 - Added null check
✓ src/components/Button.tsx:12 - Removed unused import
... (8 more)

═══════════════════════════════════════════════════════════
MANUAL ATTENTION NEEDED (3 issues)
═══════════════════════════════════════════════════════════
⚠ src/auth.ts:89 - Potential SQL injection (security)
  → Review: User input not sanitized before query
⚠ src/api.ts:134 - Race condition (logic)
  → Review: Async operation may complete out of order
⚠ src/utils.ts:200 - Breaking API change (architecture)
  → Review: Function signature changed, check callers

═══════════════════════════════════════════════════════════
RE-VERIFICATION
═══════════════════════════════════════════════════════════
✓ Lint: passed
✓ TypeCheck: passed
✓ Syntax: all files valid

═══════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════
Total issues found: 15
Auto-fixed: 12
Manual review needed: 3
Verification: PASSED

Files modified: 4
  • src/utils.ts (3 fixes)
  • src/api.ts (5 fixes)
  • src/components/Button.tsx (2 fixes)
  • src/auth.ts (2 fixes)
```

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be fixed without making changes |
| `--no-verify` | Skip re-verification after fixes |
| `--commits N` | Include last N commits in review scope |
| `--staged` | Only review staged changes |
| `--skip-manual` | Don't show manual issues in report |

## Dry Run Mode

With `--dry-run`, shows the fix plan without applying:

```
═══════════════════════════════════════════════════════════
DRY RUN - WOULD FIX (12 issues)
═══════════════════════════════════════════════════════════
• src/utils.ts:45 - Would remove unused import 'lodash'
• src/api.ts:23 - Would remove console.log
• src/api.ts:67 - Would add null check: user?.profile
...

Run without --dry-run to apply these fixes.
```

## Comparison with /wogi-review

| Aspect | `/wogi-review` | `/wogi-review-fix` |
|--------|----------------|-------------------|
| Reviews code | ✓ | ✓ |
| Lists issues | ✓ | ✓ |
| Fixes issues | ✗ | ✓ (auto-fixable) |
| Re-verifies | ✗ | ✓ |
| End state | Issues listed | Issues resolved |

## When to Use

**Use `/wogi-review`** when:
- You want to see issues before deciding to fix
- You're reviewing someone else's code
- You want to understand the codebase state

**Use `/wogi-review-fix`** when:
- You want issues fixed immediately
- You trust the auto-fix for common issues
- You're cleaning up after a large change
- You want a "fix everything" single command

## Safety Guarantees

1. **Syntax verification** - Every fix is syntax-checked before moving on
2. **Rollback on failure** - If a fix breaks syntax, it's reverted
3. **Manual escalation** - Complex issues are never auto-fixed
4. **Security issues untouched** - Security findings always require manual review
5. **Git-friendly** - All changes can be reviewed in `git diff` before commit
