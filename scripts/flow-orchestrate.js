#!/usr/bin/env node

/**
 * Wogi Flow - Hybrid Mode Orchestrator
 *
 * Executes plans created by Claude using a local LLM.
 * Updates all Wogi Flow state files after each step.
 *
 * LIMITATION: The --resume flag is documented but not yet implemented.
 * Checkpoint data is saved but recovery logic needs completion.
 * TODO: Implement resume from checkpoint functionality.
 *
 * Usage:
 *   flow-orchestrate <plan.json>              # Execute a plan
 *   flow-orchestrate --resume                 # Resume from checkpoint (NOT YET IMPLEMENTED)
 *   flow-orchestrate --rollback               # Rollback last execution
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync, spawn } = require('child_process');
const readline = require('readline');
const { validatePathWithinProject } = require('./flow-security');

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
const { getProjectRoot, colors, getConfig, writeJson } = require('./flow-utils');
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

const PROJECT_ROOT = getProjectRoot();

// Set export scanner project root to match orchestrator's
setExportScannerRoot(PROJECT_ROOT);
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const STATE_DIR = path.join(WORKFLOW_DIR, 'state');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates', 'hybrid');

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
  const failurePath = path.join(STATE_DIR, 'last-failure.json');

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
    errorCounts[e.category] = (errorCounts[e.category] || 0) + 1;
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
  const hybrid = config.hybrid || {};

  if (!hybrid.enabled) {
    throw new Error('Hybrid mode is not enabled. Run /wogi-hybrid first.');
  }

  // Use getExecutorConfig to normalize legacy vs new config format
  const executorConfig = getExecutorConfig(hybrid);
  const isLocal = executorConfig.type !== 'cloud';

  // Context window: config override > executor config > auto-detect later
  const contextWindow = hybrid.executor?.contextWindow ||
                        hybrid.settings?.contextWindow ||
                        executorConfig.contextWindow ||
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
    instructionRichness: hybrid.settings?.instructionRichness || {},

    // Cloud provider reference (for model selection in setup wizard)
    cloudProviders: hybrid.cloudProviders || config.hybrid?.cloudProviders || {}
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
    return config.hybrid?.projectContext || {};
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
  const ctx = projectConfig?.projectContext || getProjectContext();

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
  const componentPaths = ctx.componentPaths || {};

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
function detectUIFramework(projectRoot = PROJECT_ROOT) {
  try {
    const pkgJsonPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      return 'react';
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
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
function scanComponentPaths(projectRoot = PROJECT_ROOT, componentDirs = ['src/components']) {
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
function generateProjectContext(projectRoot = PROJECT_ROOT) {
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

// ============================================================
// Project Context Generator - Claude creates once, Local LLM reuses
// ============================================================

/**
 * Generates and caches a comprehensive project context document.
 * This context is generated once (expensive) and reused for all steps (free).
 *
 * The context includes:
 * - Type definitions from the project
 * - Theme structure and correct access paths
 * - Component patterns from existing code
 * - Available components list
 * - Critical rules and conventions
 */
class ProjectContextGenerator {
  constructor(projectRoot = PROJECT_ROOT) {
    this.projectRoot = projectRoot;
    this.contextPath = path.join(projectRoot, '.workflow/state/hybrid-context.md');
    this.cacheMaxAge = 60 * 60 * 1000; // 1 hour

    // Load config for project-specific settings
    this.config = this.loadProjectConfig();

    // Export map (loaded lazily)
    this._exportMap = null;
  }

  /**
   * Get or build the export map (with caching)
   */
  getExportMap() {
    if (this._exportMap) return this._exportMap;

    // Try cached first
    this._exportMap = loadCachedExportMap();
    if (this._exportMap) return this._exportMap;

    // Build fresh export map
    const fullConfig = { hybrid: { projectContext: this.config } };
    this._exportMap = buildExportMap(fullConfig);
    saveExportMapCache(this._exportMap);

    return this._exportMap;
  }

  /**
   * Load project-specific settings from config.json
   */
  loadProjectConfig() {
    try {
      const config = getConfig();
      return config.hybrid?.projectContext || {};
    } catch {
      return {};
    }
  }

  /**
   * Check if we have a valid cached context (less than 1 hour old)
   */
  hasValidCache() {
    try {
      if (!fs.existsSync(this.contextPath)) return false;
      const stats = fs.statSync(this.contextPath);
      const ageMs = Date.now() - stats.mtimeMs;
      return ageMs < this.cacheMaxAge;
    } catch {
      return false;
    }
  }

  /**
   * Get cached context or null
   */
  getCachedContext() {
    if (!this.hasValidCache()) return null;
    try {
      return fs.readFileSync(this.contextPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Save generated context to cache
   */
  saveContext(context) {
    try {
      const dir = path.dirname(this.contextPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.contextPath, context);
    } catch (err) {
      log('yellow', `   ⚠️ Could not cache context: ${err.message}`);
    }
  }

  /**
   * Simple glob implementation using fs
   */
  globSync(pattern) {
    const results = [];
    const basePath = this.projectRoot;

    const parts = pattern.split('/');
    const searchDir = (currentPath, remainingParts) => {
      if (remainingParts.length === 0) {
        if (fs.existsSync(currentPath)) results.push(currentPath);
        return;
      }

      const [current, ...rest] = remainingParts;

      if (current === '*' || current === '**') {
        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              searchDir(path.join(currentPath, entry.name), rest);
              if (current === '**') {
                searchDir(path.join(currentPath, entry.name), remainingParts);
              }
            } else if (rest.length === 0) {
              results.push(path.join(currentPath, entry.name));
            }
          }
        } catch {}
      } else if (current.includes('*')) {
        try {
          const regex = new RegExp('^' + current.replace(/\*/g, '.*') + '$');
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (regex.test(entry.name)) {
              if (entry.isDirectory()) {
                searchDir(path.join(currentPath, entry.name), rest);
              } else if (rest.length === 0) {
                results.push(path.join(currentPath, entry.name));
              }
            }
          }
        } catch {}
      } else {
        const nextPath = path.join(currentPath, current);
        if (fs.existsSync(nextPath)) {
          searchDir(nextPath, rest);
        }
      }
    };

