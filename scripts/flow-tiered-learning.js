#!/usr/bin/env node

/**
 * Wogi Flow - Tiered Learning System
 *
 * Classifies learned patterns by confidence tiers and determines
 * appropriate actions (auto-apply, apply with log, queue for review).
 *
 * Part of Phase 3: Intelligent Routing
 *
 * Usage:
 *   flow learning tiers              Show patterns by tier
 *   flow learning stats              Show learning statistics
 *   flow learning apply <pattern>    Manually apply a pattern
 *   flow learning classify <pattern> Check tier for a pattern
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
  safeJsonParse,
  printHeader,
  printSection
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/**
 * Learning tier definitions.
 * Patterns are classified based on success rate and sample count.
 */
const LEARNING_TIERS = {
  AUTO_APPLY: {
    name: 'Auto Apply',
    description: 'High confidence - applied automatically',
    minSuccessRate: 0.9,
    minSamples: 5,
    action: 'apply-silently',
    color: 'green'
  },
  APPLY_WITH_LOG: {
    name: 'Apply with Log',
    description: 'Medium confidence - applied and logged',
    minSuccessRate: 0.7,
    minSamples: 3,
    action: 'apply-and-log',
    color: 'yellow'
  },
  QUEUE_FOR_REVIEW: {
    name: 'Queue for Review',
    description: 'Low confidence - requires human review',
    minSuccessRate: 0,
    minSamples: 0,
    action: 'queue',
    color: 'cyan'
  }
};

/**
 * Configuration constants for pattern tracking.
 */
const MAX_PATTERN_HISTORY = 20;
const MAX_CONTEXT_LENGTH = 100;

/**
 * Default tiered learning configuration.
 * Can be overridden in .workflow/config.json under "tieredLearning" key.
 */
const DEFAULT_TIERED_LEARNING_CONFIG = {
  enabled: true,
  tiers: {
    autoApply: { minSuccessRate: 0.9, minSamples: 5 },
    applyWithLog: { minSuccessRate: 0.7, minSamples: 3 }
  },
  logAppliedPatterns: true,
  maxQueueSize: 50
};

// ============================================================
// Paths
// ============================================================

const PATTERNS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'learning-patterns.json');
const DECISIONS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'decisions.md');
const FEEDBACK_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'feedback-patterns.md');

// ============================================================
// Configuration
// ============================================================

/**
 * Get tiered learning configuration from config.json with defaults.
 * @returns {Object} Tiered learning configuration
 */
function getTieredLearningConfig() {
  const config = getConfig();
  const userConfig = config?.tieredLearning || {};

  return {
    ...DEFAULT_TIERED_LEARNING_CONFIG,
    ...userConfig,
    tiers: {
      ...DEFAULT_TIERED_LEARNING_CONFIG.tiers,
      ...(userConfig.tiers || {})
    }
  };
}

// ============================================================
// Pattern Storage
// ============================================================

/**
 * Load learning patterns from storage.
 * @returns {Object} Pattern data
 */
function loadPatterns() {
  const defaultPatterns = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    patterns: {},
    applied: [],
    queued: []
  };

  if (!fileExists(PATTERNS_PATH)) {
    return defaultPatterns;
  }

  const loaded = safeJsonParse(PATTERNS_PATH);
  return loaded || defaultPatterns;
}

/**
 * Save learning patterns to storage.
 * @param {Object} patterns - Pattern data to save
 */
