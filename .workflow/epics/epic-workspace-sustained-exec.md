# Epic: Workspace channel-dispatched workers: sustained autonomous execution

## Overview
<!-- PIN: overview -->
A channel-dispatched (especially decomposed/multi-sub-task) task must run to completion across Stop boundaries — stopping only when truly done, blocked, or paused — then emit a reliable `task-complete`. The manager gets distinct, observable states and a heartbeat instead of git-HEAD polling. Primary mechanism: a Stop-hook `{continue:true}` keeps the SAME worker session alive (sidesteps the flaky channel wake-up, preserves in-context decomposition).

## Success Metrics
<!-- PIN: success-metrics -->
- [ ] A dispatched 3-sub-task job completes all 3 unattended across Stop boundaries and reports `task-complete` (S6 regression test green).
- [ ] Manager can observe ack-received / work-started / in-progress(heartbeat) / complete / blocked distinctly — never mistakes POST `ok` for progress.
- [ ] Worker can be cycled from the manager (`flow workspace restart <worker>`) and resumes the in-progress task from durable state without re-executing completed sub-tasks.
- [ ] Solo (non-workspace) sessions are provably unaffected.

## Verified Root Cause (against source, 2026-05-22)
<!-- PIN: root-cause -->
| # | Hypothesis | Verdict | Evidence |
|---|------------|---------|----------|
| H1 | Channel work has no autonomous continuation | **CONFIRMED (core bug)** | `workspace-stop-gates.js:18-61` Gap B forces continuation only when `inProgressCount===0 && queued>0` (not-started). No gate for in-progress-but-unfinished. `flow-autonomous-mode.js` never forces Stop-continue, not auto-activated for dispatches. |
| H2 | Stop emits `worker-stopped`, no self-continue | **CONFIRMED + ordering bug** | `stop-orchestrator.js:91` calls `notifyWorkerStopped()` unconditionally BEFORE gates. `loop-check.js` can force-continue but needs a populated active `loop-session.json`; sub-tasks aren't criteria. |
| H3 | Post-idle channel re-delivery unreliable | **CONFIRMED; fix sidesteps it** | `workspace-channel-server.js:542` returns `ok` the instant it writes the notification — no consumption guarantee. Stop-hook `{continue:true}` keeps the SAME session alive instead. |
| H4 | `.workspace/messages` worker→manager laggy/lossy | **CONFIRMED** | `workspace-messages.js:110` plain `writeFileSync` (no fsync/atomic). Manager reads only at its own `UserPromptSubmit` boundary (`overdue-dispatches.js`) — no watch/poll/push. |
| H5 | No safe hook reload / no manager restart | **PARTIAL** | Hook entry scripts are fresh node procs → DO pick up upgraded code. Stale: long-lived channel-server MCP process + bash wrapper. No `flow workspace restart` exists. |

