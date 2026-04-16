# Project Decisions

Project-specific rules for the **wogi-flow** repository. These are conventions and decisions unique to THIS project, not WogiFlow product behavior.

**What belongs here:** Team conventions, project-specific architecture, repo-specific procedures.
**What does NOT belong here:** WogiFlow product behavior (fix the commands/scripts/templates instead), rules already in `.claude/rules/` (no duplication), rules already in CLAUDE.md.

---

## Architecture Decisions

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

## Coding Standards

### Code Quality Patterns (2026-01-12)
**Source**: Session review findings

1. **Single Source of Truth for Constants**
   - Avoid duplicating model/configuration objects across files
   - Import from one canonical location instead
   - Reason: Prevents drift and makes updates simpler

2. **Named Constants for Magic Numbers**
   - Define constants for threshold values, percentages, limits
   - Example: `COVERAGE_THRESHOLDS = { default: 0.7, comprehensive: 0.85, concise: 0.5 }`
   - Reason: Self-documenting code, easier maintenance

---

## UI/UX Decisions

<!-- Add UI/UX decisions here -->

---

## File/Folder Structure

<!-- Add structure rules here -->

---

## Operational Procedures

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

## Review & Cleanup Procedures

### Review-Findings Anti-Deferral (2026-04-15)

**When the user asks to "fix all" review findings, you MUST fix every finding of tier ≥ 1. Never silently defer.**

- "Ship all fixes" / "option 1" / "fix all" = every finding gets a fix in this release
- If an item is too large for the current release → STOP and ask the user before proceeding
- Never list a finding in release notes without shipping its fix
- "Deferred" is a user decision, not an AI decision
- If M1 takes 30 min and F1 takes 30 sec, that's not grounds to drop M1 — ask the user if they want to split

**Why**: 2026-04-15 v2.17.4 release claimed "fix all" but silently deferred M1 (doc bloat) and dropped M3 (_fastPath test gap) from the adversary findings. User correction: "You're not supposed to defer any fixes. It's up to the user to defer, not you." v2.17.5 shipped the actual fixes and added this rule.

**Verification**: grep the release commit message's "fixes" list against the review's findings list — every finding mentioned must also appear in the diff.

---

## Rejected Alternatives

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

ADRs live in `.workflow/state/adr/` as `ADR-{NNN}-{slug}.md` files. Each captures the
context, decision, consequences, and alternatives considered for a significant design choice.
The directory listing is the index — no separate registry file. The capture gate's classifier
identifies ADR-shaped conclusions in completed tasks and directs them here.

---

## Workspace Autonomous-Mode Action-After-Completion Contract (v2.20.0+)

**Rule**: A workspace worker's end-of-turn must be a deterministic action. Exactly one of these states must hold:

1. **ACTION** — started the next pre-approved channel dispatch (invoked `/wogi-start <nextId>`), OR
2. **ESCALATION** — channel-dispatched a `## QUESTION:` to the manager (after Resolution Protocol Steps 1–2 failed), OR
3. **IDLE** — zero pending channel dispatches AND zero in-progress tasks.

**Hedging language is mechanically forbidden**: "awaiting your signal", "let me know if", "or will proceed", "should I continue", "ready when you are", "standing by", "awaiting confirmation". These invent an imaginary decision point that does not exist in autonomous mode — the manager already pre-approved the dispatch by queuing it.

**Enforcement**:
- `TaskCompleted` hook emits `additionalContext` directing auto-pickup when queued channel dispatches exist (Gap A)
- `Stop` hook BLOCKS end-of-turn when a worker has queued dispatches but no in-progress task (Gap B)
- `worker-rules.md` template strengthened with the 3-state contract (Gap C)
- `routing-gate.js` narrow diagnostic-curl bypass for INTROSPECTION/DIAGNOSTIC replies (Gap D)

**Why**: 2026-04-16 incident — frontend worker on port 8802 completed wf-069c356e, sent results, then ended turn with "3 more queued — awaiting your signal or will proceed." Worker introspection: *"I treated visibility as a substitute for action. The 'or' in 'awaiting signal or will proceed' is the tell — in autonomous mode there is no 'or.' The dispatch is pre-approved. I invented an imaginary decision point to give myself permission to stop."*

**Visibility is NOT a substitute for action**. Workers can narrate AND act in the same turn. Stopping between queued dispatches creates a gap in the signal — the owner doesn't see the worker's terminal, so "transparency via hedge" is invisible.

**Config**: `config.workspace.autoPickupChannelDispatches` (default `true`), `config.workspace.diagnosticCurlBypass` (default `true`).

**Anti-rationalization checklist for workers**:
- "Let me give the owner visibility before acting" → WRONG. They don't see your terminal.
- "This is a natural stopping point" → WRONG. In autonomous mode there are no natural stopping points between queued tasks.
- "I should ask before proceeding" → WRONG. The queue IS the approval.
- "The work is done, I should summarize" → You can summarize AND start the next one in the same turn.


