<!-- PINS: rule-placement-decision, architecture-decisions, operational-procedures, rejected-alternatives, architectural-decision-records -->

# Project Decisions

Project-specific rules for the **wogi-flow** repository. These are conventions and decisions unique to THIS project, not WogiFlow product behavior.

**What belongs here:** Team conventions, project-specific architecture, repo-specific procedures.
**What does NOT belong here:** WogiFlow product behavior (fix the commands/scripts/templates instead), rules already in `.claude/rules/` (no duplication), rules already in CLAUDE.md.

---

## Rule Placement Decision (2026-04-20)
<!-- PIN: rule-placement-decision -->

**Rule**: When you discover a new rule, pattern, or contract during a wogi-flow development session, evaluate WHERE it belongs **before writing it**. Do not default to this file.

**Why this rule exists**: On 2026-04-20, an audit found 9 methodology rules mis-filed in this `decisions.md` that should have been shipped to every WogiFlow user via `.workflow/templates/partials/methodology-rules.hbs`. The shadows meant end-user CLAUDE.md was silent on contracts like "Workspace Worker Cannot Prompt User Directly" and "Merge-Plan Artifact Gate" even though the enforcement code was shipping. v2.26.0 promoted all 9 — but the promotion lag cost every downstream user real guidance for multiple releases.

**The decision procedure**:

| Question | If YES → | If NO → |
|----------|----------|---------|
| Would this rule apply inside a user's project that installed wogiflow? | Product-level (`.workflow/templates/partials/methodology-rules.hbs`) | Project-level (this file) |
| Does it describe WogiFlow methodology, contracts, gates, or user-facing behavior? | Product-level | Project-level |
| Does it reference wogi-flow's own internal file paths, scripts, build/release tooling, or dual-repo coordination? | Project-level | Revisit — probably product-level |
| If a user ran `npm install -D wogiflow` in a fresh project, should this rule appear in their generated CLAUDE.md? | Product-level | Project-level |

**Rule of thumb**: If the rule's enforcement code ships in `scripts/`, `lib/`, or `scripts/hooks/`, the rule's TEXT belongs in the template too. Shipping enforcement without shipping the rule text is the exact pattern the 2026-04-20 promotion had to fix.

**What stays here (project-level)**: Dual-Repo Architecture, GitHub Release Workflow, Rejected Alternatives specific to wogi-flow sessions, ADR conventions for `.workflow/state/adr/`, this meta-rule itself.

**What goes there (product-level, `methodology-rules.hbs`)**: Workspace contracts, gate behaviors, session-end contracts, honesty scans, anti-deferral rules, IGR meta-patterns, generic coding patterns that apply to any codebase.

**If you find a rule mis-filed**: promote it to the partial, delete the shadow here (leave a marker comment pointing to the new home), run `flow bridge sync`, commit as a feat release. Do not silently duplicate — when rule text drifts between the two locations, the template wins.

---

## Architecture Decisions
<!-- PIN: architecture-decisions -->

### Dual-Repo Architecture (2026-02-28)
**Source**: User directive — formalize dual-repo management for wogi-flow + wogiflow-cloud
**Rule**: Two repos, independent versions, mutual version awareness. OSS (`wogi-flow` / npm `wogiflow`) and Cloud (`wogiflow-cloud` / `@wogiflow/teams`) are separate packages with separate release cycles.

**Key constraints:**
1. **No teams code in the free repo** — all team logic lives in `wogiflow-cloud`. The free repo provides extension points only.
2. **Independent semver** — each repo versions independently. The client declares compatibility via peerDependencies (`wogiflow >= X.Y.Z`).
3. **Cross-repo version file** — each repo maintains `.workflow/state/partner-versions.json` recording the other's last-known version. Updated on every release.
4. **OSS releases first** — if cloud needs a new OSS feature/export, release OSS first, then cloud.
5. **Interface contract** — exported functions, hook interfaces, state file formats, and config keys used by cloud are documented in `.claude/rules/_internal/dual-repo-management.md`. Changes to these require updating the cloud client.

**Verification**: Before releasing either repo, check `partner-versions.json` and grep the other repo for consumers of changed interfaces.

---

## Code Rules
<!-- PIN: code-rules -->

