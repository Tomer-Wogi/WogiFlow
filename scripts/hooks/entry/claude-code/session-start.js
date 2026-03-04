#!/usr/bin/env node

/**
 * Wogi Flow - Claude Code SessionStart Hook
 *
 * Called when a Claude Code session starts.
 * Injects context (suspended tasks, decisions, recent activity).
 */

const { gatherSessionContext } = require('../../core/session-context');
const { claudeCodeAdapter } = require('../../adapters/claude-code');
const { setCliSessionId, clearStaleCurrentTaskAsync } = require('../../../flow-session-state');
const { checkAndResetStalePhase } = require('../../core/phase-gate');
const { setRoutingPending } = require('../../core/routing-gate');
const { safeJsonParseString, getConfig } = require('../../../flow-utils');

// Lazy-load bridge state to avoid circular dependencies
let autoSyncBridge = null;
function getAutoSyncBridge() {
  if (!autoSyncBridge) {
    try {
      autoSyncBridge = require('../../../flow-bridge-state').autoSyncBridge;
    } catch {
      autoSyncBridge = async () => ({ synced: false, reason: 'unavailable' });
    }
  }
  return autoSyncBridge;
}

async function main() {
  try {
    // Start bridge auto-sync in parallel with stdin reading (both are independent I/O)
    const bridgeSyncPromise = (async () => {
      try {
        const syncFn = getAutoSyncBridge();
        await syncFn('claude-code', { silent: true });
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[session-start] Bridge auto-sync failed: ${err.message}`);
        }
      }
    })();

    // Read input from stdin (runs concurrently with bridge sync)
    // Cap at 100KB to prevent unbounded memory growth (matches pre-tool-use.js pattern)
    const MAX_STDIN_SIZE = 100 * 1024;
    let inputData = '';
    let totalSize = 0;
    for await (const chunk of process.stdin) {
      totalSize += chunk.length;
      if (totalSize > MAX_STDIN_SIZE) break;
      inputData += chunk;
    }

    const input = inputData ? (safeJsonParseString(inputData, {}) || {}) : {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    // Wait for bridge sync to complete before proceeding
    await bridgeSyncPromise;

    // --- Batch 1: Independent pre-context operations (async + sync) ---
    // These all operate on separate state files and have no data dependencies.

    // Sync operations (run immediately, no await needed)
    let scriptWarnings = [];
    try {
      const wasReset = checkAndResetStalePhase();
      if (wasReset && process.env.DEBUG) {
        console.error('[session-start] Reset stale workflow phase to idle');
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Failed to check stale phase: ${err.message}`);
      }
    }

    try {
      const routingResult = setRoutingPending();
      if (process.env.DEBUG) {
        console.error(`[session-start] Set routing-pending: ${routingResult.reason}`);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Failed to set routing-pending: ${err.message}`);
      }
    }

    try {
      const { validateScripts } = require('../../../flow-script-resolver');
      scriptWarnings = validateScripts();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Script validation failed: ${err.message}`);
      }
    }

    // Async operations — batch with Promise.all (both use file locking, independent targets)
    const asyncPreOps = [];

    if (parsedInput.sessionId) {
      asyncPreOps.push(
        setCliSessionId(parsedInput.sessionId).catch(err => {
          if (process.env.DEBUG) {
            console.error(`[session-start] Failed to store session ID: ${err.message}`);
          }
        })
      );
    }

    asyncPreOps.push(
      clearStaleCurrentTaskAsync().catch(err => {
        if (process.env.DEBUG) {
          console.error(`[session-start] Failed to clear stale task: ${err.message}`);
        }
      })
    );

    // Gather session context concurrently with the async pre-ops
    const [, coreResult] = await Promise.all([
      Promise.all(asyncPreOps),
      gatherSessionContext({
        includeSuspended: true,
        includeDecisions: true,
        includeActivity: true
      })
    ]);

    // --- Batch 2: Post-context operations (plugin scan + community pull) ---
    // Both modify coreResult.context but touch different keys, so they can run concurrently.

    const postContextOps = [];

    // Plugin auto-scan (non-blocking)
    postContextOps.push((async () => {
      try {
        const config = getConfig();
        if (config.plugins?.enabled && config.plugins?.autoScanOnSessionStart) {
          const { scanUnregisteredMcpServers, registerPlugin, deactivateStaleMcpPlugins, listPlugins } = require('../../../flow-plugin-registry');

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
            if (process.env.DEBUG) {
              console.error(`[session-start] Auto-registered plugin: ${server.serverName}`);
            }
          }

          const deactivated = deactivateStaleMcpPlugins();
          if (deactivated.length > 0 && process.env.DEBUG) {
            console.error(`[session-start] Deactivated ${deactivated.length} stale plugin(s): ${deactivated.join(', ')}`);
          }

          if (coreResult && coreResult.context) {
            const activePlugins = listPlugins({ activeOnly: true });
            if (unregistered.length > 0 || activePlugins.length > 0) {
              coreResult.context.pluginScan = {
                newlyRegistered: unregistered.map(s => s.serverName),
                activePlugins: activePlugins.map(p => ({ name: p.name, capabilities: (p.capabilities || []).length }))
              };
            }
          }
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[session-start] Plugin auto-scan failed: ${err.message}`);
        }
      }
    })());

    // Community knowledge pull + suggestion retry (non-blocking)
    postContextOps.push((async () => {
      try {
        const communityConfig = getConfig();
        if (communityConfig.community?.enabled) {
          const community = require('../../../flow-community');

          community.retryPendingSuggestions(communityConfig).catch(() => {});

          if (communityConfig.community?.pullOnSessionStart !== false) {
            const knowledge = await community.pullFromServer(communityConfig);
            if (knowledge && coreResult && coreResult.context) {
              coreResult.context.communityKnowledge = knowledge;

              try {
                community.mergeCommunityKnowledge(knowledge, communityConfig);
              } catch (err) {
                if (process.env.DEBUG) {
                  console.error(`[session-start] Community merge failed: ${err.message}`);
                }
              }
            }
          }
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[session-start] Community pull failed: ${err.message}`);
        }
      }
    })());

    await Promise.all(postContextOps);

    // Inject script warnings into context (if any)
    if (scriptWarnings.length > 0 && coreResult && coreResult.context) {
      coreResult.context.scriptWarnings = scriptWarnings.map(w => w.message);
    }

    // Transform to Claude Code format
    const output = claudeCodeAdapter.transformResult('SessionStart', coreResult);

    // Output JSON
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    // Non-blocking error - log to stderr, exit 1
    console.error(`[Wogi Flow Hook Error] ${err.message}`);
    process.exit(1);
  }
}

// Handle stdin properly
process.stdin.setEncoding('utf8');
main();
