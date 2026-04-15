#!/usr/bin/env node

/**
 * Wogi Workspace — Sync & Lifecycle Management
 *
 * Story 6 (wf-a3a13d95): Re-reads member repo state files, updates manifest,
 * detects changes, and provides unified workspace status.
 */

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');

const { readMemberMetadata, extractCapabilities, extractEndpoints, detectStack, generateManifest, WORKSPACE_CONFIG_FILE, WORKSPACE_DIR } = require('./workspace');
const { buildIntegrationMap, detectTypeDrift } = require('./workspace-contracts');
const { getUnreadMessages, formatMessagesForDisplay } = require('./workspace-messages');

// ============================================================
// Workspace Sync (Criterion 1)
// ============================================================

/**
 * Re-read all member repo state files and update the workspace manifest.
 * @param {string} workspaceRoot
 * @param {Object} [options] — { silent: boolean }
 * @returns {Object} sync result
 */
function syncWorkspace(workspaceRoot, options = {}) {
  const { silent = false } = options;
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    throw new Error('No wogi-workspace.json found. Run `flow workspace init` first.');
  }

  const config = safeReadJson(configPath);
  const result = {
    success: true,
    membersUpdated: 0,
    changes: [],
    warnings: []
  };

  // Read old manifest for diff
  const manifestPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'workspace-manifest.json');
  let oldManifest = null;
  try {
    if (fs.existsSync(manifestPath)) {
      oldManifest = safeReadJson(manifestPath);
    }
  } catch (_err) {
    // Will regenerate from scratch
  }

  // Re-read each member
  const members = [];
  for (const [name, memberConfig] of Object.entries(config.members)) {
    const memberPath = path.resolve(workspaceRoot, memberConfig.path);
    const workflowPath = path.join(memberPath, '.workflow');

    if (!fs.existsSync(workflowPath)) {
      result.warnings.push(`Member '${name}' has no .workflow/ directory — skipping`);
      continue;
    }

    const metadata = readMemberMetadata(workflowPath);
    const stack = detectStack(metadata, memberPath);
    const capabilities = extractCapabilities(metadata);
    const endpoints = extractEndpoints(metadata);
    const role = memberConfig.role || 'standalone';

    members.push({ name, path: memberPath, workflowPath, metadata, stack, capabilities, endpoints, role });

    // Detect changes vs old manifest
    if (oldManifest && oldManifest.members[name]) {
      const oldMember = oldManifest.members[name];
      const oldProvides = new Set(oldMember.provides || []);
      const oldConsumes = new Set(oldMember.consumes || []);

      const newProvides = endpoints.provides.filter(ep => !oldProvides.has(ep));
      const removedProvides = [...oldProvides].filter(ep => !endpoints.provides.includes(ep));
      const newConsumes = endpoints.consumes.filter(ep => !oldConsumes.has(ep));
      const removedConsumes = [...oldConsumes].filter(ep => !endpoints.consumes.includes(ep));

      if (newProvides.length > 0) result.changes.push({ member: name, type: 'new-provides', endpoints: newProvides });
      if (removedProvides.length > 0) result.changes.push({ member: name, type: 'removed-provides', endpoints: removedProvides });
      if (newConsumes.length > 0) result.changes.push({ member: name, type: 'new-consumes', endpoints: newConsumes });
      if (removedConsumes.length > 0) result.changes.push({ member: name, type: 'removed-consumes', endpoints: removedConsumes });
    }

    result.membersUpdated++;
  }

  // Generate new manifest
  const newManifest = generateManifest(config.name, members);

  // Detect type drift
  const memberMetadata = {};
  for (const m of members) memberMetadata[m.name] = m.metadata;
  const drifts = detectTypeDrift(newManifest, memberMetadata);
  if (drifts.length > 0) {
    newManifest.integrations.typeDrift = drifts;
  }

  // Write updated manifest
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));

  // Write updated integration map
  const integrationMap = buildIntegrationMap(newManifest);
  const mapLines = ['# Integration Map\n', `Generated: ${integrationMap.generatedAt}`, `Match rate: ${integrationMap.stats.matchRate}%\n`];

  if (integrationMap.matched.length > 0) {
    mapLines.push('## Matched Endpoints\n');
    mapLines.push('| Endpoint | Provider(s) | Consumer(s) | Score |');
    mapLines.push('|----------|-------------|-------------|-------|');
    for (const m of integrationMap.matched) {
      mapLines.push(`| \`${m.endpoint}\` | ${m.providers.join(', ')} | ${m.consumers.join(', ')} | ${(m.matchScore * 100).toFixed(0)}% |`);
    }
    mapLines.push('');
  }

  if (integrationMap.orphanedConsumers.length > 0) {
    mapLines.push('## Orphaned Consumers\n');
    for (const o of integrationMap.orphanedConsumers) {
      mapLines.push(`- \`${o.endpoint}\` — consumed by: ${o.consumers.join(', ')}`);
    }
    mapLines.push('');
  }

  fs.writeFileSync(
    path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'integration-map.md'),
    mapLines.join('\n')
  );

  if (!silent && result.changes.length > 0) {
    console.log(`\n── Changes detected ──────────────────\n`);
    for (const change of result.changes) {
      const icon = change.type.includes('new') ? '✚' : '✗';
      console.log(`  ${icon} ${change.member}: ${change.type} — ${change.endpoints.join(', ')}`);
    }
  }

  return result;
}

// ============================================================
// Workspace Status (Criterion 5)
// ============================================================

/**
 * Generate a unified workspace status report
 * @param {string} workspaceRoot
 * @returns {string} formatted status report
 */
