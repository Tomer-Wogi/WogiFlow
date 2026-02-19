#!/usr/bin/env node

/**
 * Wogi Flow - Model-Specific Adapters
 *
 * Manages per-model learning and prompt adjustments.
 * Different models (Claude Opus, Sonnet, Ollama, LM Studio) have different
 * strengths and weaknesses. This module:
 *
 * 1. Detects current model from config/environment
 * 2. Loads model-specific adapter with prompt adjustments
 * 3. Records per-model success/failure patterns
 * 4. Auto-learns from repeated mistakes (updates adapter file)
 *
 * Uses multi-model approach with per-model learning.
 *
 * Usage as module:
 *   const { getCurrentModel, getPromptAdjustments, recordModelResult } = require('./flow-model-adapter');
 *   const model = getCurrentModel();
 *   const adjustments = getPromptAdjustments(model);
 *
 * Usage as CLI:
 *   flow model-adapter              # Show current model info
 *   flow model-adapter --list       # List available adapters
 *   flow model-adapter --stats      # Show per-model statistics
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, PATHS, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const ADAPTERS_DIR = path.join(PROJECT_ROOT, '.workflow', 'model-adapters');
const MODEL_STATS_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'model-stats.json');

// ============================================================
// Model Detection
// ============================================================

/**
 * Known model patterns for identification
 */
const MODEL_PATTERNS = {
  'claude-opus': ['claude-opus', 'opus', 'claude-3-opus', 'claude-opus-4', 'claude-opus-4-5', 'claude-opus-4-6', 'opus-4.5', 'opus-4.6'],
  'claude-sonnet': ['claude-sonnet', 'sonnet', 'claude-3-sonnet', 'claude-sonnet-4', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'sonnet-4.5', 'sonnet-4.6'],
  'claude-haiku': ['claude-haiku', 'haiku', 'claude-3-haiku'],
  'gpt-4': ['gpt-4', 'gpt-4-turbo', 'gpt-4o'],
  'gpt-3.5': ['gpt-3.5', 'gpt-3.5-turbo'],
  'ollama-nemotron': ['nemotron', 'nvidia-nemotron'],
  'ollama-qwen': ['qwen', 'qwen-coder', 'qwen3'],
  'ollama-deepseek': ['deepseek', 'deepseek-coder'],
  'ollama-codellama': ['codellama', 'code-llama'],
  'ollama-mistral': ['mistral', 'mixtral'],
  'lm-studio': ['lm-studio', 'lmstudio']
};

/**
 * Get current model from config or environment
 *
 * Note: This delegates to flow-models.js which is the single source of truth
 * for model detection. This function returns just the normalized name string
 * for backward compatibility with callers expecting a string.
 */
function getCurrentModel() {
  try {
    // Use flow-models as the single source of truth
    const { getCurrentModel: getModelFromRegistry } = require('./flow-models');
    const result = getModelFromRegistry();
    return normalizeModelName(result.name || 'claude-opus');
  } catch {
    // Fallback if flow-models not available
    const config = getConfig();

    if (config.hybrid?.enabled) {
      if (config.hybrid.executor?.model) {
        return normalizeModelName(config.hybrid.executor.model);
      }
      if (config.hybrid.model) {
        return normalizeModelName(config.hybrid.model);
      }
    }

    if (process.env.CLAUDE_MODEL) {
      return normalizeModelName(process.env.CLAUDE_MODEL);
    }

    if (config.modelAdapters?.currentModel) {
      return normalizeModelName(config.modelAdapters.currentModel);
    }

    return 'claude-opus';
  }
}

/**
 * Normalize model name to standard format
 */
function normalizeModelName(modelName) {
  const lower = modelName.toLowerCase();

  for (const [standard, patterns] of Object.entries(MODEL_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return standard;
      }
    }
  }

  // Return as-is if no pattern matches
  return lower.replace(/[^a-z0-9-]/g, '-');
}

/**
 * Get model family (claude, gpt, ollama, lm-studio)
 */
function getModelFamily(modelName) {
  const model = normalizeModelName(modelName);

  if (model.startsWith('claude-')) return 'claude';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('ollama-')) return 'ollama';
  if (model.startsWith('lm-studio')) return 'lm-studio';

  return 'unknown';
}

// ============================================================
// Adapter Loading
// ============================================================

/**
 * Get path to adapter file for a model
 */
function getAdapterPath(modelName) {
  const normalized = normalizeModelName(modelName);
  return path.join(ADAPTERS_DIR, `${normalized}.md`);
}

