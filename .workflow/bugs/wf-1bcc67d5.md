# wf-1bcc67d5: Research-required gate misses project-specific factual/locational questions

**Created**: 2026-05-12
**Status**: Fixed (v2.32.0)
**Severity**: Critical
**Priority**: P0
**Tags**: #bug #research-required-gate #methodology-hole #cross-repo-implication
**Discovered From**: wogiflow-cli session (sibling Go CLI), user report 2026-05-12
**Discovered During**: cross-project incident

## Bug Summary

When a user asked the wogiflow-cli AI "where do API keys get saved in this project?", the AI answered from a generic prior ("set an env var" → ".env file") — pattern-matching "how do I store a secret" to industry defaults — WITHOUT running a single grep/Read/ls against the codebase. It doubled down twice under pushback, even refining the wrong answer (.zshrc → .env), making it look more considered. Only on the third correction ("you already have 3 keys, where are they?") did it grep and find: `internal/secrets/secrets.go` (fully implemented secrets store, `secrets.toml`, mode 0600), `~/Library/Application Support/wogi/secrets.toml` (already populated), `internal/config/config.go` (`overlaySecrets()` precedence chain). All discoverable on turn 1.

Cost: contradicted committed work; the .env advice would have created a 4th storage location the CLI doesn't even read (no godotenv); modeled "confident assertion ahead of evidence" in a tool whose pitch is "trust me to follow the methodology."

## Root Cause

No rule fired, and one should have:
- **Research Reasoning Gate** (`/wogi-start`): classifies "where does X live?" as **Tier 1 — Factual**, instruction "answer directly from code/docs." That instruction silently assumes the model actually reads the code. Nothing forces the Read. A confident model "answers directly" from its prior and never opens a file.
- **AGENTS.md rule 9** (wogiflow-cli): "diagnostic prompts — 'why did X happen?' requires a Read" — scoped to *causal* questions. A *locational* question ("where is X configured?") falls in the gap between rule 9 and the Tier-1 "just answer" path.
- The **exploring phase** has the right machinery (mandatory evidence-gathering) — but conversational Q&A never enters a phase.

**Precise missing rule**: any project-specific factual OR locational question requires at least one Read/Grep/Glob against the actual codebase before an answer is emitted — and the answer must cite what was read. No "Tier 1 → answer directly" shortcut without the underlying lookup.

## Fix (v2.32.0, WogiFlow npm)

1. **`scripts/hooks/core/research-required-classifier.js`**: new `LOCATIONAL_PATTERNS` ("where is/does/are X", "which file/module/function", "how does the X work", "how is X configured", "show me/list all the X", "in this project/codebase ... where/how/which"). These classify as a new `locational` category that — like `diagnostic` — writes the evidence marker (`GATED_CATEGORIES = {diagnostic, locational}`). `FACTUAL_PATTERNS` (the no-marker bucket) NARROWED to only truly-generic ("what is a/an &lt;concept&gt;", "what does X mean", "how many X in a Y"). `applyClassification` returns a `nudge` string for the orchestrator.
2. **`scripts/hooks/core/user-prompt-orchestrator.js`** + **`scripts/hooks/adapters/claude-code.js`**: surface the nudge as `researchRequiredNudge` additionalContext — an UPFRONT reminder ("Read BEFORE answering; cite the file:line") so the model is steered before it answers, not just re-prompted after.
3. **`scripts/hooks/core/research-required-gate.js`** (Stop-hook backstop): re-prompt message sharpened for the `locational` category — explicitly names the failure shape ("answering 'where X lives' from memory, doubling down"), makes citing the file:line MANDATORY (was "where appropriate"), counts Glob/Grep as evidence.
4. **`.claude/commands/wogi-start.md`**: Research Reasoning Gate tier table split — Tier 1a (generic factual, answer directly) vs Tier 1b (project-specific factual/locational, MUST Read + cite first). Added a "why Tier 1b exists" callout referencing this incident.

## Cross-repo implication (wogiflow-cli — NOT done here)

Per AGENTS.md §0 ("don't port the hook, bake the intent into the loop"), the CLI must make this intrinsic to its agent loop — a Read-before-answer requirement for locational/project-factual questions, with citation. That's the CLI's task; this bug spec is the npm-side fix. Filed-as-note for the CLI maintainer.

## Acceptance Criteria

### Scenario 1: locational question is gated
**Given** a user asks "where do API keys get saved in this project?"
**When** UserPromptSubmit fires
**Then** the classifier writes the evidence marker with `category: 'locational'`, AND an upfront nudge ("Read/Grep first; cite") is surfaced as additionalContext.

### Scenario 2: answer without evidence is re-prompted
**Given** the marker is set
**When** the AI produces a text answer with 0 evidence Reads in the turn
**Then** the Stop hook re-prompts with the locational-specific violation message demanding a Read + citation.

### Scenario 3: generic-knowledge questions still pass freely
**Given** "what is a closure?" / "how many days in a year?"
**When** UserPromptSubmit fires
**Then** no marker is written; the AI answers directly.

## Resolution
- **Fixed in**: v2.32.0 (commit pending)
- **Root cause confirmed**: yes — the user's root-cause analysis was exact
- **Tests added**: tests/flow-research-required-gate.test.js — locational classification (10 cases), locational applyClassification + nudge, GATED_CATEGORIES contract
