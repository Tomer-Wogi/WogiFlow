#!/usr/bin/env node

/**
 * Wogi Workspace — Cross-Repo Intelligence + N-Repo Scaling + Cloud Prep
 *
 * Stories 5-8 (wf-bbc47dc1, wf-d2e01566, wf-868ba5a5):
 * Contract drift detection, blame router, shared decisions, API changelog,
 * cross-repo ready queue, integration testing gate, graph-based integration map,
 * library support, cascading propagation, workspace health, and cloud interfaces.
 */

const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// S5: Contract Drift Detection (Criterion 1)
// ============================================================

/**
 * Compare actual implementation against the contract spec.
 * Scans provider api-maps and compares with contracts/.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @returns {Array<Object>} drift entries
 */
function detectContractDrift(workspaceRoot, manifest) {
  const drifts = [];
  const contractsDir = path.join(workspaceRoot, '.workspace', 'contracts');
  if (!fs.existsSync(contractsDir)) return drifts;

  // Load all contracts
  const contractEndpoints = new Set();
  const files = fs.readdirSync(contractsDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(contractsDir, file), 'utf-8'));
      if (spec.paths) {
        for (const [routePath, methods] of Object.entries(spec.paths)) {
          for (const method of Object.keys(methods)) {
            if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
              contractEndpoints.add(`${method.toUpperCase()} ${routePath}`);
            }
          }
        }
      }
    } catch (_err) {
      // Skip malformed contracts
    }
  }

  if (contractEndpoints.size === 0) return drifts;

  // Compare each provider's actual endpoints against contract
  for (const [name, member] of Object.entries(manifest.members)) {
    if (member.role !== 'provider' && member.role !== 'both') continue;

    const actualEndpoints = new Set(member.provides || []);

    // Endpoints in contract but not in actual implementation
    for (const contractEp of contractEndpoints) {
      const hasMatch = [...actualEndpoints].some(actual => {
        const normActual = normalizeForDrift(actual);
        const normContract = normalizeForDrift(contractEp);
        return normActual === normContract;
      });

      if (!hasMatch) {
        drifts.push({
          type: 'missing-implementation',
          member: name,
          endpoint: contractEp,
          severity: 'high',
          message: `Contract defines ${contractEp} but ${name} does not implement it`
        });
      }
    }

    // Endpoints in implementation but not in contract
    for (const actualEp of actualEndpoints) {
      const hasMatch = [...contractEndpoints].some(contractEp => {
        return normalizeForDrift(actualEp) === normalizeForDrift(contractEp);
      });

      if (!hasMatch) {
        drifts.push({
          type: 'undocumented-endpoint',
          member: name,
          endpoint: actualEp,
          severity: 'medium',
          message: `${name} implements ${actualEp} but it's not in any contract`
        });
      }
    }
  }

  return drifts;
}

function normalizeForDrift(ep) {
  const parts = ep.trim().split(/\s+/);
  const method = (parts[0] || 'GET').toUpperCase();
  let urlPath = parts.slice(1).join(' ');
  urlPath = urlPath.replace(/\{[^}]+\}/g, ':param');
  urlPath = urlPath.replace(/:\w+/g, ':param');
  urlPath = urlPath.replace(/\/\d+/g, '/:param');
  return `${method} ${urlPath}`;
}

// ============================================================
// S5: Blame Router (Criterion 2)
// ============================================================

/**
 * Analyze a bug report and determine the most likely repo to blame.
 * Uses recent git changes + contract + error analysis.
 *
 * @param {string} workspaceRoot
 * @param {string} bugDescription
 * @param {Object} manifest
 * @returns {Object} blame analysis
 */
