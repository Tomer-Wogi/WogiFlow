# [wf-9bcb4fa8] Phase 1: Critical Security Fixes - Command injection, path traversal, and shell injection vulnerabilities

## User Story
**As a** developer using wogi-flow
**I want** all command execution and path handling to be secure
**So that** the workflow system is protected from injection attacks and unauthorized file access

## Description
Fix 19 CRITICAL security vulnerabilities identified in the comprehensive code review. These include command injection via execSync with unsanitized user input, path traversal vulnerabilities, and shell injection in git commands. Create shared security utilities to ensure consistent security patterns across the codebase.

## Acceptance Criteria

### Scenario 1: Create shared security utilities
**Given** the need for consistent security patterns
**When** security functions are needed across multiple files
**Then** a new flow-security.js file provides: validatePathWithinProject, safeExecFile, safeGitCommand, escapeRegex, validateGitRef, validateRepoFormat
**And** all functions have proper input validation

### Scenario 2: Fix command injection in flow-code-intelligence.js
**Given** the functions findFilesImporting and searchCodebase use execSync with string interpolation
**When** user-controlled input is passed (keyword, basename)
**Then** the commands use execFileSync with array arguments instead
**And** patterns are properly escaped

### Scenario 3: Fix command injection in flow-adaptive-learning.js
**Given** the createPR function uses execSync with repo names and branch names
**When** creating PRs and cloning repos
**Then** all git commands use safeGitCommand or execFileSync with arrays
**And** repository format is validated before use

### Scenario 4: Fix path traversal in flow-orchestrate.js
**Given** file paths are passed to eslint and tsc commands
**When** a path contains traversal sequences (../)
**Then** the path is validated to be within project root
**And** invalid paths are rejected with clear error

### Scenario 5: Fix git command injection in flow-worktree.js
**Given** the git function uses execSync with string interpolation
**When** branch names or commit messages contain shell metacharacters
**Then** the git helper uses execFileSync with array arguments
**And** all callers pass arguments as arrays

### Scenario 6: Fix path traversal in flow-durable-session.js
**Given** the checkFileCondition function uses watchPath from config
**When** the watchPath contains traversal sequences
**Then** the path is validated to be within project root before access
**And** traversal attempts return an error condition

## Technical Notes
- **Files to modify**:
  - scripts/flow-code-intelligence.js (lines 395-416, 662-666)
  - scripts/flow-adaptive-learning.js (lines 952, 984, 1001)
  - scripts/flow-orchestrate.js (lines 2841, 2897)
  - scripts/flow-worktree.js (lines 44-58, 148, 200, 207)
  - scripts/flow-durable-session.js (lines 938-941)
- **New file**: scripts/flow-security.js - shared security utilities
- **Pattern**: Replace `execSync(\`cmd ${var}\`)` with `execFileSync('cmd', [var])`
- **Pattern**: Add `validatePathWithinProject()` before file operations with user input

## Test Strategy
- [x] Manual: Verify commands work after security fixes
- [x] Manual: Test with paths containing "../" to verify rejection

## Dependencies
- None

## Complexity
High - Touches multiple core files, requires careful testing

## Out of Scope
- Race condition fixes (Phase 2)
- API security improvements (Phase 3)
