'use strict';

/**
 * Wogi Flow - Path Constants and Utilities
 *
 * Extracted from flow-utils.js for modularity.
 * Contains all path-related constants and utilities.
 *
 * Usage:
 *   const { PATHS, PROJECT_ROOT, getProjectRoot } = require('./flow-paths');
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// Project Root Detection
// ============================================================

/**
 * Find the project root directory using multiple strategies:
 * 1. Git root (most reliable in monorepos and submodules)
 * 2. Walk up looking for .workflow directory
 * 3. Fall back to process.cwd()
 *
 * @returns {string} Absolute path to project root
 */
function getProjectRoot() {
  // Strategy 1: Try git root (works in submodules, worktrees, and nested repos)
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'] // Suppress stderr
    }).trim();

    if (gitRoot && fs.existsSync(gitRoot)) {
      // Verify this git root has .workflow (could be parent repo in monorepo)
      if (fs.existsSync(path.join(gitRoot, '.workflow'))) {
        return gitRoot;
      }
    }
  } catch {
    // Not in a git repo or git not available
  }

  // Strategy 2: Walk up from cwd looking for .workflow
  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    const workflowPath = path.join(current, '.workflow');
    if (fs.existsSync(workflowPath) && fs.statSync(workflowPath).isDirectory()) {
      return current;
    }
    current = path.dirname(current);
  }

  // Strategy 3: Fall back to cwd (for new projects without .workflow yet)
  return process.cwd();
}

// ============================================================
// Paths
// ============================================================

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const CLAUDE_DIR = path.join(PROJECT_ROOT, '.claude');

const PATHS = {
  root: PROJECT_ROOT,
  workflow: WORKFLOW_DIR,
  state: STATE_DIR,
  claude: CLAUDE_DIR,
  config: path.join(WORKFLOW_DIR, 'config.json'),
  ready: path.join(STATE_DIR, 'ready.json'),
  requestLog: path.join(STATE_DIR, 'request-log.md'),
  appMap: path.join(STATE_DIR, 'app-map.md'),
  decisions: path.join(STATE_DIR, 'decisions.md'),
  progress: path.join(STATE_DIR, 'progress.md'),
  feedbackPatterns: path.join(STATE_DIR, 'feedback-patterns.md'),
  components: path.join(STATE_DIR, 'components'),
  changes: path.join(WORKFLOW_DIR, 'changes'),
  bugs: path.join(WORKFLOW_DIR, 'bugs'),
  archive: path.join(WORKFLOW_DIR, 'archive'),
  specs: path.join(WORKFLOW_DIR, 'specs'),
  // Hierarchical work item directories (v3.2)
  epics: path.join(WORKFLOW_DIR, 'epics'),
  features: path.join(WORKFLOW_DIR, 'features'),
  plans: path.join(WORKFLOW_DIR, 'plans'),
  // Additional workflow directories
  runs: path.join(WORKFLOW_DIR, 'runs'),
  checkpoints: path.join(WORKFLOW_DIR, 'checkpoints'),
  corrections: path.join(WORKFLOW_DIR, 'corrections'),
  traces: path.join(WORKFLOW_DIR, 'traces'),
  // Advanced workflow features
  commandMetrics: path.join(STATE_DIR, 'command-metrics.json'),
  modelStats: path.join(STATE_DIR, 'model-stats.json'),
  approaches: path.join(STATE_DIR, 'approaches'),
  modelAdapters: path.join(WORKFLOW_DIR, 'model-adapters'),
  codebaseInsights: path.join(STATE_DIR, 'codebase-insights.md'),
  // Claude Code integration (v2.1.0)
  skills: path.join(CLAUDE_DIR, 'skills'),
  rules: path.join(CLAUDE_DIR, 'rules'),
  commands: path.join(CLAUDE_DIR, 'commands'),
  // Smart Context System (Phase 1)
  sectionIndex: path.join(STATE_DIR, 'section-index.json'),
  // Knowledge files (Phase 0.4 - synced documentation)
  // NOTE: These are DEPRECATED - use specsStack, specsArchitecture, specsTesting instead
  // Kept for backward compatibility, will be removed in v2.0
  stackMd: path.join(STATE_DIR, 'stack.md'),
  architectureMd: path.join(STATE_DIR, 'architecture.md'),
  testingMd: path.join(STATE_DIR, 'testing.md'),
  knowledgeSync: path.join(STATE_DIR, 'knowledge-sync.json'),
  // Spec files (v1.0.4 - moved from state/ to specs/)
  specsStack: path.join(WORKFLOW_DIR, 'specs', 'stack.md'),
  specsArchitecture: path.join(WORKFLOW_DIR, 'specs', 'architecture.md'),
  specsTesting: path.join(WORKFLOW_DIR, 'specs', 'testing.md'),
  // Research Protocol (v1.0.48)
  researchCache: path.join(STATE_DIR, 'research-cache.json'),
  // Model Registry & Stats (v1.8.2)
  modelsDir: path.join(WORKFLOW_DIR, 'models'),
  modelRegistry: path.join(WORKFLOW_DIR, 'models', 'registry.json'),
  modelStats: path.join(WORKFLOW_DIR, 'models', 'stats.json'),
};

