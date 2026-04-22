#!/usr/bin/env node

/**
 * Wogi Workspace — Conditional Gate Injection & Cross-Repo Awareness
 *
 * The backbone for workspace-aware development. Detects when workspace mode
 * is active and provides:
 *   - workspaceActive() — detect if current cwd is inside a workspace
 *   - loadWorkspaceContext() — load manifest, config, integration map
 *   - analyzeTaskImpact() — check if a task touches cross-repo surfaces
 *   - getWorkspaceQualityGates() — return conditional gates for workspace mode
 *   - broadcastPostChange() — notify peers after task completion
 *   - runWorkspaceGate() — execute individual workspace quality gates
 *
 * All workspace features are conditional: zero overhead for single-repo projects.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');

const { WORKSPACE_CONFIG_FILE, WORKSPACE_DIR } = require('./workspace');
const { buildIntegrationMap } = require('./workspace-contracts');
const { detectContractDrift, getCascadeTargets, buildDependencyGraph } = require('./workspace-intelligence');
const { createMessage, saveMessage, getUnreadMessages } = require('./workspace-messages');

// ============================================================
// Constants
// ============================================================

/**
 * Workspace quality gates — injected into flow-done when workspace is active.
 * Each gate has: name, description, phase (pre|post), severity (error|warning).
 */
const WORKSPACE_GATES = [
  {
    name: 'crossRepoImpactCheck',
    description: 'Verify cross-repo impact was assessed before implementation',
    phase: 'pre',
    severity: 'error'
  },
  {
    name: 'contractCompliance',
    description: 'Verify changes comply with declared contracts',
    phase: 'post',
    severity: 'error'
  },
  {
    name: 'peerNotification',
    description: 'Notify affected peers of changes made',
    phase: 'post',
    severity: 'warning'
  },
  {
    name: 'cascadeVerification',
    description: 'Verify library changes notified all consumers',
    phase: 'post',
    severity: 'error'
  },
  {
    name: 'integrationMapFreshness',
    description: 'Verify integration map is up-to-date',
    phase: 'pre',
    severity: 'warning'
  },
  {
    name: 'deploymentReadiness',
    description: 'Verify changes are committed and pushed before handoff to downstream workers',
    phase: 'post',
    severity: 'error'
  },
  {
    name: 'crossRepoEnumVerification',
    description: 'Verify type/enum mappings between repos by grepping BOTH repos for actual values',
    phase: 'pre',
    severity: 'error'
  },
  {
    name: 'dispatchVerification',
    description: 'Verify dispatch claims have corresponding tool calls — prevents narrate-without-execute',
    phase: 'post',
    severity: 'error'
  }
];

/** Max age for integration map before staleness warning (24 hours). */
const MAP_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** Keywords indicating cross-repo surface area. */
const CROSS_REPO_SURFACE_KEYWORDS = [
  'endpoint', 'api', 'route', 'contract', 'schema', 'type',
  'interface', 'dto', 'model', 'event', 'message', 'webhook',
  'shared', 'common', 'library', 'package'
];

// ============================================================
// Workspace Detection
// ============================================================

/**
 * Check if workspace mode is active for the given directory.
 * Walks up the directory tree looking for wogi-workspace.json.
 *
 * @param {string} [cwd] — directory to check (default: process.cwd())
 * @returns {{ active: boolean, root: string|null, configPath: string|null }}
 */
function workspaceActive(cwd) {
  const startDir = cwd || process.cwd();
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  // Walk up at most 5 levels to find workspace root
  for (let i = 0; i < 5; i++) {
    const configPath = path.join(dir, WORKSPACE_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      return { active: true, root: dir, configPath };
    }
    const parent = path.dirname(dir);
    if (parent === dir || parent === root) break;
    dir = parent;
  }

  // Also check env variable (set by channel server)
  // Validate that env root is an ancestor of cwd to prevent path injection
  const envRoot = process.env.WOGI_WORKSPACE_ROOT;
  if (envRoot) {
    const resolvedEnv = path.resolve(envRoot);
    const resolvedStart = path.resolve(startDir);
    if (resolvedStart.startsWith(resolvedEnv + path.sep) || resolvedStart === resolvedEnv) {
      const envConfig = path.join(resolvedEnv, WORKSPACE_CONFIG_FILE);
      if (fs.existsSync(envConfig)) {
        return { active: true, root: resolvedEnv, configPath: envConfig };
      }
    }
  }

  return { active: false, root: null, configPath: null };
}

