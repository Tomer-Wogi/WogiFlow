Comprehensive code review with **automatic fixing**. Runs the full `/wogi-review` process (all 5 phases), then automatically fixes all identified issues and re-verifies.

**Triggers**: `/wogi-review-fix`, "review and fix", "fix all issues"

## Usage

```bash
/wogi-review-fix                    # Full review + auto-fix all issues
/wogi-review-fix --dry-run          # Show what would be fixed (no changes)
/wogi-review-fix --no-verify        # Skip re-verification after fixes
/wogi-review-fix --commits 3        # Review last 3 commits + fix
/wogi-review-fix --browser          # Include browser debugging for UI issues
/wogi-review-fix --skip-standards   # Skip standards compliance auto-fix
/wogi-review-fix --skip-optimization # Skip solution optimization suggestions
```

## How It Works (v4.0)

```
┌─────────────────────────────────────────────────────────────┐
│  /wogi-review-fix                                            │
├─────────────────────────────────────────────────────────────┤
│  PHASE 1: VERIFICATION GATES                                 │
│     1. Identify changed files (git diff)                     │
│     2. Run verification gates (lint, typecheck, tests)       │
│     3. Spec verification (if task has spec)                  │
│                                                              │
│  PHASE 2: AI REVIEW (multi-pass or parallel)                 │
│     4. Code/Logic, Security, Architecture analysis           │
│     5. Consolidate findings                                  │
│                                                              │
│  PHASE 3: STANDARDS COMPLIANCE [AUTO-FIX]                    │
│     6. Check decisions.md, app-map.md, naming-conventions    │
│     7. AUTO-FIX all [MUST FIX] violations                    │
│                                                              │
│  PHASE 4: SOLUTION OPTIMIZATION [AUTO-APPLY HIGH]            │
│     8. Check for technical & UX improvements                 │
│     9. AUTO-APPLY high-priority suggestions                  │
│                                                              │
│  PHASE 5: AUTO-FIX ISSUES                                    │
│     10. Categorize issues (auto-fixable vs manual)           │
│     11. For each auto-fixable issue: Fix + verify            │
│                                                              │
│  PHASE 6: RE-VERIFY                                          │
│     12. Run all verification gates again                     │
│     13. Report: Fixed N, Manual M, Verification PASS/FAIL    │
│                                                              │
│  PHASE 7: BROWSER DEBUG (optional, --browser or auto)        │
│     14. If UI files + still failing → debug in browser       │
│     15. Read console, fix runtime errors, verify             │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Verification Gates

Same as `/wogi-review` - run automated tools first:

```bash
# Spec verification (if task has spec)
node scripts/flow-spec-verifier.js verify wf-XXXXXXXX

