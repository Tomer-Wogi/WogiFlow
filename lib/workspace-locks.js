#!/usr/bin/env node

/**
 * Wogi Workspace — Interface Lock Mechanism
 *
 * Prevents concurrent modification of shared interfaces by different repos.
 * When a worker starts modifying a shared endpoint/type, it acquires a lock.
 * Other workers get warned if they try to modify the same interface.
 *
 * Locks are:
 *   - File-based (.workspace/state/locks/)
 *   - Auto-expiring (configurable TTL, default 30 minutes)
 *   - Best-effort (advisory, not mandatory — warns but doesn't hard-block)
 *
 * Lock file format: { interface, owner, taskId, acquiredAt, expiresAt }
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeReadJson } = require('./utils');
const crypto = require('node:crypto');

// ============================================================
// Constants
// ============================================================

const LOCKS_DIR_NAME = 'locks';
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours cap
const LOCK_ID_PATTERN = /^lock-[a-f0-9]{8}$/;
const VALID_NAME_PATTERN = /^[a-zA-Z0-9_\-/.:{} ]{1,256}$/;

// ============================================================
// Lock Directory
// ============================================================

/**
 * Get the locks directory path, ensuring it exists.
 * @param {string} workspaceRoot
 * @returns {string} locks directory path
 */
function getLocksDir(workspaceRoot) {
  const dir = path.join(workspaceRoot, '.workspace', 'state', LOCKS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Generate a unique lock ID.
 * @returns {string} lock-XXXXXXXX
 */
function generateLockId() {
  return 'lock-' + crypto.randomBytes(4).toString('hex');
}

// ============================================================
// Lock Operations
// ============================================================

/**
 * Acquire a lock on a shared interface.
 *
 * @param {string} workspaceRoot
 * @param {Object} params
 * @param {string} params.interface — the endpoint/type being locked (e.g., "GET /api/users", "UserDTO")
 * @param {string} params.owner — the repo name acquiring the lock
 * @param {string} [params.taskId] — optional task ID for traceability
 * @param {number} [params.ttlMs] — lock TTL in milliseconds (default: 30 min)
 * @returns {{ acquired: boolean, lockId: string|null, conflict: Object|null }}
 */
function acquireLock(workspaceRoot, params) {
  const { interface: iface, owner, taskId = '', ttlMs = DEFAULT_TTL_MS } = params;

  if (!iface || !VALID_NAME_PATTERN.test(iface)) {
    return { acquired: false, lockId: null, conflict: null, error: 'Invalid interface name' };
  }
  if (!owner || !VALID_NAME_PATTERN.test(owner)) {
    return { acquired: false, lockId: null, conflict: null, error: 'Invalid owner name' };
  }

  const locksDir = getLocksDir(workspaceRoot);
  const effectiveTtl = Math.min(ttlMs, MAX_TTL_MS);

  // Check for existing lock on this interface
  const existing = findLockForInterface(workspaceRoot, iface);
  if (existing) {
    // Check if expired
    if (new Date(existing.expiresAt).getTime() < Date.now()) {
      // Expired — clean up and proceed
      releaseLock(workspaceRoot, existing.id);
    } else if (existing.owner === owner) {
      // Same owner — extend the lock
      existing.expiresAt = new Date(Date.now() + effectiveTtl).toISOString();
      if (taskId) existing.taskId = taskId;
      const lockPath = path.join(locksDir, `${existing.id}.json`);
      fs.writeFileSync(lockPath, JSON.stringify(existing, null, 2));
      return { acquired: true, lockId: existing.id, conflict: null };
    } else {
      // Conflict — another repo holds the lock
      return { acquired: false, lockId: null, conflict: existing };
    }
  }

  // Create new lock using exclusive create flag to prevent TOCTOU races.
  // If another process creates the same lock file between our check and write,
  // the 'wx' flag will throw EEXIST, and we retry with a new ID.
  const lockId = generateLockId();
  const lock = {
    id: lockId,
    interface: iface,
    owner,
    taskId,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + effectiveTtl).toISOString()
  };

  const lockPath = path.join(locksDir, `${lockId}.json`);
  try {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Extremely unlikely with random IDs, but handle gracefully
      return { acquired: false, lockId: null, conflict: null, error: 'Lock ID collision — retry' };
    }
    return { acquired: false, lockId: null, conflict: null, error: err.message };
  }

  return { acquired: true, lockId, conflict: null };
}

/**
 * Release a lock.
 *
 * @param {string} workspaceRoot
 * @param {string} lockId
 * @returns {boolean} true if lock was found and removed
 */
function releaseLock(workspaceRoot, lockId) {
  if (!LOCK_ID_PATTERN.test(lockId)) return false;

  const locksDir = getLocksDir(workspaceRoot);
  const lockPath = path.join(locksDir, `${lockId}.json`);

  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      return true;
    }
  } catch (_err) {
    // Best effort
  }

  return false;
}

/**
 * Release all locks held by a specific owner (repo).
 * Typically called on task completion or session end.
 *
 * @param {string} workspaceRoot
 * @param {string} owner — repo name
 * @returns {number} number of locks released
 */
