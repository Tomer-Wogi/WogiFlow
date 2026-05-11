#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code Stop Hook
 *
 * Called when Claude is about to stop.
 * Enforces:
 * 1. Loop completion - blocks stop if acceptance criteria incomplete
 * 2. Routing enforcement - blocks stop if routing-pending flag is still set
 *    (catches text-only responses that bypassed /wogi-start routing)
 *
 * v6.2: Added routing enforcement to catch post-compaction bypass
 */

const { checkLoopExit } = require('../../core/loop-check');
const { isRoutingPending, incrementStopAttempts } = require('../../core/routing-gate');
const { runHook } = require('../shared/hook-runner');

runHook('Stop', async ({ parsedInput }) => {
  // wf-35742353 — Gate priority: if long-input-pending is active, it is the
  // top-priority remediation. The UserPromptSubmit hook already surfaced the
  // full long-input message on prompt arrival; firing routing-enforcement
  // and research-required gates now would issue conflicting "do this NOW"
  // instructions in the same turn. Defer the lower-priority Stop-hook gates
  // until long-input-pending is resolved.
  //
  // Fail-open: any error reading the marker falls through to normal gate flow.
  let longInputActive = false;
  try {
    const { isLongInputPending } = require('../../core/long-input-enforcement');
    longInputActive = isLongInputPending();
  } catch (_err) { /* fail-open */ }

  // v6.2: Routing enforcement check — catches text-only response bypass
  // If routing-pending flag is still set when the AI tries to stop, it means
  // the AI responded to the user's message without ever invoking a /wogi-* command.
  // This is the exact bypass we need to prevent (especially after context compaction).
  try {
    if (isRoutingPending() && !longInputActive) {
      // Use counter-based approach instead of clearing immediately.
      // This gives the AI multiple chances to comply before giving up.
      // Gap 4 fix: clearing immediately made this single-shot protection.
      const { cleared, attempts } = incrementStopAttempts(10);

      if (cleared) {
        // Max attempts reached — allow stop to prevent infinite loop
        if (process.env.DEBUG) {
          console.error(`[Stop] Max routing enforcement attempts reached (${attempts}), allowing stop`);
        }
        // Fall through to normal stop logic
      } else {
        // Block the stop — force the AI to route through /wogi-start
        const routingMessage = [
          `ROUTING VIOLATION (attempt ${attempts}/10): You MUST call Skill(skill="wogi-start") before responding.`,
          '',
          'Call Skill(skill="wogi-start", args="<user\'s message>") NOW. No text. No explanation. Just the Skill tool call.'
        ].join('\n');

        // Return raw output — skip adapter transform for routing enforcement
        // (this needs { continue: true, stopReason } format directly)
        return { __raw: true, continue: true, stopReason: routingMessage };
      }
    }
  } catch (err) {
    // Fail-CLOSED for routing check — force continuation on errors.
    // Gap 5 fix: failing open here disabled the last line of defense.
    // Worst case: AI retries and hits the 3-attempt limit, which clears naturally.
    if (process.env.DEBUG) {
      console.error(`[Stop] Routing check error (fail-closed, forcing continue): ${err.message}`);
    }
    return {
      __raw: true,
      continue: true,
      stopReason: 'Routing enforcement check encountered an error. Please invoke /wogi-start with your request.'
    };
  }

  // Workspace worker: write a structured `worker-stopped` message to the
  // workspace message bus when stopping. This is the graceful-stop half of
  // silent-halt detection (wf-d3e67abe) — the manager's overdue check uses
  // this (vs. task-complete vs. nothing) to tell "finished" from "gave up
  // gracefully" from "died silently".
  //
  // Replaces the previous plain-text curl POST to the manager channel — that
  // was fire-and-forget with no structure, so manager-side reconciliation
  // couldn't distinguish graceful stops from silent deaths.
  if (process.env.WOGI_REPO_NAME && process.env.WOGI_REPO_NAME !== 'manager') {
    try {
      const nodePath = require('node:path');
      const childProcess = require('node:child_process');
      const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
      const repoName = process.env.WOGI_REPO_NAME;

      if (!VALID_NAME.test(repoName)) {
        throw new Error(`Invalid WOGI_REPO_NAME`);
      }

      const workspaceRoot = process.env.WOGI_WORKSPACE_ROOT;
      if (workspaceRoot) {
        const { PATHS, safeJsonParse } = require('../../flow-utils');
        const ready = safeJsonParse(nodePath.join(PATHS.state, 'ready.json'), {});
        const recentTask = (ready.recentlyCompleted || [])[0];
        const inProgressTask = (ready.inProgress || [])[0];
        const mostRecent = recentTask || inProgressTask;

        // Determine worker state at stop-time
        const hasInProgress = Boolean(inProgressTask);
        const state = hasInProgress ? 'mid-work' : 'idle';
        const taskInProgress = hasInProgress ? inProgressTask.id : null;

        // Best-effort lastSha
        let lastSha = null;
        try {
          lastSha = childProcess.execSync('git rev-parse --short HEAD 2>/dev/null || true', {
            cwd: PATHS.root,
            encoding: 'utf-8',
            timeout: 2000
          }).trim() || null;
        } catch (_err) { /* non-critical */ }

        // Build structured message and persist via the workspace message bus.
        // The worker-stopped type was added to MESSAGE_TYPES in
        // workspace-messages.js (wf-d3e67abe).
        try {
          const libMessages = nodePath.resolve(__dirname, '..', '..', '..', '..', 'lib', 'workspace-messages');
          const { createMessage, saveMessage } = require(libMessages);
          const msg = createMessage({
            from: repoName,
            to: 'manager',
            type: 'worker-stopped',
            subject: hasInProgress
              ? `Worker stopped mid-work on ${taskInProgress}`
              : `Worker stopped (idle)`,
            body: [
              `Worker "${repoName}" is stopping.`,
              `State: ${state}`,
              taskInProgress ? `Task in progress: ${taskInProgress}` : null,
              mostRecent?.title ? `Most recent task: ${mostRecent.title}` : null,
              lastSha ? `Last commit: ${lastSha}` : null
            ].filter(Boolean).join('\n'),
            priority: hasInProgress ? 'high' : 'medium',
            actionRequired: hasInProgress
          });
          // Attach structured fields the manager-side reconciler consumes.
          msg.taskId = taskInProgress;
          msg.reason = 'graceful';
          msg.state = state;
          msg.taskInProgress = taskInProgress;
          msg.lastSha = lastSha;
          saveMessage(workspaceRoot, msg);
        } catch (err) {
          if (process.env.DEBUG) {
            console.error(`[Stop] Workspace message write failed: ${err.message}`);
          }
        }
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Stop] Workspace notification failed: ${err.message}`);
      }
    }
  }

  // Task-boundary session restart (wf-39e9dc09 — Phase 2, Stop-hook pivot).
  // Runs BEFORE checkLoopExit so we can SIGTERM cleanly if a task was just
  // completed. This is a verified direct child of the claude process (the
  // Stop hook fires reliably — directly observed in test run 2026-04-15,
  // unlike TaskCompleted which was found not to fire for Task-tool subagents).
  // No-op unless task-just-completed marker exists AND feature is enabled
  // AND wogi-claude wrapper env is present.
  try {
    const {
      consumeAndTriggerRestart,
      hasPendingMarker,
      ensurePhase1MarkedIfRecentlyCompleted
    } = require('../../core/task-boundary-reset');

    // Phase 1 fallback: if the task completed via a path that didn't write the
    // marker (e.g., agent edited ready.json directly instead of running
    // `flow done`, or TaskCompleted hook didn't fire), retro-mark here so
    // Phase 2 below can consume it. Anti-replay sentinel prevents double-firing
    // across the SIGTERM + wrapper restart cycle.
    try {
      const fallback = ensurePhase1MarkedIfRecentlyCompleted();
      if (fallback.marked && process.env.DEBUG) {
        console.error(`[Stop] Phase 1 fallback marked ${fallback.taskId}`);
      } else if (!fallback.marked && fallback.reason !== 'marker-already-present' &&
                 fallback.reason !== 'no-fresh-completion' &&
                 fallback.reason !== 'stale-completion' &&
                 fallback.reason !== 'already-triggered-for-this-task' &&
                 process.env.DEBUG) {
        console.error(`[Stop] Phase 1 fallback skipped: ${fallback.reason}`);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[Stop] Phase 1 fallback error (fail-open): ${err.message}`);
      }
    }

    // If we're about to restart, record the session in history FIRST so the
    // new session can find the prior session's resume token. Use parsedInput
    // or session-state for the cliSessionId.
    if (hasPendingMarker()) {
      try {
        const { recordSessionEnd } = require('../../core/session-history');
        let cliSessionId = parsedInput?.sessionId || null;
        if (!cliSessionId) {
          // Fallback: read from session-state.json
          const { PATHS, safeJsonParse } = require('../../../flow-utils');
          const path = require('node:path');
          const ss = safeJsonParse(path.join(PATHS.state, 'session-state.json'), {});
          cliSessionId = ss.cliSessionId || null;
        }
        if (cliSessionId) {
          // Collect tasks completed in this session from recentlyCompleted
          // (best-effort — not all of these are from THIS session but it's
          // a reasonable approximation; in practice the newest entries are ours)
          const { PATHS, safeJsonParse } = require('../../../flow-utils');
          const path = require('node:path');
          const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), {});
          const recent = ready.recentlyCompleted || [];
          const lastCompleted = recent[0] || null;
          recordSessionEnd({
            cliSessionId,
            endReason: 'task-boundary-restart',
            tasksCompletedInSession: recent.slice(0, 5).map(t => t.id).filter(Boolean),
            lastActiveTaskTitle: lastCompleted?.title || null
          });
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[Stop] Session history record failed (non-fatal): ${err.message}`);
        }
      }
    }

    const restartResult = await consumeAndTriggerRestart({
      transcriptPath: parsedInput?.transcriptPath
    });
    if (restartResult.triggered) {
      if (process.env.DEBUG) {
        console.error(`[Stop] Task-boundary restart triggered — claude will exit, wrapper will relaunch`);
      }
      // CRITICAL: return NOW, short-circuiting subsequent stop-blocking gates.
      //
      // Before this fix (observed 2026-04-17): Phase 2 would SIGTERM claude and
      // write the restart flag, then fall through to the workspace autopickup
      // gate (lines below). For a worker with queued dispatches (the common
      // case), that gate returns `{ continue: true, stopReason: ... }` which
      // Claude Code honours as "don't stop, pick up next dispatch." Result: the
      // SIGTERM + restart flag became a no-op because claude was told to keep
      // running in the SAME session. Symptom: single claude PID survives across
      // N tasks, context accumulates, tokens burn — exactly the complaint this
      // feature was supposed to solve.
      //
      // The restart is our stop path. The next session's SessionStart hook will
      // inject queued-dispatch context, so the worker picks up the next task
      // on RESTART rather than via the autopickup gate's continue-override.
      // __raw skips the adapter transform — we want the literal {continue:false}
      // wire format to reach claude unchanged.
      return { __raw: true, continue: false };
    }
    if (restartResult.reason !== 'no-pending-marker' && process.env.DEBUG) {
      console.error(`[Stop] Task-boundary restart check: ${restartResult.reason}`);
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Stop] Task-boundary restart module error (fail-open): ${err.message}`);
    }
    // Never block Stop on restart-module errors.
  }

  // wf-5cd71b1f: Research-Required Stop-Hook Gate. If the user's prompt this
  // turn was classified as diagnostic (Tier 2/3 from CLAUDE.md), check that
  // the AI made enough Read calls against evidence paths before answering.
  // If not, re-prompt with a violation message forcing a redo. Fail-open.
  //
  // wf-35742353 — Skip this gate when long-input-pending is active. The user's
  // prompt isn't yet captured, so demanding evidence-reading would issue a
  // conflicting remediation. The diagnostic marker will still be present when
  // long-input resolves; the gate fires correctly then.
  try {
    if (longInputActive) {
      // skip — defer to long-input remediation
    } else {
    const { checkResearchRequiredGate } = require('../../core/research-required-gate');
    const { getConfig } = require('../../../flow-utils');
    const config = getConfig();
    const result = checkResearchRequiredGate({
      transcriptPath: parsedInput?.transcriptPath,
      config
    });
    if (result.blocked) {
      if (result.hardStop) {
        // Hard-stop: AI failed N times — surface to user
        return { __raw: true, continue: false, stopReason: result.message };
      }
      // Soft re-prompt: force the AI to redo with reads
      return { __raw: true, continue: true, stopReason: result.message };
    }
    } // end else (wf-35742353 long-input-active skip)
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Stop] Research-required gate error (fail-open): ${err.message}`);
    }
  }

  // Gap B (v2.20.0) — block end-of-turn when a workspace worker has queued
  // channel dispatches but no task in progress. This is the hedging-as-terminal-
  // state anti-pattern ("awaiting signal or will proceed"). The worker MUST
  // either (a) start the next dispatch or (b) escalate via ## QUESTION: — idle
  // with pending dispatches is not a valid end-of-turn state.
  //
  // Gap A already injects additionalContext telling the AI to auto-pickup. This
  // gate is the second line of defense: if the AI ignored the context and tried
  // to stop anyway, block it.
  try {
    const isWorker = process.env.WOGI_WORKSPACE_ROOT &&
                     process.env.WOGI_REPO_NAME &&
                     process.env.WOGI_REPO_NAME !== 'manager';
    if (isWorker) {
      const { getConfig, PATHS, safeJsonParse } = require('../../../flow-utils');
      const path = require('node:path');
      const config = getConfig();
      const gateEnabled = config.workspace?.autoPickupChannelDispatches !== false;
      if (gateEnabled) {
        const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), { ready: [], inProgress: [] });
        const inProgressCount = (ready.inProgress || []).length;
        const queued = (ready.ready || []).filter(t => {
          if (!t || typeof t !== 'object') return false;
          return t.channelSource === 'wogi-workspace-channel' ||
                 t.dispatchedBy === 'workspace-manager' ||
                 (typeof t.source === 'string' && t.source.startsWith('workspace:'));
        });
        if (inProgressCount === 0 && queued.length > 0) {
          const nextId = queued[0].id;
          const msg = [
            `AUTONOMOUS MODE VIOLATION: ${queued.length} channel dispatch(es) queued, no task in progress.`,
            '',
            `You are a workspace worker — "awaiting your signal" / "let me know" / "or will proceed" is NOT a valid terminal state.`,
            '',
            'Exactly one of these must be true at end-of-turn:',
            '  (a) You started the next pre-approved dispatch (ACTION), or',
            '  (b) You channel-dispatched a "## QUESTION:" to manager (ESCALATION), or',
            '  (c) Zero queued and zero in-progress (IDLE — not your current state).',
            '',
            `ACT NOW: Invoke Skill(skill="wogi-start", args="${nextId}")`,
            '',
            `Or escalate: curl -s -X POST http://127.0.0.1:${process.env.WOGI_MANAGER_PORT || '8800'} \\`,
            `  -H "X-Wogi-From: ${process.env.WOGI_REPO_NAME}" \\`,
            `  --data-binary "## QUESTION: <your blocker>"`
          ].join('\n');
          return { __raw: true, continue: true, stopReason: msg };
        }
      }
    }
  } catch (err) {
    // Fail-OPEN for this specific gate — we do not want a bug here to block
    // legitimate stops. The routing gate above is fail-closed; this one isn't
    // because unlike routing it's not a last-line-of-defense — the auto-pickup
    // additionalContext already nudged the AI before this point.
    if (process.env.DEBUG) {
      console.error(`[Stop] Workspace autopickup gate error (fail-open): ${err.message}`);
    }
  }

  // Worker Tool-First Turn Gate (G1 + G4 + G6 — epic wf-34290000, Workstream G).
  //
  // In worker mode, every turn after a UserPromptSubmit (channel dispatch)
  // MUST have at least one tool call. Strict mode also requires the first
  // assistant content block to be a tool call, not text. Pure-text worker
  // responses are invisible to the user and violate the three-state
  // end-of-turn contract.
  //
  // Gates in order: G1 (zero tool_use = silent-halt) → G4 (text-first block =
  // text-before-tool-call). Both share the rule name "worker-tool-first-turn"
  // (G6). Fail-open — missing transcript / parse errors / config errors
  // return no-block.
  try {
    const { isWorkerMode, checkWorkerToolFirstTurn, renderBlockMessage } =
      require('../../core/worker-tool-first-gate');
    if (isWorkerMode() && parsedInput?.transcriptPath) {
      const { getConfig } = require('../../../flow-utils');
      const config = getConfig();
      const gateCfg = config.workspace?.toolFirstTurnGate;
      const enabled = gateCfg?.enabled !== false;  // default true
      if (enabled) {
        const strict = gateCfg?.strict !== false;  // default true
        const result = checkWorkerToolFirstTurn({
          transcriptPath: parsedInput.transcriptPath,
          strict
        });
        if (result.blocked) {
          return {
            __raw: true,
            continue: true,
            stopReason: renderBlockMessage(result)
          };
        }
      }
    }
  } catch (err) {
    // Fail-OPEN — any error in the tool-first gate must not block legitimate
    // stops. Silent-halt / text-first false-negatives are recoverable; a
    // false-positive block on every turn is not.
    if (process.env.DEBUG) {
      console.error(`[Stop] Worker tool-first gate error (fail-open): ${err.message}`);
    }
  }

  // G3 (v2.21.0) — AI-based worker-question classifier.
  //
  // If the worker ends a turn with a question to the user in free text (no tool
  // call, just hedging), Gap B above won't fire when the queue is empty.
  // Regex-based detection was rejected as brittle. Instead: a single Haiku call
  // classifies the final assistant message. If it IS an open question to the
  // user → block with escalation instructions.
  //
  // Fail-open throughout: missing API key, missing transcript, model errors,
  // malformed responses all skip cleanly. Silent-stall false-negatives recover;
  // blocking legitimate stops on classifier bugs does not.
  try {
    const isWorker = process.env.WOGI_WORKSPACE_ROOT &&
                     process.env.WOGI_REPO_NAME &&
                     process.env.WOGI_REPO_NAME !== 'manager';
    if (isWorker) {
      const { getConfig } = require('../../../flow-utils');
      const config = getConfig();
      const clf = config.workspace?.aiWorkerQuestionClassifier;
      const enabled = clf?.enabled !== false;  // default true
      if (enabled && parsedInput?.transcriptPath) {
        const { classifyWorkerQuestion } = require('../../../flow-worker-question-classifier');
        const result = await classifyWorkerQuestion({
          transcriptPath: parsedInput.transcriptPath,
          minConfidence: Number.isFinite(clf?.minConfidence) ? clf.minConfidence : 70,
          model: typeof clf?.model === 'string' ? clf.model : undefined
        });
        if (result?.blocked) {
          const port = process.env.WOGI_MANAGER_PORT || '8800';
          const repo = process.env.WOGI_REPO_NAME;
          const msg = [
            `WORKER→USER QUESTION DETECTED (confidence ${result.confidence}%, threshold ${result.minConfidence}%):`,
            `  "${String(result.reason || '').slice(0, 200)}"`,
            '',
            'In workspace mode, workers CANNOT ask the user directly — the user only sees',
            'the manager terminal. Your question will stall silently.',
            '',
            'Channel-dispatch to the manager instead, THEN end the turn:',
            '',
            `  curl -s -X POST http://127.0.0.1:${port} \\`,
            `    -H "X-Wogi-From: ${repo}" \\`,
            `    --data-binary "## QUESTION: <your question>"`,
            '',
            'The manager will relay to the user, capture the answer, and dispatch a',
            'follow-up task to you with the resolved context.',
            '',
            'If you don\'t actually need the user — make a reasonable autonomous decision',
            'and note it in your ## Results reply to the manager. Then end the turn.'
          ].join('\n');
          return { __raw: true, continue: true, stopReason: msg };
        }
      }
    }
  } catch (err) {
    // Fail-OPEN — classifier errors must not block legitimate stops.
    if (process.env.DEBUG) {
      console.error(`[Stop] Worker question classifier error (fail-open): ${err.message}`);
    }
  }

  // Check if loop can exit
  return await checkLoopExit();
}, { failMode: 'warn', failOutput: { continue: false } });
