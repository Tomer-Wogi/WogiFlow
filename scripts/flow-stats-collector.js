#!/usr/bin/env node

/**
 * Wogi Flow - Stats Collector
 *
 * Central API for recording per-model, per-task-type performance metrics.
 * Writes to .workflow/models/stats.json.
 *
 * Key metrics:
 * - Task completion records (model, taskType, iterations, firstAttemptPass)
 * - Token usage estimates
 * - Wall clock timing
 * - Quality gate results
 * - User revision tracking (populated by flow-revision-tracker.js)
 *
 * Part of S2: Model Performance Tracking
 */

const fs = require('fs');
const path = require('path');
const {
  getConfig,
  PATHS,
  readJson,
  writeJson,
  withLock,
  fileExists
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

const STATS_PATH = path.join(PATHS.root, '.workflow', 'models', 'stats.json');
const STATS_ARCHIVE_DIR = path.join(PATHS.root, '.workflow', 'models', 'stats-archive');
const MAX_RECENT_TASKS = 500;

// ============================================================
// Default Structure
// ============================================================

function getDefaultStats() {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    trackingSince: new Date().toISOString(),
    summary: {
      totalTasks: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      avgTokensPerTask: 0,
      avgCostPerTask: 0
    },
    byModel: {},
    byTaskType: {},
    byCapability: {},
    failureStats: {
      totalFailures: 0,
      byCategory: {},
      recoveryRate: 0
    },
    routingStats: {
      escalations: 0,
      fallbacks: 0,
      primarySuccessRate: 0
    },
    recentTasks: []
  };
}

// ============================================================
// Core Recording Functions
// ============================================================

/**
 * Record a completed task's performance metrics.
 *
 * @param {Object} record - Task performance record
 * @param {string} record.taskId - Task ID (wf-XXXXXXXX)
 * @param {string} record.model - Model used (e.g., 'claude-opus-4-6')
 * @param {string} record.taskType - Task type (feature, bugfix, refactor, etc.)
 * @param {number} record.iterations - Number of implementation iterations
 * @param {boolean} record.firstAttemptPass - Whether first attempt passed verification
 * @param {number} [record.tokenEstimate] - Estimated tokens used
 * @param {number} [record.wallClockMs] - Wall clock time in milliseconds
 * @param {Object[]} [record.qualityGateResults] - Array of { name, passed } objects
 * @param {string[]} [record.changedFiles] - Files that were changed
 * @param {number} [record.scenarioCount] - Number of scenarios
 * @returns {Promise<boolean>} True if recorded successfully
 */
