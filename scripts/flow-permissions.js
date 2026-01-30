#!/usr/bin/env node

/**
 * Wogi Flow - Permission Management
 *
 * Tracks user permission grants with two scopes:
 * - Session: Stored in memory, cleared when session ends
 * - Always: Persisted to permissions.json, survives restarts
 *
 * Usage:
 *   flow permissions list          - Show all granted permissions
 *   flow permissions grant <op>    - Grant permission (prompts for scope)
 *   flow permissions revoke <op>   - Revoke permanent permission
 *   flow permissions clear-session - Clear all session permissions
 *
 * Part of Crush research improvements (wf-0bff91f3)
 */

const fs = require('fs');
const path = require('path');
const {
  getProjectRoot,
  safeJsonParse,
  color,
  printHeader,
  printSection
} = require('./flow-utils');

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = getProjectRoot();
const PERMISSIONS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'permissions.json');

// In-memory session permissions (cleared on process exit or explicit clear)
const sessionPermissions = new Map();

// ============================================================
// Persistence
// ============================================================

/**
 * Load permanent permissions from file
 * @returns {Object} Permissions object
 */
function loadPermissions() {
  const data = safeJsonParse(PERMISSIONS_PATH, { permissions: {} });
  return data.permissions || {};
}

/**
 * Save permanent permissions to file
 * @param {Object} permissions - Permissions object
 */
