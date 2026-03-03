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
const { safeJsonParseString } = require('../../../flow-utils');

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
    // Auto-sync bridge if needed (non-blocking, silent)
    try {
      const syncFn = getAutoSyncBridge();
      await syncFn('claude-code', { silent: true });
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Bridge auto-sync failed: ${err.message}`);
      }
    }
    // Read input from stdin
    let inputData = '';
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const input = inputData ? (safeJsonParseString(inputData, {}) || {}) : {};
    const parsedInput = claudeCodeAdapter.parseInput(input);

    // Store CLI session ID for tracking (CLI-agnostic via session-state)
    // Uses async with locking to prevent race conditions
    if (parsedInput.sessionId) {
      try {
        await setCliSessionId(parsedInput.sessionId);
      } catch (err) {
        // Non-blocking - session ID storage is best-effort
        if (process.env.DEBUG) {
          console.error(`[session-start] Failed to store session ID: ${err.message}`);
        }
      }
    }

    // Clear stale currentTask if it's already in recentlyCompleted
    // Fixes bug where completed tasks show as "in progress" in morning briefing
    // Uses async version with locking for concurrent safety
    try {
      await clearStaleCurrentTaskAsync();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Failed to clear stale task: ${err.message}`);
      }
    }

    // Reset stale workflow phase (auto-expire after 2 hours)
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

    // Defense-in-depth: Set routing-pending flag at session start.
    // UserPromptSubmit also sets this, but a fresh/continued session should
    // start with the gate active. This closes the loophole where session
    // continuation ("Continue with the last task") bypasses routing because
    // the AI treats it as implicit permission to skip /wogi-start.
    try {
      const routingResult = setRoutingPending();
      if (process.env.DEBUG) {
        console.error(`[session-start] Set routing-pending: ${routingResult.reason}`);
      }
    } catch (err) {
      // Non-blocking — UserPromptSubmit will also set this flag
      if (process.env.DEBUG) {
        console.error(`[session-start] Failed to set routing-pending: ${err.message}`);
      }
    }

    // Validate script alignment (drift detection)
    let scriptWarnings = [];
    try {
      const { validateScripts } = require('../../../flow-script-resolver');
      scriptWarnings = validateScripts();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[session-start] Script validation failed: ${err.message}`);
      }
    }

    // Gather session context
    const coreResult = await gatherSessionContext({
      includeSuspended: true,
      includeDecisions: true,
      includeActivity: true
    });

    // Plugin auto-scan (non-blocking)
    // Checks for unregistered MCP servers and auto-registers them
    try {
      const { getConfig } = require('../../../flow-utils');
      const config = getConfig();
      if (config.plugins?.enabled && config.plugins?.autoScanOnSessionStart) {
        const { scanUnregisteredMcpServers, registerPlugin, deactivatePlugin, readRegistry, listPlugins } = require('../../../flow-plugin-registry');

        // Scan for new unregistered MCP servers
        const unregistered = scanUnregisteredMcpServers();
        for (const server of unregistered) {
          // Auto-register with minimal info — AI will enrich via /wogi-register later
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

        // Check for previously registered plugins whose MCP servers are gone
        const registry = readRegistry();
        const settingsLocations = [
          require('path').join(require('../../../flow-utils').getProjectRoot(), '.claude', 'settings.local.json'),
          require('path').join(require('../../../flow-utils').getProjectRoot(), '.claude', 'settings.json')
        ];
        const availableServers = new Set();
        for (const sp of settingsLocations) {
          try {
            const settings = require('../../../flow-utils').safeJsonParse(sp, {});
            for (const name of Object.keys(settings.mcpServers || {})) {
              availableServers.add(name.toLowerCase());
            }
          } catch (_) { /* skip */ }
        }
        for (const plugin of Object.values(registry.plugins)) {
          if (plugin.status === 'active' && plugin.metadata?.mcpServer) {
            if (!availableServers.has(plugin.metadata.mcpServer.toLowerCase())) {
              deactivatePlugin(plugin.name);
              if (process.env.DEBUG) {
                console.error(`[session-start] Deactivated plugin (server gone): ${plugin.name}`);
              }
            }
          }
        }

        // Inject plugin scan results into context
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

    // Community knowledge pull + suggestion retry (non-blocking)
    try {
      const { getConfig: getConfigForCommunity } = require('../../../flow-utils');
      const config = getConfigForCommunity();
      if (config.community?.enabled) {
        const community = require('../../../flow-community');

        // Retry pending suggestions (fire-and-forget)
        community.retryPendingSuggestions(config).catch(() => {});

        // Pull community knowledge (respects pullOnSessionStart toggle)
        if (config.community?.pullOnSessionStart !== false) {
          // Non-blocking pull with 5s timeout — uses cache if unavailable
          const knowledge = await community.pullFromServer(config);
          if (knowledge && coreResult && coreResult.context) {
            coreResult.context.communityKnowledge = knowledge;

            // Merge community knowledge into local state files (Phase C2)
            try {
              community.mergeCommunityKnowledge(knowledge, config);
            } catch (mergeErr) {
              if (process.env.DEBUG) {
                console.error(`[session-start] Community merge failed: ${mergeErr.message}`);
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