async function recordTaskCompletion(record) {
  const { taskId, model, taskType, iterations, firstAttemptPass } = record;

  if (!taskId || !model || !taskType) {
    if (process.env.DEBUG) {
      console.error('[stats-collector] Missing required fields: taskId, model, taskType');
    }
    return false;
  }

  try {
    return await withLock(STATS_PATH, () => {
      const stats = loadStats();

      const entry = {
        taskId,
        model,
        taskType,
        iterations: iterations || 1,
        firstAttemptPass: firstAttemptPass !== false,
        tokenEstimate: record.tokenEstimate || 0,
        wallClockMs: record.wallClockMs || 0,
        qualityGateResults: record.qualityGateResults || [],
        changedFiles: record.changedFiles || [],
        scenarioCount: record.scenarioCount || 0,
        revisionCount: 0,
        timestamp: new Date().toISOString()
      };

      // Add to recent tasks
      stats.recentTasks.unshift(entry);

      // Update summary
      stats.summary.totalTasks++;
      stats.summary.totalTokensUsed += entry.tokenEstimate;
      stats.summary.avgTokensPerTask = Math.round(
        stats.summary.totalTokensUsed / stats.summary.totalTasks
      );

      // Update byModel
      if (!stats.byModel[model]) {
        stats.byModel[model] = {
          taskCount: 0,
          totalIterations: 0,
          firstAttemptPasses: 0,
          totalTokens: 0,
          totalWallClockMs: 0,
          totalRevisions: 0,
          byTaskType: {}
        };
      }
      const modelStats = stats.byModel[model];
      modelStats.taskCount++;
      modelStats.totalIterations += entry.iterations;
      modelStats.firstAttemptPasses += entry.firstAttemptPass ? 1 : 0;
      modelStats.totalTokens += entry.tokenEstimate;
      modelStats.totalWallClockMs += entry.wallClockMs;

      // Update byModel.byTaskType
      if (!modelStats.byTaskType[taskType]) {
        modelStats.byTaskType[taskType] = {
          taskCount: 0,
          totalIterations: 0,
          firstAttemptPasses: 0,
          totalTokens: 0,
          totalRevisions: 0
        };
      }
      const modelTaskType = modelStats.byTaskType[taskType];
      modelTaskType.taskCount++;
      modelTaskType.totalIterations += entry.iterations;
      modelTaskType.firstAttemptPasses += entry.firstAttemptPass ? 1 : 0;
      modelTaskType.totalTokens += entry.tokenEstimate;

      // Update byTaskType
      if (!stats.byTaskType[taskType]) {
        stats.byTaskType[taskType] = {
          taskCount: 0,
          totalIterations: 0,
          firstAttemptPasses: 0,
          avgIterations: 0,
          firstAttemptRate: 0
        };
      }
      const typeStats = stats.byTaskType[taskType];
      typeStats.taskCount++;
      typeStats.totalIterations += entry.iterations;
      typeStats.firstAttemptPasses += entry.firstAttemptPass ? 1 : 0;
      typeStats.avgIterations = +(typeStats.totalIterations / typeStats.taskCount).toFixed(2);
      typeStats.firstAttemptRate = +(typeStats.firstAttemptPasses / typeStats.taskCount).toFixed(3);

      // Check rotation
      if (stats.recentTasks.length > MAX_RECENT_TASKS) {
        rotateStats(stats);
      }

      stats.lastUpdated = new Date().toISOString();
      writeJson(STATS_PATH, stats);

      if (process.env.DEBUG) {
        console.log(`[stats-collector] Recorded: ${taskId} (${model}, ${taskType})`);
      }

      return true;
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[stats-collector] Record failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Record a user revision to a previously completed task.
 *
 * @param {string} taskId - Task ID that was revised
 * @returns {Promise<boolean>} True if recorded
 */
async function recordRevision(taskId) {
  if (!taskId) return false;

  try {
    return await withLock(STATS_PATH, () => {
      const stats = loadStats();

      // Find the task in recentTasks
      const entry = stats.recentTasks.find((t) => t.taskId === taskId);
      if (!entry) return false;

      entry.revisionCount = (entry.revisionCount || 0) + 1;

      // Update byModel revision count
      if (stats.byModel[entry.model]) {
        stats.byModel[entry.model].totalRevisions++;
        const modelTaskType = stats.byModel[entry.model].byTaskType[entry.taskType];
        if (modelTaskType) {
          modelTaskType.totalRevisions = (modelTaskType.totalRevisions || 0) + 1;
        }
      }

      stats.lastUpdated = new Date().toISOString();
      writeJson(STATS_PATH, stats);

      return true;
    });
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[stats-collector] Revision record failed: ${err.message}`);
    }
    return false;
  }
}

// ============================================================
// Aggregation Queries
// ============================================================

/**
 * Get per-model performance summary.
 *
 * @returns {Object} Model-keyed performance data
 */
function getModelPerformance() {
  const stats = loadStats();
  const result = {};

  for (const [model, data] of Object.entries(stats.byModel)) {
    result[model] = {
      taskCount: data.taskCount,
      avgIterations: data.taskCount > 0
        ? +(data.totalIterations / data.taskCount).toFixed(2)
        : 0,
      firstAttemptRate: data.taskCount > 0
        ? +(data.firstAttemptPasses / data.taskCount).toFixed(3)
        : 0,
      avgTokens: data.taskCount > 0
        ? Math.round(data.totalTokens / data.taskCount)
        : 0,
      avgWallClockMs: data.taskCount > 0
        ? Math.round(data.totalWallClockMs / data.taskCount)
        : 0,
      revisionRate: data.taskCount > 0
        ? +(data.totalRevisions / data.taskCount).toFixed(3)
        : 0,
      byTaskType: data.byTaskType
    };
  }

  return result;
}

/**
 * Get overall stats summary.
 *
 * @returns {Object} Full stats summary
 */
function getStatsSummary() {
  const stats = loadStats();
  return {
    summary: stats.summary,
    modelPerformance: getModelPerformance(),
    byTaskType: stats.byTaskType,
    failureStats: stats.failureStats,
    routingStats: stats.routingStats,
    recentTaskCount: stats.recentTasks.length
  };
}

/**
 * Get recent task records for a specific model.
 *
 * @param {string} model - Model ID
 * @param {number} [limit=20] - Max records to return
 * @returns {Object[]} Recent task records
 */
function getRecentByModel(model, limit = 20) {
  const stats = loadStats();
  return stats.recentTasks
    .filter((t) => t.model === model)
    .slice(0, limit);
}

/**
 * Find tasks that were revised by the user.
 *
 * @param {number} [limit=20] - Max records
 * @returns {Object[]} Revised task records
 */
function getRevisedTasks(limit = 20) {
  const stats = loadStats();
  return stats.recentTasks
    .filter((t) => (t.revisionCount || 0) > 0)
    .slice(0, limit);
}

// ============================================================
// Stats Rotation
// ============================================================

/**
 * Archive old entries when stats exceed MAX_RECENT_TASKS.
 *
 * @param {Object} stats - Stats object (mutated in place)
 */
function rotateStats(stats) {
  const now = new Date();
  const archiveKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const archivePath = path.join(STATS_ARCHIVE_DIR, `${archiveKey}.json`);

  // Ensure archive directory exists
  try {
    if (!fs.existsSync(STATS_ARCHIVE_DIR)) {
      fs.mkdirSync(STATS_ARCHIVE_DIR, { recursive: true });
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[stats-collector] Cannot create archive dir: ${err.message}`);
    }
    // Just trim without archiving
    stats.recentTasks = stats.recentTasks.slice(0, MAX_RECENT_TASKS);
    return;
  }

  // Keep the most recent 90 days (~400 entries), archive the rest
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const toArchive = stats.recentTasks.filter(
    (t) => new Date(t.timestamp) < cutoff
  );
  const toKeep = stats.recentTasks.filter(
    (t) => new Date(t.timestamp) >= cutoff
  );

  if (toArchive.length === 0) {
    // Nothing old enough to archive — just trim to max
    stats.recentTasks = stats.recentTasks.slice(0, MAX_RECENT_TASKS);
    return;
  }

  // Append to archive file
  try {
    const existing = readJson(archivePath, { entries: [] });
    existing.entries.push(...toArchive);
    writeJson(archivePath, existing);
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[stats-collector] Archive write failed: ${err.message}`);
    }
  }

  stats.recentTasks = toKeep;

  if (process.env.DEBUG) {
    console.log(`[stats-collector] Archived ${toArchive.length} entries to ${archivePath}`);
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Load stats from file with defaults.
 *
 * @returns {Object} Stats data
 */
function loadStats() {
  try {
    if (!fileExists(STATS_PATH)) {
      return getDefaultStats();
    }
    const stats = readJson(STATS_PATH, null);
    if (!stats) return getDefaultStats();

    // Ensure all required keys exist
    return {
      ...getDefaultStats(),
      ...stats,
      summary: { ...getDefaultStats().summary, ...stats.summary },
      failureStats: { ...getDefaultStats().failureStats, ...stats.failureStats },
      routingStats: { ...getDefaultStats().routingStats, ...stats.routingStats }
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[stats-collector] Load failed: ${err.message}`);
    }
    return getDefaultStats();
  }
}

