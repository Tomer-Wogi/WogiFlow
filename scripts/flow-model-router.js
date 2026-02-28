#!/usr/bin/env node

/**
 * Wogi Flow - Model Router
 *
 * Selects optimal model based on task analysis and routing strategy.
 * Supports quality-first, cost-optimized, and learned routing.
 * Includes task-type preferences, language routing, and cascade fallback.
 *
 * Part of Phase 2: Multi-Model Core
 * Enhanced in Phase 3: Intelligent Routing
 *
 * Usage:
 *   flow model-route "<task>" [--strategy quality-first]
 *   flow model-route --analysis <json> --strategy cost-optimized
 *   flow route "<task>" --constraints '{"maxCostTier":"standard"}'
 */

const path = require('path');
const {
  PROJECT_ROOT,
  parseFlags,
  outputJson,
  color,
  info,
  warn,
  error,
  safeJsonParse,
  getConfig,
  printHeader,
  printSection,
  estimateTokens
} = require('./flow-utils');

const { analyzeTask } = require('./flow-task-analyzer');
const { loadRegistry, loadStats } = require('./flow-models');

// Smart Context System integration
let contextGatherer = null;
let instructionRichness = null;
try {
  contextGatherer = require('./flow-context-gatherer');
  instructionRichness = require('./flow-instruction-richness');
} catch (err) {
  // Smart Context modules not available
}

// Phase 3: Import cascade fallback (cached singleton)
let cascadeModule = null;
try {
  cascadeModule = require('./flow-cascade');
} catch (err) {
  // Cascade module not available - log only if not a "cannot find module" error
  if (!err.code || err.code !== 'MODULE_NOT_FOUND') {
    console.error('[flow-model-router] Cascade module error:', err.message);
  }
}

// ============================================================
// Constants
// ============================================================

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

/**
 * Task-type specific routing preferences (Phase 3).
 * Maps task types to preferred model tiers and required capabilities.
 */
const TASK_TYPE_ROUTING = {
  architecture: {
    preferTier: 'premium',
    capabilities: ['reasoning', 'analysis'],
    description: 'Complex architectural decisions benefit from premium models'
  },
  planning: {
    preferTier: 'premium',
    capabilities: ['reasoning', 'analysis'],
    description: 'Planning tasks need strong reasoning capabilities'
  },
  feature: {
    preferTier: 'standard',
    capabilities: ['code-gen', 'reasoning'],
    description: 'Feature development balances quality and cost'
  },
  bugfix: {
    preferTier: 'standard',
    capabilities: ['code-gen', 'analysis'],
    description: 'Bug fixes need good analysis capabilities'
  },
  refactor: {
    preferTier: 'standard',
    capabilities: ['code-gen', 'analysis'],
    description: 'Refactoring needs code understanding'
  },
  boilerplate: {
    preferTier: 'economy',
    capabilities: ['code-gen'],
    description: 'Simple boilerplate can use cheaper models'
  },
  docs: {
    preferTier: 'economy',
    capabilities: ['code-gen'],
    description: 'Documentation tasks are straightforward'
  },
  test: {
    preferTier: 'standard',
    capabilities: ['code-gen'],
    description: 'Test writing needs good code generation'
  },
  metadata: {
    preferTier: 'economy',
    capabilities: ['analysis'],
    description: 'Simple classification tasks (file types, syntax detection, categorization)'
  }
};

/**
 * Language-specific routing preferences (Phase 3).
 * Maps languages to minimum proficiency requirements.
 */
const LANGUAGE_ROUTING = {
  typescript: { minProficiency: 8, description: 'TypeScript needs strong type support' },
  javascript: { minProficiency: 7, description: 'JavaScript is well-supported' },
  python: { minProficiency: 7, description: 'Python is well-supported' },
  rust: { minProficiency: 6, description: 'Rust has specialized syntax' },
  go: { minProficiency: 6, description: 'Go is straightforward' },
  java: { minProficiency: 7, description: 'Java needs good OOP support' },
  csharp: { minProficiency: 7, description: 'C# needs good OOP support' },
  cpp: { minProficiency: 6, description: 'C++ has complex features' },
  ruby: { minProficiency: 6, description: 'Ruby is less common' },
  php: { minProficiency: 6, description: 'PHP is well-documented' }
};

