#!/usr/bin/env node

/**
 * Wogi Workspace — Multi-Repo Orchestration Layer
 *
 * Creates a workspace that coordinates N member repos through a manager agent.
 * The workspace reads WogiFlow state files (not source code) from each member
 * and generates a unified view for cross-repo task routing.
 *
 * Directory structure created:
 *   .workspace/
 *   ├── state/           — workspace-level state
 *   ├── contracts/       — shared API contracts
 *   ├── messages/        — agent-to-agent communication
 *   └── specs/           — cross-repo task specifications
 */

const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// Constants
// ============================================================

const WORKSPACE_CONFIG_FILE = 'wogi-workspace.json';
const WORKSPACE_DIR = '.workspace';
const WORKSPACE_DIRS = [
  'state',
  'contracts',
  'messages',
  'specs'
];

const MEMBER_ROLES = ['consumer', 'provider', 'both', 'standalone', 'library'];

const STATE_FILES_TO_READ = [
  { file: 'api-map.md', key: 'apiMap', description: 'API endpoints' },
  { file: 'app-map.md', key: 'appMap', description: 'Components/modules' },
  { file: 'schema-map.md', key: 'schemaMap', description: 'Data models' },
  { file: 'function-map.md', key: 'functionMap', description: 'Utility functions' },
  { file: 'decisions.md', key: 'decisions', description: 'Coding rules' },
  { file: 'config.json', key: 'config', description: 'Project config', json: true }
];

const INDEX_FILES_TO_READ = [
  { file: 'api-index.json', key: 'apiIndex' },
  { file: 'component-index.json', key: 'componentIndex' },
  { file: 'schema-index.json', key: 'schemaIndex' },
  { file: 'service-index.json', key: 'serviceIndex' },
  { file: 'registry-manifest.json', key: 'registryManifest' }
];

// ============================================================
// Discovery
// ============================================================

/**
 * Scan for WogiFlow-enabled subdirectories
 * @param {string} workspaceRoot — path to workspace folder
 * @returns {Array<{name: string, path: string, workflowPath: string}>}
 */
function discoverMembers(workspaceRoot) {
  const members = [];
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip hidden dirs and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const memberPath = path.join(workspaceRoot, entry.name);
    const workflowPath = path.join(memberPath, '.workflow');

    if (fs.existsSync(workflowPath) && fs.statSync(workflowPath).isDirectory()) {
      members.push({
        name: entry.name,
        path: memberPath,
        workflowPath
      });
    }
  }

  return members;
}

// ============================================================
// State File Reading (metadata only — no source code)
// ============================================================

/**
 * Read a member repo's WogiFlow state files
 * @param {string} workflowPath — path to member's .workflow/ directory
 * @returns {Object} parsed metadata
 */
