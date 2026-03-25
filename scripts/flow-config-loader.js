/**
 * Wogi Flow - Config Loading and Management
 *
 * Extracted from flow-utils.js for modularity.
 * Contains config reading, caching, validation, and compat shims.
 *
 * Usage:
 *   const { getConfig, getConfigValue, setConfigValue } = require('./flow-config-loader');
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS, PROJECT_ROOT, isPathWithinProject } = require('./flow-paths');
const { checkForDangerousKeys, readJson, writeJson, acquireLock, safeJsonParse, safeJsonParseString } = require('./flow-io');
const { warn } = require('./flow-output');

// Late-loaded to avoid circular dependency
let configSubstitution = null;
function getConfigSubstitution() {
  if (!configSubstitution) {
    configSubstitution = require('./flow-config-substitution');
  }
  return configSubstitution;
}

// Config defaults (loaded once at module level)
let _configDefaults = null;
try {
  _configDefaults = require('./flow-config-defaults');
} catch (_err) {
  // Graceful degradation if defaults module not available
}

// ============================================================
// Config Cache
// ============================================================

// Config cache for performance (avoids repeated file reads)
let _configCache = null;
let _configMtime = null;
let _configCacheTime = 0; // Timestamp of last cache population (ms)

// ============================================================
// Known Config Keys (for validation)
// ============================================================

// Known config keys — single source of truth in flow-constants.js
const { KNOWN_CONFIG_KEYS } = require('./flow-constants');

// Known nested keys for common config sections
const KNOWN_NESTED_KEYS = {
  hybrid: ['enabled', 'provider', 'providerEndpoint', 'model', 'settings', 'maxContextTokens', 'apiKey'],
  parallel: ['enabled', 'maxConcurrent', 'autoApprove', 'requireWorktree', 'showProgress'],
  worktree: ['enabled', 'autoCleanupHours', 'keepOnFailure', 'squashOnMerge'],
  testing: ['enabled', 'mode', '_comment_mode', 'detected', 'ui', 'api', 'generation', 'qualityGates'],
  learning: ['autoPromote', 'enabled', 'threshold', 'mode'],
  qualityGates: ['feature', 'bugfix'],
  autoContext: ['enabled', 'maxFiles', 'searchDepth'],
  // v1.7.0 context memory management
  contextMonitor: ['enabled', 'warnAt', 'criticalAt', 'contextWindow', 'checkOnSessionStart', 'checkAfterTask'],
  requestLog: ['enabled', 'autoArchive', 'maxRecentEntries', 'keepRecent', 'createSummary'],
  sessionState: ['enabled', 'autoRestore', 'maxGapHours', 'trackFiles', 'trackDecisions', 'maxRecentFiles', 'maxRecentDecisions'],
  // v1.9.0 features
  priorities: ['defaultPriority', 'autoBoostDays', 'autoBoostAmount'],
  morningBriefing: ['enabled', 'showLastSession', 'showChanges', 'showRecommendedTasks', 'generatePrompt'],
  // v2.0.0 classification system
  storyDecomposition: ['autoDetect', 'autoDecompose', 'complexityThreshold', 'minSubTasks', 'edgeCases', 'loadingStates', 'errorStates', 'classification', 'supportEpics', 'propagateProgress'],
  detection: ['weights', 'thresholds', 'overrides']
};

// Track if we've already warned about config issues this session
let _configValidationDone = false;

// ============================================================
// Config Validation
// ============================================================

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
      console.warn(`\u26a0\ufe0f  ${warning}`);
    }
    console.warn('   Check for typos in .workflow/config.json');
  }
}

// ============================================================
// Compat Shim
// ============================================================

/**
 * Backwards-compat shim for config consolidation.
 * Maps old top-level keys to their new consolidated paths.
 *
 * v1.10.0: Removed shims for dead targets (reporting, strictMode object).
 * Remaining shims kept for backward compatibility with existing user configs.
 */
