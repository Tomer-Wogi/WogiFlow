#!/usr/bin/env node

/**
 * Logic Pass - Business logic, edge cases, algorithm correctness
 *
 * This pass focuses on the implementation logic of the code.
 * Uses pattern matching for common logic issues and can call
 * Sonnet for more nuanced analysis.
 *
 * Checks:
 * - Error handling patterns
 * - Edge case coverage
 * - Async/await correctness
 * - State management patterns
 * - Algorithm complexity hints
 */

const path = require('path');
const { readFile, PATHS, getConfig } = require('../flow-utils');

/**
 * Error handling patterns to check
 */
const ERROR_HANDLING_PATTERNS = [
  {
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    severity: 'high',
    message: 'Empty catch block - errors are being silently swallowed',
    type: 'error-handling'
  },
  {
    pattern: /catch\s*\([^)]*\)\s*\{\s*console\.(log|error)\([^)]+\)\s*;?\s*\}/g,
    severity: 'medium',
    message: 'Catch block only logs error - consider proper error handling/recovery',
    type: 'error-handling'
  },
  {
    pattern: /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,
    severity: 'high',
    message: 'Promise catch with empty handler - errors silently ignored',
    type: 'error-handling'
  },
  {
    pattern: /throw\s+['"][^'"]+['"]/g,
    severity: 'medium',
    message: 'Throwing string instead of Error object - use new Error()',
    type: 'error-handling'
  }
];

/**
 * Async/await patterns to check
 */
const ASYNC_PATTERNS = [
  {
    pattern: /await\s+\[\s*[\s\S]*?\]/g,
    check: (match) => !match.includes('Promise.all'),
    severity: 'medium',
    message: 'Awaiting array directly - should use Promise.all() for parallel execution',
    type: 'async'
  },
  {
    pattern: /for\s*\([^)]+\)\s*\{[^}]*await\s+/g,
    severity: 'info',
    message: 'Sequential await in loop - consider Promise.all() for parallelization',
    type: 'async'
  },
  {
    pattern: /async\s+function[^{]+\{[^}]*\}/g,
    check: (match) => !match.includes('await') && !match.includes('return'),
    severity: 'low',
    message: 'Async function without await - may not need async',
    type: 'async'
  },
  {
    pattern: /new\s+Promise\s*\(\s*async/g,
    severity: 'high',
    message: 'Async function inside Promise constructor - this is an anti-pattern',
    type: 'async'
  },
  {
    pattern: /\.then\([^)]+\)\.catch\([^)]+\)\s*;\s*return/g,
    severity: 'medium',
    message: 'Promise chain not awaited before return - potential race condition',
    type: 'async'
  }
];

/**
 * State management patterns
 */
const STATE_PATTERNS = [
  {
    pattern: /useState\s*\([^)]*\)\s*;\s*[\s\S]{0,200}?set\w+\([^)]+\)\s*;\s*set\w+\(/g,
    severity: 'info',
    message: 'Multiple state updates - consider batching or using useReducer',
    type: 'state'
  },
  {
    pattern: /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*set\w+\([^)]+\)/g,
    check: (match) => !match.includes('[]') && !match.includes('cleanup'),
    severity: 'medium',
    message: 'State update in useEffect without proper dependencies - potential infinite loop',
    type: 'state'
  },
  {
    pattern: /let\s+\w+\s*=\s*[^;]+;\s*[\s\S]*?\1\s*=/g,
    severity: 'info',
    message: 'Mutable variable reassigned - consider using const or functional approach',
    type: 'state'
  }
];

/**
 * Logic/algorithm patterns
 */
