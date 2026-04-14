# Verification

Verification ensures that each acceptance criterion is actually met before marking it complete. This includes auto-inference, quality gates, and specialized testing.

---

## Auto-Inference Verification

Auto-inference automatically verifies certain types of criteria without manual confirmation.

### Supported Verifications

| Type | Pattern Detected | How Verified |
|------|-----------------|--------------|
| **File Exists** | "Create file X" | Check filesystem |
| **Function Export** | "Export function X from Y" | Parse file content |
| **Component Exists** | "Component X renders" | Search component directories |
| **Config Exists** | "Config has X.Y.Z" | Check config.json |
| **Tests Pass** | "Tests pass" | Run npm test |
| **Lint Clean** | "No lint errors" | Run linter |
| **CLI Works** | "Command X works" | Run with --help |

### Configuration

```json
{
  "execution": {
    "autoInferVerification": true
  }
}
```

### How It Works

```
Criterion: "Create file src/services/AuthService.ts"
            ↓
Pattern Match: "Create file" → File existence check
            ↓
Verification: fs.existsSync('src/services/AuthService.ts')
            ↓
Result: ✓ File exists: src/services/AuthService.ts
```

### Verification Results

```
✓ File exists: src/services/AuthService.ts        (auto-verified)
✓ Found "login" in src/services/AuthService.ts   (auto-verified)
⚠️ Could not auto-verify - manual check required  (fallback)
```

---

## Quality Gates

Quality gates are requirements that must pass before a task can be completed.

### Configuration

```json
{
  "qualityGates": {
    "feature": {
      "require": ["tests", "registryUpdate", "requestLogEntry"],
      "optional": ["review", "docs"]
    },
    "bugfix": {
      "require": ["tests", "requestLogEntry"],
      "optional": ["review"]
    },
    "refactor": {
      "require": ["tests", "noNewFeatures"],
      "optional": ["review"]
    }
  }
}
```

### Available Gates

| Gate | What It Checks |
|------|----------------|
| `tests` | npm test passes |
| `lint` | npm run lint passes (with auto-fix) |
| `typecheck` | npm run typecheck passes |
| `registryUpdate` | All registry maps (app-map, function-map, api-map, schema-map, service-map) auto-scanned |
| `requestLogEntry` | Task logged in request-log.md |
| `noNewFeatures` | (Refactor) No new functionality added |
| `integrationWiring` | Created files are imported/used somewhere (not orphaned) |
| `smokeTest` | App starts and basic functionality works after changes |
| `review` | Manual code review completed |
| `docs` | Documentation updated |

### Integration Wiring Gate

The `integrationWiring` gate prevents "orphan components" - files that exist but are never wired into the application.

**What it checks:**
- React components are imported in at least one parent
- Hooks are called from at least one component
- Utilities are imported somewhere
- Entry points (index.ts, config files, test files) are exempt

**Why it's important:**
This gate catches the #1 bug from comprehensive reviews: components created but never accessible to users.

**Run manually:**
```bash
node scripts/flow-wiring-verifier.js wf-XXXXXXXX
```

### Smoke Test Gate

The `smokeTest` gate ensures basic functionality still works after refactoring.

**What it requires:**
- App starts without errors (`npm run dev` or equivalent)
- No console errors on initial load
- Basic navigation works

**When it's required:**
- Enabled by default for `refactor` tasks
- Prevents introducing regressions during code restructuring

### Gate Execution

When task completion runs (automatically via `/wogi-start`):

```
Running quality gates...

  ✓ tests passed
  ✓ lint passed (auto-fixed)
  ✓ typecheck passed
  ✓ requestLogEntry (found in request-log)
  ✓ registryUpdate (auto-scanned: app-map.md updated)

All gates passed!
```

### Failed Gates

If a gate fails:
1. Error output is captured
2. Failure details saved to `.workflow/state/last-failure.json`
3. Task completion is blocked
4. Fix issues and retry

```
Running quality gates...

  ✗ tests failed
    Error output:
      FAIL src/services/AuthService.test.ts
      ● login › should return user on success
        Expected: { id: 1 }
        Received: undefined

  ✗ typecheck failed
    Type errors:
      src/services/AuthService.ts:15:5
      Property 'user' does not exist on type 'Response'

Failed gates: tests, typecheck
Quality gates failed. Fix issues before completing.
```

---

## Validation Commands

Run validation commands after file edits or before commits.

### Configuration

```json
{
  "validation": {
    "afterFileEdit": {
      "enabled": true,
      "commands": {
        "*.ts": ["npm run type-check"],
        "*.tsx": ["npm run type-check", "npx eslint {file} --fix"],
        "*.js": ["npx eslint {file} --fix"],
        "*.jsx": ["npx eslint {file} --fix"]
      },
      "fixErrorsBeforeContinuing": true
    },
    "afterTaskComplete": {
      "enabled": true,
      "commands": ["npm run lint", "npm run typecheck"]
    },
    "beforeCommit": {
      "enabled": true,
      "commands": ["npm run lint", "npm run typecheck", "npm run test"]
    }
  }
}
```