function savePatterns(patterns) {
  patterns.lastUpdated = new Date().toISOString();

  const dir = path.dirname(PATTERNS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(PATTERNS_PATH, JSON.stringify(patterns, null, 2));
}

// ============================================================
// Tier Classification
// ============================================================

/**
 * Classify a pattern into a learning tier.
 * @param {Object} stats - Pattern statistics
 * @param {number} stats.successCount - Number of successful applications
 * @param {number} stats.failCount - Number of failed applications
 * @param {number} [stats.sampleCount] - Total samples (defaults to success + fail)
 * @returns {Object} Tier classification result
 */
function classifyPattern(stats) {
  const config = getTieredLearningConfig();
  const { tiers } = config;

  const sampleCount = stats.sampleCount || (stats.successCount + stats.failCount);
  const successRate = sampleCount > 0 ? stats.successCount / sampleCount : 0;

  // Check AUTO_APPLY tier
  if (successRate >= tiers.autoApply.minSuccessRate &&
      sampleCount >= tiers.autoApply.minSamples) {
    return {
      tier: 'AUTO_APPLY',
      ...LEARNING_TIERS.AUTO_APPLY,
      successRate,
      sampleCount,
      meetsThreshold: true
    };
  }

  // Check APPLY_WITH_LOG tier
  if (successRate >= tiers.applyWithLog.minSuccessRate &&
      sampleCount >= tiers.applyWithLog.minSamples) {
    return {
      tier: 'APPLY_WITH_LOG',
      ...LEARNING_TIERS.APPLY_WITH_LOG,
      successRate,
      sampleCount,
      meetsThreshold: true
    };
  }

  // Default to QUEUE_FOR_REVIEW
  return {
    tier: 'QUEUE_FOR_REVIEW',
    ...LEARNING_TIERS.QUEUE_FOR_REVIEW,
    successRate,
    sampleCount,
    meetsThreshold: true
  };
}

/**
 * Get the action to take for a pattern based on its tier.
 * @param {string} patternId - Pattern identifier
 * @returns {Object} Action recommendation
 */
function getPatternAction(patternId) {
  const patterns = loadPatterns();
  const pattern = patterns.patterns[patternId];

  if (!pattern) {
    return {
      patternId,
      exists: false,
      action: 'none',
      reason: 'Pattern not found'
    };
  }

  const classification = classifyPattern(pattern.stats);

  return {
    patternId,
    exists: true,
    ...classification,
    recommendation: classification.action
  };
}

// ============================================================
// Pattern Management
// ============================================================

/**
 * Record a pattern application result.
 * @param {Object} params - Application parameters
 * @param {string} params.patternId - Pattern identifier
 * @param {boolean} params.success - Whether application was successful
 * @param {string} [params.context] - Additional context
 * @returns {Object} Updated pattern info
 */
function recordPatternResult(params) {
  const { patternId, success, context = '' } = params;
  const patterns = loadPatterns();

  // Initialize pattern if needed
  if (!patterns.patterns[patternId]) {
    patterns.patterns[patternId] = {
      id: patternId,
      createdAt: new Date().toISOString(),
      stats: {
        successCount: 0,
        failCount: 0
      },
      history: []
    };
  }

  const pattern = patterns.patterns[patternId];

  // Update stats
  if (success) {
    pattern.stats.successCount++;
  } else {
    pattern.stats.failCount++;
  }

  // Add to history
  pattern.history.push({
    timestamp: new Date().toISOString(),
    success,
    context: context.slice(0, MAX_CONTEXT_LENGTH)
  });

  // Keep only most recent history entries
  if (pattern.history.length > MAX_PATTERN_HISTORY) {
    pattern.history = pattern.history.slice(-MAX_PATTERN_HISTORY);
  }

  pattern.lastUpdated = new Date().toISOString();

  // Re-classify after update
  const classification = classifyPattern(pattern.stats);
  pattern.currentTier = classification.tier;

  savePatterns(patterns);

  return {
    patternId,
    stats: pattern.stats,
    classification
  };
}

/**
 * Queue a pattern for review.
 * @param {Object} params - Queue parameters
 * @param {string} params.patternId - Pattern identifier
 * @param {string} params.description - Pattern description
 * @param {string} params.source - Where the pattern was detected
 * @returns {Object} Queue result
 */
function queueForReview(params) {
  const { patternId, description, source } = params;
  const config = getTieredLearningConfig();
  const patterns = loadPatterns();

  // Check if already queued
  const existing = patterns.queued.find(q => q.patternId === patternId);
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.lastSeen = new Date().toISOString();
    savePatterns(patterns);
    return { queued: false, reason: 'already queued', updated: true };
  }

  // Add to queue
  patterns.queued.push({
    patternId,
    description,
    source,
    queuedAt: new Date().toISOString(),
    occurrences: 1
  });

  // Enforce max queue size
  if (patterns.queued.length > config.maxQueueSize) {
    patterns.queued = patterns.queued.slice(-config.maxQueueSize);
  }

  savePatterns(patterns);

  return { queued: true, patternId };
}