function readMemberMetadata(workflowPath) {
  const statePath = path.join(workflowPath, 'state');
  const metadata = {};

  // Read markdown and JSON state files
  for (const { file, key, json } of STATE_FILES_TO_READ) {
    const filePath = path.join(json ? workflowPath : statePath, file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        metadata[key] = json ? JSON.parse(content) : content;
      }
    } catch (_err) {
      // Non-critical — skip unreadable files
    }
  }

  // Read JSON index files (machine-readable)
  for (const { file, key } of INDEX_FILES_TO_READ) {
    const filePath = path.join(statePath, file);
    try {
      if (fs.existsSync(filePath)) {
        metadata[key] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (_err) {
      // Non-critical
    }
  }

  return metadata;
}

/**
 * Extract capabilities summary from member metadata
 * @param {Object} metadata — parsed member metadata
 * @returns {Object} capabilities summary
 */
function extractCapabilities(metadata) {
  const caps = {
    endpoints: 0,
    components: 0,
    models: 0,
    functions: 0,
    services: 0
  };

  // Count from index files (most accurate)
  if (metadata.apiIndex) {
    const idx = metadata.apiIndex;
    caps.endpoints = (idx.endpoints || []).length + (idx.clientFunctions || []).length;
  }
  if (metadata.componentIndex) {
    const idx = metadata.componentIndex;
    caps.components = (idx.components || []).length + (idx.hooks || []).length;
  }
  if (metadata.schemaIndex) {
    const idx = metadata.schemaIndex;
    caps.models = (idx.models || []).length;
  }
  if (metadata.serviceIndex) {
    const idx = metadata.serviceIndex;
    caps.services = (idx.services || []).length;
  }

  // Fallback: count from markdown tables if index files missing
  if (caps.endpoints === 0 && metadata.apiMap) {
    caps.endpoints = (metadata.apiMap.match(/^\|[^|]+\|/gm) || []).length - countHeaderRows(metadata.apiMap);
  }
  if (caps.components === 0 && metadata.appMap) {
    caps.components = (metadata.appMap.match(/^\|[^|]+\|/gm) || []).length - countHeaderRows(metadata.appMap);
  }

  return caps;
}

/**
 * Count markdown table header rows (lines starting with |---|)
 */
function countHeaderRows(md) {
  return (md.match(/^\|[-: |]+\|$/gm) || []).length;
}

/**
 * Extract endpoints provided/consumed from api-map or api-index
 * @param {Object} metadata
 * @returns {{ provides: string[], consumes: string[] }}
 */
function extractEndpoints(metadata) {
  const provides = [];
  const consumes = [];

  if (metadata.apiIndex) {
    const idx = metadata.apiIndex;
    // Server endpoints = provides
    for (const ep of (idx.endpoints || [])) {
      const method = (ep.method || 'GET').toUpperCase();
      const route = ep.route || ep.path || ep.endpoint || '';
      if (route) provides.push(`${method} ${route}`);
    }
    // Client functions = consumes
    for (const fn of (idx.clientFunctions || [])) {
      const method = (fn.method || 'GET').toUpperCase();
      const url = fn.url || fn.endpoint || fn.path || '';
      if (url) consumes.push(`${method} ${url}`);
    }
  }

  return { provides, consumes };
}

/**
 * Detect stack from config or metadata
 * @param {Object} metadata
 * @param {string} memberPath
 * @returns {Object} stack info
 */
function detectStack(metadata, memberPath) {
  const stack = {
    language: 'unknown',
    framework: 'unknown'
  };

  // From WogiFlow config
  if (metadata.config) {
    const c = metadata.config;
    if (c.projectType) stack.projectType = c.projectType;
    if (c.strictAdherence?.operational?.packageManager?.tool) {
      stack.packageManager = c.strictAdherence.operational.packageManager.tool;
    }
  }

  // Detect from package.json
  const pkgPath = path.join(memberPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) {
        stack.language = 'TypeScript';
      } else {
        stack.language = 'JavaScript';
      }

      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (allDeps.react) stack.framework = 'React';
      else if (allDeps.next) stack.framework = 'Next.js';
      else if (allDeps.vue) stack.framework = 'Vue';
      else if (allDeps.svelte) stack.framework = 'Svelte';
      else if (allDeps.express) stack.framework = 'Express';
      else if (allDeps.fastify) stack.framework = 'Fastify';
      else if (allDeps.nestjs || allDeps['@nestjs/core']) stack.framework = 'NestJS';
      else if (allDeps.hono) stack.framework = 'Hono';
    } catch (_err) {
      // Non-critical
    }
  }

  // Detect Python
  const pyprojectPath = path.join(memberPath, 'pyproject.toml');
  const requirementsPath = path.join(memberPath, 'requirements.txt');
  if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath)) {
    stack.language = 'Python';
    try {
      const content = fs.existsSync(pyprojectPath)
        ? fs.readFileSync(pyprojectPath, 'utf-8')
        : fs.readFileSync(requirementsPath, 'utf-8');
      if (content.includes('fastapi')) stack.framework = 'FastAPI';
      else if (content.includes('django')) stack.framework = 'Django';
      else if (content.includes('flask')) stack.framework = 'Flask';
    } catch (_err) {
      // Non-critical
    }
  }

  // Detect Go
  if (fs.existsSync(path.join(memberPath, 'go.mod'))) {
    stack.language = 'Go';
    try {
      const goMod = fs.readFileSync(path.join(memberPath, 'go.mod'), 'utf-8');
      if (goMod.includes('gin-gonic')) stack.framework = 'Gin';
      else if (goMod.includes('echo')) stack.framework = 'Echo';
      else if (goMod.includes('fiber')) stack.framework = 'Fiber';
    } catch (_err) {
      // Non-critical
    }
  }

  return stack;
}

// ============================================================
// Workspace Config & Manifest Generation
// ============================================================

/**
 * Auto-detect role based on endpoints
 * @param {{ provides: string[], consumes: string[] }} endpoints
 * @returns {string} role
 */
