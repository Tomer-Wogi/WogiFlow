# [wf-f267ea2a] Auto-pickup next ready task at session restart

## User Story
**As a** WogiFlow operator running a multi-task epic
**I want** the AI to automatically pick up the next ready task after each task-boundary session restart
**So that** I do not have to type "what's next?" between every task during long autonomous runs

## Description
The existing `taskBoundaryReset` mechanism resets context between tasks by SIGTERM-restarting the session. The current SessionStart context (`scripts/hooks/core/session-context.js:867`) tells the AI to "Proceed with the user's next instruction" — meaning the AI waits for a user prompt and asks "what's next?" instead of self-directing. This story wires conditional auto-pickup: when the prior task completed cleanly and the ready queue is non-empty, the SessionStart context instead instructs the AI to immediately invoke `/wogi-start <nextReadyId>` on the first user message regardless of the message content. R-336's question-deferral path takes precedence (if `pending-question.json` exists, no auto-pickup — the user's pending question wins).

## Acceptance Criteria

### Scenario 1: Clean completion → auto-pickup
**Given** the prior task completed cleanly via `flow done` (no error exit, no `pending-question.json`)
**And** `config.taskBoundaryReset.autoPickupNextTask` is `true` (default)
**And** `ready.json` has at least one task in the `ready` array
**When** `task-boundary-reset.js` writes the clean-completion marker and SIGTERM fires
**Then** the next SessionStart hook injects an AUTO-PICKUP block in the additionalContext that names the next ready task ID and instructs the AI to invoke `/wogi-start <nextReadyId>` on the first user message
**And** the marker file is deleted (consumed) so subsequent restarts do not loop on it

### Scenario 2: Pending question → no auto-pickup (R-336 takes precedence)
**Given** `pending-question.json` exists in `.workflow/state/`
**When** SessionStart fires
**Then** the existing pending-question handling runs and the AUTO-PICKUP block is NOT injected
**And** the user's reply lands in the existing question context

### Scenario 3: Prior task errored → no auto-pickup
**Given** the prior task did not write the clean-completion marker (errored, was blocked, or was killed mid-task)
**When** SessionStart fires
**Then** the AUTO-PICKUP block is NOT injected
**And** the existing "Proceed with the user's next instruction" message is used

### Scenario 4: Empty ready queue → no auto-pickup
**Given** the clean-completion marker is present
**But** `ready.json` `ready` array is empty
**When** SessionStart fires
**Then** AUTO-PICKUP is NOT injected
**And** the marker is consumed anyway (so it does not fire on a future unrelated restart)

### Scenario 5: Flag disabled → no auto-pickup
**Given** `config.taskBoundaryReset.autoPickupNextTask: false`
**When** SessionStart fires after clean completion
**Then** AUTO-PICKUP is NOT injected even if all other conditions are met
**And** the marker is consumed (the flag controls injection, not marker writing)

### Scenario 6: Marker is consumed exactly once
**Given** the marker is present and AUTO-PICKUP is injected
**When** the user sends a second unrelated message later (without completing a task)
**Then** AUTO-PICKUP is NOT re-injected — the marker was deleted on first use

## Technical Notes
- **Files to modify**:
  - `.workflow/config.json` — add `taskBoundaryReset.autoPickupNextTask: true`
  - `config.schema.json` — add property definition (if schema exists)
  - `lib/installer.js` — add to fresh-install config defaults
  - `scripts/hooks/core/task-boundary-reset.js` — write clean-completion marker on Phase 2 trigger path (right before SIGTERM, when preconditions hold)
  - `scripts/hooks/core/session-context.js` (~line 867) — read marker, gate auto-pickup logic, inject AUTO-PICKUP block, delete marker. Place AFTER the existing `endReason === 'task-boundary-restart'` branch — same data source, augments rather than replaces it.
  - `.workflow/templates/partials/methodology-rules.hbs` — document the AUTO-PICKUP behavior so it ships in user CLAUDE.md (per the Rule Placement Decision 2026-04-20: enforcement code shipping in `scripts/hooks/` requires the rule TEXT to ship in the template)
- **New files**:
  - `tests/flow-task-boundary-autopickup.test.js` — covers all 6 scenarios above
- **Marker file path**: `.workflow/state/task-boundary-clean-completion.json` — tiny JSON `{ taskId, completedAt }`
- **Precedence order** in session-context.js: pending-question.json check (existing) → clean-completion-marker check (new) → default "proceed with next instruction" message
- **Auto-pickup message format** (target wording, refined during implementation):
  > **AUTO-PICKUP MODE ACTIVE**: Prior task completed cleanly. The next ready task is `<nextReadyId>`. On the first user message in this session, immediately invoke `/wogi-start <nextReadyId>` — do NOT ask "what's next?", do NOT summarize. The user has authorized autonomous continuation across the epic.

## Test Strategy
- [ ] Unit: All 6 scenarios in `tests/flow-task-boundary-autopickup.test.js` using temp `.workflow/state/` fixtures
- [ ] Integration: existing `tests/flow-task-boundary-reset.test.js` continues to pass (no regression on the Phase 1/2 marker logic)
- [ ] Manual: complete one ready task in this session and verify the next session injects AUTO-PICKUP

## Dependencies
- Depends on: existing `taskBoundaryReset` (v2.26.1+ Phase 1+2 marker logic) — already shipped
- Depends on: `pending-question.json` mechanism (R-336) — already shipped

## Complexity
**Medium** — small surface area (5 files modified + 1 test file), but touches the session-restart critical path. Risk is mitigated by: (a) feature-flag gating, (b) fail-open default in session-context.js (if anything fails, fall back to existing "proceed with next instruction"), (c) marker is single-use and tied to clean-completion path only.

## Out of Scope
- Cross-session token-budget recovery (existing taskBoundaryReset handles this)
- UI for toggling the flag (config edit only)
- Worker-mode equivalent (already exists as `workspace.autoPickupChannelDispatches`)
- Any change to the `flow done` exit path or task-completed hook

## Approval Note
This spec was authored autonomously based on the user's explicit pre-approval directive in the conversation 2026-04-24:

> "I want you to do everything pending [...] every time you restart the session you'll already know what you need to start working on and start working on it so I will not have to talk to you every time you finish a task and restart the session"

> "Whatever you can decide for yourself. Do so. [...] challenge yourself a few times and you might come up with a solution that is with 90% certainty and then you can just go ahead and implement that."

The spec-review approval gate is treated as satisfied by this directive. Per the `feedback_autonomous_decisions.md` memory rule, the AI proceeds to implementation autonomously and documents the autonomous decisions in the task summary at completion.

## Boundaries (DO NOT MODIFY)
- `scripts/hooks/core/task-boundary-reset.js` Phase 1 marker logic (`markRestartPending` write path) — extend, do not modify the existing semantics
- `pending-question.json` handling in session-context.js — must remain the highest-precedence path