function getWorkspaceStatus(workspaceRoot) {
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  if (!fs.existsSync(configPath)) return 'No workspace found. Run `flow workspace init` first.';

  const config = safeReadJson(configPath);
  const manifestPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'workspace-manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? safeReadJson(manifestPath)
    : null;

  const lines = [];
  lines.push(`🏗️  Wogi Workspace: ${config.name}`);
  lines.push('━'.repeat(40));
  lines.push('');

  // Members
  lines.push('Members:');
  for (const [name, memberConfig] of Object.entries(config.members)) {
    const memberPath = path.resolve(workspaceRoot, memberConfig.path);
    const readyPath = path.join(memberPath, '.workflow', 'state', 'ready.json');

    let taskSummary = 'no .workflow/';
    try {
      if (fs.existsSync(readyPath)) {
        const ready = safeReadJson(readyPath);
        const inProgress = (ready.inProgress || []).length;
        const readyCount = (ready.ready || []).length;
        taskSummary = `${inProgress} in progress, ${readyCount} ready`;
      }
    } catch (_err) {
      taskSummary = 'error reading';
    }

    const memberManifest = manifest?.members?.[name];
    const stack = memberManifest ? `${memberManifest.stack.language}/${memberManifest.stack.framework}` : 'unknown';

    lines.push(`  📦 ${name} (${stack}) — ${taskSummary}`);
  }
  lines.push('');

  // Integration summary
  if (manifest) {
    const matched = manifest.integrations.matched?.length ?? 0;
    const orphanedC = manifest.integrations.orphanedConsumers?.length ?? 0;
    const orphanedP = manifest.integrations.orphanedProviders?.length ?? 0;
    const drifts = manifest.integrations.typeDrift?.length ?? 0;

    lines.push('Integrations:');
    lines.push(`  🔗 ${matched} matched endpoints`);
    if (orphanedC > 0) lines.push(`  ⚠️  ${orphanedC} orphaned consumer${orphanedC !== 1 ? 's' : ''}`);
    if (orphanedP > 0) lines.push(`  ℹ️  ${orphanedP} endpoint${orphanedP !== 1 ? 's' : ''} without consumers`);
    if (drifts > 0) lines.push(`  ⚠️  ${drifts} type drift${drifts !== 1 ? 's' : ''} detected`);
    lines.push('');
  }

  // Messages
  const unread = getUnreadMessages(workspaceRoot, 'all');
  if (unread.length > 0) {
    lines.push(`Messages (${unread.length} unread):`);
    lines.push(formatMessagesForDisplay(unread, 5));
    lines.push('');
  }

  // Contracts
  const contractsDir = path.join(workspaceRoot, WORKSPACE_DIR, 'contracts');
  if (fs.existsSync(contractsDir)) {
    const contracts = fs.readdirSync(contractsDir).filter(f => !f.startsWith('.'));
    if (contracts.length > 0) {
      lines.push(`Contracts: ${contracts.length}`);
      for (const c of contracts) {
        const stat = fs.statSync(path.join(contractsDir, c));
        const age = formatAge(stat.mtime);
        lines.push(`  📋 ${c} (updated ${age})`);
      }
      lines.push('');
    }
  }

  // Workspace-level tasks
  const wsReadyPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'ready.json');
  if (fs.existsSync(wsReadyPath)) {
    try {
      const wsReady = safeReadJson(wsReadyPath);
      const wsInProgress = (wsReady.inProgress || []).length;
      const wsReadyCount = (wsReady.ready || []).length;
      if (wsInProgress > 0 || wsReadyCount > 0) {
        lines.push(`Workspace tasks: ${wsInProgress} in progress, ${wsReadyCount} ready`);
        lines.push('');
      }
    } catch (_err) {
      // Non-critical
    }
  }

  return lines.join('\n');
}

function formatAge(date) {
  const ms = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================================
// Add/Remove Members (Criterion 4)
// ============================================================

/**
 * Add a member repo to the workspace
 * @param {string} workspaceRoot
 * @param {string} memberPath — path to the repo
 * @param {string} [role] — optional role override
 * @returns {Object} result
 */
function addMember(workspaceRoot, memberPath, role) {
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  const config = safeReadJson(configPath);

  const absPath = path.resolve(workspaceRoot, memberPath);
  const name = path.basename(absPath);
  const workflowPath = path.join(absPath, '.workflow');

  if (!fs.existsSync(workflowPath)) {
    throw new Error(`${memberPath} does not have a .workflow/ directory. Run 'flow init' there first.`);
  }

  if (config.members[name]) {
    throw new Error(`Member '${name}' already exists in workspace.`);
  }

  // Read metadata to auto-detect role
  const metadata = readMemberMetadata(workflowPath);
  const endpoints = extractEndpoints(metadata);
  const detectedRole = role || require('./workspace').autoDetectRole(endpoints);

  config.members[name] = {
    path: `./${name}`,
    role: detectedRole
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Re-sync to update manifest
  syncWorkspace(workspaceRoot, { silent: true });

  return { name, role: detectedRole, path: memberPath };
}

/**
 * Remove a member repo from the workspace
 * @param {string} workspaceRoot
 * @param {string} memberName
 * @returns {boolean} success
 */
function removeMember(workspaceRoot, memberName) {
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  const config = safeReadJson(configPath);

  if (!config.members[memberName]) {
    throw new Error(`Member '${memberName}' not found in workspace.`);
  }

  delete config.members[memberName];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Re-sync to update manifest
  syncWorkspace(workspaceRoot, { silent: true });

  return true;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  syncWorkspace,
  getWorkspaceStatus,
  addMember,
  removeMember
};
