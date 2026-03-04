'use strict';

/**
 * Wogi Flow - Model Types & Shared Registry Access
 *
 * Shared model registry loading, stats management, and constants
 * used by both flow-models.js and flow-model-router.js.
 *
 * Extracted to break the circular dependency chain:
 *   flow-models.js -> flow-model-router.js -> flow-models.js
 *
 * Now:
 *   flow-models.js -> flow-model-types.js (shared)
 *   flow-model-router.js -> flow-model-types.js (shared)
 *   flow-models.js -> flow-model-router.js (one-directional)
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  fileExists,
  dirExists,
  safeJsonParse,
  warn
} = require('./flow-utils');

// ============================================================
// Paths
// ============================================================

const MODELS_DIR = path.join(PROJECT_ROOT, '.workflow', 'models');
const REGISTRY_PATH = path.join(MODELS_DIR, 'registry.json');
const STATS_PATH = path.join(MODELS_DIR, 'stats.json');

// ============================================================
// Registry Loading
// ============================================================

/**
 * Load the model registry with safety checks and validation
 * @returns {Object|null} Validated registry data or null if invalid
 */
function loadRegistry() {
  if (!fileExists(REGISTRY_PATH)) {
    return null;
  }

  const registry = safeJsonParse(REGISTRY_PATH);

  // Validate registry structure
  if (!registry || typeof registry !== 'object') {
    return null;
  }

  // Ensure required top-level fields exist
  if (!registry.version || !registry.models || typeof registry.models !== 'object') {
    warn('Invalid registry structure: missing version or models');
    return null;
  }

  return registry;
}

// ============================================================
// Stats Management
// ============================================================

/**
 * Load model statistics with safety checks
 * @returns {Object} Stats data (defaults if file not found)
 */
function loadStats() {
  const defaultStats = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    trackingSince: new Date().toISOString(),
    summary: {
      totalTasks: 0,
      totalTokensUsed: 0,
      totalCost: 0
    },
    byModel: {},
    byTaskType: {},
    failureStats: {
      totalFailures: 0,
      byCategory: {}
    },
    routingStats: {
      escalations: 0,
      fallbacks: 0
    },
    recentTasks: []
  };

  if (!fileExists(STATS_PATH)) {
    return defaultStats;
  }

  const parsed = safeJsonParse(STATS_PATH);
  return parsed || defaultStats;
}

/**
 * Save model statistics
 * @param {Object} stats - Stats data to save
 */
function saveStats(stats) {
  stats.lastUpdated = new Date().toISOString();

  if (!dirExists(MODELS_DIR)) {
    try {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
    } catch (err) {
      console.error(`[flow-model-types] Failed to create models dir: ${err.message}`);
      return;
    }
  }

  try {
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error(`[flow-model-types] Failed to save stats: ${err.message}`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Paths
  MODELS_DIR,
  REGISTRY_PATH,
  STATS_PATH,

  // Registry
  loadRegistry,

  // Stats
  loadStats,
  saveStats
};
