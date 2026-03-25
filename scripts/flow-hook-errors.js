/**
 * flow-hook-errors.js
 *
 * Unified error handling system for WogiFlow hooks.
 * Classifies errors by type and provides user-facing messages
 * with resolution instructions.
 *
 * Each hook declares its fail mode (open/closed) and this module
 * provides consistent formatting, logging, and user guidance.
 */

// ============================================================
// Error Classification
// ============================================================

/**
 * Error types with user-facing descriptions and resolution hints.
 */
const ERROR_TYPES = {
  LOAD_FAILURE: {
    label: 'Module Load Failure',
    description: 'A required WogiFlow module could not be loaded.',
    resolution: 'Try reinstalling: npm install wogiflow. If the issue persists, check that node_modules/wogiflow/ is intact.'
  },
  FILE_IO: {
    label: 'File I/O Error',
    description: 'A WogiFlow state file could not be read or written.',
    resolution: 'Check file permissions in .workflow/state/. Run: ls -la .workflow/state/'
  },
  CORRUPTED_STATE: {
    label: 'Corrupted State File',
    description: 'A WogiFlow state file contains invalid data.',
    resolution: 'The corrupted file will be reset to defaults. If this persists, run: /wogi-health'
  },
  PERMISSION_ERROR: {
    label: 'Permission Denied',
    description: 'WogiFlow does not have permission to access a required file.',
    resolution: 'Check file ownership: ls -la .workflow/ and ensure your user owns these files.'
  },
  TIMEOUT: {
    label: 'Operation Timeout',
    description: 'A WogiFlow operation took too long to complete.',
    resolution: 'This may be caused by a slow disk or large project. Try running /wogi-health to diagnose.'
  },
  CONFIG_ERROR: {
    label: 'Configuration Error',
    description: 'The WogiFlow configuration is invalid or missing required keys.',
    resolution: 'Run /wogi-health to check config validity. Or reset with: npx flow init --reset-config'
  },
  CRITICAL: {
    label: 'Critical Error',
    description: 'An unexpected error occurred in WogiFlow.',
    resolution: 'Please report this at https://github.com/anthropics/wogiflow/issues with the error details below.'
  }
};

/**
 * Fail modes for hooks.
 */
const FAIL_MODES = {
  OPEN: 'open',     // Continue despite error (non-critical operations)
  CLOSED: 'closed'  // Block/deny on error (security/routing enforcement)
};

// ============================================================
// Error Classification Logic
// ============================================================

/**
 * Classify an error into one of the known types.
 * @param {Error} err - The caught error
 * @returns {string} One of the ERROR_TYPES keys
 */
function classifyError(err) {
  if (!err) return 'CRITICAL';

  const code = err.code;
  const message = (err.message || '').toLowerCase();

  // Module load failures
  if (code === 'MODULE_NOT_FOUND' || message.includes('cannot find module')) {
    return 'LOAD_FAILURE';
  }

  // Permission errors
  if (code === 'EACCES' || code === 'EPERM') {
    return 'PERMISSION_ERROR';
  }

  // File I/O errors (not permission, not missing — actual I/O)
  if (code === 'EIO' || code === 'EMFILE' || code === 'ENFILE') {
    return 'FILE_IO';
  }

  // Missing file — often a corrupted/missing state
  if (code === 'ENOENT') {
    return 'FILE_IO';
  }

  // JSON parse errors — corrupted state
  if (err instanceof SyntaxError && message.includes('json')) {
    return 'CORRUPTED_STATE';
  }
  if (message.includes('unexpected token') || message.includes('json')) {
    return 'CORRUPTED_STATE';
  }

  // Timeout
  if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('timed out')) {
    return 'TIMEOUT';
  }

  // Config-related
  if (message.includes('config') && (message.includes('invalid') || message.includes('missing'))) {
    return 'CONFIG_ERROR';
  }

  return 'CRITICAL';
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format a hook error for user display.
 * @param {string} hookName - Name of the hook (e.g., 'PreToolUse', 'SessionStart')
 * @param {Error} err - The caught error
 * @param {Object} [options] - Options
 * @param {string} [options.failMode] - 'open' or 'closed'
 * @param {string} [options.operation] - What operation was being performed
 * @returns {{ type: string, userMessage: string, debugMessage: string, resolution: string }}
 */
function formatHookError(hookName, err, options = {}) {
  const type = classifyError(err);
  const info = ERROR_TYPES[type] || ERROR_TYPES.CRITICAL;
  const operation = options.operation || 'processing';

  const userMessage = `[WogiFlow] ${info.label} in ${hookName} hook during ${operation}`;
  const debugMessage = `[WogiFlow:${hookName}] ${type}: ${err.message}\n${err.stack || ''}`;
  const resolution = info.resolution;

  return { type, userMessage, debugMessage, resolution, description: info.description };
}