# Standard verification
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50
```

## Phase 2: AI Review

Same as `/wogi-review` - auto-detects multi-pass vs parallel:

- **Parallel mode**: 3 agents simultaneously (Code/Logic, Security, Architecture)
- **Multi-pass mode**: 4 sequential passes (auto-enabled for 5+ files or security-sensitive)

## Phase 3: Standards Compliance [AUTO-FIX]

Unlike `/wogi-review` which blocks on violations, `/wogi-review-fix` **automatically fixes** them.

### What Gets Auto-Fixed

| Source | Violation Type | Auto-Fix |
|--------|----------------|----------|
| `naming-conventions.md` | File names not kebab-case | Rename file |
| `naming-conventions.md` | Catch variable not `err` | Replace with `err` |
| `decisions.md` | Pattern violation (if fixable) | Apply pattern |
| `app-map.md` | Component duplication >80% | Remove new, use existing |
| `security-patterns.md` | Raw JSON.parse | Replace with safeJsonParse |
| `security-patterns.md` | Unprotected fs.readFileSync | Add try-catch |

### Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 STANDARDS COMPLIANCE [AUTO-FIX]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ decisions.md: passed
✓ app-map.md: passed

🔧 naming-conventions: 1 violation FIXED
   → src/utils.ts:45 - Changed catch variable "e" → "err"

🔧 security-patterns: 1 violation FIXED
   → src/api.ts:23 - Wrapped JSON.parse in safeJsonParse

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Standards: 2 violations auto-fixed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Skip Standards Auto-Fix

```bash
/wogi-review-fix --skip-standards
```

---

## Phase 4: Solution Optimization [AUTO-APPLY HIGH]

Unlike `/wogi-review` which only suggests, `/wogi-review-fix` **auto-applies high-priority** improvements.

### What Gets Auto-Applied

| Priority | Category | Auto-Apply? |
|----------|----------|-------------|
| **High** | Missing loading state | ✓ Add loading indicator |
| **High** | Technical error to user | ✓ Replace with friendly message |
| **High** | Empty catch block | ✓ Add proper error handling |
| **Medium** | filter+map chain | ✗ (suggest only) |
| **Medium** | Inline style objects | ✗ (suggest only) |
| **Low** | Micro-optimizations | ✗ (suggest only) |

### Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 SOLUTION OPTIMIZATION [AUTO-APPLY HIGH]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 Applied (High priority):
   ✓ src/Form.tsx:89 - Added loading state to form submission
   ✓ src/api.ts:45 - Replaced technical error with user-friendly message

📋 Suggestions (not applied):
   [Medium] Array.filter().map() could use reduce() - src/utils.ts:12
   [Low] Consider extracting to custom hook - src/Form.tsx:34

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Optimizations: 2 applied, 2 suggested
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Skip Optimization

```bash
/wogi-review-fix --skip-optimization
```

---

## Phase 5: Auto-Fix Issues

Fix all auto-fixable issues from the AI review.

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

### Fix Loop

```
For each file with issues:
  1. Read the file
  2. For each issue in this file:
     a. Apply the fix using Edit tool
     b. Log: "Fixed: [issue] in [file:line]"
  3. Verify file syntax: node --check [file]
  4. If syntax fails:
     - Rollback edit
     - Move issue to "Manual" list
```

---

## Phase 6: Re-Verification

After all fixes applied:

```bash
# Run verification gates again
npm run lint 2>&1 | head -50
npm run typecheck 2>&1 | head -50
npm run test 2>&1 | head -50

# Syntax check all modified files
node --check [modified files]
```

---

## Phase 7: Browser Debugging (Optional)

When `--browser` is specified OR when UI files are changed and issues remain after Phase 6.

### When Browser Debugging Triggers

| Condition | Behavior |
|-----------|----------|
| `--browser` flag used | Always run browser debugging |
| UI files (*.tsx, *.jsx, *.vue) + verification fails | Suggest browser debugging |
| `browserDebugging.triggers.autoOnTestFailure` enabled | Auto-run on verification failure |

### Browser Debug Loop

```
For each iteration (max 10):
  1. Navigate to app (default: localhost:3000)
  2. Take screenshot of current state
  3. Read console errors via Chrome MCP
  4. If runtime error found:
     → Analyze error pattern
     → Apply targeted fix
     → Wait for hot reload (2s)
     → Re-check
  5. If working → Exit with PASS
  6. If max iterations → Exit with issues listed
```

### Requirements

- Chrome integration: `claude --chrome`
- Claude in Chrome extension v1.0.36+
- Dev server running (for hot reload)

---

## Summary Report

```
╔══════════════════════════════════════════════════════════╗
║  Review + Fix Complete                                    ║
╚══════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════
STANDARDS COMPLIANCE
═══════════════════════════════════════════════════════════
✓ 2 violations auto-fixed (naming, security)
✓ All standards now passing

═══════════════════════════════════════════════════════════
SOLUTION OPTIMIZATION
═══════════════════════════════════════════════════════════
✓ 2 high-priority improvements applied
📋 2 suggestions for manual review

═══════════════════════════════════════════════════════════
AI REVIEW ISSUES
═══════════════════════════════════════════════════════════
✓ src/utils.ts:45 - Removed unused import 'lodash'
✓ src/api.ts:23 - Removed console.log
✓ src/api.ts:67 - Added null check
... (8 more)

