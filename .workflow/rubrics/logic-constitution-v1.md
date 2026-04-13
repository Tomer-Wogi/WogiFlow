<!-- PINS: overview, usage, p1-literal-vs-intended, p2-scope-boundary, p3-domain-coherence, p4-terminology-resolution, p5-prior-decision-alignment, p6-non-goal-violation, p7-existing-concept-reuse, p8-implicit-requirement-coverage, p9-user-journey-fit, p10-reversibility, degraded-mode, output-schema, calibration, amending -->

# Logic Constitution v1
<!-- PIN: overview -->

**Version**: 1.0
**Introduced**: 2026-04-13 (IGR Story wf-3975a001)
**Purpose**: The agnostic rubric the Logic Adversary uses to critique a plan before code is written.
**Scope**: Plan-level logic quality, not code style. WogiFlow's other gates handle naming, security, conventions, and patterns.

This rubric is **versioned** and **user-editable**. When the rubric changes, bump the version number and add a new file (e.g., `logic-constitution-v2.md`). Every gate telemetry event records the rubric version, so the rubric's own evolution is trackable.

---

## How the Adversary uses this rubric
<!-- PIN: usage -->

For every principle below, the Adversary produces one of three verdicts:

| Verdict | Meaning |
|---------|---------|
| **PASS** | No issue detected on this principle. |
| **CONCERN** | Possible issue — surface to the user but do not block. |
| **FAIL** | Clear violation — block the plan until remedied. |

Every verdict must cite specific evidence from the plan or the research artifacts. A Verdict without evidence is itself a FAIL.

Overall verdict:
- Any `FAIL` → `overallVerdict: "NEEDS_REVISION"` (loops back to Architect) or `"FAIL"` (if max rounds hit).
- No `FAIL`, at least one `CONCERN` → `overallVerdict: "PASS_WITH_CONCERNS"` (proceeds but surfaces concerns at approval gate).
- All `PASS` → `overallVerdict: "PASS"`.

---

## The 10 principles

### 1. Literal vs. intended ask
<!-- PIN: p1-literal-vs-intended -->

**Question the Adversary asks**:
> Is the plan solving what the user literally typed, or what they actually need? If those differ, is the difference acknowledged?

**FAIL when**:
- The plan implements a pure-literal reading of an ambiguous request without acknowledging ambiguity.
- The user's ask implies a deeper goal and the plan addresses only the surface.
- A reasonable interpretation of the ask diverges from what the plan builds, and the divergence is unflagged.

**PASS when**:
- The plan states what it understood the ask to be, in its own words.
- Where the literal ask and the likely intent differ, the plan either converges with intent and justifies the divergence, or stays literal and explicitly flags that choice.

---

### 2. Scope boundary
<!-- PIN: p2-scope-boundary -->

**Question**:
> Does the plan add entities, screens, endpoints, or files the user did not ask for? For each net-new thing, is there a direct trace to the request?

**FAIL when**:
- The plan introduces a new concept, route, page, or entity that was not in the user's ask and cannot be justified by an explicit "why this is necessary" link.
- The plan bundles unrelated improvements ("while I was here, I also...") without the user requesting them.

**PASS when**:
- Every new file, route, entity, or concept in the plan is either (a) explicitly in the user's ask, or (b) justified by a clear necessity chain: the ask requires X, X requires Y, Y requires this new thing.

---

### 3. Domain coherence
<!-- PIN: p3-domain-coherence -->

**Question**:
> Do all referenced concepts appear in `domain-model.md`? If a concept is used differently from its model definition, is that deviation justified?

**FAIL when**:
- The plan references a concept that doesn't exist in the domain model and doesn't explicitly introduce it as a net-new concept (see principle 7).
- The plan uses an existing domain concept in a way that contradicts its definition.

**PASS when**:
- Every domain concept in the plan maps to `domain-model.md` with its defined meaning, OR the plan explicitly introduces a new concept and justifies why existing ones don't fit.

**Skip** when `domain-model.md` doesn't exist (degraded mode — Option C bootstrap not yet run). Record skip reason in telemetry.

---

### 4. Terminology resolution
<!-- PIN: p4-terminology-resolution -->

**Question**:
> For every term flagged in `glossary.md`'s Trap Zone section that appears in this task, did the Framing Artifact resolve it? Does the Plan respect that resolution?

**FAIL when**:
- An ambiguous term appears in the plan without being resolved in the Framing Artifact.
- The plan uses a trap-zone term in a way inconsistent with how the Framing resolved it.

**PASS when**:
- Every trap-zone term in the plan has been resolved to a specific meaning, and the plan's usage is consistent with that meaning.

**Skip** when `glossary.md` doesn't exist. Record skip reason.

---

### 5. Prior-decision alignment
<!-- PIN: p5-prior-decision-alignment -->

**Question**:
> Does this contradict anything in `decisions.md`, `feedback-patterns.md`, or `session-corrections.json`? If yes, is the contradiction explicit and justified?

**FAIL when**:
- The plan proposes something that was explicitly decided against in `decisions.md`.
- The plan repeats a pattern that was flagged as a failure in `feedback-patterns.md`.
- The plan contradicts a correction the user made earlier in the same session (per `session-corrections.json`) without acknowledging it.

**PASS when**:
- No contradictions, OR contradictions are explicit ("this supersedes decision X because...") and the plan proposes updating the conflicting record.

This is the #1 most frequently violated principle in the user's session history (7 incidents of "you keep forgetting X"). Treat it strictly.

---

### 6. Non-goal violation
<!-- PIN: p6-non-goal-violation -->