/**
 * Determine which member repo the current directory belongs to.
 *
 * @param {string} workspaceRoot
 * @param {string} [cwd]
 * @returns {{ name: string, role: string, path: string }|null}
 */
function identifyCurrentMember(workspaceRoot, cwd) {
  const currentDir = path.resolve(cwd || process.cwd());
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);

  try {
    const config = safeReadJson(configPath);
    for (const [name, memberConfig] of Object.entries(config.members || {})) {
      const memberPath = path.resolve(workspaceRoot, memberConfig.path);
      if (currentDir === memberPath || currentDir.startsWith(memberPath + path.sep)) {
        return { name, role: memberConfig.role, path: memberPath };
      }
    }
  } catch (_err) {
    // Config read failure
  }

  return null;
}

// ============================================================
// Context Loading
// ============================================================

/**
 * Load the full workspace context needed for gate evaluation.
 *
 * @param {string} workspaceRoot
 * @returns {Object} workspace context
 */
function loadWorkspaceContext(workspaceRoot) {
  const context = {
    config: null,
    manifest: null,
    integrationMap: null,
    currentMember: null,
    unreadMessages: [],
    health: null
  };

  // Load config
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  try {
    context.config = safeReadJson(configPath);
  } catch (_err) {
    return context;
  }

  // Load manifest
  const manifestPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'workspace-manifest.json');
  try {
    if (fs.existsSync(manifestPath)) {
      context.manifest = safeReadJson(manifestPath);
    }
  } catch (_err) {
    // Non-critical
  }

  // Build integration map from manifest
  if (context.manifest) {
    try {
      context.integrationMap = buildIntegrationMap(context.manifest);
    } catch (_err) {
      // Non-critical
    }
  }

  // Identify current member
  context.currentMember = identifyCurrentMember(workspaceRoot);

  // Load unread messages for current member
  if (context.currentMember) {
    try {
      context.unreadMessages = getUnreadMessages(workspaceRoot, context.currentMember.name);
    } catch (_err) {
      context.unreadMessages = [];
    }
  }

  return context;
}

// ============================================================
// Task Impact Analysis
// ============================================================

/**
 * Analyze whether a task description touches cross-repo surfaces.
 * Used by the pre-dev impact gate to determine if peers need to be notified.
 *
 * @param {string} taskDescription — task title + criteria text
 * @param {Object} context — from loadWorkspaceContext()
 * @returns {Object} impact analysis
 */
