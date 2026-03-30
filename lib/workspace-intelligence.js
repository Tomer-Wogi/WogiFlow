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
// S5: Decision Propagation (Active Broadcast)
// ============================================================

/**
 * Add a shared decision AND broadcast it to all workspace members.
 * Extends addSharedDecision with active notification.
 *
 * @param {string} workspaceRoot
 * @param {string} fromRepo — repo that created the decision
 * @param {string} title
 * @param {string} content
 * @param {Object} manifest — workspace manifest for member discovery
 * @returns {{ saved: boolean, broadcastCount: number }}
 */
function propagateDecision(workspaceRoot, fromRepo, title, content, manifest) {
  // 1. Save the decision
  addSharedDecision(workspaceRoot, title, content);

  // 2. Broadcast to all members
  let broadcastCount = 0;
  if (manifest && manifest.members) {
    const { broadcastDecision, saveMessage } = require('./workspace-messages');
    const targetRepos = Object.keys(manifest.members).filter(n => n !== fromRepo);
    const messages = broadcastDecision(fromRepo, title, content, targetRepos);

    for (const msg of messages) {
      try {
        saveMessage(workspaceRoot, msg);
        broadcastCount++;
      } catch (_err) {
        // Best effort
      }
    }
  }

  return { saved: true, broadcastCount };
}

/**
 * Check if there are new shared decisions since a given timestamp.
 * Used by session-start hooks to inject new decisions into worker context.
 *
 * @param {string} workspaceRoot
 * @param {string} sinceDate — ISO date string
 * @returns {Array<{ title: string, content: string, date: string }>}
 */
