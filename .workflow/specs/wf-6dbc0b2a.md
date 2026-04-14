# wf-6dbc0b2a: Research Reasoning Gate — assumption surfacing + adversary for conversation/research mode

## Problem

When `/wogi-start` classifies a request as conversation/research mode, the AI operates with zero reasoning guardrails. This leads to plausible-sounding but wrong analysis — the AI makes domain model assumptions the user doesn't share and presents confident recommendations built on those unchecked assumptions.

## Real-World Failure Case

A user asked the workspace manager to research task statuses. The AI:
1. Correctly inventoried all statuses from the codebase
2. Recommended "move estimate statuses out of TaskStatus into separate entities"
3. This contradicted the user's own stated model ("an estimate is just a state in the task lifecycle")
4. The AI only corrected after the user pushed back

The root cause was NOT missing self-reflection — the AI genuinely believed its recommendation was sound. The root cause was an **unchecked domain assumption** (estimates are separable from tasks) that contradicted the user's mental model.

## Why Self-Reflection Doesn't Work Here

The first version of this spec proposed a 3-step self-adversary check where the same model critiques its own answer. This was rejected because:

1. **Same-model self-critique is a known rubber-stamp.** This is why IGR uses a different model for the Adversary. The AI that confidently recommended "split entities" would just as confidently conclude "my recommendation doesn't contradict the user."
2. **The AI doesn't know it's wrong.** Self-reflection only catches errors the AI can see. Domain model mismatches are invisible to the AI because it doesn't share the user's domain expertise.
3. **"minComplexity" means the AI decides when to apply it.** Same failure as the advisor pattern — the AI judges its own need for guardrails and judges wrong.
4. **What actually fixed the problem was the user pushing back.** The human was the effective adversary, not the AI.

## Solution: Tiered Assumption Gate

The user is the domain expert. The AI's job is to surface assumptions so the user can validate them — not to self-validate.

### Tier 1: Factual Lookup (no gate)

Questions with objective answers from the codebase: "What version of React?", "How many TaskStatus values exist?", "What does this function return?"

No gate needed — the answer is verifiable from code.

### Tier 2: Analysis with Domain Assumptions — User-as-Adversary

Questions where the answer depends on domain model decisions: "What statuses should tasks have?", "Should we split this service?", "What's the right data model for X?"

**Before presenting any recommendation**, the AI must:

1. **Identify domain assumptions** the recommendation depends on
2. **Present them explicitly** and wait for user confirmation
3. **Only then** proceed with the analysis grounded in confirmed assumptions

```
User: "What statuses should tasks have in the action queue?"

━━━ ASSUMPTIONS (confirm before I analyze) ━━━
My analysis will depend on these domain model assumptions:

1. Estimates are part of the task lifecycle (a task goes through
   estimation as a phase, not a separate entity)
2. The action queue shows "things needing admin attention" — not
   a filtered view of task statuses
3. A task can simultaneously be IN_PROGRESS and have pending
   time entries awaiting approval (two independent states)

Do these match your understanding? [confirm / correct]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The user confirms or corrects. The analysis proceeds grounded in the user's actual domain model, not the AI's guess.

**This is the same pattern as the Scope-Confidence Gate (Step 1.45)** — verify assumptions before proceeding. We already have this pattern for implementation; we're extending it to research.

### Tier 3: Architecture/Design Recommendation — Model Adversary

Questions involving significant architectural decisions: "Should we split the monolith?", "What's the right database schema?", "How should we restructure the API?"

In addition to Tier 2 (assumption surfacing):

1. After the user confirms assumptions and the AI produces its recommendation
2. **Spawn a critique agent on a different model** (Sonnet if Opus recommended, or vice versa)
3. The adversary gets: the user's confirmed assumptions + the recommendation + the question
4. Adversary checks: "Does this recommendation actually follow from these assumptions? What's the strongest counterargument?"
5. If the adversary finds issues → present both perspectives to the user
6. One critique pass only (not an iteration loop — this is conversation, not implementation)

```
User: "Should we restructure the API to use GraphQL?"

