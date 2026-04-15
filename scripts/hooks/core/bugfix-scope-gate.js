#!/usr/bin/env node

/**
 * Wogi Flow - Bugfix Scope Gate (Core Module)
 *
 * Two-phase gate preventing systemic issues from being treated as quick fixes.
 * Part of the Mechanical Enforcement Gates v3.0 initiative.
 *
 * Phase 1: Pre-classification — checks feedback-patterns.md for similar bugs
 *   at task creation. If 2+ keywords overlap → auto-classify as L2.
 *
 * Phase 2: Runtime monitoring — PostToolUse tracks unique file edits during
 *   L3 bugfix tasks. After threshold (default 3) unique non-test files:
 *   - WARN mode: injects message but doesn't block
 *   - BLOCK mode: blocks Edit/Write until scope inventory provided
 *
 * The scope inventory also satisfies the Strike Gate's hypothesis requirement.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getConfig, PATHS, safeJsonParse, writeJson, getReadyData } = require('../../flow-utils');

// ============================================================
// Constants
// ============================================================

/** File patterns excluded from the scope counter */
const DEFAULT_EXCLUDE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\.d\.ts$/,
  /__tests__\//,
  /__mocks__\//
];

/** Keywords for pre-classification matching */
const ERROR_KEYWORDS = [
  'null', 'undefined', 'crash', 'timeout', '404', '500',
  'TypeError', 'ReferenceError', 'cannot read', 'is not a function',
  'is not defined', 'NaN', 'ENOENT', 'ECONNREFUSED', 'CORS',
  'white screen', 'blank page', 'infinite loop', 'memory leak',
  'stack overflow', 'deadlock', 'race condition'
];

// ============================================================
// Configuration
// ============================================================

/**
 * Check if bugfix scope gate is enabled
 * @param {Object} [config]
 * @returns {boolean}
 */
function isBugfixScopeEnabled(config) {
  if (!config) config = getConfig();
  return config.enforcement?.bugfixScope?.enabled !== false;
}

/**
 * Get bugfix scope configuration with defaults
 * @param {Object} [config]
 * @returns {Object}
 */
function getBugfixScopeConfig(config) {
  if (!config) config = getConfig();
  const gate = config.enforcement?.bugfixScope ?? {};
  return {
    enabled: gate.enabled !== false,
    mode: gate.mode ?? 'warn',
    fileThreshold: gate.fileThreshold ?? 3,
    excludePatterns: gate.excludePatterns ?? ['*.test.*', '*.spec.*', '*.d.ts', '__tests__/**', '__mocks__/**'],
    keywordMatchThreshold: gate.keywordMatchThreshold ?? 2,
    fanOutThreshold: gate.fanOutThreshold ?? 10
  };
}

// ============================================================
// Fan-Out Escalation (agnostic — counts importers, not file names)
// ============================================================

/**
 * Count how many files import/require a given file.
 * Fully agnostic — works for any language/framework.
 * @param {string} filePath - The file to check importers for
 * @returns {number} Number of files that import this file. -1 on error.
 */