---

## Workspace Worker Cannot Prompt User Directly (v2.20.1+)

**Rule**: In workspace worker mode, the `AskUserQuestion` tool is mechanically blocked. Questions to the user MUST be channel-dispatched to the manager via `## QUESTION:`.

**Why this was necessary (not covered by v2.20.0)**:
v2.20.0 closed the hedging-between-queued-tasks gap: if a worker had queued dispatches and tried to stop, the Stop hook blocked. But that gap didn't fire when the queue was empty — a worker could still complete a task, have a question, and call `AskUserQuestion` (or just hedge in text) and stall silently. The user only sees the manager terminal, so direct prompts from workers are invisible.

**Enforcement**:
- `scripts/hooks/core/worker-boundary-gate.js` → `checkWorkerBoundary()`
- PreToolUse hook blocks `AskUserQuestion` when `WOGI_WORKSPACE_ROOT` set + `WOGI_REPO_NAME !== 'manager'`
- Block message gives the exact `curl ... --data-binary "## QUESTION: ..."` command so the worker has zero excuse to ask the user directly
- Config toggle: `config.workspace.blockAskUserQuestionInWorker` (default `true`)

**Design rationale — why block instead of redirect**:
Auto-transforming `AskUserQuestion` into a channel-dispatch is tempting but wrong. The worker needs to make a decision: either (a) channel-dispatch the real question to the manager for user input, or (b) make a reasonable autonomous decision and note it in the task reply. Silently redirecting would remove that choice. A hard block forces the worker to consciously pick.

**Complements v2.20.0**: this gap would have been open even with the other four gaps (Gap A auto-pickup, Gap B Stop block, Gap C rules, Gap D curl bypass). v2.20.1 is the piece that actually closes the user's original complaint.

**Self-critique from v2.20.0 (RESOLVED in v2.21.0)**: Gap D (diagnostic curl bypass) was removed in v2.21.0. User feedback: regex-based detection is brittle and the bypass solved a rare case at the cost of permanent attack surface. Diagnostic round-trips now use normal `/wogi-start` routing — the 10-second ceremony is acceptable for how rarely these fire.

---

## Workspace Worker Text-Question Classifier (v2.21.0+)

**Rule**: In workspace worker mode, if the AI ends a turn with a text-based question to the user (no tool call — just hedging like "let me know", "should I", "which option"), the Stop hook runs a Haiku classifier on the final assistant message via `scripts/flow-worker-question-classifier.js`. If the classifier detects an open question to the user with confidence ≥ 70 → stop is blocked with channel-dispatch instructions.

**Why AI instead of regex**: hedging vocabulary is infinite — "let me know", "should I", "which option", "thoughts?", "any preference?", "?" are all semantically the same but syntactically unbounded. User directive (2026-04-16 session): *"regex is brittle, use AI logic."*

**Why fail-open throughout**:
- Missing `ANTHROPIC_API_KEY` → skip
- Missing `transcriptPath` → skip (older Claude Code versions may not provide it)
- Malformed transcript JSONL → skip (transcript may be mid-write)
- Model call error → skip
- Silent-stall false negatives are recoverable; false-positive blocks on every turn are not.

**Complements v2.20.1 (AskUserQuestion block)**: v2.20.1 caught tool-based prompts. G3 catches text-based prompts. Together they make "worker talks to user directly" mechanically impossible across both surfaces.

**Config**: `workspace.aiWorkerQuestionClassifier.{enabled,minConfidence,model}` (defaults: true, 70, `anthropic:claude-3-5-haiku-latest`).

Cost per worker turn end: ~300 input + ~20 output tokens ≈ $0.0001 (or equivalent plan token draw). Latency: ~500ms–1s.

---

## Meta-pattern: Research Before Propose (2026-04-16)

**Pattern**: During the v2.20.x session, I repeatedly proposed fixes without first auditing existing infrastructure. Examples:
- Proposed blocking `ExitPlanMode` — the tool doesn't exist in the codebase
- Claimed Stop hook can't read transcripts — `claude-code.js:165-166` already wires `transcriptPath`
- Proposed "new" Haiku classifier architecture — `flow-conclusion-classifier.js` + `flow-correction-detector.js` already established that pattern
- Proposed worker-mode guarding for conclusion-detection — no observed problem; over-engineering

**Rule**: Before proposing any fix in a WogiFlow implementation session, audit existing infrastructure for the problem area (grep hooks, classifiers, gates, existing rules). Propose only what fills a confirmed gap. Evidence-before-invention.

**Why**: baseline LLM training biases toward generating plausible-sounding solutions. In a codebase with 100+ script files and rich existing infrastructure, "plausible" is frequently wrong. The correction cycle cost (user rejecting → re-planning → rejecting again) is higher than the upfront audit cost. The user correction that promoted this rule: *"You came up with a few suggestions without really researching what we have."*
