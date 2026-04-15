#!/usr/bin/env node

/**
 * Wogi Flow - MCP Capability Discovery for Sub-Agents
 *
 * Discovers available MCP servers, classifies their tools into generic
 * capability categories, and generates role-specific prompt fragments
 * so sub-agents know what MCP tools they have and when to use them.
 *
 * Design: The script handles discovery, taxonomy, caching, and formatting.
 * The AI orchestrator handles classification (only it can see tool catalogs
 * at runtime). Classifications are cached per session.
 *
 * Source: CC 2.1.101 — sub-agents now inherit MCP tools from parent session,
 * but need awareness of what's available and when to use each tool.
 *
 * Usage:
 *   node flow-mcp-capabilities.js check-cache
 *   node flow-mcp-capabilities.js categories
 *   node flow-mcp-capabilities.js roles
 *   node flow-mcp-capabilities.js hint <role>
 *   node flow-mcp-capabilities.js cache '<json>'
 *   node flow-mcp-capabilities.js clear
 *   node flow-mcp-capabilities.js discover
 *   node flow-mcp-capabilities.js classify-prompt
 *
 * Programmatic:
 *   const { getCapabilityCategories, getRoleCapabilities, generateHint } = require('./flow-mcp-capabilities');
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, getConfig, safeJsonParse, readJson, writeJson, fileExists, DANGEROUS_KEYS } = require('./flow-utils');

// Local DANGEROUS_KEYS consolidated to flow-io canonical (wf-2f6fbb12 / dup-002).

// ============================================================
// Constants
// ============================================================

const CACHE_PATH = path.join(PATHS.state, 'mcp-capabilities.json');

/**
 * Generic capability categories.
 * Each category is defined by its PURPOSE, not by any specific MCP server.
 * The `keywords` array is used by the AI orchestrator as guidance when
 * classifying MCP tools — tools whose names or descriptions match these
 * keywords likely belong to this category.
 */
const DEFAULT_CATEGORIES = {
  'documentation-lookup': {
    description: 'Fetch library, framework, or API documentation',
    keywords: ['docs', 'library', 'resolve', 'reference', 'documentation', 'get-library', 'api-docs', 'man-page'],
    agentGuidance: 'When you need current API docs, migration guides, or framework-specific patterns. Prefer over web search for library documentation — results are more accurate and structured.'
  },
  'browser-interaction': {
    description: 'Navigate web pages, take screenshots, evaluate DOM, interact with UI elements',
    keywords: ['navigate', 'screenshot', 'browser', 'evaluate', 'click', 'page', 'dom', 'tab', 'scroll', 'type'],
    agentGuidance: 'When you need to verify UI behavior, inspect rendered output, or test user interactions in a browser.'
  },
  'design-files': {
    description: 'Read or interact with design tools and design systems',
    keywords: ['figma', 'design', 'component', 'frame', 'style', 'layout', 'variant', 'token', 'sketch'],
    agentGuidance: 'When you need to inspect design specifications, extract design tokens, or verify UI implementations against design files.'
  },
  'code-execution': {
    description: 'Execute or evaluate code in a sandboxed environment',
    keywords: ['execute', 'eval', 'run', 'sandbox', 'repl', 'notebook', 'kernel', 'interpret'],
    agentGuidance: 'When you need to test code snippets, evaluate expressions, or run scripts in an isolated environment.'
  },
  'data-query': {
    description: 'Query databases, data stores, or structured data sources',
    keywords: ['query', 'sql', 'database', 'table', 'schema', 'select', 'collection', 'index', 'record'],
    agentGuidance: 'When you need to inspect database schemas, run queries, or verify data integrity.'
  },
  'communication': {
    description: 'Send messages or notifications to external services',
    keywords: ['send', 'message', 'slack', 'email', 'notify', 'post', 'channel', 'webhook', 'chat'],
    agentGuidance: 'When you need to notify team members, post updates, or send messages to external communication channels.'
  },
  'file-management': {
    description: 'Manage files in external storage or cloud systems',
    keywords: ['upload', 'download', 'storage', 'bucket', 's3', 'blob', 'drive', 'sync', 'transfer'],
    agentGuidance: 'When you need to upload, download, or manage files in cloud storage or external file systems.'
  },
  'code-analysis': {
    description: 'Static analysis, AST inspection, linting, or code intelligence',
    keywords: ['lint', 'ast', 'analyze', 'parse', 'syntax', 'diagnostic', 'symbol', 'definition', 'reference'],
    agentGuidance: 'When you need deeper code analysis beyond grep — AST-level queries, cross-reference lookups, or structured code intelligence.'
  },
  'project-management': {
    description: 'Interact with project management tools (issues, boards, sprints)',
    keywords: ['issue', 'ticket', 'sprint', 'board', 'jira', 'linear', 'project', 'backlog', 'assignee', 'transition'],
    agentGuidance: 'When you need to read or update project management state — issues, sprint boards, or task tracking.'
  },
  'version-control': {
    description: 'Interact with version control platforms beyond local git',
    keywords: ['pull-request', 'pr', 'merge', 'branch', 'commit', 'review', 'diff', 'release', 'tag'],
    agentGuidance: 'When you need to interact with remote version control — PRs, code reviews, or release management.'
  }
};

