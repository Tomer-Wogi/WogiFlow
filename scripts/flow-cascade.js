#!/usr/bin/env node

/**
 * Wogi Flow - Cascade Fallback System
 *
 * Tracks model failures and determines when to escalate to alternate models.
 * Auto-escalates after repeated failures on the same error category.
 *
 * Part of Phase 3: Intelligent Routing
 *
 * Usage:
 *   flow cascade status              Show current cascade state
 *   flow cascade reset [model]       Reset failure counts
 *   flow cascade config              Show cascade configuration
 *   flow cascade simulate            Simulate failures for testing
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  parseFlags,
  outputJson,
  color,
  info,
  warn,
  error,
  getConfig,
  fileExists,
  writeJson,
  printHeader,
  printSection
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/**
 * Standardized failure categories for consistent error classification.
 * Used across the system for stats tracking and cascade decisions.
 */
const FAILURE_CATEGORIES = {
  PARSE_ERROR: 'parse_error',
  IMPORT_ERROR: 'import_error',
  TYPE_ERROR: 'type_error',
  SYNTAX_ERROR: 'syntax_error',
  RUNTIME_ERROR: 'runtime_error',
  RATE_LIMIT: 'rate_limit',
  CONTEXT_OVERFLOW: 'context_overflow',
  CAPABILITY_MISMATCH: 'capability_mismatch',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown'
};

/**
 * Configuration constants for error tracking.
 */
const MAX_ERROR_MESSAGE_LENGTH = 200;
const MAX_ERRORS_TO_STORE = 10;

/**
 * Default cascade configuration.
 * Can be overridden in .workflow/config.json under "cascade" key.
 */
const DEFAULT_CASCADE_CONFIG = {
  enabled: true,
  maxFailuresBeforeEscalate: 3,
  escalateOnCategories: ['capability_mismatch', 'context_overflow', 'rate_limit'],
  resetAfterMinutes: 30,
  persistState: false
};

/**
 * Patterns for detecting failure categories from error messages.
 * Order matters - first match wins.
 */
const CATEGORY_PATTERNS = [
  { pattern: /rate.?limit|too.?many.?requests|429/i, category: FAILURE_CATEGORIES.RATE_LIMIT },
  { pattern: /context.*(?:length|overflow|exceeded)|token.*limit/i, category: FAILURE_CATEGORIES.CONTEXT_OVERFLOW },
  { pattern: /capability|unsupported|not.?available/i, category: FAILURE_CATEGORIES.CAPABILITY_MISMATCH },
  { pattern: /timeout|timed?.?out/i, category: FAILURE_CATEGORIES.TIMEOUT },
  { pattern: /cannot.?find.?module|import.*error|module.?not.?found/i, category: FAILURE_CATEGORIES.IMPORT_ERROR },
  { pattern: /type.?error|is.?not.?assignable|property.*does.?not.?exist/i, category: FAILURE_CATEGORIES.TYPE_ERROR },
  { pattern: /syntax.?error|unexpected.?token/i, category: FAILURE_CATEGORIES.SYNTAX_ERROR },
  { pattern: /parse.?error|json.*parse|invalid.?json/i, category: FAILURE_CATEGORIES.PARSE_ERROR },
  { pattern: /runtime.?error|reference.?error/i, category: FAILURE_CATEGORIES.RUNTIME_ERROR }
];

// ============================================================
// State Management
// ============================================================

const STATE_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'cascade-state.json');

/**
 * In-memory failure tracker.
 * Key format: "modelId:taskType:category"
 * Value: { count, firstFailure, lastFailure, errors[] }
 */
let failureTracker = {};

/**
 * Load cascade state from file (if persistence enabled).
 * @returns {Object} Loaded state or empty tracker
 */
function loadState() {
  const config = getCascadeConfig();

  if (!config.persistState || !fileExists(STATE_PATH)) {
    return {};
  }

  try {
    const content = fs.readFileSync(STATE_PATH, 'utf-8');
    const state = JSON.parse(content);

    // Clean up expired entries
    const now = Date.now();
    const resetMs = config.resetAfterMinutes * 60 * 1000;

    for (const key of Object.keys(state)) {
      if (now - new Date(state[key].lastFailure).getTime() > resetMs) {
        delete state[key];
      }
    }

    return state;
  } catch (err) {
    warn(`Could not load cascade state: ${err.message}`);
    return {};
  }
}

/**
 * Save cascade state to file (if persistence enabled).
 */
function saveState() {
  const config = getCascadeConfig();

  if (!config.persistState) {
    return;
  }

  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeJson(STATE_PATH, failureTracker);
  } catch (err) {
    warn(`Could not save cascade state: ${err.message}`);
  }
}

/**
 * Initialize failure tracker from persisted state.
 */
function initializeTracker() {
  failureTracker = loadState();
}