const ALGORITHM_PATTERNS = [
  {
    pattern: /\.filter\([^)]+\)\.map\(/g,
    severity: 'info',
    message: 'filter().map() chain - consider combining for efficiency',
    type: 'algorithm'
  },
  {
    pattern: /for\s*\([^)]+\)\s*\{[^}]*\.indexOf\(/g,
    severity: 'info',
    message: 'indexOf in loop - O(n²) complexity, consider using Set/Map',
    type: 'algorithm'
  },
  {
    pattern: /for\s*\([^)]+\)\s*\{[^}]*for\s*\([^)]+\)\s*\{/g,
    severity: 'info',
    message: 'Nested loops detected - O(n²) or worse, verify this is necessary',
    type: 'algorithm'
  },
  {
    pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g,
    severity: 'low',
    message: 'Deep clone via JSON - consider structuredClone() or lodash.cloneDeep()',
    type: 'algorithm'
  },
  {
    pattern: /\.sort\(\s*\)\s*\[0\]/g,
    severity: 'info',
    message: 'Sorting to find min/max - use Math.min/max with spread for better performance',
    type: 'algorithm'
  }
];

/**
 * Edge case patterns
 */
const EDGE_CASE_PATTERNS = [
  {
    pattern: /\[\s*0\s*\]/g,
    context: (content, index) => {
      // Check if there's a length check before this
      const before = content.substring(Math.max(0, index - 100), index);
      return !before.includes('.length') && !before.includes('if (');
    },
    severity: 'medium',
    message: 'Accessing [0] without checking array existence/length',
    type: 'edge-case'
  },
  {
    pattern: /\.split\([^)]+\)\[(\d+)\]/g,
    severity: 'medium',
    message: 'Accessing split result by index without bounds check',
    type: 'edge-case'
  },
  {
    pattern: /parseInt\([^,)]+\)/g,
    severity: 'low',
    message: 'parseInt without radix parameter - always specify radix (e.g., parseInt(x, 10))',
    type: 'edge-case'
  },
  {
    pattern: /===\s*null\s*\|\|[^|]*===\s*undefined|===\s*undefined\s*\|\|[^|]*===\s*null/g,
    severity: 'info',
    message: 'Checking null || undefined - consider using == null (loose equality)',
    type: 'edge-case'
  }
];

/**
 * Check file for logic issues
 * @param {Object} file - File object with path and content
 * @param {Object} context - Review context
 * @returns {Object[]} Array of issues
 */
function checkFileLogic(file, context) {
  const issues = [];
  const content = file.content || '';
  const isTestFile = /\.(test|spec)\.[tj]sx?$/.test(file.path);

  // Skip test files for some checks
  const allPatterns = [
    ...ERROR_HANDLING_PATTERNS,
    ...ASYNC_PATTERNS,
    ...STATE_PATTERNS,
    ...ALGORITHM_PATTERNS,
    ...EDGE_CASE_PATTERNS
  ];

  for (const patternDef of allPatterns) {
    // Skip certain patterns in test files
    if (isTestFile && ['algorithm', 'state'].includes(patternDef.type)) {
      continue;
    }

    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      // Run additional check if defined
      if (patternDef.check && !patternDef.check(match[0])) {
        continue;
      }

      // Run context check if defined
      if (patternDef.context && !patternDef.context(content, match.index)) {
        continue;
      }

      // Find line number
      const lineNumber = content.substring(0, match.index).split('\n').length;

      issues.push({
        severity: patternDef.severity,
        message: patternDef.message,
        file: file.path,
        line: lineNumber,
        type: patternDef.type,
        snippet: match[0].substring(0, 50) + (match[0].length > 50 ? '...' : '')
      });
    }
  }

  return issues;
}

/**
 * Analyze function complexity (basic heuristic)
 * @param {string} content - File content
 * @returns {Object[]} Complexity issues
 */
