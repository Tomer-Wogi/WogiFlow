---
description: "Run a multi-model peer review with different AI perspectives"
effort: high
---
Run a multi-model peer review where different AI models review the same code. This command uses a **different review focus** than `/wogi-review` — it targets **improvement opportunities**, not correctness/bugs.

## Relationship to /wogi-review

| `/wogi-review` | `/wogi-peer-review` |
|----------------|---------------------|
| "Is this correct, secure, working?" | "Is this the BEST approach?" |
| Bug detection | Optimization opportunities |
| Security vulnerabilities | Alternative implementations |
| Architecture conflicts | Pattern suggestions |
| Verification-focused | Improvement-focused |
| Single model (multi-agent) | Multiple external models + optional Claude |

This command does NOT run `/wogi-review`'s 5-phase process. Instead it runs its own flow: collect changes, generate improvement-focused prompt, send to multiple models, compare and synthesize results.

## Usage

```bash
/wogi-peer-review                    # Review staged changes (uses session models)
/wogi-peer-review --files src/*.ts   # Review specific files
/wogi-peer-review --task wf-abc123   # Review task changes
/wogi-peer-review --select-models    # Force model re-selection
/wogi-peer-review --manual           # Manual mode (no API keys needed)
```

## Step 0: Model Selection (Session Persistent)

Models are selected once per session and remembered for subsequent runs.

1. Check `modelConfig.getSessionModels('peerReview')` for existing selection
2. If models already selected AND no `--select-models` flag, reuse them
3. If no models configured (`modelConfig.getEnabledModels().length === 0`), prompt to run `/wogi-models-setup` or use `--manual`
4. Show multi-select dialog with configured models + Claude option (when `modelConfig.shouldIncludeClaude()`)
5. Save selection: `modelConfig.setSessionModels('peerReview', selectedModels)`

**Config**: Models configured in `.workflow/config.json` under `models.providers`. API keys in `.env`.

## Review Flow (v2.23.0+)

```
┌─────────────────────────────────────────────────────────┐
│  /wogi-peer-review                                       │
├─────────────────────────────────────────────────────────┤
│  1. Collect code changes (git diff or specified files)   │
│  2. Classify change size → effort tier:                  │
│     L0/L1 (>10 files)  → opus (latest) xhigh             │
│     L2 (3-10 files)    → sonnet medium                   │
│     L3 (<3 files)      → haiku medium                    │
│     (Model IDs resolve from config.models — avoid        │
│      hardcoding model version in this doc.)              │
│  3. Generate improvement-focused prompt                  │
│  4. If includeClaude enabled:                            │
│     - Launch Claude review (Task agent, Explore type)    │
│  5. External model(s) review via API                     │
│  6. Collect all results, tag each claim with Evidence    │
│     Tier 0-4 (NONE/STATIC/COMPILED/INTERACTIVE/SHIPPED)  │
│  7. Compare findings:                                    │
│     - All agree → Strong suggestion                      │
│     - Partial agree → Present perspectives               │
│     - Disagree → Surface disagreement                    │
│  8. Synthesis Adversary (v2.23.0 — NEW):                 │
│     spawn cross-model agent on DIFFERENT model to        │
│     critique the synthesis itself — does "3/3 agreement" │
│     actually mean "3 models all hallucinated the same    │
│     thing"?                                              │
│  9. Claude synthesizes + incorporates adversary critique │
│  10. Output final synthesis with evidence-tier per claim │
└─────────────────────────────────────────────────────────┘
```

## Review Prompt Template

The peer review prompt focuses on improvements, not correctness, and now demands evidence tiers per claim (v2.23.0+):

```
Review this code for IMPROVEMENT OPPORTUNITIES, not bugs:

1. **Optimization**: Can this be faster/more efficient?
2. **Alternatives**: Are there better approaches?
3. **Patterns**: Does this follow best practices?
4. **Readability**: Could this be clearer/simpler?
5. **Extensibility**: Will this be easy to extend?

For EACH suggestion, tag it with an evidence tier:
  Tier 0 (NONE)         — no evidence, pure opinion
  Tier 1 (STATIC)       — based on reading the code
  Tier 2 (COMPILED)     — would affect compile / type errors
  Tier 3 (INTERACTIVE)  — would affect runtime behavior observably
  Tier 4 (SHIPPED)      — you can cite a production incident

Respond with: specific suggestions, alternative approaches, trade-off
analysis, EACH carrying an explicit evidence tier.
```