## Original Request (verbatim)
<!-- PIN: verbatim-source -->
> The workspace is not working as expected at all. This is from a session I tried working with it.
> ## Summary
> In a Wogi Workspace, the manager dispatches tasks to worker repos by POSTing to their channel port (e.g. `curl -X POST http://localhost:8801 -d "/wogi-start <spec>"`). A dispatch wakes the worker for exactly ONE turn; the worker then hits its Stop hook (emits a `worker-stopped` / reason:`graceful` message) and goes idle. It does NOT continue grinding through the rest of an in-progress, decomposed task (e.g. a 6-sub-task story) without another external poke. There is no sustained autonomous loop for channel-driven workers — so an unattended manager-orchestrated build stalls after the first turn of each story.
>
> ## Observed behavior (this session, real)
> - Manager dispatched a foundation story that the worker itself (correctly) decomposed into 6 ordered sub-tasks. The worker: created the spec, escalated one decision, received the GO, transitioned `spec_review → coding`, then hit Stop and went idle. Git HEAD never advanced; ZERO sub-task code was committed. Same idle pattern on the second worker.
> - `GET /health` returns ok and POSTs return `"ok"` even when the agent is idle — i.e. the channel SERVER (a separate `workspace-channel-server.js` process) is up regardless of whether the agent is doing anything. This makes a manager mistake "channel ACK" for "work happening." There is no distinct signal for ack-received vs work-started vs work-complete.
> - The worker→manager return path (`.workspace/messages/` `task-complete`/status messages) is laggy/unreliable — messages arrive minutes late or not when expected — so the manager can't depend on them and falls back to polling git HEAD.
> - Workers cannot self-restart to load updated hooks ("I cannot restart my own session from inside the running process"). A mid-session `npm i -D wogiflow@latest` left the package on the new version on disk but the RUNNING hooks on the old version, with no clean in-band reload — which destabilized the sessions (repeated graceful `worker-stopped` events, stale `taskInProgress` pointers).
> - Verified via `ps`/`lsof`: the worker Claude sessions ARE alive (`wogi-claude` + `wogi-claude-expect.exp` wrappers) and channel servers listen on the ports — so this is NOT dead [processes].
>
> ## Root-cause hypotheses to confirm against source (don't assume — verify)
> 1. Channel-dispatched work has no autonomous continuation: when a dispatched turn ends and the Stop hook fires, nothing re-prompts the session to continue the in-progress task's remaining sub-tasks/TodoWrite items. `flow-autonomous-mode.js` / the epic-decompose-and-run task-boundary SIGTERM cascade may not engage for channel-dispatched tasks, or it restarts without RESUMING.
> 2. The Stop hook emits `worker-stopped` but doesn't trigger self-continue when there is unfinished decomposed work on an active task.
> 3. Post-idle channel delivery: does a fresh POST reliably re-prompt an idle (post-Stop) session? Evidence is mixed — one dispatch caused a phase change, later ones produced no visible progress. Investigate whether queued channel events are reliably consumed after Stop.
> 4. Message-bus reliability: the `.workspace/messages/` write/flush + notification path drops/lags worker→manager messages.
> 5. No safe in-session hook reload after a dependency bump, and no manager-triggerable worker restart.
>
> ## What a correct fix delivers (for all workspace users)
> - A sustained execution mode for channel-dispatched workers: a dispatched (especially decomposed/multi-sub-task) task runs to completion across Stop boundaries — auto-continue or a cascade that RESUMES the same task — stopping only when truly done, blocked, or paused, then emitting a reliable `task-complete`.
> - A reliable completion/heartbeat signal to the manager, so orchestration doesn't rely on git-HEAD polling.
> - Distinct, observable states: ack-received vs work-started vs in-progress(heartbeat) vs complete vs blocked — so a manager can never mistake a channel `ok` for progress.
> - Either a manager-triggerable worker restart/keep-alive supervisor, or a clearly-detectable "restart required" contract; and a safe story for mid-session version/hook reload (or an explicit guard that refuses unsafe mid-session updates).
>
> ## Components likely involved (examine these)
> - `lib/workspace-channel-server.js` (the per-port channel server)
> - `lib/wogi-claude`, `lib/wogi-claude-expect.exp` (worker session launcher/automation)
> - the Stop hook that emits `type:"worker-stopped"`, `reason:"graceful"`
> - `scripts/flow-autonomous-mode.js` (walk-away mode) + the epic-decompose-and-run cascade + task-boundary SIGTERM reset
> - the `.workspace/messages/` message-bus writer + the worker `worker-channel-only-mcp.json` MCP wiring
>
> ## Constraints
> - This is the OSS framework (npm `wogiflow`) — fix benefits every multi-repo workspace, so keep it general, not project-specific. Follow the dual-repo rules (OSS-first; no teams code here). Add a regression test that reproduces "dispatch a 3-sub-task job → it completes all 3 unattended and reports done."
>
> [Plus user notes: workers left idle / watchers lapsed; this session's work is saved (answers file, execution plan, BE's E0 spec wf-a3b575ed.md); when fixed, will cycle worker sessions and re-dispatch with the sustained trigger. "ultrathink … challenge yourself up to 10 times until 95-100% certain … feel free to go online."]

