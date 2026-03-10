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
const {
  PATHS,
  fileExists,
  dirExists,
  safeJsonParse,
  writeJson,
  warn
} = require('./flow-utils');

// ============================================================
// Paths (from canonical PATHS registry in flow-paths.js)
// ============================================================

const path = require('path');

const MODELS_DIR = PATHS.modelsDir;
const REGISTRY_PATH = PATHS.modelRegistry;
const STATS_PATH = PATHS.modelStats;
const CAPABILITIES_DIR = path.join(MODELS_DIR, 'capabilities');

// ============================================================
// Registry Loading
// ============================================================

// Filename validation: only lowercase alphanumeric and hyphens
const VALID_CAP_FILENAME = /^[a-z0-9-]+\.json$/;

// Cache for capability data (cleared on demand via clearCapabilitiesCache)
let _capabilitiesCache = null;

/**
 * Clear the capabilities cache (for testing or invalidation)
 */
function clearCapabilitiesCache() {
  _capabilitiesCache = null;
}

/**
 * Load a single capability file for a model.
 * Exported as public API for plugin/extension use.
 * @param {string} modelKey - Model key (e.g., "claude-opus-4-6")
 * @returns {Object|null} Capability data or null if not found
 */
function loadCapability(modelKey) {
  if (!VALID_CAP_FILENAME.test(`${modelKey}.json`)) {
    return null;
  }
  const capPath = path.join(CAPABILITIES_DIR, `${modelKey}.json`);
  if (!fileExists(capPath)) {
    return null;
  }
  return safeJsonParse(capPath, null);
}

/**
 * Load all capability files from the capabilities/ directory.
 * Results are cached at module level — call clearCapabilitiesCache() to invalidate.
 * @returns {Object} Map of modelKey → capability data
 */
function loadAllCapabilities() {
  if (_capabilitiesCache) return _capabilitiesCache;

  const capabilities = {};
  if (!dirExists(CAPABILITIES_DIR)) {
    _capabilitiesCache = capabilities;
    return capabilities;
  }

  try {
    const entries = fs.readdirSync(CAPABILITIES_DIR);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      // Validate filename to prevent path traversal
      if (!VALID_CAP_FILENAME.test(entry)) continue;
      // Skip symlinks — only read regular files
      try {
        const stat = fs.lstatSync(path.join(CAPABILITIES_DIR, entry));
        if (!stat.isFile()) continue;
      } catch (err) {
        continue;
      }
      const modelKey = entry.replace(/\.json$/, '');
      const capData = safeJsonParse(path.join(CAPABILITIES_DIR, entry), null);
      if (capData) {
        capabilities[modelKey] = capData;
      }
    }
  } catch (err) {
    warn(`Failed to read capabilities directory`);
  }

  _capabilitiesCache = capabilities;
  return capabilities;
}

/**
 * Load the model registry with safety checks, validation, and capability merging.
 *
 * Merges per-model knowledge from capabilities/*.json into each model entry,
 * so consumers get the full picture (infrastructure + knowledge) in one call.
 *
 * @returns {Object|null} Validated registry data with merged capabilities, or null if invalid
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

  // Merge capability files into each model entry
  const allCapabilities = loadAllCapabilities();
  for (const [modelKey, modelEntry] of Object.entries(registry.models)) {
    if (!modelEntry) continue;
    const cap = allCapabilities[modelKey];
    if (!cap) {
      warn(`No capability file found for model: ${modelKey}`);
      continue;
    }
    // Capability fields override registry fields (capabilities are the authoritative source)
    // but registry infrastructure fields (provider, modelId, displayName, etc.) are preserved
    const knowledgeFields = [
      'taskScores', 'languages', 'bestFor', 'contextPreferences',
      'capabilities', 'strengths', 'limitations', 'costQualityRatio',
      'dataSource', 'lastUpdated', 'sampleSize'
    ];
    for (const field of knowledgeFields) {
      if (cap[field] !== undefined) {
        modelEntry[field] = cap[field];
      }
    }
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
    writeJson(STATS_PATH, stats);
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
  CAPABILITIES_DIR,

  // Registry
  loadRegistry,

  // Capabilities
  loadCapability,
  loadAllCapabilities,
  clearCapabilitiesCache,

  // Stats
  loadStats,
  saveStats
};
