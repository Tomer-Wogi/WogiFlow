#!/usr/bin/env node

/**
 * Wogi Flow - Code Simplifier Step
 *
 * AI-powered code simplification suggestions.
 * Analyzes: nested conditionals, long functions, deep coupling.
 * Provides specific refactoring suggestions with file:line refs.
 *
 * This is a QUALITATIVE analysis (vs codeComplexityCheck which is QUANTITATIVE).
 * Both can be enabled together for comprehensive analysis.
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, colors } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

/**
 * Run code simplifier analysis step
 *
 * @param {object} options
 * @param {string[]} options.files - Files modified
 * @param {object} options.stepConfig - Step configuration
 * @param {string} options.mode - Step mode (block/warn/prompt/auto)
 * @returns {object} - { passed: boolean, message: string, details?: object[] }
 */
async function run(options = {}) {
  const { files = [], stepConfig = {} } = options;
  const maxFunctionLines = stepConfig.maxFunctionLines || 50;
  const maxNestingDepth = stepConfig.maxNestingDepth || 3;
  const suggestExtraction = stepConfig.suggestExtraction !== false;

  // Filter to analyzable files
  const analyzableExtensions = ['.js', '.ts', '.jsx', '.tsx'];
  const analyzableFiles = files.filter(f =>
    analyzableExtensions.some(ext => f.endsWith(ext)) &&
    !f.includes('.test.') &&
    !f.includes('.spec.') &&
    !f.includes('.d.ts')
  );

  if (analyzableFiles.length === 0) {
    return { passed: true, message: 'No analyzable files modified' };
  }

  const suggestions = [];

  for (const file of analyzableFiles) {
    const filePath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileSuggestions = analyzeForSimplification(content, file, {
        maxFunctionLines,
        maxNestingDepth,
        suggestExtraction,
      });
      suggestions.push(...fileSuggestions);
    } catch (err) {
      // Skip files that can't be analyzed
    }
  }

  if (suggestions.length === 0) {
    return {
      passed: true,
      message: 'No simplification suggestions',
    };
  }

  // Report suggestions
  console.log(colors.cyan + '\n  Code Simplification Suggestions:' + colors.reset);
  for (const suggestion of suggestions) {
    const icon = suggestion.severity === 'high' ? '\u{1F534}' : '\u{1F7E1}';
    console.log(`    ${icon} ${suggestion.file}:${suggestion.line}`);
    console.log(`       ${suggestion.type}: ${suggestion.message}`);
    if (suggestion.suggestion) {
      console.log(colors.dim + `       \u{2192} ${suggestion.suggestion}` + colors.reset);
    }
  }

  // Mode determines if this blocks
  const highSeverity = suggestions.filter(s => s.severity === 'high');

  return {
    passed: highSeverity.length === 0,
    message: `${suggestions.length} simplification suggestion(s) (${highSeverity.length} high severity)`,
    details: suggestions,
  };
}

/**
 * Analyze code for simplification opportunities
 */
function analyzeForSimplification(content, fileName, config) {
  const suggestions = [];
  const lines = content.split('\n');

  // Track function boundaries and analyze each
  let inFunction = false;
  let functionName = '';
  let functionStart = 0;
  let functionLines = [];
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect function start
    const funcMatch = line.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?.*?\)?\s*=>|(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{)/);
    if (funcMatch && !inFunction) {
      inFunction = true;
      functionName = funcMatch[1] || funcMatch[2] || funcMatch[3] || 'anonymous';
      functionStart = i + 1;
      functionLines = [line];
      braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

      // Arrow function without braces
      if (line.includes('=>') && !line.includes('{')) {
        inFunction = false;
        continue;
      }
      continue;
    }

    if (inFunction) {
      functionLines.push(line);
      braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

      if (braceCount <= 0) {
        // Analyze the complete function
        const funcSuggestions = analyzeFunctionForSimplification(
          functionLines,
          functionName,
          functionStart,
          fileName,
          config
        );
        suggestions.push(...funcSuggestions);
        inFunction = false;
        functionLines = [];
      }
    }

    // Check for deeply nested structures anywhere
    const nestingDepth = countNestingDepth(line);
    if (nestingDepth > config.maxNestingDepth) {
      suggestions.push({
        file: fileName,
        line: i + 1,
        type: 'Deep Nesting',
        severity: nestingDepth > config.maxNestingDepth + 2 ? 'high' : 'medium',
        message: `Nesting depth ${nestingDepth} exceeds threshold ${config.maxNestingDepth}`,
        suggestion: 'Consider early returns, guard clauses, or extracting to helper functions',
      });
    }
  }

  // Check for code duplication patterns
  const duplicationSuggestions = findDuplicationPatterns(content, fileName);
  suggestions.push(...duplicationSuggestions);

  return suggestions;
}

/**
 * Analyze a single function for simplification
 */