function getNewDecisionsSince(workspaceRoot, sinceDate) {
  const decisions = getSharedDecisions(workspaceRoot);
  if (!decisions) return [];

  const sinceTime = new Date(sinceDate).getTime();
  const results = [];

  // Parse decisions.md for entries with *Added: YYYY-MM-DD* markers
  const sections = decisions.split(/^### /m).filter(Boolean);
  for (const section of sections) {
    const lines = section.trim().split('\n');
    const title = lines[0]?.trim() || '';
    const dateMatch = section.match(/\*Added:\s*(\d{4}-\d{2}-\d{2})\*/);
    if (dateMatch) {
      const entryDate = new Date(dateMatch[1]).getTime();
      if (entryDate > sinceTime) {
        results.push({
          title,
          content: lines.slice(1).join('\n').replace(/\*Added:.*\*/, '').trim(),
          date: dateMatch[1]
        });
      }
    }
  }

  return results;
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

// ============================================================
// Workspace Review Mode (Cross-Repo Contract Impact)
// ============================================================

/**
 * Analyze code review findings for cross-repo impact.
 * Called during /wogi-review when workspace is active.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @param {string[]} changedFiles — files changed in the review
 * @param {string} repoName — repo being reviewed
 * @returns {Object} review impact analysis
 */
function analyzeReviewForCrossRepoImpact(workspaceRoot, manifest, changedFiles, repoName) {
  const result = {
    hasContractImpact: false,
    endpointChanges: [],
    missingContractUpdates: [],
    affectedConsumers: [],
    recommendations: []
  };

  const member = manifest.members?.[repoName];
  if (!member) return result;

  // Check if any changed files are in API/route directories
  const apiPatterns = ['route', 'controller', 'endpoint', 'api', 'handler'];
  const changedApiFiles = changedFiles.filter(f => {
    const lower = f.toLowerCase();
    return apiPatterns.some(p => lower.includes(p));
  });

  if (changedApiFiles.length > 0) {
    result.hasContractImpact = true;
    result.endpointChanges = changedApiFiles;

    // Check if contract was also updated
    const contractsDir = path.join(workspaceRoot, '.workspace', 'contracts');
    const contractFiles = changedFiles.filter(f => f.includes('.workspace/contracts'));

    if (contractFiles.length === 0 && changedApiFiles.length > 0) {
      result.missingContractUpdates.push(
        `API files changed (${changedApiFiles.join(', ')}) but no contract was updated. ` +
        `Run \`flow workspace sync\` and regenerate contracts.`
      );
    }

    // Find affected consumers
    const { buildIntegrationMap } = require('./workspace-contracts');
    const integrationMap = buildIntegrationMap(manifest);
    const consumerSet = new Set();

    for (const matched of integrationMap.matched || []) {
      if ((matched.providers || []).includes(repoName)) {
        for (const consumer of matched.consumers || []) {
          consumerSet.add(consumer);
        }
      }
    }

    result.affectedConsumers = [...consumerSet];

    if (result.affectedConsumers.length > 0) {
      result.recommendations.push(
        `Notify consumers: ${result.affectedConsumers.join(', ')}`,
        'Update shared contracts if endpoint signatures changed',
        'Consider creating verification tasks in consumer repos'
      );
    }
  }

  return result;
}

// ============================================================
// Workspace Morning Briefing
// ============================================================

/**
 * Generate a workspace-aware morning briefing.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @param {string} [repoName] — current repo (for filtering)
 * @returns {Object} briefing data
 */
function generateWorkspaceBriefing(workspaceRoot, manifest, repoName) {
  const briefing = {
    unreadMessages: [],
    contractChanges: [],
    blockedTasks: [],
    healthIssues: [],
    activeLocks: [],
    recentEvents: [],
    summary: ''
  };

  // 1. Unread messages
  try {
    const { getUnreadMessages } = require('./workspace-messages');
    briefing.unreadMessages = getUnreadMessages(workspaceRoot, repoName || 'all');
  } catch (_err) {
    // Non-critical
  }

  // 2. Contract changes (drift detection)
  try {
    briefing.contractChanges = detectContractDrift(workspaceRoot, manifest);
  } catch (_err) {
    // Non-critical
  }

  // 3. Blocked tasks
  try {
    const { updateCrossRepoBlocking } = require('./workspace-routing');
    const blocking = updateCrossRepoBlocking(workspaceRoot, manifest);
    briefing.blockedTasks = blocking.blockedTasks;
  } catch (_err) {
    // Non-critical
  }

  // 4. Health issues
  try {
    const health = checkWorkspaceHealth(workspaceRoot, manifest);
    briefing.healthIssues = health.issues || [];
  } catch (_err) {
    // Non-critical
  }

  // 5. Active locks
  try {
    const { listActiveLocks } = require('./workspace-locks');
    briefing.activeLocks = listActiveLocks(workspaceRoot);
  } catch (_err) {
    // Non-critical
  }

  // 6. Recent events (last 24h)
  try {
    const { readEvents } = require('./workspace-events');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    briefing.recentEvents = readEvents(workspaceRoot, { since: yesterday, limit: 20 });
  } catch (_err) {
    // Non-critical
  }

  // 7. Summary
  const parts = [];
  if (briefing.unreadMessages.length > 0) parts.push(`${briefing.unreadMessages.length} unread message(s)`);
  if (briefing.contractChanges.length > 0) parts.push(`${briefing.contractChanges.length} contract drift(s)`);
  if (briefing.blockedTasks.length > 0) parts.push(`${briefing.blockedTasks.length} blocked task(s)`);
  if (briefing.healthIssues.length > 0) parts.push(`${briefing.healthIssues.length} health issue(s)`);
  if (briefing.activeLocks.length > 0) parts.push(`${briefing.activeLocks.length} active lock(s)`);
  briefing.summary = parts.length > 0 ? parts.join(', ') : 'All clear';

  return briefing;
}

/**
 * Format workspace briefing as readable text.
 *
 * @param {Object} briefing — from generateWorkspaceBriefing()
 * @returns {string}
 */
function formatWorkspaceBriefing(briefing) {
  const lines = ['Workspace Briefing', '━'.repeat(40), ''];

  if (briefing.unreadMessages.length > 0) {
    lines.push(`Messages (${briefing.unreadMessages.length} unread):`);
    for (const msg of briefing.unreadMessages.slice(0, 5)) {
      lines.push(`  ${msg.from}: ${msg.subject}`);
    }
    lines.push('');
  }

  if (briefing.contractChanges.length > 0) {
    lines.push(`Contract Drifts (${briefing.contractChanges.length}):`);
    for (const drift of briefing.contractChanges.slice(0, 5)) {
      lines.push(`  ${drift.severity}: ${drift.endpoint || drift.type}`);
    }
    lines.push('');
  }

  if (briefing.blockedTasks.length > 0) {
    lines.push(`Blocked Tasks (${briefing.blockedTasks.length}):`);
    for (const bt of briefing.blockedTasks.slice(0, 5)) {
      lines.push(`  ${bt.repo}: ${bt.task.title} [blocked by: ${bt.blockedBy?.join(', ')}]`);
    }
    lines.push('');
  }

  if (briefing.activeLocks.length > 0) {
    lines.push(`Active Locks (${briefing.activeLocks.length}):`);
    try {
      const { formatLocksForDisplay } = require('./workspace-locks');
      lines.push(formatLocksForDisplay(briefing.activeLocks));
    } catch (_err) {
      for (const lock of briefing.activeLocks) {
        lines.push(`  ${lock.interface} — held by ${lock.owner}`);
      }
    }
    lines.push('');
  }

  if (briefing.healthIssues.length > 0) {
    lines.push(`Health Issues (${briefing.healthIssues.length}):`);
    for (const issue of briefing.healthIssues.slice(0, 5)) {
      lines.push(`  ${issue.severity || 'warning'}: ${issue.message || issue}`);
    }
    lines.push('');
  }

  lines.push(`Summary: ${briefing.summary}`);

  return lines.join('\n');
}

// ============================================================
// Workspace Audit Dimension
// ============================================================

/**
 * Run workspace-specific audit checks.
 * Returns findings for the workspace dimension of /wogi-audit.
 *
 * @param {string} workspaceRoot
 * @param {Object} manifest
 * @returns {Object} audit results
 */
function auditWorkspaceDimension(workspaceRoot, manifest) {
  const audit = {
    dimension: 'workspace',
    score: 100,
    findings: [],
    metrics: {}
  };

  if (!manifest || !manifest.members) {
    audit.score = 0;
    audit.findings.push({ severity: 'error', message: 'No workspace manifest found' });
    return audit;
  }

  const memberCount = Object.keys(manifest.members).length;
  audit.metrics.memberCount = memberCount;

  // 1. Type consistency — check for type drift
  try {
    const memberMetadata = {};
    const configPath = path.join(workspaceRoot, 'wogi-workspace.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    for (const [name, memberConfig] of Object.entries(config.members || {})) {
      const memberPath = path.resolve(workspaceRoot, memberConfig.path);
      const workflowPath = path.join(memberPath, '.workflow');
      if (fs.existsSync(workflowPath)) {
        const { readMemberMetadata } = require('./workspace');
        memberMetadata[name] = readMemberMetadata(workflowPath);
      }
    }

    const { detectTypeDrift } = require('./workspace-contracts');
    const drifts = detectTypeDrift(manifest, memberMetadata);
    audit.metrics.typeDrifts = drifts.length;

    if (drifts.length > 0) {
      audit.score -= drifts.length * 5;
      audit.findings.push({
        severity: 'high',
        message: `${drifts.length} type drift(s) detected across repos`,
        details: drifts.map(d => `${d.type}: ${d.entries?.length || 0} conflicting definitions`)
      });
    }
  } catch (_err) {
    // Non-critical
  }

  // 2. Contract coverage — what % of integrations have contracts
  try {
    const { buildIntegrationMap } = require('./workspace-contracts');
    const map = buildIntegrationMap(manifest);
    const totalIntegrations = (map.matched || []).length;
    const contractsDir = path.join(workspaceRoot, '.workspace', 'contracts');
    const contractCount = fs.existsSync(contractsDir)
      ? fs.readdirSync(contractsDir).filter(f => !f.startsWith('.')).length
      : 0;

    audit.metrics.totalIntegrations = totalIntegrations;
    audit.metrics.contractCount = contractCount;
    audit.metrics.contractCoverage = totalIntegrations > 0
      ? Math.round((contractCount / totalIntegrations) * 100)
      : 100;

    if (audit.metrics.contractCoverage < 50) {
      audit.score -= 15;
      audit.findings.push({
        severity: 'high',
        message: `Contract coverage is ${audit.metrics.contractCoverage}% (${contractCount}/${totalIntegrations})`
      });
    } else if (audit.metrics.contractCoverage < 80) {
      audit.score -= 5;
      audit.findings.push({
        severity: 'medium',
        message: `Contract coverage is ${audit.metrics.contractCoverage}% — consider adding contracts for uncovered integrations`
      });
    }

    // Orphaned endpoints
    audit.metrics.orphanedConsumers = (map.orphanedConsumers || []).length;
    audit.metrics.orphanedProviders = (map.orphanedProviders || []).length;

    if (audit.metrics.orphanedConsumers > 0) {
      audit.score -= audit.metrics.orphanedConsumers * 3;
      audit.findings.push({
        severity: 'high',
        message: `${audit.metrics.orphanedConsumers} consumer(s) calling endpoints with no provider`
      });
    }
  } catch (_err) {
    // Non-critical
  }

  // 3. Communication health — message acknowledgment rate
  try {
    const { readMessages } = require('./workspace-messages');
    const allMessages = readMessages(workspaceRoot);
    const actionRequired = allMessages.filter(m => m.actionRequired);
    const acknowledged = actionRequired.filter(m => m.status !== 'pending');

    audit.metrics.totalMessages = allMessages.length;
    audit.metrics.pendingActionRequired = actionRequired.filter(m => m.status === 'pending').length;
    audit.metrics.acknowledgmentRate = actionRequired.length > 0
      ? Math.round((acknowledged.length / actionRequired.length) * 100)
      : 100;

    if (audit.metrics.pendingActionRequired > 5) {
      audit.score -= 10;
      audit.findings.push({
        severity: 'medium',
        message: `${audit.metrics.pendingActionRequired} action-required message(s) still pending`
      });
    }
  } catch (_err) {
    // Non-critical
  }

  // 4. Dependency freshness — is the manifest up to date?
  try {
    const manifestPath = path.join(workspaceRoot, '.workspace', 'state', 'workspace-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const stat = fs.statSync(manifestPath);
      const ageHours = (Date.now() - stat.mtime.getTime()) / (60 * 60 * 1000);
      audit.metrics.manifestAgeHours = Math.round(ageHours);

      if (ageHours > 48) {
        audit.score -= 10;
        audit.findings.push({
          severity: 'medium',
          message: `Workspace manifest is ${Math.round(ageHours)}h old — run \`flow workspace sync\``
        });
      }
    }
  } catch (_err) {
    // Non-critical
  }

  // 5. Contract drift
  try {
    const contractDrifts = detectContractDrift(workspaceRoot, manifest);
    audit.metrics.contractDrifts = contractDrifts.length;

    if (contractDrifts.length > 0) {
      const highSeverity = contractDrifts.filter(d => d.severity === 'high');
      if (highSeverity.length > 0) {
        audit.score -= highSeverity.length * 10;
        audit.findings.push({
          severity: 'critical',
          message: `${highSeverity.length} high-severity contract drift(s) — implementation doesn't match spec`
        });
      }
    }
  } catch (_err) {
    // Non-critical
  }

  // Clamp score
  audit.score = Math.max(0, Math.min(100, audit.score));

  return audit;
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

  // Decision propagation (active broadcast)
  propagateDecision,
  getNewDecisionsSince,

  // S7: N-Repo Scaling
  buildDependencyGraph,
  getLibraryConsumers,
  getCascadeTargets,
  checkWorkspaceHealth,

  // S8: Cloud Preparation
  exportForDashboard,
  getMessageTransport,
  getMultiUserSchema,

  // Review mode
  analyzeReviewForCrossRepoImpact,

  // Morning briefing
  generateWorkspaceBriefing,
  formatWorkspaceBriefing,

  // Audit dimension
  auditWorkspaceDimension
};
