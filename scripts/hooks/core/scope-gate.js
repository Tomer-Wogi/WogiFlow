#!/usr/bin/env node

/**
 * Wogi Flow - Scope Gate (Core Module)
 *
 * v4.0: Runtime scope enforcement for task-work alignment.
 * Validates that file edits are within the task's declared scope
 * (from spec's filesToChange).
 *
 * This module wraps task-gate and adds scope checking:
 * 1. First checks if a task is active (via task-gate)
 * 2. Then checks if the file being edited is in the task's scope
 * 3. Warns or blocks based on configuration
 */

const path = require('path');

// Import from parent scripts directory
const { getConfig, getProjectRoot } = require('../../flow-utils');
const { checkTaskGate, getActiveTask } = require('./task-gate');
const { getSessionFileScope, getSessionBoundaries } = require('../../flow-durable-session');

/**
 * Get all scope gating settings from config (single read)
 * @returns {{ enabled: boolean, mode: string, exemptPatterns: string[] }}
 */
function getScopeGatingSettings() {
  const config = getConfig();
  const scopeConfig = config.hooks?.rules?.scopeGating || {};
  return {
    enabled: scopeConfig.enabled !== false,
    mode: scopeConfig.mode || 'warn',
    exemptPatterns: scopeConfig.exemptPatterns || [
      '.workflow/state/**',
      '.workflow/specs/**',
      '.workflow/plans/**',
      'package.json',
      'tsconfig.json',
      'package-lock.json'
    ]
  };
}

/**
 * Check if scope gating is enabled
 * @returns {boolean}
 */
function isScopeGatingEnabled() {
  return getScopeGatingSettings().enabled;
}

/**
 * Get the scope gating mode
 * @returns {string} 'warn' | 'block'
 */
function getScopeGatingMode() {
  return getScopeGatingSettings().mode;
}

/**
 * Get exempt patterns from config
 * @returns {string[]}
 */
function getExemptPatterns() {
  return getScopeGatingSettings().exemptPatterns;
}

/**
 * Validate that a path is within the project root (prevents path traversal)
 * @param {string} filePath - The file path to validate
 * @returns {boolean} True if path is within project
 */
function isPathWithinProject(filePath) {
  try {
    const projectRoot = getProjectRoot();
    const resolvedPath = path.resolve(projectRoot, filePath);
    return resolvedPath.startsWith(projectRoot + path.sep) || resolvedPath === projectRoot;
  } catch (_err) {
    // If we can't resolve, reject for safety
    return false;
  }
}

/**
 * Check if a file path matches a pattern
 * Supports:
 * - Exact paths: 'src/index.ts'
 * - Directory patterns: 'src/components/**' (recursive)
 * - Directory patterns: 'src/components/*' (direct children only)
 *
 * @param {string} filePath - The file being edited
 * @param {string} pattern - The pattern to match against
 * @returns {boolean}
 */
function matchesPattern(filePath, pattern) {
  // Validate inputs
  if (!filePath || !pattern || typeof filePath !== 'string' || typeof pattern !== 'string') {
    return false;
  }

  // Reject path traversal attempts
  if (pattern.includes('..') || filePath.includes('..')) {
    return false;
  }

  // Normalize paths (convert backslashes to forward slashes for consistency)
  const normalizedFile = path.normalize(filePath).replace(/\\/g, '/');
  const normalizedPattern = path.normalize(pattern).replace(/\\/g, '/');

  // Validate the file path is within project after normalization
  if (!isPathWithinProject(normalizedFile)) {
    return false;
  }

  // Exact match
  if (normalizedFile === normalizedPattern) {
    return true;
  }

  // Directory pattern (ends with /**) - recursive match
  if (normalizedPattern.endsWith('/**')) {
    const dirPrefix = normalizedPattern.slice(0, -3);
    return normalizedFile.startsWith(dirPrefix + '/') || normalizedFile === dirPrefix;
  }

  // Directory pattern (ends with /*) - direct children only
  if (normalizedPattern.endsWith('/*')) {
    const dirPrefix = normalizedPattern.slice(0, -2);
    // Only match files directly in the directory, not subdirectories
    if (!normalizedFile.startsWith(dirPrefix + '/')) {
      return false;
    }
    const relativePath = normalizedFile.slice(dirPrefix.length + 1);
    return !relativePath.includes('/');
  }

  // File is within a directory specified as scope (without glob)
  // e.g., scope "src/utils" matches "src/utils/helper.ts"
  if (normalizedFile.startsWith(normalizedPattern + '/')) {
    return true;
  }

  return false;
}

