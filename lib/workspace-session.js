#!/usr/bin/env node

/**
 * Wogi Workspace — Manager Session Handoff
 *
 * The workspace manager doesn't have WogiFlow installed locally
 * (it orchestrates, doesn't code). So /wogi-session-end fails.
 *
 * This module provides workspace-aware session management:
 *   - saveManagerHandoff() — captures session state for next session
 *   - loadManagerHandoff() — restores state at session start
 *
 * The handoff document (.workspace/state/manager-session.json) includes:
 *   - Dispatched tasks summary (what was sent to which worker)
 *   - Pending/completed workspace tasks
 *   - Unread worker messages
 *   - Active locks
 *   - Last sync timestamp
 *   - Session notes (what was discussed, decisions made)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');

const { WORKSPACE_CONFIG_FILE, WORKSPACE_DIR } = require('./workspace');

// ============================================================
// Manager Detection
// ============================================================

/**
 * Detect if the current session is a workspace manager.
 * The manager is the session running in the workspace root directory
 * (where wogi-workspace.json lives), NOT in a member repo.
 *
 * @param {string} [cwd]
 * @returns {{ isManager: boolean, workspaceRoot: string|null }}
 */
function isWorkspaceManager(cwd) {
  const dir = cwd || process.cwd();
  const configPath = path.join(dir, WORKSPACE_CONFIG_FILE);

  if (fs.existsSync(configPath)) {
    // Check this is the root, not a member repo that happens to have the config
    // The manager's cwd IS the workspace root
    return { isManager: true, workspaceRoot: dir };
  }

  return { isManager: false, workspaceRoot: null };
}

// ============================================================
// Session Handoff — Save
// ============================================================

/**
 * Save a manager session handoff document.
 * Called when the manager session ends (or user says "wrap up").
 *
 * @param {string} workspaceRoot
 * @param {Object} [options]
 * @param {string} [options.sessionNotes] — free-text notes about what was discussed
 * @param {string[]} [options.decisionsM made] — decisions made during this session
 * @returns {Object} the saved handoff document
 */
function saveManagerHandoff(workspaceRoot, options = {}) {
  const handoff = {
    savedAt: new Date().toISOString(),
    workspaceName: '',
    members: {},
    dispatched: [],
    pendingTasks: [],
    completedTasks: [],
    unreadMessages: [],
    activeLocks: [],
    contractDrifts: [],
    lastSyncAt: null,
    sessionNotes: options.sessionNotes || '',
    decisions: options.decisions || []
  };

  // Read workspace config
  const configPath = path.join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  try {
    const config = safeReadJson(configPath);
    handoff.workspaceName = config.name || '';

    // Read each member's task status
    for (const [name, memberConfig] of Object.entries(config.members || {})) {
      const memberPath = path.resolve(workspaceRoot, memberConfig.path);
      const readyPath = path.join(memberPath, '.workflow', 'state', 'ready.json');

      const memberStatus = {
        role: memberConfig.role,
        inProgress: [],
        ready: [],
        recentlyCompleted: []
      };

      try {
        if (fs.existsSync(readyPath)) {
          const ready = safeReadJson(readyPath);
          memberStatus.inProgress = (ready.inProgress || []).map(t => ({ id: t.id, title: t.title }));
          memberStatus.ready = (ready.ready || []).map(t => ({ id: t.id, title: t.title }));
          memberStatus.recentlyCompleted = (ready.recentlyCompleted || []).slice(0, 5).map(t => ({ id: t.id, title: t.title }));
        }
      } catch (_err) {
        // Non-critical
      }

      handoff.members[name] = memberStatus;
    }
  } catch (_err) {
    // Config read failure — save what we can
  }

  // Read workspace-level tasks
  const wsReadyPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'ready.json');
  try {
    if (fs.existsSync(wsReadyPath)) {
      const wsReady = safeReadJson(wsReadyPath);
      handoff.pendingTasks = (wsReady.ready || []).map(t => ({ id: t.id, title: t.title }));
      handoff.completedTasks = (wsReady.recentlyCompleted || []).slice(0, 10).map(t => ({ id: t.id, title: t.title }));
    }
  } catch (_err) {
    // Non-critical
  }

  // Read unread messages
  try {
    const messagesDir = path.join(workspaceRoot, WORKSPACE_DIR, 'messages');
    if (fs.existsSync(messagesDir)) {
      const files = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const msg = safeReadJson(path.join(messagesDir, file));
          if (msg.status === 'pending') {
            handoff.unreadMessages.push({
              id: msg.id,
              from: msg.from,
              type: msg.type,
              subject: msg.subject,
              timestamp: msg.timestamp
            });
          }
        } catch (_err) {
          // Skip malformed
        }
      }
    }
  } catch (_err) {
    // Non-critical
  }

  // Read active locks
  try {
    const locksDir = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'locks');
    if (fs.existsSync(locksDir)) {
      const now = Date.now();
      const files = fs.readdirSync(locksDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const lock = safeReadJson(path.join(locksDir, file));
          if (new Date(lock.expiresAt).getTime() > now) {
            handoff.activeLocks.push({
              interface: lock.interface,
              owner: lock.owner,
              expiresAt: lock.expiresAt
            });
          }
        } catch (_err) {
          // Skip
        }
      }
    }
  } catch (_err) {
    // Non-critical
  }

  // Check manifest freshness
  const manifestPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'workspace-manifest.json');
  try {
    if (fs.existsSync(manifestPath)) {
      const stat = fs.statSync(manifestPath);
      handoff.lastSyncAt = stat.mtime.toISOString();
    }
  } catch (_err) {
    // Non-critical
  }

  // Write the handoff document
  const handoffPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'manager-session.json');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, JSON.stringify(handoff, null, 2));

  return handoff;
}

