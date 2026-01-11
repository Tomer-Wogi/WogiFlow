#!/usr/bin/env node

/**
 * Wogi Flow - Model Router
 *
 * Selects optimal model based on task analysis and routing strategy.
 * Supports quality-first, cost-optimized, and learned routing.
 *
 * Part of Phase 2: Multi-Model Core
 *
 * Usage:
 *   flow model-route "<task>" [--strategy quality-first]
 *   flow model-route --analysis <json> --strategy cost-optimized
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
  fileExists,
  safeJsonParse,
  printHeader,
  printSection
} = require('./flow-utils');

const { analyzeTask } = require('./flow-task-analyzer');

// ============================================================
// Constants
// ============================================================

const MODELS_DIR = path.join(PROJECT_ROOT, '.workflow', 'models');
const REGISTRY_PATH = path.join(MODELS_DIR, 'registry.json');
const STATS_PATH = path.join(MODELS_DIR, 'stats.json');
const CONFIG_PATH = path.join(PROJECT_ROOT, '.workflow', 'config.json');

const ROUTING_STRATEGIES = {
  'quality-first': 'Select highest-capability model matching requirements',
  'cost-optimized': 'Select cheapest model with required capabilities',
  'learned': 'Use historical success rates to optimize selection'
};

const COST_TIER_ORDER = {
  economy: 1,
  standard: 2,
  premium: 3
};

const DEFAULT_CONFIG = {
  routingStrategy: 'quality-first',
  fallbackEnabled: true,
  maxEscalations: 2
};

// ============================================================
// Registry Loading
// ============================================================

/**
 * Load model registry with validation
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

/**
 * Load model stats
 * @returns {Object|null} Stats data
 */
function loadStats() {
  if (!fileExists(STATS_PATH)) {
    return {};
  }
  return safeJsonParse(STATS_PATH) || {};
}

/**
 * Load multi-model config
 * @returns {Object} Config with defaults
 */
function loadMultiModelConfig() {
  const config = safeJsonParse(CONFIG_PATH);
  return {
    ...DEFAULT_CONFIG,
    ...(config?.multiModel || {})
  };
}

// ============================================================
// Model Scoring
// ============================================================

/**
 * Score a model for a given task analysis
 * @param {Object} model - Model data from registry
 * @param {Object} analysis - Task analysis
 * @param {string} strategy - Routing strategy
 * @param {Object} stats - Model stats (optional)
 * @returns {Object} Scoring result
 */
function scoreModel(model, analysis, strategy, stats = {}) {
  const scores = {
    capability: 0,
    language: 0,
    cost: 0,
    history: 0,
    total: 0
  };
  const reasons = [];

  // 1. Capability matching (0-40 points)
  const requiredCaps = new Set(analysis.capabilities);
  const modelCaps = new Set(model.capabilities || []);
  let capMatches = 0;
  let capMisses = [];

  for (const cap of requiredCaps) {
    if (modelCaps.has(cap)) {
      capMatches++;
    } else {
      capMisses.push(cap);
    }
  }

  if (requiredCaps.size > 0) {
    scores.capability = (capMatches / requiredCaps.size) * 40;
    if (capMatches === requiredCaps.size) {
      reasons.push('All required capabilities matched');
    } else if (capMisses.length > 0) {
      reasons.push(`Missing capabilities: ${capMisses.join(', ')}`);
    }
  } else {
    scores.capability = 30; // Default if no specific requirements
  }

  // 2. Language proficiency (0-30 points)
  const primaryLang = analysis.languages.primary;
  const langScore = model.languages?.[primaryLang] || 5;
  scores.language = (langScore / 10) * 30;

  if (langScore >= 9) {
    reasons.push(`Excellent ${primaryLang} support (${langScore}/10)`);
  } else if (langScore >= 7) {
    reasons.push(`Good ${primaryLang} support (${langScore}/10)`);
  } else {
    reasons.push(`Limited ${primaryLang} support (${langScore}/10)`);
  }

  // 3. Cost scoring (0-20 points, depends on strategy)
  const tierScore = {
    economy: 20,
    standard: 10,
    premium: 5
  };

  if (strategy === 'cost-optimized') {
    // Higher score for cheaper models
    scores.cost = tierScore[model.costTier] || 10;
    reasons.push(`Cost tier: ${model.costTier}`);
  } else if (strategy === 'quality-first') {
    // Higher score for premium models
    scores.cost = 20 - (tierScore[model.costTier] || 10);
  } else {
    // Balanced
    scores.cost = 10;
  }

  // 4. Historical performance (0-10 points, for learned routing)
  if (strategy === 'learned' && stats[model.id]) {
    const modelStats = stats[model.id];
    const successRate = modelStats.successRate || 0.5;
    scores.history = successRate * 10;

    // Check task-type specific stats
    const taskType = analysis.taskType;
    if (modelStats.byTaskType?.[taskType]) {
      const typeStats = modelStats.byTaskType[taskType];
      const total = (typeStats.success || 0) + (typeStats.fail || 0);
      if (total >= 5) {
        const typeRate = typeStats.success / total;
        scores.history = typeRate * 10;
        reasons.push(`${(typeRate * 100).toFixed(0)}% success rate on ${taskType} tasks`);
      }
    }
  }

  // Calculate total
  scores.total = scores.capability + scores.language + scores.cost + scores.history;

  return {
    modelId: model.id || model.modelId,
    displayName: model.displayName,
    provider: model.provider,
    costTier: model.costTier,
    scores,
    reasons,
    meetsRequirements: capMisses.length === 0
  };
}

