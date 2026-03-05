# Story: Overhaul wogi-hybrid — Multi-Model Routing & Workflow Integration

**ID**: wf-dc55c22b
**Type**: story
**Feature**: hybrid
**Priority**: P1
**Complexity**: High
**Created**: 2026-02-23

## User Story

As a WogiFlow user, I want hybrid mode to work as a **multi-model execution system** where the planning model (Opus) delegates tasks to cheaper/faster models (Haiku, Sonnet, GPT-4o-mini, Gemini Flash), so that I get faster execution at lower cost while maintaining quality.

## Description

Hybrid mode exists but has significant gaps: 4 scripts referenced in docs don't exist, a crash bug in detect.js, no smart model routing, and no integration with the current workflow pipeline (phase gating, explore phase, standards checks). The config already supports cloud models, but the UX and commands frame it as "local LLM only". This story fixes the broken parts, reframes hybrid as multi-model execution, and adds intelligent model selection.

**Key reframing:** "Hybrid" doesn't mean "local LLM" — it means "multiple models collaborating". Opus plans, cheaper models execute. This works with:
- Local LLMs (Ollama, LM Studio) — free tokens
- Cloud models (Haiku, Sonnet, GPT-4o-mini, Gemini Flash) — cheap tokens
- Mixed setups — different models for different task types

## Acceptance Criteria

### Scenario 1: Fix crash bug in flow-hybrid-detect.js
Given flow-hybrid-detect.js line 165 references `err.message`
When the catch block parameter is `e`
Then fix the variable to use `err` (per naming conventions) and verify the script doesn't crash on detection failure

### Scenario 2: Clean up wogi-hybrid.md — remove references to non-existent scripts
Given wogi-hybrid.md references 4 scripts that don't exist (flow-model-profile.js, flow-task-classifier.js, flow-failure-learning.js, flow-context-generator.js)
When the command is invoked
Then it should only reference features that actually work, with aspirational features moved to roadmap

### Scenario 3: Reframe hybrid commands as "multi-model execution"
Given all 5 hybrid commands (hybrid, hybrid-setup, hybrid-status, hybrid-edit, hybrid-off)
When reading the command documentation
Then the language should frame hybrid as "multi-model execution" supporting local LLMs, cheap cloud models (Haiku, Sonnet, GPT-4o-mini, Gemini Flash), and mixed setups — not just "local LLM"

### Scenario 4: Add smart model routing to wogi-hybrid.md
Given Opus is the planning model
When a task is delegated to hybrid execution
Then the command should include logic for Opus to select the executor model based on task type:
- Simple file edits → cheapest model (Haiku, GPT-4o-mini)
- Code generation → mid-tier (Sonnet, GPT-4o)
- Complex refactoring → keep on Opus (don't delegate)
This routing table should be configurable in config.json.

### Scenario 5: Fix wogi-hybrid-edit.md skeleton
Given wogi-hybrid-edit.md is an empty skeleton
When a user invokes `/wogi-hybrid-edit`
Then it should show the current execution plan (from `.workflow/state/current-plan.json`) and allow step modification, or clearly state "no active plan" if none exists

### Scenario 6: Integrate hybrid with workflow pipeline
Given hybrid mode is enabled and a task is started via `/wogi-start`
When the execution reaches the implementation phase
Then hybrid should respect:
- Phase gating (only execute in `coding` phase)
- The existing explore phase research (use research findings in the plan)
- Standards compliance (run standards check on hybrid-generated code)
- Post-edit validation (lint/typecheck after each hybrid-executed edit)

### Scenario 7: Add hybrid decision rules to decisions.md
Given no hybrid-specific rules exist in decisions.md
When hybrid mode is used
Then decisions.md should include rules for:
- When to use hybrid vs direct execution
- Model selection guidelines (task type → model tier)
- Failure escalation (if cheaper model fails, escalate to Opus)
- Security: never send code outside the machine with local LLMs; cloud models follow existing API key security

### Scenario 8: All 5 hybrid commands work end-to-end
Given hybrid mode is configured with a cloud provider (e.g., Anthropic with Haiku)
When running the full flow: `/wogi-hybrid-setup` → `/wogi-hybrid` → `/wogi-hybrid-status` → `/wogi-hybrid-edit` → `/wogi-hybrid-off`
Then each command completes without errors and the state transitions are correct (enabled → configured → status shown → plan editable → disabled)

## Technical Notes

### Files to Modify
- `.claude/commands/wogi-hybrid.md` — Rewrite: multi-model framing, smart routing, remove dead script references
- `.claude/commands/wogi-hybrid-setup.md` — Update: cloud model prominence, multi-model framing
- `.claude/commands/wogi-hybrid-edit.md` — Implement: actual plan editing logic
- `.claude/commands/wogi-hybrid-status.md` — Update: show model routing table
- `.claude/commands/wogi-hybrid-off.md` — Minor: ensure clean disable
- `scripts/flow-hybrid-detect.js` — Fix: line 165 bug (`e` → `err`)
- `.workflow/state/decisions.md` — Add: hybrid decision rules section
- `.workflow/config.json` — Add: model routing table under `hybrid.routing`

### Config Addition: Model Routing Table
```json
{
  "hybrid": {
    "routing": {
      "enabled": true,
      "rules": [
        { "taskType": "simple-edit", "model": "cheapest", "description": "Typos, text changes, config edits" },
        { "taskType": "code-generation", "model": "mid-tier", "description": "New functions, components, tests" },
        { "taskType": "refactoring", "model": "planner", "description": "Keep on Opus — too complex to delegate" },
        { "taskType": "documentation", "model": "cheapest", "description": "README, comments, docs" }
      ],
      "tiers": {
        "cheapest": ["claude-3-5-haiku-latest", "gpt-4o-mini", "gemini-2.0-flash-exp"],
        "mid-tier": ["claude-3-5-sonnet-latest", "gpt-4o", "gemini-1.5-pro"],
        "planner": "current"
      }
    }
  }
}
```

### Boundaries (DO NOT modify)
- `scripts/flow-hybrid-interactive.js` — 801-line wizard, works correctly, out of scope
- `templates/hybrid/` — Task templates, working correctly
- `scripts/flow-hybrid-test.js` — Tests, leave as-is

### Deferred to Roadmap
- `flow-model-profile.js` — Model capability profiling (v2.1 aspiration)
- `flow-task-classifier.js` — AI-powered task type classification (v2.1)
- `flow-failure-learning.js` — Adaptive failure recovery (v2.1)
- `flow-context-generator.js` — Smart context compression (v2.1)

## Test Strategy

- **Unit**: Verify `flow-hybrid-detect.js` doesn't crash on errors (node --check + manual error simulation)
- **Integration**: Verify all 5 commands load without errors
- **Syntax**: `node --check` on all modified JS files
- **Config**: Verify config.json parses correctly after routing table addition

## Dependencies

- Phase gate system (wf-b9f5b675) — completed, hybrid needs to respect phase restrictions

## Estimation

- Files to change: ~8
- Lines of change: ~400-600 (mostly command .md rewrites)
- Complexity: High (cross-cutting changes across commands, scripts, config, decisions)