function applyConfigCompatShim(config) {
  if (!config || typeof config !== 'object') return config;

  // execution <-> tasks + loops (bidirectional)
  if (config.execution && !config.tasks) {
    config.tasks = { ...config.execution };
  }
  if (config.tasks && !config.execution) {
    config.execution = { ...config.tasks };
  }
  if (config.execution && config.execution.loops && !config.loops) {
    config.loops = { ...config.execution.loops };
  }
  if (config.loops && config.execution && !config.execution.loops) {
    config.execution.loops = { ...config.loops };
  }

  // memory <- memory.automatic, memory.promotion
  if (config.memory) {
    if (config.memory.automatic && !config.automaticMemory) {
      config.automaticMemory = config.memory.automatic;
    }
    if (config.memory.promotion && !config.automaticPromotion) {
      config.automaticPromotion = config.memory.promotion;
    }
  }

  // learning <- learning.session, learning.crossSession, etc.
  if (config.learning) {
    if (config.learning.session && !config.sessionLearning) config.sessionLearning = config.learning.session;
    if (config.learning.crossSession && !config.crossSessionLearning) config.crossSessionLearning = config.learning.crossSession;
    if (config.learning.skill && !config.skillLearning) config.skillLearning = config.learning.skill;
    if (config.learning.knowledgeRouting && !config.knowledgeRouting) config.knowledgeRouting = config.learning.knowledgeRouting;
    if (config.learning.modelAdapters && !config.modelAdapters) config.modelAdapters = config.learning.modelAdapters;
  }

  // review <- review.fix, review.peer, review.triage
  if (config.review) {
    if (config.review.fix && !config.reviewFix) config.reviewFix = config.review.fix;
    if (config.review.peer && !config.peerReview) config.peerReview = config.review.peer;
    if (config.review.triage && !config.triage) config.triage = config.review.triage;
  }

  // models <- models.hybrid, models.multiModel, models.cascade
  if (config.models) {
    if (config.models.hybrid && !config.hybrid) config.hybrid = config.models.hybrid;
    if (config.models.multiModel && !config.multiModel) config.multiModel = config.models.multiModel;
    if (config.models.cascade && !config.cascade) config.cascade = config.models.cascade;
  }

  // research <- research.planMode
  if (config.research && config.research.planMode && !config.planMode) {
    config.planMode = config.research.planMode;
  }

  // parallelExecution <- parallel, bulkOrchestrator, taskQueue
  if (config.parallelExecution) {
    if (config.parallelExecution.parallel && !config.parallel) config.parallel = config.parallelExecution.parallel;
    if (config.parallelExecution.bulkOrchestrator && !config.bulkOrchestrator) config.bulkOrchestrator = config.parallelExecution.bulkOrchestrator;
    if (config.parallelExecution.taskQueue && !config.taskQueue) config.taskQueue = config.parallelExecution.taskQueue;
  }

  // community <- community.sync (with conflict detection)
  if (config.community && config.community.sync) {
    if (!config.communitySync) {
      // Normal migration: old key exists, new key doesn't
      config.communitySync = config.community.sync;
    } else if (config.community.sync.enabled !== undefined &&
               config.communitySync.enabled !== undefined &&
               config.community.sync.enabled !== config.communitySync.enabled) {
      // Conflict: both keys exist with different .enabled values
      console.warn(
        `[config] Conflict: community.sync.enabled (${config.community.sync.enabled}) ` +
        `differs from communitySync.enabled (${config.communitySync.enabled}). ` +
        `Using communitySync (preferred key). Remove community.sync from config to resolve.`
      );
    }
    // Clean up deprecated nested key after migration
    delete config.community.sync;
  }

  // hooks.rules.enforcement -> enforcement
  if (config.hooks?.rules?.enforcement) {
    const he = config.hooks.rules.enforcement;
    if (!config.enforcement) config.enforcement = {};
    if (he.taskGating && !config.enforcement.taskGating) config.enforcement.taskGating = he.taskGating;
    if (he.scopeGating && !config.enforcement.scopeGating) config.enforcement.scopeGating = he.scopeGating;
    if (he.implementationGate && !config.enforcement.implementationGate) config.enforcement.implementationGate = he.implementationGate;
    if (he.todoWriteGate && !config.enforcement.todoWriteGate) config.enforcement.todoWriteGate = he.todoWriteGate;
    if (he.routingGate && !config.enforcement.routingGate) config.enforcement.routingGate = he.routingGate;
    if (he.loopEnforcement && !config.enforcement.loopEnforcement) config.enforcement.loopEnforcement = he.loopEnforcement;
  }

  // componentRules + hooks.rules.intelligence.componentReuse -> componentReuse
  if (config.componentRules && !config.componentReuse) config.componentReuse = config.componentRules;
  if (config.hooks?.rules?.intelligence?.componentReuse) {
    if (!config.componentReuse) config.componentReuse = {};
    const hcr = config.hooks.rules.intelligence.componentReuse;
    for (const key of Object.keys(hcr)) {
      if (config.componentReuse[key] === undefined) config.componentReuse[key] = hcr[key];
    }
  }
  if (config.componentReuse && config.hooks?.rules) {
    if (!config.hooks.rules.componentReuse) config.hooks.rules.componentReuse = { ...config.componentReuse };
  }

  // scattered learning sub-keys -> learning.*
  if (config.standardsCompliance?.learning && config.learning && !config.learning.standardsLearning) {
    config.learning.standardsLearning = config.standardsCompliance.learning;
  }
  if (config.errorRecovery?.learning && config.learning && !config.learning.errorRecoveryLearning) {
    config.learning.errorRecoveryLearning = config.errorRecovery.learning;
  }
  if (config.bugFlow?.learningEnforcement && config.learning && !config.learning.bugFlowLearning) {
    config.learning.bugFlowLearning = config.bugFlow.learningEnforcement;
  }

  // context -> contextManagement + taskContext
  if (config.context) {
    if (!config.contextManagement) config.contextManagement = {};
    if (config.context.compaction && !config.contextManagement.compaction) config.contextManagement.compaction = config.context.compaction;
    if (config.context.smart && !config.contextManagement.smart) config.contextManagement.smart = config.context.smart;
    if (config.context.proactive && !config.contextManagement.proactive) config.contextManagement.proactive = config.context.proactive;
    if (config.context.monitor && !config.contextManagement.monitor) config.contextManagement.monitor = config.context.monitor;

    if (!config.taskContext) config.taskContext = {};
    if (config.context.auto && !config.taskContext.auto) config.taskContext.auto = config.context.auto;
    if (config.context.scoring && !config.taskContext.scoring) config.taskContext.scoring = config.context.scoring;
    if (config.context.session && !config.taskContext.session) config.taskContext.session = config.context.session;
  }

  // tdd <-> execution.tdd
  if (config.tdd && config.execution && !config.execution.tdd) config.execution.tdd = config.tdd;
  if (config.execution?.tdd && !config.tdd) config.tdd = config.execution.tdd;

  // top-level validation -> hooks.rules.intelligence.validation
  if (config.validation && config.hooks?.rules?.intelligence?.validation) {
    const v = config.hooks.rules.intelligence.validation;
    if (config.validation.afterTaskComplete !== undefined && v.afterTaskComplete === undefined) v.afterTaskComplete = config.validation.afterTaskComplete;
    if (config.validation.beforeCommit !== undefined && v.beforeCommit === undefined) v.beforeCommit = config.validation.beforeCommit;
  }

  return config;
}

