#!/usr/bin/env node

/**
 * Wogi Flow - Model Registry Commands
 *
 * Manages the multi-model registry and provides model selection,
 * routing recommendations, and statistics viewing.
 *
 * Part of Phase 1: Model Infrastructure
 *
 * Usage:
 *   flow models                    Show current model and routing
 *   flow models list               List all registered models
 *   flow models info <model>       Show detailed model info
 *   flow models route <task-type>  Show recommended model for task
 *   flow models stats              Show model performance statistics
 *   flow models cost [--period]    Show cost analysis
 *   flow models providers          List available providers
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT_ROOT,
  parseFlags,
  outputJson,
  color,
  error,
  info,
  getConfig,
  fileExists,
  dirExists
} = require('./flow-utils');

// Paths
const MODELS_DIR = path.join(PROJECT_ROOT, '.workflow', 'models');
const REGISTRY_PATH = path.join(MODELS_DIR, 'registry.json');
const STATS_PATH = path.join(MODELS_DIR, 'stats.json');

// ============================================================
// Registry Loading
// ============================================================

/**
 * Load the model registry
 */
function loadRegistry() {
  if (!fileExists(REGISTRY_PATH)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch (err) {
    console.error(error(`Failed to load registry: ${err.message}`));
    return null;
  }
}

/**
 * Load model statistics
 */
function loadStats() {
  if (!fileExists(STATS_PATH)) {
    return {
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
  }

  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  } catch (err) {
    console.error(error(`Failed to load stats: ${err.message}`));
    return null;
  }
}

/**
 * Save model statistics
 */
function saveStats(stats) {
  stats.lastUpdated = new Date().toISOString();

  if (!dirExists(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

// ============================================================
// Model Information
// ============================================================

/**
 * Get current active model from config
 */
function getCurrentModel() {
  const config = getConfig();
  const registry = loadRegistry();

  if (!registry) {
    return { name: 'unknown', info: null };
  }

  // Check hybrid mode config
  if (config.hybrid?.enabled && config.hybrid.executor?.model) {
    const modelId = config.hybrid.executor.model;
    return {
      name: modelId,
      info: registry.models[modelId] || null,
      source: 'hybrid-config'
    };
  }

  // Check environment
  if (process.env.CLAUDE_MODEL) {
    return {
      name: process.env.CLAUDE_MODEL,
      info: registry.models[process.env.CLAUDE_MODEL] || null,
      source: 'environment'
    };
  }

  // Use default from routing
  const defaultModel = registry.routing?.default?.primary || 'claude-sonnet-4';
  return {
    name: defaultModel,
    info: registry.models[defaultModel] || null,
    source: 'default'
  };
}

/**
 * Get model by ID
 */
function getModel(modelId) {
  const registry = loadRegistry();
  if (!registry) return null;

  return registry.models[modelId] || null;
}

/**
 * List all registered models
 */
function listModels(options = {}) {
  const registry = loadRegistry();
  if (!registry) {
    console.error(error('No model registry found. Run flow init to create one.'));
    return [];
  }

  const models = [];

  for (const [id, model] of Object.entries(registry.models)) {
    models.push({
      id,
      displayName: model.displayName,
      provider: model.provider,
      contextWindow: model.contextWindow,
      costTier: model.costTier,
      capabilities: model.capabilities,
      bestFor: model.bestFor
    });
  }

  // Sort by cost tier if requested
  if (options.sortBy === 'cost') {
    const tierOrder = { economy: 1, standard: 2, premium: 3 };
    models.sort((a, b) => tierOrder[a.costTier] - tierOrder[b.costTier]);
  }

  // Filter by provider
  if (options.provider) {
    return models.filter(m => m.provider === options.provider);
  }

  // Filter by capability
  if (options.capability) {
    return models.filter(m => m.capabilities.includes(options.capability));
  }

  return models;
}

/**
 * Get routing recommendation for a task type
 */
function getRouteRecommendation(taskType, options = {}) {
  const registry = loadRegistry();
  if (!registry) return null;

  const routing = registry.routing;
  const stats = loadStats();

  // Check task-type specific routing
  const taskRouting = routing.byTaskType?.[taskType];
  if (taskRouting) {
    const modelId = taskRouting.primary;
    const model = registry.models[modelId];

    return {
      recommended: modelId,
      model: model,
      reason: `Task type '${taskType}' routes to ${model?.displayName || modelId}`,
      alternatives: [routing.default.fallback, routing.default.escalation].filter(Boolean),
      stats: stats.byModel?.[modelId] || null
    };
  }

  // Check language-specific routing
  if (options.language && routing.byLanguage?.[options.language]) {
    const langRouting = routing.byLanguage[options.language];
    const modelId = langRouting.primary;
    const model = registry.models[modelId];

    return {
      recommended: modelId,
      model: model,
      reason: `Language '${options.language}' routes to ${model?.displayName || modelId}`,
      alternatives: [langRouting.fallback, routing.default.escalation].filter(Boolean),
      stats: stats.byModel?.[modelId] || null
    };
  }

  // Use default routing
  const defaultModel = routing.default.primary;
  const model = registry.models[defaultModel];

  return {
    recommended: defaultModel,
    model: model,
    reason: 'Using default routing',
    alternatives: [routing.default.fallback, routing.default.escalation].filter(Boolean),
    stats: stats.byModel?.[defaultModel] || null
  };
}

/**
 * List available providers
 */
function listProviders() {
  const registry = loadRegistry();
  if (!registry) return [];

  return Object.entries(registry.providers).map(([id, provider]) => ({
    id,
    name: provider.name,
    hasCliSupport: !!provider.cli,
    cliId: provider.cli?.cliId || null,
    supportedFeatures: provider.supportedFeatures
  }));
}

// ============================================================
// Statistics & Analytics
// ============================================================

/**
 * Record a task execution for statistics
 */
function recordTaskExecution(modelId, taskData) {
  const stats = loadStats();
  const registry = loadRegistry();
  const model = registry?.models[modelId];

  // Update summary
  stats.summary.totalTasks++;
  stats.summary.totalTokensUsed += taskData.tokensUsed || 0;

  // Calculate cost
  if (model?.pricing && taskData.tokensUsed) {
    const inputCost = (taskData.inputTokens || 0) / 1000 * model.pricing.inputPer1kTokens;
    const outputCost = (taskData.outputTokens || 0) / 1000 * model.pricing.outputPer1kTokens;
    const taskCost = inputCost + outputCost;
    stats.summary.totalCost += taskCost;
    taskData.cost = taskCost;
  }

  // Initialize model stats if needed
  if (!stats.byModel[modelId]) {
    stats.byModel[modelId] = {
      totalTasks: 0,
      successes: 0,
      failures: 0,
      totalTokens: 0,
      totalCost: 0,
      avgLatencyMs: 0,
      byTaskType: {}
    };
  }

  const modelStats = stats.byModel[modelId];
  modelStats.totalTasks++;
  modelStats.totalTokens += taskData.tokensUsed || 0;
  modelStats.totalCost += taskData.cost || 0;

  if (taskData.success) {
    modelStats.successes++;
  } else {
    modelStats.failures++;
    stats.failureStats.totalFailures++;

    if (taskData.errorCategory) {
      stats.failureStats.byCategory[taskData.errorCategory] =
        (stats.failureStats.byCategory[taskData.errorCategory] || 0) + 1;
    }
  }

  // Track by task type
  if (taskData.taskType) {
    if (!stats.byTaskType[taskData.taskType]) {
      stats.byTaskType[taskData.taskType] = {
        total: 0,
        success: 0,
        avgTokens: 0,
        totalCost: 0
      };
    }

    const typeStats = stats.byTaskType[taskData.taskType];
    typeStats.total++;
    if (taskData.success) typeStats.success++;
    typeStats.totalCost += taskData.cost || 0;

    // Also track in model-specific task types
    if (!modelStats.byTaskType[taskData.taskType]) {
      modelStats.byTaskType[taskData.taskType] = { total: 0, success: 0 };
    }
    modelStats.byTaskType[taskData.taskType].total++;
    if (taskData.success) modelStats.byTaskType[taskData.taskType].success++;
  }

  // Add to recent tasks (keep last 50)
  stats.recentTasks.unshift({
    timestamp: new Date().toISOString(),
    model: modelId,
    taskType: taskData.taskType,
    success: taskData.success,
    tokensUsed: taskData.tokensUsed,
    cost: taskData.cost,
    latencyMs: taskData.latencyMs
  });
  stats.recentTasks = stats.recentTasks.slice(0, 50);

  // Track routing events
  if (taskData.wasEscalation) {
    stats.routingStats.escalations++;
  }
  if (taskData.wasFallback) {
    stats.routingStats.fallbacks++;
  }

  saveStats(stats);

  return {
    recorded: true,
    cost: taskData.cost
  };
}

/**
 * Get cost analysis
 */
function getCostAnalysis(options = {}) {
  const stats = loadStats();
  const registry = loadRegistry();

  const analysis = {
    totalCost: stats.summary.totalCost,
    totalTasks: stats.summary.totalTasks,
    avgCostPerTask: stats.summary.totalTasks > 0
      ? stats.summary.totalCost / stats.summary.totalTasks
      : 0,
    byModel: {},
    byTaskType: {},
    recommendations: []
  };

  // Cost by model
  for (const [modelId, modelStats] of Object.entries(stats.byModel)) {
    const model = registry?.models[modelId];
    analysis.byModel[modelId] = {
      displayName: model?.displayName || modelId,
      costTier: model?.costTier || 'unknown',
      totalCost: modelStats.totalCost,
      totalTasks: modelStats.totalTasks,
      avgCostPerTask: modelStats.totalTasks > 0
        ? modelStats.totalCost / modelStats.totalTasks
        : 0
    };
  }

  // Cost by task type
  for (const [taskType, typeStats] of Object.entries(stats.byTaskType)) {
    analysis.byTaskType[taskType] = {
      totalCost: typeStats.totalCost,
      totalTasks: typeStats.total,
      avgCost: typeStats.total > 0 ? typeStats.totalCost / typeStats.total : 0
    };
  }

  // Generate recommendations
  for (const [modelId, modelData] of Object.entries(analysis.byModel)) {
    if (modelData.costTier === 'premium' && modelData.totalTasks > 5) {
      const avgCost = modelData.avgCostPerTask;
      if (avgCost > 0.10) {
        analysis.recommendations.push({
          type: 'cost-optimization',
          message: `Consider using Claude Sonnet for simpler tasks currently using ${modelData.displayName}`,
          potentialSavings: avgCost * 0.6 * modelData.totalTasks
        });
      }
    }
  }

  return analysis;
}

/**
 * Get model performance comparison
 */
function getModelComparison() {
  const stats = loadStats();
  const registry = loadRegistry();

  const comparison = [];

  for (const [modelId, modelStats] of Object.entries(stats.byModel)) {
    const model = registry?.models[modelId];
    const successRate = modelStats.totalTasks > 0
      ? (modelStats.successes / modelStats.totalTasks) * 100
      : 0;

    comparison.push({
      id: modelId,
      displayName: model?.displayName || modelId,
      costTier: model?.costTier || 'unknown',
      totalTasks: modelStats.totalTasks,
      successRate: successRate.toFixed(1) + '%',
      avgCost: modelStats.totalTasks > 0
        ? (modelStats.totalCost / modelStats.totalTasks).toFixed(4)
        : '0',
      avgLatencyMs: modelStats.avgLatencyMs || 0,
      topTaskTypes: Object.entries(modelStats.byTaskType)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 3)
        .map(([type, data]) => `${type}(${data.total})`)
    });
  }

  return comparison.sort((a, b) => b.totalTasks - a.totalTasks);
}

// ============================================================
// CLI Output Formatting
// ============================================================

/**
 * Format section header as string (unlike printSection which logs directly)
 */
function sectionHeader(title) {
  return color('cyan', title);
}

/**
 * Format main header as string (unlike printHeader which logs directly)
 */
function headerString(title) {
  const line = color('cyan', '='.repeat(50));
  return `${line}\n${color('cyan', `        ${title}`)}\n${line}\n`;
}

function formatCurrentModel() {
  const current = getCurrentModel();
  const registry = loadRegistry();

  let output = '';
  output += headerString('Current Model');
  output += '\n';

  if (current.info) {
    output += `  ${color('cyan', current.info.displayName)} (${current.name})\n`;
    output += `  ${color('dim', 'Provider:')} ${current.info.provider}\n`;
    output += `  ${color('dim', 'Source:')} ${current.source}\n`;
    output += `  ${color('dim', 'Context:')} ${(current.info.contextWindow / 1000).toFixed(0)}K tokens\n`;
    output += `  ${color('dim', 'Cost tier:')} ${current.info.costTier}\n`;

    if (current.info.capabilities) {
      output += `  ${color('dim', 'Capabilities:')} ${current.info.capabilities.join(', ')}\n`;
    }
  } else {
    output += `  ${color('yellow', current.name)} (not in registry)\n`;
  }

  // Show routing info
  output += '\n';
  output += sectionHeader('Routing') + '\n';

  const routing = registry?.routing?.default;
  if (routing) {
    output += `  ${color('dim', 'Primary:')} ${routing.primary}\n`;
    output += `  ${color('dim', 'Fallback:')} ${routing.fallback}\n`;
    output += `  ${color('dim', 'Escalation:')} ${routing.escalation}\n`;
  }

  return output;
}

function formatModelList(models) {
  let output = '';
  output += headerString('Registered Models');
  output += '\n';

  // Group by cost tier
  const tiers = { premium: [], standard: [], economy: [] };

  for (const model of models) {
    const tier = model.costTier || 'standard';
    if (tiers[tier]) {
      tiers[tier].push(model);
    }
  }

  for (const [tier, tierModels] of Object.entries(tiers)) {
    if (tierModels.length === 0) continue;

    const tierIcon = tier === 'premium' ? '*' : tier === 'economy' ? 'o' : '-';
    output += `\n${color('cyan', `${tierIcon} ${tier.toUpperCase()}`)}\n`;

    for (const model of tierModels) {
      output += `  ${color('bold', model.displayName)} (${model.id})\n`;
      output += `    ${color('dim', 'Provider:')} ${model.provider}\n`;
      output += `    ${color('dim', 'Context:')} ${(model.contextWindow / 1000).toFixed(0)}K\n`;
      output += `    ${color('dim', 'Best for:')} ${model.bestFor.join(', ')}\n`;
    }
  }

  return output;
}

function formatModelInfo(modelId) {
  const model = getModel(modelId);
  const stats = loadStats();
  const modelStats = stats.byModel?.[modelId];

  let output = '';

  if (!model) {
    return error(`Model '${modelId}' not found in registry`);
  }

  output += headerString(model.displayName);
  output += '\n';

  output += sectionHeader('Configuration') + '\n';
  output += `  ${color('dim', 'ID:')} ${modelId}\n`;
  output += `  ${color('dim', 'Model ID:')} ${model.modelId}\n`;
  output += `  ${color('dim', 'Provider:')} ${model.provider}\n`;
  output += `  ${color('dim', 'Context window:')} ${model.contextWindow.toLocaleString()} tokens\n`;
  output += `  ${color('dim', 'Max output:')} ${model.maxOutputTokens.toLocaleString()} tokens\n`;
  output += `  ${color('dim', 'Cost tier:')} ${model.costTier}\n`;

  output += '\n';
  output += sectionHeader('Capabilities') + '\n';
  for (const cap of model.capabilities) {
    output += `  - ${cap}\n`;
  }

  output += '\n';
  output += sectionHeader('Best For') + '\n';
  for (const use of model.bestFor) {
    output += `  - ${use}\n`;
  }

  output += '\n';
  output += sectionHeader('Language Proficiency') + '\n';
  const sortedLangs = Object.entries(model.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [lang, score] of sortedLangs) {
    const bar = '#'.repeat(score) + '.'.repeat(10 - score);
    output += `  ${lang.padEnd(12)} ${bar} ${score}/10\n`;
  }

  output += '\n';
  output += sectionHeader('Pricing') + '\n';
  output += `  ${color('dim', 'Input:')} $${model.pricing.inputPer1kTokens}/1K tokens\n`;
  output += `  ${color('dim', 'Output:')} $${model.pricing.outputPer1kTokens}/1K tokens\n`;

  if (modelStats) {
    output += '\n';
    output += sectionHeader('Usage Statistics') + '\n';
    const successRate = modelStats.totalTasks > 0
      ? ((modelStats.successes / modelStats.totalTasks) * 100).toFixed(1)
      : 0;
    output += `  ${color('dim', 'Total tasks:')} ${modelStats.totalTasks}\n`;
    output += `  ${color('dim', 'Success rate:')} ${successRate}%\n`;
    output += `  ${color('dim', 'Total cost:')} $${modelStats.totalCost.toFixed(4)}\n`;
  }

  return output;
}

function formatRouteRecommendation(taskType, recommendation) {
  let output = '';
  output += headerString(`Routing: ${taskType}`);
  output += '\n';

  output += `  ${color('green', '->')} ${color('bold', recommendation.model?.displayName || recommendation.recommended)}\n`;
  output += `  ${color('dim', recommendation.reason)}\n`;

  if (recommendation.alternatives?.length > 0) {
    output += `\n  ${color('dim', 'Alternatives:')} ${recommendation.alternatives.join(', ')}\n`;
  }

  if (recommendation.stats) {
    const successRate = recommendation.stats.totalTasks > 0
      ? ((recommendation.stats.successes / recommendation.stats.totalTasks) * 100).toFixed(1)
      : 'N/A';
    output += `\n  ${color('dim', 'Past performance:')} ${successRate}% success (${recommendation.stats.totalTasks} tasks)\n`;
  }

  return output;
}

function formatStats() {
  const stats = loadStats();
  const comparison = getModelComparison();

  let output = '';
  output += headerString('Model Statistics');
  output += '\n';

  output += sectionHeader('Summary') + '\n';
  output += `  ${color('dim', 'Total tasks:')} ${stats.summary.totalTasks}\n`;
  output += `  ${color('dim', 'Total tokens:')} ${stats.summary.totalTokensUsed.toLocaleString()}\n`;
  output += `  ${color('dim', 'Total cost:')} $${stats.summary.totalCost.toFixed(4)}\n`;
  output += `  ${color('dim', 'Escalations:')} ${stats.routingStats.escalations}\n`;
  output += `  ${color('dim', 'Fallbacks:')} ${stats.routingStats.fallbacks}\n`;

  if (comparison.length > 0) {
    output += '\n';
    output += sectionHeader('By Model') + '\n';

    for (const model of comparison) {
      const icon = parseFloat(model.successRate) >= 90 ? '+'
        : parseFloat(model.successRate) >= 70 ? '~' : '-';
      output += `\n  ${color('cyan', icon)} ${color('bold', model.displayName)}\n`;
      output += `    Tasks: ${model.totalTasks} | Success: ${model.successRate} | Avg cost: $${model.avgCost}\n`;
      if (model.topTaskTypes.length > 0) {
        output += `    Top types: ${model.topTaskTypes.join(', ')}\n`;
      }
    }
  }

  if (Object.keys(stats.failureStats.byCategory).length > 0) {
    output += '\n';
    output += sectionHeader('Failures by Category') + '\n';
    for (const [category, count] of Object.entries(stats.failureStats.byCategory)) {
      output += `  ${category}: ${count}\n`;
    }
  }

  return output;
}

function formatCostAnalysis(analysis) {
  let output = '';
  output += headerString('Cost Analysis');
  output += '\n';

  output += sectionHeader('Overview') + '\n';
  output += `  ${color('dim', 'Total spend:')} $${analysis.totalCost.toFixed(4)}\n`;
  output += `  ${color('dim', 'Total tasks:')} ${analysis.totalTasks}\n`;
  output += `  ${color('dim', 'Avg per task:')} $${analysis.avgCostPerTask.toFixed(4)}\n`;

  if (Object.keys(analysis.byModel).length > 0) {
    output += '\n';
    output += sectionHeader('Cost by Model') + '\n';

    const sortedModels = Object.entries(analysis.byModel)
      .sort((a, b) => b[1].totalCost - a[1].totalCost);

    for (const [modelId, data] of sortedModels) {
      output += `  ${color('cyan', data.displayName)} (${data.costTier})\n`;
      output += `    Total: $${data.totalCost.toFixed(4)} | Tasks: ${data.totalTasks} | Avg: $${data.avgCostPerTask.toFixed(4)}\n`;
    }
  }

  if (analysis.recommendations.length > 0) {
    output += '\n';
    output += sectionHeader('Recommendations') + '\n';
    for (const rec of analysis.recommendations) {
      output += `  ${color('yellow', '->')} ${rec.message}\n`;
      if (rec.potentialSavings) {
        output += `    ${color('green', `Potential savings: $${rec.potentialSavings.toFixed(2)}`)}\n`;
      }
    }
  }

  return output;
}

function formatProviders(providers) {
  let output = '';
  output += headerString('Available Providers');
  output += '\n';

  for (const provider of providers) {
    const cliIcon = provider.hasCliSupport ? color('green', '+') : color('dim', 'o');
    output += `  ${cliIcon} ${color('bold', provider.name)} (${provider.id})\n`;

    if (provider.hasCliSupport) {
      output += `    ${color('dim', 'CLI:')} ${provider.cliId}\n`;
    }

    if (provider.supportedFeatures) {
      output += `    ${color('dim', 'Features:')} ${provider.supportedFeatures.join(', ')}\n`;
    }
  }

  return output;
}

// ============================================================
// CLI Entry Point
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Model Registry

Manage multi-model configuration, routing, and statistics.

Usage:
  flow models                       Show current model and routing
  flow models list [options]        List all registered models
  flow models info <model>          Show detailed model information
  flow models route <task-type>     Get routing recommendation
  flow models stats                 Show model performance statistics
  flow models cost                  Show cost analysis
  flow models providers             List available providers

Options:
  --provider <name>    Filter by provider (anthropic, openai, google, ollama)
  --capability <name>  Filter by capability (code-gen, reasoning, vision, etc.)
  --json               Output as JSON
  --help, -h           Show this help

Examples:
  flow models                              # Show current model
  flow models list --provider anthropic    # List Anthropic models
  flow models info claude-sonnet-4         # Show Sonnet details
  flow models route feature                # Get model for feature work
  flow models stats                        # View statistics
  flow models cost                         # Analyze costs
`);
}

function main() {
  const args = process.argv.slice(2);
  const { flags } = parseFlags(args);
  const command = args.find(a => !a.startsWith('--')) || '';

  if (flags.help || flags.h) {
    showHelp();
    process.exit(0);
  }

  // Check registry exists
  if (!fileExists(REGISTRY_PATH)) {
    console.log(error('No model registry found at .workflow/models/registry.json'));
    console.log(info('Run `flow init` to create one or check your workflow setup.'));
    process.exit(1);
  }

  switch (command) {
    case '':
    case 'current':
      if (flags.json) {
        outputJson(getCurrentModel());
      } else {
        console.log(formatCurrentModel());
      }
      break;

    case 'list':
    case 'ls':
      const models = listModels({
        provider: flags.provider,
        capability: flags.capability,
        sortBy: flags.sort
      });
      if (flags.json) {
        outputJson(models);
      } else {
        console.log(formatModelList(models));
      }
      break;

    case 'info':
      const modelId = args.find(a => !a.startsWith('--') && a !== 'info');
      if (!modelId) {
        console.log(error('Please specify a model ID. Use `flow models list` to see available models.'));
        process.exit(1);
      }
      if (flags.json) {
        outputJson(getModel(modelId));
      } else {
        console.log(formatModelInfo(modelId));
      }
      break;

    case 'route':
      const taskType = args.find(a => !a.startsWith('--') && a !== 'route');
      if (!taskType) {
        console.log(error('Please specify a task type (feature, bugfix, refactor, etc.)'));
        process.exit(1);
      }
      const recommendation = getRouteRecommendation(taskType, { language: flags.language });
      if (flags.json) {
        outputJson(recommendation);
      } else {
        console.log(formatRouteRecommendation(taskType, recommendation));
      }
      break;

    case 'stats':
    case 'statistics':
      if (flags.json) {
        outputJson({
          stats: loadStats(),
          comparison: getModelComparison()
        });
      } else {
        console.log(formatStats());
      }
      break;

    case 'cost':
    case 'costs':
      const analysis = getCostAnalysis({ period: flags.period });
      if (flags.json) {
        outputJson(analysis);
      } else {
        console.log(formatCostAnalysis(analysis));
      }
      break;

    case 'providers':
      const providers = listProviders();
      if (flags.json) {
        outputJson(providers);
      } else {
        console.log(formatProviders(providers));
      }
      break;

    default:
      // Check if it's a model ID
      if (getModel(command)) {
        if (flags.json) {
          outputJson(getModel(command));
        } else {
          console.log(formatModelInfo(command));
        }
      } else {
        console.log(error(`Unknown command: ${command}`));
        showHelp();
        process.exit(1);
      }
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  loadRegistry,
  loadStats,
  saveStats,
  getCurrentModel,
  getModel,
  listModels,
  getRouteRecommendation,
  listProviders,
  recordTaskExecution,
  getCostAnalysis,
  getModelComparison
};

if (require.main === module) {
  main();
}