### Empty-Collection Vanishing-Section Rule (2026-04-23)
<!-- PIN: empty-collection-vanishing-section -->
**Source**: wf-9c9ba324 (B6), epic wf-34290000.
**Rule**: A UI section, list, table, report section, or API response field that renders a collection MUST NOT disappear when the collection is empty. It MUST render an explicit empty state (placeholder, "No items", "0 records", `null`-with-key, empty array `[]`) that preserves the section's presence in the output.

**Why**: A vanished section is indistinguishable from a broken section. Users, QA, and verification gates cannot tell whether "no items" means "feature works correctly and today there are zero items" or "feature silently broke and the section was hidden". This failure mode has caused:
1. False-completion claims — AI sees the section rendered in screenshots during happy-path testing, then in production the empty state causes the section to vanish and the user assumes the feature regressed.
2. Skeptical-evaluator pass-throughs — field-enumeration sees nothing to enumerate, concludes "no UI to verify", marks PASS when the UI is actually broken.
3. BEL grep false-positives — the spec mentions a section heading that happens to match other text, so the grep sees coverage when the actual section vanished.

**How to apply**:

- **UI**: every section that iterates a collection (`.map()`, `<ForEach>`, `{items && items.map(...)}`) MUST have an `else` / empty-state branch that renders a placeholder with the same container `data-testid` or heading. Conditional rendering of the form `{items.length > 0 && <Section />}` is FORBIDDEN — the section must render unconditionally; only the inner list varies.
- **API responses**: fields that carry a collection MUST be present even when empty. Return `{ items: [] }`, never omit the key. Clients depend on key presence for `undefined` vs "empty" differentiation.
- **State files**: JSON / YAML keys that hold arrays MUST be present when the array is empty. `{ "inProgress": [] }` is correct; omitting the key is a bug.
- **Reports / summaries**: an "N findings" section where N=0 must say "0 findings" explicitly. Skipping the section produces ambiguity about whether the check ran.
- **Verification gates**: the Skeptical Evaluator (see `scripts/flow-skeptical-evaluator.js`) must treat a missing section as a DIFFERENT finding than an empty section. Missing = blocker; empty with placeholder = OK.

**Anti-rationalization checklist** — if you find yourself thinking any of these, STOP:
- "The section is only useful when there's data, so hiding it is cleaner UX" → WRONG. Cleanness is not the metric; disambiguity is. Use a placeholder.
- "The API is more efficient if it omits empty keys" → WRONG. Key presence is a client contract; efficiency is a negligible factor vs. client bugs.
- "The test passes when there's data, so it's fine" → WRONG. Test the empty case explicitly.

**Enforcement**: checked by the Skeptical Evaluator's UI-field + API-parameter passes (wf-15175dbc / B5), the BEL grep gate (wf-10c452f7 / B2), and the spec-string bundle grep (wf-07046456 / B4). Together they catch vanishing sections via three independent signals.

---

### Gate State Resolves From git-common-dir, Fails Closed For In-Progress Tasks (2026-05-23)
<!-- PIN: gate-state-canonical-resolution -->
**Source**: wf-e5e57361 (RC2). A workspace worker reasoned it could spin up a `git worktree` to reach an "ungated context": phase gates read the gitignored `workflow-phase.json` relative to cwd, and `git rev-parse --show-toplevel` returns the WORKTREE root (verified empirically), so a worktree's blank state made the gates fail-open to an unrestricted "idle" phase.