## Synthesis Adversary (v2.23.0+ — MANDATORY unless `--no-adversary`)

After initial synthesis, spawn a single adversary agent on a DIFFERENT model from the synthesizer (default `sonnet`; override via the canonical `config.researchReasoningGate.tier3.adversaryModel` — same key used by `/wogi-debug-hypothesis`, `/wogi-learn`, `/wogi-decide`). Prompt:

```
You are the synthesis adversary.

Synthesis claims:
  • [claim 1, tier 2, agreed by 3 models]
  • [claim 2, tier 1, agreed by 2 models]
  • [claim 3, tier 0, 1-model unique insight]

Your job (5 min):
  1. For each claim: could "agreement" be shared hallucination? What would
     refute the claim that couldn't have been seen by all 3 reviewers?
  2. For Tier 0/1 claims: is the evidence actually there in the code, or
     is it vibes-based?
  3. Is there an important suggestion MISSING from the synthesis that a
     human reviewer would flag?

Output:
{
  "shared_hallucination_risk": [list of claim indices with reason],
  "vibes_based_claims": [list of claim indices],
  "missing_suggestions": [list of suggestions the synthesis missed]
}
```

Merge adversary output into the final report — downgrade any claim flagged as shared-hallucination or vibes-based by one evidence tier.

## Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Peer Review Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reviewers: Claude, GPT-4o, Gemini 2.0 Flash

Agreement (3/3 models):
   - Consider using early return for readability
   - Extract repeated logic to helper function

Partial Agreement (2/3 models):
   - Claude + Gemini: Add input validation at boundary
   - GPT-4o: Not necessary for internal function

Disagreement:
   - Claude: Prefer inline styling for this case
   - GPT-4o: Recommend extracting to CSS module
   - Gemini: No strong opinion
   → Resolution: Context-dependent, current approach is valid

Unique Insights:
   - [Claude] Current architecture handles edge case X well
   - [GPT-4o] Consider memoization for expensive computation
   - [Gemini] Similar pattern used in popular library Y

Summary:
   Reviewers: 3 (Claude + 2 external)
   4 actionable improvements identified
   1 disagreement resolved
   Code quality: Good, with minor optimization opportunities
```

## Post-Review: Task Creation

Unlike `/wogi-review` (which finds bugs and creates fix tasks), peer review finds **improvement opportunities**. These are optional enhancements, not required fixes.

**Task creation rules:**
- Strong agreements (2+ models) → Create task if user approves
- Single-model suggestions → Note in tech-debt.json for future
- Disagreements → Document in review report, no task

Present options: [1] Create tasks (P3), [2] Add to tech-debt, [3] Skip (just log).

## Post-Review: Learning Loop

For recurring suggestions across reviews:
1. Same improvement suggested 3+ times → Consider adding to `decisions.md`
2. Pattern disagreement resolved consistently → Document the resolution

## Manual Mode

For manual review (no API keys needed): `/wogi-peer-review --manual`

1. Outputs the review prompt with code changes
2. User runs in Cursor/other AI tool
3. User pastes results back
4. Claude synthesizes all perspectives

## Options

| Flag | Description |
|------|-------------|
| `--select-models` | Force model re-selection (overrides session selection) |
| `--manual` | Manual mode (copy prompt to another AI, paste response back) |
| `--provider <name>` | Override configured provider |
| `--model <name>` | Specify secondary model |
| `--files <glob>` | Review specific files |
| `--task <id>` | Review task changes |
| `--json` | Output JSON for automation |
| `--verbose` | Show full model responses |
| `--create-tasks` | Auto-create tasks for strong agreements |
| `--no-adversary` | Skip the v2.23.0 synthesis adversary (not recommended for L0/L1 diffs) |
| `--adversary-model <id>` | Override adversary model (default: `config.researchReasoningGate.tier3.adversaryModel`, usually `sonnet`) |
| `--effort <level>` | Override effort tier (low/medium/high/xhigh/max) — otherwise derived from diff size |

ARGUMENTS: {args}