/**
 * Safely read file content with try-catch
 */
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    // File may have been deleted/moved between existsSync and readFileSync (TOCTOU)
    return null;
  }
}

/**
 * Load adapter file content
 */
function loadAdapter(modelName) {
  const adapterPath = getAdapterPath(modelName);

  if (!fs.existsSync(adapterPath)) {
    // Try loading family adapter
    const family = getModelFamily(modelName);
    const familyPath = path.join(ADAPTERS_DIR, `${family}-default.md`);

    if (fs.existsSync(familyPath)) {
      const content = safeReadFile(familyPath);
      if (content === null) return null;
      return {
        path: familyPath,
        content,
        isDefault: true
      };
    }

    // Load template as last resort
    const templatePath = path.join(ADAPTERS_DIR, '_template.md');
    if (fs.existsSync(templatePath)) {
      const content = safeReadFile(templatePath);
      if (content === null) return null;
      return {
        path: templatePath,
        content,
        isTemplate: true
      };
    }

    return null;
  }

  const content = safeReadFile(adapterPath);
  if (content === null) return null;
  return {
    path: adapterPath,
    content,
    isDefault: false
  };
}

/**
 * Parse adapter file into structured data
 */
function parseAdapter(content) {
  const adapter = {
    name: '',
    strengths: [],
    weaknesses: [],
    promptAdjustments: [],
    antiPatterns: [],
    knownIssues: [],
    learnings: []
  };

  if (!content) return adapter;

  // Extract name from first heading
  const nameMatch = content.match(/^#\s+(.+)/m);
  if (nameMatch) {
    adapter.name = nameMatch[1].trim();
  }

  // Extract sections
  const sections = content.split(/^##\s+/m);

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0]?.toLowerCase().trim() || '';
    const body = lines.slice(1).join('\n');

    if (title.includes('strength')) {
      adapter.strengths = extractListItems(body);
    } else if (title.includes('weakness')) {
      adapter.weaknesses = extractListItems(body);
    } else if (title.includes('prompt') || title.includes('adjustment')) {
      adapter.promptAdjustments = extractListItems(body);
    } else if (title.includes('anti-pattern') || title.includes('avoid')) {
      adapter.antiPatterns = extractListItems(body);
    } else if (title.includes('known issue') || title.includes('bug')) {
      adapter.knownIssues = extractListItems(body);
    } else if (title.includes('learning') || title.includes('mistake')) {
      adapter.learnings = extractLearnings(body);
    }
  }

  return adapter;
}

/**
 * Extract bullet list items from markdown
 */
