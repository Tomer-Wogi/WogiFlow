# Story: Rewrite README as concise feature summary with KB deep-links

**ID**: wf-0a744cdd
**Type**: story
**Feature**: docs
**Priority**: P1
**Complexity**: Medium

## User Story

As a developer discovering WogiFlow, I want a concise README that summarizes all features at a glance with links to detailed docs, so that I can quickly understand what WogiFlow does without being overwhelmed.

## Description

The current README is accurate but massively incomplete — it documents ~13 of 100+ CLI commands and is missing 15+ major features built recently (registry system, semantic matching, framework discovery, consumer impact analysis, etc.). Meanwhile, the knowledge base has outdated articles (workflow-steps.md describes a non-existent YAML engine) and the command reference has phantom commands.

The goal: rewrite README as a **concise feature catalog** — one-liner per feature, one-liner per command category — with KB deep-links for people who want details. Also clean up the KB and commands.md.

## Acceptance Criteria

### Scenario 1: README is concise with one-liner features
Given the README exists
When a developer reads it
Then every major feature has a single-row description in a table
And no feature section exceeds 5 lines (excluding code blocks)
And the total README is under 200 lines

### Scenario 2: All current features are represented
Given the README feature table
When compared against the actual codebase capabilities
Then these features are all listed: Task Gating, Self-Completing Tasks, Multi-Agent Explore Phase, Extensible Registry, AI-Judge Semantic Matching, Framework Discovery, Consumer Impact Analysis, Component/Function/API Registries, Adversarial Code Review, Git-Verified Claims, TDD Mode, Phased Execution, Hybrid Mode, Peer Review, Skills System, Research Protocol, Worktree Isolation, Parallel Execution, Memory Systems, Durable Sessions, Debug Hypothesis, Browser Debug/Test, Decision Tracking, Cross-Artifact Consistency

### Scenario 3: Commands are summarized with KB deep-links
Given the README command section
When a developer looks for a command
Then slash commands are grouped by category with one-liner descriptions
And CLI commands are grouped by category with one-liner descriptions
And each category links to the relevant KB section for details

### Scenario 4: KB deep-links are valid
Given the README references KB articles
When following any link
Then the linked file exists and contains relevant content

### Scenario 5: Outdated KB article removed
Given workflow-steps.md describes a non-existent YAML workflow engine
When the cleanup is complete
Then workflow-steps.md is deleted or rewritten to describe the actual task execution flow

### Scenario 6: Phantom command removed from commands.md
Given /wogi-done is documented in commands.md but has no implementation
When the cleanup is complete
Then /wogi-done is removed from commands.md

### Scenario 7: Undocumented commands added to commands.md
Given commands like /wogi-decide, /wogi-learn, /wogi-retrospective, /wogi-log exist as .md files
When the cleanup is complete
Then all commands with .md files are listed in commands.md

### Scenario 8: future-features.md is updated
Given future-features.md lists already-implemented features
When the cleanup is complete
Then implemented features are moved to a "Recently Shipped" section or removed

## Technical Notes

### Files to Change
- `README.md` — Full rewrite (main deliverable)
- `.claude/docs/commands.md` — Remove phantom, add missing commands
- `.claude/docs/knowledge-base/02-task-execution/workflow-steps.md` — Delete or rewrite
- `.claude/docs/knowledge-base/future-features.md` — Update stale entries

### Files to Reference (read-only)
- `.claude/commands/wogi-*.md` — Source of truth for command list
- `scripts/flow-*.js` — Source of truth for CLI commands
- `.workflow/config.json` — Feature flags to verify what's active

### Boundaries (do NOT modify)
- `.workflow/config.json`
- `.workflow/templates/` (CLAUDE.md template)
- `CLAUDE.md` (generated file)
- Any `scripts/` files
- Any `.claude/commands/` files

## Test Strategy
- Manual: Verify all KB links resolve to existing files
- Manual: Verify README is under 200 lines
- Manual: Verify all commands with .md files appear in commands.md
- Syntax: `node --check` not applicable (markdown only)

## Dependencies
None
