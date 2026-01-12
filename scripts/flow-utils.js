#!/usr/bin/env node

/**
 * Wogi Flow - Shared Utilities
 *
 * Common functions used across all flow scripts.
 * Eliminates Python dependency and provides consistent path handling.
 *
 * NOTE: For new code, prefer importing from dedicated modules:
 * - flow-output.js: colors, color, print, success, warn, error, info
 * - flow-file-ops.js: readJson, writeJson, fileExists, dirExists, ensureDir
 * - flow-constants.js: TIMEOUTS, LIMITS, THRESHOLDS, BACKOFF
 * - flow-http-client.js: HttpClient, fetchJson, postJson
 *
 * This file re-exports all functions for backwards compatibility.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Late-loaded to avoid circular dependency
let configSubstitution = null;
function getConfigSubstitution() {
  if (!configSubstitution) {
    configSubstitution = require('../.workflow/lib/config-substitution');
  }
  return configSubstitution;
}

// ============================================================
// Constants - Named values for magic numbers
// ============================================================

/** Default timeout for shell commands (2 minutes) */
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;

/** Quick command timeout (30 seconds) */
const QUICK_COMMAND_TIMEOUT_MS = 30000;

/** Default lock stale threshold (60 seconds) */
const LOCK_STALE_THRESHOLD_MS = 60000;

/** Cleanup lock stale threshold (30 seconds) */
const CLEANUP_LOCK_STALE_MS = 30000;

/** Default retry delay for lock acquisition (100ms) */
const LOCK_RETRY_DELAY_MS = 100;

/** Default max retries for lock acquisition */
const LOCK_MAX_RETRIES = 5;

/** Maximum history entries to keep in durable sessions */
const MAX_SESSION_HISTORY = 50;

/** Default max iterations for workflow loops */
const MAX_WORKFLOW_ITERATIONS = 100;

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
};

// ============================================================
// Colors (ANSI escape codes)
// ============================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

/**
 * Colorize text for terminal output
 */
function color(colorName, text) {
  if (process.env.DEBUG && !colors[colorName]) {
    console.warn(`[DEBUG] Unknown color: "${colorName}"`);
  }
  return `${colors[colorName] || ''}${text}${colors.reset}`;
}

/**
 * Print colored output
 */
function print(colorName, text) {
  console.log(color(colorName, text));
}

/**
 * Print a styled header
 */
function printHeader(title) {
  console.log(color('cyan', '═'.repeat(50)));
  console.log(color('cyan', `        ${title}`));
  console.log(color('cyan', '═'.repeat(50)));
  console.log('');
}

/**
 * Print a section title
 */
function printSection(title) {
  console.log(color('cyan', title));
}

// ============================================================
// Standard Messaging Functions
// ============================================================
//
// STANDARD: All scripts should use these functions for consistent output:
//   success(msg) - Green checkmark ✓ for successful operations
//   warn(msg)    - Yellow warning ⚠ for non-fatal issues
//   error(msg)   - Red X ✗ for errors (use before process.exit(1))
//   info(msg)    - Cyan info ℹ for informational messages
//
// Import with: const { success, warn, error, info } = require('./flow-utils');
//
// AVOID: Direct console.log with color() for status messages.
// ============================================================

/**
 * Print success message
 */
function success(message) {
  console.log(`${color('green', '✓')} ${message}`);
}

/**
 * Print warning message
 */
function warn(message) {
  console.log(`${color('yellow', '⚠')} ${message}`);
}

/**
 * Print error message
 */
function error(message) {
  console.log(`${color('red', '✗')} ${message}`);
}

/**
 * Print info message
 */
function info(message) {
  console.log(`${color('cyan', 'ℹ')} ${message}`);
}

// ============================================================
// Task ID Generation (hash-based IDs)
// ============================================================

/**
 * Generate a hash-based task ID
 * Format: wf-XXXXXXXX (8-char hex hash)
 *
 * Uses SHA256 hash of title + timestamp for collision resistance.
 * This prevents merge conflicts in multi-agent/multi-branch workflows.
 *
 * @param {string} title - Task title
 * @returns {string} Task ID in format wf-XXXXXXXX
 *
 * @example
 * generateTaskId('Fix login bug') // => 'wf-a1b2c3d4'
 */
function generateTaskId(title) {
  const input = `${title}${Date.now()}${Math.random()}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
  return `wf-${hash}`;
}

/**
 * Check if a string is a valid task ID (old or new format)
 * @param {string} id - ID to validate
 * @returns {{ valid: boolean, format: 'hash' | 'legacy' | null }}
 */
function validateTaskId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, format: null };
  }

  // New hash-based format: wf-XXXXXXXX
  if (/^wf-[a-f0-9]{8}$/i.test(id)) {
    return { valid: true, format: 'hash' };
  }

  // Legacy formats: TASK-XXX, BUG-XXX
  if (/^(TASK|BUG)-\d{3,}$/i.test(id)) {
    return { valid: true, format: 'legacy' };
  }

  return { valid: false, format: null };
}

/**
 * Check if ID is in legacy format (for migration warnings)
 * @param {string} id - ID to check
 * @returns {boolean}
 */
function isLegacyTaskId(id) {
  return /^(TASK|BUG)-\d{3,}$/i.test(id);
}

// ============================================================
// JSON Output Helpers (for --json flag support)
// ============================================================

/**
 * Output data as JSON and exit
 * Use this in scripts that support --json flag
 *
 * @param {Object} data - Data to output
 * @param {Object} [options] - Options
 * @param {boolean} [options.exitOnOutput=true] - Exit after output
 * @param {number} [options.exitCode=0] - Exit code
 *
 * @example
 * if (flags.json) {
 *   outputJson({ success: true, tasks: [...] });
 * }
 */
function outputJson(data, options = {}) {
  const { exitOnOutput = true, exitCode = 0 } = options;

  const output = {
    success: data.success !== false,
    timestamp: new Date().toISOString(),
    ...data
  };

  console.log(JSON.stringify(output, null, 2));

  if (exitOnOutput) {
    process.exit(exitCode);
  }
}

/**
 * Parse common CLI flags from arguments
 * Standardizes flag handling across all flow commands
 *
 * @param {string[]} args - Command line arguments (process.argv.slice(2))
 * @returns {{ flags: Object, positional: string[] }}
 *
 * @example
 * const { flags, positional } = parseFlags(process.argv.slice(2));
 * if (flags.json) outputJson(result);
 * if (flags.help) showHelp();
 */
function parseFlags(args) {
  const flags = {
    json: false,
    quiet: false,
    verbose: false,
    help: false,
    dryRun: false,
    deep: false
  };

  const positional = [];
  const namedFlags = {};

  // Known flags that take values (--flag value style)
  const valuedFlags = ['priority', 'from', 'severity', 'limit', 'format', 'output', 'strategy', 'type', 'file', 'analysis', 'model', 'domain', 'task-type'];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      flags.quiet = true;
    } else if (arg === '--verbose' || arg === '-v') {
      flags.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--deep') {
      flags.deep = true;
    } else if (arg.startsWith('--')) {
      // Handle --key=value style flags
      const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
      if (match) {
        const [, key, value] = match;
        if (value !== undefined) {
          // Has explicit value: --key=value
          namedFlags[key] = value;
        } else if (valuedFlags.includes(key) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
          // Known valued flag: --key value (consume next arg)
          namedFlags[key] = args[++i];
        } else if (valuedFlags.includes(key)) {
          // Valued flag without value - warn in debug mode, treat as boolean
          if (process.env.DEBUG) {
            console.warn(`[DEBUG] Flag --${key} expects a value but none provided`);
          }
          namedFlags[key] = true;
        } else {
          // Boolean flag: --flag
          namedFlags[key] = true;
        }
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { flags: { ...flags, ...namedFlags }, positional };
}

// ============================================================
// File Operations
// ============================================================

/**
 * Check if a file exists
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 */
function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read JSON file safely
 * @param {string} filePath - Path to JSON file
 * @param {*} [defaultValue=undefined] - Default value if file doesn't exist or is invalid
 * @returns {*} Parsed JSON or defaultValue
 * @throws {Error} If file cannot be read and no defaultValue provided
 */
function readJson(filePath, defaultValue = undefined) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    // Check for undefined to allow falsy defaults like false, 0, ''
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Failed to read JSON from ${filePath}: ${err.message}`);
  }
}