/**
 * Role-to-capability mapping.
 * Each agent role lists which capability categories would enhance its work.
 * The orchestrator uses this to filter relevant MCP tools for each sub-agent.
 */
const DEFAULT_ROLE_CAPABILITIES = {
  'explore-codebase': ['code-analysis', 'documentation-lookup'],
  'explore-practices': ['documentation-lookup'],
  'explore-versions': ['documentation-lookup'],
  'explore-risk': ['code-analysis'],
  'explore-standards': ['code-analysis'],
  'explore-impact': ['code-analysis'],
  'review-code': ['code-analysis', 'browser-interaction'],
  'review-security': ['code-analysis'],
  'review-architecture': ['code-analysis', 'documentation-lookup'],
  'review-performance': ['code-analysis'],
  'verify-ui': ['browser-interaction', 'design-files'],
  'verify-api': ['data-query'],
  'skeptical-evaluator': ['code-analysis', 'browser-interaction'],
  'bug-investigation': ['code-analysis', 'browser-interaction', 'data-query'],
  'onboard-stack': ['documentation-lookup'],
  'general': ['documentation-lookup', 'code-analysis']
};

// ============================================================
// Configuration
// ============================================================

/**
 * Get MCP capabilities config, merging defaults with user overrides.
 */
function getMcpCapabilitiesConfig() {
  const config = getConfig();
  const userConfig = config.mcpCapabilities || {};
  return {
    enabled: userConfig.enabled !== false, // default: true
    categoryOverrides: userConfig.categoryOverrides || {},
    roleOverrides: userConfig.roleOverrides || {}
  };
}

/**
 * Get capability categories with user overrides applied.
 */
function getCapabilityCategories() {
  const config = getMcpCapabilitiesConfig();
  return { ...DEFAULT_CATEGORIES, ...config.categoryOverrides };
}

/**
 * Get role-to-capability mapping with user overrides applied.
 */
function getRoleCapabilities(role) {
  const config = getMcpCapabilitiesConfig();
  const roles = { ...DEFAULT_ROLE_CAPABILITIES, ...config.roleOverrides };
  return roles[role] || roles['general'] || [];
}

/**
 * Get all role definitions.
 */
function getAllRoles() {
  const config = getMcpCapabilitiesConfig();
  return { ...DEFAULT_ROLE_CAPABILITIES, ...config.roleOverrides };
}

// ============================================================
// MCP Server Discovery
// ============================================================