// ============================================================
// Routing Strategies
// ============================================================

/**
 * Route using quality-first strategy
 * @param {Object[]} models - Available models
 * @param {Object} analysis - Task analysis
 * @param {Object} stats - Model stats
 * @returns {Object} Routing decision
 */
function routeQualityFirst(models, analysis, stats) {
  const scored = models
    .map(m => scoreModel(m, analysis, 'quality-first', stats))
    .filter(s => s.meetsRequirements)
    .sort((a, b) => b.scores.total - a.scores.total);

  if (scored.length === 0) {
    // Fall back to highest capability model even if not perfect match
    const allScored = models
      .map(m => scoreModel(m, analysis, 'quality-first', stats))
      .sort((a, b) => b.scores.total - a.scores.total);

    return {
      strategy: 'quality-first',
      primary: allScored[0],
      fallback: allScored[1] || null,
      escalation: null,
      warning: 'No model fully meets requirements, using best available'
    };
  }

  return {
    strategy: 'quality-first',
    primary: scored[0],
    fallback: scored[1] || null,
    escalation: null // Already using best
  };
}

/**
 * Route using cost-optimized strategy
 * @param {Object[]} models - Available models
 * @param {Object} analysis - Task analysis
 * @param {Object} stats - Model stats
 * @returns {Object} Routing decision
 */
function routeCostOptimized(models, analysis, stats) {
  const scored = models
    .map(m => scoreModel(m, analysis, 'cost-optimized', stats))
    .filter(s => s.meetsRequirements);

  // Sort by cost tier first, then by capability within tier
  scored.sort((a, b) => {
    const tierDiff = COST_TIER_ORDER[a.costTier] - COST_TIER_ORDER[b.costTier];
    if (tierDiff !== 0) return tierDiff;
    return b.scores.capability - a.scores.capability;
  });

  if (scored.length === 0) {
    // Fall back to cheapest model
    const allScored = models
      .map(m => scoreModel(m, analysis, 'cost-optimized', stats))
      .sort((a, b) => COST_TIER_ORDER[a.costTier] - COST_TIER_ORDER[b.costTier]);

    return {
      strategy: 'cost-optimized',
      primary: allScored[0],
      fallback: null,
      escalation: allScored.find(m => COST_TIER_ORDER[m.costTier] > COST_TIER_ORDER[allScored[0].costTier]),
      warning: 'No model fully meets requirements, using cheapest available'
    };
  }

  // Find escalation option (higher tier)
  const primaryTier = COST_TIER_ORDER[scored[0].costTier];
  const escalation = scored.find(m => COST_TIER_ORDER[m.costTier] > primaryTier);

  return {
    strategy: 'cost-optimized',
    primary: scored[0],
    fallback: scored.find(m => m.modelId !== scored[0].modelId && COST_TIER_ORDER[m.costTier] === primaryTier),
    escalation
  };
}

/**
 * Route using learned strategy (historical performance)
 * @param {Object[]} models - Available models
 * @param {Object} analysis - Task analysis
 * @param {Object} stats - Model stats
 * @returns {Object} Routing decision
 */
function routeLearned(models, analysis, stats) {
  const scored = models
    .map(m => scoreModel(m, analysis, 'learned', stats))
    .filter(s => s.meetsRequirements)
    .sort((a, b) => b.scores.total - a.scores.total);

  if (scored.length === 0) {
    // Fall back to quality-first if no learned data
    return routeQualityFirst(models, analysis, stats);
  }

  // Check if we have enough data for learned routing
  const hasEnoughData = Object.values(stats).some(s => (s.totalRuns || 0) >= 10);

  if (!hasEnoughData) {
    const result = routeQualityFirst(models, analysis, stats);
    result.warning = 'Insufficient historical data, falling back to quality-first';
    return result;
  }

  return {
    strategy: 'learned',
    primary: scored[0],
    fallback: scored[1] || null,
    escalation: scored.find(m => COST_TIER_ORDER[m.costTier] > COST_TIER_ORDER[scored[0].costTier])
  };
}

