---
description: "Generate test files from task spec acceptance criteria"
effort: low
---

Generate executable test files from a task's specification acceptance criteria.

## Prerequisites

- A spec file must exist at `.workflow/specs/wf-XXXXXXXX.md`
- `config.testing.enabled` must be `true`
- `config.testing.generation.autoGenerate` must be `true`

## Procedure

### 1. Load Context

1. Read the spec file at `.workflow/specs/{taskId}.md`
2. Read `config.testing` to determine what test types to generate
3. Read `config.testing.generation` for output directory and edge case settings

### 2. Detect Project Test Conventions

Run `node node_modules/wogiflow/scripts/flow-test-generate.js {taskId} --detect-only` to get:
- Test framework (jest, vitest, mocha, node:test)
- Import style (ES modules vs CommonJS)
- Test structure patterns (describe/it nesting, assertion library)
- File extension preference (.ts vs .js)

If no existing tests found, default to the test framework detected in package.json.

### 3. Parse Spec Criteria

For each acceptance criterion in the spec (Given/When/Then format):
1. Extract the Given (precondition), When (action), Then (assertion)
2. Categorize the criterion by type using keyword analysis:

**UI criteria** — keywords: "page shows", "user sees", "displays", "renders", "screen", "visible", "clicks", "button", "modal", "form", "input", "navigates", "appears", "layout":
→ Generate Playwright/browser test

**API criteria** — keywords: "API returns", "endpoint", "response", "status code", "request", "returns JSON", "POST", "GET", "PUT", "DELETE", "header", "payload", "authenticated":
→ Generate HTTP/API test

**Logic/Unit criteria** — keywords: "calculates", "transforms", "validates", "returns", "throws", "parses", "converts", "filters", "sorts", "maps", "reduces", "creates", "generates":
→ Generate unit test

**Integration criteria** — keywords: "calls API then", "data flows from", "end-to-end", "full flow", "persists", "syncs", "propagates":
→ Generate integration test (for fullstack projects, this includes data integrity checks)

### 4. Generate Test Files

Run `node node_modules/wogiflow/scripts/flow-test-generate.js {taskId}` to generate test scaffolds.

Output goes to `{config.testing.generation.outputDir}/{taskId}/`:
- `unit.spec.{ts|js}` — unit tests for logic criteria
- `api.spec.{ts|js}` — API tests for endpoint criteria
- `ui.spec.{ts|js}` — UI tests for visual/interaction criteria
- `integration.spec.{ts|js}` — integration tests for cross-boundary criteria

Each generated test file:
- Uses the project's detected test framework and import style
- Includes proper imports (describe, it, expect from the correct package)
- Has one `describe` block per acceptance criterion
- Has one `it` block per Given/When/Then with comments marking each phase
- Includes deliberate `expect(true).toBe(false)` assertions that FAIL until implemented
- Adds edge case tests when `config.testing.generation.includeEdgeCases` is true

### 5. Edge Cases (when `includeEdgeCases: true`)

For each criterion, auto-generate additional test cases:
- **Empty state**: What happens with no data / empty input?
- **Error state**: What happens when the operation fails?
- **Boundary values**: Min/max values, empty strings, null, undefined
- **Loading state**: Async operations — what shows while loading?

### 6. Fullstack Data Integrity Tests (for fullstack projects)

When the project is `fullstack` (has both UI and API):
- For criteria that span both layers, generate a data integrity test
- Pattern: Call API → verify response → verify UI reflects the data
- These go in `integration.spec.{ts|js}`

### 7. Report

After generation, report:
- Number of test files created
- Number of test cases per file
- Criteria coverage (which AC items have tests)
- Edge cases added

## TDD Validation

Generated tests are designed to:
1. **FAIL before implementation** — all assertions use placeholder values
2. **PASS after implementation** — once the actual code is written, replace placeholders with real assertions

During `/wogi-start` Step 3, verify:
- Run generated tests BEFORE implementing → they should all fail
- Run generated tests AFTER implementing → they should all pass
- If any test passes before implementation → WARNING: test may be trivial

ARGUMENTS: {args}