function countImporters(filePath) {
  const { execSync } = require('node:child_process');
  const basename = path.basename(filePath).replace(/\.[^.]+$/, ''); // strip extension
  const relPath = path.relative(PATHS.root, filePath);

  try {
    // Search for imports/requires of this file (by basename or relative path)
    // This is agnostic — catches: import from './file', require('./file'), @import 'file'
    // Use -- without file filters for recursive search across all tracked files
    const safeBasename = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const result = execSync(
      `git grep -rl -E "(from\\s+['\\"](\\./|\\.\\./).*${safeBasename}['\\"\\)]|require\\s*\\(\\s*['\\"](\\./|\\.\\./).*${safeBasename}['\\"\\)])"`,
      { encoding: 'utf-8', cwd: PATHS.root, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!result) return 0;
    // Exclude the file itself
    const importers = result.split('\n').filter(f => f !== relPath);
    return importers.length;
  } catch (_err) {
    return 0; // grep found nothing or errored
  }
}

/**
 * Check if a file edit should trigger fan-out escalation.
 * Called after editing a file during a bugfix task.
 * @param {string} filePath
 * @param {Object} [config]
 * @returns {{ shouldEscalate: boolean, importerCount: number, threshold: number }}
 */
function checkFanOut(filePath, config) {
  const bugfixConfig = getBugfixScopeConfig(config);
  const importerCount = countImporters(filePath);
  return {
    shouldEscalate: importerCount >= bugfixConfig.fanOutThreshold,
    importerCount,
    threshold: bugfixConfig.fanOutThreshold
  };
}

// ============================================================
// Pre-Classification (Phase 1)
// ============================================================

/**
 * Extract error keywords from a bug description.
 * @param {string} description
 * @returns {string[]}
 */
function extractKeywords(description) {
  if (!description) return [];
  const lower = description.toLowerCase();
  return ERROR_KEYWORDS.filter(kw => lower.includes(kw.toLowerCase()));
}

/**
 * Check feedback-patterns.md for similar bugs (last 30 days).
 * @param {string} description - Bug description
 * @param {Object} [config]
 * @returns {{ isRepeat: boolean, matchedKeywords: string[], matchedEntries: string[] }}
 */
function preClassifyBug(description, config) {
  const bugfixConfig = getBugfixScopeConfig(config);
  const keywords = extractKeywords(description);

  if (keywords.length === 0) {
    return { isRepeat: false, matchedKeywords: [], matchedEntries: [] };
  }

  // Read feedback-patterns.md
  const feedbackPath = path.join(PATHS.state, 'feedback-patterns.md');
  let feedbackContent = '';
  try {
    feedbackContent = fs.readFileSync(feedbackPath, 'utf-8');
  } catch (_err) {
    return { isRepeat: false, matchedKeywords: keywords, matchedEntries: [] };
  }

  // Check for keyword overlap in recent entries
  const lines = feedbackContent.split('\n');
  const matchedEntries = [];
  const matchedKeywords = new Set();

  for (const line of lines) {
    const lineLower = line.toLowerCase();
    let lineMatches = 0;
    for (const kw of keywords) {
      if (lineLower.includes(kw.toLowerCase())) {
        lineMatches++;
        matchedKeywords.add(kw);
      }
    }
    if (lineMatches >= 1) {
      matchedEntries.push(line.trim().slice(0, 120));
    }
  }

  const isRepeat = matchedKeywords.size >= bugfixConfig.keywordMatchThreshold;

  return {
    isRepeat,
    matchedKeywords: Array.from(matchedKeywords),
    matchedEntries: matchedEntries.slice(0, 5)
  };
}

// ============================================================
// Runtime Monitoring (Phase 2)
// ============================================================

/**
 * Get the scope tracking state for a task.
 * @param {string} taskId
 * @returns {Object}
 */
function getScopeState(taskId) {
  const statePath = path.join(PATHS.state, `bugfix-scope-${taskId}.json`);
  return safeJsonParse(statePath, {
    taskId,
    uniqueFiles: [],
    thresholdReached: false,
    scopeInventory: null,
    warnedAt: null
  });
}

/**
 * Save scope tracking state for a task.
 * @param {string} taskId
 * @param {Object} state
 */
function saveScopeState(taskId, state) {
  const statePath = path.join(PATHS.state, `bugfix-scope-${taskId}.json`);
  writeJson(statePath, state);
}

/**
 * Check if a file should be excluded from the scope counter.
 * @param {string} filePath
 * @returns {boolean}
 */
function isExcludedFile(filePath) {
  if (!filePath) return true;
  const basename = path.basename(filePath);
  const fullPath = filePath.replace(/\\/g, '/');

  for (const pattern of DEFAULT_EXCLUDE_PATTERNS) {
    if (pattern.test(basename) || pattern.test(fullPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Record a file edit during an L3 bugfix task (PostToolUse).
 * @param {string} taskId
 * @param {string} filePath - The file that was edited
 * @returns {{ thresholdReached: boolean, uniqueFiles: number, threshold: number }}
 */
function recordFileEdit(taskId, filePath) {
  if (isExcludedFile(filePath)) {
    return { thresholdReached: false, uniqueFiles: 0, threshold: 0 };
  }

  const state = getScopeState(taskId);
  const normalizedPath = path.relative(PATHS.root, filePath);

  if (!state.uniqueFiles.includes(normalizedPath)) {
    state.uniqueFiles.push(normalizedPath);
  }

  const config = getConfig();
  const bugfixConfig = getBugfixScopeConfig(config);
  const thresholdReached = state.uniqueFiles.length >= bugfixConfig.fileThreshold;

  if (thresholdReached && !state.thresholdReached) {
    state.thresholdReached = true;
    state.thresholdReachedAt = new Date().toISOString();
  }

  saveScopeState(taskId, state);

  return {
    thresholdReached,
    uniqueFiles: state.uniqueFiles.length,
    threshold: bugfixConfig.fileThreshold
  };
}

/**
 * Save a scope inventory for a task (lifts the block).
 * @param {string} taskId
 * @param {Object} inventory
 * @param {string[]} inventory.locations - All affected locations
 * @param {string} inventory.rootCause - One-sentence root cause
 * @param {string} inventory.approach - Fix approach
 */
function saveScopeInventory(taskId, inventory) {
  const state = getScopeState(taskId);
  state.scopeInventory = {
    ...inventory,
    savedAt: new Date().toISOString()
  };
  saveScopeState(taskId, state);
}

/**
 * Clear scope state for a task (on completion).
 * @param {string} taskId
 */
function clearScopeState(taskId) {
  const statePath = path.join(PATHS.state, `bugfix-scope-${taskId}.json`);
  try {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  } catch (_err) {
    // Non-critical
  }
}

// ============================================================
// Gate Checks (called by hooks)
// ============================================================

/**
 * Check bugfix scope gate for Edit/Write operations (PreToolUse).
 * Only activates for L3 bugfix tasks that have reached the file threshold.
 * @param {string} toolName - Edit or Write
 * @param {Object} [config]
 * @returns {{ allowed: boolean, blocked: boolean, reason?: string, message?: string }}
 */
function checkBugfixScope(toolName, config) {
  if (!isBugfixScopeEnabled(config)) {
    return { allowed: true, blocked: false };
  }

  // Only check Edit/Write
  if (toolName !== 'Edit' && toolName !== 'Write') {
    return { allowed: true, blocked: false };
  }

  // Get active task from ready.json — use getReadyData for 200ms TTL cache
  // instead of direct safeJsonParse (perf-006 fix, wf-7c36aaed). On L3 bugfix
  // tasks during Edit/Write this avoids a 2nd disk read per hook invocation.
  const ready = getReadyData();
  if (!ready.inProgress || ready.inProgress.length === 0) {
    return { allowed: true, blocked: false };
  }

  const activeTask = ready.inProgress[0];
  if (!activeTask || !activeTask.id) {
    return { allowed: true, blocked: false };
  }

  // Only activate for L3 bugfix/fix tasks
  const level = activeTask.level || 'L2';
  const type = activeTask.type || 'feature';
  if (level !== 'L3' || (type !== 'bugfix' && type !== 'fix' && type !== 'bug')) {
    return { allowed: true, blocked: false };
  }

  const taskId = activeTask.id;
  const state = getScopeState(taskId);

  if (!state.thresholdReached) {
    return { allowed: true, blocked: false };
  }

  // Threshold reached — check if scope inventory exists
  if (state.scopeInventory) {
    return { allowed: true, blocked: false };
  }

  const bugfixConfig = getBugfixScopeConfig(config);

  if (bugfixConfig.mode === 'block') {
    return {
      allowed: false,
      blocked: true,
      reason: 'bugfix-scope-threshold',
      message: `BUGFIX SCOPE GATE: ${state.uniqueFiles.length} unique files edited (threshold: ${bugfixConfig.fileThreshold}).\n\n` +
        `This looks like a systemic issue, not a quick fix. Before continuing, provide a scope inventory:\n\n` +
        `Write to .workflow/state/bugfix-scope-${taskId}.json with a "scopeInventory" field containing:\n` +
        `  1. "locations" — ALL file locations that need the same fix\n` +
        `  2. "rootCause" — one sentence: what's actually causing this\n` +
        `  3. "approach" — how you'll fix all locations (not one-by-one)\n\n` +
        `Files edited so far: ${state.uniqueFiles.join(', ')}`
    };
  }

  // Warn mode — allow but inject message
  if (!state.warnedAt) {
    state.warnedAt = new Date().toISOString();
    saveScopeState(taskId, state);
  }

  return {
    allowed: true,
    blocked: false,
    warning: true,
    message: `BUGFIX SCOPE WARNING: ${state.uniqueFiles.length} unique files edited (threshold: ${bugfixConfig.fileThreshold}).\n\n` +
      `This may be a systemic issue. Consider creating a scope inventory before continuing:\n` +
      `  - List ALL affected locations\n` +
      `  - Identify the root cause\n` +
      `  - Plan a batch fix instead of one-by-one patches\n\n` +
      `Files: ${state.uniqueFiles.join(', ')}`
  };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Configuration
  isBugfixScopeEnabled,
  getBugfixScopeConfig,

  // Pre-classification (Phase 1)
  extractKeywords,
  preClassifyBug,

  // Runtime monitoring (Phase 2)
  getScopeState,
  recordFileEdit,
  saveScopeInventory,
  clearScopeState,
  isExcludedFile,

  // Gate check (used by hooks)
  checkBugfixScope,

  // Fan-out escalation (agnostic)
  countImporters,
  checkFanOut
};