/**
 * Apply a pattern (move from queue to applied).
 * @param {string} patternId - Pattern to apply
 * @returns {Object} Application result
 */
function applyPattern(patternId) {
  const patterns = loadPatterns();
  const config = getTieredLearningConfig();

  // Find in queue
  const queueIndex = patterns.queued.findIndex(q => q.patternId === patternId);
  let patternData = null;

  if (queueIndex >= 0) {
    patternData = patterns.queued.splice(queueIndex, 1)[0];
  }

  // Add to applied list
  patterns.applied.push({
    patternId,
    appliedAt: new Date().toISOString(),
    source: patternData?.source || 'manual',
    description: patternData?.description || ''
  });

  // Initialize stats if not exists
  if (!patterns.patterns[patternId]) {
    patterns.patterns[patternId] = {
      id: patternId,
      createdAt: new Date().toISOString(),
      stats: { successCount: 0, failCount: 0 },
      history: [],
      currentTier: 'QUEUE_FOR_REVIEW'
    };
  }

  savePatterns(patterns);

  // Log if configured
  if (config.logAppliedPatterns) {
    info(`Applied pattern: ${patternId}`);
  }

  return {
    applied: true,
    patternId,
    wasQueued: queueIndex >= 0
  };
}

/**
 * Get patterns organized by tier.
 * @returns {Object} Patterns grouped by tier
 */
function getPatternsByTier() {
  const patterns = loadPatterns();
  const byTier = {
    AUTO_APPLY: [],
    APPLY_WITH_LOG: [],
    QUEUE_FOR_REVIEW: []
  };

  for (const [id, pattern] of Object.entries(patterns.patterns)) {
    const classification = classifyPattern(pattern.stats);
    byTier[classification.tier].push({
      id,
      ...pattern,
      classification
    });
  }

  // Add queued patterns to QUEUE_FOR_REVIEW
  for (const queued of patterns.queued) {
    if (!byTier.QUEUE_FOR_REVIEW.find(p => p.id === queued.patternId)) {
      byTier.QUEUE_FOR_REVIEW.push({
        id: queued.patternId,
        ...queued,
        isQueued: true,
        classification: {
          tier: 'QUEUE_FOR_REVIEW',
          ...LEARNING_TIERS.QUEUE_FOR_REVIEW
        }
      });
    }
  }

  return byTier;
}

/**
 * Get learning statistics summary.
 * @returns {Object} Statistics summary
 */
