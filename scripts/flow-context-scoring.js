#!/usr/bin/env node

/**
 * flow-context-scoring.js
 *
 * Phase 4.2: Context Priority Scoring System
 *
 * Smarter context selection than "include everything".
 * Scores context items by relevance and fits them within token budgets.
 *
 * Usage:
 *   node flow-context-scoring.js score --task "<description>" --files <files>
 *   node flow-context-scoring.js budget --tokens 50000 --task "<description>"
 *   node flow-context-scoring.js analyze --file <file>
 *
 * @module flow-context-scoring
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Imports
// ============================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');

const {
  getConfig,
  parseFlags,
  info,
  success,
  warn,
  error,
  color,
  outputJson,
  printHeader,
  printSection,
  estimateTokens: utilsEstimateTokens
} = require('./flow-utils');

// ============================================================
// Constants
// ============================================================

/**
 * Context priority weights.
 * Higher = more important to include.
 */
const CONTEXT_PRIORITIES = {
  // Must-have context
  required_types: 1.0,        // Type definitions referenced in task
  target_file: 0.95,          // The file being modified
  error_context: 0.93,        // Error messages, stack traces

  // High-value context
  direct_imports: 0.90,       // Files directly imported by target
  interface_definitions: 0.88, // Interface/type definitions
  api_contracts: 0.85,        // API schemas, endpoints

  // Medium-value context
  related_imports: 0.80,      // Secondary imports
  test_files: 0.75,           // Related test files
  patterns: 0.70,             // Pattern examples from decisions.md
  similar_implementations: 0.65, // Similar code elsewhere

  // Lower-value context
  documentation: 0.50,        // README, docs
  examples: 0.45,             // Example code
  config_files: 0.40,         // Config files
  full_files: 0.30,           // Full file contents (vs snippets)

  // Minimal value
  package_info: 0.20,         // package.json
  changelog: 0.10,            // CHANGELOG
  generated_files: 0.05       // Auto-generated code
};

/**
 * Context categories for grouping.
 */
const CONTEXT_CATEGORIES = {
  REQUIRED: 'required',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  MINIMAL: 'minimal'
};

/**
 * Default context scoring configuration.
 */
const DEFAULT_CONTEXT_CONFIG = {
  enabled: true,
  maxContextTokens: 100000,
  reserveOutputTokens: 8000,
  priorities: CONTEXT_PRIORITIES,
  includeMinScore: 0.3,
  snippetMaxLines: 50,
  fullFileMaxLines: 200
};

// ============================================================
// Configuration
// ============================================================

/**
 * Get context scoring configuration from config.json with defaults.
 * @returns {Object} Context scoring configuration
 */
function getContextConfig() {
  const config = getConfig();
  return {
    ...DEFAULT_CONTEXT_CONFIG,
    ...(config.contextScoring || {})
  };
}

// ============================================================
// Context Item Types
// ============================================================

/**
 * Create a context item.
 * @param {Object} params - Item parameters
 * @returns {Object} Context item
 */