/**
 * Write JSON file with pretty formatting using atomic write pattern
 * (writes to temp file, then renames for crash safety)
 * @param {string} filePath - Path to JSON file
 * @param {*} data - Data to serialize as JSON
 * @returns {boolean} True on success
 * @throws {Error} If file cannot be written
 */
function writeJson(filePath, data) {
  const tempPath = filePath + '.tmp.' + process.pid;
  try {
    const content = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);  // Atomic rename
    return true;
  } catch (err) {
    // Clean up temp file if it exists
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw new Error(`Failed to write JSON to ${filePath}: ${err.message}`);
  }
}

/**
 * Safely parse JSON with prototype pollution protection
 * Use this for user-modifiable files (registry, stats, etc.)
 * @param {string} filePath - Path to JSON file
 * @param {*} [defaultValue=null] - Default value if parsing fails
 * @returns {object|null} Parsed JSON or defaultValue on error
 */
function safeJsonParse(filePath, defaultValue = null) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for prototype pollution attempts in raw content
    // Covers various quote styles and whitespace variants
    if (/__proto__|constructor\s*["'`:]|prototype\s*["'`:]/i.test(content)) {
      console.error(`[safeJsonParse] Suspicious content detected in ${filePath}`);
      return defaultValue;
    }

    const parsed = JSON.parse(content);

    // Validate it's an object (not array or primitive for config files)
    if (typeof parsed !== 'object' || parsed === null) {
      console.error(`[safeJsonParse] Invalid JSON structure in ${filePath} (expected object)`);
      return defaultValue;
    }

    // Additional check: ensure no proto/constructor keys were added
    const keys = Object.getOwnPropertyNames(parsed);
    if (keys.includes('__proto__') || keys.includes('constructor') || keys.includes('prototype')) {
      console.error(`[safeJsonParse] Prototype pollution attempt detected in ${filePath}`);
      return defaultValue;
    }

    return parsed;
  } catch (err) {
    console.error(`[safeJsonParse] Failed to parse ${filePath}: ${err.message}`);
    return defaultValue;
  }
}

/**
 * Read text file safely
 * @param {string} filePath - Path to text file
 * @param {*} [defaultValue=undefined] - Default value if file doesn't exist
 * @returns {string|*} File contents or defaultValue
 * @throws {Error} If file cannot be read and no defaultValue provided
 */