function savePermissions(permissions) {
  const data = { permissions, lastUpdated: new Date().toISOString() };

  // Ensure directory exists
  const dir = path.dirname(PERMISSIONS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(PERMISSIONS_PATH, JSON.stringify(data, null, 2));
}

// ============================================================
// Permission Operations
// ============================================================

/**
 * Check if a permission is granted
 * @param {string} operation - Operation key (e.g., "run-tests", "create-file:src/**")
 * @returns {{ granted: boolean, scope: string|null, grantedAt: string|null }}
 */
function checkPermission(operation) {
  // Check session permissions first (takes precedence)
  if (sessionPermissions.has(operation)) {
    const perm = sessionPermissions.get(operation);
    return { granted: true, scope: 'session', grantedAt: perm.grantedAt };
  }

  // Check permanent permissions
  const permanent = loadPermissions();
  if (permanent[operation]) {
    return { granted: true, scope: 'always', grantedAt: permanent[operation].grantedAt };
  }

  // Check for wildcard matches (e.g., "create-file:src/**" matches "create-file:src/foo.js")
  const [_opType, opPath] = operation.split(':');
  if (opPath) {
    // Check session wildcards
    for (const [key, perm] of sessionPermissions) {
      if (matchesWildcard(key, operation)) {
        return { granted: true, scope: 'session', grantedAt: perm.grantedAt };
      }
    }

    // Check permanent wildcards
    for (const [key, perm] of Object.entries(permanent)) {
      if (matchesWildcard(key, operation)) {
        return { granted: true, scope: 'always', grantedAt: perm.grantedAt };
      }
    }
  }

  return { granted: false, scope: null, grantedAt: null };
}

/**
 * Check if a wildcard permission matches an operation
 * @param {string} pattern - Permission pattern (may contain **)
 * @param {string} operation - Specific operation
 * @returns {boolean}
 */
function matchesWildcard(pattern, operation) {
  if (pattern === operation) return true;

  // Handle ** glob pattern
  if (pattern.includes('**')) {
    const [patType, patPath] = pattern.split(':');
    const [opType, opPath] = operation.split(':');

    if (patType !== opType) return false;
    if (!patPath || !opPath) return false;

    // Convert ** to regex
    const regexPattern = patPath
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars
      .replace(/\\\*\\\*/g, '.*');              // Replace ** with .*

    return new RegExp(`^${regexPattern}$`).test(opPath);
  }

  return false;
}

/**
 * Grant a permission
 * @param {string} operation - Operation key
 * @param {'session'|'always'} scope - Permission scope
 * @returns {{ success: boolean, message: string }}
 */
function grantPermission(operation, scope = 'session') {
  const timestamp = new Date().toISOString();

  if (scope === 'session') {
    sessionPermissions.set(operation, { grantedAt: timestamp, scope: 'session' });
    return { success: true, message: `Permission granted for session: ${operation}` };
  }

  if (scope === 'always') {
    const permissions = loadPermissions();
    permissions[operation] = { grantedAt: timestamp, scope: 'always' };
    savePermissions(permissions);
    return { success: true, message: `Permission granted permanently: ${operation}` };
  }

  return { success: false, message: `Invalid scope: ${scope}` };
}

/**
 * Revoke a permanent permission
 * @param {string} operation - Operation key
 * @returns {{ success: boolean, message: string }}
 */
function revokePermission(operation) {
  const permissions = loadPermissions();

  if (!permissions[operation]) {
    return { success: false, message: `No permanent permission found: ${operation}` };
  }

  delete permissions[operation];
  savePermissions(permissions);

  // Also clear from session if present
  sessionPermissions.delete(operation);

  return { success: true, message: `Permission revoked: ${operation}` };
}

/**
 * Clear all session permissions
 * @returns {{ cleared: number }}
 */
function clearSessionPermissions() {
  const count = sessionPermissions.size;
  sessionPermissions.clear();
  return { cleared: count };
}

/**
 * List all permissions (session and permanent)
 * @returns {{ session: Object[], permanent: Object[] }}
 */
function listPermissions() {
  const permanent = loadPermissions();

  const sessionList = Array.from(sessionPermissions.entries()).map(([op, perm]) => ({
    operation: op,
    scope: 'session',
    grantedAt: perm.grantedAt
  }));

  const permanentList = Object.entries(permanent).map(([op, perm]) => ({
    operation: op,
    scope: 'always',
    grantedAt: perm.grantedAt
  }));

  return { session: sessionList, permanent: permanentList };
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  printHeader('Permission Management');

  console.log(`
Usage:
  flow permissions list              Show all granted permissions
  flow permissions grant <op>        Grant permission (interactive)
  flow permissions revoke <op>       Revoke permanent permission
  flow permissions clear-session     Clear all session permissions
  flow permissions check <op>        Check if permission is granted

Examples:
  flow permissions list
  flow permissions grant run-tests
  flow permissions grant "create-file:src/**"
  flow permissions revoke run-tests
  flow permissions check "create-file:src/foo.js"
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    showHelp();
    return;
  }

  switch (command) {
    case 'list': {
      const { session, permanent } = listPermissions();

      printHeader('Permissions');

      if (permanent.length === 0 && session.length === 0) {
        console.log(color('gray', 'No permissions granted.'));
        return;
      }

      if (permanent.length > 0) {
        printSection('Permanent (Always)');
        for (const p of permanent) {
          console.log(`  ${color('green', '✓')} ${p.operation}`);
          console.log(`    ${color('gray', `Granted: ${p.grantedAt}`)}`);
        }
      }

      if (session.length > 0) {
        printSection('Session (Temporary)');
        for (const p of session) {
          console.log(`  ${color('yellow', '○')} ${p.operation}`);
          console.log(`    ${color('gray', `Granted: ${p.grantedAt}`)}`);
        }
      }
      break;
    }

    case 'grant': {
      const operation = args[1];
      const scope = args[2] || 'session';

      if (!operation) {
        console.error(color('red', 'Error: Operation required'));
        console.log('Usage: flow permissions grant <operation> [session|always]');
        process.exit(1);
      }

      if (scope !== 'session' && scope !== 'always') {
        console.error(color('red', `Error: Invalid scope "${scope}". Use "session" or "always".`));
        process.exit(1);
      }

      const result = grantPermission(operation, scope);
      console.log(result.success ? color('green', `✓ ${result.message}`) : color('red', `✗ ${result.message}`));
      break;
    }

    case 'revoke': {
      const operation = args[1];

      if (!operation) {
        console.error(color('red', 'Error: Operation required'));
        console.log('Usage: flow permissions revoke <operation>');
        process.exit(1);
      }

      const result = revokePermission(operation);
      console.log(result.success ? color('green', `✓ ${result.message}`) : color('yellow', `⚠ ${result.message}`));
      break;
    }

    case 'clear-session': {
      const result = clearSessionPermissions();
      console.log(color('green', `✓ Cleared ${result.cleared} session permission(s)`));
      break;
    }

    case 'check': {
      const operation = args[1];

      if (!operation) {
        console.error(color('red', 'Error: Operation required'));
        console.log('Usage: flow permissions check <operation>');
        process.exit(1);
      }

      const result = checkPermission(operation);
      if (result.granted) {
        console.log(color('green', `✓ Permission granted (${result.scope})`));
        console.log(color('gray', `  Granted: ${result.grantedAt}`));
      } else {
        console.log(color('yellow', '○ Permission not granted'));
      }
      break;
    }

    default:
      console.error(color('red', `Unknown command: ${command}`));
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  checkPermission,
  grantPermission,
  revokePermission,
  clearSessionPermissions,
  listPermissions,
  loadPermissions,
  savePermissions,
  matchesWildcard
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
