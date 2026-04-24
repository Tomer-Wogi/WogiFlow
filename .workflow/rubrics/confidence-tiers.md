# Confidence-Tier Rubric (95 / 85 / 75)

**Task**: wf-f14dcfeb (A4, epic wf-34290000)
**Consumers**: `/wogi-review` agent prompts, Completion Truth Gate finding output, `flow-skeptical-evaluator.js`.
**Reconciled with**: Evidence Tier 0–4 scale from `scripts/flow-runtime-verification.js` (`EVIDENCE_TIERS`).

---

## Why a confidence rubric in addition to evidence tiers?

Evidence tiers (0–4) answer *"what grade of evidence backs this claim?"* — a mechanical fact about which verification action produced the observation.

Confidence tiers (95 / 85 / 75) answer *"how likely is this finding/claim to be real and actionable?"* — a judgment that combines evidence tier **with** signal strength (count of grep hits, reproducibility, contradiction risk, scope fit).

Two findings at the same evidence tier can warrant different confidence. Example:
- Finding A: Tier 1 grep returned 1 match → **75%** confidence (isolated hit, could be false positive).
- Finding B: Tier 1 grep returned 14 matches across 9 files → **85%** confidence (pattern corroborated).

The confidence tier is what consumers (reviewers, the Completion Truth Gate, skeptical-evaluator) use to decide whether to surface a finding, downgrade language, or request more evidence.

---

## The three tiers

### 95 — HIGH CONFIDENCE

Use when **all** of the following hold:

- Evidence tier ≥ 3 (INTERACTIVE or AUTOMATED), OR
- Evidence tier 2 (OBSERVATIONAL) with ≥ 2 independent corroborating observations, OR
- Evidence tier 1 (STRUCTURAL) with ≥ 10 grep/glob hits spanning ≥ 3 files AND no contradicting evidence surfaced.

Additional requirements:
- Finding is within the task's scope (matches `scopeIn` from the framing artifact).
- `evidenceNote` cites a concrete artifact (file path + line, test name, command output).

Language allowed: "is", "does", "breaks", "fails", "requires". No hedges.

### 85 — MEDIUM CONFIDENCE

Use when:

- Evidence tier 2 (OBSERVATIONAL) with exactly 1 observation, OR
- Evidence tier 1 (STRUCTURAL) with 5–9 grep hits, OR
- Evidence tier 1 (STRUCTURAL) with ≥ 3 hits across ≥ 2 files.

Additional requirements:
- `evidenceNote` cites the observation / grep pattern.
- No contradicting evidence encountered during investigation.

Language allowed: "likely", "appears to", "in most paths". Hedges permitted.

### 75 — LOW CONFIDENCE

Use when:

- Evidence tier 0 (STATIC) — inferred from source alone, OR
- Evidence tier 1 (STRUCTURAL) with 1–4 isolated hits, OR
- Evidence tier ≥ 1 but `evidenceNote` is missing / generic ("looks wrong", "could be broken").

Additional requirements (all findings at 75):
- Must be flagged **UNVERIFIED** in downstream consumers.
- Severity is **capped at LOW** regardless of claimed impact.
- Must propose a concrete verification action ("run X", "grep Y", "open Z in browser") before confidence can be upgraded.

Language required: "might", "could", "possibly", "appears". Assertive language is not allowed at 75.

---

## Reconciliation with Evidence Tiers

| Evidence Tier | Signal strength | Default confidence | Notes |
|---|---|---|---|
| 4 AUTOMATED | Deterministic check | **95** | Test/lint/typecheck asserted the claim. |
| 3 INTERACTIVE | Ran code, observed result | **95** | Single interactive confirmation is sufficient. |
| 2 OBSERVATIONAL | 1 tool observation | **85** | 2+ observations → 95. |
| 2 OBSERVATIONAL | 2+ observations | **95** | Corroboration upgrades. |
| 1 STRUCTURAL | 1–4 grep hits | **75** | Insufficient corroboration. |
| 1 STRUCTURAL | 5–9 grep hits | **85** | Corroborated across files. |
| 1 STRUCTURAL | ≥ 10 hits, ≥ 3 files | **95** | Pattern is systemic. |
| 0 STATIC | Source inference only | **75** | Always flagged UNVERIFIED. |
| −1 NONE | No evidence | reject | Not publishable. |

The table is the mechanical default. Human/agent judgment may override — but an override MUST be justified in `confidenceNote`.

---

## Output schema

Every finding (from `/wogi-review` agents) and every completion claim (from Completion Truth Gate) that carries evidence MUST include:

```json
{
  "evidenceTier": 0-4,
  "evidenceNote": "one-line citation of what produced the evidence",
  "confidencePct": 95 | 85 | 75,
  "confidenceNote": "one-line justification if this overrides the default mapping"
}
```

`confidencePct` is always one of exactly 95, 85, or 75 — no other values. Consumers reject findings that use a different value.

---

## Severity caps (reinforces existing rule)

Evidence-tier severity caps (from `wogi-review.md` § 2.3) remain in force. Confidence adds a second cap:

| Confidence | Severity cap |
|---|---|
| 95 | none (severity stands) |
| 85 | HIGH (CRITICAL is not allowed) |
| 75 | LOW (and flagged UNVERIFIED) |

The lower of (evidence-tier cap, confidence cap) applies.

---

## Consumer wiring

- `/wogi-review` agent prompts (`.claude/commands/wogi-review.md` § 2.3) append the confidence-tier requirement to every agent.
- `scripts/flow-completion-truth-gate.js` exports `computeConfidenceTier(evidenceTier, hitCount, observationCount)` and attaches `confidencePct` to audit output.
- `scripts/flow-skeptical-evaluator.js` reads `confidencePct` and downgrades claim language when < 95.

---

## Not to be confused with

- **Evidence tier** (0–4): grade of verification action. Mechanical.
- **Severity** (critical/high/medium/low): blast radius of the finding if real. Consumer-facing urgency.
- **Confidence tier** (95/85/75): likelihood the finding is real and actionable. This rubric.

All three coexist on every finding.