// ============================================================
// Main Router
// ============================================================

/**
 * Route task to optimal model
 * @param {Object} params - Routing parameters
 * @returns {Object} Routing decision
 */
function routeTask(params) {
  const { analysis, strategy = 'quality-first' } = params;

  // Load registry and stats
  const registry = loadRegistry();
  if (!registry) {
    return {
      success: false,
      error: 'Model registry not found'
    };
  }

  const stats = loadStats();
  const config = loadMultiModelConfig();

  // Convert registry models to array with IDs
  const models = Object.entries(registry.models || {}).map(([id, data]) => ({
    id,
    ...data
  }));

  if (models.length === 0) {
    return {
      success: false,
      error: 'No models in registry'
    };
  }

  // Select routing strategy
  const effectiveStrategy = strategy || config.routingStrategy;
  let decision;

  switch (effectiveStrategy) {
    case 'quality-first':
      decision = routeQualityFirst(models, analysis, stats);
      break;
    case 'cost-optimized':
      decision = routeCostOptimized(models, analysis, stats);
      break;
    case 'learned':
      decision = routeLearned(models, analysis, stats);
      break;
    default:
      decision = routeQualityFirst(models, analysis, stats);
  }

  // Add metadata
  decision.success = true;
  decision.config = config;
  decision.routedAt = new Date().toISOString();
  decision.analysis = {
    complexity: analysis.complexity.level,
    domains: analysis.domains.primary,
    languages: analysis.languages.primary,
    capabilities: analysis.capabilities
  };

  return decision;
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Print routing decision
 * @param {Object} decision - Routing decision
 */
function printDecision(decision) {
  printHeader('MODEL ROUTING DECISION');

  if (!decision.success) {
    error(decision.error);
    return;
  }

  // Strategy
  printSection('Strategy');
  console.log(`  ${color('cyan', decision.strategy)}`);
  console.log(`  ${ROUTING_STRATEGIES[decision.strategy]}`);

  // Task Analysis Summary
  printSection('Task Analysis');
  console.log(`  Complexity: ${decision.analysis.complexity}`);
  console.log(`  Domain: ${decision.analysis.domains}`);
  console.log(`  Language: ${decision.analysis.languages}`);
  console.log(`  Capabilities: ${decision.analysis.capabilities.join(', ')}`);

  // Primary Model
  printSection('Primary Model');
  const primary = decision.primary;
  console.log(`  ${color('green', primary.displayName)} (${primary.provider})`);
  console.log(`  Cost tier: ${primary.costTier}`);
  console.log(`  Score: ${primary.scores.total.toFixed(1)}/100`);
  for (const reason of primary.reasons.slice(0, 3)) {
    console.log(`    - ${reason}`);
  }

  // Fallback
  if (decision.fallback) {
    printSection('Fallback Model');
    console.log(`  ${color('yellow', decision.fallback.displayName)} (${decision.fallback.provider})`);
    console.log(`  Score: ${decision.fallback.scores.total.toFixed(1)}/100`);
  }

  // Escalation
  if (decision.escalation) {
    printSection('Escalation Model');
    console.log(`  ${color('cyan', decision.escalation.displayName)} (${decision.escalation.provider})`);
    console.log(`  Cost tier: ${decision.escalation.costTier}`);
  }

  // Warning
  if (decision.warning) {
    console.log('');
    warn(decision.warning);
  }

  console.log('');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));

  let analysis;

  // Get analysis from flag or run analyzer
  if (flags.analysis) {
    // flags.analysis is a JSON string from CLI, not a file path
    try {
      analysis = JSON.parse(flags.analysis);
      if (!analysis || typeof analysis !== 'object') {
        error('Invalid --analysis JSON: must be an object');
        process.exit(1);
      }
    } catch (e) {
      error(`Invalid --analysis JSON: ${e.message}`);
      process.exit(1);
    }
  } else if (positional.length > 0) {
    const taskDescription = positional.join(' ');
    analysis = analyzeTask({
      title: taskDescription,
      type: flags.type || 'feature'
    });
  } else {
    error('Usage: flow model-route "<task description>" [--strategy quality-first]');
    error('       flow model-route --analysis <json>');
    process.exit(1);
  }

  // Route task
  const strategy = flags.strategy || 'quality-first';
  const decision = routeTask({ analysis, strategy });

  // Output
  if (flags.json) {
    outputJson(decision);
  } else {
    printDecision(decision);
  }
}

// Export for use by other scripts
module.exports = {
  routeTask,
  scoreModel,
  routeQualityFirst,
  routeCostOptimized,
  routeLearned,
  loadRegistry,
  loadStats,
  loadMultiModelConfig,
  ROUTING_STRATEGIES,
  COST_TIER_ORDER
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
