# Build and Run Comprehensive Tests for wogiflow-cloud Server

**ID**: wf-ebb51efe
**Type**: story
**Priority**: P1
**Feature**: community

## User Story

As a WogiFlow maintainer, I want unit tests for pure functions and live smoke tests against the deployed API, so that I can verify the server works correctly and catch regressions.

## Description

The wogiflow-cloud server has zero test coverage. The codebase has several pure functions ideal for unit testing (`extractJson`, `validateContribution`, `validateSuggestion`, `response()`) and 4 live API endpoints that need smoke testing. This story adds a `node --test` based test suite (no extra dependencies) plus a smoke test script that hits the deployed api.wogi.ai endpoints.

## Acceptance Criteria

### Scenario 1: Unit tests for extractJson (pipeline-worker.js)
Given the `extractJson()` function that parses AI responses
When tested with direct JSON, markdown-wrapped JSON, JSON in prose, nested JSON, and invalid input
Then all parse correctly and invalid input returns null

### Scenario 2: Unit tests for validate.js
Given `validateContribution()` and `validateSuggestion()` validators
When tested with valid input, missing fields, invalid UUID, invalid category, oversized content, and PII edge cases
Then valid inputs pass, invalid inputs return `{ valid: false, error: "..." }`

### Scenario 3: Unit tests for response.js
Given the `response()` helper that builds Lambda HTTP responses
When tested with various status codes, bodies, and custom headers
Then it returns correct statusCode, JSON body, Content-Type, and X-Content-Type-Options headers

### Scenario 4: Live smoke tests against api.wogi.ai
Given the deployed API at https://api.wogi.ai
When the smoke test script hits GET /api/health, GET /api/community/knowledge, POST /api/community/contribute (with valid + invalid payloads), and POST /api/community/suggest (with valid + invalid payloads)
Then all endpoints return expected status codes and response shapes

### Scenario 5: npm test script wired up
Given the package.json in packages/server
When `npm test` is run
Then it executes the unit test suite using `node --test`

### Scenario 6: Smoke test is a separate script
Given the smoke tests require network access to api.wogi.ai
When `node tests/smoke.js` is run
Then it executes all endpoint tests and reports pass/fail with a summary

## Technical Notes

### Files to Create
- `packages/server/tests/unit/extract-json.test.js` — extractJson unit tests
- `packages/server/tests/unit/validate.test.js` — validation unit tests
- `packages/server/tests/unit/response.test.js` — response helper unit tests
- `packages/server/tests/smoke.js` — live endpoint smoke tests

### Files to Modify
- `packages/server/package.json` — add `"test"` script
- `packages/server/curation/pipeline-worker.js` — export `extractJson` for testing

### Key Constraints
- Use Node.js built-in `node:test` and `node:assert` — zero additional dependencies
- Smoke tests use built-in `https` module — no axios/fetch polyfill needed
- extractJson is currently module-private; must export it without changing behavior
- Smoke tests must be idempotent (no side effects that pollute the database)
- For contribute/suggest smoke tests, use obviously-fake test data that the intake pipeline will reject

### Boundaries
- Do NOT modify any server logic (routes, pipeline, lib)
- Do NOT add test framework dependencies (jest, mocha, etc.)
- Do NOT create database fixtures or modify database state

## Complexity
Medium — 4 new test files + 2 small modifications, all in a separate repo