function getLearningStats() {
  const patterns = loadPatterns();
  const byTier = getPatternsByTier();

  const totalPatterns = Object.keys(patterns.patterns).length;
  const totalApplications = Object.values(patterns.patterns)
    .reduce((sum, p) => sum + p.stats.successCount + p.stats.failCount, 0);

  const totalSuccess = Object.values(patterns.patterns)
    .reduce((sum, p) => sum + p.stats.successCount, 0);

  return {
    totalPatterns,
    totalApplications,
    overallSuccessRate: totalApplications > 0 ? totalSuccess / totalApplications : 0,
    byTier: {
      AUTO_APPLY: byTier.AUTO_APPLY.length,
      APPLY_WITH_LOG: byTier.APPLY_WITH_LOG.length,
      QUEUE_FOR_REVIEW: byTier.QUEUE_FOR_REVIEW.length
    },
    queued: patterns.queued.length,
    applied: patterns.applied.length,
    lastUpdated: patterns.lastUpdated
  };
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Print patterns by tier.
 */
function printTiers() {
  const byTier = getPatternsByTier();
  const config = getTieredLearningConfig();

  printHeader('LEARNING TIERS');

  printSection('Configuration');
  console.log(`  ${color('dim', 'Enabled:')} ${config.enabled ? color('green', 'Yes') : color('red', 'No')}`);
  console.log(`  ${color('dim', 'Auto-apply threshold:')} ${(config.tiers.autoApply.minSuccessRate * 100).toFixed(0)}% success, ${config.tiers.autoApply.minSamples}+ samples`);
  console.log(`  ${color('dim', 'Apply-with-log threshold:')} ${(config.tiers.applyWithLog.minSuccessRate * 100).toFixed(0)}% success, ${config.tiers.applyWithLog.minSamples}+ samples`);

  for (const [tierName, tierInfo] of Object.entries(LEARNING_TIERS)) {
    const patterns = byTier[tierName];
    const tierColor = tierInfo.color;

    printSection(`${tierInfo.name} (${patterns.length})`);
    console.log(`  ${color('dim', tierInfo.description)}`);

    if (patterns.length === 0) {
      console.log(`  ${color('dim', 'No patterns in this tier')}`);
    } else {
      for (const pattern of patterns.slice(0, 10)) {
        const rate = pattern.classification?.successRate || 0;
        const samples = pattern.stats?.successCount + pattern.stats?.failCount || 0;
        const rateStr = samples > 0 ? `${(rate * 100).toFixed(0)}%` : 'N/A';

        console.log(`  ${color(tierColor, '-')} ${pattern.id}`);
        console.log(`    ${color('dim', `Success: ${rateStr} | Samples: ${samples}`)}`);
      }

      if (patterns.length > 10) {
        console.log(`  ${color('dim', `... and ${patterns.length - 10} more`)}`);
      }
    }
  }

  console.log('');
}

/**
 * Print learning statistics.
 */
function printStats() {
  const stats = getLearningStats();

  printHeader('LEARNING STATISTICS');

  printSection('Overview');
  console.log(`  ${color('dim', 'Total patterns:')} ${stats.totalPatterns}`);
  console.log(`  ${color('dim', 'Total applications:')} ${stats.totalApplications}`);
  console.log(`  ${color('dim', 'Overall success rate:')} ${(stats.overallSuccessRate * 100).toFixed(1)}%`);

  printSection('By Tier');
  console.log(`  ${color('green', 'Auto Apply:')} ${stats.byTier.AUTO_APPLY}`);
  console.log(`  ${color('yellow', 'Apply with Log:')} ${stats.byTier.APPLY_WITH_LOG}`);
  console.log(`  ${color('cyan', 'Queue for Review:')} ${stats.byTier.QUEUE_FOR_REVIEW}`);

  printSection('Queue');
  console.log(`  ${color('dim', 'Patterns queued:')} ${stats.queued}`);
  console.log(`  ${color('dim', 'Patterns applied:')} ${stats.applied}`);

  console.log(`\n  ${color('dim', `Last updated: ${stats.lastUpdated || 'never'}`)}`);
  console.log('');
}

// ============================================================
// CLI Entry Point
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Tiered Learning System

Classify and manage learned patterns by confidence tier.

Usage:
  flow learning tiers              Show patterns by tier
  flow learning stats              Show learning statistics
  flow learning apply <pattern>    Manually apply a pattern
  flow learning classify <pattern> Check tier for a pattern
  flow learning record <pattern>   Record a pattern result

Options:
  --success           Mark as successful (with record)
  --fail              Mark as failed (with record)
  --json              Output as JSON
  --help, -h          Show this help

Tiers:
  AUTO_APPLY      High confidence (90%+, 5+ samples) - applied automatically
  APPLY_WITH_LOG  Medium confidence (70%+, 3+ samples) - applied and logged
  QUEUE_FOR_REVIEW Low confidence - requires human review

Examples:
  flow learning tiers                        # Show all patterns by tier
  flow learning stats                        # Show statistics
  flow learning apply handle-async-errors    # Apply a pattern
  flow learning record my-pattern --success  # Record successful application
`);
}

async function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);
  const command = positional[0] || 'tiers';

  if (flags.help || flags.h) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'tiers':
      if (flags.json) {
        outputJson(getPatternsByTier());
      } else {
        printTiers();
      }
      break;

    case 'stats':
    case 'statistics':
      if (flags.json) {
        outputJson(getLearningStats());
      } else {
        printStats();
      }
      break;

    case 'classify':
      const patternToClassify = positional[1];
      if (!patternToClassify) {
        error('Please provide a pattern ID');
        process.exit(1);
      }
      const action = getPatternAction(patternToClassify);
      if (flags.json) {
        outputJson(action);
      } else {
        if (!action.exists) {
          warn(`Pattern '${patternToClassify}' not found`);
        } else {
          info(`Pattern: ${patternToClassify}`);
          console.log(`  Tier: ${color(action.color, action.tier)}`);
          console.log(`  Success rate: ${(action.successRate * 100).toFixed(1)}%`);
          console.log(`  Samples: ${action.sampleCount}`);
          console.log(`  Action: ${action.recommendation}`);
        }
      }
      break;

    case 'apply':
      const patternToApply = positional[1];
      if (!patternToApply) {
        error('Please provide a pattern ID');
        process.exit(1);
      }
      const applyResult = applyPattern(patternToApply);
      if (flags.json) {
        outputJson(applyResult);
      } else {
        if (applyResult.applied) {
          info(`Applied pattern: ${patternToApply}`);
        } else {
          warn(`Could not apply pattern: ${patternToApply}`);
        }
      }
      break;

    case 'record':
      const patternToRecord = positional[1];
      if (!patternToRecord) {
        error('Please provide a pattern ID');
        process.exit(1);
      }
      if (!flags.success && !flags.fail) {
        error('Please specify --success or --fail');
        process.exit(1);
      }
      const recordResult = recordPatternResult({
        patternId: patternToRecord,
        success: flags.success === true,
        context: flags.context || ''
      });
      if (flags.json) {
        outputJson(recordResult);
      } else {
        info(`Recorded ${flags.success ? 'success' : 'failure'} for: ${patternToRecord}`);
        console.log(`  New tier: ${color(LEARNING_TIERS[recordResult.classification.tier].color, recordResult.classification.tier)}`);
        console.log(`  Success rate: ${(recordResult.classification.successRate * 100).toFixed(1)}%`);
      }
      break;

    case 'queue':
      const patternToQueue = positional[1];
      if (!patternToQueue) {
        error('Please provide a pattern ID');
        process.exit(1);
      }
      const queueResult = queueForReview({
        patternId: patternToQueue,
        description: flags.description || '',
        source: flags.source || 'manual'
      });
      if (flags.json) {
        outputJson(queueResult);
      } else {
        if (queueResult.queued) {
          info(`Queued for review: ${patternToQueue}`);
        } else {
          info(`Pattern already queued: ${patternToQueue} (updated occurrence count)`);
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
  LEARNING_TIERS,
  DEFAULT_TIERED_LEARNING_CONFIG,

  // Configuration
  getTieredLearningConfig,

  // Classification
  classifyPattern,
  getPatternAction,

  // Pattern management
  loadPatterns,
  savePatterns,
  recordPatternResult,
  queueForReview,
  applyPattern,

  // Queries
  getPatternsByTier,
  getLearningStats
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
