#!/usr/bin/env node

/**
 * Wogi Flow - Community Knowledge Sync
 *
 * Syncs anonymized model performance data with the WogiFlow community.
 * Session start: download latest community-optimized data.
 * Session end: upload local anonymized stats.
 *
 * Part of S6: Community Knowledge Sync
 *
 * Privacy-first:
 * - All uploads are anonymized (no file paths, code, or project details)
 * - Users can preview uploads before first sync
 * - Opt-out available via config.communitySync.enabled = false
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  PATHS,
  readJson,
  writeJson,
  fileExists
} = require('./flow-utils');
const { anonymizeBatch, createUploadPayload } = require('./flow-sync-anonymizer');
const { loadStats } = require('./flow-stats-collector');

// ============================================================
// Constants
// ============================================================

const COMMUNITY_SCORES_PATH = path.join(PATHS.root, '.workflow', 'models', 'community-scores.json');
const COMMUNITY_ROUTING_PATH = path.join(PATHS.root, '.workflow', 'models', 'community-routing.json');
const SYNC_QUEUE_PATH = path.join(PATHS.root, '.workflow', 'state', 'sync-queue.json');

const DEFAULT_SYNC_CONFIG = {
  enabled: false,
  _comment: 'Set to true after wogi login to enable community knowledge sync',
  endpoint: 'https://api.wogi.ai/v1/community',
  syncOnSessionStart: true,
  syncOnSessionEnd: true,
  maxQueuedSessions: 10
};

// ============================================================
// Config
// ============================================================

/**
 * Get community sync configuration.
 *
 * @returns {Object} Sync config with defaults
 */
function getSyncConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_SYNC_CONFIG,
    ...(config.communitySync || {})
  };
}

/**
 * Check if community sync is enabled and user is authenticated.
 *
 * @returns {boolean}
 */
function isSyncEnabled() {
  const config = getSyncConfig();
  if (!config.enabled) return false;

  // Check for auth token (set by `wogi login`)
  const authPath = path.join(PATHS.root, '.workflow', 'state', 'auth.json');
  try {
    if (!fs.existsSync(authPath)) return false;
    const auth = readJson(authPath, {});
    return !!(auth.token || auth.apiKey);
  } catch (err) {
    return false;
  }
}

// ============================================================
// Download (Session Start)
// ============================================================

/**
 * Download latest community-optimized data.
 * Called at session start.
 *
 * @returns {Object} Download result
 */
async function syncDown() {
  const config = getSyncConfig();

  if (!isSyncEnabled()) {
    return { success: false, reason: 'Sync not enabled or not authenticated' };
  }

  if (!config.syncOnSessionStart) {
    return { success: false, reason: 'Session-start sync disabled' };
  }

  try {
    // Note: Actual HTTP call would go here when wogiflow-cloud is deployed.
    // For now, this is the contract — the function signature and data format
    // are defined, ready for the cloud endpoint.

    // Placeholder: check if community files exist from a prior sync
    const hasScores = fs.existsSync(COMMUNITY_SCORES_PATH);
    const hasRouting = fs.existsSync(COMMUNITY_ROUTING_PATH);

    return {
      success: true,
      cached: true,
      scores: hasScores,
      routing: hasRouting,
      message: hasScores || hasRouting
        ? 'Using cached community data'
        : 'No community data available yet. Data will appear after first successful upload.'
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community-sync] Download failed: ${err.message}`);
    }
    return { success: false, reason: err.message };
  }
}

/**
 * Merge downloaded community data with local data.
 * Local data has higher weight for task types the user has executed.
 *
 * @param {Object} communityData - Downloaded community scores
 * @param {Object} localData - Local capability scores
 * @returns {Object} Merged scores
 */
function mergeWithLocal(communityData, localData) {
  if (!communityData || typeof communityData !== 'object') return localData || {};
  if (!localData || typeof localData !== 'object') return communityData;

  const merged = {};

  // Get all models from both sources
  const allModels = new Set([
    ...Object.keys(communityData),
    ...Object.keys(localData)
  ]);

  for (const model of allModels) {
    const community = communityData[model] || {};
    const local = localData[model] || {};

    merged[model] = {};

    const allKeys = new Set([
      ...Object.keys(community),
      ...Object.keys(local)
    ]);

    for (const key of allKeys) {
      const cVal = community[key];
      const lVal = local[key];

      if (typeof lVal === 'number' && typeof cVal === 'number') {
        // Weighted merge: local has higher weight if user has enough task data
        // Count numeric score entries as sample size proxy
        const localSampleSize = Object.values(local).filter((v) => typeof v === 'number').length;
        const localWeight = localSampleSize > 5 ? 0.7 : 0.3;
        const communityWeight = 1 - localWeight;
        merged[model][key] = +(localWeight * lVal + communityWeight * cVal).toFixed(2);
      } else if (typeof lVal === 'number') {
        merged[model][key] = lVal;
      } else if (typeof cVal === 'number') {
        merged[model][key] = cVal;
      }
    }
  }

  return merged;
}

// ============================================================
// Upload (Session End)
// ============================================================

/**
 * Upload anonymized stats to community.
 * Called at session end.
 *
 * @returns {Object} Upload result
 */
async function syncUp() {
  const config = getSyncConfig();

  if (!isSyncEnabled()) {
    return { success: false, reason: 'Sync not enabled or not authenticated' };
  }

  if (!config.syncOnSessionEnd) {
    return { success: false, reason: 'Session-end sync disabled' };
  }

  try {
    // Load current stats
    const stats = loadStats();
    const records = stats.recentTasks || [];

    if (records.length === 0) {
      return { success: true, message: 'No new stats to upload' };
    }

    // Create anonymized payload
    const payload = createUploadPayload({ records });

    // Note: Actual HTTP upload would go here when wogiflow-cloud is deployed.
    // For now, queue the payload for future upload.
    queuePayload(payload);

    return {
      success: true,
      queued: true,
      recordCount: payload.records.length,
      message: `Queued ${payload.records.length} anonymized records for upload`
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community-sync] Upload failed: ${err.message}`);
    }
    return { success: false, reason: err.message };
  }
}