### When Validation Runs

1. **After File Edit**: Immediately catch type errors
2. **After Task Complete**: Full lint/typecheck before commit
3. **Before Commit**: Final validation including tests

---

## Regression Testing

Test previously completed tasks to ensure new changes don't break them.

### Configuration

```json
{
  "regressionTesting": {
    "enabled": true,
    "sampleSize": 3,              // Test 3 random completed tasks
    "runOnTaskComplete": true,    // Run after each task
    "onFailure": "warn"           // "warn" | "block" | "fix"
  }
}
```

### How It Works

1. After task completion, randomly select N completed tasks
2. Re-verify their acceptance criteria
3. If any fail, report according to `onFailure` setting

### Commands

```bash
# Run regression tests manually
./scripts/flow regression

# Test all completed tasks
./scripts/flow regression --all
```

### Failure Handling

| Setting | Behavior |
|---------|----------|
| `warn` | Show warning, continue |
| `block` | Block completion until fixed |
| `fix` | Attempt automatic fix |

---

## Pattern Enforcement

Ensure code follows patterns defined in `decisions.md`.

### Configuration

```json
{
  "enforcement": {
    "requirePatternCitation": false,  // Require citing patterns
    "citationFormat": "// Pattern: {pattern}"
  }
}
```

### How It Works

When `requirePatternCitation` is enabled:
1. Read patterns from `decisions.md`
2. Check if new code follows known patterns
3. Require citation in code comments
4. Warn on anti-pattern usage

### Example

```typescript
// Pattern: API calls use axios wrapper from src/lib/api
import { api } from '@/lib/api';

// Pattern: Error boundaries wrap page components
export default function LoginPage() {
  return (
    <ErrorBoundary>
      <LoginForm />
    </ErrorBoundary>
  );
}
```

---

## Security Scanning

Pre-commit security checks prevent vulnerabilities.

### Configuration

```json
{
  "security": {
    "scanBeforeCommit": true,
    "blockOnHigh": true,
    "checkPatterns": {
      "secrets": true,           // Check for API keys, passwords
      "injection": true,         // Check for SQL/XSS injection
      "npmAudit": true          // Run npm audit
    },
    "ignoreFiles": ["*.test.ts", "*.spec.ts"]
  }
}
```

### What's Checked

1. **Secrets Detection**: API keys, passwords, tokens in code
2. **Injection Patterns**: SQL injection, XSS vulnerabilities
3. **NPM Audit**: Known vulnerabilities in dependencies

### Scan Results

```
Security scan results:

  ⚠️ Potential secret detected:
     src/config.ts:15
     const API_KEY = "sk-..."

  ✓ No injection patterns found
  ✓ npm audit: 0 vulnerabilities

Block commit? Yes (blockOnHigh: true)
```

---

## Test-First Mode (TDD)

Opt-in test-first development where tests must exist before implementation.

### Configuration

```json
{
  "tdd": {
    "enforced": false,
    "defaultForTypes": [],
    "requireFailingTestFirst": true,
    "testFrameworkDetection": true
  }
}
```

### How It Works

When `tdd.enforced` is true (or task uses `--tdd` flag):
1. **Before implementation**: Test file must exist with failing tests
2. **During implementation**: Tests are re-run after each change
3. **After implementation**: All tests must pass (red → green → refactor)

### Per-Task-Type Configuration

Use `defaultForTypes` to auto-enable TDD for specific task types:
```json
{
  "tdd": {
    "enforced": false,
    "defaultForTypes": ["feature", "bugfix"]
  }
}
```

---

## Cross-Artifact Consistency Check

Validates that app-map, function-map, and api-map stay in sync with the codebase.

### What It Checks