function analyzeComplexity(content, filePath) {
  const issues = [];

  // Count nesting depth
  // Note: This is a simplified heuristic that doesn't perfectly handle
  // template literal interpolations `${...}` but is good enough for most cases
  let maxNesting = 0;
  let currentNesting = 0;
  let inString = false;
  let stringChar = null;
  let templateDepth = 0; // Track nested template literal interpolations

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const prev = content[i - 1];
    const next = content[i + 1];

    // Track template literal interpolation entry/exit
    if (stringChar === '`' && inString && char === '$' && next === '{') {
      templateDepth++;
      inString = false; // We're now in code inside ${...}
      continue;
    }

    // Track string state (but not when inside template interpolation)
    if ((char === '"' || char === "'" || char === '`') && prev !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar && templateDepth === 0) {
        inString = false;
        stringChar = null;
      }
    }

    if (!inString) {
      if (char === '{') {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === '}') {
        // Check if this closes a template interpolation
        if (templateDepth > 0 && stringChar === '`') {
          templateDepth--;
          inString = true; // Back inside the template literal
        }
        currentNesting--;
      }
    }
  }

  if (maxNesting > 4) {
    issues.push({
      severity: 'medium',
      message: `High nesting depth (${maxNesting} levels) - consider refactoring`,
      file: filePath,
      type: 'complexity'
    });
  }

  // Count functions
  const functionMatches = content.match(/function\s+\w+|=>\s*\{|async\s+\(/g) || [];
  if (functionMatches.length > 20) {
    issues.push({
      severity: 'info',
      message: `File has ${functionMatches.length} functions - consider splitting`,
      file: filePath,
      type: 'complexity'
    });
  }

  // Count lines
  const lines = content.split('\n').length;
  if (lines > 500) {
    issues.push({
      severity: 'info',
      message: `File has ${lines} lines - consider splitting into modules`,
      file: filePath,
      type: 'complexity'
    });
  }

  return issues;
}

/**
 * Run the logic pass
 * @param {Object} context - Review context
 * @returns {Promise<Object>} Pass results
 */
async function run(context) {
  const { files = [], previousResults = {} } = context;

  const issues = [];
  const suggestions = [];
  const filesToExamine = [];
  const metrics = {
    filesChecked: 0,
    issuesByType: {},
    complexityFlags: 0
  };

  // Focus on files flagged by structure pass if available
  const priorityFiles = previousResults.structure?.filesToExamine || [];
  const filesToCheck = priorityFiles.length > 0
    ? files.filter(f => priorityFiles.includes(f.path) || !previousResults.structure)
    : files;

  // Check each file
  for (const file of filesToCheck) {
    metrics.filesChecked++;

    // Logic pattern checks
    const logicIssues = checkFileLogic(file, context);
    for (const issue of logicIssues) {
      issues.push(issue);
      metrics.issuesByType[issue.type] = (metrics.issuesByType[issue.type] || 0) + 1;
    }

    // Complexity analysis
    const complexityIssues = analyzeComplexity(file.content || '', file.path);
    if (complexityIssues.length > 0) {
      issues.push(...complexityIssues);
      metrics.complexityFlags++;
      filesToExamine.push(file.path);
    }

    // High-severity issues flag file for security review
    if (logicIssues.some(i => i.severity === 'high')) {
      filesToExamine.push(file.path);
    }
  }

  // Dedupe filesToExamine
  const uniqueFilesToExamine = [...new Set(filesToExamine)];

  // Generate suggestions based on issues
  if (metrics.issuesByType['error-handling'] > 3) {
    suggestions.push({
      message: 'Multiple error handling issues - consider establishing error handling patterns',
      priority: 'high'
    });
  }

  if (metrics.issuesByType['async'] > 2) {
    suggestions.push({
      message: 'Async patterns need attention - review Promise handling conventions',
      priority: 'medium'
    });
  }

  if (metrics.issuesByType['edge-case'] > 3) {
    suggestions.push({
      message: 'Multiple edge case gaps - consider adding defensive checks or validation',
      priority: 'medium'
    });
  }

  if (metrics.complexityFlags > 2) {
    suggestions.push({
      message: 'High complexity in multiple files - prioritize refactoring',
      priority: 'high'
    });
  }

  return {
    issues,
    suggestions,
    filesToExamine: uniqueFilesToExamine,
    metrics
  };
}

module.exports = { run };
