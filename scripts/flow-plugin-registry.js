#!/usr/bin/env node

/**
 * Wogi Flow - Plugin Registry
 *
 * Generic plugin registration system for /wogi-start routing.
 * Discovers plugin capabilities via MCP tool inspection and web search,
 * stores metadata in a dedicated registry file, and enables /wogi-start
 * to route requests to registered plugins.
 *
 * Usage:
 *   flow plugin-registry register <name>   - Register a plugin (auto-discover)
 *   flow plugin-registry list              - List registered plugins
 *   flow plugin-registry remove <name>     - Remove a registered plugin
 *   flow plugin-registry match <request>   - Match a request against plugin triggers
 *   flow plugin-registry scan              - Scan for unregistered MCP servers
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  getProjectRoot,
  safeJsonParse,
  getConfig,
  writeJson,
  fileExists,
  isPathWithinProject,
  color,
  printHeader, PATHS
} = require('./flow-utils');

// Dangerous keys that must never be used as plugin names or metadata keys
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Allowlists for capability fields
const VALID_MODES = new Set(['standalone', 'flow-integrated', 'trigger']);
const VALID_OUTPUT_FORMATS = new Set(['text', 'json', 'artifact']);
const VALID_FLOW_PHASES = new Set(['exploring', 'coding', 'validating', 'completing']);

// ============================================================
// Configuration
// ============================================================

/**
 * Get plugin config from workflow config
 * @returns {Object} Plugin configuration
 */
function getPluginConfig() {
  const config = getConfig();
  return config.plugins || {
    enabled: true,
    registryPath: '.workflow/state/plugin-registry.json',
    autoDiscoverMcp: true,
    autoScanOnSessionStart: true,
    webSearchFallback: true,
    trackPluginActions: true,
    phaseInjection: true,
    standaloneBypassTask: true
  };
}

/**
 * Get the registry file path (absolute)
 * @returns {string} Absolute path to registry file
 */
function getRegistryPath() {
  const pluginConfig = getPluginConfig();
  const registryRelPath = pluginConfig.registryPath || '.workflow/state/plugin-registry.json';
  const resolved = path.resolve(PATHS.root, registryRelPath);
  if (!isPathWithinProject(resolved)) {
    console.error(`[plugin-registry] Unsafe registryPath in config: ${registryRelPath}`);
    return path.join(PATHS.state, 'plugin-registry.json');
  }
  return resolved;
}

// ============================================================
// Registry Read/Write
// ============================================================

/**
 * Read the plugin registry
 * @returns {Object} Registry data with version and plugins map
 */
function readRegistry() {
  const registryPath = getRegistryPath();
  if (!fileExists(registryPath)) {
    return { version: 1, plugins: {} };
  }
  const data = safeJsonParse(registryPath, { version: 1, plugins: {} });
  if (!data.plugins || typeof data.plugins !== 'object') {
    data.plugins = {};
  }
  return data;
}

/**
 * Write the plugin registry
 * @param {Object} registry - Registry data to write
 */
function writeRegistry(registry) {
  const registryPath = getRegistryPath();
  if (!isPathWithinProject(registryPath)) {
    throw new Error(`Refusing to write registry outside project: ${registryPath}`);
  }
  try {
    const dir = path.dirname(registryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeJson(registryPath, registry);
  } catch (err) {
    console.error(`Failed to write plugin registry: ${err.message}`);
    throw err;
  }
}

// ============================================================
// MCP Tool Discovery
// ============================================================

/**
 * Discover MCP tools matching a plugin name pattern.
 * Uses Claude Code's ToolSearch/ListMcpResourcesTool pattern names.
 *
 * @param {string} pluginName - Plugin name to search for
 * @returns {Object[]} Array of discovered tool definitions
 */
function discoverMcpTools(pluginName) {
  const tools = [];
  const normalizedName = pluginName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Strategy 1: Check Claude Code's MCP settings for matching servers
  const settingsLocations = [
    path.join(PATHS.root, '.claude', 'settings.local.json'),
    path.join(PATHS.root, '.claude', 'settings.json')
  ];

  for (const settingsPath of settingsLocations) {
    if (!fileExists(settingsPath)) continue;
    try {
      const settings = safeJsonParse(settingsPath, {});
      const mcpServers = settings.mcpServers || {};

      for (const [serverName] of Object.entries(mcpServers)) {
        const normalizedServer = serverName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedServer.includes(normalizedName) || normalizedName.includes(normalizedServer)) {
          // Never include serverConfig — it may contain API keys in the env block
          tools.push({
            serverName,
            source: 'mcp-settings',
            tools: [] // Will be populated by AI via ToolSearch at registration time
          });
        }
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`Error reading MCP settings from ${settingsPath}: ${err.message}`);
      }
    }
  }

  // Strategy 2: Check cached MCP tools from flow-mcp-docs
  const mcpCachePath = path.join(PATHS.state, 'mcp-tools.json');
  if (fileExists(mcpCachePath)) {
    try {
      const mcpCache = safeJsonParse(mcpCachePath, { allTools: [] });
      const matchingTools = (mcpCache.allTools || []).filter(tool => {
        const toolName = (tool.name || '').toLowerCase();
        const toolSource = (tool.sourceFile || '').toLowerCase();
        return toolName.includes(normalizedName) || toolSource.includes(normalizedName);
      });

      for (const tool of matchingTools) {
        tools.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
          source: 'mcp-cache',
          sourceFile: tool.sourceFile
        });
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`Error reading MCP cache: ${err.message}`);
      }
    }
  }

  return tools;
}

