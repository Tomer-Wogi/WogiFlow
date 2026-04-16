#!/usr/bin/env node

/**
 * Wogi Flow - Deploy Gate (Core Module)
 *
 * Mechanically blocks deploy commands unless a valid verification artifact exists.
 * Part of the Mechanical Enforcement Gates v3.0 initiative.
 *
 * Enforcement points:
 *   1. PreToolUse on Bash: blocks commands matching config deploy patterns
 *   2. TaskCompleted: blocks P0/P1 task completion without verification artifact
 *
 * Anti-forgery:
 *   - Artifacts are HMAC-signed with a session key stored in .workflow/state/
 *   - Direct Write of a fake artifact will not have a valid signature
 *   - The PreToolUse hook blocks Write to .workflow/verifications/smoke-test-*.json
 *
 * Source-file content hash:
 *   - Artifacts reference a hash of source file contents (not git HEAD)
 *   - Non-code changes (docs, config, comments) don't invalidate the artifact
 *
 * Route inventory:
 *   - High-water-mark: routes auto-add, never auto-remove
 *   - Removal requires explicit user confirmation
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Import shared utilities
const { getConfig, PATHS, safeJsonParse, writeJson } = require('../../flow-utils');

// ============================================================
// Constants
// ============================================================

const VERIFICATION_DIR = path.join(PATHS.workflow, 'verifications');
const DEPLOY_ROUTES_PATH = path.join(PATHS.state, 'deploy-routes.json');
const SESSION_KEY_PATH = path.join(PATHS.state, '.deploy-gate-key');
const DEPLOY_HISTORY_PATH = path.join(PATHS.state, 'deploy-history.json');

/** Default source file patterns for content hashing */
const DEFAULT_SOURCE_PATTERNS = [
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
  '**/*.vue', '**/*.svelte', '**/*.css', '**/*.scss'
];

/** Default source file extensions for quick check */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.css', '.scss'
]);

// ============================================================
// Configuration
// ============================================================

/**
 * Check if deploy gate is enabled
 * @param {Object} [config] - Config object (loaded if not provided)
 * @returns {boolean}
 */
function isDeployGateEnabled(config) {
  if (!config) config = getConfig();
  return config.enforcement?.deployGate?.enabled === true;
}

/**
 * Get deploy gate configuration with defaults
 * @param {Object} [config] - Config object (loaded if not provided)
 * @returns {Object}
 */
function getDeployGateConfig(config) {
  if (!config) config = getConfig();
  const gate = config.enforcement?.deployGate ?? {};
  return {
    enabled: gate.enabled === true,
    commands: gate.commands ?? [],
    sourcePatterns: gate.sourcePatterns ?? DEFAULT_SOURCE_PATTERNS,
    requireForPriorities: gate.requireForPriorities ?? ['P0', 'P1'],
    blockWriteToVerifications: gate.blockWriteToVerifications !== false,
    minVerifiedRoutes: gate.minVerifiedRoutes ?? 3,
    rejectLoginOnly: gate.rejectLoginOnly !== false
  };
}

// ============================================================
// Session Key Management
// ============================================================

/**
 * Get or create the session HMAC key.
 * Module-level cache prevents ephemeral key divergence (F12).
 * File written with 0o600 permissions (F9).
 * @returns {string} Hex-encoded HMAC key
 */
let _cachedKey = null;
function getSessionKey() {
  if (_cachedKey) return _cachedKey;

  try {
    if (fs.existsSync(SESSION_KEY_PATH)) {
      const key = fs.readFileSync(SESSION_KEY_PATH, 'utf-8').trim();
      if (key.length >= 32) {
        _cachedKey = key;
        return key;
      }
    }
  } catch (_err) {
    // Fall through to generate
  }

  const key = crypto.randomBytes(32).toString('hex');
  _cachedKey = key;
  try {
    fs.mkdirSync(path.dirname(SESSION_KEY_PATH), { recursive: true });
    fs.writeFileSync(SESSION_KEY_PATH, key, { encoding: 'utf-8', mode: 0o600 });
  } catch (_err) {
    // Ephemeral key — cached in memory for this process
  }
  return key;
}

// ============================================================
// Source-File Content Hashing
// ============================================================