// ============================================================
// Queue Management (Offline Resilience)
// ============================================================

/**
 * Queue a payload for future upload (offline resilience).
 *
 * @param {Object} payload - Anonymized upload payload
 */
function queuePayload(payload) {
  const config = getSyncConfig();

  try {
    const queue = readJson(SYNC_QUEUE_PATH, { payloads: [] });
    if (!Array.isArray(queue.payloads)) {
      queue.payloads = [];
    }

    queue.payloads.push({
      queuedAt: new Date().toISOString(),
      payload
    });

    // Trim to max queued sessions
    const max = config.maxQueuedSessions || 10;
    if (queue.payloads.length > max) {
      queue.payloads = queue.payloads.slice(-max);
    }

    queue.lastUpdated = new Date().toISOString();
    writeJson(SYNC_QUEUE_PATH, queue);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community-sync] Queue write failed: ${err.message}`);
    }
  }
}

/**
 * Get the current sync queue status.
 *
 * @returns {Object} Queue status
 */
function getQueueStatus() {
  try {
    const queue = readJson(SYNC_QUEUE_PATH, { payloads: [] });
    return {
      queuedSessions: (queue.payloads || []).length,
      lastUpdated: queue.lastUpdated || null,
      oldestQueued: (queue.payloads || []).length > 0
        ? queue.payloads[0].queuedAt
        : null
    };
  } catch (err) {
    return { queuedSessions: 0, lastUpdated: null };
  }
}

/**
 * Clear the sync queue (after successful bulk upload).
 */
function clearQueue() {
  try {
    writeJson(SYNC_QUEUE_PATH, { payloads: [], lastUpdated: new Date().toISOString() });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community-sync] Queue clear failed: ${err.message}`);
    }
  }
}

// ============================================================
// Community Data Access
// ============================================================

/**
 * Load community capability scores.
 *
 * @returns {Object} Community scores or empty object
 */
function loadCommunityScores() {
  try {
    if (!fs.existsSync(COMMUNITY_SCORES_PATH)) return {};
    return readJson(COMMUNITY_SCORES_PATH, {});
  } catch (err) {
    return {};
  }
}

/**
 * Load community routing recommendations.
 *
 * @returns {Object} Community routing or empty object
 */
function loadCommunityRouting() {
  try {
    if (!fs.existsSync(COMMUNITY_ROUTING_PATH)) return {};
    return readJson(COMMUNITY_ROUTING_PATH, {});
  } catch (err) {
    return {};
  }
}

/**
 * Save community scores (after download).
 *
 * @param {Object} scores - Community scores
 */
function saveCommunityScores(scores) {
  try {
    const dir = path.dirname(COMMUNITY_SCORES_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeJson(COMMUNITY_SCORES_PATH, {
      ...scores,
      lastSyncedAt: new Date().toISOString()
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community-sync] Save scores failed: ${err.message}`);
    }
  }
}

/**
 * Save community routing (after download).
 *
 * @param {Object} routing - Community routing rules
 */
function saveCommunityRouting(routing) {
  try {
    const dir = path.dirname(COMMUNITY_ROUTING_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeJson(COMMUNITY_ROUTING_PATH, {
      ...routing,
      lastSyncedAt: new Date().toISOString()
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[community-sync] Save routing failed: ${err.message}`);
    }
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [command] = process.argv.slice(2);

  switch (command) {
    case 'status': {
      const config = getSyncConfig();
      const enabled = isSyncEnabled();
      const queue = getQueueStatus();
      console.log('Community Sync Status');
      console.log('─'.repeat(40));
      console.log(`  Enabled: ${config.enabled}`);
      console.log(`  Authenticated: ${enabled}`);
      console.log(`  Queued sessions: ${queue.queuedSessions}`);
      console.log(`  Last updated: ${queue.lastUpdated || 'never'}`);
      break;
    }

    case 'preview': {
      const { previewUpload } = require('./flow-sync-anonymizer');
      try {
        const { loadStats } = require('./flow-stats-collector');
        const stats = loadStats();
        console.log(previewUpload(stats.recentTasks || []));
      } catch (err) {
        console.error(`Cannot load stats: ${err.message}`);
      }
      break;
    }

    case 'sync-down':
      console.log(JSON.stringify(await syncDown(), null, 2));
      break;

    case 'sync-up':
      console.log(JSON.stringify(await syncUp(), null, 2));
      break;

    case 'queue':
      console.log(JSON.stringify(getQueueStatus(), null, 2));
      break;

    default:
      console.log(`
Community Knowledge Sync

Usage: flow-community-sync.js <command>

Commands:
  status      Show sync status
  preview     Preview what would be uploaded
  sync-down   Download community data (session start)
  sync-up     Upload anonymized stats (session end)
  queue       Show upload queue status

Sync is enabled via config.communitySync.enabled after \`wogi login\`.
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getSyncConfig,
  isSyncEnabled,
  syncDown,
  syncUp,
  mergeWithLocal,
  queuePayload,
  getQueueStatus,
  clearQueue,
  loadCommunityScores,
  loadCommunityRouting,
  saveCommunityScores,
  saveCommunityRouting
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