function routeBlame(workspaceRoot, bugDescription, manifest) {
  const desc = bugDescription.toLowerCase();
  const scores = {};
  const evidence = {};

  for (const [name, member] of Object.entries(manifest.members)) {
    scores[name] = 0;
    evidence[name] = [];

    // Check if bug mentions endpoints this repo owns
    for (const ep of (member.provides || [])) {
      const epPath = ep.split(' ').slice(1).join(' ').toLowerCase();
      if (desc.includes(epPath)) {
        scores[name] += 3;
        evidence[name].push(`Bug mentions endpoint ${ep} which ${name} provides`);
      }
    }

    // Check if bug mentions components/pages (consumer keywords)
    if (member.role === 'consumer' || member.role === 'both') {
      const uiKeywords = ['page', 'screen', 'component', 'form', 'button', 'blank', 'not showing', 'not loading', 'ui'];
      for (const kw of uiKeywords) {
        if (desc.includes(kw)) {
          scores[name] += 1;
          evidence[name].push(`Bug mentions UI keyword: "${kw}"`);
          break;
        }
      }
    }

    // Check for error codes (5xx = likely backend, 4xx = could be either)
    if (member.role === 'provider' || member.role === 'both') {
      if (desc.includes('500') || desc.includes('502') || desc.includes('503') || desc.includes('server error')) {
        scores[name] += 3;
        evidence[name].push('Server error (5xx) suggests backend issue');
      }
      if (desc.includes('database') || desc.includes('query') || desc.includes('migration')) {
        scores[name] += 2;
        evidence[name].push('Database-related keywords');
      }
    }

    // Check recent git changes (if accessible)
    try {
      const memberPath = path.resolve(workspaceRoot, member.path || `./${name}`);
      const { execFileSync } = require('node:child_process');
      const recentChanges = execFileSync('git', ['log', '--oneline', '-5', '--since=24 hours ago'], {
        cwd: memberPath, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (recentChanges) {
        const changeCount = recentChanges.split('\n').filter(Boolean).length;
        scores[name] += changeCount; // More recent changes = more likely to have introduced a bug
        evidence[name].push(`${changeCount} commit(s) in the last 24 hours`);
      }
    } catch (_err) {
      // Git not available or timeout — skip
    }
  }

  // Sort by score
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primarySuspect = sorted[0]?.[0];
  const confidence = sorted[0]?.[1] > 0
    ? sorted[0][1] > (sorted[1]?.[1] || 0) * 2 ? 'high' : 'medium'
    : 'low';

  return {
    primarySuspect,
    confidence,
    scores,
    evidence,
    recommendation: confidence === 'high'
      ? `Start investigation in ${primarySuspect}`
      : `Investigate both repos in parallel — evidence is inconclusive`
  };
}

// ============================================================
// S5: Shared Decision Layer (Criterion 3)
// ============================================================

/**
 * Read workspace-level shared decisions
 * @param {string} workspaceRoot
 * @returns {string} decisions content
 */
function getSharedDecisions(workspaceRoot) {
  const decisionsPath = path.join(workspaceRoot, '.workspace', 'state', 'decisions.md');
  try {
    if (fs.existsSync(decisionsPath)) {
      return fs.readFileSync(decisionsPath, 'utf-8');
    }
  } catch (_err) {
    // Non-critical
  }
  return '';
}

/**
 * Add a shared decision that applies across all repos
 * @param {string} workspaceRoot
 * @param {string} title
 * @param {string} content
 */
function addSharedDecision(workspaceRoot, title, content) {
  const decisionsPath = path.join(workspaceRoot, '.workspace', 'state', 'decisions.md');
  let existing = '';
  try {
    if (fs.existsSync(decisionsPath)) {
      existing = fs.readFileSync(decisionsPath, 'utf-8');
    }
  } catch (_err) {
    if (!fs.existsSync(decisionsPath)) {
      existing = '# Workspace Decisions\n\nCross-repo rules that apply to all member repositories.\n';
    } else {
      // File exists but can't be read — don't risk overwriting
      return;
    }
  }

  const entry = `\n### ${title}\n\n${content}\n\n*Added: ${new Date().toISOString().split('T')[0]}*\n`;
  fs.writeFileSync(decisionsPath, existing + entry);
}

// ============================================================
// S5: API Changelog (Criterion 4) — delegates to workspace-contracts
// S5: Cross-Repo Ready Queue (Criterion 5) — workspace state/ready.json
// S5: Integration Testing Gate (Criterion 6) — part of routing verify step
// ============================================================

// ============================================================
// S7: Graph-Based Integration Map (Criterion 1)
// ============================================================

/**
 * Build a dependency graph across N repos.
 * Nodes = repos, edges = endpoint dependencies.
 *
 * @param {Object} manifest
 * @returns {Object} graph { nodes, edges, adjacency }
 */
function buildDependencyGraph(manifest) {
  const graph = {
    nodes: [],
    edges: [],
    adjacency: {} // memberName → [dependsOn]
  };

  for (const [name, member] of Object.entries(manifest.members)) {
    graph.nodes.push({
      name,
      role: member.role,
      endpointCount: (member.provides || []).length + (member.consumes || []).length
    });
    graph.adjacency[name] = [];
  }

  // Build edges from matched integrations
  const matched = manifest.integrations?.matched || [];
  for (const m of matched) {
    for (const consumer of (m.consumers || [])) {
      for (const provider of (m.providers || [])) {
        if (consumer !== provider) {
          graph.edges.push({
            from: consumer,
            to: provider,
            endpoint: m.endpoint,
            type: 'consumes'
          });
          if (!graph.adjacency[consumer].includes(provider)) {
            graph.adjacency[consumer].push(provider);
          }
        }
      }
    }
  }

  return graph;
}

// ============================================================
// S7: Library Repo Support (Criterion 3)
// ============================================================

/**
 * Find all repos that depend on a library repo.
 * Used for cascading change propagation.
 *
 * @param {string} libraryName
 * @param {Object} manifest
 * @returns {string[]} consumer repo names
 */
function getLibraryConsumers(libraryName, manifest) {
  const consumers = [];

  for (const [name, member] of Object.entries(manifest.members)) {
    if (name === libraryName) continue;

    // Check if this repo imports from the library
    // (Would need to check package.json dependencies in real implementation)
    // For now, all non-library repos are potential consumers
    if (member.role !== 'library') {
      consumers.push(name);
    }
  }

  return consumers;
}

// ============================================================
// S7: Cascading Change Propagation (Criterion 4)
// ============================================================

/**
 * When a repo changes, determine which other repos need notification.
 *
 * @param {string} changedRepo
 * @param {Object} manifest
 * @param {Object} graph — from buildDependencyGraph()
 * @returns {string[]} repos that need notification
 */
function getCascadeTargets(changedRepo, manifest, graph) {
  const targets = new Set();

  // Direct dependents (repos that consume from changedRepo)
  for (const edge of graph.edges) {
    if (edge.to === changedRepo) {
      targets.add(edge.from);
    }
  }

  // If changedRepo is a library, all non-library repos are potential targets
  const member = manifest.members[changedRepo];
  if (member?.role === 'library') {
    for (const name of getLibraryConsumers(changedRepo, manifest)) {
      targets.add(name);
    }
  }

  return [...targets];
}

// ============================================================
// S7: Workspace Health Check (Criterion 5)
// ============================================================

/**
 * Check workspace health — stale manifests, broken contracts, unsynced repos.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @returns {Object} health report
 */
function checkWorkspaceHealth(workspaceRoot, manifest) {
  const issues = [];
  const checks = { total: 0, passed: 0, failed: 0, warnings: 0 };

  // Check 1: All member repos still exist
  for (const [name, member] of Object.entries(manifest.members)) {
    checks.total++;
    const memberPath = path.resolve(workspaceRoot, member.path || `./${name}`);
    if (!fs.existsSync(memberPath)) {
      issues.push({ severity: 'error', check: 'member-exists', message: `Member '${name}' path does not exist: ${path.relative(workspaceRoot, memberPath)}` });
      checks.failed++;
    } else {
      checks.passed++;
    }
  }

  // Check 2: All members have .workflow/
  for (const [name, member] of Object.entries(manifest.members)) {
    checks.total++;
    const workflowPath = path.join(path.resolve(workspaceRoot, member.path || `./${name}`), '.workflow');
    if (!fs.existsSync(workflowPath)) {
      issues.push({ severity: 'warning', check: 'workflow-exists', message: `Member '${name}' has no .workflow/ directory` });
      checks.warnings++;
    } else {
      checks.passed++;
    }
  }

  // Check 3: Manifest freshness
  checks.total++;
  const manifestPath = path.join(workspaceRoot, '.workspace', 'state', 'workspace-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const stat = fs.statSync(manifestPath);
    const ageHours = (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60);
    if (ageHours > 24) {
      issues.push({ severity: 'warning', check: 'manifest-fresh', message: `Manifest is ${Math.floor(ageHours)}h old — run 'flow workspace sync'` });
      checks.warnings++;
    } else {
      checks.passed++;
    }
  }

  // Check 4: Contract drift
  checks.total++;
  const drifts = detectContractDrift(workspaceRoot, manifest);
  if (drifts.length > 0) {
    const highDrifts = drifts.filter(d => d.severity === 'high');
    if (highDrifts.length > 0) {
      issues.push({ severity: 'error', check: 'contract-drift', message: `${highDrifts.length} high-severity contract drift(s) detected` });
      checks.failed++;
    } else {
      issues.push({ severity: 'warning', check: 'contract-drift', message: `${drifts.length} contract drift(s) detected` });
      checks.warnings++;
    }
  } else {
    checks.passed++;
  }

  // Check 5: Unread messages
  checks.total++;
  try {
    const { readMessages } = require('./workspace-messages');
    const pending = readMessages(workspaceRoot, { status: 'pending' });
    if (pending.length > 5) {
      issues.push({ severity: 'warning', check: 'pending-messages', message: `${pending.length} unread messages — review with 'show messages'` });
      checks.warnings++;
    } else {
      checks.passed++;
    }
  } catch (_err) {
    checks.passed++; // No messages module = no issue
  }

  // Check 6: Orphaned consumers
  checks.total++;
  const orphanedC = manifest.integrations?.orphanedConsumers?.length || 0;
  if (orphanedC > 0) {
    issues.push({ severity: 'warning', check: 'orphaned-consumers', message: `${orphanedC} consumer(s) calling endpoints with no provider` });
    checks.warnings++;
  } else {
    checks.passed++;
  }

  return {
    healthy: checks.failed === 0,
    checks,
    issues,
    summary: checks.failed > 0
      ? `Unhealthy: ${checks.failed} error(s), ${checks.warnings} warning(s)`
      : checks.warnings > 0
        ? `OK with ${checks.warnings} warning(s)`
        : 'All checks passed'
  };
}

// ============================================================
// S8: Cloud Preparation — Extension Points & Interfaces
// ============================================================

/**
 * Export workspace state in a format suitable for cloud dashboard consumption.
 * This is the interface contract between OSS and cloud.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @returns {Object} dashboard-ready workspace state
 */
function exportForDashboard(workspaceRoot, manifest) {
  const { readMessages } = require('./workspace-messages');

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    workspace: {
      name: manifest.workspace,
      memberCount: Object.keys(manifest.members).length,
      members: Object.entries(manifest.members).map(([name, m]) => ({
        name,
        role: m.role,
        stack: m.stack,
        endpointsProvided: (m.provides || []).length,
        endpointsConsumed: (m.consumes || []).length
      }))
    },
    integrations: {
      matchedCount: manifest.integrations?.matched?.length || 0,
      orphanedConsumers: manifest.integrations?.orphanedConsumers?.length || 0,
      orphanedProviders: manifest.integrations?.orphanedProviders?.length || 0,
      typeDrifts: manifest.integrations?.typeDrift?.length || 0,
      contractDrifts: detectContractDrift(workspaceRoot, manifest).length
    },
    messages: (() => {
      const allMessages = readMessages(workspaceRoot);
      return {
        total: allMessages.length,
        pending: allMessages.filter(m => m.status === 'pending').length
      };
    })(),
    health: checkWorkspaceHealth(workspaceRoot, manifest)
  };
}

/**
 * Message bus abstraction — provides the interface that cloud can swap for HTTP/WebSocket.
 * OSS uses file-based transport. Cloud overrides with network transport.
 *
 * @returns {Object} transport interface
 */
function getMessageTransport() {
  return {
    type: 'file',
    send: (workspaceRoot, message) => {
      const { saveMessage } = require('./workspace-messages');
      return saveMessage(workspaceRoot, message);
    },
    receive: (workspaceRoot, filter) => {
      const { readMessages } = require('./workspace-messages');
      return readMessages(workspaceRoot, filter);
    },
    acknowledge: (workspaceRoot, messageId) => {
      const { updateMessageStatus } = require('./workspace-messages');
      return updateMessageStatus(workspaceRoot, messageId, 'acknowledged');
    }
  };
}

/**
 * Multi-user data model schema — defines the structure for when cloud adds
 * multi-user support. No implementation — just the interface contract.
 *
 * @returns {Object} schema definition
 */
function getMultiUserSchema() {
  return {
    workspace: {
      id: 'string (UUID)',
      name: 'string',
      createdBy: 'string (userId)',
      members: 'WorkspaceMember[]',
      teamId: 'string (from wogiflow-cloud)',
      createdAt: 'ISO 8601',
      updatedAt: 'ISO 8601'
    },
    workspaceMember: {
      userId: 'string',
      role: 'owner | admin | member | viewer',
      repos: 'string[] (which repos they can access)',
      lastActiveAt: 'ISO 8601'
    },
    agentSession: {
      id: 'string (UUID)',
      workspaceId: 'string',
      userId: 'string',
      repoName: 'string',
      status: 'active | idle | disconnected',
      startedAt: 'ISO 8601',
      lastHeartbeat: 'ISO 8601'
    }
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // S5: Cross-Repo Intelligence
  detectContractDrift,
  routeBlame,
  getSharedDecisions,
  addSharedDecision,

  // S7: N-Repo Scaling
  buildDependencyGraph,
  getLibraryConsumers,
  getCascadeTargets,
  checkWorkspaceHealth,

  // S8: Cloud Preparation
  exportForDashboard,
  getMessageTransport,
  getMultiUserSchema
};