**Rule**: Any gate that reads gate-relevant state from `.workflow/state/` MUST resolve that state from the CANONICAL (main-repo) location, never relative to `process.cwd()`. Use `getCanonicalStateDir()` (`scripts/flow-paths.js`), which resolves via `git rev-parse --path-format=absolute --git-common-dir` — worktree-stable (always the main repo's `.git`). When the state is unresolvable AND a task is in-progress per canonical `ready.json` AND the process is inside a linked worktree (`isLinkedWorktree()`), the gate MUST fail **closed** (block), not open. Missing state for an active task means "unknown", not "permitted".

**Why**: cwd-relative resolution is forgeable by changing directory. `--show-toplevel` is NOT worktree-stable; `--git-common-dir` is. Fail-open on missing state turns "the file isn't here" into "no gating applies" — exactly the evasion vector.

**How to apply**: import `getCanonicalStateDir` / `isLinkedWorktree` from `flow-utils`; build state paths from `getCanonicalStateDir()`; for new gates, add the worktree + in-progress fail-closed branch. Verified in `tests/flow-worktree-gate-evasion.test.js`.

---

### Gates Built For User Input Must Skip `<channel>` Inter-Agent Traffic (2026-05-23)
<!-- PIN: gates-skip-channel-traffic -->
**Source**: wf-e5e57361 (RC3). The long-input / source-fidelity gate (`long-input-enforcement.js`) fired on workspace channel messages — manager→worker dispatches AND worker→manager `## Results` replies — writing a `long-input-pending` marker that deadlocked against the routing gate (7+ times across sessions).

**Rule**: A gate designed for USER input (long-input, source-fidelity, and similar prompt-shape gates) MUST skip channel-source messages — they are inter-agent transport, not user requests. Detect channel source by EITHER a `source` matching `/channel|notifications/i` OR a leading `<channel` content tag (`isChannelSourceMessage()`). Enforce the gate's actual invariant (e.g. source fidelity) at the manager's spec-AUTHORING layer (Logic Constitution 11.6 + `flow-source-fidelity.js`), where the user's verbatim prompt still trips the gate — NOT on the worker's channel-receive layer, where forcing it deadlocks against routing.

**Why**: a manager→worker dispatch has already passed through the user→manager gate; re-gating it on receipt is both redundant and deadlock-prone (the worker cannot route through `/wogi-start` while the routing gate is armed and the long-input marker blocks every tool).

**How to apply**: add an early channel-source skip near the top of any user-input gate. Verified in `tests/flow-hooks-long-input-enforcement.test.js` (channel-source skip block).

---

## Operational Procedures
<!-- PIN: operational-procedures -->

### GitHub Release Workflow (2026-01-30)
**Source**: Repeated failures (10+ times) in npm publish automation
**Details**: See `.claude/rules/_internal/github-releases.md` for full procedure.

**Quick reference**:
1. `git push origin master`
2. `git tag vX.Y.Z HEAD`
3. `git push origin vX.Y.Z`
4. `gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."`
5. `npm publish`

---

## Rejected Alternatives
<!-- PIN: rejected-alternatives -->

<!--
Catalog of approaches considered and rejected. Capture-gate (wf-a3cc5f2a) directs
durable rejected-alternative conclusions here so future agents do not re-propose them.

Format per entry:

### Alternative: <short name>
**Rejected**: <YYYY-MM-DD>
**Reason**: <why we said no — be specific>
**Chose instead**: <what we did instead, and where it lives>
**Source**: <task ID, audit, or session that produced this decision>
-->

### Alternative: Hand-edit ready.json to register orphaned specs
**Rejected**: 2026-04-15
**Reason**: CLAUDE.md memory-hierarchy rule forbids hand-editing `.workflow/state/` files to create tasks. Doing so bypasses routing telemetry and breaks the bypass-counter signal that surfaces actual workflow gaps.
**Chose instead**: One-off script using `flow-utils` `getReadyData` / `saveReadyData` API. The script is self-documenting (kept in `.workflow/scratch/` for the auto-cleanup pass) and uses the same write path the runtime uses.
**Source**: wf-a3cc5f2a session, state-sync between progress.md and ready.json after epic-episodic-memory wave.

---

## Architectural Decision Records
<!-- PIN: architectural-decision-records -->

ADRs live in `.workflow/state/adr/` as `ADR-{NNN}-{slug}.md` files. Each captures the
context, decision, consequences, and alternatives considered for a significant design choice.
The directory listing is the index — no separate registry file. The capture gate's classifier
identifies ADR-shaped conclusions in completed tasks and directs them here.

---

<!--
=====================================================================
PROMOTED TO WOGIFLOW PRODUCT LEVEL
=====================================================================

The following rules previously lived here but were product-level
WogiFlow methodology rules, not project-specific decisions. They
have been promoted to .workflow/templates/partials/methodology-rules.hbs
so every WogiFlow installation ships with them.

Promoted 2026-04-20:
- Code Quality Patterns (constants SSoT, named constants)
- Review-Findings Anti-Deferral (dedup with claude-md.hbs existing block)
- Workspace Autonomous-Mode Action-After-Completion Contract
- Story Creation Quality Gates (v2.22.0+)
- Workspace Worker Silent-Halt Detection Contract
- Workspace Worker Cannot Prompt User Directly
- Workspace Worker Text-Question Classifier
- Meta-pattern: Research Before Propose
- Completion-Claim Honesty Scan
- Merge-Plan Artifact Gate

See .workflow/templates/partials/methodology-rules.hbs for the
canonical version. To change enforcement behavior, edit the template
(not this file) and run `flow bridge sync`.
-->