/**
 * Scan for all MCP servers that are NOT yet in the registry.
 * Used by session-start auto-scan.
 *
 * @returns {Object[]} Array of { serverName, serverConfig } for unregistered servers
 */
function scanUnregisteredMcpServers() {
  const registry = readRegistry();
  const registeredNames = new Set(
    Object.values(registry.plugins).map(p => (p.metadata?.mcpServer || '').toLowerCase())
  );
  // Also track by plugin name
  const registeredPluginNames = new Set(Object.keys(registry.plugins).map(n => n.toLowerCase()));

  const unregistered = [];
  const seen = new Set(); // Dedup across multiple settings files

  const settingsLocations = [
    path.join(PATHS.root, '.claude', 'settings.local.json'),
    path.join(PATHS.root, '.claude', 'settings.json')
  ];

  // Internal/built-in servers that should not be auto-registered as plugins
  const internalPatterns = [
    'memory', 'filesystem', 'brave-search', 'puppeteer',
    'github', 'fetch', 'sequential-thinking', 'everything',
    'sqlite', 'postgres', 'git', 'docker', 'kubernetes'
  ];

  for (const settingsPath of settingsLocations) {
    if (!fileExists(settingsPath)) continue;
    try {
      const settings = safeJsonParse(settingsPath, {});
      const mcpServers = settings.mcpServers || {};

      for (const [serverName] of Object.entries(mcpServers)) {
        const normalizedServer = serverName.toLowerCase();
        // Skip if already seen in another settings file
        if (seen.has(normalizedServer)) continue;
        seen.add(normalizedServer);

        // Skip if already registered (by server name or plugin name)
        if (registeredNames.has(normalizedServer)) continue;
        if (registeredPluginNames.has(normalizedServer)) continue;

        // Skip internal/built-in servers
        const isInternal = internalPatterns.some(pattern => normalizedServer.includes(pattern));
        if (isInternal) continue;

        // Only include serverName — never serverConfig (may contain API keys)
        unregistered.push({ serverName });
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`Error scanning MCP settings: ${err.message}`);
      }
    }
  }

  return unregistered;
}

/**
 * Deactivate plugins whose MCP servers are no longer available.
 * Called by session-start hook to keep registry in sync.
 *
 * @returns {string[]} Names of deactivated plugins
 */