// Initialize on module load
initializeTracker();

// ============================================================
// Configuration
// ============================================================

/**
 * Get cascade configuration from config.json with defaults.
 * @returns {Object} Cascade configuration
 */
function getCascadeConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_CASCADE_CONFIG,
    ...(config?.cascade || {})
  };
}

// ============================================================
// Failure Detection
// ============================================================

/**
 * Detect failure category from error message.
 * @param {string|Error} errorOrMessage - Error object or message string
 * @returns {string} Detected failure category
 */
function detectCategory(errorOrMessage) {
  const message = errorOrMessage instanceof Error
    ? errorOrMessage.message
    : String(errorOrMessage);

  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(message)) {
      return category;
    }
  }

  return FAILURE_CATEGORIES.UNKNOWN;
}

/**
 * Generate tracker key from components.
 * @param {string} modelId - Model identifier
 * @param {string} taskType - Task type
 * @param {string} category - Failure category
 * @returns {string} Tracker key
 */
function getTrackerKey(modelId, taskType, category) {
  return `${modelId}:${taskType}:${category}`;
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Record a failure for cascade tracking.
 * @param {Object} params - Failure parameters
 * @param {string} params.modelId - Model that failed
 * @param {string} params.taskType - Type of task that failed
 * @param {string|Error} params.error - Error message or object
 * @param {string} [params.category] - Override detected category
 * @returns {Object} Updated failure info and escalation recommendation
 */
function recordFailure(params) {
  const { modelId, taskType, error: errorInput, category: explicitCategory } = params;
  const config = getCascadeConfig();

  if (!config.enabled) {
    return { recorded: false, reason: 'cascade disabled' };
  }

  const category = explicitCategory || detectCategory(errorInput);
  const key = getTrackerKey(modelId, taskType, category);
  const now = new Date().toISOString();
  const errorMessage = errorInput instanceof Error ? errorInput.message : String(errorInput);

  // Check if we need to reset due to time expiry
  if (failureTracker[key]) {
    const lastFailure = new Date(failureTracker[key].lastFailure).getTime();
    const resetMs = config.resetAfterMinutes * 60 * 1000;

    if (Date.now() - lastFailure > resetMs) {
      delete failureTracker[key];
    }
  }

  // Initialize or update tracker entry
  if (!failureTracker[key]) {
    failureTracker[key] = {
      modelId,
      taskType,
      category,
      count: 0,
      firstFailure: now,
      lastFailure: now,
      errors: []
    };
  }

  failureTracker[key].count++;
  failureTracker[key].lastFailure = now;
  failureTracker[key].errors.push({
    timestamp: now,
    message: errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH)
  });

  // Keep only most recent errors
  if (failureTracker[key].errors.length > MAX_ERRORS_TO_STORE) {
    failureTracker[key].errors = failureTracker[key].errors.slice(-MAX_ERRORS_TO_STORE);
  }

  saveState();

  // Check if escalation is recommended
  const shouldEscalateNow = shouldEscalate(modelId, taskType, category);

  return {
    recorded: true,
    key,
    category,
    count: failureTracker[key].count,
    threshold: config.maxFailuresBeforeEscalate,
    shouldEscalate: shouldEscalateNow,
    escalateReason: shouldEscalateNow
      ? `${failureTracker[key].count} consecutive ${category} failures`
      : null
  };
}

/**
 * Record a success, resetting failure count for that model/task combination.
 * @param {Object} params - Success parameters
 * @param {string} params.modelId - Model that succeeded
 * @param {string} params.taskType - Type of task
 */
function recordSuccess(params) {
  const { modelId, taskType } = params;

  // Reset all failure categories for this model/task
  const prefix = `${modelId}:${taskType}:`;
  for (const key of Object.keys(failureTracker)) {
    if (key.startsWith(prefix)) {
      delete failureTracker[key];
    }
  }

  saveState();
}

/**
 * Check if escalation is recommended for a model/task combination.
 * @param {string} modelId - Model identifier
 * @param {string} taskType - Task type
 * @param {string} [category] - Specific category to check
 * @returns {boolean} Whether escalation is recommended
 */
function shouldEscalate(modelId, taskType, category = null) {
  const config = getCascadeConfig();

  if (!config.enabled) {
    return false;
  }

  // If category specified, check only that
  if (category) {
    const key = getTrackerKey(modelId, taskType, category);
    const entry = failureTracker[key];

    if (!entry) return false;

    // Check if this category triggers escalation
    if (!config.escalateOnCategories.includes(category)) {
      return false;
    }

    return entry.count >= config.maxFailuresBeforeEscalate;
  }

  // Check all escalation-triggering categories
  for (const cat of config.escalateOnCategories) {
    const key = getTrackerKey(modelId, taskType, cat);
    const entry = failureTracker[key];

    if (entry && entry.count >= config.maxFailuresBeforeEscalate) {
      return true;
    }
  }

  return false;
}

