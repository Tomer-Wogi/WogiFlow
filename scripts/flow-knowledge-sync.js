#!/usr/bin/env node

/**
 * Wogi Flow - Knowledge Sync
 *
 * See MEMORY-ARCHITECTURE.md for how this fits with other memory/knowledge modules.
 *
 * Detects drift in knowledge files (stack.md, architecture.md, testing.md)
 * by tracking hashes of project indicator files.
 *
 * Usage:
 *   flow knowledge-sync status     Check sync status
 *   flow knowledge-sync check      Check and report drift
 *   flow knowledge-sync regenerate Regenerate stale knowledge files
 *   flow knowledge-sync --json     JSON output
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  PATHS,
  PROJECT_ROOT,
  fileExists,
  dirExists,
  parseFlags,
  outputJson,
  printHeader,
  printSection,
  color,
  success,
  warn,
  error,
  info,
  getConfig,
  isPathWithinProject,
  safeJsonParse,
  writeJson,
  getSpecFilePath
} = require('./flow-utils');

// Files that indicate stack/architecture changes
const STACK_INDICATORS = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'requirements.txt',
  'Pipfile',
  'Gemfile',
  'go.mod',
  'Cargo.toml',
  'build.gradle',
  'pom.xml',
];

// Files that indicate architecture changes
const ARCHITECTURE_INDICATORS = [
  'tsconfig.json',
  'tsconfig.*.json',
  'jsconfig.json',
  '.eslintrc*',
  '.prettierrc*',
  'webpack.config.*',
  'vite.config.*',
  'next.config.*',
  'nuxt.config.*',
  'angular.json',
  'nest-cli.json',
  '.babelrc*',
  'rollup.config.*',
];

// Files that indicate testing changes
const TESTING_INDICATORS = [
  'jest.config.*',
  'vitest.config.*',
  'cypress.config.*',
  'playwright.config.*',
  '.mocharc*',
  'karma.conf.*',
  'pytest.ini',
  'setup.py',
  'tox.ini',
  'phpunit.xml',
];

/**
 * Compute MD5 hash of file content
 * @param {string} filePath - Path to file
 * @returns {{hash: string|null, error: string|null}} Hash result with error context
 */
function hashFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { hash: null, error: 'not_found' };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return { hash: crypto.createHash('md5').update(content).digest('hex'), error: null };
  } catch (err) {
    // Provide error context for debugging
    const errorType = err.code === 'EACCES' ? 'permission_denied' :
                      err.code === 'EISDIR' ? 'is_directory' :
                      'read_error';
    return { hash: null, error: errorType };
  }
}

/**
 * Escape all regex special characters except * which becomes .*
 * @param {string} pattern - Glob pattern
 * @returns {string} Regex-safe string
 */
function escapeGlobToRegex(pattern) {
  // Escape all regex special chars except *
  return pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars
    .replace(/\*/g, '[^/]*');                 // Convert * to non-path-separator match
}

/**
 * Validate pattern contains only safe characters
 * @param {string} pattern - Pattern to validate
 * @returns {boolean} True if safe
 */
function isSafePattern(pattern) {
  // Block parent directory traversal attempts
  if (pattern.includes('..')) return false;
  // Only allow alphanumeric, -, _, ., and *
  return /^[a-zA-Z0-9._*-]+$/.test(pattern);
}

/**
 * Find files matching glob patterns in project root
 */
