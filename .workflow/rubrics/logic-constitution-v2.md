<!-- PINS: overview, usage, p1-literal-vs-intended, p2-scope-boundary, p3-domain-coherence, p4-terminology-resolution, p5-prior-decision-alignment, p6-non-goal-violation, p7-existing-concept-reuse, p8-implicit-requirement-coverage, p9-user-journey-fit, p10-reversibility, p11-platform-capability-grounding, degraded-mode, output-schema, calibration, amending -->

# Logic Constitution v2
<!-- PIN: overview -->

**Version**: 2.0
**Introduced**: 2026-04-13 (IGR Story wf-3975a001)
**Amended**: 2026-04-15 (wf-643304c0) — added Principle 11 (Platform Capability Grounding) after two successive plan failures (PostToolUse payload rewriting; subagent-per-task) that claimed platform capabilities without verification and would have bypassed existing enforcement.
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

## The 11 principles

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

### 11. Platform capability grounding
<!-- PIN: p11-platform-capability-grounding -->

**Question the Adversary asks**:
> Does the plan rely on a platform capability (hook event behavior, tool API shape, subagent model, compaction primitive, MCP tool, slash command, environment feature)? For EACH such capability, is there cited evidence the capability exists AND works as claimed? Does the proposed mechanism PRESERVE WogiFlow's existing enforcement contract (hooks fire, skills remain invocable, mechanical gates hold, state files stay canonical)? Was at least one alternative mechanism considered and explicitly ruled out? Is the failure mode specified for when the capability is unavailable?