/**
 * Compute a hash of source file contents (not git HEAD).
 * Only includes files matching source patterns.
 * @param {string[]} [changedFiles] - If provided, only check these files
 * @returns {string} SHA-256 hex hash of sorted source file contents
 */
function computeSourceHash(changedFiles) {
  const { execSync } = require('node:child_process');

  try {
    // Get list of tracked source files
    let files;
    if (changedFiles && changedFiles.length > 0) {
      // Filter to source files only
      files = changedFiles.filter(f => SOURCE_EXTENSIONS.has(path.extname(f)));
    } else {
      // Get all tracked files, filter to source extensions
      const tracked = execSync('git ls-files', { encoding: 'utf-8', cwd: PATHS.root }).trim();
      files = tracked.split('\n').filter(f => SOURCE_EXTENSIONS.has(path.extname(f)));
    }

    if (files.length === 0) return 'empty';

    // Sort for deterministic hash
    files.sort();

    // Hash the contents of all source files
    const hash = crypto.createHash('sha256');
    for (const file of files) {
      const fullPath = path.resolve(PATHS.root, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        hash.update(file + ':' + content);
      } catch (_err) {
        // File may have been deleted — skip
      }
    }

    return hash.digest('hex');
  } catch (_err) {
    // Fallback: use git HEAD (less precise but functional)
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: PATHS.root }).trim();
    } catch (_err) {
      return 'unknown';
    }
  }
}

/**
 * Check if source files changed between two hashes.
 * Used to determine if an artifact is still valid.
 * @param {string} artifactHash - Hash stored in the artifact
 * @returns {boolean} True if artifact is still valid (source hasn't changed)
 */
function isArtifactFresh(artifactHash) {
  if (!artifactHash || artifactHash === 'unknown') return false;
  const currentHash = computeSourceHash();
  return currentHash === artifactHash;
}

// ============================================================
// HMAC Signing / Verification
// ============================================================

/**
 * Canonical payload for HMAC — shared between sign and verify (F1/F2).
 * Excludes 'signature', sorts keys deterministically.
 * @param {Object} data - Artifact data (with or without signature)
 * @returns {string} Deterministic JSON string
 */
function canonicalPayload(data) {
  const keys = Object.keys(data).filter(k => k !== 'signature').sort();
  const clean = {};
  for (const k of keys) clean[k] = data[k];
  return JSON.stringify(clean);
}

/**
 * Generate an HMAC signature for a verification artifact.
 * @param {Object} artifactData - The artifact data (without signature field)
 * @returns {string} HMAC-SHA256 hex signature
 */
function signArtifact(artifactData) {
  const key = getSessionKey();
  return crypto.createHmac('sha256', key).update(canonicalPayload(artifactData)).digest('hex');
}

/**
 * Verify an HMAC signature on a verification artifact.
 * Uses timingSafeEqual to prevent timing attacks (F7).
 * @param {Object} artifact - The full artifact including signature field
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyArtifactSignature(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    return { valid: false, reason: 'Artifact is null or not an object' };
  }
  if (!artifact.signature || typeof artifact.signature !== 'string') {
    return { valid: false, reason: 'Artifact has no HMAC signature — may be manually crafted' };
  }

  const key = getSessionKey();
  const expected = crypto.createHmac('sha256', key).update(canonicalPayload(artifact)).digest('hex');

  // Constant-time comparison (F7)
  const sigBuf = Buffer.from(artifact.signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'HMAC signature mismatch — artifact may be forged or from a different session' };
  }

  return { valid: true };
}

// ============================================================
// Artifact Discovery
// ============================================================

/**
 * Find the latest valid verification artifact.
 * @returns {{ found: boolean, artifact?: Object, path?: string, reason?: string }}
 */