/**
 * Format stats summary for display.
 *
 * @returns {string} Formatted stats report
 */
function formatStatsReport() {
  const summary = getStatsSummary();
  const lines = [];

  lines.push('Model Performance Stats');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`Total Tasks: ${summary.summary.totalTasks}`);
  lines.push(`Total Tokens: ${summary.summary.totalTokensUsed.toLocaleString()}`);
  lines.push(`Avg Tokens/Task: ${summary.summary.avgTokensPerTask.toLocaleString()}`);
  lines.push('');

  const perf = summary.modelPerformance;
  if (Object.keys(perf).length > 0) {
    lines.push('Per-Model Breakdown:');
    lines.push('─'.repeat(50));

    for (const [model, data] of Object.entries(perf)) {
      lines.push(`  ${model}:`);
      lines.push(`    Tasks: ${data.taskCount}`);
      lines.push(`    Avg Iterations: ${data.avgIterations}`);
      lines.push(`    First-Attempt Pass: ${(data.firstAttemptRate * 100).toFixed(1)}%`);
      lines.push(`    Avg Tokens: ${data.avgTokens.toLocaleString()}`);
      lines.push(`    Revision Rate: ${(data.revisionRate * 100).toFixed(1)}%`);
      lines.push('');
    }
  } else {
    lines.push('No model performance data yet.');
    lines.push('Complete tasks via /wogi-start to begin collecting metrics.');
  }

  if (Object.keys(summary.byTaskType).length > 0) {
    lines.push('Per-Task-Type:');
    lines.push('─'.repeat(50));
    for (const [type, data] of Object.entries(summary.byTaskType)) {
      lines.push(`  ${type}: ${data.taskCount} tasks, avg ${data.avgIterations} iterations, ${(data.firstAttemptRate * 100).toFixed(1)}% first-attempt`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'record': {
      const taskId = args[0];
      const model = args[1];
      const taskType = args[2];
      if (!taskId || !model || !taskType) {
        console.error('Usage: flow-stats-collector.js record <taskId> <model> <taskType>');
        process.exit(1);
      }
      const ok = await recordTaskCompletion({ taskId, model, taskType, iterations: 1, firstAttemptPass: true });
      console.log(ok ? 'Recorded.' : 'Failed.');
      break;
    }

    case 'summary':
      console.log(formatStatsReport());
      break;

    case 'json':
      console.log(JSON.stringify(getStatsSummary(), null, 2));
      break;

    case 'revised':
      console.log(JSON.stringify(getRevisedTasks(), null, 2));
      break;

    default:
      console.log(`
Stats Collector

Usage: flow-stats-collector.js <command> [args]

Commands:
  record <taskId> <model> <taskType>  Record a task completion
  summary                             Display formatted stats report
  json                                Output stats as JSON
  revised                             Show tasks that were revised by user
`);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  STATS_PATH,
  recordTaskCompletion,
  recordRevision,
  getModelPerformance,
  getStatsSummary,
  getRecentByModel,
  getRevisedTasks,
  loadStats,
  formatStatsReport
};

if (require.main === module) {
  main();
}