function autoDetectRole(endpoints) {
  const hasProvides = endpoints.provides.length > 0;
  const hasConsumes = endpoints.consumes.length > 0;

  if (hasProvides && hasConsumes) return 'both';
  if (hasProvides) return 'provider';
  if (hasConsumes) return 'consumer';
  return 'standalone';
}

/**
 * Generate the workspace config (wogi-workspace.json)
 * @param {string} workspaceName
 * @param {Array} members — array of { name, role, path }
 * @returns {Object} workspace config
 */
function generateWorkspaceConfig(workspaceName, members) {
  const config = {
    $schema: './workspace-config.schema.json',
    name: workspaceName,
    version: '1.0.0',
    members: {},
    routing: {
      default: 'auto',
      providerFirst: true
    },
    contracts: {
      autoGenerate: true,
      format: 'openapi',
      path: '.workspace/contracts'
    },
    messages: {
      autoNotify: true,
      path: '.workspace/messages'
    },
    sync: {
      autoOnSessionStart: true,
      autoAfterTaskComplete: true
    }
  };

  for (const member of members) {
    config.members[member.name] = {
      path: `./${member.name}`,
      role: member.role
    };
  }

  return config;
}

/**
 * Generate the workspace manifest from member metadata
 * @param {string} workspaceName
 * @param {Array} members — enriched member objects
 * @returns {Object} manifest
 */
function generateManifest(workspaceName, members) {
  const manifest = {
    workspace: workspaceName,
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    members: {},
    integrations: {
      matched: [],
      orphanedConsumers: [],
      orphanedProviders: [],
      typeDrift: []
    }
  };

  for (const member of members) {
    manifest.members[member.name] = {
      path: `./${member.name}`,
      role: member.role,
      stack: member.stack,
      capabilities: member.capabilities,
      provides: member.endpoints.provides,
      consumes: member.endpoints.consumes,
      lastSynced: new Date().toISOString()
    };
  }

  // Cross-reference endpoints to find integration points
  const allProviders = new Map(); // endpoint → [memberName]
  const allConsumers = new Map(); // endpoint → [memberName]

  for (const member of members) {
    for (const ep of member.endpoints.provides) {
      if (!allProviders.has(ep)) allProviders.set(ep, []);
      allProviders.get(ep).push(member.name);
    }
    for (const ep of member.endpoints.consumes) {
      // Normalize consumer endpoints for matching (strip base URL, query params)
      const normalized = normalizeEndpoint(ep);
      if (!allConsumers.has(normalized)) allConsumers.set(normalized, []);
      allConsumers.get(normalized).push(member.name);
    }
  }

  // Find matches and orphans
  for (const [ep, consumers] of allConsumers) {
    // Try to match against providers (fuzzy — same method + similar path)
    let matched = false;
    for (const [providerEp, providers] of allProviders) {
      if (endpointsMatch(ep, providerEp)) {
        manifest.integrations.matched.push({
          endpoint: ep,
          providers,
          consumers
        });
        matched = true;
        break;
      }
    }
    if (!matched) {
      manifest.integrations.orphanedConsumers.push({
        endpoint: ep,
        consumers
      });
    }
  }

  // Find providers with no consumers
  for (const [ep, providers] of allProviders) {
    let hasConsumer = false;
    for (const [consumerEp] of allConsumers) {
      if (endpointsMatch(consumerEp, ep)) {
        hasConsumer = true;
        break;
      }
    }
    if (!hasConsumer) {
      manifest.integrations.orphanedProviders.push({
        endpoint: ep,
        providers
      });
    }
  }

  return manifest;
}

/**
 * Normalize an endpoint for matching (strip query params, base URL)
 */
function normalizeEndpoint(ep) {
  // Remove base URL if present
  let normalized = ep.replace(/https?:\/\/[^/]+/, '');
  // Remove query params
  normalized = normalized.replace(/\?.*$/, '');
  // Normalize path params: /users/123 → /users/:id
  normalized = normalized.replace(/\/\d+/g, '/:id');
  return normalized.trim();
}

/**
 * Check if two endpoints match (same method + similar path)
 */
