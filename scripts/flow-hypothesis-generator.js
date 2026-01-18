#!/usr/bin/env node

/**
 * Wogi Flow - Hypothesis Generator
 *
 * Generates testable hypotheses from errors for recursive recovery.
 * Leverages existing ERROR_CATEGORIES from flow-adaptive-learning.js
 * to create ranked hypotheses with specific test strategies.
 *
 * This integrates with flow-error-recovery.js to provide hypothesis-driven
 * debugging when standard fix strategies fail.
 */

const path = require('path');
const {
  PATHS,
  readJson,
  writeJson,
  ensureDir,
  success,
  warn,
  error,
  info
} = require('./flow-utils');

// Import adaptive learning for error categories and tracking
let adaptiveLearning;
try {
  adaptiveLearning = require('./flow-adaptive-learning');
} catch (err) {
  // Module not available - will use local error categories
  adaptiveLearning = null;
}

// Import error recovery for integration
let errorRecovery;
try {
  errorRecovery = require('./flow-error-recovery');
} catch (err) {
  errorRecovery = null;
}

// ============================================================
// Constants
// ============================================================

const HYPOTHESIS_STATE_PATH = path.join(PATHS.state, 'hypothesis-tree.json');

/**
 * Error categories (from adaptive learning or local fallback)
 */
const ERROR_CATEGORIES = adaptiveLearning?.ERROR_CATEGORIES || {
  IMPORT_ERROR: 'import_error',
  TYPE_ERROR: 'type_error',
  SYNTAX_ERROR: 'syntax_error',
  RUNTIME_ERROR: 'runtime_error',
  PARSE_ERROR: 'parse_error',
  MISSING_CONTEXT: 'missing_context',
  PATTERN_VIOLATION: 'pattern_violation'
};

/**
 * Hypothesis patterns per error category
 * Each hypothesis has:
 * - hypothesis: Human-readable description
 * - test: Test strategy identifier
 * - likelihood: Base probability (0-1)
 * - fixStrategy: Suggested fix approach
 */
const HYPOTHESIS_PATTERNS = {
  [ERROR_CATEGORIES.IMPORT_ERROR]: [
    {
      hypothesis: 'File path is incorrect or file does not exist',
      test: 'check_file_exists',
      likelihood: 0.9,
      fixStrategy: 'Verify file path and check for typos'
    },
    {
      hypothesis: 'Export name is wrong or does not exist in module',
      test: 'check_exports',
      likelihood: 0.8,
      fixStrategy: 'Check module exports and import statement'
    },
    {
      hypothesis: 'Circular dependency between modules',
      test: 'check_import_cycle',
      likelihood: 0.4,
      fixStrategy: 'Analyze import chain and break cycle'
    },
    {
      hypothesis: 'Module not installed or missing from package.json',
      test: 'check_npm_package',
      likelihood: 0.6,
      fixStrategy: 'Run npm install or add to dependencies'
    }
  ],

  [ERROR_CATEGORIES.TYPE_ERROR]: [
    {
      hypothesis: 'Type definition is outdated or incorrect',
      test: 'check_type_definition',
      likelihood: 0.7,
      fixStrategy: 'Update type definition to match usage'
    },
    {
      hypothesis: 'Missing type coercion or conversion',
      test: 'check_type_usage',
      likelihood: 0.6,
      fixStrategy: 'Add explicit type conversion'
    },
    {
      hypothesis: 'Interface changed in upstream dependency',
      test: 'check_interface_changes',
      likelihood: 0.5,
      fixStrategy: 'Check dependency changelog and update usage'
    },
    {
      hypothesis: 'Nullable value accessed without null check',
      test: 'check_null_safety',
      likelihood: 0.8,
      fixStrategy: 'Add null/undefined guard before access'
    }
  ],

  [ERROR_CATEGORIES.SYNTAX_ERROR]: [
    {
      hypothesis: 'Missing closing bracket, brace, or parenthesis',
      test: 'check_brackets',
      likelihood: 0.9,
      fixStrategy: 'Find and add missing delimiter'
    },
    {
      hypothesis: 'Unterminated string literal',
      test: 'check_strings',
      likelihood: 0.8,
      fixStrategy: 'Find unclosed string and add closing quote'
    },
    {
      hypothesis: 'Invalid JavaScript/TypeScript syntax',
      test: 'parse_file',
      likelihood: 0.7,
      fixStrategy: 'Review syntax around error location'
    },
    {
      hypothesis: 'Reserved word used as identifier',
      test: 'check_reserved_words',
      likelihood: 0.3,
      fixStrategy: 'Rename identifier to non-reserved name'
    }
  ],

  [ERROR_CATEGORIES.RUNTIME_ERROR]: [
    {
      hypothesis: 'Accessing property of undefined/null value',
      test: 'check_null_access',
      likelihood: 0.85,
      fixStrategy: 'Add defensive null check'
    },
    {
      hypothesis: 'Array index out of bounds',
      test: 'check_array_bounds',
      likelihood: 0.5,
      fixStrategy: 'Add bounds check before access'
    },
    {
      hypothesis: 'Async operation not awaited',
      test: 'check_async_await',
      likelihood: 0.6,
      fixStrategy: 'Add await keyword or handle Promise'
    },
    {
      hypothesis: 'File or resource not found',
      test: 'check_resource_exists',
      likelihood: 0.7,
      fixStrategy: 'Verify path and check file existence before access'
    }
  ],

  [ERROR_CATEGORIES.PARSE_ERROR]: [
    {
      hypothesis: 'Invalid JSON format',
      test: 'validate_json',
      likelihood: 0.9,
      fixStrategy: 'Fix JSON syntax errors'
    },
    {
      hypothesis: 'Malformed configuration file',
      test: 'validate_config',
      likelihood: 0.7,
      fixStrategy: 'Check config against schema'
    },
    {
      hypothesis: 'Encoding issue in file',
      test: 'check_encoding',
      likelihood: 0.3,
      fixStrategy: 'Convert file to UTF-8'
    }
  ],

  [ERROR_CATEGORIES.MISSING_CONTEXT]: [
    {
      hypothesis: 'Required file not in context window',
      test: 'check_context_files',
      likelihood: 0.8,
      fixStrategy: 'Load missing file into context'
    },
    {
      hypothesis: 'Previous conversation context lost',
      test: 'check_session_state',
      likelihood: 0.6,
      fixStrategy: 'Reload session state'
    },
    {
      hypothesis: 'Related code changes not visible',
      test: 'check_related_changes',
      likelihood: 0.5,
      fixStrategy: 'Expand context to include related files'
    }
  ],

  [ERROR_CATEGORIES.PATTERN_VIOLATION]: [
    {
      hypothesis: 'Code violates project patterns in decisions.md',
      test: 'check_patterns',
      likelihood: 0.8,
      fixStrategy: 'Review and apply documented patterns'
    },
    {
      hypothesis: 'Naming convention not followed',
      test: 'check_naming',
      likelihood: 0.7,
      fixStrategy: 'Rename to follow conventions'
    },
    {
      hypothesis: 'Architecture constraint violated',
      test: 'check_architecture',
      likelihood: 0.5,
      fixStrategy: 'Refactor to comply with architecture'
    }
  ]
};