function readFile(filePath, defaultValue = undefined) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    // Check for undefined to allow falsy defaults like false, 0, ''
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Failed to read file ${filePath}: ${err.message}`);
  }
}

/**
 * Write text file using atomic write pattern
 * (writes to temp file, then renames for crash safety)
 */
function writeFile(filePath, content) {
  const tempPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);  // Atomic rename
    return true;
  } catch (err) {
    // Clean up temp file if it exists
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw new Error(`Failed to write file ${filePath}: ${err.message}`);
  }
}

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

/**
 * Validate JSON file syntax
 */
function validateJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ============================================================
// Config Operations
// ============================================================

// Config cache for performance (avoids repeated file reads)
let _configCache = null;
let _configMtime = null;

// Known config keys for validation (prevents typos causing silent failures)
const KNOWN_CONFIG_KEYS = [
  'hybrid',
  'parallel',
  'worktree',
  'qualityGates',
  'testing',
  'componentRules',
  'mandatorySteps',
  'phases',
  'corrections',
  'skills',
  'autoContext',
  'metrics',
  'figmaAnalyzer',
  'learning',
  'hooks',
  'project',
  'projectType',
  // v1.7.0 context memory management
  'contextMonitor',
  'requestLog',
  'sessionState',
  // v1.9.0 features
  'priorities',
  'morningBriefing'
];

// Known nested keys for common config sections
const KNOWN_NESTED_KEYS = {
  hybrid: ['enabled', 'provider', 'providerEndpoint', 'model', 'settings', 'maxContextTokens', 'apiKey'],
  parallel: ['enabled', 'maxConcurrent', 'autoApprove', 'requireWorktree', 'showProgress'],
  worktree: ['enabled', 'autoCleanupHours', 'keepOnFailure', 'squashOnMerge'],
  testing: ['runAfterTask', 'runBeforeCommit', 'command'],
  learning: ['autoPromote', 'enabled', 'threshold', 'mode'],
  qualityGates: ['feature', 'bugfix'],
  autoContext: ['enabled', 'maxFiles', 'searchDepth'],
  // v1.7.0 context memory management
  contextMonitor: ['enabled', 'warnAt', 'criticalAt', 'contextWindow', 'checkOnSessionStart', 'checkAfterTask'],
  requestLog: ['enabled', 'autoArchive', 'maxRecentEntries', 'keepRecent', 'createSummary'],
  sessionState: ['enabled', 'autoRestore', 'maxGapHours', 'trackFiles', 'trackDecisions', 'maxRecentFiles', 'maxRecentDecisions'],
  // v1.9.0 features
  priorities: ['defaultPriority', 'autoBoostDays', 'autoBoostAmount'],
  morningBriefing: ['enabled', 'showLastSession', 'showChanges', 'showRecommendedTasks', 'generatePrompt']
};

// Track if we've already warned about config issues this session
let _configValidationDone = false;

/**
 * Validate config object for unknown keys
 * Warns about typos that could cause silent failures
 */
function validateConfig(config, warnOnUnknown = true) {
  if (!warnOnUnknown || !config || typeof config !== 'object') return;

  const warnings = [];

  // Check top-level keys
  for (const key of Object.keys(config)) {
    if (!KNOWN_CONFIG_KEYS.includes(key)) {
      warnings.push(`Unknown config key: "${key}"`);
    }
  }

  // Check known nested sections
  for (const [section, knownKeys] of Object.entries(KNOWN_NESTED_KEYS)) {
    const sectionConfig = config[section];
    if (sectionConfig && typeof sectionConfig === 'object') {
      for (const key of Object.keys(sectionConfig)) {
        if (!knownKeys.includes(key)) {
          warnings.push(`Unknown key in ${section}: "${key}"`);
        }
      }
    }
  }

  // Only warn once per session (avoid spam)
  if (warnings.length > 0 && !_configValidationDone) {
    _configValidationDone = true;
    for (const warning of warnings) {
      console.warn(`⚠️  ${warning}`);
    }
    console.warn('   Check for typos in .workflow/config.json');
  }
}

/**
 * Read workflow config (cached, invalidates on file change)
 * Applies variable substitution ({env:VAR}, {file:path}) to config values
 */
function getConfig() {
  const configPath = PATHS.config;
  if (!fs.existsSync(configPath)) return {};

  try {
    const stat = fs.statSync(configPath);
    if (_configCache && _configMtime === stat.mtimeMs) {
      return _configCache;
    }

    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    _configMtime = stat.mtimeMs;

    // Validate on first load (DEBUG mode or explicit request)
    if (process.env.DEBUG || process.env.VALIDATE_CONFIG) {
      validateConfig(rawConfig);
    }

    // Apply variable substitution ({env:VAR}, {file:path})
    try {
      const { substituteConfig } = getConfigSubstitution();
      const result = substituteConfig(rawConfig, {
        logWarnings: true,
        printWarnings: process.env.DEBUG || process.env.VERBOSE_CONFIG
      });
      _configCache = result.value;

      // Log substitution warnings once per session (if DEBUG)
      if (process.env.DEBUG && result.warnings.length > 0) {
        console.warn(`[config] ${result.warnings.length} unresolved substitution(s)`);
      }
    } catch (substErr) {
      // Fallback to raw config if substitution fails
      console.warn(`Warning: Config substitution failed: ${substErr.message}`);
      _configCache = rawConfig;
    }

    return _configCache;
  } catch (err) {
    // Log warning instead of silently returning empty config
    console.warn(`Warning: Could not parse config.json: ${err.message}`);
    return {};
  }
}

/**
 * Read raw workflow config WITHOUT substitution (for editing/writing)
 * Use this when you need to read/modify config without resolving variables
 */
function getRawConfig() {
  const configPath = PATHS.config;
  if (!fs.existsSync(configPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.warn(`Warning: Could not parse config.json: ${err.message}`);
    return {};
  }
}

/**
 * Invalidate config cache (call after writing config)
 */
function invalidateConfigCache() {
  _configCache = null;
  _configMtime = null;
}

// Dangerous property names that could lead to prototype pollution
const DANGEROUS_CONFIG_PROPS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate config path doesn't contain dangerous property names
 * @param {string} configPath - Dot-notation path
 * @returns {boolean} True if path is safe
 */
function isValidConfigPath(configPath) {
  if (!configPath || typeof configPath !== 'string') return false;
  const parts = configPath.split('.');
  return parts.every(part => part && !DANGEROUS_CONFIG_PROPS.has(part));
}

/**
 * Get a config value by path (e.g., 'testing.runBeforeCommit')
 */
function getConfigValue(configPath, defaultValue = null) {
  // Validate path to prevent prototype pollution
  if (!isValidConfigPath(configPath)) {
    return defaultValue;
  }

  const config = getConfig();
  const parts = configPath.split('.');
  let value = config;

  for (const part of parts) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, part)) {
      value = value[part];
    } else {
      return defaultValue;
    }
  }

  return value;
}

/**
 * Update config value (uses locking to prevent race conditions)
 * SECURITY: Always acquires lock before writing to prevent data corruption
 * @param {string} configPath - Dot-notation path (e.g., 'parallel.enabled')
 * @param {*} newValue - New value to set
 * @returns {Promise<void>}
 * @throws {Error} If lock cannot be acquired after retries
 */
async function setConfigValue(configPath, newValue) {
  // Validate path to prevent prototype pollution
  if (!isValidConfigPath(configPath)) {
    throw new Error(`Invalid config path: ${configPath}`);
  }

  // Use file lock to prevent concurrent writes
  const lockPath = PATHS.config;
  let release;

  try {
    // More retries with exponential backoff for better reliability
    release = await acquireLock(lockPath, { retries: 5, retryDelay: 100, exponentialBackoff: true });
  } catch (lockError) {
    // SECURITY: Don't fall back to non-locked write - throw instead
    throw new Error(`Could not acquire config lock after retries: ${lockError.message}. Config not updated.`);
  }

  try {
    // Re-read config after acquiring lock (may have changed)
    invalidateConfigCache();
    const config = getConfig();
    const parts = configPath.split('.');
    let obj = config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!Object.prototype.hasOwnProperty.call(obj, part)) {
        obj[part] = {};
      }
      obj = obj[part];
    }

    obj[parts[parts.length - 1]] = newValue;
    writeJson(PATHS.config, config);
    invalidateConfigCache();
  } finally {
    if (release) release();
  }
}

/**
 * Update config value (synchronous version - no locking)
 * Use setConfigValue for concurrent-safe writes
 */
function setConfigValueSync(configPath, newValue) {
  // Validate path to prevent prototype pollution
  if (!isValidConfigPath(configPath)) {
    throw new Error(`Invalid config path: ${configPath}`);
  }

  const config = getConfig();
  const parts = configPath.split('.');
  let obj = config;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!Object.prototype.hasOwnProperty.call(obj, part)) {
      obj[part] = {};
    }
    obj = obj[part];
  }

  obj[parts[parts.length - 1]] = newValue;
  writeJson(PATHS.config, config);
  invalidateConfigCache();
}

/**
 * Resolve config value that may contain environment variable or file references
 * Supports: {env:VAR_NAME}, {file:path}, {file:~/path}
 * @param {string|null} value - Value to resolve
 * @returns {string|null} Resolved value or null if unresolvable
 */
function resolveConfigValue(value) {
  if (!value || typeof value !== 'string') return value;

  // {env:VAR_NAME} - environment variable
  if (value.startsWith('{env:') && value.endsWith('}')) {
    const varName = value.slice(5, -1);
    // Validate env var name format
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(varName)) {
      warn(`Invalid environment variable name: ${varName}`);
      return null;
    }
    return process.env[varName] || null;
  }

  // {file:path} - file contents
  if (value.startsWith('{file:') && value.endsWith('}')) {
    let filePath = value.slice(6, -1);
    // Expand tilde to home directory
    if (filePath.startsWith('~')) {
      filePath = filePath.replace(/^~/, process.env.HOME || '');
    }
    // Security: validate path doesn't escape expected locations
    const resolvedPath = path.resolve(filePath);
    try {
      return fs.readFileSync(resolvedPath, 'utf-8').trim();
    } catch (err) {
      return null;
    }
  }

  return value;
}

// ============================================================
// Ready.json Operations
// ============================================================

/**
 * Validate ready.json structure
 * @param {Object} data - Data to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateReadyJson(data) {
  const errors = [];

  // Check required top-level arrays
  const requiredArrays = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];
  for (const key of requiredArrays) {
    if (!Array.isArray(data[key])) {
      errors.push(`Missing or invalid "${key}" array`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate tasks in each array
  const allArrays = [...requiredArrays];
  for (const arrayName of allArrays) {
    const tasks = data[arrayName] || [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const prefix = `${arrayName}[${i}]`;

      // Required fields
      if (!task.id || typeof task.id !== 'string') {
        errors.push(`${prefix}: missing or invalid "id"`);
      }

      // Optional but validated fields
      if (task.title !== undefined && typeof task.title !== 'string') {
        errors.push(`${prefix}: "title" must be a string`);
      }
      if (task.status !== undefined && typeof task.status !== 'string') {
        errors.push(`${prefix}: "status" must be a string`);
      }
      if (task.priority !== undefined && !/^P[0-4]$/.test(task.priority)) {
        errors.push(`${prefix}: "priority" must be P0-P4`);
      }
      if (task.dependencies !== undefined && !Array.isArray(task.dependencies)) {
        errors.push(`${prefix}: "dependencies" must be an array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Read ready.json task queue with optional validation
 * @param {boolean} [validate=false] - Whether to validate structure
 * @returns {Object} Task queue data with ready, inProgress, blocked, recentlyCompleted arrays
 * @throws {Error} If validate is true and structure is invalid
 */