function analyzeTaskImpact(taskDescription, context) {
  const result = {
    hasCrossRepoImpact: false,
    affectedPeers: [],
    affectedEndpoints: [],
    affectedTypes: [],
    surfaceKeywords: [],
    recommendation: 'none' // 'none' | 'heads-up' | 'query-peers' | 'block-until-ack'
  };

  if (!context.manifest || !context.currentMember) return result;

  const descLower = taskDescription.toLowerCase();

  // 1. Check for cross-repo surface keywords
  for (const kw of CROSS_REPO_SURFACE_KEYWORDS) {
    if (descLower.includes(kw)) {
      result.surfaceKeywords.push(kw);
    }
  }

  // 2. Check for endpoint mentions against integration map
  if (context.integrationMap) {
    for (const match of context.integrationMap.matched || []) {
      // Check if the task mentions this endpoint
      const epLower = match.endpoint.toLowerCase();
      const pathSegments = epLower.split('/').filter(s => s && s !== 'api' && s !== 'v1');
      for (const seg of pathSegments) {
        if (seg.startsWith(':') || seg.startsWith('{')) continue;
        if (descLower.includes(seg)) {
          result.affectedEndpoints.push(match);
          // Find peers that consume/provide this endpoint
          const peers = [...(match.providers || []), ...(match.consumers || [])]
            .filter(p => p !== context.currentMember.name);
          for (const peer of peers) {
            if (!result.affectedPeers.includes(peer)) {
              result.affectedPeers.push(peer);
            }
          }
          break;
        }
      }
    }
  }

  // 3. Check for type/schema mentions
  if (context.manifest.members) {
    const currentSchemas = context.manifest.members[context.currentMember.name]?.schemas || [];
    for (const schema of currentSchemas) {
      const schemaName = (schema.name || schema).toLowerCase();
      if (descLower.includes(schemaName)) {
        result.affectedTypes.push(schema);
        // Types affect all repos that share this type
        for (const [name, member] of Object.entries(context.manifest.members)) {
          if (name === context.currentMember.name) continue;
          const memberSchemas = (member.schemas || []).map(s => (s.name || s).toLowerCase());
          if (memberSchemas.includes(schemaName)) {
            if (!result.affectedPeers.includes(name)) {
              result.affectedPeers.push(name);
            }
          }
        }
      }
    }
  }

  // 4. Library role = always affects consumers
  if (context.currentMember.role === 'library') {
    const graph = buildDependencyGraph(context.manifest);
    const cascadeTargets = getCascadeTargets(context.currentMember.name, context.manifest, graph);
    for (const target of cascadeTargets) {
      if (!result.affectedPeers.includes(target)) {
        result.affectedPeers.push(target);
      }
    }
  }

  // 5. Determine impact level
  result.hasCrossRepoImpact = result.affectedPeers.length > 0 || result.surfaceKeywords.length >= 2;

  if (result.affectedEndpoints.length > 0 || result.affectedTypes.length > 0) {
    result.recommendation = 'query-peers';
  } else if (result.surfaceKeywords.length >= 2) {
    result.recommendation = 'heads-up';
  } else if (result.affectedPeers.length > 0) {
    result.recommendation = 'heads-up';
  }

  return result;
}

/**
 * Broadcast a pre-dev heads-up message to affected peers.
 *
 * @param {string} workspaceRoot
 * @param {string} fromRepo — current repo name
 * @param {Object} impact — from analyzeTaskImpact()
 * @param {string} taskTitle
 * @returns {Array<string>} message IDs created
 */
function broadcastHeadsUp(workspaceRoot, fromRepo, impact, taskTitle) {
  const messageIds = [];

  for (const peer of impact.affectedPeers) {
    const endpointList = impact.affectedEndpoints.map(e => e.endpoint).join(', ');
    const typeList = impact.affectedTypes.map(t => t.name || t).join(', ');

    let body = `I'm about to work on: "${taskTitle}"\n\n`;
    if (endpointList) body += `Affected endpoints: ${endpointList}\n`;
    if (typeList) body += `Affected types: ${typeList}\n`;
    body += `\nDoes this affect your side? Any concerns or things I should be aware of?`;

    const msg = createMessage({
      from: fromRepo,
      to: peer,
      type: 'heads-up',
      subject: `Pre-dev notice: ${taskTitle.substring(0, 60)}`,
      body,
      priority: impact.recommendation === 'query-peers' ? 'high' : 'medium',
      actionRequired: impact.recommendation === 'query-peers'
    });

    try {
      saveMessage(workspaceRoot, msg);
      messageIds.push(msg.id);
    } catch (_err) {
      // Best effort
    }
  }

  return messageIds;
}

// ============================================================
// Post-Change Broadcast
// ============================================================

/**
 * After task completion, detect changes and notify affected peers.
 *
 * @param {string} workspaceRoot
 * @param {string} fromRepo — repo that completed the task
 * @param {Object} context — from loadWorkspaceContext()
 * @param {Object} [options] — { changedFiles: string[], taskTitle: string }
 * @returns {Object} broadcast result
 */