[Tier 2 assumption confirmation happens first]

━━━ RECOMMENDATION ━━━
[AI's analysis based on confirmed assumptions]

━━━ ADVERSARY CRITIQUE ━━━
A different model reviewed this recommendation against your
confirmed assumptions. Key concerns:
- Migration cost underestimated: 47 REST endpoints would need...
- Your assumption #2 (low query complexity) may not hold for...
━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## How Tier Classification Works

The AI does NOT self-classify. Classification is based on **structural markers in the question**:

| Marker | Tier | Examples |
|--------|------|---------|
| "What is", "How many", "Show me", "List all" | 1 (Factual) | "What TaskStatus values exist?" |
| "What should", "How should", "Recommend", "Which approach", "What do you think about" | 2 (Domain) | "What statuses should we have?" |
| "Should we restructure", "What's the right architecture", "Design a schema", "How to migrate" | 3 (Architecture) | "Should we switch to GraphQL?" |

When ambiguous, default to Tier 2 (surface assumptions). This is the same principle as Decision Authority's low-confidence fallback to `owner-decides`.

## Configuration

```json
{
  "researchReasoningGate": {
    "enabled": true,
    "tier2": {
      "enabled": true,
      "_comment": "Surface assumptions before analysis. Waits for user confirmation."
    },
    "tier3": {
      "enabled": true,
      "adversaryModel": "sonnet",
      "_comment": "Spawn critique agent for architecture-level questions. Uses different model."
    }
  }
}
```

## Acceptance Criteria

1. Conversation mode in `wogi-start.md` includes tier classification logic based on structural markers
2. Tier 2: AI surfaces domain assumptions in a visible block and waits for user confirmation before analyzing
3. Tier 2: If user corrects an assumption, the analysis is grounded in the corrected model
4. Tier 3: After assumption confirmation + recommendation, a critique agent on a different model reviews the recommendation
5. Tier 3: Adversary critique is shown to user alongside the recommendation
6. Tier 1 (factual) questions proceed without any gate
7. `/wogi-research` command extended with tier classification and assumption surfacing
8. Config toggles for tier 2 and tier 3 independently
9. When ambiguous, defaults to Tier 2 (assumption surfacing)
10. Template updated + bridge sync to regenerate CLAUDE.md

## Files to Modify
- `.claude/commands/wogi-start.md` (conversation mode section — add tier classification + assumption gate)
- `.claude/commands/wogi-research.md` (extend zero-trust protocol with tiers)
- `.workflow/config.json` (add `researchReasoningGate` config)
- `.workflow/templates/claude-md.hbs` (if conversation mode is referenced in template)
- Run `flow bridge sync` at end

## Files to Create
- None — this is prompt-level changes to existing commands

## Implementation Notes
- Tier 2 is prompt-level only (conversation mode is read-only, no hooks to fire)
- Tier 3 uses the existing Agent tool to spawn the adversary — same mechanism as IGR's Logic Adversary but lighter (one pass, no iteration)
- The assumption block is visible to the user — its absence is detectable (unlike self-reflection which happens invisibly)
- The user confirmation step is the mechanical enforcement — the AI waits, which means assumptions can't be silently skipped
- Classification by structural markers (not AI self-assessment) prevents the "AI decides it doesn't need help" failure mode

## Why This Is Better Than the Previous Spec

| Previous Spec | This Spec |
|--------------|-----------|
| Self-adversary (same model) | User-as-adversary (Tier 2) + different-model adversary (Tier 3) |
| AI decides complexity ("minComplexity") | Structural markers determine tier |
| Invisible self-reflection | Visible assumption block the user sees |
| No waiting — AI presents immediately | Waits for user confirmation on assumptions |
| Prompt tells AI to self-check | User validates domain assumptions directly |