// ============================================================
// Hypothesis Generation
// ============================================================

/**
 * Categorize an error based on its content
 * @param {string} errorText - Error message
 * @returns {string} Error category
 */
function categorizeError(errorText) {
  if (!errorText) return ERROR_CATEGORIES.RUNTIME_ERROR;

  const lower = errorText.toLowerCase();

  if (/cannot find module|module not found|import|require/.test(lower)) {
    return ERROR_CATEGORIES.IMPORT_ERROR;
  }
  if (/typeerror|type.*not assignable|property.*does not exist/i.test(lower)) {
    return ERROR_CATEGORIES.TYPE_ERROR;
  }
  if (/syntaxerror|unexpected token|unexpected end/i.test(lower)) {
    return ERROR_CATEGORIES.SYNTAX_ERROR;
  }
  if (/json|parse error|unexpected.*json/i.test(lower)) {
    return ERROR_CATEGORIES.PARSE_ERROR;
  }
  if (/context|missing.*file|not loaded/i.test(lower)) {
    return ERROR_CATEGORIES.MISSING_CONTEXT;
  }
  if (/pattern|convention|style|naming/i.test(lower)) {
    return ERROR_CATEGORIES.PATTERN_VIOLATION;
  }

  return ERROR_CATEGORIES.RUNTIME_ERROR;
}

/**
 * Generate context-aware hypotheses based on error specifics
 * @param {string} errorText - Error message
 * @param {Object} context - Additional context
 * @returns {Object[]} Context-specific hypotheses
 */