function broadcastPostChange(workspaceRoot, fromRepo, context, options = {}) {
  const result = {
    driftsDetected: [],
    messagesCreated: [],
    verificationTasksCreated: []
  };

  if (!context.manifest) return result;

  // 1. Detect contract drift
  try {
    const drifts = detectContractDrift(workspaceRoot, context.manifest);
    result.driftsDetected = drifts;
  } catch (_err) {
    // Non-critical
  }

  // 2. Check which endpoints/types changed by analyzing changed files
  const { changedFiles = [], taskTitle = 'Unknown task' } = options;

  // 3. Find affected repos via cascade analysis
  const graph = buildDependencyGraph(context.manifest);
  const cascadeTargets = getCascadeTargets(fromRepo, context.manifest, graph);

  // 4. Send contract-change notifications
  for (const target of cascadeTargets) {
    const msg = createMessage({
      from: fromRepo,
      to: target,
      type: 'contract-change',
      subject: `Post-change notice: ${taskTitle.substring(0, 60)}`,
      body: `Repo "${fromRepo}" completed: "${taskTitle}"\n\n` +
        (changedFiles.length > 0 ? `Changed files:\n${changedFiles.map(f => `  - ${f}`).join('\n')}\n\n` : '') +
        (result.driftsDetected.length > 0 ? `Contract drifts detected: ${result.driftsDetected.length}\n` : '') +
        `Please verify your integrations still work correctly.`,
      priority: result.driftsDetected.length > 0 ? 'critical' : 'high',
      actionRequired: true,
      suggestedTask: {
        title: `Verify integrations after ${fromRepo} changes — ${taskTitle.substring(0, 40)}`,
        type: 'fix',
        priority: result.driftsDetected.length > 0 ? 'P0' : 'P1'
      }
    });

    try {
      saveMessage(workspaceRoot, msg);
      result.messagesCreated.push(msg.id);
    } catch (_err) {
      // Best effort
    }
  }

  return result;
}

// ============================================================
// Quality Gate Runners
// ============================================================

/**
 * Run a specific workspace quality gate.
 *
 * @param {string} gateName — one of WORKSPACE_GATES[].name
 * @param {string} workspaceRoot
 * @param {Object} context — from loadWorkspaceContext()
 * @param {Object} [taskMeta] — { taskId, taskTitle, changedFiles, impactAssessed }
 * @returns {{ passed: boolean, message: string, severity: string }}
 */
/**
 * Deployment readiness gate — verifies changes are committed and pushed
 * before allowing handoff to downstream workers.
 *
 * In workspace mode, when backend completes and frontend needs to start,
 * the backend's changes MUST be committed and pushed first. Otherwise the
 * frontend worker will build against stale code.
 *
 * Checks:
 * 1. No uncommitted changes in the current repo (git status clean)
 * 2. Local branch is not ahead of remote (changes are pushed)
 *
 * @param {string} workspaceRoot
 * @param {Object} context
 * @param {Object} taskMeta
 * @returns {{ passed: boolean, message: string, severity: string }}
 */
function gateDeploymentReadiness(workspaceRoot, _context, _taskMeta) {
  const { execFileSync } = require('node:child_process');

  try {
    // Check 1: No uncommitted changes
    const statusOutput = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: workspaceRoot || process.cwd()
    }).trim();

    if (statusOutput) {
      const lineCount = statusOutput.split('\n').filter(Boolean).length;
      return {
        passed: false,
        message: `${lineCount} uncommitted change(s). Commit and push before handoff to downstream workers.`,
        severity: 'error'
      };
    }

    // Check 2: Not ahead of remote (changes pushed)
    try {
      const aheadOutput = execFileSync('git', ['rev-list', '--count', '@{upstream}..HEAD'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workspaceRoot || process.cwd()
      }).trim();

      const aheadCount = parseInt(aheadOutput, 10);
      if (aheadCount > 0) {
        return {
          passed: false,
          message: `${aheadCount} commit(s) not pushed to remote. Push before handoff to downstream workers.`,
          severity: 'error'
        };
      }
    } catch (_err) {
      // No upstream configured — skip push check but warn
      return {
        passed: true,
        message: 'No upstream branch configured — push check skipped',
        severity: 'warning'
      };
    }

    return {
      passed: true,
      message: 'Changes committed and pushed — ready for downstream handoff',
      severity: 'info'
    };
  } catch (err) {
    return {
      passed: true,
      message: `Deployment readiness check failed (${err.message}) — degraded to manual`,
      severity: 'warning'
    };
  }
}