function deactivateStaleMcpPlugins() {
  const registry = readRegistry();
  const settingsLocations = [
    path.join(PATHS.root, '.claude', 'settings.local.json'),
    path.join(PATHS.root, '.claude', 'settings.json')
  ];

  const availableServers = new Set();
  for (const sp of settingsLocations) {
    if (!fileExists(sp)) continue;
    try {
      const settings = safeJsonParse(sp, {});
      for (const name of Object.keys(settings.mcpServers || {})) {
        availableServers.add(name.toLowerCase());
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[plugin-registry] Error reading settings: ${err.message}`);
      }
    }
  }

  const deactivated = [];
  for (const plugin of Object.values(registry.plugins)) {
    if (plugin.status === 'active' && plugin.metadata?.mcpServer) {
      if (!availableServers.has(plugin.metadata.mcpServer.toLowerCase())) {
        deactivatePlugin(plugin.name);
        deactivated.push(plugin.name);
      }
    }
  }

  return deactivated;
}

// ============================================================
// Plugin Registration
// ============================================================

/**
 * Register a plugin with discovered capabilities.
 * Called by the AI after discovery (MCP inspection + web search).
 *
 * @param {Object} pluginData - Plugin data to register
 * @param {string} pluginData.name - Plugin name
 * @param {string} pluginData.description - Human-readable description
 * @param {string} pluginData.source - Discovery source: 'mcp', 'manual', 'web-discovered', 'auto-scan'
 * @param {string[]} pluginData.triggers - Trigger phrases
 * @param {Object[]} pluginData.capabilities - Array of capability objects
 * @param {Object} [pluginData.metadata] - Optional metadata
 * @returns {Object} Result with { success, isUpdate, plugin }
 */
function registerPlugin(pluginData) {
  if (!pluginData || !pluginData.name) {
    return { success: false, error: 'Plugin name is required' };
  }

  // Sanitize plugin name — reject dangerous keys
  const name = String(pluginData.name).replace(/[^\w\s.:-]/g, '').trim().slice(0, 128);
  if (!name || DANGEROUS_KEYS.has(name)) {
    return { success: false, error: `Invalid plugin name: ${pluginData.name}` };
  }

  const registry = readRegistry();
  const isUpdate = !!registry.plugins[name];
  const existing = registry.plugins[name] || {};

  // Guard against prototype pollution in metadata
  const incomingMeta = pluginData.metadata || {};
  const safeMeta = {};
  for (const key of Object.keys(incomingMeta)) {
    if (!DANGEROUS_KEYS.has(key)) {
      safeMeta[key] = incomingMeta[key];
    }
  }

  const now = new Date().toISOString();
  const plugin = {
    name,
    description: pluginData.description || existing.description || '',
    registeredAt: existing.registeredAt || now,
    ...(isUpdate ? { updatedAt: now } : {}),
    source: pluginData.source || existing.source || 'manual',
    status: 'active',
    triggers: pluginData.triggers || existing.triggers || [],
    capabilities: (pluginData.capabilities || []).map(cap => {
      const mode = VALID_MODES.has(cap.mode) ? cap.mode : 'standalone';
      const outputFormat = VALID_OUTPUT_FORMATS.has(cap.outputFormat) ? cap.outputFormat : 'text';
      const flowPhases = Array.isArray(cap.flowPhases)
        ? cap.flowPhases.filter(p => VALID_FLOW_PHASES.has(p))
        : [];
      return {
        action: String(cap.action || '').replace(/[\r\n]/g, ' ').slice(0, 80),
        description: cap.description || '',
        triggerPhrases: cap.triggerPhrases || [],
        mcpTool: cap.mcpTool ? String(cap.mcpTool).replace(/[\r\n]/g, ' ').slice(0, 120) : null,
        requiresTask: cap.requiresTask !== undefined ? cap.requiresTask : false,
        mode,
        flowPhases,
        outputFormat
      };
    }),
    metadata: {
      ...(existing.metadata || {}),
      ...safeMeta
    }
  };

  registry.plugins[name] = plugin;
  writeRegistry(registry);

  return { success: true, isUpdate, plugin };
}

/**
 * Remove a plugin from the registry
 * @param {string} pluginName - Name of plugin to remove
 * @returns {Object} Result with { success, removed }
 */
function removePlugin(pluginName) {
  const registry = readRegistry();
  if (!registry.plugins[pluginName]) {
    return { success: false, error: `Plugin "${pluginName}" not found in registry` };
  }

  const removed = registry.plugins[pluginName];
  delete registry.plugins[pluginName];
  writeRegistry(registry);

  return { success: true, removed };
}

/**
 * Mark a plugin as inactive (when its MCP server is no longer available)
 * @param {string} pluginName - Name of plugin to deactivate
 * @returns {Object} Result
 */
function deactivatePlugin(pluginName) {
  const registry = readRegistry();
  if (!registry.plugins[pluginName]) {
    return { success: false, error: `Plugin "${pluginName}" not found` };
  }

  registry.plugins[pluginName].status = 'inactive';
  registry.plugins[pluginName].deactivatedAt = new Date().toISOString();
  writeRegistry(registry);

  return { success: true };
}

/**
 * List all registered plugins
 * @param {Object} [options] - Filter options
 * @param {boolean} [options.activeOnly] - Only return active plugins
 * @returns {Object[]} Array of plugin entries
 */
function listPlugins(options = {}) {
  const registry = readRegistry();
  let plugins = Object.values(registry.plugins);

  if (options.activeOnly) {
    plugins = plugins.filter(p => p.status !== 'inactive');
  }

  return plugins;
}

// ============================================================
// Trigger Matching
// ============================================================

/**
 * Match a user request against all registered plugin triggers.
 * Returns the best matching plugin and capability, if any.
 *
 * @param {string} request - User's natural language request
 * @returns {Object|null} Match result or null
 *   { plugin, capability, score, trigger }
 */
function matchPluginTriggers(request) {
  if (!request || typeof request !== 'string') return null;

  const registry = readRegistry();
  const normalizedRequest = request.toLowerCase().trim();
  let bestMatch = null;
  let bestScore = 0;

  for (const plugin of Object.values(registry.plugins)) {
    if (plugin.status === 'inactive') continue;

    // Check top-level triggers
    for (const trigger of (plugin.triggers || [])) {
      const score = calculateTriggerScore(normalizedRequest, trigger.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { plugin, capability: null, score, trigger };
      }
    }

    // Check per-capability trigger phrases
    for (const cap of (plugin.capabilities || [])) {
      for (const phrase of (cap.triggerPhrases || [])) {
        const score = calculateTriggerScore(normalizedRequest, phrase.toLowerCase());
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { plugin, capability: cap, score, trigger: phrase };
        }
      }
    }
  }

  // Require minimum score to avoid false positives
  const MIN_SCORE = 0.5;
  return bestScore >= MIN_SCORE ? bestMatch : null;
}

/**
 * Calculate how well a request matches a trigger phrase.
 * Uses word overlap scoring.
 *
 * @param {string} request - Normalized request
 * @param {string} trigger - Normalized trigger phrase
 * @returns {number} Score between 0 and 1
 */
function calculateTriggerScore(request, trigger) {
  // Exact substring match gets highest score (check before word filtering)
  if (request.includes(trigger)) return 1.0;

  const requestWords = new Set(request.split(/\s+/).filter(w => w.length > 1));
  const triggerWords = trigger.split(/\s+/).filter(w => w.length > 1);

  if (triggerWords.length === 0) return 0;

  // Word overlap scoring
  let matches = 0;
  for (const word of triggerWords) {
    if (requestWords.has(word)) {
      matches++;
    } else {
      // Partial match (e.g., "figma" matches "figma-plugin")
      for (const reqWord of requestWords) {
        if (reqWord.includes(word) || word.includes(reqWord)) {
          matches += 0.7;
          break;
        }
      }
    }
  }

  return matches / triggerWords.length;
}

// ============================================================
// Flow Integration Helpers
// ============================================================

/**
 * Get flow-integrated plugins available for a specific phase.
 * @param {string} phase - Current execution phase (e.g., 'validating', 'exploring')
 * @returns {Object[]} Array of { pluginName, action, description, mcpTool }
 */
function getFlowIntegratedPlugins(phase) {
  if (!phase || typeof phase !== 'string') return [];

  try {
    const registry = readRegistry();
    const results = [];

    for (const plugin of Object.values(registry.plugins)) {
      if (plugin.status !== 'active') continue;

      for (const cap of (plugin.capabilities || [])) {
        if (cap.mode === 'flow-integrated' && Array.isArray(cap.flowPhases) && cap.flowPhases.includes(phase)) {
          results.push({
            pluginName: plugin.name,
            action: cap.action,
            description: cap.description,
            mcpTool: cap.mcpTool
          });
        }
      }
    }

    return results;
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[plugin-registry] getFlowIntegratedPlugins failed: ${err.message}`);
    }
    return [];
  }
}