/**
 * Get escalation recommendation with target model.
 * @param {string} currentModelId - Currently failing model
 * @param {Object} routing - Routing decision with fallback/escalation info
 * @returns {Object} Escalation recommendation
 */
function getEscalationTarget(currentModelId, routing) {
  const config = getCascadeConfig();

  if (!config.enabled) {
    return { shouldEscalate: false, reason: 'cascade disabled' };
  }

  // Get failure info for current model
  const failures = getModelFailures(currentModelId);

  if (failures.length === 0) {
    return { shouldEscalate: false, reason: 'no failures recorded' };
  }

  // Check if any category hit threshold
  const triggeredCategory = failures.find(f =>
    config.escalateOnCategories.includes(f.category) &&
    f.count >= config.maxFailuresBeforeEscalate
  );

  if (!triggeredCategory) {
    return {
      shouldEscalate: false,
      reason: 'threshold not reached',
      failures
    };
  }

  // Determine target model
  let targetModel = null;
  let targetReason = '';

  // Try fallback first
  if (routing?.fallback && routing.fallback.modelId !== currentModelId) {
    targetModel = routing.fallback.modelId;
    targetReason = 'fallback model';
  }
  // Then escalation
  else if (routing?.escalation && routing.escalation.modelId !== currentModelId) {
    targetModel = routing.escalation.modelId;
    targetReason = 'escalation model (higher tier)';
  }

  if (!targetModel) {
    return {
      shouldEscalate: true,
      reason: `${triggeredCategory.count}x ${triggeredCategory.category}`,
      noAlternative: true,
      message: 'No alternative model available'
    };
  }

  return {
    shouldEscalate: true,
    reason: `${triggeredCategory.count}x ${triggeredCategory.category}`,
    targetModel,
    targetReason,
    triggeredCategory: triggeredCategory.category
  };
}

/**
 * Get all failures for a specific model.
 * @param {string} modelId - Model identifier
 * @returns {Object[]} Array of failure entries
 */
function getModelFailures(modelId) {
  const prefix = `${modelId}:`;
  return Object.entries(failureTracker)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => ({
      ...value,
      key
    }));
}

/**
 * Reset failures for a model or all models.
 * @param {string} [modelId] - Specific model to reset, or null for all
 * @param {string} [taskType] - Specific task type to reset
 */
function resetFailures(modelId = null, taskType = null) {
  if (!modelId) {
    failureTracker = {};
  } else if (!taskType) {
    const prefix = `${modelId}:`;
    for (const key of Object.keys(failureTracker)) {
      if (key.startsWith(prefix)) {
        delete failureTracker[key];
      }
    }
  } else {
    const prefix = `${modelId}:${taskType}:`;
    for (const key of Object.keys(failureTracker)) {
      if (key.startsWith(prefix)) {
        delete failureTracker[key];
      }
    }
  }

  saveState();
}

/**
 * Get current cascade status.
 * @returns {Object} Status summary
 */