function runWorkspaceGate(gateName, workspaceRoot, context, taskMeta = {}) {
  switch (gateName) {
    case 'crossRepoImpactCheck':
      return gateCrossRepoImpactCheck(context, taskMeta);

    case 'contractCompliance':
      return gateContractCompliance(workspaceRoot, context);

    case 'peerNotification':
      return gatePeerNotification(workspaceRoot, context, taskMeta);

    case 'cascadeVerification':
      return gateCascadeVerification(workspaceRoot, context, taskMeta);

    case 'integrationMapFreshness':
      return gateIntegrationMapFreshness(workspaceRoot);

    case 'deploymentReadiness':
      return gateDeploymentReadiness(workspaceRoot, context, taskMeta);

    case 'crossRepoEnumVerification':
      return gateCrossRepoEnumVerification(workspaceRoot, context, taskMeta);

    case 'dispatchVerification':
      return gateDispatchVerification(context, taskMeta);

    default:
      return { passed: true, message: `Unknown gate: ${gateName}`, severity: 'warning' };
  }
}

/**
 * Gate: crossRepoImpactCheck
 * Verify that cross-repo impact was assessed before implementation.
 */
function gateCrossRepoImpactCheck(context, taskMeta) {
  const gate = WORKSPACE_GATES.find(g => g.name === 'crossRepoImpactCheck');

  if (taskMeta.impactAssessed) {
    return { passed: true, message: 'Cross-repo impact was assessed', severity: gate.severity };
  }

  // If no impact analysis was done, check if the task even needs one
  if (!context.currentMember) {
    return { passed: true, message: 'Not in a workspace member repo', severity: gate.severity };
  }

  const impact = analyzeTaskImpact(taskMeta.taskTitle || '', context);
  if (!impact.hasCrossRepoImpact) {
    return { passed: true, message: 'No cross-repo impact detected', severity: gate.severity };
  }

  return {
    passed: false,
    message: `Cross-repo impact detected (${impact.affectedPeers.join(', ')}) but not assessed. Run impact analysis before implementation.`,
    severity: gate.severity
  };
}

/**
 * Gate: contractCompliance
 * Verify changes comply with declared contracts.
 */
function gateContractCompliance(workspaceRoot, context) {
  const gate = WORKSPACE_GATES.find(g => g.name === 'contractCompliance');

  if (!context.manifest) {
    return { passed: true, message: 'No manifest available', severity: gate.severity };
  }

  try {
    const drifts = detectContractDrift(workspaceRoot, context.manifest);
    const highSeverity = drifts.filter(d => d.severity === 'high');

    if (highSeverity.length > 0) {
      return {
        passed: false,
        message: `${highSeverity.length} contract compliance issue(s): ${highSeverity.map(d => d.endpoint || d.type).join(', ')}`,
        severity: gate.severity
      };
    }

    return { passed: true, message: `Contract compliance OK (${drifts.length} info-level items)`, severity: gate.severity };
  } catch (_err) {
    return { passed: true, message: 'Contract check skipped (error reading contracts)', severity: 'warning' };
  }
}

/**
 * Gate: peerNotification
 * Verify affected peers were notified of changes.
 */