**Question**:
> Does this violate an explicit non-goal in `product.md`?

**FAIL when**:
- The plan implements something that `product.md` explicitly lists as a non-goal.

**PASS when**:
- No product non-goals violated, OR a violation is explicit and the plan recommends updating `product.md` to reflect a scope change.

**Skip** when `product.md` doesn't exist OR the product.md has no Non-Goals section.

---

### 7. Existing-concept reuse
<!-- PIN: p7-existing-concept-reuse -->

**Question**:
> For each net-new concept, is there an existing concept that could serve? If two concepts do the same thing, that's a FAIL.

**FAIL when**:
- The plan creates a new utility, service, or entity that duplicates functionality available in an existing one.
- The plan introduces a parallel abstraction rather than extending an existing one when extension would work.

**PASS when**:
- Every net-new thing is justified by "existing X cannot serve because..." with a specific reason.

This principle is a stronger version of WogiFlow's existing reuse check — applied to concepts in the plan, not just code that's been written.

---

### 8. Implicit-requirement coverage
<!-- PIN: p8-implicit-requirement-coverage -->

**Question**:
> Are empty states, error paths, concurrent modifications, null/undefined inputs, and state transitions addressed in the plan?

**FAIL when**:
- The plan describes the happy path but is silent on empty states, error paths, or failure modes.
- The plan proposes a state transition without specifying the preconditions and postconditions.

**CONCERN when**:
- The plan acknowledges these but defers them to implementation without specifying how.

**PASS when**:
- The plan explicitly enumerates edge cases, error paths, and state transitions.

---

### 9. User-journey fit
<!-- PIN: p9-user-journey-fit -->

**Question**:
> Does this change integrate naturally with the existing user journeys, or does it create a dead-end screen, orphan entity, or unreachable feature?

**FAIL when**:
- The plan creates a screen or entity with no navigation path from existing user journeys.
- The plan breaks an existing user journey's flow (e.g., removes a step that the user relies on).

**PASS when**:
- The plan identifies which existing user journey(s) it extends and how the change integrates.

**Skip** when `user-journeys.md` doesn't exist.

---

### 10. Reversibility
<!-- PIN: p10-reversibility -->

**Question**:
> If this plan is wrong, how hard is it to back out? Migrations, destructive operations, or external-system mutations require explicit user acknowledgement.

**FAIL when**:
- The plan includes a destructive operation (data migration, schema change with drops, external API mutation) without an explicit "confirm before running" step.
- The plan is irreversible AND no evidence that the user has explicitly approved the irreversibility.

**CONCERN when**:
- The plan is reversible but expensive to undo (e.g., many file changes).

**PASS when**:
- The plan is reversible OR the irreversibility is explicit, justified, and confirmed with the user.

---

## Degraded-mode operation
<!-- PIN: degraded-mode -->

When intent artifacts (`product.md`, `domain-model.md`, `glossary.md`, `user-journeys.md`) do not yet exist in the project (because Option C bootstrap hasn't run), certain principles cannot fully fire:

| Principle | Requires | Behavior when missing |
|-----------|----------|----------------------|
| 3 (Domain coherence) | `domain-model.md` | SKIP with reason `"no-domain-model"` |
| 4 (Terminology resolution) | `glossary.md` | SKIP with reason `"no-glossary"` |
| 6 (Non-goal violation) | `product.md` with Non-Goals section | SKIP with reason `"no-non-goals"` |
| 9 (User-journey fit) | `user-journeys.md` | SKIP with reason `"no-user-journeys"` |

Principles 1, 2, 5, 7, 8, 10 ALWAYS run. Even in fully degraded mode (no intent artifacts), the Adversary provides 6-principle coverage.

Every SKIP is recorded in telemetry so we can see how much the Adversary's effectiveness improves once intent artifacts land.

---

## Output schema
<!-- PIN: output-schema -->

The Adversary must return JSON of exactly this shape:

```json
{
  "rubricVersion": "1.0",
  "taskId": "wf-XXXXXXXX",
  "round": 1,
  "principles": [
    {
      "id": 1,
      "name": "Literal vs. intended ask",
      "verdict": "PASS|CONCERN|FAIL|SKIP",
      "evidence": "Cite the plan section, file, or artifact you reasoned from.",
      "issue": "If CONCERN or FAIL: one sentence on what's wrong.",
      "remedy": "If CONCERN or FAIL: one sentence on what would fix it."
    }
  ],
  "overallVerdict": "PASS|PASS_WITH_CONCERNS|NEEDS_REVISION|FAIL",
  "criticalIssues": ["short bullet per FAIL, up to 5"],
  "questionsForUser": ["short questions to surface at approval gate, up to 5"]
}
```

Responses that do not validate against this schema are treated as ERROR verdicts and recorded as such in telemetry.

---

## Calibration
<!-- PIN: calibration -->

The Adversary is spawned with few-shot examples from `.workflow/state/adversary-calibration.json`. Examples are curated over time:

- One high-quality plan that correctly passed
- One low-quality plan that correctly failed
- Optional: one edge-case plan that looked good but the Adversary rightly challenged

Without calibration, the Adversary drifts toward rubber-stamping (the exact failure mode the owner's QA parable warned against).

---

## Amending this rubric
<!-- PIN: amending -->

Do not edit this file in place for substantive changes. Instead:

1. Copy `logic-constitution-v1.md` → `logic-constitution-v2.md`
2. Make the change
3. Update `config.intentGroundedReasoning.logicAdversary.rubric` to point to the new version
4. Telemetry automatically records which version each event used

Editorial fixes (typos, clarifications that don't change behavior) may be made in place.
