'use strict';

/**
 * Wogi Flow — Stop-Hook Orchestrator (wf-6e31850e A-3)
 *
 * Extracted from scripts/hooks/entry/claude-code/stop.js to bring that entry
 * file under the 120-LOC budget per .claude/rules/architecture/hook-three-layer.md.
 *
 * Same control flow as before; just moved here. Entry stop.js is now a thin
 * pass-through that imports and delegates.
 *
 * Returns the Stop-hook result `{ __raw?, continue?, stopReason?, ... }`.
 */

const { isRoutingPending, incrementStopAttempts } = require('./routing-gate');
const { checkLoopExit } = require('./loop-check');

async function orchestrateStop({ parsedInput }) {
  const activeGates = {};
  try {
    const { isLongInputPending } = require('./long-input-enforcement');
    activeGates['long-input-pending'] = isLongInputPending();
  } catch (_err) { /* fail-open */ }

  let recoveryGraceActive = false;
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const { PATHS } = require('../../flow-utils');
    const gracePath = path.join(PATHS.state, 'routing-recovery-grace.json');
    if (fs.existsSync(gracePath)) {
      const raw = fs.readFileSync(gracePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data?.expiresAt && Date.parse(data.expiresAt) > Date.now()) {
        recoveryGraceActive = true;
      } else {
        try { fs.unlinkSync(gracePath); } catch (_err) { /* fine */ }
      }
    }
  } catch (_err) { /* fail-open */ }

  let orchestratorTopGate = null;
  try {
    const { pickStopHookGate } = require('./gate-orchestrator');
    // wf-740f47e4 (NULL-CHECK): guard against malformed return shape.
    const result = pickStopHookGate({
      'long-input-pending': activeGates['long-input-pending'] === true
    });
    orchestratorTopGate = (result && typeof result === 'object' && typeof result.topGateId === 'string')
      ? result.topGateId
      : null;
  } catch (_err) { /* fail-open */ }
  const longInputActive = orchestratorTopGate === 'long-input-pending';

  try {
    if (isRoutingPending() && !longInputActive && !recoveryGraceActive) {
      const { cleared, attempts } = incrementStopAttempts(10);
      if (cleared) {
        if (process.env.DEBUG) {
          console.error(`[Stop] Max routing enforcement attempts reached (${attempts}), surfacing to user`);
        }
        return {
          __raw: true,
          continue: false,
          stopReason: `ROUTING VIOLATION (unrecoverable): max ${attempts} attempts exceeded. The AI failed to call Skill(skill="wogi-start") after ${attempts} stop attempts. Manual review required — this may indicate a stuck routing flag or a session that bypassed /wogi-start through context compaction. To unstick: invoke /wogi-start manually, or check .workflow/state/routing-pending.json.`
        };
      } else {
        return {
          __raw: true,
          continue: true,
          stopReason: [
            `ROUTING VIOLATION (attempt ${attempts}/10): You MUST call Skill(skill="wogi-start") before responding.`,
            '',
            'Call Skill(skill="wogi-start", args="<user\'s message>") NOW. No text. No explanation. Just the Skill tool call.'
          ].join('\n')
        };
      }
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[Stop] Routing check error (fail-closed, forcing continue): ${err.message}`);
    }
    return {
      __raw: true,
      continue: true,
      stopReason: 'Routing enforcement check encountered an error. Please invoke /wogi-start with your request.'
    };
  }

  // S3 (wf-d3ae1717): the worker-stopped emission used to fire HERE,
  // unconditionally, before any gate decided to continue — so the manager saw
  // "stopped mid-work" on every turn boundary. It now fires only at a genuine
  // stop (end of this function) with a precise terminal type, and a
  // worker-progress heartbeat fires from the continuation gate instead.
  const workspaceNotify = require('./workspace-stop-notify');

  const restartCoordinator = require('./task-boundary-restart-coordinator');
  const restartResult = await restartCoordinator.handleTaskBoundaryRestart({ parsedInput });
  if (restartResult?.shouldReturn) return restartResult.result;

  // Research-Required Stop-Hook Gate
  try {
    if (longInputActive) {
      // skip — defer to long-input remediation
    } else {
      const { checkResearchRequiredGate } = require('./research-required-gate');
      const { getConfig } = require('../../flow-utils');
      const config = getConfig();
      const result = checkResearchRequiredGate({
        transcriptPath: parsedInput?.transcriptPath,
        config
      });
      if (result.blocked) {
        if (result.hardStop) return { __raw: true, continue: false, stopReason: result.message };
        return { __raw: true, continue: true, stopReason: result.message };
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] Research-required gate error (fail-open): ${err.message}`);
  }

  // Workspace + worker gates
  const workspaceGates = require('./workspace-stop-gates');
  const wsResult = await workspaceGates.checkWorkspaceStopGates({ parsedInput });
  if (wsResult?.shouldReturn) return wsResult.result;

  // Genuine stop path: no gate forced continuation. Emit a precise terminal
  // worker signal ONLY when we're actually allowing the turn to end (canExit).
  // continueToNext / blocked-continue are not terminal stops.
  const loopResult = await checkLoopExit();
  try {
    if (loopResult?.canExit === true) {
      await workspaceNotify.notifyWorkerTerminal();
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[Stop] terminal notify error (fail-open): ${err.message}`);
  }
  return loopResult;
}

module.exports = { orchestrateStop };