function findLatestArtifact(options) {
  try {
    if (!fs.existsSync(VERIFICATION_DIR)) {
      return { found: false, reason: 'No verifications directory exists' };
    }

    const files = fs.readdirSync(VERIFICATION_DIR)
      .filter(f => f.startsWith('smoke-test-') && f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first (by hash/name)

    for (const file of files) {
      const filePath = path.join(VERIFICATION_DIR, file);
      try {
        const artifact = safeJsonParse(filePath, null);
        if (!artifact) continue;

        // Verify HMAC signature
        const sigResult = verifyArtifactSignature(artifact);
        if (!sigResult.valid) continue;

        // Verify source hash freshness (F15: skip if not needed yet)
        if (!options?.lazyHash && !isArtifactFresh(artifact.sourceHash)) continue;
        if (options?.lazyHash && artifact.sourceHash && artifact.sourceHash !== 'unknown') {
          // Lazy: only compute hash when we found a candidate
          if (!isArtifactFresh(artifact.sourceHash)) continue;
        }

        return { found: true, artifact, path: filePath };
      } catch (_err) {
        continue;
      }
    }

    return { found: false, reason: 'No valid, fresh verification artifacts found' };
  } catch (_err) {
    return { found: false, reason: 'Error scanning verifications directory' };
  }
}

// ============================================================
// Route Inventory (High-Water-Mark)
// ============================================================

/**
 * Get the current route inventory.
 * @returns {{ routes: Array<{ path: string, addedAt: string, source: string }> }}
 */
function getRouteInventory() {
  return safeJsonParse(DEPLOY_ROUTES_PATH, { routes: [], lastUpdated: null });
}

/**
 * Add a route to the inventory (high-water-mark: never auto-removes).
 * @param {string} routePath - The route path (e.g., '/dashboard')
 * @param {string} [source] - Where it was discovered (e.g., 'registry-manager')
 * @returns {boolean} True if route was new and added
 */
function addRoute(routePath, source) {
  const inventory = getRouteInventory();
  const exists = inventory.routes.some(r => r.path === routePath);
  if (exists) return false;

  inventory.routes.push({
    path: routePath,
    addedAt: new Date().toISOString(),
    source: source || 'manual'
  });
  inventory.lastUpdated = new Date().toISOString();
  writeJson(DEPLOY_ROUTES_PATH, inventory);
  return true;
}

/**
 * Check if artifact covers all routes in the inventory.
 * @param {Object} artifact - Verification artifact
 * @returns {{ covered: boolean, missing: string[] }}
 */
function checkRouteCoverage(artifact) {
  const inventory = getRouteInventory();
  if (!inventory.routes || inventory.routes.length === 0) {
    return { covered: true, missing: [] };
  }

  const verifiedRoutes = new Set(
    (artifact.routes || []).map(r => typeof r === 'string' ? r : r.path)
  );

  const missing = inventory.routes
    .map(r => r.path)
    .filter(routePath => !verifiedRoutes.has(routePath));

  return {
    covered: missing.length === 0,
    missing
  };
}

// ============================================================
// Deploy Command Detection
// ============================================================

/**
 * Check if a Bash command matches any configured deploy command patterns.
 * @param {string} command - The Bash command to check
 * @param {Object} [config] - Config object
 * @returns {{ isDeployCommand: boolean, matchedPattern?: string }}
 */
function isDeployCommand(command, config) {
  const gateConfig = getDeployGateConfig(config);
  if (!gateConfig.commands || gateConfig.commands.length === 0) {
    return { isDeployCommand: false };
  }

  // Split on shell operators to check each sub-command (F8)
  const subCommands = command.split(/\s*(?:&&|\|\||;)\s*/).map(s => s.trim()).filter(Boolean);

  for (const sub of subCommands) {
    // Skip echo/grep/cat to avoid false positives on string mentions
    if (/^(echo|grep|cat|head|tail|less|printf)\s/.test(sub)) continue;

    for (const pattern of gateConfig.commands) {
      if (sub.startsWith(pattern)) {
        return { isDeployCommand: true, matchedPattern: pattern };
      }
    }
  }

  return { isDeployCommand: false };
}

// ============================================================
// Gate Checks (called by hooks)
// ============================================================

/**
 * Check deploy gate for a Bash command (PreToolUse).
 * @param {string} command - Bash command to check
 * @param {Object} [config] - Config object
 * @returns {{ allowed: boolean, blocked: boolean, reason?: string, message?: string }}
 */
function checkDeployGate(command, config) {
  if (!isDeployGateEnabled(config)) {
    return { allowed: true, blocked: false };
  }

  const deployCheck = isDeployCommand(command, config);
  if (!deployCheck.isDeployCommand) {
    return { allowed: true, blocked: false };
  }

  // This is a deploy command — check for verification artifact (F15: lazy hash)
  const artifactResult = findLatestArtifact({ lazyHash: true });
  if (!artifactResult.found) {
    return {
      allowed: false,
      blocked: true,
      reason: 'deploy-gate-no-artifact',
      message: `DEPLOY BLOCKED: No valid verification artifact found.\n\n` +
        `Matched pattern: "${deployCheck.matchedPattern}"\n` +
        `Reason: ${artifactResult.reason}\n\n` +
        `To proceed, run verification first:\n` +
        `  1. Run the smoke test / browser verification for this task\n` +
        `  2. The verification script will generate a signed artifact\n` +
        `  3. Then retry the deploy command\n\n` +
        `This gate ensures code is tested before deployment.`
    };
  }

  // Artifact exists and is valid — check verification breadth
  const gateConfig = getDeployGateConfig(config);
  const verifiedRoutes = artifactResult.artifact.routes || [];
  const routePaths = verifiedRoutes.map(r => typeof r === 'string' ? r : r.path);

  if (gateConfig.rejectLoginOnly && routePaths.length > 0) {
    const loginOnlyPaths = new Set(['/', '/login', '/signin', '/auth', '/auth/login']);
    const allLoginOnly = routePaths.every(r => loginOnlyPaths.has(r));
    if (allLoginOnly) {
      return {
        allowed: false,
        blocked: true,
        reason: 'deploy-gate-login-only',
        message: `DEPLOY BLOCKED: Verification only covers login/home page.\n\n` +
          `Verified routes: ${routePaths.join(', ')}\n\n` +
          `Verifying only the login page doesn't prove the app works.\n` +
          `The smoke test must cover at least ${gateConfig.minVerifiedRoutes} distinct routes\n` +
          `including the routes affected by this task.`
      };
    }
  }

  if (routePaths.length < gateConfig.minVerifiedRoutes && routePaths.length > 0) {
    return {
      allowed: false,
      blocked: true,
      reason: 'deploy-gate-insufficient-breadth',
      message: `DEPLOY BLOCKED: Verification covers only ${routePaths.length} route(s) (minimum: ${gateConfig.minVerifiedRoutes}).\n\n` +
        `Verified: ${routePaths.join(', ')}\n\n` +
        `Broaden the smoke test to cover more routes.`
    };
  }

  // Check route inventory coverage
  const coverage = checkRouteCoverage(artifactResult.artifact);
  if (!coverage.covered) {
    return {
      allowed: false,
      blocked: true,
      reason: 'deploy-gate-missing-routes',
      message: `DEPLOY BLOCKED: Verification artifact doesn't cover all routes.\n\n` +
        `Missing routes: ${coverage.missing.join(', ')}\n\n` +
        `The route inventory requires these routes to be verified.\n` +
        `Either verify them or remove from inventory if intentionally deleted.`
    };
  }

  return { allowed: true, blocked: false };
}

/**
 * Check deploy gate for Write operations (blocks fake artifact creation).
 * @param {string} filePath - File being written
 * @param {Object} [config] - Config object
 * @returns {{ allowed: boolean, blocked: boolean, reason?: string, message?: string }}
 */
function checkWriteBlock(filePath, config) {
  if (!isDeployGateEnabled(config)) {
    return { allowed: true, blocked: false };
  }

  const gateConfig = getDeployGateConfig(config);
  if (!gateConfig.blockWriteToVerifications) {
    return { allowed: true, blocked: false };
  }

  // Block direct Write to smoke-test artifacts
  if (filePath && path.basename(filePath).startsWith('smoke-test-') &&
      filePath.includes('verifications') && filePath.endsWith('.json')) {
    return {
      allowed: false,
      blocked: true,
      reason: 'deploy-gate-write-block',
      message: `WRITE BLOCKED: Cannot directly write verification artifacts.\n\n` +
        `Verification artifacts must be generated by the verification script ` +
        `(flow-runtime-verification.js) which signs them with an HMAC key.\n` +
        `Direct writes will not produce a valid signature.`
    };
  }

  return { allowed: true, blocked: false };
}

/**
 * Check if task completion should be blocked due to missing verification.
 * Called by task-completed hook for P0/P1 tasks.
 * @param {Object} task - Task object from ready.json
 * @param {Object} [config] - Config object
 * @returns {{ blocked: boolean, reason?: string }}
 */
function checkCompletionGate(task, config) {
  if (!isDeployGateEnabled(config)) {
    return { blocked: false };
  }

  const gateConfig = getDeployGateConfig(config);
  const priority = task.priority || 'P2';

  if (!gateConfig.requireForPriorities.includes(priority)) {
    return { blocked: false };
  }

  const artifactResult = findLatestArtifact();
  if (!artifactResult.found) {
    return {
      blocked: true,
      reason: `Task completion blocked for ${priority} task: no valid verification artifact.\n` +
        `${artifactResult.reason}\n` +
        `Run verification (smoke test / browser check) before marking this task complete.`
    };
  }

  return { blocked: false };
}

// ============================================================
// Deploy History
// ============================================================

/**
 * Record a successful deployment.
 * Called after deploy command succeeds (by post-tool-use or manually).
 * @param {Object} deployInfo
 * @param {string} deployInfo.commitHash - Git commit hash
 * @param {string} [deployInfo.environment] - Deploy environment
 * @param {string} [deployInfo.verificationArtifact] - Path to verification artifact used
 */
function recordDeploy(deployInfo) {
  const history = safeJsonParse(DEPLOY_HISTORY_PATH, { deploys: [] });

  history.deploys.unshift({
    commitHash: deployInfo.commitHash,
    timestamp: new Date().toISOString(),
    environment: deployInfo.environment || 'unknown',
    verificationArtifact: deployInfo.verificationArtifact || null
  });

  // Keep last 50 deploys
  if (history.deploys.length > 50) {
    history.deploys = history.deploys.slice(0, 50);
  }

  writeJson(DEPLOY_HISTORY_PATH, history);
}

/**
 * Get the last known-good deployment.
 * @returns {{ found: boolean, deploy?: Object }}
 */
function getLastGoodDeploy() {
  const history = safeJsonParse(DEPLOY_HISTORY_PATH, { deploys: [] });
  if (history.deploys.length === 0) {
    return { found: false };
  }
  return { found: true, deploy: history.deploys[0] };
}

// ============================================================
// Artifact Creation Helper
// ============================================================

/**
 * Create a signed verification artifact.
 * Called by flow-runtime-verification.js after tests pass.
 * @param {Object} data - Verification results
 * @param {Array} data.routes - Verified routes with results
 * @param {string} data.method - Verification method (webmcp/playwright/checklist/api-test)
 * @param {string} data.taskId - Task that was verified
 * @param {Object[]} [data.criteria] - Criterion results
 * @returns {string} Path to the created artifact
 */
function createSignedArtifact(data) {
  const sourceHash = computeSourceHash();

  const artifact = {
    version: 1,
    taskId: data.taskId,
    method: data.method,
    sourceHash,
    routes: data.routes || [],
    criteria: data.criteria || [],
    createdAt: new Date().toISOString(),
    evidenceTier: data.evidenceTier || 2
  };

  // Sign the artifact
  artifact.signature = signArtifact(artifact);

  // Write to verifications directory
  fs.mkdirSync(VERIFICATION_DIR, { recursive: true });
  const fileName = `smoke-test-${sourceHash.slice(0, 12)}.json`;
  const filePath = path.join(VERIFICATION_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), 'utf-8');

  return filePath;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  isDeployGateEnabled,
  getDeployGateConfig,

  // Gate checks (used by hooks)
  checkDeployGate,
  checkWriteBlock,
  checkCompletionGate,

  // Artifact management
  signArtifact,
  verifyArtifactSignature,
  findLatestArtifact,
  createSignedArtifact,

  // Source hashing
  computeSourceHash,
  isArtifactFresh,

  // Route inventory
  getRouteInventory,
  addRoute,
  checkRouteCoverage,

  // Deploy history
  recordDeploy,
  getLastGoodDeploy,

  // Constants
  VERIFICATION_DIR,
  DEPLOY_ROUTES_PATH,
  DEPLOY_HISTORY_PATH
};
