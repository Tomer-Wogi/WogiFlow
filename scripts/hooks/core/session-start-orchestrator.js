'use strict';

/**
 * Wogi Flow — SessionStart Orchestrator (wf-6e31850e A-3)
 *
 * Extracted from scripts/hooks/entry/claude-code/session-start.js to bring
 * that entry file under the 120-LOC budget per
 * .claude/rules/architecture/hook-three-layer.md.
 *
 * Same control flow as before. Entry session-start.js is now a thin
 * pass-through that imports boot-instrumentation helpers + this orchestrator.
 */

const { gatherSessionContext } = require('./session-context');
const { setCliSessionId, clearStaleCurrentTaskAsync, resetSessionTaskCounter } = require('../../flow-session-state');
const { checkAndResetStalePhase } = require('./phase-gate');
const { setRoutingPending } = require('./routing-gate');
const { getConfig } = require('../../flow-utils');

let autoSyncBridge = null;
function getAutoSyncBridge() {
  if (!autoSyncBridge) {
    try {
      autoSyncBridge = require('../../flow-bridge-state').autoSyncBridge;
    } catch (_err) {
      autoSyncBridge = async () => ({ synced: false, reason: 'unavailable' });
    }
  }
  return autoSyncBridge;
}

async function orchestrateSessionStart({ parsedInput, bootMark, bootTime }) {
  bootMark('SessionStart hook entered');

  const bridgeSyncPromise = bootTime('bridge auto-sync', async () => {
    try {
      const syncFn = getAutoSyncBridge();
      await syncFn('claude-code', { silent: true });
    } catch (err) {
      if (process.env.DEBUG) console.error(`[session-start] Bridge auto-sync failed: ${err.message}`);
    }
  });
  await bridgeSyncPromise;
  bootMark('after bridge sync');

  // wf-b8839d99: Refresh standing no-defer pin from decisions.md policy.
  try {
    const { refreshFromPolicy } = require('./no-defer-policy');
    const r = refreshFromPolicy();
    if (r.refreshed && process.env.DEBUG) {
      console.error(`[session-start] Refreshed no-defer pin from policy: ${r.header}`);
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] no-defer policy refresh failed: ${err.message}`);
  }

  // CLAUDE.md drift detection
  let driftDetected = false;
  let driftMarkerMissing = false;
  try {
    const { checkClaudeMdDrift } = require('../../flow-bridge-state');
    const drift = checkClaudeMdDrift();
    if (drift.drifted && drift.reason === 'content-changed') {
      if (process.env.DEBUG) console.error('[session-start] CLAUDE.md drift detected — content changed since last sync');
      driftDetected = true;
    } else if (drift.drifted && drift.reason === 'marker-missing') {
      if (process.env.DEBUG) console.error('[session-start] CLAUDE.md appears manually maintained (no generation marker)');
      driftDetected = true;
      driftMarkerMissing = true;
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] Drift detection failed: ${err.message}`);
  }

  // Version compatibility checks (parallelized)
  let versionWarning = null;
  let updateWarning = null;
  await bootTime('version checks', async () => {
    try {
      const { checkClaudeCodeVersionOnce, checkWogiFlowUpdateOnce } = require('../../flow-version-check');
      const [vw, uw] = await Promise.all([
        (async () => { try { return await checkClaudeCodeVersionOnce(); } catch (_err) { return null; } })(),
        (async () => { try { return await checkWogiFlowUpdateOnce(); } catch (_err) { return null; } })()
      ]);
      versionWarning = vw;
      updateWarning = uw;
    } catch (err) {
      if (process.env.DEBUG) console.error(`[session-start] Version check failed: ${err.message}`);
    }
  });
  bootMark('after version checks');

  // Batch 1: Independent pre-context operations
  let scriptWarnings = [];
  try {
    const wasReset = checkAndResetStalePhase();
    if (wasReset && process.env.DEBUG) console.error('[session-start] Reset stale workflow phase to idle');
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] Failed to check stale phase: ${err.message}`);
  }
  try { resetSessionTaskCounter(); } catch (_err) { /* non-blocking */ }
  try {
    const routingResult = setRoutingPending();
    if (process.env.DEBUG) console.error(`[session-start] Set routing-pending: ${routingResult.reason}`);
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] Failed to set routing-pending: ${err.message}`);
  }
  try {
    const { validateScripts } = require('../../flow-script-resolver');
    scriptWarnings = validateScripts();
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] Script validation failed: ${err.message}`);
  }

  // BUG-005: Create durable-session.json for active tasks on session start.
  try {
    const { getReadyData } = require('../../flow-utils');
    const readyData = getReadyData();
    if (Array.isArray(readyData.inProgress) && readyData.inProgress.length > 0) {
      const task = readyData.inProgress[0];
      const taskId = task && task.id;
      if (taskId) {
        const { loadDurableSession, createDurableSession } = require('../../flow-durable-session');
        const existing = loadDurableSession();
        if (!existing || existing.taskId !== taskId) {
          const criteria = task.acceptanceCriteria || task.scenarios || [];
          const steps = Array.isArray(criteria) ? criteria : [];
          const sessionSteps = steps.length > 0 ? steps : [task.title || taskId];
          createDurableSession(taskId, 'task', sessionSteps);
          if (process.env.DEBUG) console.error(`[session-start] Created durable session for active task ${taskId}`);
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] Durable session init failed: ${err.message}`);
  }

  // Async pre-ops batched with gatherSessionContext
  const asyncPreOps = [];
  if (parsedInput.sessionId) {
    asyncPreOps.push(setCliSessionId(parsedInput.sessionId).catch(err => {
      if (process.env.DEBUG) console.error(`[session-start] Failed to store session ID: ${err.message}`);
    }));
  }
  asyncPreOps.push(clearStaleCurrentTaskAsync().catch(err => {
    if (process.env.DEBUG) console.error(`[session-start] Failed to clear stale task: ${err.message}`);
  }));

  bootMark('before gatherSessionContext + asyncPreOps');
  const [, coreResult] = await Promise.all([
    Promise.all(asyncPreOps),
    bootTime('gatherSessionContext', () => gatherSessionContext({
      includeSuspended: true,
      includeDecisions: true,
      includeActivity: true
    }))
  ]);
  bootMark('after gatherSessionContext + asyncPreOps');

  // Batch 2: Post-context — plugin scan + community pull (parallel, non-blocking)
  await bootTime('postContextOps (plugin-scan + community-pull)', () => Promise.all([
    runPluginAutoScan(coreResult),
    runCommunityPull(coreResult)
  ]));
  bootMark('after postContextOps');

  // Inject warnings into context
  if (scriptWarnings.length > 0 && coreResult?.context) {
    coreResult.context.scriptWarnings = scriptWarnings.map(w => w.message);
  }
  if (versionWarning && coreResult?.context) coreResult.context.versionWarning = versionWarning;
  if (updateWarning && coreResult?.context) coreResult.context.updateWarning = updateWarning;
  if (driftDetected && coreResult?.context) {
    coreResult.context.driftWarning = driftMarkerMissing
      ? 'CLAUDE.md appears to have been manually edited (generation marker missing). Was this intentional? If yes, WogiFlow will respect your custom CLAUDE.md. If not, run `flow bridge sync` to regenerate from template.'
      : 'CLAUDE.md content has changed since the last bridge sync. Was this intentional? If yes, WogiFlow will preserve your changes. If not, run `flow bridge sync` to regenerate from template.';
  }

  // State file drift detection
  try {
    const { detectDrift, saveSnapshot, formatDriftReport } = require('../../flow-state-drift-detector');
    const driftResult = detectDrift();
    if (driftResult.hasDrift && coreResult?.context) {
      coreResult.context.stateDriftWarning = formatDriftReport(driftResult);
    }
    saveSnapshot();
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[session-start] State drift detection failed: ${_err.message}`);
  }

  // Workspace worker restart-handoff
  await bootTime('worker session-start handler', async () => {
    try {
      const { handleWorkerSessionStart } = require('./session-start-worker');
      const workerResult = handleWorkerSessionStart();
      if (workerResult.context && coreResult?.context) {
        if (workerResult.branch === 'auto-resume') {
          coreResult.context.workerAutoResume = workerResult.context;
        } else if (workerResult.branch === 'announce-ready') {
          coreResult.context.workerReadyAnnounce = workerResult.context;
        }
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`[session-start] Worker session-start handler failed: ${err.message}`);
    }
  });
  bootMark('SessionStart hook returning');

  return coreResult;
}

async function runPluginAutoScan(coreResult) {
  try {
    const config = getConfig();
    if (!config.plugins?.enabled || !config.plugins?.autoScanOnSessionStart) return;
    const { scanUnregisteredMcpServers, registerPlugin, deactivateStaleMcpPlugins, listPlugins } = require('../../flow-plugin-registry');

    const unregistered = scanUnregisteredMcpServers();
    for (const server of unregistered) {
      registerPlugin({
        name: server.serverName,
        description: `Auto-discovered MCP server: ${server.serverName}`,
        source: 'auto-scan',
        triggers: [`use ${server.serverName}`, `send to ${server.serverName}`, server.serverName],
        capabilities: [],
        metadata: { mcpServer: server.serverName }
      });
      if (process.env.DEBUG) console.error(`[session-start] Auto-registered plugin: ${server.serverName}`);
    }
    const deactivated = deactivateStaleMcpPlugins();
    if (deactivated.length > 0 && process.env.DEBUG) {
      console.error(`[session-start] Deactivated ${deactivated.length} stale plugin(s): ${deactivated.join(', ')}`);
    }
    if (coreResult?.context) {
      const activePlugins = listPlugins({ activeOnly: true });
      if (unregistered.length > 0 || activePlugins.length > 0) {
        coreResult.context.pluginScan = {
          newlyRegistered: unregistered.map(s => s.serverName),
          activePlugins: activePlugins.map(p => ({ name: p.name, capabilities: (p.capabilities || []).length }))
        };
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] Plugin auto-scan failed: ${err.message}`);
  }
}

async function runCommunityPull(coreResult) {
  try {
    const communityConfig = getConfig();
    if (!communityConfig.community?.enabled) return;
    const community = require('../../flow-community');
    community.retryPendingSuggestions(communityConfig).catch(() => {});
    if (communityConfig.community?.pullOnSessionStart !== false) {
      const knowledge = await community.pullFromServer(communityConfig);
      if (knowledge && coreResult?.context) {
        coreResult.context.communityKnowledge = knowledge;
        try { community.mergeCommunityKnowledge(knowledge, communityConfig); }
        catch (err) {
          if (process.env.DEBUG) console.error(`[session-start] Community merge failed: ${err.message}`);
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) console.error(`[session-start] Community pull failed: ${err.message}`);
  }
}

module.exports = { orchestrateSessionStart };
