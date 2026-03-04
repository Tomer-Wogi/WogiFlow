---
description: "Run a multi-model peer review with different AI perspectives"
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

## Review Flow

```
┌─────────────────────────────────────────────────────────┐
│  /wogi-peer-review                                       │
├─────────────────────────────────────────────────────────┤
│  1. Collect code changes (git diff or specified files)   │
│  2. Generate improvement-focused prompt                  │
│  3. If includeClaude enabled:                            │
│     - Launch Claude review (Task agent, Explore type)    │
│  4. External model(s) review via API                     │
│  5. Collect all results                                  │
│  6. Compare findings:                                    │
│     - All agree → Strong suggestion                      │
│     - Partial agree → Present perspectives               │
│     - Disagree → Surface disagreement                    │
│  7. Claude synthesizes and responds to feedback           │
│  8. Output final synthesis                               │
└─────────────────────────────────────────────────────────┘
```

## Review Prompt Template

The peer review prompt focuses on improvements, not correctness:

```
Review this code for IMPROVEMENT OPPORTUNITIES, not bugs:

1. **Optimization**: Can this be faster/more efficient?
2. **Alternatives**: Are there better approaches?
3. **Patterns**: Does this follow best practices?
4. **Readability**: Could this be clearer/simpler?
5. **Extensibility**: Will this be easy to extend?

Respond with: specific suggestions, alternative approaches, trade-off analysis.
```

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

ARGUMENTS: {args}