/**
 * Check if a file is in the exempt list
 * @param {string} filePath - The file being edited
 * @returns {boolean}
 */
function isFileExempt(filePath) {
  if (!filePath) {
    return false;
  }

  const exemptPatterns = getExemptPatterns();

  for (const pattern of exemptPatterns) {
    if (matchesPattern(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file is within the task's declared scope
 *
 * @param {string} filePath - The file being edited
 * @param {Object} filesToChange - The scope object from spec
 * @param {Array} filesToChange.create - Files to create
 * @param {Array} filesToChange.modify - Files to modify (may be objects with .path)
 * @param {Array} filesToChange.delete - Files to delete
 * @returns {boolean}
 */
function isFileInScope(filePath, filesToChange) {
  // If no scope object provided, scope gating is disabled for this task
  if (!filesToChange) {
    return true;
  }

  // Extract all file paths from the scope
  const allFiles = [];

  // Add create files
  if (Array.isArray(filesToChange.create)) {
    for (const file of filesToChange.create) {
      if (typeof file === 'string' && file.length > 0) {
        allFiles.push(file);
      }
    }
  }

  // Add modify files (may be strings or objects with .path)
  if (Array.isArray(filesToChange.modify)) {
    for (const file of filesToChange.modify) {
      if (typeof file === 'string' && file.length > 0) {
        allFiles.push(file);
      } else if (file && typeof file.path === 'string' && file.path.length > 0) {
        allFiles.push(file.path);
      }
    }
  }

  // Add delete files
  if (Array.isArray(filesToChange.delete)) {
    for (const file of filesToChange.delete) {
      if (typeof file === 'string' && file.length > 0) {
        allFiles.push(file);
      }
    }
  }

  // If scope is explicitly defined but empty, no changes are allowed
  // This means the spec declared filesToChange but with no files
  if (allFiles.length === 0) {
    return false;
  }

  // Check if file matches any scope pattern
  for (const pattern of allFiles) {
    if (matchesPattern(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file violates boundary declarations (DO NOT MODIFY list)
 *
 * @param {string} filePath - The file being edited
 * @param {string[]} boundaries - Array of boundary patterns (file paths or globs)
 * @returns {string|null} The matched boundary pattern, or null if no violation
 */
function isFileBoundaryViolation(filePath, boundaries) {
  if (!boundaries || !Array.isArray(boundaries) || boundaries.length === 0) {
    return null;
  }

  for (const pattern of boundaries) {
    if (typeof pattern === 'string' && pattern.length > 0 && matchesPattern(filePath, pattern)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Generate block message for boundary violations
 * @param {string} filePath - The file being edited
 * @param {Object} task - The active task
 * @param {string} matchedBoundary - The boundary pattern that was violated
 * @returns {string}
 */
function generateBoundaryBlockMessage(filePath, task, matchedBoundary) {
  if (!filePath || !task) {
    return 'BOUNDARY VIOLATION: File is in the task\'s DO NOT MODIFY list';
  }

  const fileName = path.basename(filePath);

  return `BOUNDARY VIOLATION: Cannot edit ${fileName}

Task: ${task.id}${task.title ? ' - ' + task.title : ''}
Matched boundary: ${matchedBoundary}

This file is explicitly listed in the task's "## Boundaries (DO NOT MODIFY)" section.
It must NOT be changed during this task, even if it seems related.

To proceed:
1. Remove this file from the Boundaries section in the spec, OR
2. Complete current task and start a new one for this file`;
}

/**
 * Generate warning message for out-of-scope edits
 * @param {string} filePath - The file being edited
 * @param {Object} task - The active task
 * @param {Object} filesToChange - The scope object
 * @returns {string}
 */
function generateScopeWarning(filePath, task, filesToChange) {
  // Defensive: handle missing inputs gracefully
  if (!filePath || !task || !filesToChange) {
    return 'Scope warning: File not in task scope (insufficient context for details)';
  }

  const fileName = path.basename(filePath);
  const fileCount = (filesToChange.create?.length || 0) +
                    (filesToChange.modify?.length || 0) +
                    (filesToChange.delete?.length || 0);

  return `Scope Warning: Editing ${fileName} which is not in task scope.
Task: ${task.id}${task.title ? ' - ' + task.title : ''}
Spec defines ${fileCount} file(s) in scope.
Proceed with caution - this file may not be related to your current task.`;
}

/**
 * Generate block message for out-of-scope edits
 * @param {string} filePath - The file being edited
 * @param {Object} task - The active task
 * @param {Object} filesToChange - The scope object
 * @returns {string}
 */
function generateScopeBlockMessage(filePath, task, filesToChange) {
  // Defensive: handle missing inputs gracefully
  if (!filePath || !task || !filesToChange) {
    return 'Scope Violation: Cannot edit file - not in task scope';
  }

  const fileName = path.basename(filePath);

  // Get first few files from scope for context
  const scopeFiles = [
    ...(filesToChange.create || []).slice(0, 2),
    ...(filesToChange.modify || []).slice(0, 2).map(file => typeof file === 'string' ? file : file?.path)
  ].filter(Boolean).slice(0, 3);

  return `Scope Violation: Cannot edit ${fileName}

Task: ${task.id}${task.title ? ' - ' + task.title : ''}
Expected scope includes: ${scopeFiles.join(', ')}${scopeFiles.length >= 3 ? ', ...' : ''}

To proceed:
1. Update the spec to include this file, OR
2. Complete current task and start a new one for this file, OR
3. Set scopeGating.mode to "warn" in config to allow with warning`;
}

/**
 * Main scope gate check
 * Wraps task-gate and adds scope validation
 *
 * @param {Object} options
 * @param {string} options.filePath - Path being edited/written
 * @param {string} options.operation - 'edit' or 'write'
 * @returns {Object} Result: { allowed, blocked, message, warning, task, scopeChecked, inScope }
 */
function checkScopeGate(options = {}) {
  const { filePath } = options;

  // First, run the normal task gate
  const taskResult = checkTaskGate(options);

  // If task gate blocked, return that result (no task active)
  if (taskResult.blocked) {
    return taskResult;
  }

  // Check if scope gating is enabled
  if (!isScopeGatingEnabled()) {
    return { ...taskResult, scopeChecked: false, reason: 'scope_gating_disabled' };
  }

  // Check if file is exempt
  if (filePath && isFileExempt(filePath)) {
    return { ...taskResult, scopeChecked: true, inScope: true, reason: 'file_exempt' };
  }

  // Get the active task
  const activeTask = taskResult.task || getActiveTask();
  if (!activeTask) {
    return { ...taskResult, scopeChecked: false, reason: 'no_active_task' };
  }

  // Check boundary declarations FIRST (boundaries take priority over scope whitelist)
  const boundaries = getSessionBoundaries();
  if (boundaries && filePath) {
    const matchedBoundary = isFileBoundaryViolation(filePath, boundaries);
    if (matchedBoundary) {
      const mode = getScopeGatingMode();
      if (mode === 'warn') {
        return {
          ...taskResult,
          scopeChecked: true,
          inScope: false,
          boundaryViolation: true,
          warning: generateBoundaryBlockMessage(filePath, activeTask, matchedBoundary),
          reason: 'boundary_violation_warning'
        };
      }
      // Block mode — boundaries always block
      return {
        allowed: false,
        blocked: true,
        scopeChecked: true,
        inScope: false,
        boundaryViolation: true,
        message: generateBoundaryBlockMessage(filePath, activeTask, matchedBoundary),
        reason: 'boundary_violation_blocked'
      };
    }
  }

  // Get scope from durable session
  const filesToChange = getSessionFileScope();

  // If no scope defined (spec didn't have filesToChange), skip scope check
  // This allows tasks without specs to work normally
  if (!filesToChange) {
    if (process.env.DEBUG) {
      console.log('[scope-gate] No scope defined in session - skipping scope enforcement');
    }
    return {
      ...taskResult,
      scopeChecked: false,
      reason: 'no_scope_defined'
    };
  }

  // Check if file is in scope
  const inScope = isFileInScope(filePath, filesToChange);

  if (inScope) {
    return {
      ...taskResult,
      scopeChecked: true,
      inScope: true,
      reason: 'in_scope'
    };
  }

  // File is NOT in scope - warn or block based on config
  const mode = getScopeGatingMode();

  if (mode === 'warn') {
    return {
      ...taskResult,
      scopeChecked: true,
      inScope: false,
      warning: generateScopeWarning(filePath, activeTask, filesToChange),
      reason: 'out_of_scope_warning'
    };
  }

  // Block mode
  return {
    allowed: false,
    blocked: true,
    scopeChecked: true,
    inScope: false,
    message: generateScopeBlockMessage(filePath, activeTask, filesToChange),
    reason: 'out_of_scope_blocked'
  };
}

module.exports = {
  checkScopeGate,
  isFileInScope,
  isFileExempt,
  isFileBoundaryViolation,
  matchesPattern,
  isScopeGatingEnabled,
  getScopeGatingMode,
  isPathWithinProject,
  generateScopeWarning,
  generateScopeBlockMessage,
  generateBoundaryBlockMessage
};