function analyzeFunctionForSimplification(lines, funcName, startLine, fileName, config) {
  const suggestions = [];
  const content = lines.join('\n');

  // Check function length
  if (lines.length > config.maxFunctionLines) {
    suggestions.push({
      file: fileName,
      line: startLine,
      type: 'Long Function',
      severity: lines.length > config.maxFunctionLines * 2 ? 'high' : 'medium',
      message: `Function "${funcName}" is ${lines.length} lines (max ${config.maxFunctionLines})`,
      suggestion: config.suggestExtraction
        ? 'Consider extracting logical sections into separate functions'
        : 'Consider breaking into smaller functions',
    });
  }

  // Check for multiple responsibilities (many different operations)
  const operations = countOperationTypes(content);
  if (operations.types > 4) {
    suggestions.push({
      file: fileName,
      line: startLine,
      type: 'Multiple Responsibilities',
      severity: 'medium',
      message: `Function "${funcName}" appears to have ${operations.types} different operation types`,
      suggestion: 'Consider Single Responsibility Principle - one function, one purpose',
    });
  }

  // Check for nested callbacks (callback hell)
  const callbackDepth = countCallbackDepth(content);
  if (callbackDepth > 2) {
    suggestions.push({
      file: fileName,
      line: startLine,
      type: 'Callback Nesting',
      severity: callbackDepth > 4 ? 'high' : 'medium',
      message: `Function "${funcName}" has ${callbackDepth} levels of callback nesting`,
      suggestion: 'Consider using async/await, Promise.all, or extracting callbacks',
    });
  }

  // Check for complex conditionals
  const complexConditions = findComplexConditions(content);
  for (const condition of complexConditions) {
    suggestions.push({
      file: fileName,
      line: startLine + condition.lineOffset,
      type: 'Complex Condition',
      severity: condition.complexity > 4 ? 'high' : 'medium',
      message: `Complex conditional with ${condition.complexity} clauses`,
      suggestion: 'Consider extracting to a named boolean variable or function',
    });
  }

  return suggestions;
}

/**
 * Count nesting depth at a line
 */
function countNestingDepth(line) {
  const leading = line.match(/^(\s*)/)?.[1] || '';
  // Approximate: 2 spaces or 1 tab per level
  const spaces = leading.replace(/\t/g, '  ').length;
  return Math.floor(spaces / 2);
}

/**
 * Count different operation types in code
 */
function countOperationTypes(content) {
  const types = new Set();

  if (/fetch|axios|http/i.test(content)) types.add('api');
  if (/querySelector|getElementById|document\./i.test(content)) types.add('dom');
  if (/localStorage|sessionStorage|cookie/i.test(content)) types.add('storage');
  if (/console\.|log\(/i.test(content)) types.add('logging');
  if (/fs\.|readFile|writeFile/i.test(content)) types.add('filesystem');
  if (/\.map\(|\.filter\(|\.reduce\(/i.test(content)) types.add('transformation');
  if (/throw\s+|new Error|reject\(/i.test(content)) types.add('error-handling');
  if (/setState|useState|dispatch/i.test(content)) types.add('state');

  return { types: types.size, list: Array.from(types) };
}

/**
 * Count callback nesting depth
 */
function countCallbackDepth(content) {
  let maxDepth = 0;
  let currentDepth = 0;

  // Count by looking for callback patterns
  const lines = content.split('\n');
  for (const line of lines) {
    if (/\(\s*(?:function|\([^)]*\)\s*=>|async\s*\()/.test(line)) {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
    if (/\}\s*\)/.test(line)) {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  return maxDepth;
}

/**
 * Find complex conditional expressions
 */
function findComplexConditions(content) {
  const conditions = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bif\s*\(/.test(line) || /\?\s*[^:]+:/.test(line)) {
      const andOr = (line.match(/&&|\|\|/g) || []).length;
      const ternary = (line.match(/\?[^:]*:/g) || []).length;
      const complexity = andOr + ternary;

      if (complexity >= 3) {
        conditions.push({
          lineOffset: i,
          complexity,
        });
      }
    }
  }

  return conditions;
}

/**
 * Find potential code duplication patterns
 */
function findDuplicationPatterns(content, fileName) {
  const suggestions = [];
  const lines = content.split('\n');

  // Look for repeated patterns (simplified)
  const patterns = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length > 20 && !line.startsWith('//') && !line.startsWith('*')) {
      // Normalize the line for comparison
      const normalized = line.replace(/\s+/g, ' ').replace(/['"`][^'"`]*['"`]/g, '""');
      if (!patterns[normalized]) {
        patterns[normalized] = [];
      }
      patterns[normalized].push(i + 1);
    }
  }

  // Report lines that appear 3+ times
  for (const [pattern, lineNumbers] of Object.entries(patterns)) {
    if (lineNumbers.length >= 3) {
      suggestions.push({
        file: fileName,
        line: lineNumbers[0],
        type: 'Code Duplication',
        severity: lineNumbers.length >= 5 ? 'high' : 'medium',
        message: `Similar code appears ${lineNumbers.length} times (lines: ${lineNumbers.slice(0, 5).join(', ')}...)`,
        suggestion: 'Consider extracting to a reusable function or constant',
      });
    }
  }

  return suggestions;
}

module.exports = { run, analyzeForSimplification };