function getReadyData(validate = false) {
  const data = readJson(PATHS.ready, {
    ready: [],
    inProgress: [],
    blocked: [],
    recentlyCompleted: []
  });

  if (validate) {
    const validation = validateReadyJson(data);
    if (!validation.valid) {
      throw new Error(`Invalid ready.json: ${validation.errors.join(', ')}`);
    }
  }

  return data;
}

/**
 * Write ready.json task queue
 * Note: Does not mutate the input data object
 *
 * WARNING: For concurrent access, use saveReadyDataAsync which uses file locking.
 */
function saveReadyData(data) {
  const toSave = { ...data, lastUpdated: new Date().toISOString() };
  return writeJson(PATHS.ready, toSave);
}

/**
 * Write ready.json with file locking (async version)
 * Use this when multiple processes might be writing to ready.json
 *
 * SECURITY: Prevents race conditions that could corrupt ready.json
 */
async function saveReadyDataAsync(data) {
  return withLock(PATHS.ready, () => {
    const toSave = { ...data, lastUpdated: new Date().toISOString() };
    return writeJson(PATHS.ready, toSave);
  });
}

/**
 * Find a task in ready.json by ID
 * Returns { task, list, index } or null
 */
function findTask(taskId) {
  const data = getReadyData();
  const lists = ['ready', 'inProgress', 'blocked', 'recentlyCompleted'];

  for (const listName of lists) {
    const list = data[listName] || [];
    for (let i = 0; i < list.length; i++) {
      const task = list[i];
      const id = typeof task === 'string' ? task : task.id;
      if (id === taskId) {
        return { task, list: listName, index: i, data };
      }
    }
  }

  return null;
}

/**
 * Move a task from one list to another
 *
 * WARNING: For concurrent access, use moveTaskAsync which uses file locking.
 */
function moveTask(taskId, fromList, toList) {
  const data = getReadyData();
  const from = data[fromList] || [];
  const to = data[toList] || [];

  let taskIndex = -1;
  let task = null;

  for (let i = 0; i < from.length; i++) {
    const t = from[i];
    const id = typeof t === 'string' ? t : t.id;
    if (id === taskId) {
      taskIndex = i;
      task = t;
      break;
    }
  }

  if (taskIndex === -1) {
    return { success: false, error: `Task ${taskId} not found in ${fromList}` };
  }

  from.splice(taskIndex, 1);

  if (toList === 'recentlyCompleted') {
    to.unshift(task);
    data[toList] = to.slice(0, 10); // Keep last 10
  } else {
    to.push(task);
    data[toList] = to;
  }

  data[fromList] = from;
  saveReadyData(data);

  return { success: true, task };
}

/**
 * Move a task with file locking (async version)
 * Atomically reads, modifies, and writes ready.json
 *
 * SECURITY: Prevents race conditions when multiple processes move tasks
 */
async function moveTaskAsync(taskId, fromList, toList) {
  return withLock(PATHS.ready, () => {
    const data = getReadyData();
    const from = data[fromList] || [];
    const to = data[toList] || [];

    let taskIndex = -1;
    let task = null;

    for (let i = 0; i < from.length; i++) {
      const t = from[i];
      const id = typeof t === 'string' ? t : t.id;
      if (id === taskId) {
        taskIndex = i;
        task = t;
        break;
      }
    }

    if (taskIndex === -1) {
      return { success: false, error: `Task ${taskId} not found in ${fromList}` };
    }

    from.splice(taskIndex, 1);

    if (toList === 'recentlyCompleted') {
      to.unshift(task);
      data[toList] = to.slice(0, 10); // Keep last 10
    } else {
      to.push(task);
      data[toList] = to;
    }

    data[fromList] = from;
    const toSave = { ...data, lastUpdated: new Date().toISOString() };
    writeJson(PATHS.ready, toSave);

    return { success: true, task };
  });
}

/**
 * Get task counts
 */
function getTaskCounts() {
  const data = getReadyData();
  return {
    ready: (data.ready || []).length,
    inProgress: (data.inProgress || []).length,
    blocked: (data.blocked || []).length,
    recentlyCompleted: (data.recentlyCompleted || []).length
  };
}

// ============================================================
// Request Log Operations
// ============================================================

/**
 * Count entries in request-log.md
 */