function createContextItem({
  id,
  type,
  content,
  source,
  relevance = 0,
  tokens = 0,
  metadata = {}
}) {
  const baseScore = CONTEXT_PRIORITIES[type] || 0.5;

  return {
    id: id || `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content,
    source,
    baseScore,
    relevance,
    finalScore: baseScore * (0.5 + relevance * 0.5), // Combine base and relevance
    tokens: tokens || estimateTokens(content),
    category: categorizeScore(baseScore),
    metadata,
    included: false
  };
}

/**
 * Categorize a score into a category.
 * @param {number} score - Score value
 * @returns {string} Category
 */
function categorizeScore(score) {
  if (score >= 0.9) return CONTEXT_CATEGORIES.REQUIRED;
  if (score >= 0.7) return CONTEXT_CATEGORIES.HIGH;
  if (score >= 0.5) return CONTEXT_CATEGORIES.MEDIUM;
  if (score >= 0.2) return CONTEXT_CATEGORIES.LOW;
  return CONTEXT_CATEGORIES.MINIMAL;
}

// ============================================================
// Token Estimation
// ============================================================

/**
 * Estimate tokens for a piece of content.
 * Uses centralized estimateTokens with hybrid char+line estimation.
 * @param {string} content - Content to estimate
 * @returns {number} Estimated tokens
 */
function estimateTokens(content) {
  return utilsEstimateTokens(content, { useLineEstimate: true });
}

/**
 * Estimate tokens for a file.
 * @param {string} filePath - Path to file
 * @returns {number} Estimated tokens
 */
function estimateFileTokens(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return estimateTokens(content);
  } catch {
    return 0;
  }
}

// ============================================================
// Relevance Scoring
// ============================================================

/**
 * Score relevance of content to a task.
 * @param {string} content - Content to score
 * @param {Object} taskContext - Task context
 * @returns {number} Relevance score (0-1)
 */
function scoreRelevance(content, taskContext) {
  if (!content || !taskContext) return 0;

  const contentLower = content.toLowerCase();
  let score = 0;
  let matches = 0;

  // Check for keyword matches
  const keywords = taskContext.keywords || [];
  for (const keyword of keywords) {
    if (contentLower.includes(keyword.toLowerCase())) {
      score += 0.1;
      matches++;
    }
  }

  // Check for file references
  const files = taskContext.files || [];
  for (const file of files) {
    const fileName = path.basename(file).toLowerCase();
    if (contentLower.includes(fileName)) {
      score += 0.2;
      matches++;
    }
  }

  // Check for type/interface references
  const types = taskContext.types || [];
  for (const type of types) {
    if (content.includes(type)) {
      score += 0.15;
      matches++;
    }
  }

  // Check for function/method references
  const functions = taskContext.functions || [];
  for (const func of functions) {
    if (content.includes(func)) {
      score += 0.15;
      matches++;
    }
  }

  // Boost if multiple matches
  if (matches > 3) score *= 1.2;
  if (matches > 5) score *= 1.3;

  return Math.min(1, score);
}

/**
 * Extract task context from a description.
 * @param {string} description - Task description
 * @returns {Object} Extracted context
 */
function extractTaskContext(description) {
  const context = {
    keywords: [],
    files: [],
    types: [],
    functions: []
  };

  // Extract file references
  const filePattern = /[a-zA-Z0-9_-]+\.(ts|tsx|js|jsx|json|md|css|scss|html|vue|svelte)/g;
  let match;
  while ((match = filePattern.exec(description)) !== null) {
    context.files.push(match[0]);
  }

  // Extract type/interface names (PascalCase)
  const typePattern = /\b([A-Z][a-zA-Z]+(?:Type|Interface|Props|State|Config|Options|Params))\b/g;
  while ((match = typePattern.exec(description)) !== null) {
    context.types.push(match[1]);
  }

  // Extract function names (camelCase verbs)
  const funcPattern = /\b(get|set|create|update|delete|fetch|load|save|handle|process|validate|render|format|parse|build|init)[A-Z][a-zA-Z]+/g;
  while ((match = funcPattern.exec(description)) !== null) {
    context.functions.push(match[0]);
  }

  // Extract significant keywords
  const keywords = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['with', 'that', 'this', 'from', 'have', 'will', 'should', 'would', 'could'].includes(word));

  context.keywords = [...new Set(keywords)].slice(0, 20);

  return context;
}

// ============================================================
// Context Collection
// ============================================================

/**
 * Collect context items for a task.
 * @param {Object} params - Collection parameters
 * @returns {Array} Context items
 */
function collectContext({ description, targetFiles = [], additionalContext = [] }) {
  const items = [];
  const taskContext = extractTaskContext(description);

  // Add target files (highest priority)
  for (const file of targetFiles) {
    try {
      if (!fs.existsSync(file)) continue;

      const content = fs.readFileSync(file, 'utf8');
      items.push(createContextItem({
        type: 'target_file',
        content,
        source: file,
        relevance: 1.0,
        metadata: { isTarget: true }
      }));

      // Extract imports from target file
      const imports = extractImports(content, file);
      for (const imp of imports) {
        // Validate resolvedPath exists before using
        if (!imp.resolvedPath) continue;

        try {
          if (!fs.existsSync(imp.resolvedPath)) continue;

          const importContent = fs.readFileSync(imp.resolvedPath, 'utf8');
          items.push(createContextItem({
            type: 'direct_imports',
            content: importContent,
            source: imp.resolvedPath,
            relevance: scoreRelevance(importContent, taskContext),
            metadata: { importedFrom: file, importPath: imp.path }
          }));
        } catch {
          // Skip unreadable import files
        }
      }
    } catch {
      // Skip unreadable target files
    }
  }

  // Add additional context with scoring
  for (const ctx of additionalContext) {
    const relevance = scoreRelevance(ctx.content, taskContext);
    items.push(createContextItem({
      type: ctx.type || 'full_files',
      content: ctx.content,
      source: ctx.source,
      relevance,
      metadata: ctx.metadata || {}
    }));
  }

  // Add patterns from decisions.md
  const decisionsPath = path.join(PROJECT_ROOT, '.workflow', 'state', 'decisions.md');
  try {
    if (fs.existsSync(decisionsPath)) {
      const decisions = fs.readFileSync(decisionsPath, 'utf8');
      const relevance = scoreRelevance(decisions, taskContext);
      if (relevance > 0.3) {
        items.push(createContextItem({
          type: 'patterns',
          content: decisions,
          source: decisionsPath,
          relevance
        }));
      }
    }
  } catch {
    // Skip if decisions.md is unreadable
  }

  return items;
}

/**
 * Extract imports from a file.
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @returns {Array} Import information
 */
function extractImports(content, filePath) {
  const imports = [];
  const dir = path.dirname(filePath);

  // ES6 imports
  const es6Pattern = /import\s+(?:[\w{},\s*]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = es6Pattern.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      const resolvedPath = resolveImportPath(importPath, dir);
      if (resolvedPath) {
        imports.push({ path: importPath, resolvedPath });
      }
    }
  }

  // CommonJS requires
  const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = cjsPattern.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      const resolvedPath = resolveImportPath(importPath, dir);
      if (resolvedPath) {
        imports.push({ path: importPath, resolvedPath });
      }
    }
  }

  return imports;
}

/**
 * Resolve an import path to an actual file.
 * @param {string} importPath - Import path
 * @param {string} baseDir - Base directory
 * @returns {string|null} Resolved path or null
 */
function resolveImportPath(importPath, baseDir) {
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

  for (const ext of extensions) {
    try {
      const fullPath = path.resolve(baseDir, importPath + ext);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    } catch {
      // Skip if path check fails (permissions, symlink issues)
    }
  }

  return null;
}

// ============================================================
// Budget Fitting
// ============================================================

/**
 * Fit context items within a token budget.
 * @param {Array} items - Context items
 * @param {number} budget - Token budget
 * @param {Object} options - Fitting options
 * @returns {Object} Fitting result
 */
function fitToBudget(items, budget, options = {}) {
  const config = getContextConfig();
  const minScore = options.minScore || config.includeMinScore;

  // Sort by final score (descending)
  const sorted = [...items].sort((a, b) => b.finalScore - a.finalScore);

  let usedTokens = 0;
  const included = [];
  const excluded = [];

  for (const item of sorted) {
    // Skip if below minimum score
    if (item.finalScore < minScore) {
      excluded.push({ ...item, reason: 'Below minimum score' });
      continue;
    }

    // Check if it fits
    if (usedTokens + item.tokens <= budget) {
      item.included = true;
      included.push(item);
      usedTokens += item.tokens;
    } else {
      // Try to include a snippet instead
      if (options.allowSnippets && item.tokens > config.snippetMaxLines * TOKENS_PER_LINE) {
        const snippet = createSnippet(item, config.snippetMaxLines);
        if (usedTokens + snippet.tokens <= budget) {
          snippet.included = true;
          included.push(snippet);
          usedTokens += snippet.tokens;
          excluded.push({ ...item, reason: 'Included as snippet' });
        } else {
          excluded.push({ ...item, reason: 'Exceeds budget (even as snippet)' });
        }
      } else {
        excluded.push({ ...item, reason: 'Exceeds budget' });
      }
    }
  }

  return {
    included,
    excluded,
    usedTokens,
    budget,
    utilizationPercent: (usedTokens / budget) * 100,
    summary: {
      totalItems: items.length,
      includedCount: included.length,
      excludedCount: excluded.length,
      byCategory: summarizeByCategory(included)
    }
  };
}

/**
 * Create a snippet from a context item.
 * @param {Object} item - Context item
 * @param {number} maxLines - Maximum lines
 * @returns {Object} Snippet item
 */
function createSnippet(item, maxLines) {
  const lines = item.content.split('\n');
  const snippetLines = lines.slice(0, maxLines);

  if (lines.length > maxLines) {
    snippetLines.push(`... (${lines.length - maxLines} more lines)`);
  }

  return {
    ...item,
    id: `${item.id}-snippet`,
    content: snippetLines.join('\n'),
    tokens: estimateTokens(snippetLines.join('\n')),
    metadata: {
      ...item.metadata,
      isSnippet: true,
      originalLines: lines.length,
      snippetLines: maxLines
    }
  };
}

/**
 * Summarize items by category.
 * @param {Array} items - Items to summarize
 * @returns {Object} Summary by category
 */
function summarizeByCategory(items) {
  const summary = {};

  for (const category of Object.values(CONTEXT_CATEGORIES)) {
    summary[category] = {
      count: 0,
      tokens: 0
    };
  }

  for (const item of items) {
    if (summary[item.category]) {
      summary[item.category].count++;
      summary[item.category].tokens += item.tokens;
    }
  }

  return summary;
}

// ============================================================
// Analysis
// ============================================================

/**
 * Analyze a file for context scoring.
 * @param {string} filePath - Path to file
 * @returns {Object} Analysis result
 */
function analyzeFile(filePath) {
  // Validate path is within project directory (prevent path traversal)
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(PROJECT_ROOT)) {
    return { error: 'File must be within project directory' };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { error: 'File not found' };
  }

  let content;
  try {
    content = fs.readFileSync(resolvedPath, 'utf8');
  } catch {
    return { error: 'Failed to read file' };
  }
  const lines = content.split('\n');
  const tokens = estimateTokens(content);

  // Determine file type
  const ext = path.extname(filePath);
  let fileType = 'full_files';

  if (/\.(d\.ts|types\.ts)$/.test(filePath)) {
    fileType = 'required_types';
  } else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath)) {
    fileType = 'test_files';
  } else if (/\.(md|txt)$/.test(filePath)) {
    fileType = 'documentation';
  } else if (/\.(json|yaml|yml|toml)$/.test(filePath)) {
    fileType = 'config_files';
  } else if (/\.generated\.|\.min\./.test(filePath)) {
    fileType = 'generated_files';
  }

  const baseScore = CONTEXT_PRIORITIES[fileType] || 0.5;

  // Extract structure info
  const exports = extractExports(content);
  const imports = extractImports(content, filePath);

  return {
    path: filePath,
    lines: lines.length,
    tokens,
    fileType,
    baseScore,
    category: categorizeScore(baseScore),
    exports,
    importCount: imports.length,
    wouldFitIn: {
      small: tokens <= 2000 ? 'full' : tokens <= 5000 ? 'snippet' : 'summary',
      medium: tokens <= 10000 ? 'full' : tokens <= 20000 ? 'snippet' : 'summary',
      large: tokens <= 50000 ? 'full' : 'snippet'
    }
  };
}

/**
 * Extract exports from a file.
 * @param {string} content - File content
 * @returns {Array} Export information
 */
function extractExports(content) {
  const exports = [];

  // Named exports
  const namedPattern = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = namedPattern.exec(content)) !== null) {
    exports.push({ name: match[1], type: 'named' });
  }

  // Default export
  if (/export\s+default/.test(content)) {
    exports.push({ name: 'default', type: 'default' });
  }

  // module.exports
  const cjsPattern = /module\.exports\s*=\s*\{([^}]+)\}/;
  const cjsMatch = content.match(cjsPattern);
  if (cjsMatch) {
    const names = cjsMatch[1].match(/\w+/g) || [];
    for (const name of names) {
      exports.push({ name, type: 'cjs' });
    }
  }

  return exports;
}

// ============================================================
// CLI Output
// ============================================================

/**
 * Print context scoring results.
 * @param {Object} result - Fitting result
 */
function printScoringResult(result) {
  printHeader('CONTEXT SCORING RESULT');

  printSection('Budget');
  console.log(`  ${color('dim', 'Total budget:')} ${result.budget} tokens`);
  console.log(`  ${color('dim', 'Used:')} ${result.usedTokens} tokens (${result.utilizationPercent.toFixed(1)}%)`);
  console.log(`  ${color('dim', 'Remaining:')} ${result.budget - result.usedTokens} tokens`);

  printSection('Included Items');
  const byCategory = result.summary.byCategory;
  for (const [category, data] of Object.entries(byCategory)) {
    if (data.count > 0) {
      const icon = category === 'required' ? '🔴' :
                   category === 'high' ? '🟠' :
                   category === 'medium' ? '🟡' :
                   category === 'low' ? '🟢' : '⚪';
      console.log(`  ${icon} ${category}: ${data.count} items (${data.tokens} tokens)`);
    }
  }

  console.log('');
  for (const item of result.included.slice(0, 10)) {
    const scoreBar = '█'.repeat(Math.round(item.finalScore * 10));
    console.log(`  ${color('dim', item.type.padEnd(20))} ${scoreBar} ${item.finalScore.toFixed(2)}`);
    console.log(`    ${color('dim', item.source)} (${item.tokens} tokens)`);
  }

  if (result.included.length > 10) {
    console.log(color('dim', `  ... and ${result.included.length - 10} more items`));
  }

  if (result.excluded.length > 0) {
    printSection('Excluded Items');
    console.log(color('dim', `  ${result.excluded.length} items excluded`));
    const reasons = {};
    for (const item of result.excluded) {
      reasons[item.reason] = (reasons[item.reason] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(reasons)) {
      console.log(`    ${color('dim', reason)}: ${count}`);
    }
  }
}

/**
 * Print file analysis.
 * @param {Object} analysis - File analysis
 */
function printFileAnalysis(analysis) {
  if (analysis.error) {
    error(analysis.error);
    return;
  }

  printHeader('FILE ANALYSIS');

  console.log(`  ${color('dim', 'Path:')} ${analysis.path}`);
  console.log(`  ${color('dim', 'Lines:')} ${analysis.lines}`);
  console.log(`  ${color('dim', 'Tokens:')} ${analysis.tokens}`);
  console.log(`  ${color('dim', 'Type:')} ${analysis.fileType}`);
  console.log(`  ${color('dim', 'Base score:')} ${analysis.baseScore.toFixed(2)}`);
  console.log(`  ${color('dim', 'Category:')} ${analysis.category}`);

  printSection('Exports');
  if (analysis.exports.length === 0) {
    console.log(color('dim', '  No exports found'));
  } else {
    for (const exp of analysis.exports.slice(0, 10)) {
      console.log(`  ${exp.type === 'default' ? '★' : '○'} ${exp.name}`);
    }
    if (analysis.exports.length > 10) {
      console.log(color('dim', `  ... and ${analysis.exports.length - 10} more`));
    }
  }

  printSection('Context Budget Fit');
  console.log(`  ${color('dim', 'Small context (10k):')} ${analysis.wouldFitIn.small}`);
  console.log(`  ${color('dim', 'Medium context (50k):')} ${analysis.wouldFitIn.medium}`);
  console.log(`  ${color('dim', 'Large context (200k):')} ${analysis.wouldFitIn.large}`);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core functions
  createContextItem,
  collectContext,
  fitToBudget,
  analyzeFile,

  // Scoring
  scoreRelevance,
  extractTaskContext,
  estimateTokens,

  // Configuration
  getContextConfig,
  CONTEXT_PRIORITIES,
  CONTEXT_CATEGORIES,
  DEFAULT_CONTEXT_CONFIG
};

// ============================================================
// CLI Entry Point
// ============================================================

function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Usage: flow context <command> [options]

Commands:
  score               Score context items for a task
  budget              Fit context within a token budget
  analyze             Analyze a file for context inclusion

Options:
  --task "<desc>"     Task description for relevance scoring
  --files <f1,f2>     Files to include (comma-separated)
  --tokens <n>        Token budget (default: 100000)
  --json              Output as JSON
  --help              Show this help

Examples:
  flow context score --task "Add user authentication" --files src/auth.ts
  flow context budget --tokens 50000 --task "Fix login bug"
  flow context analyze --file src/components/Button.tsx
`);
    return;
  }

  switch (command) {
    case 'score': {
      const task = flags.task;
      const files = flags.files ? flags.files.split(',') : [];

      if (!task) {
        error('Please provide a task with --task');
        process.exit(1);
      }

      const items = collectContext({
        description: task,
        targetFiles: files
      });

      if (flags.json) {
        outputJson(items);
      } else {
        printHeader('CONTEXT ITEMS SCORED');
        for (const item of items.slice(0, 20)) {
          console.log(`  ${item.finalScore.toFixed(2)} ${item.type} - ${item.source}`);
        }
      }
      break;
    }

    case 'budget': {
      const task = flags.task || 'General task';
      const files = flags.files ? flags.files.split(',') : [];
      const budget = parseInt(flags.tokens) || 100000;

      const items = collectContext({
        description: task,
        targetFiles: files
      });

      const result = fitToBudget(items, budget, { allowSnippets: true });

      if (flags.json) {
        outputJson(result);
      } else {
        printScoringResult(result);
      }
      break;
    }

    case 'analyze': {
      const file = flags.file || positional[1];

      if (!file) {
        error('Please provide a file with --file or as argument');
        process.exit(1);
      }

      const analysis = analyzeFile(file);

      if (flags.json) {
        outputJson(analysis);
      } else {
        printFileAnalysis(analysis);
      }
      break;
    }

    default:
      error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}