// ============================================================
// Config Reading
// ============================================================

/**
 * Read workflow config (cached, invalidates on file change)
 * Applies variable substitution ({env:VAR}, {file:path}) to config values
 */
function getConfig() {
  const configPath = PATHS.config;

  try {
    // Fast path: skip statSync if cache was populated within last 2 seconds
    // (config can't change during a hook's ~50ms lifetime)
    if (_configCache && (Date.now() - _configCacheTime) < 2000) {
      return _configCache;
    }

    const stat = fs.statSync(configPath);
    if (_configCache && _configMtime === stat.mtimeMs) {
      _configCacheTime = Date.now();
      return _configCache;
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const rawConfig = safeJsonParseString(configContent, null);
    if (!rawConfig || typeof rawConfig !== 'object') {
      console.warn('Warning: Invalid or dangerous JSON in config.json');
      return {};
    }

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
      // Apply defaults for stripped config sections, then compat shim
      let configWithDefaults = result.value;
      if (_configDefaults) {
        configWithDefaults = _configDefaults.mergeWithDefaults(configWithDefaults);
      }
      _configCache = applyConfigCompatShim(configWithDefaults);

      // Only update cache timestamp after successful processing
      _configMtime = stat.mtimeMs;
      _configCacheTime = Date.now();

      // Log substitution warnings once per session (if DEBUG)
      if (process.env.DEBUG && result.warnings.length > 0) {
        console.warn(`[config] ${result.warnings.length} unresolved substitution(s)`);
      }
    } catch (err) {
      // Fallback to raw config if substitution fails — do NOT cache mtime
      // so next call retries substitution
      console.warn(`Warning: Config substitution failed: ${err.message}`);
      let configWithDefaults = rawConfig;
      if (_configDefaults) {
        configWithDefaults = _configDefaults.mergeWithDefaults(configWithDefaults);
      }
      _configCache = applyConfigCompatShim(configWithDefaults);
      _configCacheTime = Date.now(); // Cache the fallback result briefly
      // Don't set _configMtime — next call after 2s will retry substitution
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
  return safeJsonParse(PATHS.config, {});
}

/**
 * Invalidate config cache (call after writing config)
 */
function invalidateConfigCache() {
  _configCache = null;
  _configMtime = null;
}

// ============================================================
// Config Value Access
// ============================================================

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
    if (value && typeof value === 'object' && Object.hasOwn(value, part)) {
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
  } catch (err) {
    // SECURITY: Don't fall back to non-locked write - throw instead
    throw new Error(`Could not acquire config lock after retries: ${err.message}. Config not updated.`, { cause: err });
  }

  try {
    // Re-read config after acquiring lock (may have changed)
    invalidateConfigCache();
    const config = getConfig();
    const parts = configPath.split('.');
    let obj = config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!Object.hasOwn(obj, part)) {
        obj[part] = {};
      }
      obj = obj[part];
    }

    obj[parts[parts.length - 1]] = newValue;
    writeJson(PATHS.config, config);
    invalidateConfigCache();

    // Auto-sync .gitignore only when config keys affect gitignore mappings
    if (configPath.startsWith('testing.') || configPath.startsWith('webmcp.')) {
      try {
        const { syncGitignore } = require('./flow-gitignore');
        syncGitignore(config);
      } catch (err) {
        // Non-blocking — gitignore sync should never fail config writes
      }
    }
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
    if (!Object.hasOwn(obj, part)) {
      obj[part] = {};
    }
    obj = obj[part];
  }

  obj[parts[parts.length - 1]] = newValue;
  writeJson(PATHS.config, config);
  invalidateConfigCache();

  // Auto-sync .gitignore only when config keys affect gitignore mappings
  if (configPath.startsWith('testing.') || configPath.startsWith('webmcp.')) {
    try {
      const { syncGitignore } = require('./flow-gitignore');
      syncGitignore(config);
    } catch (err) {
      // Non-blocking — gitignore sync should never fail config writes
    }
  }
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
    const homeDir = process.env.HOME || '';

    // Expand tilde to home directory
    if (filePath.startsWith('~')) {
      filePath = filePath.replace(/^~/, homeDir);
    }

    // Security: validate path is within project OR user's home directory
    // This allows reading credentials from ~/.config/ but blocks /etc/passwd etc.
    const resolvedPath = path.resolve(filePath);
    const isWithinProjectDir = isPathWithinProject(resolvedPath, PROJECT_ROOT);
    const isWithinHome = homeDir && resolvedPath.startsWith(homeDir + path.sep);

    if (!isWithinProjectDir && !isWithinHome) {
      warn(`File path outside allowed locations blocked: ${resolvedPath}`);
      return null;
    }

    try {
      return fs.readFileSync(resolvedPath, 'utf-8').trim();
    } catch (_err) {
      return null;
    }
  }

  return value;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getConfig,
  getRawConfig,
  getConfigValue,
  setConfigValue,
  setConfigValueSync,
  resolveConfigValue,
  invalidateConfigCache,
  validateConfig,
  applyConfigCompatShim,
  KNOWN_CONFIG_KEYS,
};