function findIndicatorFiles(patterns) {
  const found = [];

  for (const pattern of patterns) {
    // Validate pattern is safe
    if (!isSafePattern(pattern)) {
      warn(`Skipping unsafe pattern: ${pattern}`);
      continue;
    }

    // Simple glob matching - supports * wildcard
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + escapeGlobToRegex(pattern) + '$');
      try {
        const files = fs.readdirSync(PROJECT_ROOT);
        for (const file of files) {
          // Skip hidden files and symlinks for safety
          const fullPath = path.join(PROJECT_ROOT, file);
          try {
            const stat = fs.lstatSync(fullPath);
            if (stat.isSymbolicLink()) continue;
          } catch {
            continue;
          }

          if (regex.test(file)) {
            found.push(file);
          }
        }
      } catch {
        // Directory read error - silently skip
      }
    } else {
      // Exact match
      const fullPath = path.join(PROJECT_ROOT, pattern);

      // Defense in depth: verify resolved path is within project
      if (!isPathWithinProject(fullPath)) {
        warn(`Path traversal blocked: ${pattern}`);
        continue;
      }

      try {
        // Check it exists and is not a symlink
        const stat = fs.lstatSync(fullPath);
        if (!stat.isSymbolicLink() && fs.existsSync(fullPath)) {
          found.push(pattern);
        }
      } catch {
        // File doesn't exist - skip
      }
    }
  }

  return found;
}

/**
 * Compute hashes for a category of indicator files
 */
function computeCategoryHashes(patterns) {
  const files = findIndicatorFiles(patterns);
  const hashes = {};
  const errors = {};

  for (const file of files) {
    const fullPath = path.join(PROJECT_ROOT, file);

    // Defense in depth: double-check path is within project
    if (!isPathWithinProject(fullPath)) {
      errors[file] = 'path_traversal';
      continue;
    }

    const result = hashFile(fullPath);
    if (result.hash) {
      hashes[file] = result.hash;
    } else if (result.error && result.error !== 'not_found') {
      // Track non-trivial errors for debugging
      errors[file] = result.error;
    }
  }

  // Return combined hash of all files
  const combined = Object.entries(hashes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, hash]) => `${file}:${hash}`)
    .join('|');

  return {
    files: Object.keys(hashes),
    combinedHash: combined ? crypto.createHash('md5').update(combined).digest('hex') : null,
    individualHashes: hashes,
    errors: Object.keys(errors).length > 0 ? errors : null
  };
}

/**
 * Validate sync state structure
 * @param {Object} state - Parsed state object
 * @returns {boolean} True if valid structure
 */
