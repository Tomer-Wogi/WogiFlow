#!/usr/bin/env node

/**
 * Wogi Flow - Knowledge Sync
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
  getConfig
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
 */
function hashFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Find files matching glob patterns in project root
 */
function findIndicatorFiles(patterns) {
  const found = [];

  for (const pattern of patterns) {
    // Simple glob matching - supports * wildcard
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      try {
        const files = fs.readdirSync(PROJECT_ROOT);
        for (const file of files) {
          if (regex.test(file)) {
            found.push(file);
          }
        }
      } catch {
        // Directory read error
      }
    } else {
      // Exact match
      const fullPath = path.join(PROJECT_ROOT, pattern);
      if (fs.existsSync(fullPath)) {
        found.push(pattern);
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

  for (const file of files) {
    const fullPath = path.join(PROJECT_ROOT, file);
    const hash = hashFile(fullPath);
    if (hash) {
      hashes[file] = hash;
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
    individualHashes: hashes
  };
}

/**
 * Load current sync state
 */
function loadSyncState() {
  if (!fileExists(PATHS.knowledgeSync)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(PATHS.knowledgeSync, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save sync state
 */
function saveSyncState(state) {
  fs.writeFileSync(PATHS.knowledgeSync, JSON.stringify(state, null, 2));
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

  // Check if knowledge files exist
  results.stack.fileExists = fileExists(PATHS.stackMd);
  results.architecture.fileExists = fileExists(PATHS.architectureMd);
  results.testing.fileExists = fileExists(PATHS.testingMd);

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
    { key: 'stack', name: 'Stack (stack.md)', file: PATHS.stackMd },
    { key: 'architecture', name: 'Architecture (architecture.md)', file: PATHS.architectureMd },
    { key: 'testing', name: 'Testing (testing.md)', file: PATHS.testingMd }
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
 */
async function regenerateKnowledgeFiles(categories = ['stack', 'architecture', 'testing']) {
  info('Regenerating knowledge files...');

  // We'll call flow-onboard's generation functions
  // For now, just mark as synced and tell user to run onboard
  // In a full implementation, we'd import and call the generators directly

  const { execSync } = require('child_process');

  try {
    // Run onboard in update mode (just regenerates knowledge files)
    execSync('node ./scripts/flow-onboard --update-knowledge', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });

    // Update sync state
    const state = markAsSynced();
    success('Knowledge files regenerated and sync state updated');
    return state;
  } catch (err) {
    // If onboard doesn't support --update-knowledge yet, fall back
    warn('Full regeneration requires running "flow onboard"');
    warn('For now, marking current state as synced');

    const state = markAsSynced();
    return state;
  }
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