function extractListItems(text) {
  const items = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const match = line.match(/^[-*]\s+(.+)/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  return items;
}

/**
 * Extract learning entries (date + content)
 */
function extractLearnings(text) {
  const learnings = [];
  const entries = text.split(/^###\s+/m);

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const lines = entry.split('\n');
    const title = lines[0]?.trim() || '';
    const body = lines.slice(1).join('\n').trim();

    if (title) {
      learnings.push({
        title,
        body,
        date: extractDateFromTitle(title)
      });
    }
  }

  return learnings;
}

/**
 * Extract date from learning title (e.g., "2024-01-15 - Fixed import issue")
 */
function extractDateFromTitle(title) {
  const match = title.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// ============================================================
// Prompt Adjustments
// ============================================================

/**
 * Get prompt adjustments for current model
 * Returns guidance to prepend to prompts
 */
function getPromptAdjustments(modelName = null) {
  const model = modelName || getCurrentModel();
  const adapterData = loadAdapter(model);

  if (!adapterData) {
    return {
      model,
      adjustments: [],
      guidance: ''
    };
  }

  const adapter = parseAdapter(adapterData.content);
  const guidance = [];

  // Add weakness-based guidance
  if (adapter.weaknesses.length > 0) {
    guidance.push('Be especially careful with:');
    for (const weakness of adapter.weaknesses.slice(0, 3)) {
      guidance.push(`- ${weakness}`);
    }
  }

  // Add anti-patterns
  if (adapter.antiPatterns.length > 0) {
    guidance.push('');
    guidance.push('Avoid these patterns:');
    for (const pattern of adapter.antiPatterns.slice(0, 3)) {
      guidance.push(`- ${pattern}`);
    }
  }

  // Add recent learnings (last 3)
  const recentLearnings = adapter.learnings.slice(-3);
  if (recentLearnings.length > 0) {
    guidance.push('');
    guidance.push('Recent learnings to remember:');
    for (const learning of recentLearnings) {
      guidance.push(`- ${learning.title}`);
    }
  }

  return {
    model,
    adapterPath: adapterData.path,
    isDefault: adapterData.isDefault || false,
    isTemplate: adapterData.isTemplate || false,
    adjustments: adapter.promptAdjustments,
    guidance: guidance.join('\n'),
    strengths: adapter.strengths,
    weaknesses: adapter.weaknesses
  };
}

// ============================================================
// Model Statistics & Learning
// ============================================================

/**
 * Load model statistics
 */
function loadModelStats() {
  try {
    if (fs.existsSync(MODEL_STATS_PATH)) {
      return JSON.parse(fs.readFileSync(MODEL_STATS_PATH, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }

  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    models: {}
  };
}

/**
 * Save model statistics
 */
function saveModelStats(stats) {
  stats.lastUpdated = new Date().toISOString();
  const dir = path.dirname(MODEL_STATS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(MODEL_STATS_PATH, JSON.stringify(stats, null, 2));
}

/**
 * Record a model execution result
 * @param {string} modelName - Model that was used
 * @param {object} result - { taskType, success, errorType?, errorContext? }
 */
function recordModelResult(modelName, result) {
  const config = getConfig();
  // Enable tracking if modelAdapters.enabled is true OR if hybrid mode is enabled
  // This allows stats to be collected without explicit modelAdapters config
  const trackingEnabled = config.modelAdapters?.enabled !== false &&
    (config.modelAdapters?.enabled || config.hybrid?.enabled);
  if (!trackingEnabled) return;

  const stats = loadModelStats();
  const model = normalizeModelName(modelName);

  // Initialize model entry
  if (!stats.models[model]) {
    stats.models[model] = {
      totalTasks: 0,
      successes: 0,
      failures: 0,
      taskTypes: {},
      errorTypes: {},
      recentErrors: []
    };
  }

  const modelStats = stats.models[model];
  modelStats.totalTasks++;

  if (result.success) {
    modelStats.successes++;
  } else {
    modelStats.failures++;

    // Track error types
    if (result.errorType) {
      modelStats.errorTypes[result.errorType] = (modelStats.errorTypes[result.errorType] || 0) + 1;
    }

    // Add to recent errors (keep last 20)
    modelStats.recentErrors.unshift({
      timestamp: new Date().toISOString(),
      taskType: result.taskType || 'unknown',
      errorType: result.errorType || 'unknown',
      errorContext: result.errorContext || null
    });
    modelStats.recentErrors = modelStats.recentErrors.slice(0, 20);

    // Check for repeated errors (trigger auto-learning)
    if (config.modelAdapters?.autoLearn) {
      checkAndAutoLearn(model, modelStats);
    }
  }

  // Track task types
  if (result.taskType) {
    if (!modelStats.taskTypes[result.taskType]) {
      modelStats.taskTypes[result.taskType] = { total: 0, success: 0 };
    }
    modelStats.taskTypes[result.taskType].total++;
    if (result.success) {
      modelStats.taskTypes[result.taskType].success++;
    }
  }

  saveModelStats(stats);
}

/**
 * Check for repeated errors and auto-learn
 */
function checkAndAutoLearn(modelName, modelStats) {
  const recentErrors = modelStats.recentErrors.slice(0, 10);

  // Group by error type
  const errorCounts = {};
  for (const error of recentErrors) {
    const key = error.errorType;
    if (!errorCounts[key]) {
      errorCounts[key] = { count: 0, contexts: [] };
    }
    errorCounts[key].count++;
    if (error.errorContext) {
      errorCounts[key].contexts.push(error.errorContext);
    }
  }

  // Find errors that occurred 3+ times
  const repeatedErrors = Object.entries(errorCounts)
    .filter(([_, data]) => data.count >= 3)
    .map(([type, data]) => ({ type, ...data }));

  if (repeatedErrors.length > 0) {
    addLearningToAdapter(modelName, repeatedErrors);
  }
}

/**
 * Store a single learning/correction in model adapter file
 * Used by knowledge-router for direct learning storage
 * @param {string} modelName - Model identifier
 * @param {string} learning - The learning text
 * @param {object} context - Optional context { taskId, sourceContext, trigger }
 */
function storeSingleLearning(modelName, learning, context = {}) {
  const adapterPath = getAdapterPath(modelName);
  let content = '';

  if (fs.existsSync(adapterPath)) {
    content = safeReadFile(adapterPath) || '';
  } else {
    // Ensure directory exists
    const dir = path.dirname(adapterPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create from template or minimal
    const templatePath = path.join(ADAPTERS_DIR, '_template.md');
    if (fs.existsSync(templatePath)) {
      const templateContent = safeReadFile(templatePath);
      content = templateContent ? templateContent.replace('{{MODEL_NAME}}', modelName) : `# ${modelName} Adapter\n\n## Learnings\n`;
    } else {
      content = `# ${modelName} Adapter\n\n## Learnings\n`;
    }
  }

  const date = new Date().toISOString().split('T')[0];
  const source = context.taskId || context.sourceContext || 'user-correction';
  const trigger = context.trigger || 'knowledge-router';

  const learningEntry = `
### ${date} - ${source}

**Trigger**: ${trigger}

${learning}

---
`;

  // Find Learnings section or append at end
  if (content.includes('## Learnings')) {
    const learningsIdx = content.indexOf('## Learnings');
    const nextSectionIdx = content.indexOf('\n## ', learningsIdx + 1);

    if (nextSectionIdx !== -1) {
      content = content.slice(0, nextSectionIdx) + learningEntry + content.slice(nextSectionIdx);
    } else {
      content += learningEntry;
    }
  } else {
    content += '\n## Learnings\n' + learningEntry;
  }

  fs.writeFileSync(adapterPath, content);

  return {
    success: true,
    file: adapterPath,
    message: `Stored as ${modelName}-specific learning`
  };
}

/**
 * Add learning entry to adapter file
 */
function addLearningToAdapter(modelName, errors) {
  const adapterPath = getAdapterPath(modelName);
  let content = '';

  if (fs.existsSync(adapterPath)) {
    content = safeReadFile(adapterPath) || '';
  } else {
    // Create from template
    const templatePath = path.join(ADAPTERS_DIR, '_template.md');
    if (fs.existsSync(templatePath)) {
      const templateContent = safeReadFile(templatePath);
      content = templateContent ? templateContent.replace('{{MODEL_NAME}}', modelName) : `# ${modelName} Adapter\n\n## Learnings\n`;
    } else {
      content = `# ${modelName} Adapter\n\n## Learnings\n`;
    }
  }

  // Add new learning entry
  const date = new Date().toISOString().split('T')[0];
  const learningEntry = [];

  learningEntry.push(`\n### ${date} - Auto-learned from repeated errors\n`);

  for (const error of errors) {
    learningEntry.push(`**Error Type**: ${error.type} (occurred ${error.count} times)`);
    if (error.contexts.length > 0) {
      learningEntry.push(`**Context**: ${error.contexts[0]}`);
    }
    learningEntry.push('');
  }

  // Find Learnings section or append at end
  if (content.includes('## Learnings')) {
    content = content.replace(
      /(## Learnings.*?)(?=\n## |$)/s,
      `$1${learningEntry.join('\n')}`
    );
  } else {
    content += '\n## Learnings\n' + learningEntry.join('\n');
  }

  // Ensure directory exists
  const dir = path.dirname(adapterPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(adapterPath, content);
}

/**
 * Get statistics for all models
 */
function getAllModelStats() {
  const stats = loadModelStats();

  return Object.entries(stats.models).map(([model, data]) => ({
    model,
    totalTasks: data.totalTasks,
    successRate: data.totalTasks > 0
      ? ((data.successes / data.totalTasks) * 100).toFixed(1) + '%'
      : 'N/A',
    topErrors: Object.entries(data.errorTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${type} (${count})`),
    taskBreakdown: Object.entries(data.taskTypes)
      .map(([type, info]) => ({
        type,
        total: info.total,
        successRate: info.total > 0 ? ((info.success / info.total) * 100).toFixed(0) + '%' : 'N/A'
      }))
  }));
}

// ============================================================
// CLI & Formatting
// ============================================================

/**
 * List available adapters
 */
function listAdapters() {
  if (!fs.existsSync(ADAPTERS_DIR)) {
    return [];
  }

  return fs.readdirSync(ADAPTERS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .map(f => f.replace('.md', ''));
}

/**
 * Format adapter info for display
 */
function formatAdapterInfo(modelName) {
  const adjustments = getPromptAdjustments(modelName);
  let output = '';

  output += `${colors.cyan}Model: ${adjustments.model}${colors.reset}\n`;

  if (adjustments.isTemplate) {
    output += `${colors.yellow}Using template (no specific adapter)${colors.reset}\n`;
  } else if (adjustments.isDefault) {
    output += `${colors.dim}Using family default adapter${colors.reset}\n`;
  } else {
    output += `${colors.green}Using model-specific adapter${colors.reset}\n`;
  }

  output += `Path: ${adjustments.adapterPath || 'N/A'}\n\n`;

  if (adjustments.strengths.length > 0) {
    output += `${colors.green}Strengths:${colors.reset}\n`;
    for (const s of adjustments.strengths.slice(0, 5)) {
      output += `  • ${s}\n`;
    }
    output += '\n';
  }

  if (adjustments.weaknesses.length > 0) {
    output += `${colors.yellow}Weaknesses:${colors.reset}\n`;
    for (const w of adjustments.weaknesses.slice(0, 5)) {
      output += `  • ${w}\n`;
    }
    output += '\n';
  }

  if (adjustments.adjustments.length > 0) {
    output += `${colors.bold}Prompt Adjustments:${colors.reset}\n`;
    for (const a of adjustments.adjustments) {
      output += `  • ${a}\n`;
    }
  }

  return output;
}

/**
 * Format statistics for display
 */
function formatStats() {
  const allStats = getAllModelStats();
  let output = '';

  output += `${colors.cyan}Model Statistics${colors.reset}\n`;
  output += `${'═'.repeat(50)}\n\n`;

  if (allStats.length === 0) {
    output += `${colors.dim}No statistics recorded yet.${colors.reset}\n`;
    return output;
  }

  for (const modelStat of allStats) {
    const icon = parseFloat(modelStat.successRate) >= 90
      ? colors.green + '●' + colors.reset
      : parseFloat(modelStat.successRate) >= 70
        ? colors.yellow + '●' + colors.reset
        : colors.red + '●' + colors.reset;

    output += `${icon} ${colors.bold}${modelStat.model}${colors.reset}\n`;
    output += `  Tasks: ${modelStat.totalTasks} | Success: ${modelStat.successRate}\n`;

    if (modelStat.topErrors.length > 0) {
      output += `  Top errors: ${modelStat.topErrors.join(', ')}\n`;
    }

    if (modelStat.taskBreakdown.length > 0) {
      output += `  By type: `;
      output += modelStat.taskBreakdown
        .map(t => `${t.type}(${t.successRate})`)
        .join(', ');
      output += '\n';
    }

    output += '\n';
  }

  return output;
}

function showHelp() {
  console.log(`
Wogi Flow - Model Adapters

Manages per-model learning and prompt adjustments for different LLMs.

Usage:
  flow model-adapter                Show current model info
  flow model-adapter --list         List available adapters
  flow model-adapter --stats        Show per-model statistics
  flow model-adapter --json         Output current model as JSON
  flow model-adapter [model]        Show info for specific model

Options:
  --list       List all available adapter files
  --stats      Show success/failure statistics per model
  --json       Output as JSON
  --help, -h   Show this help

Examples:
  flow model-adapter                     # Show current model
  flow model-adapter claude-sonnet       # Show Sonnet adapter
  flow model-adapter --stats             # View all model stats
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--list')) {
    const adapters = listAdapters();
    console.log(`${colors.cyan}Available Adapters:${colors.reset}`);
    if (adapters.length === 0) {
      console.log(`  ${colors.dim}No adapters found. Create one in .workflow/model-adapters/${colors.reset}`);
    } else {
      for (const adapter of adapters) {
        console.log(`  • ${adapter}`);
      }
    }
    process.exit(0);
  }

  if (args.includes('--stats')) {
    console.log(formatStats());
    process.exit(0);
  }

  // Get model name from args or detect
  const modelArg = args.find(a => !a.startsWith('--'));
  const modelName = modelArg || getCurrentModel();

  if (args.includes('--json')) {
    console.log(JSON.stringify(getPromptAdjustments(modelName), null, 2));
    process.exit(0);
  }

  console.log(formatAdapterInfo(modelName));
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getCurrentModel,
  normalizeModelName,
  getModelFamily,
  loadAdapter,
  parseAdapter,
  getPromptAdjustments,
  recordModelResult,
  getAllModelStats,
  listAdapters,
  addLearningToAdapter,
  storeSingleLearning,
  getAdapterPath
};

if (require.main === module) {
  main();
}
