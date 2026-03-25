#!/usr/bin/env node

/**
 * Wogi Flow - Hybrid Mode Orchestrator
 *
 * Executes plans created by Claude using a local LLM.
 * Updates all Wogi Flow state files after each step.
 *
 * Usage:
 *   flow-orchestrate <plan.json>    # Execute a plan
 *   flow-orchestrate --rollback     # Rollback last execution
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync, execFileSync, spawn } = require('node:child_process');
const readline = require('node:readline');
const { validatePathWithinProject } = require('./flow-security');
const { getExecParts } = require('./flow-script-resolver');
const { readJson } = require('./flow-io');

// Extracted class modules
const { ProjectContextGenerator } = require('./flow-orchestrate-context');
const { TemplateEngine } = require('./flow-orchestrate-templates');
const { Validator } = require('./flow-orchestrate-validator');
const { RollbackManager } = require('./flow-orchestrate-rollback');
const { StateManager } = require('./flow-orchestrate-state');

// Import LLM clients (extracted for modularity)
const { LocalLLM, CloudExecutor, createExecutor } = require('./flow-orchestrate-llm');

// Import complexity assessment module
const {
  assessTaskComplexity,
  TOKEN_BUDGETS,
  getDefaultTokens,
  clampTokens
} = require('./flow-complexity');

// Import instruction richness module
const {
  getInstructionRichness,
  getVerbosityGuidance,
  loadProjectContext: loadRichnessContext,
  loadPatterns,
  loadRelevantTypes,
  loadRelatedCode
} = require('./flow-instruction-richness');

// Import export scanner module
const {
  buildExportMap,
  loadCachedExportMap,
  saveExportMapCache,
  formatExportMapForTemplate,
  validateComponentUsage,
  formatComponentWithUsage,
  setProjectRoot: setExportScannerRoot
} = require('./flow-export-scanner');

// Import utilities for consistent project root, colors, and config
const { getProjectRoot, colors, getConfig, writeJson, estimateTokens, error, PATHS } = require('./flow-utils');
const { getPromptAdjustments, recordModelResult } = require('./flow-model-adapter');

// Import provider infrastructure for cloud executors
const {
  createExecutorFromConfig,
  getExecutorConfig,
  MODEL_CAPABILITIES,
  getModelContextLimit
} = require('./flow-providers');

// Import response parser for error recovery
const { parseOnRetry, cleanCodeBlock } = require('./flow-response-parser');

// Import validation module (extracted for modularity)
const {
  extractCodeFromResponse,
  isValidCode,
  validateOutputMatchesTask,
  validateImports
} = require('./flow-orchestrate-validation');

// Import adaptive learning for smart retries and model improvement
const {
  analyzeFailure,
  refinePromptForRetry,
  recordSuccessfulRecovery,
  ERROR_CATEGORIES
} = require('./flow-adaptive-learning');

// Import pattern enforcer for active learning enforcement
const {
  injectPatterns,
  extractRelevantPatterns,
  validateAgainstPatterns,
  generateSessionSummary
} = require('./flow-pattern-enforcer');

// v2.0: Import durable session for unified step tracking
const durableSession = require('./flow-durable-session');

// v2.1: Import Hybrid Mode Intelligence modules
const {
  getModelProfile,
  updateModelProfile,
  getInstructionRichness: getProfileBasedRichness
} = require('./flow-model-profile');

const {
  classifyTask,
  getTaskTypeContext
} = require('./flow-task-classifier');

const {
  learnFromFailure,
  enhancePromptWithLearning
} = require('./flow-failure-learning');

// ============================================================
// Configuration
// ============================================================

// Set export scanner project root to match orchestrator's
setExportScannerRoot(PATHS.root);
const TEMPLATES_DIR = path.join(PATHS.root, 'templates', 'hybrid');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

// ============================================================
// Structured Failure Output
// ============================================================

/**
 * Save structured failure info for retry context
 * This helps the AI understand what failed and how to fix it
 */
function saveStructuredFailure(step, errorHistory, attempts, config) {
  const failurePath = path.join(PATHS.state, 'last-failure.json');

  const failureInfo = {
    timestamp: new Date().toISOString(),
    taskId: step.taskId || step.description || 'unknown',
    stepAction: step.action || 'unknown',
    targetFile: step.file || null,
    attempts: attempts,
    maxRetries: config.maxRetries,
    model: config.model,
    errors: errorHistory.slice(-5).map(e => ({
      category: e.category,
      signature: e.signature,
      message: e.message?.slice(0, 500) || ''
    })),
    suggestion: generateFixSuggestion(errorHistory),
    lastErrorCategory: errorHistory[errorHistory.length - 1]?.category || 'unknown'
  };

  try {
    fs.writeFileSync(failurePath, JSON.stringify(failureInfo, null, 2));
    log('dim', `   📝 Failure context saved to ${failurePath}`);
  } catch (err) {
    log('dim', `   ⚠️ Could not save failure context: ${err.message}`);
  }

  return failureInfo;
}

/**
 * Generate a fix suggestion based on error history
 */
function generateFixSuggestion(errorHistory) {
  if (!errorHistory || errorHistory.length === 0) {
    return 'Review the task requirements and try again';
  }

  const lastError = errorHistory[errorHistory.length - 1];
  const errorCounts = {};

  for (const e of errorHistory) {
    errorCounts[e.category] = (errorCounts[e.category] ?? 0) + 1;
  }

  const mostCommon = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])[0];

  const suggestions = {
    import: 'Check import paths match the Available Imports section exactly',
    type: 'Verify prop types match the component definitions',
    syntax: 'Ensure output is pure code without markdown or explanations',
    runtime: 'Check for null/undefined handling and async/await usage',
    unknown: 'Review the error message for specific guidance'
  };

  return suggestions[mostCommon?.[0]] || suggestions.unknown;
}

// ============================================================
// Config Loader (uses centralized getConfig from flow-utils)
// ============================================================

