# Intent-Grounded Review (IGR v6.0) — Reference

Detailed reference for the IGR phases added to `/wogi-review` in v2.17.3. The main `/wogi-review` skill file contains the mandatory execution flow; this doc holds the full rationale, examples, and background each phase depends on.

Read this when:
- You're debugging unexpected review-skill behavior
- You're tuning `config.review.*` and want to understand each key's impact
- You're extending the review pipeline (adding a new phase, new adversary, new tier)
- A review surfaced a false-positive finding and you want to know which phase should have caught it

The four IGR additions to the review pipeline:

| Phase | What it adds |
|-------|---|
| Phase 0 — Framing | Scope + assumptions surfaced BEFORE agents launch |
| Phase 2 — Evidence Tiers | Every finding carries `evidenceTier` + `evidenceNote`; severity capped by tier |
| Phase 2.8 — Findings Adversary | Different-model critique of the findings themselves |
| Phase 5 — Completion Truth Gate | "Fixed" claims require INTERACTIVE evidence |

---

## Phase 0: Review Framing Pass — Reference Detail

**Problem this solves**: "Review" means different things in different invocations. "Review what we just did" is bounded to the session diff; "review the auth flow" is bounded to a module; "review before ship" expects a final-sign-off posture. Without explicit framing, the AI picks its own scope and grades findings against its own mental rubric, producing a different answer than the user asked for.

### The Five Framing Fields

| Field | What it captures |
|---|---|
| `interpretation` | One sentence: "I understand this as: review X with posture Y" |
| `scopeIn` | Explicit list: which files, commits, or modules are in scope |
| `scopeOut` | Explicit list: what this review will NOT cover (by design, not omission) |
| `assumptions` | 2–5 review-model assumptions (e.g., "a refactor review must verify behavior preservation, not just test pass") |
| `posture` | `pre-ship` / `session-review` / `security-focused` / `exploratory` — adjusts agent emphasis |

### Posture → Agent Weight Adjustment

- `pre-ship` → boost security + integration agents, require Phase 2.8 adversary pass
- `session-review` → balanced across all agents
- `security-focused` → security agent mandatory, injection/authn checks emphasized
- `exploratory` → logic + architecture agents; adversary pass OPTIONAL (via `config.review.framingPass.adversaryInExploratory`)

### Item Reconciliation (Anti-Deferral Guard)

When the user's request enumerated multiple focus areas ("review X, Y, Z"), each named item MUST appear in `scopeIn`. If the count shrank (user named 5, framing has 3), the framing pass FAILS — display which items were dropped and require the user to confirm before proceeding.

Ported from `/wogi-start`'s anti-deferral rule. The AI cannot silently drop items.

---

## Phase 2: Evidence Tiers — Reference Detail

Every finding returned by any review agent MUST carry two additional fields: `evidenceTier` (0–4) and `evidenceNote` (one-line string citing what produced the evidence).

### Tier Definitions

| Tier | Name | What it means for findings |
|------|------|----------------------------|
| 0 | STATIC | AI inferred from the source alone — no grep, no execution. Weakest. |
| 1 | STRUCTURAL | AI grepped / globbed / counted instances across the codebase. |
| 2 | OBSERVATIONAL | AI ran a tool (lint, typecheck, npm audit) and read its output. |
| 3 | INTERACTIVE | AI executed code or tests and observed the behavior. |
| 4 | AUTOMATED | A quality gate or test suite produces this finding deterministically on every run. |

### Severity Cap Rules

- **Tier 0** findings: severity MUST be LOW (and flagged UNVERIFIED in the report).
- **Tier 1** findings: severity capped at MEDIUM unless grep returned ≥5 instances.
- **Tier 2+** findings: severity stands as the agent assigned.

### Why Tiers Matter (Real Incident)

During the v2.17.3 self-review (session 2026-04-15), a `code-reviewer` agent reported an F1 finding as "Critical — broken require path" without citing evidence. Manual verification via `require.resolve()` showed the path was correct — the agent's path math was flawed.

With tier enforcement, F1 would have been Tier 0 (no grep, no execution), capped at LOW, and flagged UNVERIFIED — alerting the reader to verify before acting. The evidence-tier requirement is the single most powerful rubber-stamp-prevention mechanism in the IGR toolkit.

---

## Phase 2.8: Findings Adversary Critique — Reference Detail

This is the review analogue of the `/wogi-audit` Adversary Pass (Step 3.5) and the IGR Logic Adversary (wf-3975a001). Same pattern: different model, separate context, looking for specific defect classes.

### Adversary Model Selection Rule (CRITICAL)

The `adversaryPass.adversaryModel` is a mapping, NOT a static string. The AI resolves it at runtime by inspecting which model the review agents used.

```json
"adversaryModel": {
  "whenAgentOnSonnet": "opus",
  "whenAgentOnOpus": "sonnet",
  "whenAgentOnHaiku": "sonnet",
  "default": "sonnet"
}
```