## Item Manifest (every reported item → story)
<!-- PIN: item-manifest -->
| Source item | Mapped to |
|-------------|-----------|
| "no sustained autonomous loop"; H1; H2; "runs to completion across Stop boundaries" | **S2** gate on **S1** durable state |
| "in-progress decomposed task / 6 sub-tasks / TodoWrite items"; "restart without RESUMING"; root-cause (a) | **S1** + **S5** resume |
| "reliable completion/heartbeat signal … not git-HEAD polling"; H4; message-bus write/flush | **S3** |
| `worker-stopped` emitted every turn / ordering bug | **S3** |
| "distinct observable states: ack/started/in-progress/complete/blocked"; "POST ok ≠ progress"; "GET /health always ok" | **S4** |
| "manager-triggerable worker restart/keep-alive"; H5; "cannot self-restart for new hooks" | **S5** |
| "safe story for mid-session version/hook reload OR guard refusing unsafe updates" | **S5** |
| H3 "does a fresh POST reliably re-prompt idle session" | **S2** sidesteps (in-session continue); **S5** ack-protocol closes restart-edge residual |
| "add a regression test: dispatch a 3-sub-task job → completes all 3 unattended and reports done" | **S6** |

## Adversary-surfaced requirements (cross-model review, 2026-05-22) — non-negotiable
<!-- PIN: adversary -->
- **S1 is the foundation.** Without durable sub-task state, restart re-executes completed sub-tasks (possibly destructive: migrations, publishes). In-session continue alone only *masks* root-cause (a).
- **S2 escapes** must include: per-task iteration cap derived from sub-task count (not uniform); dual turn-AND-token/wall-clock budget; no-progress detector keyed on file-change count + sub-task delta (NOT git-HEAD only — false-positives on large refactors); risky-operation carve-out in the continue directive; `flow done` failure → escalate `## BLOCKED`, do not loop.
- **S3** must distinguish "spec written, awaiting approval" from "done" so the manager doesn't mark an approval-wait as complete.
- **S5** restart-with-resume must read S1's persisted state AND post a `worker-ready <taskId>` ack so the manager actively re-triggers (closes orphaned-task-after-restart + concurrent-session risk).

## Stories
<!-- PIN: stories -->
1. `wf-e72350bf` — S1 Durable sub-task state persistence (FOUNDATION, P0)
2. `wf-aee4a4fa` — S2 In-progress continuation Stop-gate for workers (P0)
3. `wf-d3ae1717` — S3 Reliable worker signal and heartbeat (P1)
4. `wf-87611c5e` — S4 Distinct observable worker states via /status (P1)
5. `wf-ee87a24e` — S5 Manager-triggerable worker restart with resume + ack (P1)
6. `wf-68b5cef7` — S6 Regression test: 3-sub-task unattended completion (MANDATORY, P0)

## Dependencies
<!-- PIN: dependencies -->
- S2 depends on S1 (reads durable sub-task state). S5 depends on S1 (resume) + S3 (worker-ready ack). S6 depends on S1+S2 (and exercises S3 signals). S3, S4 are independent of each other.

## Cross-cutting constraints
<!-- PIN: constraints -->
- OSS framework (`wogiflow`); general, not project-specific. Dual-repo rules: OSS-first, no teams code.
- Hook three-layer architecture: entry ≤120 LOC, logic in `core/`, CLI-agnostic core.
- All new gates **fail-open**. Named constants for thresholds. Config toggles under `workspace.*` in `config.json`.
- Worker-mode guarded everywhere: solo sessions MUST be unaffected.

## Status: ready
## Progress: 0%
## Created: 2026-05-22T14:46:45.719Z
## Updated: 2026-05-22T14:46:45.719Z