function gatePeerNotification(workspaceRoot, context, taskMeta) {
  const gate = WORKSPACE_GATES.find(g => g.name === 'peerNotification');

  if (!context.currentMember || !context.manifest) {
    return { passed: true, message: 'Not in workspace context', severity: gate.severity };
  }

  // Check if the task had cross-repo impact
  const impact = analyzeTaskImpact(taskMeta.taskTitle || '', context);
  if (!impact.hasCrossRepoImpact) {
    return { passed: true, message: 'No peers to notify', severity: gate.severity };
  }

  // Check if notifications were sent (look for recent messages from this repo)
  try {
    const { readMessages } = require('./workspace-messages');
    const recentMessages = readMessages(workspaceRoot, {
      from: context.currentMember.name,
      type: 'contract-change'
    });

    // Check if there's a recent notification (within last hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentNotifications = recentMessages.filter(
      m => new Date(m.timestamp).getTime() > oneHourAgo
    );

    if (recentNotifications.length > 0) {
      return { passed: true, message: `${recentNotifications.length} peer notification(s) sent`, severity: gate.severity };
    }

    return {
      passed: false,
      message: `Affected peers (${impact.affectedPeers.join(', ')}) were not notified of changes`,
      severity: gate.severity
    };
  } catch (_err) {
    return { passed: true, message: 'Notification check skipped', severity: 'warning' };
  }
}

/**
 * Gate: cascadeVerification
 * For library repos, verify all consumers were notified.
 */
function gateCascadeVerification(workspaceRoot, context, _taskMeta) {
  const gate = WORKSPACE_GATES.find(g => g.name === 'cascadeVerification');

  if (!context.currentMember || context.currentMember.role !== 'library') {
    return { passed: true, message: 'Not a library repo — cascade check skipped', severity: gate.severity };
  }

  if (!context.manifest) {
    return { passed: true, message: 'No manifest available', severity: gate.severity };
  }

  const graph = buildDependencyGraph(context.manifest);
  const consumers = getCascadeTargets(context.currentMember.name, context.manifest, graph);

  if (consumers.length === 0) {
    return { passed: true, message: 'No consumers to notify', severity: gate.severity };
  }

  // Check that messages were sent to ALL consumers
  try {
    const { readMessages } = require('./workspace-messages');
    const recentMessages = readMessages(workspaceRoot, {
      from: context.currentMember.name
    });

    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const notifiedPeers = new Set(
      recentMessages
        .filter(m => new Date(m.timestamp).getTime() > oneHourAgo)
        .map(m => m.to)
    );

    const unnotified = consumers.filter(c => !notifiedPeers.has(c));

    if (unnotified.length === 0) {
      return { passed: true, message: `All ${consumers.length} consumer(s) notified`, severity: gate.severity };
    }

    return {
      passed: false,
      message: `Library change: ${unnotified.length} consumer(s) not notified: ${unnotified.join(', ')}`,
      severity: gate.severity
    };
  } catch (_err) {
    return { passed: true, message: 'Cascade check skipped (error)', severity: 'warning' };
  }
}

/**
 * Gate: integrationMapFreshness
 * Verify the integration map is not stale.
 */
function gateIntegrationMapFreshness(workspaceRoot) {
  const gate = WORKSPACE_GATES.find(g => g.name === 'integrationMapFreshness');
  const mapPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'integration-map.md');

  try {
    if (!fs.existsSync(mapPath)) {
      return {
        passed: false,
        message: 'Integration map does not exist. Run `flow workspace sync`.',
        severity: gate.severity
      };
    }

    const stat = fs.statSync(mapPath);
    const age = Date.now() - stat.mtime.getTime();

    if (age > MAP_FRESHNESS_MS) {
      const hours = Math.round(age / (60 * 60 * 1000));
      return {
        passed: false,
        message: `Integration map is ${hours}h old (threshold: 24h). Run \`flow workspace sync\`.`,
        severity: gate.severity
      };
    }

    return { passed: true, message: 'Integration map is fresh', severity: gate.severity };
  } catch (_err) {
    return { passed: true, message: 'Freshness check skipped', severity: 'warning' };
  }
}

// ============================================================
// Gate List & Injection
// ============================================================

