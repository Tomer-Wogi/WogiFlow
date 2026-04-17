# [wf-d3e67abe] Silent-worker-halt detection via dispatch-tracking

## User Story
**As a** WogiFlow workspace manager operator
**I want** the manager to automatically detect when a dispatched worker has gone silent (crash, OOM, network loss, hang, unexpected stop)
**So that** I am not blind to worker deaths and do not lose session cycles to undetected halts

## Description
Workspace-worker architecture (v2.20.0+) allows a manager Claude session to dispatch tasks to worker Claude sessions in other repos. Today, if a worker dies silently — OOM, SIGKILL, network drop, infinite hang, Ctrl+C without graceful exit — the manager receives no signal whatsoever. No hook fires (Stop only fires on graceful exit), no message arrives, and the human must visually notice the worker terminal is idle. Multiple real session cycles have been lost to this. Research confirmed: (1) Stop-hook-based notification is architecturally incapable of covering non-graceful halts; (2) a background watchdog daemon violates WogiFlow's file-based-state + explicit-polling + no-background-processes architecture. The native shape is **dispatch-tracking**: manager records every dispatch; any pending dispatch past its deadline with no matching `task-complete` message = silent death, regardless of cause.

## Acceptance Criteria

### Scenario 1: Happy path — dispatch recorded and reconciled on completion
**Given** the manager session has an active workspace with a healthy worker repo
**When** the manager calls `dispatchToChannel(workspaceRoot, repoName, taskId)` and the HTTP POST returns 200
**Then** a dispatch record `{taskId, repoName, dispatchedAt, expectedDeadline, status: 'pending'}` is appended to `.workspace/state/dispatched-tasks.json`
**And** when the worker later writes a `task-complete` message for that `taskId` to `.workspace/messages/`, the matching dispatch record is reconciled (final marking/removal policy resolved in spec phase)
**And** the reconciled task does NOT appear in the next manager-turn overdue check

### Scenario 2: Silent death surfaced on manager turn
**Given** a dispatch record exists with `status: 'pending'` and `expectedDeadline` has passed
**And** no `task-complete` message exists in `.workspace/messages/` for that `taskId`
**When** the user submits a prompt to the manager session
**Then** a hook runs before the model processes the prompt (the exact hook determined in spec — `UserPromptSubmit` is the working assumption)
**And** the hook surfaces the overdue dispatch to the model via a system-reminder-equivalent mechanism (exact mechanism verified in spec)
**And** the manager model can see and report: task-id, worker repo, time dispatched, time elapsed past deadline, suspected silent death

### Scenario 3: Graceful stop without completion — distinguishable from silent death
**Given** a worker has been dispatched task `T`
**When** the Stop hook fires on the worker AND no `task-complete` message was written this session for `T`
**Then** `stop.js:64-121` writes a structured message `{type: 'worker-stopped', reason: 'graceful', state: 'idle' | 'mid-work', taskInProgress: T | null, lastSha}` to `.workspace/messages/` in the same format/location as `task-complete` messages
**And** this replaces the current unstructured plain-text curl POST
**And** the manager-turn overdue check treats the dispatch as "worker gave up gracefully" — NOT as silent death — surfacing it with a distinct label

### Scenario 4: Legitimately long task — no false positive
**Given** a task is dispatched with an `expectedDurationMs` override longer than the default
**When** the actual task runs inside that deadline window and completes normally
**Then** no overdue alert is raised during the task's execution
**And** the dispatch is reconciled normally on completion

### Scenario 5: Caller overrides deadline
**Given** the manager calls `dispatchToChannel(workspaceRoot, repoName, taskId, { expectedDurationMs: 7_200_000 })`
**When** the dispatch record is written
**Then** `expectedDeadline = dispatchedAt + 7_200_000 ms`
**And** the overdue check uses that value, not the default

### Scenario 6: Backwards compatibility
**Given** the current `task-complete` message flow
**When** dispatch-tracking is introduced
**Then** existing `task-complete` structure is unchanged
**And** existing `waitForCompletion()` in `lib/workspace-routing.js:829-890` continues to work identically
**And** any existing caller of `dispatchToChannel()` that does not pass `expectedDurationMs` still works (default applied)

### Scenario 7: No background processes introduced
**Given** the full implementation is in place
**When** reviewing the solution
**Then** no setInterval, setTimeout(long), file watcher, daemon, or continuously-running polling loop is introduced
**And** all liveness signaling happens via file writes and hook-driven reads

### Scenario 8: decisions.md contract
**Given** the feature is complete
**When** reading `.workflow/state/decisions.md`
**Then** a new rule "Workspace Worker Silent-Halt Detection Contract" exists as a sibling to the v2.20.0 action-after-completion contract, documenting the dispatch-tracking pattern, deadline semantics, reconciliation rule, and graceful-stop message shape

## Technical Notes

