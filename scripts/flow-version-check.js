/**
 * flow-version-check.js
 *
 * Version compatibility and update checks.
 * Called at session start with two independent checks:
 *
 * 1. Claude Code compatibility: checks once per install/update
 *    - Hard minimum (2.1.23): Hooks don't work below this — always warn
 *    - Soft gates (2.1.50+, 2.1.72+): Degrade gracefully, no warning
 *
 * 2. WogiFlow npm update: checks once per 24h
 *    - Fetches latest version from npm registry
 *    - Warns if local version is outdated
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { PATHS, meetsVersion, readJson, safeJsonParse } = require('./flow-utils');

const VERSION_CHECK_PATH = path.join(PATHS.state, '.version-check.json');

// Hard minimum: below this, hooks literally don't work
const HARD_MIN = { major: 2, minor: 1, patch: 23 };

/**
 * Get the current Claude Code version.
 * @returns {string|null} Version string or null if not detectable
 */
function getClaudeCodeVersion() {
  try {
    const output = execSync('claude --version 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000
    }).trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Read the last version check result.
 * @returns {{ version: string, checkedAt: string, wogiflowVersion: string } | null}
 */
function readLastCheck() {
  return safeJsonParse(VERSION_CHECK_PATH, null);
}

/**
 * Save the version check result.
 */
function saveCheck(version) {
  const savePkg = readJson(path.join(__dirname, '..', 'package.json'), null);
  const wogiflowVersion = savePkg?.version || 'unknown';

  const data = {
    version: version,
    checkedAt: new Date().toISOString(),
    wogiflowVersion: wogiflowVersion
  };

  try {
    fs.mkdirSync(path.dirname(VERSION_CHECK_PATH), { recursive: true });
    fs.writeFileSync(VERSION_CHECK_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[version-check] Failed to save: ${err.message}`);
    }
  }
}

/**
 * Check Claude Code version compatibility once per install/update.
 *
 * Returns a warning string if the version is below the hard minimum,
 * or null if everything is fine (or if already checked this install).
 *
 * @returns {string|null} Warning message or null
 */
function checkClaudeCodeVersionOnce() {
  // Check if we already ran since last install/update
  const lastCheck = readLastCheck();

  const oncePkg = readJson(path.join(__dirname, '..', 'package.json'), null);
  const wogiflowVersion = oncePkg?.version || 'unknown';

  // Skip if already checked for this WogiFlow version
  if (lastCheck && lastCheck.wogiflowVersion === wogiflowVersion) {
    // But still return the warning if last check found an issue
    if (lastCheck.version) {
      const [major, minor, patch] = lastCheck.version.split('.').map(Number);
      if (!meetsVersion(major, minor, patch, HARD_MIN.major, HARD_MIN.minor, HARD_MIN.patch)) {
        return `Claude Code ${lastCheck.version} is below the minimum required version (${HARD_MIN.major}.${HARD_MIN.minor}.${HARD_MIN.patch}). WogiFlow hooks will not work correctly. Update with: npm install -g @anthropic-ai/claude-code@latest`;
      }
    }
    return null;
  }

  // Run the check
  const version = getClaudeCodeVersion();
  saveCheck(version);

  if (!version) {
    // Can't detect version — don't warn (might be running in a non-standard environment)
    return null;
  }

  const [major, minor, patch] = version.split('.').map(Number);

  if (!meetsVersion(major, minor, patch, HARD_MIN.major, HARD_MIN.minor, HARD_MIN.patch)) {
    return `Claude Code ${version} is below the minimum required version (${HARD_MIN.major}.${HARD_MIN.minor}.${HARD_MIN.patch}). WogiFlow hooks will not work correctly. Update with: npm install -g @anthropic-ai/claude-code@latest`;
  }

  // Soft gates — generate informational warning listing disabled features
  const SOFT_GATES = [
    { version: [2, 1, 50], features: 'worktree hooks, agent isolation' },
    { version: [2, 1, 72], features: 'ConfigChange/InstructionsLoaded hooks, effort levels' },
    { version: [2, 1, 76], features: 'PostCompact hook (state recovery after compaction)' },
    { version: [2, 1, 77], features: 'Elicitation hooks, worktree sparse checkout, 128k output tokens, compaction circuit breaker' },
  ];

  const disabledFeatures = SOFT_GATES
    .filter(gate => !meetsVersion(major, minor, patch, ...gate.version))
    .map(gate => `  - ${gate.features} (requires ${gate.version.join('.')}+)`);

  if (disabledFeatures.length > 0) {
    return `Claude Code ${version} — some WogiFlow features are disabled:\n${disabledFeatures.join('\n')}\nUpdate for full functionality: npm i -g @anthropic-ai/claude-code@latest`;
  }

  return null;
}

// --- WogiFlow npm update check ---

const UPDATE_CHECK_PATH = path.join(PATHS.state, '.update-check.json');
const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get the installed WogiFlow version from package.json.
 * @returns {string} Version string or 'unknown'
 */
function getLocalWogiFlowVersion() {
  const pkg = readJson(path.join(__dirname, '..', 'package.json'), null);
  return pkg?.version || 'unknown';
}

/**
 * Fetch the latest WogiFlow version from the npm registry.
 * Uses a short timeout to avoid blocking session start.
 * @returns {string|null} Latest version or null on failure
 */
function fetchLatestNpmVersion() {
  try {
    const output = execSync(
      'npm view wogiflow version 2>/dev/null || echo ""',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
    ).trim();
    const match = output.match(/^(\d+\.\d+\.\d+)$/);
    return match ? match[1] : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Compare two semver strings. Returns true if remote is newer than local.
 * @param {string} local - e.g. "1.9.4"
 * @param {string} remote - e.g. "1.9.5"
 * @returns {boolean}
 */
function isNewerVersion(local, remote) {
  const [lMaj, lMin, lPat] = local.split('.').map(Number);
  const [rMaj, rMin, rPat] = remote.split('.').map(Number);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

/**
 * Check if a newer WogiFlow version is available on npm.
 * Checks at most once per 24 hours to avoid unnecessary network calls.
 *
 * @returns {string|null} Warning message if outdated, null otherwise
 */
function checkWogiFlowUpdateOnce() {
  const localVersion = getLocalWogiFlowVersion();
  if (localVersion === 'unknown') return null;

  // Check cached result
  const data = safeJsonParse(UPDATE_CHECK_PATH, null);
  if (data) {
    const age = Date.now() - new Date(data.checkedAt).getTime();
    if (age < UPDATE_CHECK_TTL_MS && data.localVersion === localVersion) {
      // Still within TTL and same local version — return cached result
      if (data.latestVersion && isNewerVersion(localVersion, data.latestVersion)) {
        return `WogiFlow ${localVersion} is outdated. Latest: ${data.latestVersion}. Update with: npm install -D wogiflow@latest`;
      }
      return null;
    }
  }

  // Fetch from npm
  const latestVersion = fetchLatestNpmVersion();

  // Cache the result (even if null — prevents retrying on every session)
  try {
    fs.mkdirSync(path.dirname(UPDATE_CHECK_PATH), { recursive: true });
    fs.writeFileSync(UPDATE_CHECK_PATH, JSON.stringify({
      localVersion,
      latestVersion: latestVersion || null,
      checkedAt: new Date().toISOString()
    }, null, 2));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[version-check] Failed to cache update check: ${err.message}`);
    }
  }

  if (!latestVersion) return null;

  if (isNewerVersion(localVersion, latestVersion)) {
    return `WogiFlow ${localVersion} is outdated. Latest: ${latestVersion}. Update with: npm install -D wogiflow@latest`;
  }

  return null;
}

module.exports = { checkClaudeCodeVersionOnce, getClaudeCodeVersion, checkWogiFlowUpdateOnce };