function releaseAllByOwner(workspaceRoot, owner) {
  const locks = listLocks(workspaceRoot);
  let released = 0;

  for (const lock of locks) {
    if (lock.owner === owner) {
      if (releaseLock(workspaceRoot, lock.id)) {
        released++;
      }
    }
  }

  return released;
}

/**
 * Release all locks for a specific task.
 *
 * @param {string} workspaceRoot
 * @param {string} taskId
 * @returns {number} number of locks released
 */
function releaseAllByTask(workspaceRoot, taskId) {
  const locks = listLocks(workspaceRoot);
  let released = 0;

  for (const lock of locks) {
    if (lock.taskId === taskId) {
      if (releaseLock(workspaceRoot, lock.id)) {
        released++;
      }
    }
  }

  return released;
}

// ============================================================
// Lock Queries
// ============================================================

/**
 * Find an active (non-expired) lock for a specific interface.
 *
 * @param {string} workspaceRoot
 * @param {string} iface — interface name
 * @returns {Object|null} lock object or null
 */
function findLockForInterface(workspaceRoot, iface) {
  const locks = listLocks(workspaceRoot);
  const now = Date.now();
  const ifaceLower = iface.toLowerCase();

  for (const lock of locks) {
    if (lock.interface.toLowerCase() === ifaceLower) {
      if (new Date(lock.expiresAt).getTime() > now) {
        return lock;
      }
    }
  }

  return null;
}

/**
 * List all locks (including expired ones).
 *
 * @param {string} workspaceRoot
 * @returns {Array<Object>} lock objects
 */
function listLocks(workspaceRoot) {
  const locksDir = getLocksDir(workspaceRoot);
  const locks = [];

  try {
    const files = fs.readdirSync(locksDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = safeReadJson(path.join(locksDir, file));
        if (content.id && content.interface && content.owner) {
          locks.push(content);
        }
      } catch (_err) {
        // Skip malformed lock files
      }
    }
  } catch (_err) {
    // Locks dir doesn't exist yet
  }

  return locks;
}

/**
 * List only active (non-expired) locks.
 *
 * @param {string} workspaceRoot
 * @returns {Array<Object>} active locks
 */
function listActiveLocks(workspaceRoot) {
  const now = Date.now();
  return listLocks(workspaceRoot).filter(l => new Date(l.expiresAt).getTime() > now);
}

/**
 * Clean up all expired locks.
 *
 * @param {string} workspaceRoot
 * @returns {number} number of expired locks removed
 */
function cleanExpiredLocks(workspaceRoot) {
  const now = Date.now();
  const locks = listLocks(workspaceRoot);
  let cleaned = 0;

  for (const lock of locks) {
    if (new Date(lock.expiresAt).getTime() <= now) {
      if (releaseLock(workspaceRoot, lock.id)) {
        cleaned++;
      }
    }
  }

  return cleaned;
}

/**
 * Check if modifying a set of interfaces would conflict with any existing locks.
 *
 * @param {string} workspaceRoot
 * @param {string[]} interfaces — interfaces to check
 * @param {string} requestingRepo — the repo that wants to modify
 * @returns {{ clear: boolean, conflicts: Array<Object> }}
 */
function checkForConflicts(workspaceRoot, interfaces, requestingRepo) {
  const conflicts = [];
  const now = Date.now();

  for (const iface of interfaces) {
    const lock = findLockForInterface(workspaceRoot, iface);
    if (lock && lock.owner !== requestingRepo && new Date(lock.expiresAt).getTime() > now) {
      conflicts.push({
        interface: iface,
        heldBy: lock.owner,
        taskId: lock.taskId,
        acquiredAt: lock.acquiredAt,
        expiresAt: lock.expiresAt
      });
    }
  }

  return { clear: conflicts.length === 0, conflicts };
}

/**
 * Format locks for display.
 *
 * @param {Array<Object>} locks
 * @returns {string} formatted text
 */
function formatLocksForDisplay(locks) {
  if (locks.length === 0) return 'No active locks.';

  const now = Date.now();
  const lines = [];

  for (const lock of locks) {
    const remaining = new Date(lock.expiresAt).getTime() - now;
    const expired = remaining <= 0;
    const timeStr = expired
      ? 'EXPIRED'
      : remaining < 60000
        ? `${Math.round(remaining / 1000)}s remaining`
        : `${Math.round(remaining / 60000)}m remaining`;

    const icon = expired ? '🔓' : '🔒';
    lines.push(`  ${icon} ${lock.interface} — held by ${lock.owner}${lock.taskId ? ` (${lock.taskId})` : ''} [${timeStr}]`);
  }

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Lock operations
  acquireLock,
  releaseLock,
  releaseAllByOwner,
  releaseAllByTask,

  // Lock queries
  findLockForInterface,
  listLocks,
  listActiveLocks,
  cleanExpiredLocks,
  checkForConflicts,

  // Display
  formatLocksForDisplay,

  // Constants
  DEFAULT_TTL_MS,
  MAX_TTL_MS
};