// ============================================================
// Session Handoff — Load (for session start)
// ============================================================

/**
 * Load the previous manager session handoff.
 * Called at session start to restore context.
 *
 * @param {string} workspaceRoot
 * @returns {Object|null} handoff document or null if none exists
 */
function loadManagerHandoff(workspaceRoot) {
  const handoffPath = path.join(workspaceRoot, WORKSPACE_DIR, 'state', 'manager-session.json');

  try {
    if (fs.existsSync(handoffPath)) {
      return safeReadJson(handoffPath);
    }
  } catch (_err) {
    // Non-critical
  }

  return null;
}

/**
 * Format the handoff document as a readable session start briefing.
 *
 * @param {Object} handoff — from loadManagerHandoff()
 * @returns {string} formatted briefing
 */
function formatHandoffBriefing(handoff) {
  if (!handoff) return 'No previous session handoff found.';

  const lines = [];
  const age = Math.round((Date.now() - new Date(handoff.savedAt).getTime()) / (60 * 60 * 1000));

  lines.push('Previous Session Handoff');
  lines.push('━'.repeat(40));
  lines.push(`Saved: ${handoff.savedAt} (${age}h ago)`);
  lines.push(`Workspace: ${handoff.workspaceName}`);
  lines.push('');

  // Member status
  lines.push('Member Status:');
  for (const [name, status] of Object.entries(handoff.members || {})) {
    const inProgress = status.inProgress?.length || 0;
    const ready = status.ready?.length || 0;
    lines.push(`  ${name} (${status.role}): ${inProgress} in-progress, ${ready} ready`);
    for (const t of status.inProgress || []) {
      lines.push(`    >> ${t.id}: ${t.title}`);
    }
  }
  lines.push('');

  // Unread messages
  if (handoff.unreadMessages?.length > 0) {
    lines.push(`Unread Messages (${handoff.unreadMessages.length}):`);
    for (const msg of handoff.unreadMessages) {
      lines.push(`  [${msg.type}] from ${msg.from}: ${msg.subject}`);
    }
    lines.push('');
  }

  // Active locks
  if (handoff.activeLocks?.length > 0) {
    lines.push(`Active Locks (${handoff.activeLocks.length}):`);
    for (const lock of handoff.activeLocks) {
      lines.push(`  ${lock.interface} — held by ${lock.owner} (expires: ${lock.expiresAt})`);
    }
    lines.push('');
  }

  // Session notes
  if (handoff.sessionNotes) {
    lines.push('Session Notes:');
    lines.push(`  ${handoff.sessionNotes}`);
    lines.push('');
  }

  // Decisions
  if (handoff.decisions?.length > 0) {
    lines.push('Decisions Made:');
    for (const d of handoff.decisions) {
      lines.push(`  - ${d}`);
    }
    lines.push('');
  }

  // Manifest freshness
  if (handoff.lastSyncAt) {
    const syncAge = Math.round((Date.now() - new Date(handoff.lastSyncAt).getTime()) / (60 * 60 * 1000));
    lines.push(`Last sync: ${syncAge}h ago${syncAge > 24 ? ' (STALE — run flow workspace sync)' : ''}`);
  }

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  isWorkspaceManager,
  saveManagerHandoff,
  loadManagerHandoff,
  formatHandoffBriefing
};