function isValidSyncState(state) {
  if (!state || typeof state !== 'object') {
    return false;
  }

  // lastSync is optional but must be string if present
  if (state.lastSync !== undefined && typeof state.lastSync !== 'string') {
    return false;
  }

  // Validate each category if present
  const categories = ['stack', 'architecture', 'testing'];
  for (const cat of categories) {
    if (state[cat] !== undefined) {
      const catData = state[cat];
      if (typeof catData !== 'object' || catData === null) {
        return false;
      }
      // combinedHash should be string or null
      if (catData.combinedHash !== undefined &&
          catData.combinedHash !== null &&
          typeof catData.combinedHash !== 'string') {
        return false;
      }
      // individualHashes should be object if present
      if (catData.individualHashes !== undefined &&
          (typeof catData.individualHashes !== 'object' || catData.individualHashes === null)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Load current sync state
 */
function loadSyncState() {
  if (!fileExists(PATHS.knowledgeSync)) {
    return null;
  }

  // safeJsonParse expects a file path, not content
  const state = safeJsonParse(PATHS.knowledgeSync, null);

  // Validate structure before returning
  if (!isValidSyncState(state)) {
    warn('Invalid sync state structure in knowledge-sync.json');
    return null;
  }

  return state;
}

/**
 * Save sync state using atomic write pattern
 */
function saveSyncState(state) {
  writeJson(PATHS.knowledgeSync, state);
}

/**
 * Check drift for a specific knowledge file category
 */
function checkCategoryDrift(category, indicators, syncState) {
  const current = computeCategoryHashes(indicators);
  const stored = syncState?.[category];

  if (!stored) {
    return {
      category,
      status: 'missing',
      reason: 'No sync state recorded',
      needsRegeneration: true,
      currentHash: current.combinedHash,
      storedHash: null,
      files: current.files
    };
  }

  if (current.combinedHash !== stored.combinedHash) {
    // Find which files changed
    const changedFiles = [];
    for (const [file, hash] of Object.entries(current.individualHashes)) {
      if (stored.individualHashes?.[file] !== hash) {
        changedFiles.push(file);
      }
    }
    // Check for removed files
    for (const file of Object.keys(stored.individualHashes || {})) {
      if (!current.individualHashes[file]) {
        changedFiles.push(`${file} (removed)`);
      }
    }

    return {
      category,
      status: 'drifted',
      reason: `Files changed: ${changedFiles.join(', ')}`,
      needsRegeneration: true,
      currentHash: current.combinedHash,
      storedHash: stored.combinedHash,
      changedFiles,
      files: current.files
    };
  }

  return {
    category,
    status: 'synced',
    reason: 'Hashes match',
    needsRegeneration: false,
    currentHash: current.combinedHash,
    storedHash: stored.combinedHash,
    files: current.files
  };
}

/**
 * Check all knowledge file categories for drift
 */
function checkAllDrift() {
  const syncState = loadSyncState();

  const results = {
    stack: checkCategoryDrift('stack', STACK_INDICATORS, syncState),
    architecture: checkCategoryDrift('architecture', ARCHITECTURE_INDICATORS, syncState),
    testing: checkCategoryDrift('testing', TESTING_INDICATORS, syncState)
  };

  // Check if knowledge files exist (checks new specs/ location first, then old state/)
  results.stack.fileExists = getSpecFilePath('stack', { warnOnOld: false }) !== null;
  results.architecture.fileExists = getSpecFilePath('architecture', { warnOnOld: false }) !== null;
  results.testing.fileExists = getSpecFilePath('testing', { warnOnOld: false }) !== null;

  // Overall status
  const anyDrift = Object.values(results).some(r => r.needsRegeneration);
  const anyMissing = !results.stack.fileExists || !results.architecture.fileExists || !results.testing.fileExists;

  return {
    overall: anyDrift || anyMissing ? 'stale' : 'synced',
    lastSync: syncState?.lastSync || null,
    categories: results,
    anyDrift,
    anyMissing
  };
}

/**
 * Update sync state after regeneration
 */
function markAsSynced() {
  const state = {
    lastSync: new Date().toISOString(),
    stack: computeCategoryHashes(STACK_INDICATORS),
    architecture: computeCategoryHashes(ARCHITECTURE_INDICATORS),
    testing: computeCategoryHashes(TESTING_INDICATORS)
  };

  saveSyncState(state);
  return state;
}

/**
 * Print human-readable status
 */
function printStatus(driftStatus) {
  printHeader('KNOWLEDGE FILES SYNC STATUS');

  if (driftStatus.lastSync) {
    info(`Last synced: ${driftStatus.lastSync}`);
  } else {
    warn('Never synced - run "flow onboard" or "flow knowledge-sync regenerate"');
  }

  console.log('');

  const categories = [
    { key: 'stack', name: 'Stack (stack.md)', file: getSpecFilePath('stack', { warnOnOld: false, preferNew: true }) },
    { key: 'architecture', name: 'Architecture (architecture.md)', file: getSpecFilePath('architecture', { warnOnOld: false, preferNew: true }) },
    { key: 'testing', name: 'Testing (testing.md)', file: getSpecFilePath('testing', { warnOnOld: false, preferNew: true }) }
  ];

  for (const { key, name, file } of categories) {
    const status = driftStatus.categories[key];
    printSection(name);

    // File existence
    if (status.fileExists) {
      console.log(`  ${color('green', '✓')} File exists`);
    } else {
      console.log(`  ${color('red', '✗')} File missing`);
    }

    // Sync status
    if (status.status === 'synced') {
      console.log(`  ${color('green', '✓')} In sync`);
    } else if (status.status === 'drifted') {
      console.log(`  ${color('yellow', '⚠')} Drifted: ${status.reason}`);
    } else {
      console.log(`  ${color('yellow', '○')} ${status.reason}`);
    }

    // Indicator files
    if (status.files.length > 0) {
      console.log(`  Tracked files: ${status.files.join(', ')}`);
    }

    console.log('');
  }

  // Overall recommendation
  printSection('📌 Recommendation');
  if (driftStatus.overall === 'synced') {
    console.log(`  ${color('green', '✓')} All knowledge files are up to date`);
  } else if (driftStatus.anyMissing) {
    console.log(`  Run: ${color('cyan', 'flow onboard')} to generate missing files`);
  } else if (driftStatus.anyDrift) {
    console.log(`  Run: ${color('cyan', 'flow knowledge-sync regenerate')} to update drifted files`);
  }

  console.log('');
}

/**
 * Regenerate knowledge files using onboard generators
 * @param {string[]} categories - Categories to regenerate
 * @returns {Promise<Object>} New sync state or null if failed
 */
async function regenerateKnowledgeFiles(categories = ['stack', 'architecture', 'testing']) {
  info('Regenerating knowledge files...');

  const { spawn } = require('child_process');

  return new Promise((resolve, reject) => {
    // Use spawn without shell to prevent command injection
    // Node.js respects shebangs natively when executing scripts directly
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'flow-onboard');
    const child = spawn(scriptPath, ['--update-knowledge'], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });

    child.on('error', (err) => {
      // Spawn failed (e.g., script not found, permission denied)
      error(`Failed to spawn process: ${err.message}`);
      warn('Run "flow onboard" manually to regenerate knowledge files');
      reject(new Error(`Spawn failed: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Success - update sync state
        const state = markAsSynced();
        success('Knowledge files regenerated and sync state updated');
        resolve(state);
      } else if (code === null) {
        // Process was killed - not an error, just cancelled
        warn('Regeneration process was terminated');
        resolve(null);
      } else {
        // Non-zero exit - onboard command may not support --update-knowledge
        warn(`Onboard exited with code ${code}`);
        info('The --update-knowledge flag may not be supported yet.');
        info('Options:');
        info('  1. Run "flow onboard" to regenerate all knowledge files');
        info('  2. Run "flow knowledge-sync mark-synced" to accept current state');
        // Reject so caller knows regeneration failed
        reject(new Error(`Onboard exited with code ${code}`));
      }
    });
  });
}

/**
 * Main entry point
 */
async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const command = positional[0] || 'status';

  const driftStatus = checkAllDrift();

  // JSON output
  if (flags.json) {
    outputJson({
      success: true,
      command,
      ...driftStatus
    });
    return;
  }

  switch (command) {
    case 'status':
    case 'check':
      printStatus(driftStatus);
      // Exit with code 1 if stale (useful for CI)
      process.exit(driftStatus.overall === 'stale' ? 1 : 0);
      break;

    case 'regenerate':
    case 'sync':
    case 'update':
      if (driftStatus.overall === 'synced' && !flags.force) {
        success('Knowledge files are already in sync');
        info('Use --force to regenerate anyway');
        return;
      }
      await regenerateKnowledgeFiles();
      break;

    case 'mark-synced':
      // Manual mark as synced (for testing or after manual edits)
      markAsSynced();
      success('Sync state updated');
      break;

    default:
      error(`Unknown command: ${command}`);
      console.log('');
      console.log('Usage:');
      console.log('  flow knowledge-sync status      Check sync status');
      console.log('  flow knowledge-sync check       Check and report drift');
      console.log('  flow knowledge-sync regenerate  Regenerate stale files');
      console.log('  flow knowledge-sync mark-synced Mark current state as synced');
      console.log('');
      console.log('Options:');
      console.log('  --json   Output in JSON format');
      console.log('  --force  Force regeneration even if synced');
      process.exit(1);
  }
}

// Export for use by other scripts
module.exports = {
  checkAllDrift,
  checkCategoryDrift,
  markAsSynced,
  loadSyncState,
  computeCategoryHashes,
  STACK_INDICATORS,
  ARCHITECTURE_INDICATORS,
  TESTING_INDICATORS
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