/**
 * Discover all configured MCP servers from settings files and .mcp.json.
 * Returns server names only — never includes config (may contain API keys).
 *
 * NOTE: This intentionally duplicates some discovery logic from flow-plugin-registry.js
 * (scanUnregisteredMcpServers). The divergences are deliberate:
 * - This function includes .mcp.json (CC 2.1.50+ canonical location); the registry doesn't
 * - This function includes ~/.claude/settings.json (user-level); the registry is project-only
 * - This function skips the internalPatterns filter (we want ALL servers for capability hints)
 * If these divergences cause issues, extract shared logic into flow-utils.js.
 *
 * @returns {string[]} Array of MCP server names
 */
function discoverMcpServers() {
  const servers = new Set();

  // Check .mcp.json (project-level MCP config, CC 2.1.50+)
  const mcpJsonPath = path.join(PATHS.root, '.mcp.json');
  if (fileExists(mcpJsonPath)) {
    try {
      const mcpJson = safeJsonParse(mcpJsonPath, {});
      const mcpServers = mcpJson.mcpServers || {};
      for (const name of Object.keys(mcpServers)) {
        servers.add(name);
      }
    } catch (_err) { /* silently skip */ }
  }

  // Check .claude/settings.local.json and .claude/settings.json
  const settingsLocations = [
    path.join(PATHS.root, '.claude', 'settings.local.json'),
    path.join(PATHS.root, '.claude', 'settings.json')
  ];

  for (const settingsPath of settingsLocations) {
    if (!fileExists(settingsPath)) continue;
    try {
      const settings = safeJsonParse(settingsPath, {});
      const mcpServers = settings.mcpServers || {};
      for (const name of Object.keys(mcpServers)) {
        servers.add(name);
      }
    } catch (_err) { /* silently skip */ }
  }

  // Check user-level settings (~/.claude/settings.json)
  const homePath = process.env.HOME || process.env.USERPROFILE;
  if (homePath) {
    const userSettingsPath = path.join(homePath, '.claude', 'settings.json');
    if (fileExists(userSettingsPath)) {
      try {
        const userSettings = safeJsonParse(userSettingsPath, {});
        const mcpServers = userSettings.mcpServers || {};
        for (const name of Object.keys(mcpServers)) {
          servers.add(name);
        }
      } catch (_err) { /* silently skip */ }
    }
  }

  return [...servers];
}

// ============================================================
// Cache Management
// ============================================================

/**
 * Read cached MCP capability classifications.
 *
 * @returns {{ classifications: Object, cachedAt: string, sessionId: string } | null}
 */
function getCachedClassifications() {
  if (!fileExists(CACHE_PATH)) return null;

  try {
    const cached = readJson(CACHE_PATH, null);
    if (!cached || !cached.classifications) return null;
    return cached;
  } catch (_err) {
    return null;
  }
}

/**
 * Cache MCP capability classifications.
 *
 * Expected input format:
 * {
 *   "server-name": {
 *     "tools": [
 *       { "name": "mcp__server__tool_name", "description": "What it does", "category": "documentation-lookup" }
 *     ]
 *   }
 * }
 *
 * Validates input for prototype pollution and enforces length limits on tool
 * name/description to prevent prompt injection via cache poisoning.
 *
 * @param {Object} classifications - Server-to-tool classifications
 */