function loadHybridConfig() {
  const config = getConfig();
  const hybrid = config.hybrid ?? {};

  if (!hybrid.enabled) {
    throw new Error('Hybrid mode is not enabled. Run /wogi-hybrid first.');
  }

  // Use getExecutorConfig to normalize legacy vs new config format
  const executorConfig = getExecutorConfig(hybrid);
  const isLocal = executorConfig.type !== 'cloud';

  // Context window: config override > executor config > auto-detect later
  const contextWindow = hybrid.executor?.contextWindow ??
                        hybrid.settings?.contextWindow ??
                        executorConfig.contextWindow ??
                        null;

  // For local LLMs: use full context (they're free!)
  // For cloud: respect configured limits or use model defaults
  const useFullContext = hybrid.executor?.useFullContext ?? isLocal;
  const outputReserveRatio = hybrid.settings?.outputReserveRatio ?? 0.3;
  const outputReserveMax = hybrid.settings?.outputReserveMax ?? 4096;

  // maxTokens calculation:
  // - If explicitly set in config, use that
  // - For local with useFullContext: will be calculated from contextWindow later
  // - For cloud: use a reasonable default based on model
  let maxTokens = hybrid.settings?.maxTokens;
  if (maxTokens === null || maxTokens === undefined) {
    if (isLocal && useFullContext) {
      // Will be calculated dynamically from contextWindow - reserve
      maxTokens = null; // Signal to calculate later
    } else if (!isLocal) {
      // Cloud models: use model's typical output limit
      maxTokens = 8192; // Most cloud models support at least this
    } else {
      // Local but not useFullContext: conservative default
      maxTokens = 16384;
    }
  }

  return {
    // Executor identification (new format)
    executorType: executorConfig.type || 'local',  // 'local' or 'cloud'
    provider: executorConfig.provider || 'ollama',
    endpoint: executorConfig.endpoint || 'http://localhost:11434',
    model: executorConfig.model || '',
    apiKey: executorConfig.apiKey || null,  // For cloud providers

    // Planner settings
    adaptToExecutor: hybrid.planner?.adaptToExecutor ?? true,
    useAdapterKnowledge: hybrid.planner?.useAdapterKnowledge ?? true,

    // Execution settings
    temperature: hybrid.settings?.temperature ?? 0.7,
    maxTokens,
    maxRetries: hybrid.settings?.maxRetries ?? 20,
    timeout: hybrid.settings?.timeout ?? (isLocal ? 120000 : 60000),
    autoExecute: hybrid.settings?.autoExecute ?? false,

    // Context window settings (new)
    contextWindow,
    useFullContext,
    outputReserveRatio,
    outputReserveMax,

    // Instruction richness settings
    instructionRichness: hybrid.settings?.instructionRichness ?? {},

    // Cloud provider reference (for model selection in setup wizard)
    cloudProviders: hybrid.cloudProviders ?? config.hybrid?.cloudProviders ?? {}
  };
}

// NOTE: Code extraction and validation functions moved to flow-orchestrate-validation.js
// Functions: extractCodeFromResponse, scoreCodeBlock, isValidCode, validateOutputMatchesTask, validateImports, escapeRegex

// ============================================================
// Auto-Correction for Common LLM Mistakes
// ============================================================

/**
 * Gets project context from config for auto-correction and templates.
 * Returns the projectContext section from config.json hybrid settings.
 */
function getProjectContext() {
  try {
    const config = getConfig();
    return config.hybrid?.projectContext ?? {};
  } catch (err) {
    return {};
  }
}

/**
 * Auto-corrects common LLM mistakes in generated code.
 * Runs before file write to fix predictable errors.
 *
 * Uses config.json → hybrid.projectContext for project-specific corrections.
 * Falls back to sensible defaults if no config exists.
 */