    searchDir(basePath, parts);
    return results.map(p => path.relative(basePath, p));
  }

  /**
   * Read file with line limit
   */
  readFile(filePath, maxLines = 100) {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
      if (!fs.existsSync(fullPath)) return null;
      const content = fs.readFileSync(fullPath, 'utf-8');
      return content.split('\n').slice(0, maxLines).join('\n');
    } catch {
      return null;
    }
  }

  /**
   * Check if a path should be excluded based on config
   */
  shouldExcludePath(filePath) {
    const excludeDirs = this.config.excludeDirectories || ['__tests__', '__mocks__', 'node_modules', '.git'];
    return excludeDirs.some(dir => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`));
  }

  /**
   * Check if a type definition should be excluded based on config patterns
   */
  shouldExcludeType(typeName) {
    const excludePatterns = this.config.excludeTypePatterns || [];
    if (excludePatterns.length === 0) return false;

    return excludePatterns.some(pattern => {
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(typeName);
      } catch {
        return typeName.toLowerCase().includes(pattern.toLowerCase());
      }
    });
  }

  /**
   * Filter type content to exclude irrelevant types
   */
  filterTypesContent(content, filePath) {
    if (this.shouldExcludePath(filePath)) return null;

    const lines = content.split('\n');
    const filtered = [];
    let skipBlock = false;
    let braceCount = 0;

    for (const line of lines) {
      // Check if this line starts a type we want to exclude
      const typeMatch = line.match(/(?:export\s+)?(?:interface|type)\s+(\w+)/);
      if (typeMatch && this.shouldExcludeType(typeMatch[1])) {
        skipBlock = true;
        braceCount = 0;
      }

      if (skipBlock) {
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;
        if (braceCount <= 0 && line.includes('}')) {
          skipBlock = false;
        }
        continue;
      }

      filtered.push(line);
    }

    const result = filtered.join('\n').trim();
    return result.length > 10 ? result : null;
  }

  /**
   * Scan a directory for components and their exports
   */
  scanComponentExports(componentDir) {
    const components = {};
    const fullDir = path.join(this.projectRoot, componentDir);

    if (!fs.existsSync(fullDir)) return components;

    try {
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const compPath = path.join(fullDir, entry.name);
        const indexPath = path.join(compPath, 'index.ts');
        const indexTsxPath = path.join(compPath, 'index.tsx');
        const mainFile = path.join(compPath, `${entry.name}.tsx`);

        let exports = [];
        let importPath = `@/components/${entry.name}`;

        // Try to find exports from index file
        for (const indexFile of [indexPath, indexTsxPath]) {
          if (fs.existsSync(indexFile)) {
            const content = fs.readFileSync(indexFile, 'utf-8');
            const exportMatches = content.match(/export\s+{\s*([^}]+)\s*}/g);
            if (exportMatches) {
              for (const match of exportMatches) {
                const names = match.replace(/export\s*{\s*/, '').replace(/\s*}/, '').split(',');
                exports.push(...names.map(n => n.trim()).filter(n => n && !n.includes(' as ')));
              }
            }
            // Also check for named exports
            const namedExports = content.match(/export\s+(?:const|function|class)\s+(\w+)/g);
            if (namedExports) {
              for (const match of namedExports) {
                const name = match.split(/\s+/).pop();
                if (name && !exports.includes(name)) exports.push(name);
              }
            }
            break;
          }
        }

        // If no index, try main file
        if (exports.length === 0 && fs.existsSync(mainFile)) {
          const content = fs.readFileSync(mainFile, 'utf-8');
          const namedExports = content.match(/export\s+(?:const|function|class)\s+(\w+)/g);
          if (namedExports) {
            for (const match of namedExports) {
              const name = match.split(/\s+/).pop();
              if (name) exports.push(name);
            }
          }
        }

        if (exports.length > 0) {
          components[entry.name] = {
            exports: [...new Set(exports)],
            importPath
          };
        }
      }
    } catch (err) {
      // Ignore scan errors
    }

    return components;
  }

  /**
   * Get default type patterns based on common project structures
   */
  getDefaultTypePatterns() {
    return [
      'src/types/*.ts',
      'src/types/index.ts',
      'src/*/types.ts',
      'src/features/*/api/types.ts',
      'src/**/types/*.ts',
      'apps/*/src/types/*.ts',
      'apps/*/src/features/*/api/types.ts',
    ];
  }

  /**
   * Get default component patterns based on common project structures
   */
  getDefaultComponentDirs() {
    const possibleDirs = [
      'src/components',
      'components',
      'apps/web/src/components',
      'src/shared/components',
    ];

    return possibleDirs.filter(dir => {
      const fullPath = path.join(this.projectRoot, dir);
      return fs.existsSync(fullPath);
    });
  }

  /**
   * Gather project files for context generation (config-driven)
   */
  gatherProjectFiles() {
    const files = {};

    // 1. Use config type directories or detect them
    const typeDirs = this.config.typeDirs?.length > 0
      ? this.config.typeDirs
      : this.getDefaultTypePatterns();

    for (const pattern of typeDirs) {
      const matches = this.globSync(pattern);
      for (const match of matches.slice(0, 5)) {
        if (this.shouldExcludePath(match)) continue;
        const content = this.readFile(match, 150);
        if (content) {
          const filtered = this.filterTypesContent(content, match);
          if (filtered) files[match] = filtered;
        }
      }
    }

    // 2. Use config component directories or detect them
    const componentDirs = this.config.componentDirs?.length > 0
      ? this.config.componentDirs
      : this.getDefaultComponentDirs();

    // Read sample components (2-3 examples)
    let componentCount = 0;
    for (const dir of componentDirs) {
      if (componentCount >= 3) break;
      const pattern = `${dir}/**/*.tsx`;
      const matches = this.globSync(pattern)
        .filter(f => !f.includes('.spec') && !f.includes('.test') && !f.includes('index') && !this.shouldExcludePath(f));
      for (const match of matches.slice(0, 2)) {
        const content = this.readFile(match, 80);
        if (content) {
          files[match] = content;
          componentCount++;
        }
        if (componentCount >= 3) break;
      }
    }

    // 3. Read component index files
    for (const dir of componentDirs) {
      const indexPath = `${dir}/index.ts`;
      const content = this.readFile(indexPath, 50);
      if (content) files[indexPath] = content;
    }

    return files;
  }

  /**
   * Generate available imports section from export map
   * Now includes components with usage examples, hooks, services, types, and utils
   */
  generateAvailableImportsSection() {
    let section = '## Available Imports\n\n';
    section += '**CRITICAL:** Only use imports listed below. DO NOT guess import paths.\n';
    section += '**CRITICAL:** Use string literals for variant/size props, NOT object access.\n\n';

    const exportMap = this.getExportMap();

    // Components - with usage examples and warnings
    if (Object.keys(exportMap.components).length > 0) {
      section += '### Components\n\n';

      for (const [name, info] of Object.entries(exportMap.components)) {
        // Use the formatComponentWithUsage helper if component has details
        const hasDetails = info.usageExample ||
          (info.props && Object.keys(info.props).length > 0) ||
          (info.arrayExports && info.arrayExports.length > 0);

        if (hasDetails) {
          section += formatComponentWithUsage(name, info);
        } else {
          // Fallback to simple format
          section += `#### ${name}\n\n`;
          section += '```typescript\n';
          if (info.exports.length > 0) {
            section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
          } else if (info.defaultExport) {
            section += `import ${info.defaultExport} from '${info.importPath}';\n`;
          }
          section += '```\n\n';
        }
      }

      // Collect all array exports for global warning
      const allArrayExports = [];
      for (const [name, info] of Object.entries(exportMap.components)) {
        if (info.arrayExports && info.arrayExports.length > 0) {
          allArrayExports.push(...info.arrayExports);
        }
      }

      if (allArrayExports.length > 0) {
        section += '#### ⚠️ CRITICAL: Array Exports Warning\n\n';
        section += `The following exports are **ARRAYS** (for iteration), **NOT objects**:\n`;
        section += `\`${allArrayExports.join('`, `')}\`\n\n`;
        section += '**WRONG:** `variant={cardVariants.default}` ❌\n';
        section += '**CORRECT:** `variant="default"` ✅\n\n';
      }
    }

    // Hooks - with file name vs export name warning
    if (Object.keys(exportMap.hooks).length > 0) {
      section += '### Hooks\n\n';
      section += '**IMPORTANT:** Use exact hook names shown below. File names may differ from export names.\n\n';

      for (const [fileName, info] of Object.entries(exportMap.hooks)) {
        section += `#### ${fileName}\n`;
        section += '```typescript\n';
        if (info.exports.length > 0) {
          section += `// File: ${fileName}.ts\n`;
          section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
        }
        section += '```\n\n';
      }

      section += '**Common Hook Mistakes:**\n';
      section += '- ❌ `useAuthStore()` → Check actual export (might be `useAuthState()`)\n';
      section += '- ❌ Using file name as function name → Use the actual exported function name\n\n';
    }

    // Services
    if (Object.keys(exportMap.services).length > 0) {
      section += '### Services\n\n';
      section += '```typescript\n';
      for (const [name, info] of Object.entries(exportMap.services)) {
        if (info.exports.length > 0) {
          section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
        }
      }
      section += '```\n\n';
    }

    // Types
    if (Object.keys(exportMap.types).length > 0) {
      section += '### Types\n\n';
      section += '```typescript\n';
      for (const [name, info] of Object.entries(exportMap.types)) {
        if (info.types && info.types.length > 0) {
          section += `import type { ${info.types.join(', ')} } from '${info.importPath}';\n`;
        }
      }
      section += '```\n\n';
    }

    // Utils
    if (Object.keys(exportMap.utils).length > 0) {
      section += '### Utilities\n\n';
      section += '```typescript\n';
      for (const [name, info] of Object.entries(exportMap.utils)) {
        if (info.exports.length > 0) {
          section += `import { ${info.exports.join(', ')} } from '${info.importPath}';\n`;
        }
      }
      section += '```\n\n';
    }

    // Check if we found anything
    const totalExports = Object.keys(exportMap.components).length +
      Object.keys(exportMap.hooks).length +
      Object.keys(exportMap.services).length +
      Object.keys(exportMap.types).length +
      Object.keys(exportMap.utils).length;

    if (totalExports === 0) {
      section += '_No exports found. Define imports inline or use TODO comments._\n\n';
    }

    return section;
  }

  /**
   * @deprecated Use generateAvailableImportsSection instead
   */
  generateAvailableComponentsSection() {
    return this.generateAvailableImportsSection();
  }

  /**
   * Generate project-specific warnings from config
   */
  generateWarningsSection() {
    const warnings = this.config.projectWarnings || [];
    const doNotImport = this.config.doNotImport || ['React'];

    if (warnings.length === 0 && doNotImport.length <= 1) return '';

    let section = '## Project-Specific Warnings\n\n';

    if (doNotImport.length > 0) {
      section += '**DO NOT import these:**\n';
      for (const item of doNotImport) {
        section += `- ❌ \`${item}\`\n`;
      }
      section += '\n';
    }

    if (warnings.length > 0) {
      section += '**Additional warnings:**\n';
      for (const warning of warnings) {
        section += `- ⚠️ ${warning}\n`;
      }
      section += '\n';
    }

    return section;
  }

  /**
   * Generate type locations section from config
   */
  generateTypeLocationsSection() {
    const typeLocations = this.config.typeLocations || {};

    if (Object.keys(typeLocations).length === 0) return '';

    let section = '## Type Import Paths\n\n';
    section += '| Context | Import From |\n';
    section += '|---------|-------------|\n';

    for (const [context, importPath] of Object.entries(typeLocations)) {
      section += `| ${context} | \`${importPath}\` |\n`;
    }
    section += '\n';

    return section;
  }

  /**
   * Generate custom rules section from config
   */
  generateCustomRulesSection() {
    const rules = this.config.customRules || [];

    if (rules.length === 0) return '';

    let section = '## Project Coding Rules\n\n';
    for (const rule of rules) {
      section += `- ${rule}\n`;
    }
    section += '\n';

    return section;
  }

  /**
   * Generate dynamic context based on detected UI framework
   */
  generateFrameworkGuidance() {
    const uiFramework = this.config.uiFramework;
    const stylingApproach = this.config.stylingApproach;

    if (!uiFramework && !stylingApproach) return '';

    let section = '## Framework & Styling\n\n';

    if (uiFramework) {
      section += `**UI Framework:** ${uiFramework}\n\n`;
    }

    if (stylingApproach) {
      section += `**Styling Approach:** ${stylingApproach}\n\n`;

      // Add framework-specific guidance
      switch (stylingApproach.toLowerCase()) {
        case 'styled-components':
          section += `### Styled Components Patterns
- Use transient props: \`$active\`, \`$variant\`, \`$size\` (prefix with $)
- Theme access: \`\${({ theme }) => theme.colors.X}\`
- Add displayName: \`Component.displayName = 'Component'\`
\n`;
          break;
        case 'tailwind':
        case 'tailwindcss':
          section += `### Tailwind Patterns
- Use className for styling
- Use cn() utility if available for conditional classes
- Follow project's class naming conventions
\n`;
          break;
        case 'css-modules':
          section += `### CSS Modules Patterns
- Import styles: \`import styles from './Component.module.css'\`
- Use: \`className={styles.container}\`
\n`;
          break;
      }
    }

    return section;
  }

  /**
   * Generate smart context from project files (config-driven)
   */
  generateSmartContext(projectFiles) {
    let context = '# Project Context for Code Generation\n\n';
    context += '> This context is auto-generated from your project configuration.\n';
    context += '> Local LLM: Use this as your primary reference.\n\n';

    // 1. Available components (FIRST - most important for imports)
    context += this.generateAvailableComponentsSection();

    // 2. Framework/styling guidance
    context += this.generateFrameworkGuidance();

    // 3. Type locations
    context += this.generateTypeLocationsSection();

    // 4. Project-specific warnings
    context += this.generateWarningsSection();

    // 5. Custom rules
    context += this.generateCustomRulesSection();

    // 6. Type Definitions (filtered)
    context += '## Type Definitions\n\n';
    let hasTypes = false;
    for (const [filePath, content] of Object.entries(projectFiles)) {
      if (filePath.includes('types')) {
        context += `### From \`${filePath}\`\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
        hasTypes = true;
      }
    }
    if (!hasTypes) {
      context += '_No type files found. Define types inline if needed._\n\n';
    }

    // 7. Component patterns (sample)
    context += '## Component Patterns\n\n';
    let sampleShown = false;
    for (const [filePath, content] of Object.entries(projectFiles)) {
      if (filePath.includes('components/') && filePath.endsWith('.tsx') && !sampleShown) {
        context += `### Sample Pattern (from \`${filePath}\`)\n`;
        context += 'Follow this pattern for new components:\n';
        context += '```typescript\n' + content + '\n```\n\n';
        sampleShown = true;
      }
    }
    if (!sampleShown) {
      context += '_No sample components found._\n\n';
    }

    // 8. Universal rules
    context += `## Universal Rules

### Import Rules
- ❌ NEVER: \`import React from 'react'\` (causes TS6133 error in React 17+)
- ✅ CORRECT: \`import { useState, useCallback } from 'react'\`
- ❌ NEVER invent import paths - use only what's listed above
- ✅ If unsure, define types inline or use TODO comment

### Export Rules
- ✅ Named exports: \`export function ComponentName() {}\`
- ✅ Props interface: \`interface ComponentNameProps {}\`

---

**Remember:** If you're unsure about an import path, DON'T GUESS. Use inline code or a TODO comment.

`;

    return context;
  }

  /**
   * Minimal context fallback when no project files found
   */
  getMinimalContext() {
    let context = `# Project Context for Code Generation

## Critical Rules

### Imports
- ❌ NEVER: \`import React from 'react'\` - causes TS6133 unused variable error
- ✅ CORRECT: \`import { useState, useCallback } from 'react'\`
- ❌ NEVER invent import paths - only import what you know exists

### Exports
- ✅ Use named exports: \`export function ComponentName\`
- ✅ Define Props interface: \`interface ComponentNameProps {}\`

`;

    // Add any configured warnings even in minimal mode
    context += this.generateWarningsSection();
    context += this.generateCustomRulesSection();

    return context;
  }

  /**
   * Generate or retrieve project context
   */
  getOrGenerateContext() {
    // Check cache first
    const cached = this.getCachedContext();
    if (cached) {
      return { context: cached, fromCache: true };
    }

    // Gather project files
    const projectFiles = this.gatherProjectFiles();

    if (Object.keys(projectFiles).length === 0) {
      const minimal = this.getMinimalContext();
      return { context: minimal, fromCache: false };
    }

    // Generate context from files
    const context = this.generateSmartContext(projectFiles);

    // Cache it
    this.saveContext(context);

    return { context, fromCache: false };
  }

  /**
   * Force regenerate context (bypass cache)
   */
  regenerateContext() {
    const projectFiles = this.gatherProjectFiles();
    const context = Object.keys(projectFiles).length > 0
      ? this.generateSmartContext(projectFiles)
      : this.getMinimalContext();

    this.saveContext(context);
    return context;
  }
}

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

  const metricsPath = path.join(STATE_DIR, 'hybrid-metrics.json');

  // Load existing metrics or create new array
  let metrics = [];
  if (fs.existsSync(metricsPath)) {
    try {
      metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    } catch {
      metrics = [];
    }
  }

  // Add new metric entry
  const entry = {
    timestamp: new Date().toISOString(),
    planId: plan.planId || 'unknown',
    task: plan.task || 'unknown',
    complexity: {
      level: complexity?.level || 'unknown',
      estimatedTokens: complexity?.estimatedTokens || 0,
      reasoning: complexity?.reasoning || ''
    },
    execution: {
      success: executionResult.success,
      stepsCompleted: executionResult.steps?.filter(s => s.success).length || 0,
      stepsTotal: executionResult.steps?.length || 0,
      escalated: executionResult.escalateToCloud?.length > 0,
      escalatedSteps: executionResult.escalateToCloud?.map(s => s.id) || []
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
  } catch {
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

/**
 * Estimates token count from text.
 * Uses ~4 characters per token as a rough estimate.
 * This is conservative - actual tokenization varies by model.
 */
function estimateTokens(text) {
  if (!text) return 0;
  // Rough estimate: ~4 chars per token for English text/code
  // Add extra for whitespace and special characters
  return Math.ceil(text.length / 3.5);
}

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

// ============================================================
// Template Engine
// ============================================================

class TemplateEngine {
  constructor(templatesDir) {
    this.templatesDir = templatesDir;
    this.cache = new Map();
    this.richness = null; // Instruction richness settings
    this.projectRoot = PROJECT_ROOT;
    this.projectContext = this.loadProjectContext();
  }

  /**
   * Load project context from config for template rendering
   */
  loadProjectContext() {
    try {
      const config = getConfig();
      const ctx = config.hybrid?.projectContext || {};

      // Format availableComponents for template display
      let formattedComponents = '';
      if (ctx.availableComponents && Object.keys(ctx.availableComponents).length > 0) {
        formattedComponents = '```typescript\n';
        for (const [name, info] of Object.entries(ctx.availableComponents)) {
          const exports = Array.isArray(info.exports) ? info.exports.join(', ') : info.exports || name;
          const importPath = info.importPath || `@/components/${name}`;
          formattedComponents += `// ${name}\nimport { ${exports} } from '${importPath}'\n`;
        }
        formattedComponents += '```';
      }

      // Format typeLocations for template display
      let formattedTypeLocations = '';
      if (ctx.typeLocations && Object.keys(ctx.typeLocations).length > 0) {
        formattedTypeLocations = '| Context | Import Path |\n|---------|-------------|\n';
        for (const [context, importPath] of Object.entries(ctx.typeLocations)) {
          formattedTypeLocations += `| ${context} | \`${importPath}\` |\n`;
        }
      }

      // Format warnings
      let formattedWarnings = '';
      if (ctx.projectWarnings && ctx.projectWarnings.length > 0) {
        formattedWarnings = ctx.projectWarnings.map(w => `- ⚠️ ${w}`).join('\n');
      }

      // Format custom rules
      let formattedRules = '';
      if (ctx.customRules && ctx.customRules.length > 0) {
        formattedRules = ctx.customRules.map(r => `- ${r}`).join('\n');
      }

      // Format doNotImport
      let formattedDoNotImport = '';
      if (ctx.doNotImport && ctx.doNotImport.length > 0) {
        formattedDoNotImport = ctx.doNotImport.map(i => `\`${i}\``).join(', ');
      }

      return {
        uiFramework: ctx.uiFramework,
        stylingApproach: ctx.stylingApproach,
        availableComponents: formattedComponents,
        typeLocations: formattedTypeLocations,
        projectWarnings: formattedWarnings,
        customRules: formattedRules,
        doNotImport: formattedDoNotImport,
        // Keep raw values too for programmatic use
        _raw: ctx
      };
    } catch {
      return {};
    }
  }

  /**
   * Set instruction richness level for context-aware rendering
   */
  setRichness(richnessConfig) {
    this.richness = richnessConfig;
  }

  loadTemplate(name) {
    if (this.cache.has(name)) {
      return this.cache.get(name);
    }

    const templatePath = path.join(this.templatesDir, `${name}.md`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${name}`);
    }

    let template = fs.readFileSync(templatePath, 'utf-8');

    // Include base template
    const basePath = path.join(this.templatesDir, '_base.md');
    if (fs.existsSync(basePath)) {
      const base = fs.readFileSync(basePath, 'utf-8');
      template = template.replace('{{include _base.md}}', base);
    }

    // Include patterns
    const patternsPath = path.join(this.templatesDir, '_patterns.md');
    if (fs.existsSync(patternsPath)) {
      const patterns = fs.readFileSync(patternsPath, 'utf-8');
      template = template.replace('{{include _patterns.md}}', patterns);
    }

    this.cache.set(name, template);
    return template;
  }

  /**
   * Loads additional context based on richness settings
   */
  loadRichnessContext(params) {
    if (!this.richness) return {};

    const context = {};
    const filePath = params.path;

    // Load patterns from decisions.md
    if (this.richness.includePatterns) {
      const patterns = loadPatterns(this.projectRoot);
      if (patterns) {
        context.decisionsPatterns = patterns;
      }
    }

    // Load relevant type definitions
    if (this.richness.includeTypeDefinitions && filePath) {
      const types = loadRelevantTypes(this.projectRoot, filePath);
      if (types) {
        context.relevantTypes = types;
      }
    }

    // Load related code snippets
    if (this.richness.includeRelatedCode && filePath) {
      const related = loadRelatedCode(this.projectRoot, filePath, params.type);
      if (related) {
        context.relatedCodeExamples = related;
      }
    }

    // Add verbosity guidance
    context.verbosityGuidance = getVerbosityGuidance(this.richness.templateVerbosity);
    context.richnessLevel = this.richness.level;
    context.templateVerbosity = this.richness.templateVerbosity;

    return context;
  }

  render(templateName, params) {
    let template = this.loadTemplate(templateName);

    // Load richness-based context and merge with params
    const richnessContext = this.loadRichnessContext(params);

    // Merge: params override projectContext, richnessContext adds more
    const augmentedParams = { ...this.projectContext, ...params, ...richnessContext };

    // Simple variable substitution
    const substitute = (str, obj, prefix = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (value === null || value === undefined) {
          str = str.replace(new RegExp(`{{${fullKey}}}`, 'g'), '');
        } else if (typeof value === 'object' && !Array.isArray(value)) {
          str = substitute(str, value, fullKey);
        } else if (Array.isArray(value)) {
          const arrayStr = value.map(v => {
            if (typeof v === 'object') {
              return JSON.stringify(v, null, 2);
            }
            return `- ${v}`;
          }).join('\n');
          str = str.replace(new RegExp(`{{${fullKey}}}`, 'g'), arrayStr);
        } else {
          str = str.replace(new RegExp(`{{${fullKey}}}`, 'g'), String(value));
        }
      }
      return str;
    };

    let result = substitute(template, augmentedParams);

    // Process conditionals: {{#if var}}content{{/if}}
    // Supports nested object access: {{#if obj.prop}}
    result = result.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varPath, content) => {
      // Support dot notation for nested access
      const value = varPath.split('.').reduce((obj, key) => obj?.[key], augmentedParams);
      return value ? content : '';
    });

    // Clean up any remaining unprocessed conditionals (variables not in params)
    result = result.replace(/\{\{#if\s+[\w.]+\}\}[\s\S]*?\{\{\/if\}\}/g, '');

    // Add richness-specific sections if available
    if (this.richness && (this.richness.includePatterns || this.richness.includeTypeDefinitions || this.richness.includeRelatedCode)) {
      let additionalContext = '\n\n## Additional Context (Based on Task Complexity)\n\n';
      let hasContent = false;

      if (richnessContext.decisionsPatterns) {
        additionalContext += '### Project Patterns\n' + richnessContext.decisionsPatterns + '\n\n';
        hasContent = true;
      }

      if (richnessContext.relevantTypes) {
        additionalContext += '### Relevant Type Definitions\n```typescript\n' + richnessContext.relevantTypes + '\n```\n\n';
        hasContent = true;
      }

      if (richnessContext.relatedCodeExamples) {
        additionalContext += '### Related Code Examples\n' + richnessContext.relatedCodeExamples + '\n\n';
        hasContent = true;
      }

      if (hasContent) {
        result += additionalContext;
      }
    }

    return result;
  }
}

// ============================================================
// Validator
// ============================================================

class Validator {
  static fileExists(filePath) {
    if (fs.existsSync(filePath)) {
      return { success: true, message: 'File exists' };
    }
    return { success: false, message: `File not found: ${filePath}` };
  }

  /**
   * Finds the nearest directory containing a tsconfig.json.
   * Walks up from the file's directory to find the right TypeScript project root.
   * Essential for monorepos where tsconfig is in apps/web/, apps/api/, etc.
   */
  static findTsConfigDir(filePath) {
    if (!filePath) return PROJECT_ROOT;

    let dir = path.dirname(filePath);
    while (dir && dir !== path.dirname(dir)) { // Stop at filesystem root
      const tsconfig = path.join(dir, 'tsconfig.json');
      if (fs.existsSync(tsconfig)) {
        return dir;
      }
      // Also check for package.json as fallback (workspace root)
      const packageJson = path.join(dir, 'package.json');
      if (fs.existsSync(packageJson)) {
        // If this package has a tsconfig, use it
        if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
          return dir;
        }
      }
      dir = path.dirname(dir);
    }
    return PROJECT_ROOT;
  }

  static typescriptCheck(filePath) {
    try {
      // Find the nearest tsconfig directory (for monorepo support)
      const cwd = this.findTsConfigDir(filePath);
      const tsconfigPath = path.join(cwd, 'tsconfig.json');

      // Check if tsconfig exists in this directory
      if (!fs.existsSync(tsconfigPath)) {
        log('dim', `   ⚠️ No tsconfig.json found, skipping TypeScript check`);
        return { success: true, message: 'TypeScript check skipped (no tsconfig.json)' };
      }

      if (cwd !== PROJECT_ROOT) {
        log('dim', `   📁 Running tsc from: ${path.relative(PROJECT_ROOT, cwd) || '.'}`);
      }

      // Use execFileSync with array args for safety
      execFileSync('npx', ['tsc', '--noEmit'], {
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, message: 'TypeScript check passed' };
    } catch (err) {
      const stderr = err.stderr || err.stdout || err.message;

      // Filter out help text (indicates no tsconfig found)
      if (stderr.includes('COMMON COMMANDS') || stderr.includes('tsc: The TypeScript Compiler')) {
        return { success: true, message: 'TypeScript check skipped (tsc could not find project)' };
      }

      // CRITICAL: Filter errors to only include the file we're validating
      // This prevents pre-existing errors in other files from failing validation
      if (filePath) {
        const cwd = this.findTsConfigDir(filePath);
        const relativeFile = path.relative(cwd, filePath);
        const fileName = path.basename(filePath);
        const lines = stderr.split('\n');

        // Find errors that mention our file (by relative path or just filename)
        const relevantErrors = lines.filter(line => {
          // Match lines that contain our file path
          return line.includes(relativeFile) ||
                 line.includes(fileName) ||
                 // Also include "error TS" lines that follow a file match (context)
                 (line.trim().startsWith('error TS') && lines[lines.indexOf(line) - 1]?.includes(fileName));
        });

        if (relevantErrors.length === 0) {
          // Errors exist but not in our file - pass validation
          const errorCount = (stderr.match(/error TS/g) || []).length;
          log('dim', `   ⚠️ ${errorCount} pre-existing error(s) in other files, ${fileName} is clean`);
          return { success: true, message: 'TypeScript check passed (file-specific)' };
        }

        // Errors in our file - fail with relevant errors only
        return {
          success: false,
          message: relevantErrors.slice(0, 10).join('\n')
        };
      }

      return {
        success: false,
        message: stderr.split('\n').slice(0, 10).join('\n')
      };
    }
  }

  static eslintCheck(filePath) {
    try {
      // Also find the right directory for eslint config
      const cwd = this.findTsConfigDir(filePath);
      // Use execFileSync with array args to prevent shell injection
      execFileSync('npx', ['eslint', filePath, '--fix'], {
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, message: 'ESLint check passed' };
    } catch (err) {
      const stderr = err.stderr || err.stdout || err.message;
      return {
        success: false,
        message: stderr.split('\n').slice(0, 10).join('\n')
      };
    }
  }

  static runChecks(checks, filePath) {
    const results = [];

    for (const check of checks) {
      let result;
      switch (check) {
        case 'file-exists':
          result = this.fileExists(filePath);
          break;
        case 'typescript-check':
          result = this.typescriptCheck(filePath);  // Now passes filePath
          break;
        case 'eslint-check':
          result = this.eslintCheck(filePath);
          break;
        default:
          result = { success: true, message: `Unknown check: ${check}` };
      }
      results.push({ check, ...result });

      if (!result.success) break;
    }

    return results;
  }
}

// ============================================================
// Rollback Manager
// ============================================================

class RollbackManager {
  constructor() {
    this.createdFiles = [];
    this.modifiedFiles = [];
    this.checkpointPath = path.join(STATE_DIR, 'rollback-checkpoint.json');
  }

  trackCreation(filePath) {
    this.createdFiles.push(filePath);
    this.saveCheckpoint();
  }

  trackModification(filePath) {
    if (fs.existsSync(filePath)) {
      const original = fs.readFileSync(filePath, 'utf-8');
      this.modifiedFiles.push({ path: filePath, original });
      this.saveCheckpoint();
    }
  }

  saveCheckpoint() {
    const checkpoint = {
      createdFiles: this.createdFiles,
      modifiedFiles: this.modifiedFiles,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  loadCheckpoint() {
    if (fs.existsSync(this.checkpointPath)) {
      const checkpoint = JSON.parse(fs.readFileSync(this.checkpointPath, 'utf-8'));
      this.createdFiles = checkpoint.createdFiles || [];
      this.modifiedFiles = checkpoint.modifiedFiles || [];
      return true;
    }
    return false;
  }

  rollback() {
    log('yellow', '\n🔙 Rolling back changes...\n');

    for (const filePath of this.createdFiles) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log('dim', `  🗑️  Deleted: ${filePath}`);

        let dir = path.dirname(filePath);
        while (dir !== PROJECT_ROOT && fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          if (files.length === 0) {
            fs.rmdirSync(dir);
            log('dim', `  📁 Removed empty: ${dir}`);
            dir = path.dirname(dir);
          } else {
            break;
          }
        }
      }
    }

    for (const { path: filePath, original } of this.modifiedFiles) {
      fs.writeFileSync(filePath, original);
      log('dim', `  ↩️  Restored: ${filePath}`);
    }

    if (fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
    }

    this.createdFiles = [];
    this.modifiedFiles = [];

    log('green', '\n✅ Rollback complete\n');
  }

  clearCheckpoint() {
    if (fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
    }
    this.createdFiles = [];
    this.modifiedFiles = [];
  }
}

// ============================================================
// State Manager
// ============================================================

class StateManager {
  updateRequestLog(step, status, mode = 'hybrid', executor = '') {
    const logPath = path.join(STATE_DIR, 'request-log.md');
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const entry = `
## ${timestamp} - ${step.title}

**Status:** ${status}
**Type:** ${step.type}
**Mode:** ${mode}${executor ? ` (${executor})` : ''}
${step.params?.path ? `**File:** \`${step.params.path}\`` : ''}

${step.description || ''}

---
`;

    if (fs.existsSync(logPath)) {
      fs.appendFileSync(logPath, entry);
    }
  }

  updateAppMap(update) {
    if (!update) return;

    const mapPath = path.join(STATE_DIR, 'app-map.md');
    if (!fs.existsSync(mapPath)) return;

    let content = fs.readFileSync(mapPath, 'utf-8');
    const { section, entry } = update;

    const sectionRegex = new RegExp(`(## ${section}[\\s\\S]*?)(\n## |$)`);
    const match = content.match(sectionRegex);

    if (match) {
      const [, sectionContent, nextSection] = match;
      const newSection = sectionContent.trimEnd() + `\n- ${entry}\n\n`;
      content = content.replace(sectionRegex, newSection + (nextSection === '\n## ' ? '\n## ' : ''));
      fs.writeFileSync(mapPath, content);
    }
  }

  /**
   * Update hybrid session state
   * v2.0: Delegates to durable session when enabled
   */
  updateHybridSession(data) {
    const config = getConfig();

    // v2.0: Use durable session if enabled
    if (config.durableSteps?.enabled !== false) {
      // Update durable session with hybrid-specific data
      const dsSession = durableSession.loadDurableSession();
      if (dsSession) {
        // Track tokens saved
        if (data.totalTokensSaved) {
          durableSession.addTokensSaved(data.totalTokensSaved - (dsSession.metrics.tokensSaved || 0));
        }

        // If executedSteps changed, mark corresponding steps as completed
        if (data.executedSteps) {
          for (const stepId of data.executedSteps) {
            const step = dsSession.steps.find(s => s.id === stepId || s.description?.includes(stepId));
            if (step && step.status !== durableSession.STEP_STATUS.COMPLETED) {
              durableSession.markStepCompleted(step.id, 'Executed by orchestrator');
            }
          }
        }

        // If failedSteps changed, mark corresponding steps as failed
        if (data.failedSteps) {
          for (const stepId of data.failedSteps) {
            const step = dsSession.steps.find(s => s.id === stepId || s.description?.includes(stepId));
            if (step && step.status !== durableSession.STEP_STATUS.FAILED) {
              durableSession.markStepFailed(step.id, 'Failed in orchestrator');
            }
          }
        }

        return durableSession.getHybridSession();
      }
    }

    // Legacy fallback: write to hybrid-session.json directly
    // DEPRECATED: This path is kept for backward compatibility but will be removed
    // Enable durableSteps in config.json to use the modern session management
    console.warn('[DEPRECATED] Using legacy hybrid-session.json - enable durableSteps.enabled in config.json');
    const sessionPath = path.join(STATE_DIR, 'hybrid-session.json');

    let session = {
      sessionId: `sess-${Date.now()}`,
      startedAt: new Date().toISOString(),
      autoExecute: false,
      currentPlan: null,
      executedSteps: [],
      failedSteps: [],
      pendingSteps: [],
      totalTokensSaved: 0
    };

    if (fs.existsSync(sessionPath)) {
      session = { ...session, ...JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) };
    }

    Object.assign(session, data);
    session.updatedAt = new Date().toISOString();

    // Use atomic writeJson to prevent data corruption
    writeJson(sessionPath, session);
    return session;
  }

  /**
   * Get hybrid session state
   * v2.0: Returns durable session in hybrid format when enabled
   */
  getHybridSession() {
    const config = getConfig();

    // v2.0: Use durable session if enabled
    if (config.durableSteps?.enabled !== false) {
      return durableSession.getHybridSession();
    }

    // Legacy fallback - DEPRECATED
    const sessionPath = path.join(STATE_DIR, 'hybrid-session.json');
    if (fs.existsSync(sessionPath)) {
      console.warn('[DEPRECATED] Reading legacy hybrid-session.json - enable durableSteps.enabled in config.json');
      return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    }
    return null;
  }

  saveResults(results) {
    const resultsPath = path.join(STATE_DIR, 'hybrid-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  }

  /**
   * Loads project context from config.json, export map, and app-map.md.
   * Returns context that can be used in templates.
   *
   * Reads from:
   * - config.json → hybrid.projectContext (primary source)
   * - export-map.json (scanned exports)
   * - app-map.md (supplemental component info)
   */
  loadProjectContext() {
    const context = {
      importPatterns: '',
      availableComponents: '',
      availableHooks: '',
      availableServices: '',
      availableTypes: '',
      availableUtils: '',
      typeLocations: '',
      uiFramework: 'react',
      stylingApproach: '',
      doNotImport: '',
      projectWarnings: '',
      customRules: '',
      projectContext: null,
      exportMap: null
    };

    // Try to load from config (primary source)
    const configPath = path.join(WORKFLOW_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const projectCtx = config.hybrid?.projectContext || {};

        // Store raw project context for auto-correction
        context.projectContext = projectCtx;

        // UI Framework
        if (projectCtx.uiFramework) {
          context.uiFramework = projectCtx.uiFramework;
        }

        // Styling approach
        if (projectCtx.stylingApproach) {
          context.stylingApproach = projectCtx.stylingApproach;
        }

        // Format forbidden imports
        if (projectCtx.doNotImport?.length > 0) {
          context.doNotImport = projectCtx.doNotImport.join(', ');
        }

        // Format project warnings
        if (projectCtx.projectWarnings?.length > 0) {
          context.projectWarnings = projectCtx.projectWarnings.map(w => `- ⚠️ ${w}`).join('\n');
        }

        // Format custom rules
        if (projectCtx.customRules?.length > 0) {
          context.customRules = projectCtx.customRules.map(r => `- ${r}`).join('\n');
        }

        // Format type locations
        if (projectCtx.typeLocations && Object.keys(projectCtx.typeLocations).length > 0) {
          context.typeLocations = Object.entries(projectCtx.typeLocations)
            .map(([scope, importPath]) => `- In ${scope}: \`import type { X } from '${importPath}'\``)
            .join('\n');
        }
      } catch (err) {
        log('dim', `   ⚠️ Could not parse config.json: ${err.message}`);
      }
    }

    // Load export map for accurate imports
    const exportMap = loadCachedExportMap();
    if (exportMap) {
      context.exportMap = exportMap;

      // Format components
      if (Object.keys(exportMap.components).length > 0) {
        context.availableComponents = Object.entries(exportMap.components)
          .map(([name, info]) => {
            if (info.exports.length > 0) {
              return `import { ${info.exports.join(', ')} } from '${info.importPath}';`;
            } else if (info.defaultExport) {
              return `import ${info.defaultExport} from '${info.importPath}';`;
            }
            return null;
          })
          .filter(Boolean)
          .join('\n');
      }

      // Format hooks
      if (Object.keys(exportMap.hooks).length > 0) {
        context.availableHooks = Object.entries(exportMap.hooks)
          .map(([name, info]) => info.exports.length > 0
            ? `import { ${info.exports.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }

      // Format services
      if (Object.keys(exportMap.services).length > 0) {
        context.availableServices = Object.entries(exportMap.services)
          .map(([name, info]) => info.exports.length > 0
            ? `import { ${info.exports.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }

      // Format types
      if (Object.keys(exportMap.types).length > 0) {
        context.availableTypes = Object.entries(exportMap.types)
          .map(([name, info]) => info.types?.length > 0
            ? `import type { ${info.types.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }

      // Format utils
      if (Object.keys(exportMap.utils).length > 0) {
        context.availableUtils = Object.entries(exportMap.utils)
          .map(([name, info]) => info.exports.length > 0
            ? `import { ${info.exports.join(', ')} } from '${info.importPath}';`
            : null)
          .filter(Boolean)
          .join('\n');
      }
    }

    // Supplement with app-map.md if no exports found
    const appMapPath = path.join(STATE_DIR, 'app-map.md');
    if (fs.existsSync(appMapPath) && !context.availableComponents) {
      try {
        const appMap = fs.readFileSync(appMapPath, 'utf-8');

        // Extract component sections
        const componentMatch = appMap.match(/## Components[\s\S]*?(?=##|$)/i);
        if (componentMatch) {
          context.availableComponents = componentMatch[0].trim();
        }

        // Extract screens/features
        const screensMatch = appMap.match(/## Screens[\s\S]*?(?=##|$)/i);
        if (screensMatch) {
          context.availableComponents += '\n\n' + screensMatch[0].trim();
        }
      } catch (err) {
        log('dim', `   ⚠️ Could not parse app-map.md: ${err.message}`);
      }
    }

    return context;
  }
}

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
    this.contextGenerator = new ProjectContextGenerator(PROJECT_ROOT);
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
    const profileRichness = getProfileBasedRichness(this.config.model, taskType, this.config.maxTokens || 8192);

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
    prompt = injectPatterns(prompt, taskContext, PROJECT_ROOT);

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
        const contextWindow = this.config.contextWindow || this.llm.contextWindow || 4096;
        // Reserve configurable % of context for output, with configurable max
        const reserveRatio = this.config.outputReserveRatio || 0.3;
        const reserveMax = this.config.outputReserveMax || 4096;
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
  flow-orchestrate --resume       Resume from checkpoint
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

  if (args.includes('--resume')) {
    log('yellow', 'Resume not yet implemented');
    process.exit(1);
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

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));

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

main().catch(err => {
  console.error(`\x1b[31mFatal error: ${err.message}\x1b[0m`);
  process.exit(1);
});