const DEFAULT_CONFIG = {
  routingStrategy: 'quality-first',
  fallbackEnabled: true,
  maxEscalations: 2,
  // Phase 3 additions
  constraints: {
    maxCostTier: 'premium',
    requiredCapabilities: []
  },
  taskTypeOverrides: {},
  cascadeEnabled: true
};

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
 * @param {Object} stats - Model stats (optional). Only used for 'learned' strategy
 *                         to incorporate historical success rates. Passed to all
 *                         strategies for consistent function signature across routing.
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
  // Type guard: ensure model.languages is an object before accessing
  const langScore = (model.languages && typeof model.languages === 'object')
    ? (model.languages[primaryLang] || 5)
    : 5;
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
      if (total >= 5 && total > 0) {
        const typeRate = (typeStats.success || 0) / total;
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
// Phase 3: Enhanced Routing
// ============================================================

/**
 * Apply constraints to filter models.
 * @param {Object[]} models - Available models
 * @param {Object} constraints - Constraint configuration
 * @returns {Object[]} Filtered models
 */
function applyConstraints(models, constraints = {}) {
  let filtered = [...models];

  // Filter by max cost tier
  if (constraints.maxCostTier) {
    const maxTier = COST_TIER_ORDER[constraints.maxCostTier] || 3;
    filtered = filtered.filter(m => (COST_TIER_ORDER[m.costTier] || 2) <= maxTier);
  }

  // Filter by required capabilities
  if (constraints.requiredCapabilities && constraints.requiredCapabilities.length > 0) {
    const required = new Set(constraints.requiredCapabilities);
    filtered = filtered.filter(m => {
      const caps = new Set(m.capabilities || []);
      return [...required].every(c => caps.has(c));
    });
  }

  return filtered;
}

/**
 * Apply task-type preferences to scoring.
 * @param {Object} scored - Scored model result
 * @param {string} taskType - Task type
 * @param {Object} overrides - User overrides from config
 * @returns {Object} Adjusted scored model
 */
function applyTaskTypePreferences(scored, taskType, overrides = {}) {
  const prefs = overrides[taskType] || TASK_TYPE_ROUTING[taskType];
  if (!prefs) return scored;

  const adjustedScores = { ...scored.scores };
  const reasons = [...scored.reasons];

  // Bonus for matching preferred tier
  if (prefs.preferTier === scored.costTier) {
    adjustedScores.taskTypeBonus = 5;
    reasons.push(`Matches preferred tier for ${taskType} tasks`);
  } else {
    adjustedScores.taskTypeBonus = 0;
  }

  adjustedScores.total = adjustedScores.capability + adjustedScores.language +
    adjustedScores.cost + adjustedScores.history + adjustedScores.taskTypeBonus;

  return {
    ...scored,
    scores: adjustedScores,
    reasons,
    taskTypeMatch: prefs.preferTier === scored.costTier
  };
}

/**
 * Apply language proficiency requirements.
 * @param {Object} model - Model data
 * @param {string} language - Primary language
 * @returns {Object} Language check result
 */
function checkLanguageProficiency(model, language) {
  const langReq = LANGUAGE_ROUTING[language];
  if (!langReq) return { meets: true, reason: 'No specific requirements' };

  const proficiency = (model.languages && typeof model.languages === 'object')
    ? (model.languages[language] || 5)
    : 5;

  const meets = proficiency >= langReq.minProficiency;

  return {
    meets,
    proficiency,
    required: langReq.minProficiency,
    reason: meets
      ? `${language} proficiency ${proficiency}/10 meets requirement`
      : `${language} proficiency ${proficiency}/10 below required ${langReq.minProficiency}`
  };
}

/**
 * Check cascade fallback status for a model.
 * @param {string} modelId - Model identifier
 * @param {string} taskType - Task type
 * @param {Object} routing - Current routing decision
 * @returns {Object|null} Cascade recommendation if applicable
 */
function checkCascadeFallback(modelId, taskType, routing) {
  if (!cascadeModule) return null;

  const escalation = cascadeModule.getEscalationTarget(modelId, routing);
  return escalation;
}

/**
 * Enhanced routing with constraints, task-type preferences, and cascade.
 * @param {Object} params - Routing parameters
 * @returns {Object} Enhanced routing decision
 */
function routeTaskEnhanced(params) {
  const {
    analysis,
    strategy = 'quality-first',
    constraints = {},
    checkCascade = true
  } = params;

  // Load registry and stats
  const registry = loadRegistry();
  if (!registry) {
    return { success: false, error: 'Model registry not found' };
  }

  const stats = loadStats();
  const config = loadMultiModelConfig();

  // Merge constraints
  const effectiveConstraints = {
    ...config.constraints,
    ...constraints
  };

  // Convert registry models to array with IDs
  let models = Object.entries(registry.models || {}).map(([id, data]) => ({
    id,
    ...data
  }));

  if (models.length === 0) {
    return { success: false, error: 'No models in registry' };
  }

  // Phase 3: Apply constraints
  const constrainedModels = applyConstraints(models, effectiveConstraints);
  const constraintsApplied = constrainedModels.length < models.length;

  if (constrainedModels.length === 0) {
    return {
      success: false,
      error: 'No models meet constraints',
      constraints: effectiveConstraints,
      originalCount: models.length
    };
  }

  models = constrainedModels;

  // Check language proficiency for all models
  const primaryLang = analysis.languages?.primary;
  if (primaryLang) {
    models = models.map(m => ({
      ...m,
      languageCheck: checkLanguageProficiency(m, primaryLang)
    }));
  }

  // Run base routing
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

  // Phase 3: Apply task-type preferences
  const taskType = analysis.taskType || analysis.type || 'feature';
  if (decision.primary) {
    decision.primary = applyTaskTypePreferences(
      decision.primary,
      taskType,
      config.taskTypeOverrides
    );
  }

  // Phase 3: Check cascade fallback
  let cascadeInfo = null;
  if (checkCascade && config.cascadeEnabled && cascadeModule && decision.primary) {
    cascadeInfo = checkCascadeFallback(
      decision.primary.modelId,
      taskType,
      decision
    );

    if (cascadeInfo?.shouldEscalate) {
      decision.cascadeTriggered = true;
      decision.cascadeInfo = cascadeInfo;

      // If we have a target model, use it as primary
      if (cascadeInfo.targetModel) {
        const targetModelData = models.find(m => m.id === cascadeInfo.targetModel);
        if (targetModelData) {
          decision.originalPrimary = decision.primary;
          decision.primary = scoreModel(targetModelData, analysis, effectiveStrategy, stats);
          decision.primary.cascadeEscalated = true;
        }
      }
    }
  }

  // Add enhanced metadata
  decision.success = true;
  decision.config = config;
  decision.routedAt = new Date().toISOString();
  decision.analysis = {
    complexity: analysis.complexity?.level || 'medium',
    domains: analysis.domains?.primary || 'general',
    languages: analysis.languages?.primary || 'javascript',
    taskType,
    capabilities: analysis.capabilities || []
  };
  decision.enhanced = true;
  decision.constraintsApplied = constraintsApplied;
  decision.constraints = effectiveConstraints;

  // Add task-type routing info
  const taskTypeInfo = TASK_TYPE_ROUTING[taskType];
  if (taskTypeInfo) {
    decision.taskTypeRouting = {
      taskType,
      preferredTier: taskTypeInfo.preferTier,
      requiredCapabilities: taskTypeInfo.capabilities,
      description: taskTypeInfo.description
    };
  }

  return decision;
}

/**
 * Get routing configuration (for CLI display).
 * @returns {Object} Routing configuration
 */
function getRoutingConfig() {
  const config = loadMultiModelConfig();
  return {
    strategy: config.routingStrategy,
    constraints: config.constraints,
    taskTypeOverrides: config.taskTypeOverrides,
    cascadeEnabled: config.cascadeEnabled,
    taskTypeRouting: TASK_TYPE_ROUTING,
    languageRouting: LANGUAGE_ROUTING
  };
}

// ============================================================
// Phase 4: Single Model Evaluation (Smart Context Integration)
// ============================================================

/**
 * Evaluate if a single model can handle a task.
 * Used when user has only one additional model configured.
 *
 * @param {Object} params - Evaluation parameters
 * @param {string} params.modelId - Model identifier
 * @param {Object} params.analysis - Task analysis
 * @param {string} params.taskDescription - Task description for context estimation
 * @returns {Promise<Object>} Evaluation result
 */
async function evaluateSingleModel(params) {
  const { modelId, analysis, taskDescription = '' } = params;

  // Load registry
  const registry = loadRegistry();
  if (!registry) {
    return { canHandle: false, reason: 'Model registry not found' };
  }

  // Find model
  const model = registry.models?.[modelId];
  if (!model) {
    return { canHandle: false, reason: `Model not found: ${modelId}` };
  }

  // 1. Check capabilities
  const requiredCaps = new Set(analysis.capabilities || []);
  const modelCaps = new Set(model.capabilities || []);
  const missingCaps = [];

  for (const cap of requiredCaps) {
    if (!modelCaps.has(cap)) {
      missingCaps.push(cap);
    }
  }

  if (missingCaps.length > 0) {
    return {
      canHandle: false,
      reason: 'Missing capabilities',
      missing: missingCaps,
      modelCapabilities: model.capabilities,
      requiredCapabilities: [...requiredCaps]
    };
  }

  // 2. Check language proficiency
  const primaryLang = analysis.languages?.primary;
  if (primaryLang) {
    const langCheck = checkLanguageProficiency(model, primaryLang);
    if (!langCheck.meets) {
      return {
        canHandle: false,
        reason: langCheck.reason,
        proficiency: langCheck.proficiency,
        required: langCheck.required
      };
    }
  }

  // 3. Estimate context requirements
  let contextRequirements = null;
  let estimatedTaskTokens = 0;

  if (contextGatherer && taskDescription) {
    // Use Smart Context to estimate what context this task needs
    const contextResult = await contextGatherer.gatherContext({
      task: taskDescription,
      model: modelId,
      format: 'summary'  // Use summary for estimation
    });

    contextRequirements = {
      sectionsNeeded: contextResult.stats?.sectionsIncluded || 0,
      tokensEstimated: contextResult.stats?.totalTokens || 0,
      budgetUsed: contextResult.stats?.budgetUsed || '0%',
      modelDensity: contextResult.stats?.modelPrefs?.density || 'standard'
    };

    // Estimate total task tokens (context + task + buffer for output)
    const taskTextTokens = estimateTokens?.(taskDescription) || Math.ceil(taskDescription.length / 4);
    const outputBuffer = model.maxOutputTokens ? model.maxOutputTokens * 0.5 : 4000;

    estimatedTaskTokens = contextRequirements.tokensEstimated + taskTextTokens + outputBuffer;
  } else {
    // Fallback estimation without Smart Context
    const taskTextTokens = estimateTokens?.(taskDescription) || Math.ceil(taskDescription.length / 4);
    const baseContextEstimate = 5000;  // Conservative base estimate
    const outputBuffer = model.maxOutputTokens ? model.maxOutputTokens * 0.5 : 4000;

    estimatedTaskTokens = taskTextTokens + baseContextEstimate + outputBuffer;

    contextRequirements = {
      sectionsNeeded: 'unknown',
      tokensEstimated: baseContextEstimate,
      budgetUsed: 'estimated',
      modelDensity: 'standard'
    };
  }

  // 4. Check if task fits in context window
  const contextWindow = model.contextWindow || 128000;
  const usableContext = contextWindow * 0.7;  // Reserve 30% buffer

  if (estimatedTaskTokens > usableContext) {
    return {
      canHandle: false,
      reason: 'Context too large for model',
      estimatedTokens: estimatedTaskTokens,
      contextWindow,
      usableContext: Math.floor(usableContext),
      overflow: estimatedTaskTokens - usableContext
    };
  }

  // 5. Calculate estimated cost
  let estimatedCost = null;
  if (model.pricing) {
    const inputCost = (estimatedTaskTokens / 1000) * (model.pricing.inputPer1kTokens || 0);
    const outputCost = ((model.maxOutputTokens || 4000) / 1000) * (model.pricing.outputPer1kTokens || 0);
    estimatedCost = {
      input: inputCost.toFixed(4),
      output: outputCost.toFixed(4),
      total: (inputCost + outputCost).toFixed(4),
      currency: model.pricing.currency || 'USD'
    };
  }

  // Model can handle the task
  return {
    canHandle: true,
    modelId,
    displayName: model.displayName,
    costTier: model.costTier,
    contextRequirements,
    estimatedTokens: estimatedTaskTokens,
    contextWindow,
    contextUsage: `${((estimatedTaskTokens / contextWindow) * 100).toFixed(1)}%`,
    estimatedCost,
    // Include model preferences for caller
    modelPreferences: model.contextPreferences || {
      density: 'standard',
      explicitExamples: true,
      patternHints: true,
      minContextForQuality: 0.5
    }
  };
}

/**
 * Evaluate multiple models for a task and recommend the best one.
 * Useful when user wants to compare options.
 *
 * @param {Object} params - Evaluation parameters
 * @param {Object} params.analysis - Task analysis
 * @param {string} params.taskDescription - Task description
 * @param {string[]} params.modelIds - Models to evaluate (if not provided, evaluates all)
 * @returns {Promise<Object>} Comparison result
 */
async function evaluateModelsForTask(params) {
  const { analysis, taskDescription, modelIds = null } = params;

  const registry = loadRegistry();
  if (!registry) {
    return { success: false, error: 'Model registry not found' };
  }

  // Get models to evaluate
  let models;
  if (modelIds && modelIds.length > 0) {
    models = modelIds.filter(id => registry.models?.[id]);
  } else {
    models = Object.keys(registry.models || {});
  }

  if (models.length === 0) {
    return { success: false, error: 'No models to evaluate' };
  }

  // Evaluate each model
  const evaluations = await Promise.all(
    models.map(async modelId => {
      const result = await evaluateSingleModel({
        modelId,
        analysis,
        taskDescription
      });
      return { modelId, ...result };
    })
  );

  // Separate capable and incapable models (single pass)
  const { capable, incapable } = evaluations.reduce((acc, e) => {
    (e.canHandle ? acc.capable : acc.incapable).push(e);
    return acc;
  }, { capable: [], incapable: [] });

  // Rank capable models by quality (capability + cost efficiency)
  const ranked = capable.sort((a, b) => {
    // Prefer models with better context efficiency
    const efficiencyA = parseFloat(a.contextUsage) || 100;
    const efficiencyB = parseFloat(b.contextUsage) || 100;

    // Lower context usage is better
    if (Math.abs(efficiencyA - efficiencyB) > 10) {
      return efficiencyA - efficiencyB;
    }

    // Then by cost tier (quality-first)
    const tierOrder = { premium: 0, standard: 1, economy: 2 };
    return (tierOrder[a.costTier] || 1) - (tierOrder[b.costTier] || 1);
  });

  return {
    success: true,
    taskDescription,
    totalEvaluated: models.length,
    capableCount: capable.length,
    recommended: ranked[0] || null,
    alternatives: ranked.slice(1),
    incapable: incapable.map(e => ({
      modelId: e.modelId,
      reason: e.reason,
      details: e.missing || e.overflow || null
    }))
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
    // Security: Check for prototype pollution attempts
    if (flags.analysis.includes('__proto__') ||
        flags.analysis.includes('constructor') ||
        flags.analysis.includes('prototype')) {
      error('Invalid --analysis JSON: contains restricted keys');
      process.exit(1);
    }
    try {
      analysis = JSON.parse(flags.analysis);
      if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
        error('Invalid --analysis JSON: must be a non-array object');
        process.exit(1);
      }
      // Validate expected structure
      const validKeys = ['taskType', 'languages', 'capabilities', 'complexity', 'domains', 'patterns'];
      const analysisKeys = Object.keys(analysis);
      const invalidKeys = analysisKeys.filter(k => !validKeys.includes(k));
      if (invalidKeys.length > 0) {
        error(`Invalid --analysis JSON: unexpected keys: ${invalidKeys.join(', ')}`);
        process.exit(1);
      }
    } catch (err) {
      error(`Invalid --analysis JSON: ${err.message}`);
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
  // Core routing
  routeTask,
  routeTaskEnhanced,
  scoreModel,

  // Strategy functions
  routeQualityFirst,
  routeCostOptimized,
  routeLearned,

  // Phase 3: Enhanced routing helpers
  applyConstraints,
  applyTaskTypePreferences,
  checkLanguageProficiency,
  checkCascadeFallback,
  getRoutingConfig,

  // Phase 4: Single model evaluation (Smart Context integration)
  evaluateSingleModel,
  evaluateModelsForTask,

  // Registry/stats access
  loadRegistry,
  loadStats,
  loadMultiModelConfig,

  // Constants
  ROUTING_STRATEGIES,
  COST_TIER_ORDER,
  TASK_TYPE_ROUTING,
  LANGUAGE_ROUTING
};

if (require.main === module) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