function cacheClassifications(classifications) {
  if (typeof classifications !== 'object' || classifications === null || Array.isArray(classifications)) {
    return false;
  }

  // Sanitize: reject dangerous keys, enforce length limits on tool fields
  const sanitized = {};
  for (const [serverName, serverData] of Object.entries(classifications)) {
    if (DANGEROUS_KEYS.has(serverName)) continue;
    if (typeof serverData !== 'object' || serverData === null) continue;

    const tools = Array.isArray(serverData.tools) ? serverData.tools : [];
    sanitized[serverName] = {
      tools: tools.map(tool => ({
        name: String(tool.name || '').slice(0, 120),
        description: String(tool.description || '').slice(0, 200).replace(/`/g, "'"),
        category: String(tool.category || '').slice(0, 50)
      })).filter(t => t.name && t.category)
    };
  }

  const data = {
    version: 1,
    cachedAt: new Date().toISOString(),
    classifications: sanitized
  };

  try {
    writeJson(CACHE_PATH, data);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Clear the classification cache.
 */
function clearCache() {
  try {
    if (fileExists(CACHE_PATH)) {
      fs.unlinkSync(CACHE_PATH);
    }
    return true;
  } catch (_err) {
    return false;
  }
}

// ============================================================
// Prompt Generation
// ============================================================

/**
 * Generate a capability-aware prompt fragment for a specific agent role.
 *
 * @param {string} role - Agent role (e.g., 'explore-codebase', 'review-code')
 * @param {Object} [classifications] - Cached classifications (auto-loaded if omitted)
 * @returns {string} Prompt fragment to append to agent prompt, or empty string if no relevant capabilities
 */
function generateHint(role, classifications) {
  const config = getMcpCapabilitiesConfig();
  if (!config.enabled) return '';

  const cached = classifications || getCachedClassifications();
  if (!cached) return '';

  const classificationData = cached.classifications || cached;
  const neededCapabilities = getRoleCapabilities(role);
  if (!neededCapabilities || neededCapabilities.length === 0) return '';

  const categories = getCapabilityCategories();
  const neededSet = new Set(neededCapabilities);

  // Collect tools grouped by capability category
  const toolsByCategory = {};

  for (const [_serverName, serverData] of Object.entries(classificationData)) {
    const tools = serverData.tools || [];
    for (const tool of tools) {
      if (!tool.category || !neededSet.has(tool.category)) continue;

      if (!toolsByCategory[tool.category]) {
        toolsByCategory[tool.category] = [];
      }
      toolsByCategory[tool.category].push(tool);
    }
  }

  // No relevant tools found
  if (Object.keys(toolsByCategory).length === 0) return '';

  // Build the prompt fragment
  const lines = [
    '',
    '## Available MCP Capabilities',
    '',
    'You have access to specialized MCP tools beyond the standard toolset. Use them when they help accomplish your task more effectively.',
    ''
  ];

  for (const [category, tools] of Object.entries(toolsByCategory)) {
    const categoryDef = categories[category];
    const categoryTitle = category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    lines.push(`### ${categoryTitle}`);
    for (const tool of tools) {
      lines.push(`- \`${tool.name}\` — ${tool.description}`);
    }
    if (categoryDef?.agentGuidance) {
      lines.push(`**When to use**: ${categoryDef.agentGuidance}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate the classification prompt for the orchestrator AI.
 * This prompt tells the orchestrator how to classify its available MCP tools.
 *
 * @returns {string} Instructions for the orchestrator to classify MCP tools
 */
function generateClassificationPrompt() {
  const categories = getCapabilityCategories();
  const servers = discoverMcpServers();

  if (servers.length === 0) {
    return '';
  }

  const categoryList = Object.entries(categories)
    .map(([name, def]) => `  - \`${name}\`: ${def.description} (keywords: ${def.keywords.join(', ')})`)
    .join('\n');

  return `## MCP Capability Classification Required

${servers.length} MCP server(s) detected: ${servers.join(', ')}

You have MCP tools available in your tool catalog (they appear as \`mcp__<server>__<tool>\` in your available tools). Classify each one into capability categories so sub-agents know what's available.

### Capability Categories
${categoryList}

### Instructions
1. Inspect your available tools — look for any starting with \`mcp__\`
2. For each MCP tool, determine which category best fits based on its name and what it does
3. If a tool doesn't fit any category, skip it (don't force-classify)
4. Cache the results by running:

\`\`\`bash
node scripts/flow-mcp-capabilities.js cache '<json>'
\`\`\`

Where \`<json>\` follows this format:
\`\`\`json
{
  "<server-name>": {
    "tools": [
      { "name": "mcp__server__tool_name", "description": "Brief description", "category": "<category-id>" }
    ]
  }
}
\`\`\`

Only include tools that match a category. Skip internal/utility tools that aren't useful for sub-agents.`;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  getMcpCapabilitiesConfig,
  getCapabilityCategories,
  getRoleCapabilities,
  getAllRoles,

  // Discovery
  discoverMcpServers,

  // Cache
  getCachedClassifications,
  cacheClassifications,
  clearCache,
  CACHE_PATH,

  // Prompt generation
  generateHint,
  generateClassificationPrompt
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'check-cache': {
      const cached = getCachedClassifications();
      if (cached) {
        const serverCount = Object.keys(cached.classifications || {}).length;
        const toolCount = Object.values(cached.classifications || {})
          .reduce((sum, s) => sum + (s.tools?.length || 0), 0);
        console.log(JSON.stringify({
          status: 'cache-hit',
          cachedAt: cached.cachedAt,
          servers: serverCount,
          tools: toolCount
        }));
      } else {
        console.log(JSON.stringify({ status: 'cache-miss' }));
      }
      break;
    }

    case 'categories': {
      const categories = getCapabilityCategories();
      console.log('\nCapability Categories:\n');
      for (const [name, def] of Object.entries(categories)) {
        console.log(`  ${name}`);
        console.log(`    ${def.description}`);
        console.log(`    Keywords: ${def.keywords.join(', ')}`);
        console.log('');
      }
      break;
    }

    case 'roles': {
      const roles = getAllRoles();
      console.log('\nRole-to-Capability Mapping:\n');
      for (const [role, capabilities] of Object.entries(roles)) {
        console.log(`  ${role}: ${capabilities.join(', ')}`);
      }
      break;
    }

    case 'hint': {
      const role = args[1];
      if (!role) {
        console.error('Usage: flow-mcp-capabilities.js hint <role>');
        process.exit(1);
      }
      const hint = generateHint(role);
      if (hint) {
        console.log(hint);
      } else {
        console.log('');
      }
      break;
    }

    case 'cache': {
      const jsonStr = args[1];
      if (!jsonStr) {
        console.error('Usage: flow-mcp-capabilities.js cache \'<json>\'');
        process.exit(1);
      }
      try {
        const data = JSON.parse(jsonStr);
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          console.error('Invalid input: expected a JSON object');
          process.exit(1);
        }
        // cacheClassifications handles sanitization (dangerous keys, length limits)
        const success = cacheClassifications(data);
        if (success) {
          const serverCount = Object.keys(data).length;
          const toolCount = Object.values(data).reduce((sum, s) => sum + (s.tools?.length || 0), 0);
          console.log(JSON.stringify({ status: 'cached', servers: serverCount, tools: toolCount }));
        } else {
          console.error('Failed to write cache');
          process.exit(1);
        }
      } catch (err) {
        console.error(`Invalid JSON: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'clear': {
      clearCache();
      console.log('Cache cleared');
      break;
    }

    case 'discover': {
      const servers = discoverMcpServers();
      if (servers.length === 0) {
        console.log('No MCP servers found');
      } else {
        console.log(`\nDiscovered ${servers.length} MCP server(s):\n`);
        for (const name of servers) {
          console.log(`  - ${name}`);
        }
      }
      break;
    }

    case 'classify-prompt': {
      const prompt = generateClassificationPrompt();
      if (prompt) {
        console.log(prompt);
      } else {
        console.log('No MCP servers detected — classification not needed.');
      }
      break;
    }

    default: {
      console.log(`
Wogi Flow - MCP Capability Discovery

Usage:
  node flow-mcp-capabilities.js <command> [args]

Commands:
  check-cache          Check if classification cache exists (JSON output)
  categories           List all capability categories
  roles                List all role-to-capability mappings
  hint <role>          Generate capability hint for a specific agent role
  cache '<json>'       Cache tool classifications (JSON input)
  clear                Clear the classification cache
  discover             List all discovered MCP servers
  classify-prompt      Generate classification instructions for the orchestrator

Examples:
  node flow-mcp-capabilities.js check-cache
  node flow-mcp-capabilities.js hint explore-codebase
  node flow-mcp-capabilities.js discover
  node flow-mcp-capabilities.js classify-prompt
`);
    }
  }
}