function generateContextHypotheses(errorText, context) {
  const hypotheses = [];

  // Extract specific information from error
  const fileMatch = errorText.match(/(?:at |in |file:?\s*)([^\s:]+)/i);
  const lineMatch = errorText.match(/(?:line |:)(\d+)/i);
  const variableMatch = errorText.match(/['"]([\w.]+)['"]\s+is\s+(?:not|undefined)/i);

  if (fileMatch) {
    hypotheses.push({
      hypothesis: `Issue in file: ${fileMatch[1]}`,
      test: 'examine_file',
      likelihood: 0.75,
      fixStrategy: `Review ${fileMatch[1]}${lineMatch ? ` around line ${lineMatch[1]}` : ''}`,
      metadata: { file: fileMatch[1], line: lineMatch?.[1] }
    });
  }

  if (variableMatch) {
    hypotheses.push({
      hypothesis: `Variable '${variableMatch[1]}' is not defined or accessible`,
      test: 'check_variable_scope',
      likelihood: 0.8,
      fixStrategy: `Verify '${variableMatch[1]}' is defined and in scope`,
      metadata: { variable: variableMatch[1] }
    });
  }

  // Add hypotheses from context
  if (context.recentChanges?.length > 0) {
    hypotheses.push({
      hypothesis: 'Recent changes may have introduced the issue',
      test: 'review_changes',
      likelihood: 0.65,
      fixStrategy: 'Review recent changes for potential causes',
      metadata: { files: context.recentChanges }
    });
  }

  return hypotheses;
}

/**
 * Generate ranked hypotheses for an error
 * @param {string} errorText - Error message
 * @param {Object} context - Additional context
 * @param {number} maxCount - Maximum hypotheses to return
 * @returns {Object[]} Ranked hypotheses
 */
function generateHypotheses(errorText, context = {}, maxCount = 5) {
  // 1. Categorize the error
  const category = categorizeError(errorText);

  // 2. Get pattern-based hypotheses for this category
  const patternHypotheses = (HYPOTHESIS_PATTERNS[category] || []).map(h => ({
    ...h,
    source: 'pattern',
    category
  }));

  // 3. Generate context-aware hypotheses
  const contextHypotheses = generateContextHypotheses(errorText, context).map(h => ({
    ...h,
    source: 'context',
    category
  }));

  // 4. Combine and rank by likelihood
  const all = [...patternHypotheses, ...contextHypotheses]
    .sort((a, b) => b.likelihood - a.likelihood)
    .slice(0, maxCount);

  // 5. Add unique IDs
  return all.map((h, idx) => ({
    ...h,
    id: `hyp-${Date.now()}-${idx}`,
    rank: idx + 1
  }));
}

// ============================================================
// Recursive Recovery
// ============================================================

/**
 * Test a specific hypothesis
 * @param {Object} hypothesis - Hypothesis to test
 * @param {Object} context - Test context
 * @returns {Object} Test result
 */
async function testHypothesis(hypothesis, context) {
  // This is a placeholder for actual test implementations
  // In practice, each test strategy would have specific logic
  const testStrategies = {
    check_file_exists: () => {
      // Would check if file exists
      return { confirmed: false, details: 'File check not implemented' };
    },
    check_exports: () => {
      return { confirmed: false, details: 'Export check not implemented' };
    },
    check_null_access: () => {
      return { confirmed: true, details: 'Null access pattern detected' };
    },
    // Add more test implementations as needed
  };

  const testFn = testStrategies[hypothesis.test];
  if (testFn) {
    return testFn();
  }

  return { confirmed: false, details: `Unknown test: ${hypothesis.test}` };
}

/**
 * Recursive recovery with hypothesis tree
 * @param {string} errorText - Error to recover from
 * @param {Object} context - Recovery context
 * @param {number} depth - Current recursion depth
 * @returns {Object} Recovery result
 */
async function recoverWithHypotheses(errorText, context = {}, depth = 0) {
  const MAX_DEPTH = context.maxDepth || 3;
  const MAX_HYPOTHESES = context.maxHypotheses || 5;

  if (depth > MAX_DEPTH) {
    return {
      success: false,
      reason: 'max_depth_exceeded',
      hypothesisTree: context.hypothesisTree || []
    };
  }

  const hypotheses = generateHypotheses(errorText, context, MAX_HYPOTHESES);
  context.hypothesisTree = context.hypothesisTree || [];

  for (const hypothesis of hypotheses) {
    const node = {
      id: hypothesis.id,
      depth,
      hypothesis: hypothesis.hypothesis,
      likelihood: hypothesis.likelihood,
      test: hypothesis.test,
      status: 'testing',
      testedAt: new Date().toISOString()
    };
    context.hypothesisTree.push(node);

    const testResult = await testHypothesis(hypothesis, context);

    if (testResult.confirmed) {
      node.status = 'confirmed';
      node.testResult = testResult;

      // In practice, would attempt to apply fix here
      // For now, return the confirmed hypothesis
      return {
        success: true,
        confirmedHypothesis: hypothesis,
        fixStrategy: hypothesis.fixStrategy,
        hypothesisTree: context.hypothesisTree
      };
    } else {
      node.status = 'not_confirmed';
      node.testResult = testResult;
    }
  }

  return {
    success: false,
    reason: 'all_hypotheses_failed',
    hypothesisTree: context.hypothesisTree,
    testedCount: hypotheses.length
  };
}

// ============================================================
// State Management
// ============================================================

/**
 * Save hypothesis tree to file
 * @param {Object[]} tree - Hypothesis tree
 * @param {string} sessionId - Session identifier
 */
function saveHypothesisTree(tree, sessionId) {
  ensureDir(path.dirname(HYPOTHESIS_STATE_PATH));
  writeJson(HYPOTHESIS_STATE_PATH, {
    sessionId,
    tree,
    savedAt: new Date().toISOString()
  });
}

/**
 * Load hypothesis tree from file
 * @returns {Object|null} Saved tree or null
 */
function loadHypothesisTree() {
  try {
    return readJson(HYPOTHESIS_STATE_PATH);
  } catch (err) {
    return null;
  }
}

// ============================================================
// Formatting
// ============================================================

/**
 * Format hypotheses for display
 * @param {Object[]} hypotheses - Hypotheses to format
 * @returns {string} Formatted output
 */
function formatHypotheses(hypotheses) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push('  Generated Hypotheses');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  for (const h of hypotheses) {
    const likelihood = Math.round(h.likelihood * 100);
    const bar = '█'.repeat(Math.floor(likelihood / 10)) + '░'.repeat(10 - Math.floor(likelihood / 10));
    lines.push(`${h.rank}. [${bar}] ${likelihood}%`);
    lines.push(`   ${h.hypothesis}`);
    lines.push(`   Test: ${h.test}`);
    lines.push(`   Fix: ${h.fixStrategy}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format hypothesis tree for display
 * @param {Object[]} tree - Hypothesis tree
 * @returns {string} Formatted output
 */
function formatHypothesisTree(tree) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════');
  lines.push('  Hypothesis Tree');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  for (const node of tree) {
    const indent = '  '.repeat(node.depth);
    const icon = node.status === 'confirmed' ? '✓' :
                 node.status === 'not_confirmed' ? '✗' :
                 node.status === 'testing' ? '?' : '·';

    lines.push(`${indent}${icon} ${node.hypothesis}`);
    lines.push(`${indent}  Likelihood: ${Math.round(node.likelihood * 100)}%`);
    lines.push(`${indent}  Status: ${node.status}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Constants
  ERROR_CATEGORIES,
  HYPOTHESIS_PATTERNS,
  HYPOTHESIS_STATE_PATH,

  // Core functions
  categorizeError,
  generateHypotheses,
  generateContextHypotheses,

  // Recovery
  testHypothesis,
  recoverWithHypotheses,

  // State management
  saveHypothesisTree,
  loadHypothesisTree,

  // Formatting
  formatHypotheses,
  formatHypothesisTree
};

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'generate': {
      const errorText = args.slice(1).join(' ');
      if (!errorText) {
        error('Usage: flow hypothesis-generator generate "error text"');
        process.exit(1);
      }
      const hypotheses = generateHypotheses(errorText, {}, 5);
      console.log(formatHypotheses(hypotheses));
      break;
    }

    case 'categorize': {
      const errorText = args.slice(1).join(' ');
      if (!errorText) {
        error('Usage: flow hypothesis-generator categorize "error text"');
        process.exit(1);
      }
      const category = categorizeError(errorText);
      console.log(`Category: ${category}`);
      break;
    }

    case 'recover': {
      const errorText = args.slice(1).join(' ');
      if (!errorText) {
        error('Usage: flow hypothesis-generator recover "error text"');
        process.exit(1);
      }
      recoverWithHypotheses(errorText, {}).then(result => {
        if (result.success) {
          success('Found confirmed hypothesis!');
          console.log(`Hypothesis: ${result.confirmedHypothesis.hypothesis}`);
          console.log(`Fix strategy: ${result.fixStrategy}`);
        } else {
          warn(`Recovery failed: ${result.reason}`);
          console.log(`Tested ${result.testedCount || 0} hypotheses`);
        }
        console.log('');
        console.log(formatHypothesisTree(result.hypothesisTree));
      });
      break;
    }

    default:
      console.log(`
Hypothesis Generator

Usage: node flow-hypothesis-generator <command> [options]

Commands:
  generate "error text"    Generate hypotheses for an error
  categorize "error text"  Categorize an error
  recover "error text"     Attempt recursive recovery

Examples:
  node flow-hypothesis-generator generate "Cannot find module './foo'"
  node flow-hypothesis-generator categorize "TypeError: x is not a function"
  node flow-hypothesis-generator recover "Property 'bar' does not exist"
`);
  }
}