/**
 * Log a plugin action to request-log.md.
 * @param {Object} opts
 * @param {string} opts.pluginName - Name of the plugin
 * @param {string} opts.action - Action performed
 * @param {string} [opts.taskId] - Related task ID (if any)
 * @param {string} [opts.mode] - Plugin mode ('standalone', 'flow-integrated', 'trigger')
 */
function logPluginAction({ pluginName, action, taskId, mode }) {
  if (!pluginName || !action) return;

  try {
    const config = getPluginConfig();
    if (!config.trackPluginActions) return;

    const projectRoot = getProjectRoot();
    const logPath = path.join(projectRoot, '.workflow', 'state', 'request-log.md');

    if (!isPathWithinProject(logPath)) return;

    // Sanitize inputs to prevent markdown/log injection
    const safeName = String(pluginName).replace(/[\r\n]/g, ' ').slice(0, 80);
    const safeAction = String(action).replace(/[\r\n]/g, ' ').slice(0, 80);
    const safeTaskId = taskId ? String(taskId).replace(/[\r\n]/g, ' ').slice(0, 20) : '';
    const safeMode = mode ? String(mode).replace(/[\r\n]/g, ' ').slice(0, 20) : '';

    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const taskTag = safeTaskId ? ` | **Task**: ${safeTaskId}` : '';
    const modeTag = safeMode ? ` | **Mode**: ${safeMode}` : '';

    const entry = `\n### Plugin Action | ${now}\n` +
      `**Plugin**: ${safeName} | **Action**: ${safeAction}${modeTag}${taskTag}\n` +
      `**Tags**: #plugin:${safeName}\n`;

    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch (err) {
    // Non-blocking — don't fail if logging fails
    if (process.env.DEBUG) {
      console.error(`[plugin-registry] Failed to log action: ${err.message}`);
    }
  }
}

// ============================================================
// CLI Interface
// ============================================================

function printUsage() {
  printHeader('Plugin Registry');
  console.log('Usage:');
  console.log('  flow plugin-registry register <name>   Register a plugin');
  console.log('  flow plugin-registry list               List registered plugins');
  console.log('  flow plugin-registry remove <name>      Remove a plugin');
  console.log('  flow plugin-registry match <request>    Match request to plugins');
  console.log('  flow plugin-registry scan               Scan for unregistered MCP servers');
}

function handleCli() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'register': {
      const name = args[1];
      if (!name) {
        console.error('Usage: flow plugin-registry register <name>');
        process.exit(1);
      }
      const mcpTools = discoverMcpTools(name);
      console.log(`Discovered ${mcpTools.length} MCP tool(s) for "${name}"`);
      if (mcpTools.length > 0) {
        console.log('MCP tools found:');
        for (const tool of mcpTools) {
          console.log(`  - ${tool.name || tool.serverName}: ${tool.description || '(server)'}`);
        }
      }
      console.log('\nNote: Full registration requires AI-driven discovery via /wogi-register');
      break;
    }

    case 'list': {
      const plugins = listPlugins();
      if (plugins.length === 0) {
        console.log('No plugins registered. Use /wogi-register <name> to register a plugin.');
        return;
      }
      printHeader(`Registered Plugins (${plugins.length})`);
      for (const plugin of plugins) {
        const status = plugin.status === 'inactive' ? color('yellow', ' [inactive]') : '';
        console.log(`\n  ${color('cyan', plugin.name)}${status}`);
        console.log(`  ${plugin.description}`);
        console.log(`  Capabilities: ${(plugin.capabilities || []).length}`);
        console.log(`  Triggers: ${(plugin.triggers || []).join(', ')}`);
        console.log(`  Source: ${plugin.source} | Registered: ${plugin.registeredAt}`);
      }
      break;
    }

    case 'remove': {
      const name = args[1];
      if (!name) {
        console.error('Usage: flow plugin-registry remove <name>');
        process.exit(1);
      }
      const result = removePlugin(name);
      if (result.success) {
        console.log(`Removed plugin: ${name}`);
      } else {
        console.error(result.error);
        process.exit(1);
      }
      break;
    }

    case 'match': {
      const request = args.slice(1).join(' ');
      if (!request) {
        console.error('Usage: flow plugin-registry match <request text>');
        process.exit(1);
      }
      const match = matchPluginTriggers(request);
      if (match) {
        console.log(`Match found: ${match.plugin.name}`);
        console.log(`  Score: ${match.score.toFixed(2)}`);
        console.log(`  Trigger: "${match.trigger}"`);
        if (match.capability) {
          console.log(`  Capability: ${match.capability.action} — ${match.capability.description}`);
        }
      } else {
        console.log('No plugin match for this request.');
      }
      break;
    }

    case 'scan': {
      const unregistered = scanUnregisteredMcpServers();
      if (unregistered.length === 0) {
        console.log('All MCP servers are registered (or internal).');
      } else {
        console.log(`Found ${unregistered.length} unregistered MCP server(s):`);
        for (const server of unregistered) {
          console.log(`  - ${server.serverName}`);
        }
        console.log('\nUse /wogi-register <name> to register them.');
      }
      break;
    }

    default:
      printUsage();
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  readRegistry,
  writeRegistry,
  discoverMcpTools,
  scanUnregisteredMcpServers,
  deactivateStaleMcpPlugins,
  registerPlugin,
  removePlugin,
  deactivatePlugin,
  listPlugins,
  matchPluginTriggers,
  calculateTriggerScore,
  getPluginConfig,
  getRegistryPath,
  getFlowIntegratedPlugins,
  logPluginAction
};

// Run CLI if executed directly
if (require.main === module) {
  handleCli();
}
