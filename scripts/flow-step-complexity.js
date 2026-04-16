#!/usr/bin/env node

/**
 * Wogi Flow - Code Complexity Check Step
 *
 * Analyzes cyclomatic complexity of modified files.
 * Flags functions that exceed the configured threshold.
 */

const { BaseWorkflowStep } = require('./base-workflow-step');
const { colors } = require('./flow-utils');

class ComplexityStep extends BaseWorkflowStep {
  constructor() {
    super('codeComplexityCheck', {
      extensions: ['.js', '.ts', '.jsx', '.tsx'],
      excludeTests: true,
      excludeDts: true,
    });
  }

  async execute(files, options) {
    const { stepConfig = {} } = options;
    const threshold = stepConfig.threshold || 10;
    const complexFunctions = [];

    for (const file of files) {
      const content = this.readFile(file);
      if (!content) continue;

      try {
        const functions = analyzeComplexity(content, file);

        for (const func of functions) {
          if (func.complexity > threshold) {
            complexFunctions.push({
              file,
              function: func.name,
              complexity: func.complexity,
              line: func.line,
              suggestion: getSuggestion(func.complexity, threshold),
            });
          }
        }
      } catch (_err) {
        // Skip files that can't be analyzed
      }
    }

    if (complexFunctions.length === 0) {
      return this.pass(`All functions under complexity threshold (${threshold})`);
    }

    // Report complex functions
    console.log(colors.yellow + `\n  Functions exceeding complexity threshold (${threshold}):` + colors.reset);
    for (const func of complexFunctions) {
      console.log(`    ${func.file}:${func.line} - ${func.function} (${func.complexity})`);
      console.log(colors.gray + `      ${func.suggestion}` + colors.reset);
    }

    return this.fail(
      `${complexFunctions.length} function(s) exceed complexity threshold`,
      complexFunctions
    );
  }
}

/**
 * Analyze cyclomatic complexity of functions in code
 *
 * Uses a simplified heuristic approach:
 * - Base complexity: 1
 * - +1 for each: if, else if, for, while, case, catch, &&, ||, ?, ??
 */
function analyzeComplexity(content, _fileName) {
  const functions = [];

  // Match function declarations and expressions
  const functionPatterns = [
    // function name() {}
    /function\s+(\w+)\s*\([^)]*\)\s*\{/g,
    // const name = function() {}
    /(?:const|let|var)\s+(\w+)\s*=\s*function\s*\([^)]*\)\s*\{/g,
    // const name = () => {}
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    // const name = async () => {}
    /(?:const|let|var)\s+(\w+)\s*=\s*async\s+\([^)]*\)\s*=>/g,
    // method() {} in class
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm,
  ];

  // Split content into lines for line number tracking
  const lines = content.split('\n');

  // Simple approach: find function boundaries and count complexity indicators
  let currentFunction = null;
  let braceCount = 0;
  let functionStart = 0;
  let functionContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for function start
    if (!currentFunction) {
      for (const pattern of functionPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          currentFunction = match[1] || 'anonymous';
          functionStart = i + 1;
          braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          functionContent = line;

          // Arrow functions without braces
          if (line.includes('=>') && !line.includes('{')) {
            const complexity = calculateLineComplexity(line);
            functions.push({
              name: currentFunction,
              line: functionStart,
              complexity: 1 + complexity,
            });
            currentFunction = null;
          }
          break;
        }
      }
    } else {
      // Track braces
      braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      functionContent += '\n' + line;

      // Function ended
      if (braceCount <= 0) {
        const complexity = calculateComplexity(functionContent);
        functions.push({
          name: currentFunction,
          line: functionStart,
          complexity,
        });
        currentFunction = null;
        functionContent = '';
      }
    }
  }

  return functions;
}

/**
 * Calculate cyclomatic complexity of a code block
 */
function calculateComplexity(code) {
  let complexity = 1; // Base complexity

  // Decision points
  const patterns = [
    /\bif\s*\(/g,           // if statements
    /\belse\s+if\s*\(/g,    // else if (already counted in if, subtract)
    /\bfor\s*\(/g,          // for loops
    /\bwhile\s*\(/g,        // while loops
    /\bcase\s+[^:]+:/g,     // switch cases
    /\bcatch\s*\(/g,        // catch blocks
    /\?\s*[^:]+:/g,         // ternary operators
    /&&/g,                  // logical AND
    /\|\|/g,                // logical OR
    /\?\?/g,                // nullish coalescing
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  // Subtract double-counted else if
  const elseIfMatches = code.match(/\belse\s+if\s*\(/g);
  if (elseIfMatches) {
    complexity -= elseIfMatches.length;
  }

  return complexity;
}

/**
 * Calculate complexity for a single line (arrow functions)
 */
function calculateLineComplexity(line) {
  let complexity = 0;

  if (line.includes('?') && line.includes(':')) complexity += 1;
  complexity += (line.match(/&&/g) || []).length;
  complexity += (line.match(/\|\|/g) || []).length;
  complexity += (line.match(/\?\?/g) || []).length;

  return complexity;
}

/**
 * Get suggestion for reducing complexity
 */
function getSuggestion(complexity, threshold) {
  if (complexity > threshold * 2) {
    return 'Consider breaking into multiple smaller functions';
  }
  if (complexity > threshold * 1.5) {
    return 'Consider extracting some logic into helper functions';
  }
  return 'Consider simplifying conditional logic';
}

const step = new ComplexityStep();
module.exports = { run: (opts) => step.run(opts), analyzeComplexity, calculateComplexity };