- **Architecture reference**: file-based state + explicit polling + no background processes (see `.workflow/state/decisions.md` Dual-Repo Architecture and workspace-worker contracts).
- **Files likely touched** (subject to architect pass):
  - `lib/workspace-routing.js` — dispatch recording inside `dispatchToChannel()` (currently at lines 705-746 per research).
  - `scripts/hooks/entry/claude-code/user-prompt-submit.js` OR a new dedicated manager hook — overdue check.
  - `scripts/hooks/entry/claude-code/stop.js` — graceful-stop structured message (replace lines 64-121 plain-text POST).
  - `scripts/hooks/core/task-completed.js` — dispatch reconciliation on completion-message write (currently 469-512).
  - `.workspace/state/dispatched-tasks.json` — NEW state file.
  - `.workflow/state/decisions.md` — NEW rule.
  - `tests/` — new suite covering scenarios 1–8.
- **State file schema** (NEW): `.workspace/state/dispatched-tasks.json` = `{ dispatches: [{ taskId, repoName, dispatchedAt, expectedDeadline, status, dispatchedBy?, reconciledAt? }] }`. Exact schema ratified in spec.
- **Default deadline**: 30 min starting point (matches `waitForCompletion` timeout); overridable per dispatch. Final value defended in spec.
- **Constraints**: no new dependencies; pure Node + existing file primitives; no MCP surface changes.

## Open Design Questions (MUST be resolved during spec / architect pass before coding)

1. **Reconciliation policy**: mark `status: 'completed'` in-place (audit trail) vs remove the record (bounded file size). Pick one with justification.
2. **Manager-turn hook identity**: verify `UserPromptSubmit` can inject context the model actually sees on the turn, OR identify a better hook. Document the exact mechanism.
3. **Long-running task policy**: (a) caller provides realistic `expectedDurationMs`, vs (b) worker emits optional `progress` messages that extend the deadline. Pick one, defend. Must not produce false positives.
4. **Default deadline value**: 30 min (aligns with `waitForCompletion`) vs shorter/longer. Defend choice.
5. **Cleanup policy** for `.workspace/state/dispatched-tasks.json`: max retention? ring buffer? archive-on-reconcile? Pick one.
6. **Manager-only hook scoping**: the overdue check must fire only in manager sessions, not in worker sessions. Confirm `WOGI_REPO_NAME === 'manager'` is the correct gate (consistent with existing `isWorkspaceWorker()` pattern).

## Test Strategy

- [ ] Unit: dispatch record write on successful POST (`dispatchToChannel`).
- [ ] Unit: reconciliation on matching `task-complete` message arrival (`task-completed.js` core).
- [ ] Unit: overdue filter correctly classifies pending+past-deadline vs pending+within-deadline vs completed.
- [ ] Integration: mock worker that dies without sending `task-complete` → manager-turn hook surfaces overdue alert on next prompt.
- [ ] Integration: legitimately long task with `expectedDurationMs` override completes without false overdue alert.
- [ ] Integration: graceful Stop without completion → structured `worker-stopped` message arrives at `.workspace/messages/`, distinguishable from silent death in overdue check output.
- [ ] Integration: existing `waitForCompletion()` path is byte-identical in behavior (regression test).
- [ ] Negative: worker session (not manager) does NOT run the overdue hook.

## Dependencies

- None (building on existing v2.20.0+ workspace-worker infra).

## Complexity

**Medium–High** — L1 story. Multi-file, crosses dispatch path + hooks + Stop-hook semantics + new state file + decisions.md rule. Requires architect pass + Logic Adversary pass because of 6 open design questions. Not complex in LOC (~100-150 new LOC + ~80 test LOC) but complex in invariants (backwards compat, no-daemons constraint, false-positive avoidance).

## Out of Scope

- Manager-side silence detection (if the manager itself halts, that's a separate problem).
- MCP status tool additions or `/health` endpoint enhancements.
- Stop-hook restructuring beyond scenario 3's structured-message replacement.
- Generic distributed-systems watchdog; this is scoped to WogiFlow workspace-worker pattern only.
- Recovery/auto-redispatch of detected silent-dead tasks — scope is **detection + surfacing only**. Recovery is a follow-up story.
- Heartbeat-on-every-tool-call mechanism (explicitly rejected during research as over-engineered for this architecture).

## Boundaries (DO NOT MODIFY)

- `lib/workspace-routing.js:829-890` (`waitForCompletion` body) — regression-protected; behavior must be byte-identical. Additive changes to surrounding functions allowed.
- `scripts/hooks/core/task-completed.js:469-512` (`task-complete` message shape/fields) — additive only; no renaming/removal of existing fields.
- `.workspace/messages/` directory layout and existing message consumers — additive message types only.
- Existing MCP tools in `lib/workspace-channel-server.js` — no changes to `workspace_send_message` signature or `/health` endpoint.