function endpointsMatch(ep1, ep2) {
  const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  let [method1, ...pathParts1] = ep1.split(' ');
  let [method2, ...pathParts2] = ep2.split(' ');

  // If the first token isn't a recognized HTTP method, treat the whole string as a path
  if (!HTTP_METHODS.has(method1.toUpperCase())) {
    pathParts1 = [ep1];
    method1 = 'GET';
  }
  if (!HTTP_METHODS.has(method2.toUpperCase())) {
    pathParts2 = [ep2];
    method2 = 'GET';
  }

  method1 = method1.toUpperCase();
  method2 = method2.toUpperCase();

  const path1 = pathParts1.join(' ').trim();
  const path2 = pathParts2.join(' ').trim();

  if (method1 !== method2) return false;

  // Exact match
  if (path1 === path2) return true;

  // Normalize and compare
  const norm1 = normalizeEndpoint(path1);
  const norm2 = normalizeEndpoint(path2);
  return norm1 === norm2;
}

// ============================================================
// CLAUDE.md Generation
// ============================================================

/**
 * Generate workspace-level CLAUDE.md
 * @param {Object} config — workspace config
 * @param {Object} manifest — workspace manifest
 * @returns {string} CLAUDE.md content
 */
function generateWorkspaceClaudeMd(config, manifest) {
  const memberLines = Object.entries(manifest.members).map(([name, m]) => {
    return `| ${name} | ${m.role} | ${m.stack.language}/${m.stack.framework} | ${m.provides.length} provided, ${m.consumes.length} consumed |`;
  });

  const matchedCount = manifest.integrations.matched.length;
  const orphanCount = manifest.integrations.orphanedConsumers.length;
  const memberNames = Object.keys(manifest.members);
  const providers = Object.entries(manifest.members).filter(([_, m]) => m.role === 'provider' || m.role === 'both').map(([n]) => n);
  const consumers = Object.entries(manifest.members).filter(([_, m]) => m.role === 'consumer' || m.role === 'both').map(([n]) => n);

  return `# Wogi Workspace: ${config.name}

You are a **workspace manager** coordinating ${memberNames.length} repositories. You do NOT read source code directly. You read WogiFlow state files to understand each repo, then delegate implementation to repo-scoped sub-agents.

## CRITICAL RULES

1. **NEVER read source code** in member repos directly. Read \`.workflow/state/\` files (api-map.md, app-map.md, decisions.md) for context.
2. **ALWAYS delegate implementation** to sub-agents. You plan and coordinate — sub-agents write code.
3. **Provider before consumer.** When both need changes, implement the provider side first.
4. **Write messages after cross-repo changes.** Every change that affects another repo gets a message in \`.workspace/messages/\`.

## Member Repos

| Repo | Role | Stack | Endpoints |
|------|------|-------|-----------|
${memberLines.join('\n')}

## Session Startup Checklist

When you start a session, do this FIRST:
1. Read \`.workspace/state/workspace-manifest.json\` — understand the current integration map
2. Check \`.workspace/messages/\` for unread messages (status: "pending") — show them to the user
3. Read each member's \`.workflow/state/ready.json\` — know what tasks are in progress

## How to Route Tasks

### Step 1: Classify the Task

Read the user's request and determine:
- **Single-repo** — only affects one repo (e.g., "add a button to the login page" → ${consumers[0] || 'frontend'})
- **Cross-repo** — affects multiple repos (e.g., "add avatar upload" → needs endpoint + UI)
- **Bug investigation** — something is broken, unclear which repo

### Step 2: Routing Keywords

${Object.entries(manifest.members).map(([name, m]) => {
    const keywords = [];
    if (m.role === 'consumer' || m.role === 'both') keywords.push('page', 'component', 'UI', 'style', 'frontend', 'screen', 'form');
    if (m.role === 'provider' || m.role === 'both') keywords.push('endpoint', 'model', 'database', 'migration', 'backend', 'API', 'query');
    if (m.role === 'library') keywords.push('shared', 'utility', 'types', 'common');
    return `- **${name}** (${m.role}): ${keywords.join(', ')}`;
  }).join('\n')}
- **Both/all repos**: api contract, schema change, integration, full-stack, end-to-end

### Step 3: Execute

**Single-repo task — spawn one sub-agent:**
\`\`\`
Use the Agent tool:
  prompt: "You are working in the <REPO> repository.
    Stack: <STACK>
    Task: <TASK DESCRIPTION>

    Project rules (read from <REPO>/.workflow/state/decisions.md):
    <PASTE DECISIONS CONTENT>

    After completing: commit your changes with a descriptive message."

  The sub-agent runs with the full codebase of that repo available.
  It follows that repo's own WogiFlow rules, decisions, and patterns.
\`\`\`

**Cross-repo task — sequential delegation:**
1. Read the contract from \`.workspace/contracts/\` (if exists)
2. If the API contract needs updating, update it first
3. Spawn provider sub-agent (${providers.join(' or ')}) — implement the API side
4. Read what the provider changed (from its git diff or commit message)
5. Write a message to \`.workspace/messages/\` describing the change
6. Spawn consumer sub-agent (${consumers.join(' or ')}) — implement the client side, include the message as context
7. Verify both sides work together

**Bug investigation — parallel agents:**
\`\`\`
Spawn ${memberNames.length} agents IN PARALLEL (single message with multiple Agent tool calls):

Agent 1 (${memberNames[0]}):
  "Investigate this bug in ${memberNames[0]}: <BUG DESCRIPTION>
   Check: recent changes, error logs, relevant code.
   Report: Is the issue on YOUR side? What did you find?"

${memberNames.length > 1 ? `Agent 2 (${memberNames[1]}):
  "Investigate this bug in ${memberNames[1]}: <BUG DESCRIPTION>
   Check: recent changes, error logs, relevant code.
   Report: Is the issue on YOUR side? What did you find?"` : ''}

Then synthesize the findings and route the fix to the correct repo.
\`\`\`

## Reading Member State (What to Read, When)

| When | What to Read | Path |
|------|-------------|------|
| Before routing a task | api-map.md | \`<repo>/.workflow/state/api-map.md\` |
| Before spawning an agent | decisions.md | \`<repo>/.workflow/state/decisions.md\` |
| To understand structure | app-map.md | \`<repo>/.workflow/state/app-map.md\` |
| To check data models | schema-map.md | \`<repo>/.workflow/state/schema-map.md\` |
| To check task status | ready.json | \`<repo>/.workflow/state/ready.json\` |

**NEVER read**: source files (\`src/\`, \`lib/\`, \`app/\`, etc.) — leave that to sub-agents.

## Integration Map

- **${matchedCount}** matched endpoint pair${matchedCount !== 1 ? 's' : ''} (provider ↔ consumer)
${orphanCount > 0 ? `- **${orphanCount}** orphaned consumer${orphanCount !== 1 ? 's' : ''} (calling endpoints with no provider) ⚠️` : '- No orphaned consumers ✓'}

Full details: \`.workspace/state/workspace-manifest.json\`
Visual map: \`.workspace/state/integration-map.md\`

## Message Bus

After ANY cross-repo change, write a message to \`.workspace/messages/\`:

\`\`\`json
{
  "id": "msg-<random-8-hex>",
  "from": "<repo-that-changed>",
  "to": "<affected-repo>",
  "type": "contract-change",
  "subject": "Changed POST /api/users — added email_verified field",
  "body": "Details of what changed and why...",
  "actionRequired": true,
  "status": "pending",
  "timestamp": "<ISO-8601>"
}
\`\`\`

**Message types**: \`contract-change\`, \`question\`, \`bug-report\`, \`task-complete\`, \`needs-help\`, \`heads-up\`

When spawning a sub-agent, check for pending messages to that repo and include them in the prompt context.

## Contracts

Shared API contracts: \`.workspace/contracts/\`
When a provider changes an endpoint, update the contract BEFORE the consumer implements.

## Workspace Commands

| Command | What it does |
|---------|-------------|
| \`flow workspace sync\` | Re-read all member state files, update manifest |
| \`flow workspace status\` | Show all repos, tasks, messages, contracts |
| \`flow workspace add <path>\` | Add a new member repo |
| \`flow workspace remove <name>\` | Remove a member repo |

## File Reference

| File | Purpose |
|------|---------|
| \`wogi-workspace.json\` | Workspace config (members, roles, settings) |
| \`.workspace/state/workspace-manifest.json\` | Auto-generated member metadata + integration map |
| \`.workspace/state/integration-map.md\` | Human-readable integration visualization |
| \`.workspace/state/ready.json\` | Workspace-level cross-repo tasks |
| \`.workspace/state/decisions.md\` | Shared cross-repo rules |
| \`.workspace/contracts/\` | Shared API contracts (OpenAPI, TypeScript, etc.) |
| \`.workspace/messages/\` | Agent-to-agent messages |

---
Generated by Wogi Workspace v1.0.0
Last synced: ${new Date().toISOString()}
`;
}