/**
 * Log an error to stderr with appropriate detail level.
 * @param {string} hookName - Name of the hook
 * @param {Error} err - The caught error
 * @param {Object} [options] - Options
 * @param {string} [options.failMode] - 'open' or 'closed'
 * @param {string} [options.operation] - What operation was being performed
 */
function logHookError(hookName, err, options = {}) {
  const formatted = formatHookError(hookName, err, options);
  // Debug env var hierarchy:
  //   DEBUG           — General-purpose debug flag (used across ~30 scripts for verbose logging)
  //   WOGIFLOW_DEBUG  — WogiFlow-specific debug flag (equivalent to DEBUG but namespaced)
  //   DEBUG_LSP       — LSP-only debug flag (used exclusively in flow-lsp.js for LSP protocol debugging)
  // DEBUG and WOGIFLOW_DEBUG are interchangeable; either enables verbose error output.
  // DEBUG_LSP is independent — it controls only LSP stderr/parse-error logging.
  const isDebug = process.env.DEBUG || process.env.WOGIFLOW_DEBUG;

  if (isDebug) {
    process.stderr.write(formatted.debugMessage + '\n');
  } else {
    process.stderr.write(formatted.userMessage + '\n');
    process.stderr.write(`  ${formatted.description}\n`);
    process.stderr.write(`  Fix: ${formatted.resolution}\n`);
  }
}

// ============================================================
// Hook-Level Error Wrapper
// ============================================================

/**
 * Wrap a hook operation with consistent error handling.
 * @param {string} hookName - Name of the hook
 * @param {string} operation - Description of the operation
 * @param {Function} fn - The operation to execute (sync)
 * @param {Object} [options] - Options
 * @param {string} [options.failMode='open'] - 'open' (continue) or 'closed' (block)
 * @param {*} [options.fallback=null] - Value to return on failure in fail-open mode
 * @returns {*} Result of fn() or fallback on error
 */
function withErrorHandling(hookName, operation, fn, options = {}) {
  const failMode = options.failMode || FAIL_MODES.OPEN;
  const fallback = options.fallback !== undefined ? options.fallback : null;

  try {
    return fn();
  } catch (err) {
    logHookError(hookName, err, { failMode, operation });

    if (failMode === FAIL_MODES.CLOSED) {
      throw err; // Re-throw for closed mode — caller handles the block
    }

    return fallback;
  }
}

/**
 * Async version of withErrorHandling.
 */
async function withErrorHandlingAsync(hookName, operation, fn, options = {}) {
  const failMode = options.failMode || FAIL_MODES.OPEN;
  const fallback = options.fallback !== undefined ? options.fallback : null;

  try {
    return await fn();
  } catch (err) {
    logHookError(hookName, err, { failMode, operation });

    if (failMode === FAIL_MODES.CLOSED) {
      throw err;
    }

    return fallback;
  }
}

// ============================================================
// Hook Policy Registry
// ============================================================

/**
 * Default fail modes for each hook and operation.
 * Hooks can override per-operation, but this provides the baseline policy.
 */
const HOOK_POLICIES = {
  SessionStart: {
    default: FAIL_MODES.OPEN,
    operations: {
      'bridge-sync': FAIL_MODES.OPEN,
      'drift-detection': FAIL_MODES.OPEN,
      'version-check': FAIL_MODES.OPEN,
      'context-gathering': FAIL_MODES.OPEN,
      'plugin-scan': FAIL_MODES.OPEN
    }
  },
  PreToolUse: {
    default: FAIL_MODES.OPEN,
    operations: {
      'routing-gate': FAIL_MODES.CLOSED,
      'task-gate': FAIL_MODES.OPEN,
      'scope-gate': FAIL_MODES.OPEN,
      'phase-gate': FAIL_MODES.OPEN,
      'validation': FAIL_MODES.OPEN,
      'component-check': FAIL_MODES.OPEN
    }
  },
  PostToolUse: {
    default: FAIL_MODES.OPEN,
    operations: {
      'observation-capture': FAIL_MODES.OPEN,
      'durable-session': FAIL_MODES.OPEN,
      'validation': FAIL_MODES.OPEN
    }
  },
  Stop: {
    default: FAIL_MODES.OPEN,
    operations: {
      'routing-check': FAIL_MODES.CLOSED,
      'loop-exit': FAIL_MODES.OPEN
    }
  }
};

/**
 * Get the fail mode for a specific hook + operation combination.
 * @param {string} hookName
 * @param {string} operation
 * @returns {string} Fail mode
 */
function getFailMode(hookName, operation) {
  const policy = HOOK_POLICIES[hookName];
  if (!policy) return FAIL_MODES.OPEN;
  if (policy.operations && policy.operations[operation]) {
    return policy.operations[operation];
  }
  return policy.default || FAIL_MODES.OPEN;
}

module.exports = {
  ERROR_TYPES,
  FAIL_MODES,
  HOOK_POLICIES,
  classifyError,
  formatHookError,
  logHookError,
  withErrorHandling,
  withErrorHandlingAsync,
  getFailMode
};