function getCascadeStatus() {
  const config = getCascadeConfig();
  const now = Date.now();
  const resetMs = config.resetAfterMinutes * 60 * 1000;

  const entries = Object.entries(failureTracker).map(([key, value]) => {
    const timeSinceLastMs = now - new Date(value.lastFailure).getTime();
    const expiresInMs = resetMs - timeSinceLastMs;

    return {
      ...value,
      key,
      expiresIn: expiresInMs > 0 ? Math.ceil(expiresInMs / 60000) : 0,
      atThreshold: value.count >= config.maxFailuresBeforeEscalate,
      willTriggerEscalation: value.count >= config.maxFailuresBeforeEscalate &&
        config.escalateOnCategories.includes(value.category)
    };
  });

  // Group by model
  const byModel = {};
  for (const entry of entries) {
    if (!byModel[entry.modelId]) {
      byModel[entry.modelId] = [];
    }
    byModel[entry.modelId].push(entry);
  }

  return {
    enabled: config.enabled,
    config: {
      maxFailuresBeforeEscalate: config.maxFailuresBeforeEscalate,
      escalateOnCategories: config.escalateOnCategories,
      resetAfterMinutes: config.resetAfterMinutes
    },
    totalTracked: entries.length,
    atThreshold: entries.filter(e => e.atThreshold).length,
    willTriggerEscalation: entries.filter(e => e.willTriggerEscalation).length,
    byModel,
    entries
  };
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Print cascade status.
 */
function printStatus() {
  const status = getCascadeStatus();

  printHeader('CASCADE FALLBACK STATUS');

  printSection('Configuration');
  console.log(`  ${color('dim', 'Enabled:')} ${status.enabled ? color('green', 'Yes') : color('red', 'No')}`);
  console.log(`  ${color('dim', 'Threshold:')} ${status.config.maxFailuresBeforeEscalate} failures`);
  console.log(`  ${color('dim', 'Reset after:')} ${status.config.resetAfterMinutes} minutes`);
  console.log(`  ${color('dim', 'Escalate on:')} ${status.config.escalateOnCategories.join(', ')}`);

  printSection('Current State');
  console.log(`  ${color('dim', 'Tracked entries:')} ${status.totalTracked}`);
  console.log(`  ${color('dim', 'At threshold:')} ${status.atThreshold}`);
  console.log(`  ${color('dim', 'Will escalate:')} ${status.willTriggerEscalation}`);

  if (status.totalTracked > 0) {
    printSection('By Model');
    for (const [modelId, entries] of Object.entries(status.byModel)) {
      const atThreshold = entries.filter(e => e.atThreshold).length;
      const icon = atThreshold > 0 ? color('red', '!') : color('green', '-');
      console.log(`\n  ${icon} ${color('cyan', modelId)}`);

      for (const entry of entries) {
        const countColor = entry.atThreshold ? 'red' : 'yellow';
        const escalateIcon = entry.willTriggerEscalation ? ' [ESCALATE]' : '';
        console.log(`    ${entry.taskType}/${entry.category}: ${color(countColor, entry.count)}/${status.config.maxFailuresBeforeEscalate}${escalateIcon}`);
        if (entry.expiresIn > 0) {
          console.log(`      ${color('dim', `expires in ${entry.expiresIn}m`)}`);
        }
      }
    }
  }

  console.log('');
}

/**
 * Print cascade configuration.
 */
function printConfig() {
  const config = getCascadeConfig();

  printHeader('CASCADE CONFIGURATION');

  console.log(`\nCurrent settings (from .workflow/config.json):\n`);
  console.log(JSON.stringify({ cascade: config }, null, 2));

  console.log(`\nFailure categories:`);
  for (const [name, value] of Object.entries(FAILURE_CATEGORIES)) {
    const triggers = config.escalateOnCategories.includes(value)
      ? color('yellow', ' [triggers escalation]')
      : '';
    console.log(`  ${color('cyan', name)}: ${value}${triggers}`);
  }

  console.log('');
}

// ============================================================
// CLI Entry Point
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Cascade Fallback System

Track model failures and auto-escalate to alternate models.

Usage:
  flow cascade status              Show current cascade state
  flow cascade reset [model]       Reset failure counts
  flow cascade config              Show cascade configuration
  flow cascade simulate            Simulate failures for testing

Options:
  --model <id>       Target model for operation
  --task-type <type> Target task type
  --category <cat>   Failure category
  --json             Output as JSON
  --help, -h         Show this help

Examples:
  flow cascade status                          # Show status
  flow cascade reset                           # Reset all
  flow cascade reset --model claude-sonnet-4   # Reset specific model
  flow cascade simulate --model claude-sonnet-4 --category context_overflow
`);
}

async function main() {
  const args = process.argv.slice(2);
  const { flags } = parseFlags(args);
  const command = args.find(a => !a.startsWith('--')) || 'status';

  if (flags.help || flags.h) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'status':
      if (flags.json) {
        outputJson(getCascadeStatus());
      } else {
        printStatus();
      }
      break;

    case 'config':
      if (flags.json) {
        outputJson({
          config: getCascadeConfig(),
          categories: FAILURE_CATEGORIES
        });
      } else {
        printConfig();
      }
      break;

    case 'reset':
      const modelToReset = flags.model || null;
      const taskTypeToReset = flags['task-type'] || null;
      resetFailures(modelToReset, taskTypeToReset);

      if (modelToReset) {
        info(`Reset failures for model: ${modelToReset}`);
      } else {
        info('Reset all failure tracking');
      }
      break;

    case 'simulate':
      // For testing - simulate failures
      if (!flags.model) {
        error('--model is required for simulate');
        process.exit(1);
      }

      const result = recordFailure({
        modelId: flags.model,
        taskType: flags['task-type'] || 'feature',
        error: flags.error || 'Simulated failure',
        category: flags.category
      });

      if (flags.json) {
        outputJson(result);
      } else {
        info(`Recorded failure: ${result.category}`);
        console.log(`  Count: ${result.count}/${result.threshold}`);
        if (result.shouldEscalate) {
          warn(`Escalation recommended: ${result.escalateReason}`);
        }
      }
      break;

    default:
      error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Constants
  FAILURE_CATEGORIES,
  DEFAULT_CASCADE_CONFIG,

  // Core functions
  recordFailure,
  recordSuccess,
  shouldEscalate,
  getEscalationTarget,
  getModelFailures,
  resetFailures,
  getCascadeStatus,
  getCascadeConfig,

  // Utilities
  detectCategory
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