// ============================================================
// Settings.json Generation
// ============================================================

/**
 * Generate workspace-level .claude/settings.json
 * Minimal hooks — workspace doesn't need validation/linting hooks.
 * @returns {Object} settings config
 */
function generateWorkspaceSettings(memberNames) {
  // Build read patterns for member state files
  const readPatterns = [];
  const bashPatterns = [
    'Bash(git status *)',
    'Bash(git log *)',
    'Bash(git diff *)',
    'Bash(git show *)',
    'Bash(git branch *)',
    'Bash(git add *)',
    'Bash(git commit *)',
    'Bash(git push *)',
    'Bash(git pull *)',
    'Bash(git fetch *)',
    'Bash(node --check *)',
    'Bash(node scripts/*)',
    'Bash(ls *)',
    'Bash(cat *)'
  ];

  for (const name of (memberNames || [])) {
    readPatterns.push(`Read(${name}/.workflow/**)`);
    readPatterns.push(`Read(${name}/package.json)`);
    readPatterns.push(`Read(${name}/pyproject.toml)`);
    readPatterns.push(`Read(${name}/go.mod)`);
  }

  return {
    permissions: {
      allow: [
        // Allow reading member state files
        ...readPatterns,
        // Allow reading workspace state
        'Read(.workspace/**)',
        'Read(wogi-workspace.json)',
        'Read(CLAUDE.md)',
        // Allow writing workspace state
        'Write(.workspace/**)',
        'Edit(.workspace/**)',
        // Allow git and node
        ...bashPatterns
      ]
    },
    hooks: {},
    _wogiWorkspace: true,
    _wogiFlowVersion: require('../package.json').version,
    _comment: 'Workspace-level settings. Member repos have their own settings. Sub-agents spawned for member repos use THEIR settings, not these.'
  };
}