// ============================================================
// Path Validation
// ============================================================

/**
 * Check if a path is within the project directory (prevents path traversal)
 * @param {string} targetPath - Path to validate
 * @param {string} [baseDir=PROJECT_ROOT] - Base directory to check against
 * @returns {boolean} True if path is within base directory
 */
function isPathWithinProject(targetPath, baseDir = PROJECT_ROOT) {
  const resolved = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
}

// ============================================================
// Spec File Path Resolution (v1.0.4 Migration Support)
// ============================================================

/**
 * Spec file name to PATHS key mapping
 */
const SPEC_FILE_MAP = {
  stack: { new: 'specsStack', old: 'stackMd' },
  architecture: { new: 'specsArchitecture', old: 'architectureMd' },
  testing: { new: 'specsTesting', old: 'testingMd' }
};

/**
 * Get the path for a spec file with backward compatibility.
 * Checks new location (specs/) first, falls back to old (state/).
 *
 * @param {string} name - Spec file name ('stack', 'architecture', 'testing')
 * @param {Object} [options] - Options
 * @param {boolean} [options.warnOnOld=true] - Warn if found in old location
 * @param {boolean} [options.preferNew=false] - Return new path even if file doesn't exist yet
 * @returns {string|null} Path to spec file, or null if not found and preferNew is false
 */
function getSpecFilePath(name, options = {}) {
  const { warnOnOld = true, preferNew = false } = options;

  const mapping = SPEC_FILE_MAP[name.toLowerCase()];
  if (!mapping) {
    console.log(`\x1b[33m\u26a0\x1b[0m Unknown spec file: ${name}. Valid options: stack, architecture, testing`);
    return null;
  }

  const newPath = PATHS[mapping.new];
  const oldPath = PATHS[mapping.old];

  // Check new location first
  if (fs.existsSync(newPath)) {
    return newPath;
  }

  // Check old location
  if (fs.existsSync(oldPath)) {
    if (warnOnOld) {
      console.log(`\x1b[33m\u26a0\x1b[0m ${name}.md found in deprecated location (state/). Run 'flow migrate specs' to move to specs/`);
    }
    return oldPath;
  }

  // Neither exists
  if (preferNew) {
    return newPath; // Return new path for creating new files
  }

  return null;
}

/**
 * Check if spec files need migration (are in old location)
 * @returns {Object[]} Array of files needing migration
 */
function checkSpecMigration() {
  const needsMigration = [];

  for (const [name, mapping] of Object.entries(SPEC_FILE_MAP)) {
    const oldPath = PATHS[mapping.old];
    const newPath = PATHS[mapping.new];

    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      needsMigration.push({
        name,
        from: oldPath,
        to: newPath
      });
    }
  }

  return needsMigration;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getProjectRoot,
  PROJECT_ROOT,
  WORKFLOW_DIR,
  STATE_DIR,
  CLAUDE_DIR,
  PATHS,
  isPathWithinProject,
  SPEC_FILE_MAP,
  getSpecFilePath,
  checkSpecMigration,
};