| Check | Description |
|-------|-------------|
| `phantom-entries` | Components/functions documented in maps but missing from codebase |
| `orphan-files` | Files in codebase but not documented in any map |
| `cross-map` | Cross-references between maps (component uses function that doesn't exist) |

### Configuration

```json
{
  "consistency": {
    "enabled": true,
    "runOn": ["afterTask", "beforeCommit"],
    "mode": "warn",
    "checks": {
      "phantomEntries": true,
      "orphanFiles": true,
      "crossMapConsistency": true
    }
  }
}
```

### Running Manually

```bash
node scripts/flow-consistency-check.js          # Human-readable output
node scripts/flow-consistency-check.js --json   # JSON for CI
```

---

## Git-Verified Claim Checking

Cross-references spec deliverables against actual `git diff` to catch false "done" claims.

### How It Works

1. Parse the spec for promised deliverables
2. Get actual git changes (`git diff --name-only`)
3. Cross-reference: does every spec promise appear in git?
4. Report mismatches

### Severity

| Mismatch | Severity |
|----------|----------|
| Spec says create, git has nothing | **BLOCKER** - implementation gap |
| Git has changes, spec doesn't mention | **WARNING** - possible scope creep |

### Configuration

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

## Skeptical Evaluator (v2.13+)

After implementation, a separate sub-agent independently grades every acceptance criterion.

**Why**: The same agent that wrote the code verifies its own work — this is "confident praise bias." Anthropic's harness research found that separating the implementer from the evaluator is a strong lever for quality.

**How it works**:
1. Spawn a code-reviewer sub-agent on a **different model** (e.g., Sonnet evaluates Opus's work)
2. Feed it the spec + git diff — it reads the code cold with no implementation context
3. For each criterion: grade PASS / PARTIAL / FAIL with file:line evidence
4. If issues found → feed back to implementer → fix → re-evaluate (max 3 rounds)
5. Calibrated with few-shot examples from `.workflow/state/eval-calibration.json`

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

---

## Runtime Verification Gate (v2.13+)

Auto-generates and runs tests for every task that changes code. ON by default.

### Evidence Tiers

| Tier | Name | Counts as Done? |
|------|------|----------------|
| 0 | STATIC (compiles, lints) | Never |
| 1 | STRUCTURAL (file exists, imported) | Never |
| 2 | OBSERVATIONAL (page loads, renders) | Display-only criteria |
| 3 | INTERACTIVE (click → result persists) | Yes |
| 4 | AUTOMATED (test passes) | Yes (strongest) |

### Frontend: Browser tests generated when UI files change
- **WebMCP** (preferred): Drives actual browser — screenshot before/after, assert DOM, verify persistence after reload
- **Playwright**: Auto-generates test to `tests/verification/verify-{taskId}.spec.ts`
- **User Checklist** (fallback): Blocks completion until user replies "verified"

### Backend: API tests generated when API files change
- HTTP integration tests with status, response shape, and persistence assertions
- Tests persist in `tests/verification/api-verify-{taskId}.test.js`

### Fullstack: Boundary verification
- API test verifies server accepts the frontend's payload shape
- Browser test verifies UI displays the server's response shape

### Repeat Failure Protocol

| Strike | Action |
|--------|--------|
| 1 | Normal fix |
| 2 | Mandatory root cause analysis. Must change approach. |
| 3 | Hard block: evidence required. Must explain what's different. |
| 4+ | Escalation: suggest pair debugging with developer. |

```json
{
  "runtimeVerification": {
    "enabled": true,
    "autoGenerateTests": true,
    "persistTests": true,
    "blockOnFailure": true
  }
}
```

---

## Sprint-Based Context Reset (v2.12+)

For large tasks (5+ criteria), every 3 criteria: commit progress, save checkpoint, compact context, resume with fresh context reading the spec anew.

```json
{
  "sprintReset": { "enabled": true, "criteriaPerSprint": 3, "minTaskCriteria": 5 }
}
```

---

## Completion Truth Gate (IGR, v2.13+)

When IGR is enabled, audits every "done" claim against evidence tiers. Claims with only Tier 0-1 evidence are downgraded to "implemented (unverified)" and task completion is blocked.

---

## Verification Flow Summary

```
Task Completion Attempt
         ↓
┌────────────────────────────────────────────┐
│ 1. Auto-Infer Acceptance Criteria          │
│    - File exists? Function exports? etc.   │
├────────────────────────────────────────────┤
│ 2. Spec Verification                       │
│    - All promised files exist              │
├────────────────────────────────────────────┤
│ 2.5 Git-Verified Claim Check               │
│    - Spec promises match git diff?         │
├────────────────────────────────────────────┤
│ 3. Skeptical Evaluator (L2+)               │
│    - Separate agent grades each criterion  │
├────────────────────────────────────────────┤
│ 3.5 Runtime Verification Gate              │
│    - Auto-generated frontend/backend tests │
├────────────────────────────────────────────┤
│ 4. Integration Wiring Check                │
│    - Created files imported somewhere?     │
├────────────────────────────────────────────┤
│ 4.5 Standards Compliance                   │
│    - Naming, security, decisions.md rules  │
├────────────────────────────────────────────┤
│ 5. Run Quality Gates                       │
│    - tests, lint, typecheck               │
├────────────────────────────────────────────┤
│ 6. Completion Truth Gate (IGR)             │
│    - Evidence tier >= 3 for "done" claims  │
├────────────────────────────────────────────┤
│ 7. Smoke Test (for refactors)              │
│    - App starts without errors             │
├────────────────────────────────────────────┤
│ 8. Security Scan (if enabled)              │
└────────────────────────────────────────────┘
         ↓
    All passed? → Complete task
    Any failed? → Block and report
```

---

## Best Practices

1. **Enable auto-inference** - Saves time on obvious checks
2. **Configure gates per task type** - Features need more than bugfixes
3. **Use regression testing** - Catch breakages early
4. **Enable security scanning** - Catch vulnerabilities before commit

---

## Related

- [Execution Loop](./02-execution-loop.md) - How verification fits in the loop
- [Completion](./04-completion.md) - What happens after verification
- [Safety & Guardrails](../06-safety-guardrails/) - More on security
