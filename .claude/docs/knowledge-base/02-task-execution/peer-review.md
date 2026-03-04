# Peer Review

Multi-model code review focused on improvement opportunities.

---

## Purpose

The `/wogi-peer-review` command sends your code to multiple AI models for independent review, then synthesizes their perspectives. Unlike `/wogi-review` which checks for correctness and bugs, peer review focuses on **improvement opportunities** -- better approaches, optimization, and alternative patterns.

Use it when:
- You want a second (and third) opinion on your approach
- You are choosing between implementation strategies
- You want to discover optimization opportunities
- You want diverse perspectives from different AI models

---

## How It Differs from /wogi-review

| Aspect | /wogi-review | /wogi-peer-review |
|--------|-------------|-------------------|
| Focus | "Is this correct, secure, working?" | "Is this the BEST approach?" |
| Finds | Bugs, security vulnerabilities | Optimization opportunities |
| Scope | Architecture conflicts, standard violations | Alternative implementations, pattern suggestions |
| Models | Single model (multi-agent) | Multiple external models + optional Claude |
| Output | Findings with fix recommendations | Synthesized perspectives with trade-off analysis |

---

## Configuration

Model providers are configured in `.workflow/config.json` under `models.providers`. API keys are stored in `.env`.

Models are selected once per session and remembered for subsequent runs. Use `--select-models` to force re-selection.

If no models are configured (`models.providers` is empty), the command prompts you to run `/wogi-models-setup` or use `--manual` mode.

---

## How It Works

### Review Flow

1. **Collect changes** -- Gather code from git diff, specified files, or a task's changes
2. **Generate prompt** -- Build an improvement-focused review prompt (not bug-focused)
3. **Send to reviewers** -- Launch Claude review (if enabled) and external model reviews in parallel
4. **Collect results** -- Gather all model responses
5. **Compare findings** -- Categorize into agreements, partial agreements, and disagreements
6. **Synthesize** -- Claude synthesizes all perspectives into a final report

### Review Prompt Focus

The review prompt asks models to evaluate code on:

1. **Optimization** -- Can this be faster or more efficient?
2. **Alternatives** -- Are there better approaches?
3. **Patterns** -- Does this follow best practices?
4. **Readability** -- Could this be clearer or simpler?
5. **Extensibility** -- Will this be easy to extend?

### Finding Classification

Findings are classified based on model agreement:

| Agreement Level | Meaning | Action |
|----------------|---------|--------|
| All agree | Strong suggestion -- all models recommend the same improvement | High-confidence actionable item |
| Partial agree | 2+ models agree, others differ | Present all perspectives for user decision |
| Disagree | Models recommend different approaches | Surface the disagreement with trade-offs |
| Unique insight | Only one model caught something | Highlight as a perspective worth considering |

---

## Commands

```bash
/wogi-peer-review                    # Review staged changes
/wogi-peer-review --files src/*.ts   # Review specific files
/wogi-peer-review --task wf-abc123   # Review a task's changes
/wogi-peer-review --select-models    # Force model re-selection
/wogi-peer-review --manual           # Manual mode (no API keys needed)
```

### Flags

| Flag | Description |
|------|-------------|
| `--select-models` | Force model re-selection (overrides session selection) |
| `--manual` | Manual mode -- outputs prompt for use in another AI tool |
| `--provider <name>` | Override configured provider |
| `--model <name>` | Specify secondary model |
| `--files <glob>` | Review specific files |
| `--task <id>` | Review a specific task's changes |
| `--json` | Output JSON for automation |
| `--verbose` | Show full model responses |
| `--create-tasks` | Auto-create tasks for strong agreements |

---

## Output

```
Peer Review Results

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
   -> Resolution: Context-dependent, current approach is valid

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

---

## Manual Mode

When you do not have API keys configured for external models, use `--manual`:

1. The command outputs the review prompt with your code changes
2. Copy the prompt and run it in another AI tool (Cursor, ChatGPT, etc.)
3. Paste the results back
4. Claude synthesizes all perspectives together

This gives you multi-model review without needing API keys in your project.

---

## Post-Review Actions

Peer review finds improvement opportunities, not bugs. These are optional enhancements:

| Agreement | Action |
|-----------|--------|
| Strong agreements (2+ models) | Create task if user approves (P3 priority) |
| Single-model suggestions | Note in `tech-debt.json` for future consideration |
| Disagreements | Document in review report, no task created |

### Learning Loop

When the same improvement is suggested across 3+ separate reviews, it may warrant a new rule in `decisions.md` via `/wogi-decide`.

---

## Best Practices

1. **Use for important code paths** -- Peer review is most valuable for critical business logic, not boilerplate
2. **Try manual mode first** -- If you are new to the feature, manual mode lets you experiment without API setup
3. **Pay attention to disagreements** -- Model disagreements often reveal genuine trade-offs worth understanding
4. **Do not treat all suggestions equally** -- Strong agreements carry more weight than unique insights
5. **Combine with /wogi-review** -- Use `/wogi-review` for correctness, then `/wogi-peer-review` for optimization

---

## Related

- [Session Review](./05-session-review.md) -- End-of-session code review
- [Verification](./03-verification.md) -- Quality gates
- [Eval System](./eval-system.md) -- Task output quality scoring
- [Model Management](./model-management.md) -- Model configuration
