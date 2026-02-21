# Session Review

Comprehensive code review using 3 parallel agents to analyze session changes.

## Overview

The `/wogi-session-review` command performs a thorough review of all code changes made during a session. It uses 3 parallel agents, each focused on different aspects:

```
┌─────────────────────────────────────────────────────────────┐
│                   SESSION REVIEW                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Agent 1    │  │   Agent 2    │  │   Agent 3    │       │
│  │  Code/Logic  │  │   Security   │  │ Architecture │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                 │                 │                │
│         ▼                 ▼                 ▼                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Consolidated Report                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Triggers

The review can be triggered by:

| Trigger | Example |
|---------|---------|
| Slash command | `/wogi-session-review` |
| Natural language | "please review" |
| Natural language | "review what we did" |
| Natural language | "review the changes" |

## Review Modes

### Parallel Mode (Default)
Runs 3 core AI agents simultaneously. Used for simple reviews (< 5 files).

### Multi-Pass Mode (Auto-Enabled)
Runs 4 sequential passes with context isolation. Auto-enabled when:
- 5+ files changed
- Security-sensitive files detected
- Security patterns in content (password, token, secret)
- API/service files detected

Passes: Structure (Sonnet) → Logic (Sonnet) → Security (Sonnet) → Integration (Sonnet)

---

## Adversarial Minimum Findings

Every review agent **must find at least `config.review.minFindings` (default: 3) findings**, or provide a written justification explaining why the code is genuinely clean.

This prevents "looks good to me" lazy reviews. If an agent finds fewer than the minimum, it must submit a `clean-justification` finding with detailed reasoning about error handling patterns, naming conventions, edge case coverage, and security posture.

```json
{
  "review": {
    "minFindings": 3,
    "requireJustificationIfClean": true
  }
}
```

---

## Git-Verified Claim Checking

After AI review, the system cross-references spec deliverables against actual `git diff` to catch false "done" claims.

- **Missing from git** (spec says create/modify, git has no changes): **BLOCKER**
- **Unplanned changes** (git has changes, spec doesn't mention): **WARNING**

```json
{
  "review": {
    "gitVerifiedClaims": {
      "enabled": true,
      "verifyFileCreation": true,
      "verifyContentMatch": true,
      "blockOnMismatch": true
    }
  }
}
```

---

## The 3 Review Agents

### Agent 1: Code & Logic Review

Focuses on code quality and correctness:

- **Code Quality**: Naming conventions, readability, structure
- **Logic Correctness**: Algorithm bugs, edge case handling
- **DRY Violations**: Duplicated code that should be extracted
- **Error Handling**: Missing try/catch, unhandled promises
- **Code Smells**: Long methods, deep nesting, magic numbers

### Agent 2: Security Review

Based on `agents/security.md` and OWASP Top 10:

- **Input Validation**: User inputs sanitized?
- **Authentication/Authorization**: Proper access controls?
- **Injection Risks**: SQL, XSS, command injection vulnerabilities
- **Sensitive Data**: Passwords, tokens, PII exposure
- **Error Messages**: Stack traces or secrets in error responses

### Agent 3: Architecture & Conflicts

Checks against project standards:

- **Component Reuse**: Check `app-map.md` for existing components
- **Pattern Consistency**: Check `decisions.md` for coding patterns
- **Redundancies**: Similar implementations that could be consolidated
- **Conflicts**: Code that contradicts existing implementations
- **Dead Code**: Unused imports, variables, unreachable code

## Command Options

```bash
/wogi-session-review              # Review all session changes
/wogi-session-review --commits 3  # Include last 3 commits
/wogi-session-review --staged     # Only staged changes
/wogi-session-review --security-only  # Only run security agent
/wogi-session-review --quick      # Faster, less thorough
```

## Output Format

```
╔══════════════════════════════════════════════════════════╗
║  Session Review                                           ║
╚══════════════════════════════════════════════════════════╝

Files Reviewed: 5
  • src/components/Button.tsx
  • src/utils/validation.ts
  • src/api/users.ts

───────────────────────────────────────────────────────────
CODE & LOGIC REVIEW
───────────────────────────────────────────────────────────
✓ Code quality: Good naming conventions
✓ Error handling: Appropriate try/catch blocks
⚠ Edge case: Missing null check in validation.ts:45
⚠ DRY: Similar validation logic in users.ts and validation.ts

───────────────────────────────────────────────────────────
SECURITY REVIEW
───────────────────────────────────────────────────────────
✓ Input validation: Present on all user inputs
✓ Authentication: Properly checked before data access
⚠ Potential: SQL injection risk in users.ts:78

───────────────────────────────────────────────────────────
ARCHITECTURE & CONFLICTS
───────────────────────────────────────────────────────────
✓ Component reuse: Button follows app-map patterns
✓ Pattern consistency: Follows decisions.md conventions
⚠ Redundancy: validateEmail exists in utils/helpers.ts

───────────────────────────────────────────────────────────
SUMMARY
───────────────────────────────────────────────────────────
Total Issues: 4 (0 critical, 0 high, 4 medium)

Top Recommendations:
1. Add null check in validation.ts:45
2. Use parameterized query in users.ts:78
3. Consolidate email validation logic
```

## Severity Levels

| Level | Description | Action |
|-------|-------------|--------|
| **Critical** | Security vulnerability, data loss risk | Must fix before merge |
| **High** | Bug, logic error, significant issue | Should fix before merge |
| **Medium** | Code quality, DRY violation, minor issue | Recommend fixing |
| **Low** | Style, suggestion, nice-to-have | Optional |

## Integration

### With Quality Gates

Session review can be added to quality gates:

```json
{
  "qualityGates": {
    "feature": {
      "require": ["tests", "sessionReview", "appMapUpdate"]
    }
  }
}
```

### With CI/CD

Run before merge:

```bash
# In CI pipeline
./scripts/flow session-review --commits 1 --json > review.json
```

## Standards Compliance (Phase 3)

After AI review, a standards compliance check runs against project documentation:
- `decisions.md` - All documented coding rules
- `app-map.md` - Component duplication (semantic similarity, configurable via `config.semanticMatching`)
- `naming-conventions.md` - File names, catch variables
- `security-patterns.md` - Raw JSON.parse, unprotected fs.readFileSync

Violations are **blocking** - the review cannot complete until they are fixed.

## Solution Optimization (Phase 4)

Non-blocking suggestions for improvement:
- Performance patterns (filter+map chains, sequential awaits)
- Modern JS (var usage, Promise chains vs async/await)
- UX improvements (loading states, error messages, accessibility)

---

## Best Practices

1. **Run before committing** - Catch issues early
2. **Use after major changes** - Especially refactors
3. **Focus on security for public-facing code** - Use `--security-only`
4. **Review the summary** - Top recommendations are most important

## Related Commands

- `/wogi-health` - Check workflow integrity
- `/wogi-session-end` - End session and commit
- `./scripts/flow verify all` - Run all verification gates