═══════════════════════════════════════════════════════════
MANUAL ATTENTION NEEDED (3 issues)
═══════════════════════════════════════════════════════════
⚠ src/auth.ts:89 - Potential SQL injection (security)
⚠ src/api.ts:134 - Race condition (logic)
⚠ src/utils.ts:200 - Breaking API change (architecture)

═══════════════════════════════════════════════════════════
BROWSER DEBUG (if enabled)
═══════════════════════════════════════════════════════════
✓ 1 runtime issue fixed via browser debugging

═══════════════════════════════════════════════════════════
RE-VERIFICATION
═══════════════════════════════════════════════════════════
✓ Lint: passed
✓ TypeCheck: passed
✓ Tests: passed
✓ Standards: passed

═══════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════
Total issues found: 20
  Standards violations: 2 (auto-fixed)
  High-priority optimizations: 2 (auto-applied)
  AI review issues: 12 (auto-fixed)
  Browser runtime issues: 1 (auto-fixed)
  Manual review needed: 3

Verification: PASSED

Files modified: 6
  • src/utils.ts (4 fixes)
  • src/api.ts (6 fixes)
  • src/components/Button.tsx (2 fixes)
  • src/components/Form.tsx (3 fixes)
  • src/auth.ts (1 fix)
  • src/components/TaskList.tsx (1 browser fix)
```

---

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be fixed without making changes |
| `--no-verify` | Skip re-verification after fixes |
| `--commits N` | Include last N commits in review scope |
| `--staged` | Only review staged changes |
| `--skip-manual` | Don't show manual issues in report |
| `--skip-standards` | Skip standards compliance auto-fix |
| `--skip-optimization` | Skip solution optimization auto-apply |
| `--browser` | Enable browser debugging for UI runtime issues |
| `--browser-url URL` | Specify URL for browser debugging (default: localhost:3000) |
| `--multipass` | Force multi-pass review mode |
| `--no-multipass` | Disable auto multi-pass detection |

---

## Dry Run Mode

With `--dry-run`, shows the complete fix plan without applying:

```
═══════════════════════════════════════════════════════════
DRY RUN - FIX PLAN
═══════════════════════════════════════════════════════════

STANDARDS VIOLATIONS (would fix):
• src/utils.ts:45 - Would change catch variable "e" → "err"
• src/api.ts:23 - Would wrap JSON.parse in safeJsonParse

HIGH-PRIORITY OPTIMIZATIONS (would apply):
• src/Form.tsx:89 - Would add loading state
• src/api.ts:45 - Would replace technical error message

AI REVIEW ISSUES (would fix):
• src/utils.ts:45 - Would remove unused import 'lodash'
• src/api.ts:23 - Would remove console.log
...

Run without --dry-run to apply these fixes.
```

---

## Comparison with /wogi-review

| Aspect | `/wogi-review` | `/wogi-review-fix` |
|--------|----------------|-------------------|
| Verification gates | ✓ | ✓ |
| AI review (multi-pass/parallel) | ✓ | ✓ |
| Standards compliance | Blocks on violations | **Auto-fixes** violations |
| Solution optimization | Suggests only | **Auto-applies** high priority |
| AI review issues | Lists issues | **Auto-fixes** where possible |
| Browser debugging | ✗ | ✓ (with --browser) |
| Re-verification | ✗ | ✓ |
| End state | Issues listed | **Issues resolved** |

---

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

---

## Safety Guarantees

1. **Syntax verification** - Every fix is syntax-checked before moving on
2. **Rollback on failure** - If a fix breaks syntax, it's reverted
3. **Manual escalation** - Complex issues are never auto-fixed
4. **Security issues untouched** - Security vulnerabilities always require manual review
5. **Git-friendly** - All changes can be reviewed in `git diff` before commit
6. **Standards fixes are safe** - Only mechanical fixes (rename, wrap) are auto-applied
7. **Optimizations are conservative** - Only high-priority with clear patterns
8. **Browser fixes are targeted** - Only runtime errors with known patterns