// ============================================================
// Directory Structure Creation
// ============================================================

/**
 * Create the .workspace/ directory structure
 * @param {string} workspaceRoot
 */
function createWorkspaceStructure(workspaceRoot) {
  const wsDir = path.join(workspaceRoot, WORKSPACE_DIR);

  // Create main dirs
  for (const dir of WORKSPACE_DIRS) {
    const dirPath = path.join(wsDir, dir);
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // Create .claude/ for workspace settings
  const claudeDir = path.join(workspaceRoot, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  // Create empty ready.json for workspace-level tasks
  const readyPath = path.join(wsDir, 'state', 'ready.json');
  if (!fs.existsSync(readyPath)) {
    fs.writeFileSync(readyPath, JSON.stringify({
      lastUpdated: new Date().toISOString(),
      inProgress: [],
      ready: [],
      blocked: [],
      recentlyCompleted: []
    }, null, 2));
  }

  // Create workspace decisions.md
  const decisionsPath = path.join(wsDir, 'state', 'decisions.md');
  if (!fs.existsSync(decisionsPath)) {
    fs.writeFileSync(decisionsPath, `# Workspace Decisions

Cross-repo rules that apply to all member repositories.

## Shared Conventions

<!-- Add shared rules here, e.g.: -->
<!-- ### Date Format -->
<!-- All dates use ISO 8601 (YYYY-MM-DDTHH:mm:ssZ) across all repos. -->
`);
  }

  // Create .gitignore for workspace transient files
  const gitignorePath = path.join(wsDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `# Wogi Workspace — transient files
# Messages are ephemeral (processed and resolved)
messages/*.json
# State is auto-generated from member repos
state/workspace-manifest.json
state/integration-map.md
state/contract-versions.json
`);
  }
}

// ============================================================
// Main Init Function
// ============================================================

/**
 * Initialize a Wogi Workspace
 * @param {string[]} args — CLI arguments
 */
async function initWorkspace(args) {
  const workspaceRoot = process.cwd();
  const workspaceName = path.basename(workspaceRoot);

  // Check if workspace already exists
  if (fs.existsSync(path.join(workspaceRoot, WORKSPACE_CONFIG_FILE))) {
    console.error(`Workspace already initialized in ${workspaceRoot}`);
    console.error('Use `flow workspace sync` to update.');
    process.exit(1);
  }

  console.log('🔍 Scanning for WogiFlow-enabled projects...\n');

  // Discover member repos
  const discovered = discoverMembers(workspaceRoot);

  if (discovered.length === 0) {
    console.error('No WogiFlow-enabled projects found in subdirectories.');
    console.error('Each member repo must have a .workflow/ directory (run `flow init` in each first).');
    process.exit(1);
  }

  console.log(`Found ${discovered.length} WogiFlow project${discovered.length !== 1 ? 's' : ''}:`);
  for (const m of discovered) {
    console.log(`  ✓ ${m.name}/`);
  }
  console.log('');

  // Read metadata from each member
  console.log('── Reading project metadata ──────────────────\n');
  const members = [];

  for (const disc of discovered) {
    const metadata = readMemberMetadata(disc.workflowPath);
    const stack = detectStack(metadata, disc.path);
    const capabilities = extractCapabilities(metadata);
    const endpoints = extractEndpoints(metadata);
    const role = autoDetectRole(endpoints);

    members.push({
      name: disc.name,
      path: disc.path,
      workflowPath: disc.workflowPath,
      metadata,
      stack,
      capabilities,
      endpoints,
      role
    });

    const capsSummary = Object.entries(capabilities)
      .filter(([_, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ') || 'no data yet';

    console.log(`  ${disc.name}/ (${stack.language}/${stack.framework})`);
    console.log(`    Role: ${role} | ${capsSummary}`);
    console.log(`    Provides: ${endpoints.provides.length} endpoints | Consumes: ${endpoints.consumes.length} endpoints`);
    console.log('');
  }

  // Create directory structure
  console.log('── Creating workspace structure ──────────────\n');
  createWorkspaceStructure(workspaceRoot);
  console.log('  ✓ .workspace/state/');
  console.log('  ✓ .workspace/contracts/');
  console.log('  ✓ .workspace/messages/');
  console.log('  ✓ .workspace/specs/');
  console.log('');

  // Generate workspace config
  const config = generateWorkspaceConfig(workspaceName, members);
  fs.writeFileSync(
    path.join(workspaceRoot, WORKSPACE_CONFIG_FILE),
    JSON.stringify(config, null, 2)
  );
  console.log(`  ✓ ${WORKSPACE_CONFIG_FILE}`);

  // Generate manifest
  const manifest = generateManifest(workspaceName, members);
  fs.writeFileSync(
    path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'workspace-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log('  ✓ .workspace/state/workspace-manifest.json');

  // Generate integration map (human-readable markdown)
  const integrationMap = generateIntegrationMap(manifest);
  fs.writeFileSync(
    path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'integration-map.md'),
    integrationMap
  );
  console.log('  ✓ .workspace/state/integration-map.md');

  // Generate CLAUDE.md
  const claudeMd = generateWorkspaceClaudeMd(config, manifest);
  fs.writeFileSync(path.join(workspaceRoot, 'CLAUDE.md'), claudeMd);
  console.log('  ✓ CLAUDE.md (workspace manager instructions)');

  // Generate settings.json
  const settings = generateWorkspaceSettings(members.map(m => m.name));
  fs.writeFileSync(
    path.join(workspaceRoot, '.claude', 'settings.json'),
    JSON.stringify(settings, null, 2)
  );
  console.log('  ✓ .claude/settings.json');
  console.log('');

  // Summary
  const matched = manifest.integrations.matched.length;
  const orphanedC = manifest.integrations.orphanedConsumers.length;
  const orphanedP = manifest.integrations.orphanedProviders.length;

  console.log('── Integration Summary ──────────────────────\n');
  console.log(`  ✓ ${matched} matched endpoint pair${matched !== 1 ? 's' : ''}`);
  if (orphanedC > 0) {
    console.log(`  ⚠️  ${orphanedC} orphaned consumer${orphanedC !== 1 ? 's' : ''} (calling endpoints with no provider)`);
    for (const orphan of manifest.integrations.orphanedConsumers) {
      console.log(`     → ${orphan.endpoint} (consumed by: ${orphan.consumers.join(', ')})`);
    }
  }
  if (orphanedP > 0) {
    console.log(`  ℹ️  ${orphanedP} endpoint${orphanedP !== 1 ? 's' : ''} with no consumer`);
  }
  console.log('');

  console.log(`✅ Workspace "${workspaceName}" initialized with ${members.length} member${members.length !== 1 ? 's' : ''}!`);
  console.log('');
  console.log('Next steps:');
  console.log("  1. Run 'claude' in this folder to start the workspace manager");
  console.log("  2. Give it tasks — it will route them to the right repo(s)");
  console.log("  3. Run 'flow workspace sync' after external changes");
  console.log('');
}

/**
 * Generate human-readable integration map markdown
 * @param {Object} manifest
 * @returns {string}
 */
function generateIntegrationMap(manifest) {
  const lines = ['# Integration Map\n'];
  lines.push(`Generated: ${manifest.generatedAt}\n`);

  // Matched endpoints
  if (manifest.integrations.matched.length > 0) {
    lines.push('## Matched Endpoints\n');
    lines.push('| Endpoint | Provider(s) | Consumer(s) |');
    lines.push('|----------|-------------|-------------|');
    for (const m of manifest.integrations.matched) {
      lines.push(`| \`${m.endpoint}\` | ${m.providers.join(', ')} | ${m.consumers.join(', ')} |`);
    }
    lines.push('');
  }

  // Orphaned consumers
  if (manifest.integrations.orphanedConsumers.length > 0) {
    lines.push('## ⚠️ Orphaned Consumers\n');
    lines.push('These repos call endpoints that no provider serves:\n');
    for (const o of manifest.integrations.orphanedConsumers) {
      lines.push(`- \`${o.endpoint}\` — consumed by: ${o.consumers.join(', ')}`);
    }
    lines.push('');
  }

  // Orphaned providers
  if (manifest.integrations.orphanedProviders.length > 0) {
    lines.push('## ℹ️ Endpoints Without Consumers\n');
    lines.push('These endpoints are served but no consumer calls them:\n');
    for (const o of manifest.integrations.orphanedProviders) {
      lines.push(`- \`${o.endpoint}\` — provided by: ${o.providers.join(', ')}`);
    }
    lines.push('');
  }

  // Member summary
  lines.push('## Members\n');
  for (const [name, m] of Object.entries(manifest.members)) {
    lines.push(`### ${name} (${m.role})`);
    lines.push(`- **Stack**: ${m.stack.language} / ${m.stack.framework}`);
    lines.push(`- **Provides**: ${m.provides.length > 0 ? m.provides.join(', ') : 'none'}`);
    lines.push(`- **Consumes**: ${m.consumes.length > 0 ? m.consumes.join(', ') : 'none'}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// CLI Router
// ============================================================

/**
 * Handle workspace subcommands
 * @param {string[]} args
 */
async function workspace(args) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'init':
      await initWorkspace(args.slice(1));
      break;
    case 'sync': {
      const { syncWorkspace } = require('./workspace-sync');
      const result = syncWorkspace(process.cwd());
      console.log(`✓ Synced ${result.membersUpdated} member(s). ${result.changes.length} change(s) detected.`);
      if (result.warnings.length > 0) {
        for (const w of result.warnings) console.log(`  ⚠️  ${w}`);
      }
      break;
    }
    case 'status': {
      const { getWorkspaceStatus } = require('./workspace-sync');
      console.log(getWorkspaceStatus(process.cwd()));
      break;
    }
    case 'add': {
      const { addMember } = require('./workspace-sync');
      const memberPath = args[1];
      const role = args[2];
      if (!memberPath) {
        console.error('Usage: flow workspace add <path> [role]');
        process.exit(1);
      }
      const result = addMember(process.cwd(), memberPath, role);
      console.log(`✓ Added '${result.name}' as ${result.role}`);
      break;
    }
    case 'remove': {
      const { removeMember } = require('./workspace-sync');
      const name = args[1];
      if (!name) {
        console.error('Usage: flow workspace remove <name>');
        process.exit(1);
      }
      removeMember(process.cwd(), name);
      console.log(`✓ Removed '${name}' from workspace`);
      break;
    }
    default:
      console.log(`
Wogi Workspace — Multi-Repo Orchestration

Usage: flow workspace <command>

Commands:
  init       Initialize a workspace from member repos
  sync       Re-sync workspace manifest from member state files
  status     Show unified workspace status
  add        Add a member repo to the workspace
  remove     Remove a member repo from the workspace

Examples:
  flow workspace init          # Create workspace from subdirectories
  flow workspace sync          # Refresh after external changes
  flow workspace status        # Show all repos, tasks, contracts
`);
  }
}

module.exports = {
  workspace,
  initWorkspace,
  discoverMembers,
  readMemberMetadata,
  extractCapabilities,
  extractEndpoints,
  detectStack,
  generateWorkspaceConfig,
  generateManifest,
  generateWorkspaceClaudeMd,
  generateWorkspaceSettings,
  createWorkspaceStructure,
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_DIR,
  MEMBER_ROLES
};