/**
 * Get the list of workspace quality gates that should be injected
 * for the current task type.
 *
 * @param {string} taskType — 'feature', 'bugfix', 'refactor', etc.
 * @param {Object} context — from loadWorkspaceContext()
 * @returns {Array<Object>} applicable gates
 */
function getWorkspaceQualityGates(taskType, context) {
  if (!context.currentMember) return [];

  // All gates apply to features and refactors
  if (['feature', 'refactor', 'story'].includes(taskType)) {
    return [...WORKSPACE_GATES];
  }

  // Bugfixes: only check contract compliance and notification
  if (taskType === 'bugfix' || taskType === 'fix') {
    return WORKSPACE_GATES.filter(g =>
      ['contractCompliance', 'peerNotification'].includes(g.name)
    );
  }

  // Chores/docs: only freshness check
  if (['chore', 'docs'].includes(taskType)) {
    return WORKSPACE_GATES.filter(g => g.name === 'integrationMapFreshness');
  }

  // Default: all gates
  return [...WORKSPACE_GATES];
}

/**
 * Run all applicable workspace gates and return consolidated results.
 *
 * @param {string} workspaceRoot
 * @param {Object} context
 * @param {Object} taskMeta — { taskId, taskTitle, taskType, changedFiles, impactAssessed }
 * @returns {{ passed: boolean, results: Array<Object>, errors: number, warnings: number }}
 */
function runAllWorkspaceGates(workspaceRoot, context, taskMeta = {}) {
  const gates = getWorkspaceQualityGates(taskMeta.taskType || 'feature', context);
  const results = [];
  let errors = 0;
  let warnings = 0;

  for (const gate of gates) {
    const result = runWorkspaceGate(gate.name, workspaceRoot, context, taskMeta);
    results.push({ gate: gate.name, ...result });

    if (!result.passed) {
      if (result.severity === 'error') errors++;
      else warnings++;
    }
  }

  return {
    passed: errors === 0,
    results,
    errors,
    warnings
  };
}

/**
 * Gate: dispatchVerification
 * After task completion in workspace manager mode, verify that any response
 * claiming to have dispatched/sent/forwarded work to a worker actually
 * contains corresponding tool calls (Bash with dispatch URL, Agent with
 * worker target, etc.).
 *
 * Prevents the 'narrate without execute' failure class where the manager
 * describes sending work but never actually sends it.
 *
 * Source: Manager mistake #1 (~15K tokens wasted on phantom dispatch).
 */
function gateDispatchVerification(context, taskMeta) {
  const gate = WORKSPACE_GATES.find(g => g.name === 'dispatchVerification');

  // Only meaningful in manager mode
  if (!context.currentMember || context.currentMember.role !== 'manager') {
    return { passed: true, message: 'Not in manager mode, dispatch verification skipped', severity: gate.severity };
  }

  // Check if the task output contains dispatch-claim keywords
  const dispatchKeywords = [
    /\bdispatched\b/i,
    /\bsent to worker\b/i,
    /\bforwarded to\b/i,
    /\bdelegated to\b/i,
    /\brouted to worker\b/i,
    /\bspawned.*agent\b/i
  ];

  const taskOutput = taskMeta.taskOutput ?? '';
  const hasDispatchClaim = dispatchKeywords.some(kw => kw.test(taskOutput));

  if (!hasDispatchClaim) {
    return { passed: true, message: 'No dispatch claims in task output', severity: gate.severity };
  }

  // If dispatch was claimed, verify tool calls exist
  const toolCalls = taskMeta.toolCalls ?? [];

  // Graceful degradation: if tool call tracking is not wired up yet, skip
  if (toolCalls.length === 0 && !taskMeta.toolCallsTracked) {
    return { passed: true, message: 'Tool call tracking not available — dispatch verification skipped', severity: 'warning' };
  }

  const hasDispatchToolCall = toolCalls.some(tc =>
    (tc.tool === 'Bash' && /dispatch|curl.*channel|http.*localhost.*task/i.test(tc.input ?? '')) ||
    (tc.tool === 'Agent' && tc.input) ||
    (tc.tool === 'Bash' && /node.*workspace-routing/i.test(tc.input ?? ''))
  );

  if (hasDispatchToolCall) {
    return { passed: true, message: 'Dispatch claims verified — tool calls found', severity: gate.severity };
  }

  // Dispatch claimed but no matching tool call found
  return {
    passed: false,
    message: `Response contains dispatch claims ("dispatched", "sent to worker", etc.) ` +
      `but NO corresponding tool call was found. ` +
      `This is the "narrate without execute" failure — the manager described sending work ` +
      `but never actually sent it. Execute the dispatch before marking complete.`,
    severity: gate.severity,
    action: 'Find the dispatch claim, execute the actual dispatch tool call, then re-verify.'
  };
}