**Why this principle exists**: Three successive plan failures on 2026-04-15 — (a) "PostToolUse hook replaces the tool response payload with a breadcrumb" was architecturally incoherent (Claude Code's PostToolUse cannot rewrite `toolResponse`, only append `systemMessage` or `block`); (b) "spawn a subagent per /wogi-start call" would have bypassed every mechanical enforcement hook because subagents run in isolated contexts without Skill-tool access and cannot invoke `/wogi-start`; (c) "trigger restart via TaskCompleted hook on subagent completion" — the hook was registered correctly and an internal code comment claimed it fires on Task-tool completion, but **live testing showed it never fires for Task-tool subagents**. The first two failures would have been caught by citation + enforcement-preservation + alternative + fallback. The third failure slipped through because I accepted an internal code comment ("Called when a sub-agent task completes") as sufficient citation — it was hearsay about platform behavior, not evidence. Empirical testing caught it in under a minute. Principle 11 now has a stronger citation requirement (see P11.1 below).

**FAIL when**:
- The plan claims a platform capability (e.g., "PostToolUse replaces the tool response", "the hook can rewrite the transcript", "this MCP tool has access to X") without a citation — doc URL, source-file path, or observed-behavior reference.
- The plan proposes a mechanism that BYPASSES existing WogiFlow enforcement without a replacement: e.g., subagents without Skill access, subprocess escapes that skip hooks, MCP tool wrappers that skirt PreToolUse routing, custom tool implementations that evade the phase-read gate.
- The plan does not name at least one alternative mechanism it ruled out and why.
- The plan does not specify what happens when the capability is unavailable (graceful degradation vs. hard fail vs. user prompt).

**CONCERN when**:
- Citation exists but is weak — inferred from a single example rather than officially documented, or transcribed from memory rather than verified at plan-time.
- Enforcement preservation is *claimed* but not *demonstrated* (plan says "hooks still fire" without showing which hooks and where they fire in the proposed flow).
- Alternatives were considered but the reasoning for ruling them out is thin ("too complex" is not reasoning).

**PASS when**:
- Every platform-capability claim carries a specific citation: documented URL, source-file line reference, or an observed-behavior anchor ("verified in `scripts/hooks/adapters/claude-code.js:327-347`").
- The plan explicitly walks through how each existing enforcement layer (PreToolUse routing gate, phase-read gate, Skill-tool invocability, state-file discipline, hook event pipeline) is preserved OR explains why bypassing is acceptable, what replaces the enforcement, and why the replacement is equivalent.
- At least one alternative mechanism is named and explicitly ruled out with concrete reasoning.
- Failure mode for capability-unavailable is specified (degraded mode, hard fail with user message, or prompt-for-action).

**Evidence the Adversary MUST demand for every capability claim**:
1. **"Show me the citation."** — doc URL, source-file path+line, or an observed-behavior reference. Absent = FAIL.
2. **"Show me where enforcement is preserved."** — specifically enumerate which hooks fire, which gates still apply, which state-file writes still occur in the proposed flow. Absent = FAIL.
3. **"Show me the alternative you ruled out."** — at least one named alternative with reasoning. Absent = FAIL.
4. **"Show me the fallback."** — what happens when the capability is absent or broken. Absent = FAIL.

If any of the four is missing for any capability claim, the principle verdict is FAIL.

### Sub-principle 11.1 — Observed behavior trumps documented behavior

**This clause was added on 2026-04-15 after a Principle 11-compliant plan still failed at runtime. The plan claimed "Claude Code's TaskCompleted hook fires when a Task-tool subagent completes" and cited an internal source-file comment saying so. The citation passed evidence #1. The test showed the hook never actually fires for this event.**

Citations of the form "[file or doc] SAYS the platform does X" are **not** sufficient when X is a runtime behavior we have not directly observed. Comments, docs, and prior-code claims about platform behavior are hearsay. **Evidence #1 for a runtime-behavior claim requires direct observation**, not documentation quoting.

**For claims about a platform event firing, a tool returning a specific shape, a hook receiving specific input, or a signal being delivered/handled**, the Adversary MUST demand ONE of:

- **O1 — A captured observation**: a log line, a telemetry event, a test run, or a trace showing the behavior actually occurring. Screenshot of output counts. "The hook fired in yesterday's run, here's the log entry" counts. "The source code says it fires" does NOT count.
- **O2 — A live-test plan**: a named, time-bounded test that will produce observation O1 BEFORE the code is built on top of the assumption. The plan names the test, the expected observable, and the fallback if the observation does not occur.

If the plan has neither O1 nor O2 for a runtime-behavior claim, the principle verdict is FAIL. Hearsay-level citations cause CONCERN at minimum, FAIL when the dependency is load-bearing.

**What still counts as sufficient citation without observation:**
- Pure API shape questions where types are exported and checkable (e.g., "the Agent tool accepts a `prompt` parameter" — inspectable from schema)
- Pure file-system or OS primitives (e.g., "Node `process.kill(pid, 'SIGTERM')` delivers a signal" — documented and stable)
- Claims about WogiFlow's OWN code that are invariant under WogiFlow releases (e.g., "`scripts/flow-utils.js` exports `safeJsonParse`" — grep-verifiable)

**What requires O1 or O2:**
- "This hook fires when X happens" — runtime behavior, must be observed
- "This tool returns shape Y" — runtime behavior, must be observed
- "This command exits with code Z under condition W" — runtime behavior, must be observed
- "Claude Code handles signal S with behavior B" — runtime behavior, must be observed
- "The platform injects context C at time T" — runtime behavior, must be observed

**Meta-lesson encoded in this sub-principle**: the Adversary's job is to resist the plan author's natural tendency to accept plausible-sounding citations as proof. When a citation is "doc says X", ask: "have I seen X happen?" If not, downgrade the evidence and demand a test.

**This principle ALWAYS runs.** It does not skip in degraded mode. It applies to every plan that touches a hook, tool, API, command, or platform feature — which in practice is every non-trivial WogiFlow plan.

**Examples of violations this principle catches**:
- *"PostToolUse hook replaces the returned tool payload with a breadcrumb"* — no citation exists, and the Claude Code hook API does not support this → FAIL.
- *"Each /wogi-start spawns a subagent that executes the task"* — subagent mechanism is cited (✓), but the plan does not address that subagents lack Skill tool access, cannot invoke /wogi-start, and bypass every PreToolUse enforcement gate → FAIL (enforcement bypass without replacement).
- *"Use an MCP tool wrapper to execute git commands with externalized output"* — MCP is cited (✓), but the plan does not address whether MCP tool calls trigger PreToolUse hooks or the routing gate → CONCERN at minimum, FAIL without a documented answer.
- *"Programmatically invoke /clear between tasks"* — no citation that slash commands are programmatically invokable from hooks → FAIL.

**Examples of PASS**:
- *"Use `additionalContext` in SessionStart hook to inject state-file content. Citation: `scripts/hooks/adapters/claude-code.js:224-240`, behavior observed in existing transformSessionStart. Enforcement preserved: all downstream hooks (PreToolUse routing gate, phase-read gate) fire normally because the user's session continues. Alternative ruled out: SessionEnd-based injection — doesn't fire at new-task boundaries. Fallback: if the hook is disabled, state-file content is still discoverable via Read tool."*

### Sub-principle 11.2 — Self-grounding against the project's own rules

**This clause was added on 2026-04-15 after repeat failures where a plan cited a WogiFlow internal rule but the artifact produced by the plan did not actually satisfy that rule at runtime.** Examples: task IDs written as `wf-test0001` "per WogiFlow's task ID convention" when the convention requires hex (`'t'` and `'s'` fail `validateTaskId()`). File names chosen as `flowFoo.js` "following WogiFlow's naming rule" when the rule requires kebab-case. Config keys added without being in `flow-constants.js`'s known-keys list. In each case the plan correctly identified the rule but did not empirically verify the artifact satisfied it.

Principle 11 governs PLATFORM capabilities (hooks, APIs, signals). Sub-principle 11.2 extends the same discipline to **the project's own rules, decisions, and patterns** — WogiFlow's when building WogiFlow, and the user's own project rules when using WogiFlow to build anything else.

**For every plan artifact** (task IDs, file names, state-file entries, config values, spec structures, commit messages, branch names, schema documents, etc.), the Adversary demands:

- **E1 — Name the rule.** Which entry in `decisions.md`, `feedback-patterns.md`, `.claude/rules/`, `config.schema.json`, or a validator function (`validateTaskId`, `safeJsonParse`, `isPathWithinProject`, etc.) applies to this artifact? "No rule applies" is an acceptable answer — but must be asserted explicitly, not assumed.

- **E2 — Show the artifact satisfying the rule.** Not "I followed the rule" — *show* the check passing:
  - For validator functions: run the validator on the artifact, cite the passing result
  - For format rules (hex, kebab-case, ISO timestamp): display the artifact's actual format alongside the rule's requirement
  - For schema constraints: validate the artifact against the schema
  - For decisions.md rules: quote the rule and show the artifact's compliance side-by-side
  - For "existing-key" rules (like `flow-constants.js` known-keys): confirm the key is in the list

- **E3 — Name the failure mode.** What happens if the artifact violates the rule? Runtime rejection (like `flow done`'s `validateTaskId`)? Silent drift (like an unknown config key)? State corruption? Specify.

If any of E1/E2/E3 is missing for any load-bearing artifact, the principle verdict is FAIL. Weak evidence (naming the rule but not showing the passing check) is CONCERN.

**What counts as E2 evidence** (in increasing rigor):
- **Strong**: running the rule's validator and pasting the output. `node -e "console.log(validateTaskId('wf-b65b1374'))" → { valid: true }`
- **Acceptable**: quoting the rule verbatim and demonstrating the artifact matches the rule's pattern in writing. `wf-b65b1374: 11 chars, wf- prefix, 8 hex chars — matches /^wf-[a-f0-9]{8}$/i`
- **Weak (CONCERN)**: "this follows the rule" with no demonstration
- **FAIL**: no rule named at all, or the cited rule is wrong

**Applies to every non-trivial plan** because every WogiFlow plan produces some artifact (a task, a spec file, a config change, a commit). The adversary should develop reflex: *what's the artifact? what rule governs it? is the rule satisfied, shown?*

**Meta-lesson**: Citing rules is cheap; satisfying them is work. The adversary's job is to resist the plan author's tendency to treat "I know the rule" as equivalent to "my artifact satisfies the rule." Force the plan to SHOW.

### Sub-principle 11.3 — Existing-feature compatibility surface

**Added 2026-04-15 after a plan proposed a `wogi-claude` shell wrapper that worked for single-session CLI use but missed that WogiFlow already has a workspace mode (`lib/workspace.js`) that spawns `claude` directly via `execSync`. The plan would have been incompatible with an existing product feature — not platform capability and not project rules, but a sibling WogiFlow feature that touches the same domain.**

P11 (platform) and P11.2 (project rules) cover the outside and the inside. This clause covers the **sideways** dimension: existing WogiFlow features that may interact with the proposed mechanism.

For every plan that introduces a new mechanism (hook, wrapper, CLI entry point, session-management primitive, state-file schema, config key, tool invocation pattern), the Adversary demands:

- **S1 — Enumerate the sibling surface.** Which existing WogiFlow features touch the same domain as the proposed mechanism?
  - Session/process management → check `lib/workspace.js`, `scripts/flow-worktree.js`, `scripts/flow-orchestrate.js`, `--fork-session` usage
  - Hooks → check `scripts/hooks/core/*`, `scripts/hooks/entry/claude-code/*`
  - State files → check `.workflow/state/*` and all writers via `grep -r "writeJson.*state"`
  - Commands → check `.claude/commands/` and `lib/commands/`
  - Config keys → check `scripts/flow-config-defaults.js` and `scripts/flow-constants.js`
  - Skills → check `.claude/skills/` and skill-match logic
- **S2 — Show compatibility.** For each sibling surface: does the new mechanism compose cleanly, conflict, or require integration work? "Orthogonal" is an acceptable answer — but must be asserted and substantiated.
- **S3 — Name integration work as scope.** If a sibling surface requires integration (e.g., workspace mode needs the wrapper to be injected into its `execSync` call), the plan must EITHER include that integration in scope OR explicitly file a follow-up story for it. Silent omission = FAIL.

**Examples of P11.3 violations**:
- Adding `taskBoundaryReset` via `wogi-claude` wrapper without checking `lib/workspace.js` calls `execSync('claude ...')` directly — workspace-mode workers can't benefit without integration work
- Adding a new state file without checking which existing hooks write to `.workflow/state/` (possible lock contention, schema drift)
- Adding a new slash command without checking skill-matching logic for overlap
- Introducing a new config key without adding it to `flow-constants.js` known-keys list (silent drift — partial overlap with P11.2 but specifically about sibling integration)

**How to ground it**: when writing the plan, run these concrete checks:
- `grep -r "execSync\|spawn.*claude" lib/ scripts/` → any other spawners of claude that should use the new wrapper?
- `ls .claude/commands/ | grep <new-command-domain>` → any overlapping commands?
- `grep -r "writeJson.*<new-state-file>" scripts/ lib/` → any existing writers?
- `cat scripts/flow-constants.js | grep <new-config-key>` → is the key registered?

Each check produces observable evidence the plan can cite.

**Meta-lesson**: WogiFlow is a big product. New mechanisms almost always have sibling features that need to compose with them. The adversary asks: *"What else already does this?"* — then *"Does your new thing play nice with it?"*

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

Principles 1, 2, 5, 7, 8, 10, 11 ALWAYS run. Even in fully degraded mode (no intent artifacts), the Adversary provides 7-principle coverage. Principle 11 (Platform capability grounding) never skips — capability claims must always be verified regardless of intent-artifact availability.

Every SKIP is recorded in telemetry so we can see how much the Adversary's effectiveness improves once intent artifacts land.

---

## Output schema
<!-- PIN: output-schema -->

The Adversary must return JSON of exactly this shape:

```json
{
  "rubricVersion": "2.0",
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
    },
    {
      "id": 11,
      "name": "Platform capability grounding",
      "verdict": "PASS|CONCERN|FAIL",
      "evidence": "For each platform-capability claim in the plan: the citation (doc URL or source file path+line), the enforcement-preservation walkthrough, the ruled-out alternative, and the capability-unavailable fallback.",
      "issue": "If CONCERN or FAIL: which capability claim is ungrounded or which enforcement layer is bypassed without replacement.",
      "remedy": "If CONCERN or FAIL: the citation that must be added, the enforcement layer that must be preserved or explicitly replaced, or the alternative that must be considered."
    }
  ],
  "overallVerdict": "PASS|PASS_WITH_CONCERNS|NEEDS_REVISION|FAIL",
  "criticalIssues": ["short bullet per FAIL, up to 5"],
  "questionsForUser": ["short questions to surface at approval gate, up to 5"]
}
```

Principle 11 never returns SKIP — capability claims must always be evaluated.

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
