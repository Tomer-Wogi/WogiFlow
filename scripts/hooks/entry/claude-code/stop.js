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
  // v6.2: Routing enforcement check — catches text-only response bypass
  // If routing-pending flag is still set when the AI tries to stop, it means
  // the AI responded to the user's message without ever invoking a /wogi-* command.
  // This is the exact bypass we need to prevent (especially after context compaction).
  try {
    if (isRoutingPending()) {
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

  // Workspace worker: send results to manager via HTTP when stopping.
  // Uses execFileSync with array args to avoid shell injection (finding-001).
  if (process.env.WOGI_MANAGER_PORT && process.env.WOGI_REPO_NAME && process.env.WOGI_REPO_NAME !== 'manager') {
    try {
      const { execFileSync, execSync } = require('node:child_process');
      const path = require('node:path');
      const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
      const repoName = process.env.WOGI_REPO_NAME;
      const managerPort = parseInt(process.env.WOGI_MANAGER_PORT, 10);

      // Validate inputs before using them (finding-001, finding-002)
      if (!VALID_NAME.test(repoName) || !Number.isInteger(managerPort) || managerPort < 1024 || managerPort > 65535) {
        throw new Error(`Invalid WOGI_REPO_NAME or WOGI_MANAGER_PORT`);
      }

      // Build summary from available state
      const summaryParts = [];
      const { PATHS, safeJsonParse } = require('../../flow-utils');

      const ready = safeJsonParse(path.join(PATHS.state, 'ready.json'), {});
      const recentTask = (ready.recentlyCompleted || [])[0];
      const inProgressTask = (ready.inProgress || [])[0];
      const task = recentTask || inProgressTask;

      if (task) {
        summaryParts.push(`**Task**: ${task.title || task.id}`);
        if (task.type) summaryParts.push(`**Type**: ${task.type}`);
      }

      try {
        const diff = execSync('git diff --name-only HEAD 2>/dev/null || true', { cwd: PATHS.root, encoding: 'utf-8' }).trim();
        const staged = execSync('git diff --name-only --staged 2>/dev/null || true', { cwd: PATHS.root, encoding: 'utf-8' }).trim();
        const allChanged = [...new Set([...diff.split('\n'), ...staged.split('\n')].filter(Boolean))];
        if (allChanged.length > 0) {
          summaryParts.push(`**Files changed**: ${allChanged.join(', ')}`);
        }
      } catch (_err) { /* non-critical */ }

      const body = summaryParts.join('\n') || `Work completed by ${repoName}.`;

      // execFileSync with array args — no shell interpretation (finding-001 fix)
      try {
        execFileSync('curl', [
          '-s', '-X', 'POST',
          `http://127.0.0.1:${managerPort}`,
          '-H', 'Content-Type: text/plain',
          '-H', `X-Wogi-From: ${repoName}`,
          '--data-binary', '@-'
        ], { input: body, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (_err) {
        // Manager might be offline — that's OK
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
    const { consumeAndTriggerRestart, hasPendingMarker } = require('../../core/task-boundary-reset');

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

    const restartResult = consumeAndTriggerRestart();
    if (restartResult.triggered && process.env.DEBUG) {
      console.error(`[Stop] Task-boundary restart triggered — claude will exit, wrapper will relaunch`);
    } else if (!restartResult.triggered && restartResult.reason !== 'no-pending-marker' && process.env.DEBUG) {
      console.error(`[Stop] Task-boundary restart check: ${restartResult.reason}`);
    }
    // If we SIGTERM'd our parent, the process will begin shutting down. Still
    // return the normal Stop-hook result so any in-flight return value flows
    // back to claude before the signal is handled.
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Stop] Task-boundary restart module error (fail-open): ${err.message}`);
    }
    // Never block Stop on restart-module errors.
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

  // Check if loop can exit
  return await checkLoopExit();
}, { failMode: 'warn', failOutput: { continue: false } });