/**
 * Gate: crossRepoEnumVerification
 * When a decision involves type/enum mapping between repos (frontend↔backend),
 * mandate grep/read to BOTH repos for actual values, display side-by-side,
 * THEN present the mapping to the owner.
 *
 * Detects keywords: 'maps to', 'rename to', 'corresponds to', 'enum', 'type mapping'.
 * Source: Manager mistake #5 (DECISION-7 axis mismatch — payment cadence vs compensation model).
 */
function gateCrossRepoEnumVerification(workspaceRoot, context, taskMeta) {
  const gate = WORKSPACE_GATES.find(g => g.name === 'crossRepoEnumVerification');

  // Only activate when workspace is active and has multiple members
  if (!context.config?.members || Object.keys(context.config.members).length < 2) {
    return { passed: true, message: 'Single-repo workspace, enum verification skipped', severity: gate.severity };
  }

  // Check if the task description or decisions contain cross-repo type mapping keywords
  const mappingKeywords = [
    /\bmaps?\s*to\b/i,
    /\brename[sd]?\s*to\b/i,
    /\bcorresponds?\s*to\b/i,
    /\benum\s+mapping/i,
    /\btype\s+mapping/i,
    /\bfrontend.*backend.*(?:type|enum|interface)/i,
    /\bbackend.*frontend.*(?:type|enum|interface)/i,
    /\bclient.*server.*(?:type|enum|interface)/i
  ];

  const taskText = [
    taskMeta.taskTitle ?? '',
    taskMeta.taskDescription ?? '',
    ...(taskMeta.decisions ?? [])
  ].join(' ');

  const hasMappingDecision = mappingKeywords.some(kw => kw.test(taskText));

  if (!hasMappingDecision) {
    return { passed: true, message: 'No cross-repo type/enum mapping detected', severity: gate.severity };
  }

  // If mapping decision detected, check if verification was performed
  if (taskMeta.enumVerificationPerformed) {
    return { passed: true, message: 'Cross-repo enum values verified in both repos', severity: gate.severity };
  }

  // Build the list of member repos for the error message
  const memberNames = Object.keys(context.config.members);

  return {
    passed: false,
    message: `Cross-repo type/enum mapping detected but not verified. ` +
      `Before presenting a mapping decision, grep BOTH repos (${memberNames.join(', ')}) ` +
      `for actual enum/type values and display them side-by-side. ` +
      `Never allow 'A maps to B' without verified evidence of both A and B.`,
    severity: gate.severity,
    action: 'Dispatch a grep/read to BOTH repos for actual enum values, display side-by-side, THEN present the mapping.',
    memberRepos: memberNames.map(name => ({
      name,
      path: path.resolve(workspaceRoot, context.config.members[name].path)
    }))
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Detection
  workspaceActive,
  identifyCurrentMember,

  // Context
  loadWorkspaceContext,

  // Impact analysis
  analyzeTaskImpact,
  broadcastHeadsUp,

  // Post-change
  broadcastPostChange,

  // Quality gates
  WORKSPACE_GATES,
  getWorkspaceQualityGates,
  runWorkspaceGate,
  runAllWorkspaceGates
};
