# TDD Mode Reference

Loaded when `--tdd` flag is used or `config.tdd.enforced` is true.

## Activation

- Global: `config.tdd.enforced: true`
- Per-task: `/wogi-start wf-XXXXXXXX --tdd`
- Per-type: `config.tdd.defaultForTypes: ["bugfix"]`

## Execution Loop (replaces normal Step 3)

For each acceptance criterion:

1. **Mark in_progress** in TodoWrite
2. **Write test** for this criterion (Given/When/Then → test assertion)
3. **Run test → MUST FAIL** (proves test is meaningful)
   - If test passes before implementation → WARNING: test may be trivial
   - Record failure output (the "before" state)
4. **Implement** the feature following matched skill patterns
5. **Run test → MUST PASS**
   - If still fails → debug and fix (max 5 retries)
6. **Run full verification** (lint, typecheck, all tests)
7. **Save TDD artifact** to `.workflow/verifications/` with before/after results
8. **Mark completed** only when all tests pass

## Test Framework Detection

When `config.tdd.testFrameworkDetection` is true, auto-detect from package.json:
jest, vitest, mocha, tap, or fallback to `node --test`.