**Override-always rule**: if the resolved value equals the agent model (e.g., legacy plain-string config set to `sonnet` when agents ran on Sonnet), pick a different model instead. Same-model adversary = rubber-stamp, which defeats the entire purpose of the adversary pass.

### Specific Defect Classes to Hunt

The adversary prompt includes HUNT instructions for these patterns:

1. Findings where `evidenceTier=0` but severity ≥ HIGH
2. Findings that cite line numbers without quoting the surrounding code
3. "Broken require path" / "missing import" / "wrong type" claims without `require.resolve` / `tsc` / `grep` verification
4. Findings that contradict the framing's `scopeIn` / `scopeOut` declarations

### Applied Adjustments

The orchestrator applies the adversary's recommendations automatically:

- `severityAdjustments` rewrite findings' severity in the consolidated report (mark `[ADVERSARY-ADJUSTED]`)
- `scopeDrift` moves findings out of the main report into an "Out-of-Scope Findings" appendix (not dropped — user still sees them)
- `falsePositives` get marked `[DISPUTED]` in the report body (not removed — user sees both the finding AND the dispute)
- `missedIssues` get appended as new Tier-0 findings labeled `[ADVERSARY-FOUND]`
- `evidenceChallenges` downgrade the `evidenceTier` on challenged findings and re-apply the severity cap

### Verdict Semantics

- `ACCEPT` — no adjustments needed; findings are well-grounded
- `ACCEPT_WITH_ADJUSTMENTS` — severity caps/scope fixes applied, report still ships
- `REVISE_SCOPE` — framing was wrong; reviewer should restart with corrected scope
- `BLOCK` — adversary found a critical false positive or missed issue that makes the report untrustworthy; user must acknowledge before Phase 3 proceeds

**One pass only** — no iteration loop. If the adversary BLOCKS, the user calls it out and we re-review with adjusted scope.

### Archival

Every adversary run is archived to `.workflow/state/adversary-runs/review-{timestamp}.json` — same directory as IGR + audit adversary runs. This feeds the `flow promote` pipeline: recurring review-adversary findings graduate to `feedback-patterns.md`.

---

## Phase 5: Completion Truth Gate — Reference Detail

**Problem this solves**: A review's "fixed" claim is only as good as the evidence behind it. A finding marked `fixed` because the AI applied an edit is NOT the same as a finding verified to work. Without a truth gate, the sign-off rubber-stamps whatever the agent says.

### Downgrade Rules

For every finding now marked `status: fixed`:

| Fix evidence tier | New status |
|---|---|
| Tier ≥ 3 (INTERACTIVE) | stays `fixed` |
| Tier 4 (AUTOMATED quality gate) | stays `fixed` |
| Tier 2 (OBSERVATIONAL — lint/typecheck pass only) | downgraded to `fixed-unverified` |
| Tier ≤ 1 (STATIC / STRUCTURAL) | downgraded to `implemented-unverified` |

### Persistence

Downgraded statuses are persisted to `last-review.json` — NOT silently dropped back to `fixed`. The user should consciously accept unverified fixes, not have them hidden.

### Self-Incident (v2.17.4)

In v2.17.4 I claimed to "fix all review findings." The truth gate (applied manually) caught:

- F1, F2, F3 — fixed with Tier 2+ evidence (OK)
- F4 — doc update only, Tier 0, should have been `implemented-unverified`
- M1 — deferred, but the release notes said "fix all" — promise/delivery mismatch
- M3 — dropped entirely, never mentioned in the commit

User correction: "You're not supposed to defer any fixes. It's up to the user to defer, not you." → Anti-Deferral Guard added to feedback-patterns + decisions.

---

## Config Enforcement Model — Reference Detail

All `config.review.*` toggles are AI-honored, not runtime-enforced. No JavaScript reads `config.review.framingPass`, `config.review.evidenceTiers`, `config.review.adversaryPass`, or `config.review.completionTruthGate`.

The AI executing `/wogi-review` is responsible for reading these keys via `getConfig()` and honoring them. This matches `/wogi-audit`'s docs-driven model.

**Practical implication**: a user who sets `review.adversaryPass.enabled: false` will have the pass skipped ONLY if the AI respects the config. As a reviewer, always load config first and print the toggle states before launching phases.

---

## Config Reference (all IGR keys)

```json
{
  "review": {
    "minFindings": 3,
    "requireJustificationIfClean": true,
    "framingPass": {
      "enabled": true,
      "itemReconciliation": true,
      "adversaryInExploratory": false
    },
    "evidenceTiers": {
      "enabled": true,
      "capByTier": true
    },
    "adversaryPass": {
      "enabled": true,
      "adversaryModel": {
        "whenAgentOnSonnet": "opus",
        "whenAgentOnOpus": "sonnet",
        "whenAgentOnHaiku": "sonnet",
        "default": "sonnet"
      },
      "applySeverityAdjustments": true,
      "applyScopeDrift": true,
      "blockOnBlockVerdict": true,
      "archiveRuns": true
    },
    "completionTruthGate": {
      "enabled": true,
      "requireInteractiveForFixed": true
    }
  }
}
```
