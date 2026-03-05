# Audit & Fix All wogi-* Command Flows for Workflow Integration

**ID**: wf-dff7f8ec
**Type**: story
**Feature**: workflow
**Priority**: P1
**Complexity**: High
**Created**: 2026-02-23

## User Story

As a WogiFlow user, I want all `/wogi-*` commands to properly integrate with the current workflow architecture (phase gating, routing gate, standards compliance, explore phase), so that every command works reliably end-to-end when invoked.

## Description

Recent overhauls added major enforcement mechanisms: phase state machine (7 phases), routing gate (blocks Bash before routing), standards compliance, multi-agent explore phase, and consumer impact analysis. Many existing `/wogi-*` commands predate these overhauls and may reference non-existent scripts, use outdated patterns, or lack integration with the new enforcement pipeline.

This audit covers all 61 command files in `.claude/commands/wogi-*.md` to ensure consistency and correctness.

## Scope

### Commands to Audit (61 total)

**Tier 1 — Execution-path commands (modify files, create tasks, need deep audit):**
- wogi-review-fix.md — Fix loop, needs phase/task gating
- wogi-bulk.md — Multi-task orchestration
- wogi-bulk-loop.md — Continuous work loop
- wogi-guided-edit.md — Step-by-step editing
- wogi-extract-review.md — Zero-loss extraction

**Tier 2 — Investigation/analysis commands (read-only, verify patterns):**
- wogi-research.md — Zero-trust research protocol
- wogi-peer-review.md — Multi-model review
- wogi-debug-hypothesis.md — Parallel hypothesis debugging
- wogi-trace.md — Code flow tracing
- wogi-bug.md — Bug investigation & fix
- wogi-debug-browser.md — WebMCP browser debugging
- wogi-test-browser.md — WebMCP browser testing
- wogi-triage.md — Review findings walkthrough

**Tier 3 — Management/display commands (verify references, light audit):**
- wogi-epics.md, wogi-feature.md, wogi-plan.md — Hierarchy management
- wogi-ready.md, wogi-status.md, wogi-health.md, wogi-morning.md — Status display
- wogi-capture.md, wogi-debt.md, wogi-changelog.md — Tracking
- wogi-models-setup.md, wogi-config.md, wogi-rules.md — Configuration
- wogi-init.md, wogi-onboard.md, wogi-setup-stack.md — Setup/onboarding
- wogi-decide.md, wogi-learn.md, wogi-retrospective.md — Learning
- wogi-compact.md, wogi-context.md, wogi-search.md, wogi-log.md — Utilities
- wogi-suspend.md, wogi-resume.md, wogi-deps.md — Task lifecycle
- wogi-correction.md, wogi-skill-learn.md, wogi-skills.md — Skills/corrections
- wogi-map*.md (6 files) — Component registry
- wogi-standup.md, wogi-import.md, wogi-export.md — Misc
- wogi-rescan.md, wogi-help.md, wogi-statusline-setup.md — Misc

**Already audited/overhauled (skip):**
- wogi-start.md — Main execution engine (comprehensive)
- wogi-review.md — 5-phase review protocol (comprehensive)
- wogi-story.md — Story creation (comprehensive)
- wogi-session-end.md — Session end (comprehensive)
- wogi-roadmap.md — Roadmap management (comprehensive)
- wogi-hybrid*.md (5 files) — Just overhauled

## Acceptance Criteria

### AC1: Dead Script Reference Audit
**Given** all 61 wogi-* command files
**When** every script path referenced (via `node scripts/flow-*.js` or `require('./scripts/flow-*.js')`) is checked
**Then** every referenced script either exists OR the reference is removed/updated

### AC2: Tier 1 Commands — Phase Gating Integration
**Given** execution-path commands that modify files (wogi-review-fix, wogi-bulk, wogi-bulk-loop, wogi-guided-edit, wogi-extract-review)
**When** they are invoked
**Then** they either:
- Create a tracked task in `ready.json` inProgress before editing files, OR
- Document why phase gating is not applicable (e.g., they operate within an existing `/wogi-start` context)

### AC3: Tier 2 Commands — Read-Only Verification
**Given** investigation/analysis commands (wogi-research, wogi-peer-review, wogi-debug-hypothesis, wogi-trace, wogi-bug, wogi-debug-browser, wogi-test-browser, wogi-triage)
**When** they are invoked
**Then** they explicitly use read-only tools (Glob, Grep, Read, WebSearch, WebFetch) and do NOT use Edit/Write/NotebookEdit, OR if they do modify files (wogi-bug routes to wogi-start for fix), the modification path goes through proper task gating

### AC4: Tier 3 Commands — Reference Correctness
**Given** management/display commands
**When** they reference scripts, config keys, or state files
**Then** all references point to existing files/keys and use current naming conventions

### AC5: wogi-start Routing Table Completeness
**Given** the CLAUDE.md Natural Language Detection table and wogi-start's Command Catalog
**When** compared against all 61 commands
**Then** every command is either:
- Listed in the NLD table with trigger phrases, OR
- Listed in the Command Catalog for wogi-start routing, OR
- An internal/auto-invoked command (documented as such)

### AC6: Pattern Consistency Across Commands
**Given** patterns established by the overhauled commands (wogi-start, wogi-review, wogi-hybrid)
**When** other commands reference workflow concepts
**Then** they use consistent terminology:
- "explore phase" (not "research phase")
- "phase gating" (not "phase transitions")
- "ready.json" (not "tasks.json")
- "decisions.md" (not "rules.md")
- Task IDs use `wf-[8hex]` format (not descriptive IDs)

### AC7: No Stale ARGUMENTS Pattern
**Given** commands that use `ARGUMENTS: $ARGUMENTS` placeholder
**When** the command file is checked
**Then** the ARGUMENTS line is at the END of the file and follows the pattern established by recent overhauls

### AC8: All Fixes Verified
**Given** all changes made during this audit
**When** syntax-checked
**Then** all modified `.js` files pass `node --check` and all modified `.json` files parse successfully

## Technical Notes

### Audit Methodology
For each command file:
1. Read the full file content
2. Extract all script references (`scripts/flow-*.js`)
3. Verify each reference exists on disk
4. Check for outdated patterns (old config keys, old state file names)
5. Verify workflow integration (phase gating, task gating, standards)
6. Fix any issues found
7. Verify fixes with syntax checks

### Known Issues from Prior Work
- wogi-hybrid*.md had 4 non-existent script references (fixed in wf-dc55c22b)
- `flow-review-passes` is a directory, not a `.js` file (the `require` resolves via `index.js` — this is correct)
- wogi-init.md and wogi-onboard.md have the most script references (15+ each) — these need careful verification

### Files That Will NOT Be Modified
- wogi-start.md (already comprehensive)
- wogi-review.md (already comprehensive)
- wogi-story.md (already comprehensive)
- wogi-hybrid*.md (just overhauled)
- wogi-session-end.md (already comprehensive)
- wogi-roadmap.md (already comprehensive)

## Test Strategy

- **Verification**: `node --check` on all modified `.js` files
- **JSON validation**: Parse all modified `.json` files
- **Cross-reference**: Grep all `.md` files for old patterns after fixes
- **Completeness**: Count commands audited vs total (must be 61/61)

## Dependencies

- wf-dc55c22b (Hybrid overhaul) — COMPLETED
- wf-b9f5b675 (State machine enforcement) — COMPLETED