function countRequestLogEntries() {
  try {
    const content = readFile(PATHS.requestLog, '');
    const matches = content.match(/^### R-/gm);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Get the last request log entry
 */
function getLastRequestLogEntry() {
  try {
    const content = readFile(PATHS.requestLog, '');
    const matches = content.match(/^### R-.*$/gm);
    return matches ? matches[matches.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Get the highest request ID number from request-log.md
 * More robust than counting - handles gaps and deleted entries
 */
function getHighestRequestId() {
  try {
    const content = readFile(PATHS.requestLog, '');
    // Match all R-XXX patterns (3+ digits)
    const matches = content.match(/### R-(\d{3,})/g);
    if (!matches || matches.length === 0) return 0;

    // Extract numbers and find the max
    const numbers = matches.map(m => {
      const num = m.match(/R-(\d+)/);
      return num ? parseInt(num[1], 10) : 0;
    });
    return Math.max(...numbers);
  } catch {
    return 0;
  }
}

/**
 * Get next request ID
 * Uses highest existing ID + 1 to avoid duplicates even with gaps
 */
function getNextRequestId() {
  const highestId = getHighestRequestId();
  return `R-${String(highestId + 1).padStart(3, '0')}`;
}

/**
 * Add an entry to request-log.md
 * @param {Object} entry - Entry details
 * @param {string} entry.type - new | fix | change | refactor
 * @param {string[]} entry.tags - Array of tags (e.g., ['#figma', '#component:Button'])
 * @param {string} entry.request - What was requested
 * @param {string} entry.result - What was done
 * @param {string[]} [entry.files] - Files changed
 */
function addRequestLogEntry(entry) {
  const { type, tags, request, result, files = [] } = entry;
  const id = getNextRequestId();
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);

  const filesLine = files.length > 0 ? `\n**Files**: ${files.join(', ')}` : '';
  const tagsStr = tags.join(' ');

  const logEntry = `
### ${id} | ${timestamp}
**Type**: ${type}
**Tags**: ${tagsStr}
**Request**: "${request}"
**Result**: ${result}${filesLine}
`;

  try {
    const content = readFile(PATHS.requestLog, '');
    writeFile(PATHS.requestLog, content + logEntry);
    return id;
  } catch (err) {
    error(`Failed to add request log entry: ${err.message}`);
    return null;
  }
}

// ============================================================
// App Map Operations
// ============================================================

/**
 * Count components in app-map.md
 * Counts actual data rows (excludes headers and separator rows)
 */
function countAppMapComponents() {
  try {
    const content = readFile(PATHS.appMap, '');
    // Match data rows: start with | followed by non-dash content (excludes |---|---|)
    const dataRows = content.match(/^\|[^-|][^|]*\|/gm);
    // Each table has 1 header row per section, estimate ~2-3 sections
    const headerCount = (content.match(/^## /gm) || []).length * 1;
    const count = dataRows ? Math.max(0, dataRows.length - headerCount) : 0;
    return count;
  } catch {
    return 0;
  }
}

/**
 * Add a component to app-map.md
 * @param {Object} component - Component details
 * @param {string} component.name - Component name
 * @param {string} component.type - Component type (component, screen, modal, etc.)
 * @param {string} component.path - Path to component file
 * @param {string[]} [component.variants] - Available variants
 * @param {string} [component.description] - Component description
 * @returns {boolean} - Success status
 */
function addAppMapComponent(component) {
  const { name, type, path: filePath, variants = [], description = '' } = component;

  try {
    let content = readFile(PATHS.appMap, '');

    // Find the appropriate section based on type
    const sectionMap = {
      screen: '## Screens',
      modal: '## Modals',
      component: '## Components',
      layout: '## Layouts'
    };

    const section = sectionMap[type] || '## Components';
    const variantsStr = variants.length > 0 ? variants.join(', ') : '-';
    const descStr = description || '-';

    // Create new row
    const newRow = `| ${name} | ${filePath} | ${variantsStr} | ${descStr} |`;

    // Find section and add row
    const sectionIndex = content.indexOf(section);
    if (sectionIndex === -1) {
      warn(`Section "${section}" not found in app-map.md`);
      return false;
    }

    // Find the end of the table in this section (next section or end of file)
    const nextSectionMatch = content.substring(sectionIndex + section.length).match(/\n## /);
    const endIndex = nextSectionMatch
      ? sectionIndex + section.length + nextSectionMatch.index
      : content.length;

    // Find last table row in section
    const sectionContent = content.substring(sectionIndex, endIndex);
    const lastPipeIndex = sectionContent.lastIndexOf('\n|');

    if (lastPipeIndex !== -1) {
      // Find the end of the last row (next newline after the pipe)
      const afterPipe = sectionContent.substring(lastPipeIndex);
      const newlineOffset = afterPipe.indexOf('\n', 1);
      // If no newline found, insert at end of section content
      const insertOffset = newlineOffset !== -1 ? newlineOffset : afterPipe.length;
      const insertIndex = sectionIndex + lastPipeIndex + insertOffset;
      content = content.substring(0, insertIndex) + '\n' + newRow + content.substring(insertIndex);
    } else {
      // No table rows yet, add after header
      const headerEnd = sectionContent.indexOf('\n\n');
      if (headerEnd !== -1) {
        const insertIndex = sectionIndex + headerEnd;
        content = content.substring(0, insertIndex) + '\n' + newRow + content.substring(insertIndex);
      } else {
        // Malformed section - no header end found
        warn(`Could not find proper insertion point in section "${section}"`);
        return false;
      }
    }

    writeFile(PATHS.appMap, content);
    return true;
  } catch (err) {
    error(`Failed to add component to app-map: ${err.message}`);
    return false;
  }
}

// ============================================================
// Git Operations
// ============================================================

/**
 * Check if current directory is a git repo
 * Note: .git can be a directory (normal repo) or file (worktree)
 */
function isGitRepo() {
  const gitPath = path.join(PROJECT_ROOT, '.git');
  return fs.existsSync(gitPath);
}

/**
 * Get git status info (requires child_process)
 */
function getGitStatus() {
  const { execSync } = require('child_process');

  if (!isGitRepo()) {
    return { isRepo: false };
  }

  try {
    const branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const uncommitted = status.split('\n').filter(Boolean).length;

    return {
      isRepo: true,
      branch,
      uncommitted,
      clean: uncommitted === 0
    };
  } catch (err) {
    return { isRepo: true, error: err.message };
  }
}

// ============================================================
// Directory Operations
// ============================================================

/**
 * List directories in a path
 */
function listDirs(dirPath) {
  try {
    if (!dirExists(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter(name => {
        const fullPath = path.join(dirPath, name);
        return fs.statSync(fullPath).isDirectory();
      });
  } catch {
    return [];
  }
}

/**
 * List files matching a pattern in a directory
 */
function listFiles(dirPath, extension = null) {
  try {
    if (!dirExists(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter(name => {
        const fullPath = path.join(dirPath, name);
        if (!fs.statSync(fullPath).isFile()) return false;
        if (extension && !name.endsWith(extension)) return false;
        return true;
      });
  } catch {
    return [];
  }
}

/**
 * Count files recursively with depth limit and symlink protection
 */
function countFiles(dirPath, extensions = [], maxDepth = 10) {
  let count = 0;
  const visited = new Set(); // Prevent infinite loops from symlinks

  function walk(dir, depth) {
    if (depth <= 0) return; // Depth limit reached

    try {
      // Resolve real path to detect symlink cycles
      const realPath = fs.realpathSync(dir);
      if (visited.has(realPath)) return; // Already visited (symlink cycle)
      visited.add(realPath);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip node_modules and hidden directories for performance
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          walk(fullPath, depth - 1);
        } else if (entry.isFile()) {
          if (extensions.length === 0 || extensions.some(ext => entry.name.endsWith(ext))) {
            count++;
          }
        }
      }
    } catch (err) {
      // Ignore permission errors, log others in debug mode
      if (process.env.DEBUG) console.error(`[DEBUG] countFiles: ${err.message}`);
    }
  }

  if (dirExists(dirPath)) {
    walk(dirPath, maxDepth);
  }

  return count;
}

// ============================================================
// File Locking (for parallel execution safety)
// ============================================================

/**
 * Simple file locking without external dependencies.
 * Uses mkdir (atomic on most filesystems) for lock acquisition.
 *
 * @param {string} filePath - File to lock
 * @param {Object} options - Lock options
 * @param {number} [options.retries=5] - Number of retry attempts
 * @param {number} [options.retryDelay=100] - Delay between retries (ms)
 * @param {number} [options.staleMs=30000] - Consider lock stale after this many ms
 * @returns {Promise<Function>} Release function
 */
async function acquireLock(filePath, options = {}) {
  const {
    retries = LOCK_MAX_RETRIES,
    retryDelay = LOCK_RETRY_DELAY_MS,
    staleMs = LOCK_STALE_THRESHOLD_MS
  } = options;

  const lockDir = `${filePath}.lock`;
  const lockInfoFile = path.join(lockDir, 'info.json');
  let staleCleanupAttempts = 0;
  const maxStaleCleanupAttempts = 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // mkdir is atomic - will fail if directory already exists
      fs.mkdirSync(lockDir, { recursive: false });

      // Write lock info for stale detection
      fs.writeFileSync(lockInfoFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        file: filePath
      }));

      // Return release function with robust cleanup
      return () => {
        // Try to remove info file first
        try {
          fs.unlinkSync(lockInfoFile);
        } catch (unlinkErr) {
          // ENOENT is fine - file already gone
          // Other errors we log but continue to try rmdir
          if (unlinkErr.code !== 'ENOENT' && process.env.DEBUG) {
            console.warn(`[DEBUG] Lock info cleanup warning: ${unlinkErr.message}`);
          }
        }

        // Always try to remove lock directory
        try {
          fs.rmdirSync(lockDir);
        } catch (rmdirErr) {
          // ENOENT is fine - directory already gone
          if (rmdirErr.code !== 'ENOENT') {
            // Directory not empty or other error - force cleanup
            try {
              fs.rmSync(lockDir, { recursive: true, force: true });
            } catch {
              // Last resort failed - log if debug
              if (process.env.DEBUG) {
                console.warn(`[DEBUG] Lock dir cleanup failed: ${rmdirErr.message}`);
              }
            }
          }
        }
      };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists - check if stale
        let isStale = false;
        let lockAge = 0;

        try {
          const info = JSON.parse(fs.readFileSync(lockInfoFile, 'utf-8'));
          lockAge = Date.now() - info.timestamp;
          isStale = lockAge > staleMs;
        } catch {
          // Can't read lock info - assume stale if we've waited long enough
          isStale = attempt >= 2;
        }

        if (isStale) {
          staleCleanupAttempts++;
          if (staleCleanupAttempts > maxStaleCleanupAttempts) {
            throw new Error(`Failed to clean up stale lock for ${filePath} after ${maxStaleCleanupAttempts} attempts`);
          }

          if (process.env.DEBUG) {
            console.warn(`[DEBUG] Removing stale lock (${lockAge}ms old) for ${filePath} (cleanup attempt ${staleCleanupAttempts})`);
          }

          try {
            fs.unlinkSync(lockInfoFile);
            fs.rmdirSync(lockDir);
          } catch (cleanupErr) {
            // Cleanup failed - wait before retrying
            if (process.env.DEBUG) {
              console.warn(`[DEBUG] Stale lock cleanup failed: ${cleanupErr.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
          // Try again
          continue;
        }

        if (attempt < retries) {
          // Wait and retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
          continue;
        }
      }

      throw new Error(`Failed to acquire lock for ${filePath}: ${err.message}`);
    }
  }

  throw new Error(`Failed to acquire lock for ${filePath} after ${retries} retries`);
}

/**
 * Execute a function while holding a lock on a file
 *
 * @param {string} filePath - File to lock
 * @param {Function} fn - Async function to execute
 * @param {Object} [options] - Lock options
 * @returns {Promise<*>} Result of fn
 *
 * @example
 * const data = await withLock(PATHS.ready, async () => {
 *   const current = readJson(PATHS.ready);
 *   current.tasks.push(newTask);
 *   writeJson(PATHS.ready, current);
 *   return current;
 * });
 */
async function withLock(filePath, fn, options = {}) {
  const release = await acquireLock(filePath, options);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Synchronous version of withLock for simpler use cases
 * Note: Still uses async for lock acquisition, but fn is sync
 */
async function withLockSync(filePath, fn, options = {}) {
  const release = await acquireLock(filePath, options);
  try {
    return fn();
  } finally {
    release();
  }
}

/**
 * Clean up any stale locks in a directory
 * Useful for cleanup after crashes
 *
 * @param {string} dirPath - Directory to scan for .lock directories
 * @param {number} [staleMs=30000] - Consider locks older than this as stale
 * @returns {number} Number of locks cleaned up
 */
function cleanupStaleLocks(dirPath, staleMs = CLEANUP_LOCK_STALE_MS) {
  try {
    if (!dirExists(dirPath)) return 0;

    let cleaned = 0;
    const entries = fs.readdirSync(dirPath);

    for (const entry of entries) {
      if (!entry.endsWith('.lock')) continue;

      const lockDir = path.join(dirPath, entry);
      const lockInfoFile = path.join(lockDir, 'info.json');

      try {
        const info = JSON.parse(fs.readFileSync(lockInfoFile, 'utf-8'));
        const age = Date.now() - info.timestamp;

        if (age > staleMs) {
          // Clean up stale lock
          try {
            fs.unlinkSync(lockInfoFile);
          } catch (unlinkErr) {
            if (unlinkErr.code !== 'ENOENT') {
              if (process.env.DEBUG) {
                console.warn(`[DEBUG] cleanupStaleLocks: Could not delete ${lockInfoFile}: ${unlinkErr.message}`);
              }
            }
          }

          try {
            fs.rmdirSync(lockDir);
            cleaned++;
          } catch (rmdirErr) {
            if (rmdirErr.code !== 'ENOENT') {
              // Directory not empty or other error - force cleanup
              try {
                fs.rmSync(lockDir, { recursive: true, force: true });
                cleaned++;
              } catch (forceErr) {
                if (process.env.DEBUG) {
                  console.warn(`[DEBUG] cleanupStaleLocks: Could not force delete ${lockDir}: ${forceErr.message}`);
                }
              }
            }
          }
        }
      } catch (readErr) {
        // Can't read lock info - try to remove based on directory mtime
        if (readErr.code === 'ENOENT') continue; // Lock already gone

        try {
          const stat = fs.statSync(lockDir);
          const age = Date.now() - stat.mtimeMs;
          if (age > staleMs) {
            fs.rmSync(lockDir, { recursive: true, force: true });
            cleaned++;
          }
        } catch (statErr) {
          // Directory gone or inaccessible - skip
          if (statErr.code !== 'ENOENT' && process.env.DEBUG) {
            console.warn(`[DEBUG] cleanupStaleLocks: Could not stat ${lockDir}: ${statErr.message}`);
          }
        }
      }
    }

    return cleaned;
  } catch (dirErr) {
    if (process.env.DEBUG) {
      console.warn(`[DEBUG] cleanupStaleLocks: Could not scan ${dirPath}: ${dirErr.message}`);
    }
    return 0;
  }
}

// ============================================================
// Permission Validation (Claude Code settings.local.json)
// ============================================================

/**
 * Analyze permission rules for issues
 * @param {string[]} permissions - Array of permission rules
 * @returns {Object} Analysis result with duplicates, overbroad, shadowed
 */
function analyzePermissions(permissions) {
  const result = {
    duplicates: [],
    overbroad: [],
    shadowed: [],
    total: permissions.length
  };

  // Check for duplicates
  const seen = new Set();
  for (const perm of permissions) {
    if (seen.has(perm)) {
      result.duplicates.push(perm);
    }
    seen.add(perm);
  }

  // Check for overly broad patterns
  const overbroadPatterns = ['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)'];
  for (const perm of permissions) {
    if (overbroadPatterns.includes(perm)) {
      result.overbroad.push(perm);
    }
  }

  // Check for shadowed rules (specific rules covered by wildcards)
  const wildcards = permissions.filter(p => p.includes('*'));
  const specific = permissions.filter(p => !p.includes('*'));

  for (const spec of specific) {
    // Extract tool type and pattern
    const match = spec.match(/^(\w+)\((.+)\)$/);
    if (match) {
      const [, tool, pattern] = match;
      // Check if a wildcard covers this
      for (const wild of wildcards) {
        const wildMatch = wild.match(/^(\w+)\((.+)\)$/);
        if (wildMatch && wildMatch[1] === tool) {
          const wildPattern = wildMatch[2].replace(/\*/g, '.*');
          try {
            const regex = new RegExp(`^${wildPattern}$`);
            if (regex.test(pattern)) {
              result.shadowed.push({ specific: spec, wildcard: wild });
              break;
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }
    }
  }

  return result;
}

/**
 * Validate permission rules and return issues
 * @param {string[]} permissions - Array of permission rules
 * @returns {Object} Validation result with issues and warnings
 */
function validatePermissions(permissions) {
  const analysis = analyzePermissions(permissions);

  const issues = [];
  const warnings = [];

  // Critical: duplicates waste space
  if (analysis.duplicates.length > 0) {
    warnings.push({
      type: 'duplicate',
      message: `${analysis.duplicates.length} duplicate rule(s) found`,
      items: analysis.duplicates
    });
  }

  // Critical: overly broad rules are security risks
  if (analysis.overbroad.length > 0) {
    issues.push({
      type: 'overbroad',
      severity: 'critical',
      message: `${analysis.overbroad.length} overly broad rule(s) found`,
      items: analysis.overbroad
    });
  }

  // Info: shadowed rules are redundant but not harmful
  if (analysis.shadowed.length > 0) {
    warnings.push({
      type: 'shadowed',
      message: `${analysis.shadowed.length} rule(s) shadowed by wildcards (redundant)`,
      items: analysis.shadowed.map(s => s.specific)
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    analysis
  };
}

// ============================================================
// AST-Grep Integration
// ============================================================

/**
 * Common AST patterns for code discovery
 */
const AST_PATTERNS = {
  // React patterns
  reactComponent: 'function $NAME($PROPS) { return <$_>$$$</$_> }',
  reactArrowComponent: 'const $NAME = ($PROPS) => { return <$_>$$$</$_> }',
  useStateHook: 'const [$STATE, $SETTER] = useState($INIT)',
  useEffectHook: 'useEffect($FN, [$$$DEPS])',
  useCustomHook: 'const $RESULT = use$NAME($$$ARGS)',

  // TypeScript patterns
  interfaceDefinition: 'interface $NAME { $$$ }',
  typeDefinition: 'type $NAME = $$$',
  exportedFunction: 'export function $NAME($$$PARAMS) { $$$ }',
  exportedConst: 'export const $NAME = $$$',

  // Import patterns
  namedImport: 'import { $$$IMPORTS } from "$PATH"',
  defaultImport: 'import $NAME from "$PATH"',

  // Class patterns
  classDefinition: 'class $NAME { $$$ }',
  classExtends: 'class $NAME extends $BASE { $$$ }'
};

/**
 * Check if ast-grep CLI (sg) is available
 */
function isAstGrepAvailable() {
  try {
    execSync('which sg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Search codebase using ast-grep for structural patterns
 * @param {string} pattern - AST pattern (e.g., "useState($INIT)")
 * @param {object} options - { lang, cwd, maxResults }
 * @returns {Array|null} Array of matches or null if ast-grep unavailable
 */
function astGrepSearch(pattern, options = {}) {
  const {
    lang = 'typescript',
    cwd = PROJECT_ROOT,
    maxResults = 20,
    searchDir = 'src'
  } = options;

  // Check if ast-grep is available
  if (!isAstGrepAvailable()) {
    return null;
  }

  const searchPath = path.join(cwd, searchDir);
  if (!dirExists(searchPath)) {
    return [];
  }

  try {
    const result = execSync(
      `sg --pattern "${pattern.replace(/"/g, '\\"')}" --lang ${lang} --json "${searchPath}"`,
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000
      }
    );

    const matches = JSON.parse(result || '[]');
    return matches.slice(0, maxResults).map(m => ({
      file: path.relative(cwd, m.file || m.path),
      line: m.range?.start?.line ?? m.startLine ?? 0,
      endLine: m.range?.end?.line ?? m.endLine ?? 0,
      content: m.text || m.match,
      meta: m.metaVariables || {}  // Captured $VARS
    }));
  } catch (err) {
    // Parse error, timeout, or no matches
    if (err.stdout) {
      try {
        const matches = JSON.parse(err.stdout);
        return matches.slice(0, maxResults).map(m => ({
          file: path.relative(cwd, m.file || m.path),
          line: m.range?.start?.line ?? 0,
          content: m.text || m.match,
          meta: m.metaVariables || {}
        }));
      } catch {
        // Ignore parse errors
      }
    }
    return [];
  }
}

/**
 * Search for React components in the codebase
 * @param {object} options - Search options
 */
function findReactComponents(options = {}) {
  const { maxResults = 10, cwd = PROJECT_ROOT } = options;

  // Try function components first
  let results = astGrepSearch(AST_PATTERNS.reactComponent, { ...options, maxResults });

  // If ast-grep not available, return null
  if (results === null) return null;

  // Also search arrow function components
  const arrowResults = astGrepSearch(AST_PATTERNS.reactArrowComponent, { ...options, maxResults });
  if (arrowResults) {
    results = [...results, ...arrowResults];
  }

  // Dedupe by file
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.file)) return false;
    seen.add(r.file);
    return true;
  }).slice(0, maxResults);
}

/**
 * Search for custom hooks in the codebase
 * @param {object} options - Search options
 */
function findCustomHooks(options = {}) {
  const { maxResults = 10 } = options;

  // Search for function use* pattern
  const results = astGrepSearch('function use$NAME($$$) { $$$ }', { ...options, maxResults });

  if (results === null) return null;

  return results.filter(r => {
    // Filter to only actual hook files
    const fileName = path.basename(r.file).toLowerCase();
    return fileName.startsWith('use') || fileName.includes('hook');
  });
}

/**
 * Search for TypeScript interfaces/types
 * @param {string} namePattern - Optional name pattern to filter by
 * @param {object} options - Search options
 */
function findTypeDefinitions(namePattern = null, options = {}) {
  const { maxResults = 10 } = options;

  // Search interfaces
  let results = astGrepSearch(AST_PATTERNS.interfaceDefinition, { ...options, maxResults });

  if (results === null) return null;

  // Also search type aliases
  const typeResults = astGrepSearch(AST_PATTERNS.typeDefinition, { ...options, maxResults });
  if (typeResults) {
    results = [...results, ...typeResults];
  }

  // Filter by name pattern if provided
  if (namePattern) {
    const regex = new RegExp(namePattern, 'i');
    results = results.filter(r => regex.test(r.content));
  }

  return results.slice(0, maxResults);
}

// ============================================================
// Token Estimation
// ============================================================

/**
 * Token estimation constants.
 */
const TOKEN_ESTIMATION = {
  // Characters per token (varies by content type)
  CHARS_PER_TOKEN_CODE: 3,      // Code is more token-dense
  CHARS_PER_TOKEN_TEXT: 4,      // General text/prose
  CHARS_PER_TOKEN_MIXED: 3.5,   // Mixed content

  // Line-based estimation (for code files)
  TOKENS_PER_LINE: 8,           // Average tokens per line of code

  // Complexity multipliers for task estimation
  COMPLEXITY_MULTIPLIERS: {
    low: 100,
    medium: 500,
    high: 2000
  }
};

/**
 * Estimate token count for text content.
 *
 * Unified token estimation supporting multiple use cases:
 * - Simple text estimation
 * - Code-aware estimation (different density)
 * - Hybrid char+line estimation
 * - Content type auto-detection
 *
 * @param {string} content - Text content to estimate
 * @param {Object} [options] - Estimation options
 * @param {boolean} [options.isCode] - Treat as code (3 chars/token vs 4)
 * @param {boolean} [options.detectCodeRatio] - Auto-detect code vs text ratio
 * @param {boolean} [options.useLineEstimate] - Include line-based estimation (for files)
 * @param {string} [options.complexity] - Add complexity multiplier (low/medium/high)
 * @returns {number} Estimated token count
 *
 * @example
 * // Simple estimation
 * estimateTokens('Hello world');  // ~3
 *
 * @example
 * // Code estimation
 * estimateTokens(codeContent, { isCode: true });
 *
 * @example
 * // File with auto-detection
 * estimateTokens(fileContent, { detectCodeRatio: true, useLineEstimate: true });
 */
function estimateTokens(content, options = {}) {
  if (!content || typeof content !== 'string') return 0;

  const {
    isCode = false,
    detectCodeRatio = false,
    useLineEstimate = false,
    complexity = null
  } = options;

  let estimate;

  if (detectCodeRatio) {
    // Auto-detect code vs text ratio
    const codeRatio = detectCodeContentRatio(content);
    const effectiveCharsPerToken =
      TOKEN_ESTIMATION.CHARS_PER_TOKEN_CODE * codeRatio +
      TOKEN_ESTIMATION.CHARS_PER_TOKEN_TEXT * (1 - codeRatio);
    estimate = Math.ceil(content.length / effectiveCharsPerToken);
  } else if (isCode) {
    estimate = Math.ceil(content.length / TOKEN_ESTIMATION.CHARS_PER_TOKEN_CODE);
  } else {
    estimate = Math.ceil(content.length / TOKEN_ESTIMATION.CHARS_PER_TOKEN_TEXT);
  }

  // Optionally blend with line-based estimate (better for structured code)
  if (useLineEstimate) {
    const lineCount = content.split('\n').length;
    const lineEstimate = lineCount * TOKEN_ESTIMATION.TOKENS_PER_LINE;
    estimate = Math.ceil((estimate + lineEstimate) / 2);
  }

  // Optionally add complexity multiplier (for task estimation)
  if (complexity && TOKEN_ESTIMATION.COMPLEXITY_MULTIPLIERS[complexity]) {
    estimate += TOKEN_ESTIMATION.COMPLEXITY_MULTIPLIERS[complexity];
  }

  return estimate;
}

/**
 * Detect the ratio of code content in text (0 to 1).
 * Uses heuristics like brackets, semicolons, and code block markers.
 *
 * @param {string} content - Content to analyze
 * @returns {number} Code ratio from 0 (all prose) to 1 (all code)
 */
function detectCodeContentRatio(content) {
  if (!content || content.length < 50) return 0;

  // Check for code block markers (markdown)
  const codeBlockPattern = /```[\s\S]*?```/g;
  const inlineCodePattern = /`[^`]+`/g;

  let codeChars = 0;
  const codeBlockMatches = content.match(codeBlockPattern);
  if (codeBlockMatches) {
    codeChars += codeBlockMatches.join('').length;
  }
  const inlineMatches = content.match(inlineCodePattern);
  if (inlineMatches) {
    codeChars += inlineMatches.join('').length;
  }

  // Check for code indicators (brackets, semicolons, etc.)
  const codeIndicators = (content.match(/[{}\[\]();=<>]/g) || []).length;
  const indicatorRatio = codeIndicators / content.length;

  // Combine code block ratio and indicator ratio
  const blockRatio = codeChars / content.length;
  const combinedRatio = Math.min(1, blockRatio + indicatorRatio * 2);

  return combinedRatio;
}

/**
 * Check if content is primarily code (helper for isCode parameter).
 *
 * @param {string} content - Content to check
 * @returns {boolean} True if content appears to be code
 */
function isCodeContent(content) {
  return detectCodeContentRatio(content) > 0.3;
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
    warn(`Unknown spec file: ${name}. Valid options: stack, architecture, testing`);
    return null;
  }

  const newPath = PATHS[mapping.new];
  const oldPath = PATHS[mapping.old];

  // Check new location first
  if (fileExists(newPath)) {
    return newPath;
  }

  // Check old location
  if (fileExists(oldPath)) {
    if (warnOnOld) {
      warn(`${name}.md found in deprecated location (state/). Run 'flow migrate specs' to move to specs/`);
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

    if (fileExists(oldPath) && !fileExists(newPath)) {
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
  // Constants
  DEFAULT_COMMAND_TIMEOUT_MS,
  QUICK_COMMAND_TIMEOUT_MS,
  LOCK_STALE_THRESHOLD_MS,
  CLEANUP_LOCK_STALE_MS,
  LOCK_RETRY_DELAY_MS,
  LOCK_MAX_RETRIES,
  MAX_SESSION_HISTORY,
  MAX_WORKFLOW_ITERATIONS,

  // Paths
  PATHS,
  PROJECT_ROOT,
  WORKFLOW_DIR,
  STATE_DIR,
  CLAUDE_DIR,
  getProjectRoot,

  // Colors & Output
  colors,
  color,
  print,
  printHeader,
  printSection,
  success,
  warn,
  error,
  info,

  // Task ID Generation (v1.9.0)
  generateTaskId,
  validateTaskId,
  isLegacyTaskId,

  // JSON Output & CLI Flags (v1.9.0)
  outputJson,
  parseFlags,

  // File Operations
  fileExists,
  dirExists,
  ensureDir: require('./flow-file-ops').ensureDir,
  readJson,
  writeJson,
  safeJsonParse,
  readFile,
  writeFile,
  validateJson,
  isPathWithinProject,

  // Token Estimation
  TOKEN_ESTIMATION,
  estimateTokens,
  detectCodeContentRatio,
  isCodeContent,

  // Config
  getConfig,
  getRawConfig,         // Raw config without substitution (for editing)
  getConfigValue,
  setConfigValue,       // Async with locking
  setConfigValueSync,   // Sync without locking (use when already locked)
  resolveConfigValue,   // Resolve {env:VAR} and {file:path} patterns
  invalidateConfigCache,
  validateConfig,
  KNOWN_CONFIG_KEYS,

  // Ready.json
  getReadyData,
  validateReadyJson,
  saveReadyData,
  saveReadyDataAsync,   // Async with locking
  findTask,
  moveTask,
  moveTaskAsync,        // Async with locking
  getTaskCounts,

  // Request Log
  countRequestLogEntries,
  getLastRequestLogEntry,
  getHighestRequestId,
  getNextRequestId,
  addRequestLogEntry,

  // App Map
  countAppMapComponents,
  addAppMapComponent,

  // Git
  isGitRepo,
  getGitStatus,

  // Directory
  listDirs,
  listFiles,
  countFiles,

  // File Locking
  acquireLock,
  withLock,
  withLockSync,
  cleanupStaleLocks,

  // Permission Validation
  analyzePermissions,
  validatePermissions,

  // AST-Grep Integration
  AST_PATTERNS,
  isAstGrepAvailable,
  astGrepSearch,
  findReactComponents,
  findCustomHooks,
  findTypeDefinitions,

  // Spec File Migration (v1.0.4)
  SPEC_FILE_MAP,
  getSpecFilePath,
  checkSpecMigration,
};

// ============================================================
// Automatic Stale Lock Cleanup on Module Load
// ============================================================

// Clean up any stale locks from previous sessions/crashes
// This runs once when the module is first required
(function autoCleanupStaleLocks() {
  try {
    // Only clean up if STATE_DIR exists (workflow initialized)
    if (dirExists(STATE_DIR)) {
      const cleaned = cleanupStaleLocks(STATE_DIR, 60000); // 60s stale threshold
      if (cleaned > 0 && process.env.DEBUG) {
        console.log(`[DEBUG] Auto-cleaned ${cleaned} stale lock(s) from ${STATE_DIR}`);
      }
    }
  } catch {
    // Silent failure - don't break module loading
  }
})();