function autoCorrectCode(code, filePath, projectConfig = null) {
  if (!code || typeof code !== 'string') {
    return { corrected: code, corrections: [] };
  }

  // Load project context from config if not provided
  const ctx = projectConfig?.projectContext ?? getProjectContext();

  let corrected = code;
  const corrections = [];

  // 1. Remove forbidden imports (from config, defaults to ['React'])
  const doNotImport = ctx.doNotImport || ['React'];
  for (const forbidden of doNotImport) {
    // Case A: Default import - "import X from '...'"
    const defaultImportRegex = new RegExp(`^import ${forbidden} from ['"][^'"]+['"];?\\s*\\n?`, 'gm');
    if (defaultImportRegex.test(corrected)) {
      corrected = corrected.replace(defaultImportRegex, '');
      corrections.push(`Removed forbidden import: ${forbidden}`);
    }

    // Case B: Combined with named imports - "import X, { y, z } from '...'"
    const combinedImportRegex = new RegExp(`^import ${forbidden},\\s*(\\{[^}]+\\})\\s+from\\s+(['"][^'"]+['"])`, 'gm');
    if (combinedImportRegex.test(corrected)) {
      corrected = corrected.replace(combinedImportRegex, 'import $1 from $2');
      corrections.push(`Removed ${forbidden} from combined import`);
    }

    // Case C: Namespace import - "import * as X from '...'"
    const namespaceImportRegex = new RegExp(`^import \\* as ${forbidden} from ['"][^'"]+['"];?\\s*\\n?`, 'gm');
    if (namespaceImportRegex.test(corrected)) {
      corrected = corrected.replace(namespaceImportRegex, '');
      corrections.push(`Removed namespace import: ${forbidden}`);
    }
  }

  // 2. Fix component paths based on config mappings
  const componentPaths = ctx.componentPaths ?? {};

  // Build reverse mapping from shadcn-style to project paths
  // @/components/ui/button → project's Button path
  const shadcnPattern = /@\/components\/ui\/(\w+)/g;
  corrected = corrected.replace(shadcnPattern, (match, component) => {
    const capitalName = component.charAt(0).toUpperCase() + component.slice(1);
    const configPath = componentPaths[capitalName];
    if (configPath) {
      corrections.push(`Fixed import: ${match} → ${configPath}`);
      return configPath;
    }
    return match; // Leave as-is if no mapping
  });

  // 3. Fix type paths for features (from config)
  const typePaths = ctx.typePaths || { features: '../api/types' };
  if (filePath && filePath.includes('/features/') && typePaths.features) {
    const wrongPaths = ["'../types'", '"../types"', "'./types'", '"./types"'];
    for (const wrong of wrongPaths) {
      if (corrected.includes(wrong)) {
        corrected = corrected.replace(new RegExp(wrong.replace(/['"]/g, '[\'"]'), 'g'), `'${typePaths.features}'`);
        corrections.push('Fixed type import path');
      }
    }
  }

  // 4. Remove external utils if configured (noExternalUtils: true)
  if (ctx.noExternalUtils && corrected.includes('@/lib/utils')) {
    const hadFormatCurrency = corrected.includes('formatCurrency');
    const hadCn = corrected.includes(' cn(') || corrected.includes(' cn`');

    // Remove the import
    corrected = corrected.replace(/^import.*from ['"]@\/lib\/utils['"];?\s*\n?/gm, '');
    corrections.push('Removed @/lib/utils import');

    // Inline formatCurrency if it was used
    if (hadFormatCurrency) {
      const formatCurrencyFn = `\nconst formatCurrency = (amount: number) =>\n  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);\n`;
      // Insert after imports
      const lastImportMatch = corrected.match(/^import[^;]+;?\s*\n/gm);
      if (lastImportMatch) {
        const lastImport = lastImportMatch[lastImportMatch.length - 1];
        const insertPos = corrected.lastIndexOf(lastImport) + lastImport.length;
        corrected = corrected.slice(0, insertPos) + formatCurrencyFn + corrected.slice(insertPos);
      }
      corrections.push('Inlined formatCurrency');
    }

    // Remove cn() usage - just use template literals or className directly
    if (hadCn) {
      corrected = corrected.replace(/cn\((['"`][^'"`]+['"`])\)/g, '$1');
      corrections.push('Removed cn() wrapper');
    }
  }

  // 5. Fix double-quoted imports to single quotes (style consistency)
  const singleQuoteCount = (corrected.match(/from '/g) || []).length;
  const doubleQuoteCount = (corrected.match(/from "/g) || []).length;
  if (singleQuoteCount > doubleQuoteCount && doubleQuoteCount > 0) {
    corrected = corrected.replace(/from "([^"]+)"/g, "from '$1'");
    corrections.push('Normalized import quotes to single quotes');
  }

  // 6. Remove empty import statements (artifact of removing imports)
  corrected = corrected.replace(/^import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*\n?/gm, '');

  // 7. Fix multiple consecutive blank lines (cleanup)
  corrected = corrected.replace(/\n{3,}/g, '\n\n');

  // Log corrections if any
  if (corrections.length > 0 && typeof log === 'function') {
    log('dim', `   🔧 Auto-corrected: ${corrections.join(', ')}`);
  }

  return { corrected: corrected.trim(), corrections };
}

// ============================================================
// Project Auto-Detection (for wogi-init/wogi-onboard)
// ============================================================

/**
 * Detects the UI framework used in the project by checking dependencies.
 * @param {string} projectRoot - Root directory of the project
 * @returns {string} - Framework name: 'styled-components', 'shadcn', 'mui', 'chakra', 'antd', or 'react'
 */
function detectUIFramework(projectRoot = PATHS.root) {
  try {
    const pkgJsonPath = path.join(projectRoot, 'package.json');
    const pkgJson = readJson(pkgJsonPath, null);
    if (!pkgJson) {
      return 'react';
    }
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

    // Check in priority order
    if (deps['styled-components']) return 'styled-components';
    if (deps['@shadcn/ui'] || deps['@radix-ui/react-slot']) return 'shadcn';
    if (deps['@mui/material']) return 'mui';
    if (deps['@chakra-ui/react']) return 'chakra';
    if (deps['antd']) return 'antd';
    if (deps['tailwindcss']) return 'tailwind';

    return 'react'; // vanilla
  } catch (err) {
    return 'react';
  }
}

/**
 * Scans the components directory and builds a mapping of component names to import paths.
 * @param {string} projectRoot - Root directory of the project
 * @param {string[]} componentDirs - Directories to scan (relative to projectRoot)
 * @returns {Object} - Mapping of ComponentName → import path
 */
function scanComponentPaths(projectRoot = PATHS.root, componentDirs = ['src/components']) {
  const componentPaths = {};

  for (const dir of componentDirs) {
    const fullDir = path.join(projectRoot, dir);
    if (!fs.existsSync(fullDir)) continue;

    try {
      const scanDir = (dirPath, aliasPath) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
          if (entry.name.includes('.test.') || entry.name.includes('.spec.') || entry.name.includes('.stories.')) continue;

          const entryPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            // Check for index file or component file with same name
            const indexFile = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'].find(f =>
              fs.existsSync(path.join(entryPath, f))
            );

            const componentFile = ['.tsx', '.ts', '.jsx', '.js'].find(ext =>
              fs.existsSync(path.join(entryPath, entry.name + ext))
            );

            if (indexFile || componentFile) {
              // This is a component directory
              const componentName = entry.name;
              const importPath = `${aliasPath}/${entry.name}`;
              componentPaths[componentName] = importPath;
            }

            // Recurse into subdirectories
            scanDir(entryPath, `${aliasPath}/${entry.name}`);
          } else if (entry.isFile()) {
            // Direct component file
            const ext = path.extname(entry.name);
            if (['.tsx', '.ts', '.jsx', '.js'].includes(ext)) {
              const componentName = path.basename(entry.name, ext);
              // Skip index files and lowercase filenames (likely utilities)
              if (componentName === 'index' || componentName[0] === componentName[0].toLowerCase()) continue;

              const importPath = `${aliasPath}/${componentName}`;
              componentPaths[componentName] = importPath;
            }
          }
        }
      };

      // Determine alias path (@/components or relative)
      const aliasPath = dir.startsWith('src/') ? `@/${dir.slice(4)}` : `@/${dir}`;
      scanDir(fullDir, aliasPath);
    } catch (err) {
      log('dim', `   ⚠️ Error scanning ${dir}: ${err.message}`);
    }
  }

  return componentPaths;
}

/**
 * Generates a full projectContext configuration by auto-detecting project settings.
 * Can be called during wogi-init or wogi-onboard.
 * @param {string} projectRoot - Root directory of the project
 * @returns {Object} - projectContext configuration
 */
function generateProjectContext(projectRoot = PATHS.root) {
  const uiFramework = detectUIFramework(projectRoot);

  // Scan standard component directories
  const componentDirs = ['src/components', 'components', 'src/shared', 'shared'];
  const componentPaths = scanComponentPaths(projectRoot, componentDirs);

  // Default type paths
  const typePaths = {
    features: '../api/types',
    shared: '@/types'
  };

  // Default forbidden imports (React for React 17+)
  const doNotImport = ['React'];

  // NoExternalUtils depends on framework
  const noExternalUtils = uiFramework !== 'shadcn';

  return {
    uiFramework,
    componentPaths,
    typePaths,
    doNotImport,
    noExternalUtils
  };
}

// Export for CLI usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectUIFramework,
    scanComponentPaths,
    generateProjectContext,
    autoCorrectCode,
    extractCodeFromResponse,
    isValidCode
  };

}

// ProjectContextGenerator extracted to ./flow-orchestrate-context.js

// ============================================================
// Hybrid Metrics Logging
// ============================================================

/**
 * Logs token estimation metrics for accuracy tracking.
 * Saves to .workflow/state/hybrid-metrics.json
 *
 * @param {Object} plan - The executed plan
 * @param {Object} executionResult - Result of execution
 * @param {Object} complexity - Complexity assessment
 */
function logTokenMetrics(plan, executionResult, complexity) {
  const config = getConfig();
  const logMetrics = config.hybrid?.settings?.tokenEstimation?.logMetrics;

  if (!logMetrics) return;

  const metricsPath = path.join(PATHS.state, 'hybrid-metrics.json');

  // Load existing metrics or create new array
  const metrics = readJson(metricsPath, []);

  // Add new metric entry
  const entry = {
    timestamp: new Date().toISOString(),
    planId: plan.planId || 'unknown',
    task: plan.task || 'unknown',
    complexity: {
      level: complexity?.level ?? 'unknown',
      estimatedTokens: complexity?.estimatedTokens ?? 0,
      reasoning: complexity?.reasoning ?? ''
    },
    execution: {
      success: executionResult.success,
      stepsCompleted: executionResult.steps?.filter(s => s.success).length ?? 0,
      stepsTotal: executionResult.steps?.length ?? 0,
      escalated: executionResult.escalateToCloud?.length > 0,
      escalatedSteps: executionResult.escalateToCloud?.map(s => s.id) ?? []
    }
  };

  metrics.push(entry);

  // Keep only last 100 entries to prevent file bloat
  if (metrics.length > 100) {
    metrics = metrics.slice(-100);
  }

  // Save metrics
  try {
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  } catch (err) {
    log('yellow', `   ⚠️ Could not save metrics: ${err.message}`);
  }
}

/**
 * Displays complexity assessment to the user
 */
function displayComplexityAssessment(complexity) {
  log('white', '\n' + '─'.repeat(60));
  log('cyan', '                 COMPLEXITY ASSESSMENT');
  log('white', '─'.repeat(60));

  const levelColors = {
    small: 'green',
    medium: 'yellow',
    large: 'yellow',
    xl: 'red'
  };

  log(levelColors[complexity.level] || 'white', `\n   Level: ${complexity.level.toUpperCase()}`);
  log('white', `   Estimated Tokens: ${complexity.estimatedTokens.toLocaleString()}`);
  log('dim', `   Range: ${complexity.budget.min.toLocaleString()} - ${complexity.budget.max.toLocaleString()}`);
  log('dim', `\n   Reasoning: ${complexity.reasoning}`);

  // Show key factors
  if (complexity.factors.complexityKeywords?.length > 0) {
    log('dim', `   Keywords: ${complexity.factors.complexityKeywords.slice(0, 5).join(', ')}`);
  }

  log('white', '');
}

/**
 * Displays instruction richness settings to the user
 */
function displayInstructionRichness(richness) {
  log('white', '─'.repeat(60));
  log('cyan', '              INSTRUCTION RICHNESS');
  log('white', '─'.repeat(60));

  const levelColors = {
    minimal: 'green',
    standard: 'yellow',
    rich: 'yellow',
    maximum: 'red'
  };

  log(levelColors[richness.level] || 'white', `\n   Level: ${richness.level.toUpperCase()}`);
  log('white', `   Verbosity: ${richness.templateVerbosity}`);
  log('dim', `   Claude Token Budget: ~${richness.claudeTokenBudget.toLocaleString()}`);

  // Show what will be included
  const includes = [];
  if (richness.includeProjectContext) includes.push('Project Context');
  if (richness.includeTypeDefinitions) includes.push('Types');
  if (richness.includeRelatedCode) includes.push('Related Code');
  if (richness.includeExamples) includes.push('Examples');
  if (richness.includePatterns) includes.push('Patterns');
  if (richness.includeFullFileContents) includes.push('Full Files');

  log('dim', `   Includes: ${includes.join(', ') || 'Minimal context only'}`);
  log('dim', `\n   ${richness.description}`);
  log('white', '');
}

/**
 * Gets token estimation settings from config
 */
function getTokenEstimationSettings() {
  try {
    const config = getConfig();
    return {
      enabled: config.hybrid?.settings?.tokenEstimation?.enabled ?? true,
      minTokens: config.hybrid?.settings?.tokenEstimation?.minTokens ?? 1000,
      maxTokens: config.hybrid?.settings?.tokenEstimation?.maxTokens ?? 8000,
      defaultLevel: config.hybrid?.settings?.tokenEstimation?.defaultLevel ?? 'medium',
      logMetrics: config.hybrid?.settings?.tokenEstimation?.logMetrics ?? true
    };
  } catch (_err) {
    return {
      enabled: true,
      minTokens: 1000,
      maxTokens: 8000,
      defaultLevel: 'medium',
      logMetrics: true
    };
  }
}

// ============================================================
// Context Management & Auto-Compaction
// ============================================================

// estimateTokens imported from flow-utils.js

/**
 * Calculates context usage percentage
 */
function getContextUsage(promptTokens, contextWindow) {
  if (!contextWindow) return 0;
  return Math.round((promptTokens / contextWindow) * 100);
}

/**
 * Smart prompt compaction strategies
 */
const compactionStrategies = {
  /**
   * Truncate file content to relevant sections
   * Keeps imports, target area, and exports
   */
  truncateFileContent(content, maxLines = 200) {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;

    const imports = [];
    const exports = [];
    const middle = [];
    let inImports = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inImports && (line.startsWith('import ') || line.startsWith('from ') || line.trim() === '')) {
        imports.push(line);
      } else {
        inImports = false;
        if (line.startsWith('export ') && i > lines.length - 50) {
          exports.push(line);
        } else {
          middle.push(line);
        }
      }
    }

    // Keep imports + first/last portions of middle + exports
    const keepFromMiddle = maxLines - imports.length - exports.length;
    const halfKeep = Math.floor(keepFromMiddle / 2);

    const truncatedMiddle = [
      ...middle.slice(0, halfKeep),
      '',
      `// ... ${middle.length - keepFromMiddle} lines truncated for context ...`,
      '',
      ...middle.slice(-halfKeep)
    ];

    return [...imports, ...truncatedMiddle, ...exports].join('\n');
  },

  /**
   * Remove previous errors from retry prompt, keep only the latest
   */
  trimRetryErrors(prompt) {
    const errorSections = prompt.split('## PREVIOUS ERROR');
    if (errorSections.length <= 2) return prompt;

    // Keep base prompt + only the latest error
    return errorSections[0] + '## PREVIOUS ERROR' + errorSections[errorSections.length - 1];
  },

  /**
   * Remove verbose template sections
   */
  trimTemplateVerbosity(prompt) {
    // Remove example sections if prompt is too long
    let trimmed = prompt.replace(/## Examples[\s\S]*?(?=##|$)/gi, '');
    // Remove detailed explanations
    trimmed = trimmed.replace(/\*\*Note:\*\*[\s\S]*?(?=\n\n|$)/gi, '');
    return trimmed;
  },

  /**
   * Truncate search results array to prevent context overflow
   * @param {Array} results - Array of search results with optional content
   * @param {number} maxResults - Maximum number of results to keep
   * @param {number} maxLinesPerResult - Maximum lines per result content
   */
  truncateSearchResults(results, maxResults = 10, maxLinesPerResult = 30) {
    if (!Array.isArray(results)) return results;

    const truncated = results.slice(0, maxResults).map(r => {
      // If result has content, truncate it
      if (r.content && typeof r.content === 'string') {
        const lines = r.content.split('\n');
        if (lines.length > maxLinesPerResult) {
          return {
            ...r,
            content: [
              ...lines.slice(0, maxLinesPerResult),
              `... ${lines.length - maxLinesPerResult} more lines truncated ...`
            ].join('\n')
          };
        }
      }
      return r;
    });

    // Add truncation notice if we cut results
    if (results.length > maxResults) {
      truncated.push({
        _notice: true,
        message: `... and ${results.length - maxResults} more results (truncated to save context)`
      });
    }

    return truncated;
  }
};

/**
 * Auto-compacts a prompt to fit within context window.
 * Returns { prompt, wasCompacted, originalTokens, finalTokens }
 */
function autoCompactPrompt(prompt, contextWindow, reserveForOutput = 2048) {
  // Sanity check: never reserve more than 50% of context window
  // This prevents the bug where maxTokens == contextWindow causing availableTokens = 0
  const maxReserve = Math.floor(contextWindow / 2);
  if (reserveForOutput > maxReserve) {
    log('dim', `   📊 Capping output reserve from ${reserveForOutput} to ${maxReserve} tokens`);
    reserveForOutput = maxReserve;
  }

  const availableTokens = contextWindow - reserveForOutput;

  // Another sanity check: ensure we have at least 1024 tokens for the prompt
  if (availableTokens < 1024) {
    log('yellow', `   ⚠️ Warning: Very low available tokens (${availableTokens}). Context: ${contextWindow}, Reserve: ${reserveForOutput}`);
  }

  const originalTokens = estimateTokens(prompt);

  if (originalTokens <= availableTokens) {
    return {
      prompt,
      wasCompacted: false,
      originalTokens,
      finalTokens: originalTokens,
      usage: getContextUsage(originalTokens, contextWindow)
    };
  }

  log('yellow', `   ⚠️ Prompt too large (${originalTokens.toLocaleString()} tokens), compacting...`);

  let compacted = prompt;

  // Strategy 1: Trim retry errors
  compacted = compactionStrategies.trimRetryErrors(compacted);
  let tokens = estimateTokens(compacted);
  if (tokens <= availableTokens) {
    log('dim', `   📦 Trimmed retry errors: ${tokens.toLocaleString()} tokens`);
    return { prompt: compacted, wasCompacted: true, originalTokens, finalTokens: tokens, usage: getContextUsage(tokens, contextWindow) };
  }

  // Strategy 2: Trim template verbosity
  compacted = compactionStrategies.trimTemplateVerbosity(compacted);
  tokens = estimateTokens(compacted);
  if (tokens <= availableTokens) {
    log('dim', `   📦 Trimmed template verbosity: ${tokens.toLocaleString()} tokens`);
    return { prompt: compacted, wasCompacted: true, originalTokens, finalTokens: tokens, usage: getContextUsage(tokens, contextWindow) };
  }

  // Strategy 3: Truncate file content in the prompt
  // Find content between ``` markers and truncate
  const codeBlockRegex = /```[\s\S]*?```/g;
  compacted = compacted.replace(codeBlockRegex, (match) => {
    const content = match.slice(3, -3); // Remove ``` markers
    if (content.split('\n').length > 100) {
      const truncated = compactionStrategies.truncateFileContent(content, 100);
      return '```' + truncated + '```';
    }
    return match;
  });

  // Also check for {{currentContent}} style blocks
  const currentContentMatch = compacted.match(/{{currentContent}}[\s\S]*?(?=##|$)/);
  if (currentContentMatch && currentContentMatch[0].length > 5000) {
    const lines = currentContentMatch[0].split('\n');
    const truncated = compactionStrategies.truncateFileContent(lines.slice(1).join('\n'), 150);
    compacted = compacted.replace(currentContentMatch[0], '{{currentContent}}\n' + truncated + '\n\n');
  }

  tokens = estimateTokens(compacted);
  log('dim', `   📦 Truncated file content: ${tokens.toLocaleString()} tokens`);

  // If still too large, do aggressive truncation
  if (tokens > availableTokens) {
    const ratio = availableTokens / tokens;
    const targetLength = Math.floor(compacted.length * ratio * 0.9); // 10% safety margin
    compacted = compacted.slice(0, targetLength) + '\n\n[Content truncated to fit context window]';
    tokens = estimateTokens(compacted);
    log('yellow', `   ⚠️ Aggressive truncation: ${tokens.toLocaleString()} tokens`);
  }

  return {
    prompt: compacted,
    wasCompacted: true,
    originalTokens,
    finalTokens: tokens,
    usage: getContextUsage(tokens, contextWindow)
  };
}

// TemplateEngine extracted to ./flow-orchestrate-templates.js
// Validator extracted to ./flow-orchestrate-validator.js
// RollbackManager extracted to ./flow-orchestrate-rollback.js
// StateManager extracted to ./flow-orchestrate-state.js

// ============================================================
// Orchestrator
// ============================================================

class Orchestrator {
  constructor() {
    this.config = loadHybridConfig();
    // Use factory to create appropriate executor (local or cloud)
    this.llm = createExecutor(this.config);
    this.templates = new TemplateEngine(TEMPLATES_DIR);
    this.rollback = new RollbackManager();
    this.state = new StateManager();
    this.completedSteps = new Set();

    // Project context generator - generates once, reuses for all steps
    this.contextGenerator = new ProjectContextGenerator(PATHS.root);
    this.projectContext = null;

    // Complexity assessment for the current plan
    this.planComplexity = null;

    // Instruction richness settings (set per-plan based on complexity)
    this.instructionRichness = null;
  }

  /**
   * Ensures project context is loaded (from cache or generated)
   * Called once before executing any steps - local LLM tokens are FREE
   */
  async ensureProjectContext() {
    const { context, fromCache } = this.contextGenerator.getOrGenerateContext();
    this.projectContext = context;

    if (fromCache) {
      log('dim', '📋 Using cached project context');
    } else {
      log('green', '✅ Generated and cached project context');
    }

    const contextTokens = estimateTokens(context);
    log('dim', `   Context size: ~${contextTokens.toLocaleString()} tokens (prepended to each step - FREE)`);
  }

  async executePlan(plan) {
    const results = {
      planId: plan.planId,
      task: plan.task,
      success: true,
      startedAt: new Date().toISOString(),
      steps: [],
      failedSteps: [],
      escalateToCloud: [],
      tokensSaved: plan.estimatedTokensSaved || 0
    };

    // Assess task complexity for token estimation
    const tokenSettings = getTokenEstimationSettings();
    if (tokenSettings.enabled) {
      this.planComplexity = assessTaskComplexity({
        title: plan.task,
        description: plan.description || plan.task,
        // Include step info in complexity assessment
        technicalNotes: plan.steps?.map(s => s.title || s.type).join(', ')
      });

      // Display complexity assessment
      displayComplexityAssessment(this.planComplexity);

      // Warn if task might be too complex for hybrid mode
      if (this.planComplexity.level === 'xl') {
        log('yellow', '   ⚠️ This task is very complex. Consider breaking into smaller tasks.');
        log('yellow', '      Proceeding with maximum token budget...\n');
      }
    } else {
      log('dim', '   Token estimation disabled, using default budget');
      this.planComplexity = {
        level: tokenSettings.defaultLevel,
        estimatedTokens: getDefaultTokens(tokenSettings.defaultLevel),
        reasoning: 'Token estimation disabled'
      };
    }

    // Get instruction richness based on complexity
    this.instructionRichness = getInstructionRichness(
      this.planComplexity.level,
      this.config.instructionRichness || {}
    );

    // Set richness on template engine for context-aware rendering
    this.templates.setRichness(this.instructionRichness);

    // Display richness settings
    displayInstructionRichness(this.instructionRichness);

    // Generate project context ONCE before executing any steps
    // This context is prepended to each step's prompt (local LLM tokens are FREE)
    await this.ensureProjectContext();

    this.state.updateHybridSession({
      currentPlan: plan.planId,
      pendingSteps: plan.steps.map(s => s.id)
    });

    log('cyan', '\n' + '═'.repeat(60));
    log('cyan', '                    EXECUTING PLAN');
    log('cyan', '═'.repeat(60));
    log('white', `\nTask: ${plan.task}`);
    log('white', `Steps: ${plan.steps.length}`);
    // Show executor type (local or cloud)
    const executorLabel = this.config.executorType === 'cloud'
      ? `☁️  ${this.config.provider} / ${this.config.model}`
      : `🖥️  ${this.config.provider} / ${this.config.model}`;
    log('white', `Executor: ${executorLabel}`);
    log('dim', `Token Budget: ${this.planComplexity.estimatedTokens.toLocaleString()} (${this.planComplexity.level})\n`);

    const steps = plan.steps;

    while (this.completedSteps.size < steps.length) {
      const readySteps = steps.filter(step => {
        if (this.completedSteps.has(step.id)) return false;
        if (results.failedSteps.includes(step.id)) return false;

        const deps = step.dependsOn || [];
        return deps.every(d => this.completedSteps.has(d));
      });

      if (readySteps.length === 0) {
        if (this.completedSteps.size + results.failedSteps.length < steps.length) {
          log('red', '\n⚠️ Some steps cannot be executed due to failed dependencies');
          results.success = false;
        }
        break;
      }

      const parallelSteps = readySteps.filter(s => s.canParallelize !== false);
      const sequentialSteps = readySteps.filter(s => s.canParallelize === false);

      // Execute parallel steps (includes single step case - Promise.all works fine)
      if (parallelSteps.length >= 1) {
        if (parallelSteps.length > 1) {
          log('cyan', `\n⚡ Executing ${parallelSteps.length} steps in parallel...\n`);
        }

        const parallelResults = await Promise.all(
          parallelSteps.map(step => this.executeStep(step, plan.context))
        );

        for (let i = 0; i < parallelResults.length; i++) {
          const stepResult = parallelResults[i];
          const step = parallelSteps[i];

          results.steps.push(stepResult);

          if (stepResult.success) {
            this.completedSteps.add(step.id);
          } else {
            results.failedSteps.push(step.id);
            if (stepResult.escalate) {
              results.escalateToCloud.push(step);
            }
            results.success = false;
          }
        }
      }

      for (const step of sequentialSteps) {
        const stepResult = await this.executeStep(step, plan.context);
        results.steps.push(stepResult);

        if (stepResult.success) {
          this.completedSteps.add(step.id);
        } else {
          results.failedSteps.push(step.id);
          if (stepResult.escalate) {
            results.escalateToCloud.push(step);
          }
          results.success = false;
          break;
        }
      }
    }

    results.completedAt = new Date().toISOString();

    this.state.updateHybridSession({
      executedSteps: Array.from(this.completedSteps),
      failedSteps: results.failedSteps,
      pendingSteps: [],
      totalTokensSaved: results.tokensSaved
    });

    this.state.saveResults(results);

    // Log metrics for accuracy tracking
    logTokenMetrics(plan, results, this.planComplexity);

    if (results.success) {
      this.rollback.clearCheckpoint();
    }

    return results;
  }

  async executeStep(step, context) {
    const result = {
      stepId: step.id,
      title: step.title,
      success: false,
      attempts: 0,
      errors: [],
      escalate: false
    };

    log('white', '\n' + '─'.repeat(60));
    log('cyan', `📋 Step ${step.id}: ${step.title}`);
    log('dim', `   Type: ${step.type}`);
    if (step.params?.path) {
      log('dim', `   Path: ${step.params.path}`);
    }

    // v2.1: Classify task type and load model profile
    const taskDescription = step.description || step.title || '';
    const affectedFiles = step.params?.path ? [step.params.path] : [];
    const taskClassification = classifyTask(taskDescription, affectedFiles);
    const taskType = taskClassification.type;

    log('dim', `   Task type: ${taskType} (${taskClassification.confidence} confidence)`);

    // Load model profile for intelligent context loading
    const modelProfile = getModelProfile(this.config.model, taskType);
    const profileRichness = getProfileBasedRichness(this.config.model, taskType, this.config.maxTokens ?? 8192);

    // Store for use during retries
    result.taskType = taskType;
    result.modelProfile = modelProfile;
    result.profileRichness = profileRichness;

    const templateName = step.template || step.type;

    // Load project-specific context from app-map and config
    const projectContext = this.state.loadProjectContext();

    let params = { ...step.params, ...context, ...projectContext };

    if (step.type === 'modify-file' && step.params?.path) {
      const filePath = step.params.path;
      if (fs.existsSync(filePath)) {
        params.currentContent = fs.readFileSync(filePath, 'utf-8');
        this.rollback.trackModification(filePath);
      }
    }

    let prompt;
    try {
      prompt = this.templates.render(templateName, params);
    } catch (err) {
      result.errors.push(`Template error: ${err.message}`);
      log('red', `   ❌ Template error: ${err.message}`);
      return result;
    }

    // INJECT ACTIVE PATTERNS from decisions.md, app-map.md, and skills
    // This ensures learned patterns are prominently displayed and enforced
    const taskContext = {
      description: step.description || params.task || '',
      file: step.params?.path || step.file || '',
      action: step.action || templateName
    };
    prompt = injectPatterns(prompt, taskContext, PATHS.root);

    // PREPEND PROJECT CONTEXT - Local LLM tokens are FREE
    // This gives the LLM comprehensive knowledge about types, theme, patterns
    if (this.projectContext) {
      prompt = this.projectContext + '\n\n---\n\n# Step Instructions\n\n' + prompt;
    }

    // Add model-specific guidance (weaknesses to avoid, patterns that work)
    const modelAdjustments = getPromptAdjustments(this.config.model);
    if (modelAdjustments.guidance) {
      prompt = `## Model-Specific Guidance\n\n${modelAdjustments.guidance}\n\n---\n\n${prompt}`;
    }

    // Show initial context info
    const initialTokens = estimateTokens(prompt);
    log('dim', `   Prompt size: ~${initialTokens.toLocaleString()} tokens (includes project context - FREE)`);

    // ADAPTIVE LEARNING: Save original prompt for refinement during retries
    const originalPrompt = prompt;

    // Smart retry tracking - detect stuck loops and progress
    const errorHistory = [];
    const errorSignatures = new Map(); // Track how many times we see each error pattern
    let consecutiveSameError = 0;
    let lastErrorSignature = null;

    /**
     * Extract a signature from an error message for comparison
     * Normalizes variable parts (line numbers, specific values) to detect same error type
     */
    const getErrorSignature = (errorMsg) => {
      if (!errorMsg) return 'unknown';
      return errorMsg
        .replace(/line \d+/gi, 'line N')
        .replace(/:\d+:\d+/g, ':N:N')
        .replace(/'[^']+'/g, "'X'")
        .replace(/"[^"]+"/g, '"X"')
        .replace(/\d+/g, 'N')
        .substring(0, 100);
    };

    /**
     * Categorize error type for targeted fix strategies
     */
    const categorizeError = (errorMsg) => {
      if (!errorMsg) return 'unknown';
      const msg = errorMsg.toLowerCase();
      if (msg.includes('cannot find module') || msg.includes('import')) return 'import';
      if (msg.includes('type') && (msg.includes('not assignable') || msg.includes('missing'))) return 'type';
      if (msg.includes('syntax') || msg.includes('unexpected token')) return 'syntax';
      if (msg.includes('eslint') || msg.includes('prettier')) return 'lint';
      if (msg.includes('semantic') || msg.includes('confidence')) return 'semantic';
      return 'other';
    };

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      result.attempts = attempt + 1;

      // Initialize cleanOutput for this iteration (will be set after LLM generation)
      let cleanOutput = '';

      // Smart retry: Check if we're stuck in a loop
      if (consecutiveSameError >= 3) {
        log('red', `   ⚠️ Same error repeated ${consecutiveSameError} times - escalating`);
        result.errors.push(`Stuck on error: ${lastErrorSignature}`);
        result.escalate = true;
        break;
      }

      // Smart retry: If we've seen 5+ different errors, we might be thrashing
      if (errorHistory.length >= 5 && new Set(errorHistory.map(e => e.category)).size >= 4) {
        log('yellow', `   ⚠️ Multiple error types encountered - may need different approach`);
      }

      log('dim', `   Attempt ${attempt + 1}/${this.config.maxRetries + 1}...`);

      try {
        // Auto-compact prompt if needed
        // Use config override, or LLM's detected context window, or conservative fallback
        const contextWindow = this.config.contextWindow ?? this.llm.contextWindow ?? 4096;
        // Reserve configurable % of context for output, with configurable max
        const reserveRatio = this.config.outputReserveRatio ?? 0.3;
        const reserveMax = this.config.outputReserveMax ?? 4096;
        const reserveForOutput = Math.min(reserveMax, Math.floor(contextWindow * reserveRatio));
        const { prompt: compactedPrompt, wasCompacted, usage } = autoCompactPrompt(
          prompt,
          contextWindow,
          reserveForOutput
        );

        if (wasCompacted) {
          prompt = compactedPrompt;
        }

        // Log context usage
        if (usage > 80) {
          log('yellow', `   ⚠️ Context usage: ${usage}%`);
        } else if (process.env.DEBUG_HYBRID) {
          log('dim', `   Context usage: ${usage}%`);
        }

        const startTime = Date.now();
        const output = await this.llm.generate(prompt);
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        log('dim', `   Generated in ${duration}s`);

        cleanOutput = this.cleanOutput(output);

        const outputPath = step.params?.path;

        // Auto-correct common LLM mistakes (React imports, paths, etc.)
        const { corrected: autoFixed } = autoCorrectCode(cleanOutput, outputPath);
        cleanOutput = autoFixed;

        // CRITICAL: Validate code BEFORE writing to prevent file corruption
        const codeValidation = isValidCode(cleanOutput);
        if (!codeValidation.valid) {
          log('red', `   ❌ Invalid code output: ${codeValidation.reason}`);
          result.errors.push(`Invalid code: ${codeValidation.reason}`);

          // Add error context for retry
          prompt += `\n\n## PREVIOUS ERROR\n\nYour output was not valid code. ${codeValidation.reason}\n\nOutput ONLY valid TypeScript/JavaScript code. No explanations, no markdown, no thinking.`;
          continue; // Skip file write, retry
        }

        // Semantic validation: check if output matches what was requested
        const semanticValidation = validateOutputMatchesTask(cleanOutput, step);
        if (!semanticValidation.valid) {
          log('yellow', `   ⚠️ Semantic mismatch (confidence: ${semanticValidation.confidence}%): ${semanticValidation.reason}`);

          // If confidence is very low, treat as error and retry
          if (semanticValidation.confidence < 30) {
            log('red', `   ❌ Output doesn't match task - retrying with clarification`);
            result.errors.push(`Semantic mismatch: ${semanticValidation.reason}`);

            // Add clarification for retry
            const expectedName = step.params?.name || path.basename(step.params?.path || '', path.extname(step.params?.path || ''));
            prompt += `\n\n## PREVIOUS ERROR - WRONG OUTPUT\n\nYour output did not match the task. ${semanticValidation.reason}\n\n**CRITICAL**: You must create "${expectedName}", not something else.\nLook at the "YOUR TASK" section and implement EXACTLY what is requested.`;
            continue; // Retry with clarification
          }

          // Medium confidence - warn but proceed
          log('dim', `   Proceeding despite semantic concerns`);
        }

        // Import validation: check against available components from config
        const importValidation = validateImports(cleanOutput);
        if (!importValidation.valid) {
          log('red', `   ❌ Import errors: ${importValidation.errors.join(', ')}`);
          result.errors.push(`Import errors: ${importValidation.errors.join('; ')}`);

          // Add hint to prompt for retry
          prompt += `\n\n## PREVIOUS ERROR - IMPORT ISSUES\n\nYour code has invalid imports:\n${importValidation.errors.map(e => `- ${e}`).join('\n')}\n\nCheck the "Available Components" section and use ONLY those exact imports.\nDO NOT guess import paths or exports.`;
          continue; // Retry with corrected hints
        }

        // Log warnings but don't fail
        if (importValidation.warnings.length > 0) {
          for (const warning of importValidation.warnings) {
            log('yellow', `   ⚠️ ${warning}`);
          }
        }

        if (outputPath) {
          const dir = path.dirname(outputPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const isNew = !fs.existsSync(outputPath);

          // For modify-file, do a sanity check: new content shouldn't be drastically smaller
          if (!isNew && step.type === 'modify-file') {
            const existingContent = fs.readFileSync(outputPath, 'utf-8');
            const sizeRatio = cleanOutput.length / existingContent.length;
            if (sizeRatio < 0.3 && existingContent.length > 100) {
              log('red', `   ❌ Output suspiciously small (${Math.round(sizeRatio * 100)}% of original)`);
              result.errors.push('Output file size too small - likely incomplete');
              prompt += `\n\n## PREVIOUS ERROR\n\nYour output was only ${Math.round(sizeRatio * 100)}% the size of the original file. You must output the COMPLETE file, not a partial snippet.`;
              continue; // Skip write, retry
            }
          }

          fs.writeFileSync(outputPath, cleanOutput);

          if (isNew) {
            this.rollback.trackCreation(outputPath);
          }
        }

        const checks = step.validation?.checks || ['file-exists', 'typescript-check'];
        const validationResults = Validator.runChecks(checks, outputPath);

        const allPassed = validationResults.every(r => r.success);

        if (allPassed) {
          result.success = true;

          this.state.updateRequestLog(step, 'completed', 'hybrid', this.config.model);

          if (step.stateUpdates?.appMap) {
            this.state.updateAppMap(step.stateUpdates.appMap);
          }

          // Record success for model learning
          recordModelResult(this.config.model, {
            taskType: step.action || 'unknown',
            success: true
          });

          // v2.1: Update model profile with success
          try {
            updateModelProfile(this.config.model, {
              taskType: result.taskType || taskType,
              success: true
            });
          } catch (profileErr) {
            // Non-critical, continue
          }

          // ADAPTIVE LEARNING: If we had failures before success, record what we learned
          if (errorHistory.length > 0) {
            // Use cached failure analyses from errorHistory (already analyzed during retry loop)
            const adaptiveFailures = errorHistory
              .map(e => e.analysis)
              .filter(Boolean);

            if (adaptiveFailures.length > 0) {
              recordSuccessfulRecovery(this.config.model, adaptiveFailures, {
                taskId: step.id || step.description,
                attemptsTaken: result.attempts,
                taskType: step.action
              });
            }
          }

          log('green', `   ✅ Step completed`);
          return result;
        } else {
          const failedCheck = validationResults.find(r => !r.success);
          result.errors.push(failedCheck.message);
          log('yellow', `   ⚠️ Validation failed: ${failedCheck.check}`);
          log('dim', `      ${failedCheck.message.slice(0, 100)}`);

          // Smart retry: Track this error
          const errorSig = getErrorSignature(failedCheck.message);
          const errorCat = categorizeError(failedCheck.message);
          errorHistory.push({ message: failedCheck.message, signature: errorSig, category: errorCat });

          if (errorSig === lastErrorSignature) {
            consecutiveSameError++;
            log('dim', `   (Same error ${consecutiveSameError}x)`);
          } else {
            consecutiveSameError = 1;
            lastErrorSignature = errorSig;
            // Progress! Different error means we fixed something
            if (errorHistory.length > 1) {
              log('dim', `   (Different error - making progress)`);
            }
          }

          // ADAPTIVE LEARNING: Use smart prompt refinement based on failure analysis
          const failureAnalysis = analyzeFailure(failedCheck.message, null, {
            taskType: step.action,
            targetFile: step.params?.path
          });

          // Store analysis in errorHistory for later use (avoid duplicate analysis)
          errorHistory[errorHistory.length - 1].analysis = failureAnalysis;

          // v2.1: Enhanced failure learning - ask executor what was missing
          try {
            const failureLearning = await learnFromFailure(
              this.config.model,
              result.taskType || taskType,
              cleanOutput || '',
              failedCheck.message,
              {
                executor: this.executor,
                taskDescription: taskDescription,
                prompt: originalPrompt
              }
            );

            // If we got enhanced prompt suggestions, use them
            if (failureLearning.enhancedPrompt && result.attempts < this.config.maxRetries - 1) {
              prompt = failureLearning.enhancedPrompt;
              log('dim', `   📚 Applied learning from failure: ${failureLearning.learning?.category || 'unknown'}`);
              continue; // Skip default refinement, use learning-based enhancement
            }
          } catch (learnErr) {
            // Non-critical, fall back to standard refinement
          }

          // Use cached analyses from previous errors
          const previousFailures = errorHistory.slice(0, -1)
            .map(e => e.analysis)
            .filter(Boolean);

          const refined = refinePromptForRetry(originalPrompt, failureAnalysis, previousFailures);
          prompt = refined.prompt;
          log('dim', `   📝 Applying ${refined.strategy} refinement strategy`);
        }
      } catch (err) {
        result.errors.push(err.message);
        log('red', `   ❌ Error: ${err.message}`);

        // Smart retry: Track catch errors too
        const errorSig = getErrorSignature(err.message);
        const errorCat = categorizeError(err.message);
        errorHistory.push({ message: err.message, signature: errorSig, category: errorCat });

        if (errorSig === lastErrorSignature) {
          consecutiveSameError++;
        } else {
          consecutiveSameError = 1;
          lastErrorSignature = errorSig;
        }
      }
    }

    result.escalate = true;
    this.state.updateRequestLog(step, 'failed - needs escalation', 'hybrid', this.config.model);
    log('red', `   ❌ Step failed after ${result.attempts} attempts`);
    if (errorHistory.length > 0) {
      const errorTypes = [...new Set(errorHistory.map(e => e.category))];
      log('dim', `   Error types encountered: ${errorTypes.join(', ')}`);
    }
    log('yellow', `   ⬆️ Flagged for escalation to Claude`);

    // Record failure for model learning
    recordModelResult(this.config.model, {
      taskType: step.action || 'unknown',
      success: false,
      errorType: errorHistory[0]?.category || 'unknown',
      errorContext: errorHistory[0]?.message?.slice(0, 200) || null
    });

    // Save structured failure info for retry context
    saveStructuredFailure(step, errorHistory, result.attempts, this.config);

    return result;
  }

  cleanOutput(output, error = null) {
    // Use the comprehensive extraction function first
    let extracted = extractCodeFromResponse(output, this.config.model);

    // If there was an error and extraction didn't help much, try response parser
    if (error && extracted && extracted.length < 20) {
      const parsed = parseOnRetry(output, error);
      if (parsed.shouldRetry && parsed.content) {
        log('dim', '   Using response parser fallback');
        extracted = cleanCodeBlock(parsed.content);
      }
    }

    return extracted;
  }

  printSummary(results) {
    log('white', '\n' + '═'.repeat(60));
    log('cyan', '                    EXECUTION SUMMARY');
    log('white', '═'.repeat(60));

    const successCount = results.steps.filter(s => s.success).length;
    const totalCount = results.steps.length;

    if (results.success) {
      log('green', `\n✅ Plan executed successfully!`);
    } else {
      log('red', `\n❌ Plan execution failed`);
    }

    log('white', `\nSteps completed: ${successCount}/${totalCount}`);
    log('white', `Tokens saved: ~${results.tokensSaved.toLocaleString()}`);

    if (results.escalateToCloud.length > 0) {
      log('yellow', `\n⚠️ Steps requiring Claude escalation:`);
      for (const step of results.escalateToCloud) {
        log('yellow', `   • Step ${step.id}: ${step.title}`);
      }
    }

    log('dim', `\nResults saved to: .workflow/state/hybrid-results.json`);
    log('white', '');
  }
}

// ============================================================
// Main CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow Hybrid Orchestrator

Usage:
  flow-orchestrate <plan.json>    Execute a plan file
  flow-orchestrate --rollback     Rollback last execution
  flow-orchestrate --help         Show this help

Examples:
  ./scripts/flow-orchestrate /tmp/plan.json
  ./scripts/flow-orchestrate --rollback
    `);
    process.exit(0);
  }

  if (args.includes('--rollback')) {
    const rollback = new RollbackManager();
    if (rollback.loadCheckpoint()) {
      rollback.rollback();
    } else {
      log('yellow', 'No rollback checkpoint found.');
    }
    process.exit(0);
  }

  const planPath = args[0];
  if (!planPath) {
    console.error('Usage: flow-orchestrate <plan.json>');
    process.exit(1);
  }

  if (!fs.existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}`);
    process.exit(1);
  }

  const plan = readJson(planPath, null);
  if (!plan) {
    console.error(`Failed to parse plan file: ${planPath}`);
    process.exit(1);
  }

  try {
    const orchestrator = new Orchestrator();
    const results = await orchestrator.executePlan(plan);
    orchestrator.printSummary(results);

    process.exit(results.success ? 0 : 1);
  } catch (err) {
    log('red', `\n❌ Orchestrator error: ${err.message}`);
    process.exit(1);
  }
}

// Test-only exports — not part of public API
// Must be here (after function declarations) to avoid TDZ errors
if (process.env.NODE_ENV === 'test') {
  module.exports._test = {
    autoCompactPrompt,
    getContextUsage,
    compactionStrategies
  };
} else {
  main().catch(err => {
    error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
