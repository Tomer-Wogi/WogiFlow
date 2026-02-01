#!/usr/bin/env node

/**
 * Wogi Flow - Solution Optimizer (Phase 4)
 *
 * Agent 5: Suggests better technical approaches and UX improvements
 *
 * Unlike Phase 3 (Standards Compliance), these suggestions are NON-BLOCKING.
 * They're recommendations for improvement, not violations.
 *
 * What it evaluates:
 * 1. Technical alternatives - simpler libraries, better algorithms, built-in solutions
 * 2. UX improvements - loading states, error messages, accessibility
 * 3. Best practices - industry patterns, modern approaches
 *
 * v1.0 - Initial implementation
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Pattern Definitions
// ============================================================

/**
 * Technical optimization patterns
 * These detect code that could be simplified or improved
 */
const TECHNICAL_PATTERNS = [
  // Array operations that could be optimized
  {
    id: 'array-filter-map-to-reduce',
    name: 'Filter+Map could be reduce()',
    pattern: /\.filter\([^)]+\)\.map\([^)]+\)/g,
    priority: 'Low',
    suggestion: 'Array.filter().map() could be combined into Array.reduce() for single-pass iteration',
    category: 'performance'
  },
  {
    id: 'array-find-index',
    name: 'find() vs findIndex()',
    pattern: /\.findIndex\([^)]+\)\s*(?:!==?\s*-1|>=?\s*0)/g,
    priority: 'Low',
    suggestion: 'Consider using .find() if you need the element, not just existence check',
    category: 'clarity'
  },

  // Date handling
  {
    id: 'manual-date-formatting',
    name: 'Manual date formatting',
    pattern: /new Date\([^)]*\)\.(?:getFullYear|getMonth|getDate|getHours|getMinutes)\(\)/g,
    priority: 'Medium',
    suggestion: 'Manual date formatting detected. Consider using date-fns or Intl.DateTimeFormat',
    category: 'maintainability'
  },
  {
    id: 'date-tostring-formatting',
    name: 'Date toString for display',
    pattern: /\.toISOString\(\)\.(?:slice|substring|split)/g,
    priority: 'Medium',
    suggestion: 'String manipulation on ISO date. Consider Intl.DateTimeFormat for locale-aware formatting',
    category: 'i18n'
  },

  // Async patterns
  {
    id: 'promise-all-sequential',
    name: 'Sequential awaits in loop',
    pattern: /for\s*\([^)]+\)\s*\{[^}]*await\s+/g,
    priority: 'Medium',
    suggestion: 'Sequential awaits in loop. Consider Promise.all() for parallel execution if order doesn\'t matter',
    category: 'performance'
  },
  {
    id: 'then-catch-chain',
    name: 'Promise chains vs async/await',
    pattern: /\.then\([^)]+\)\.then\([^)]+\)/g,
    priority: 'Low',
    suggestion: 'Nested .then() chains. Consider async/await for cleaner code',
    category: 'readability'
  },

  // Error handling
  {
    id: 'empty-catch',
    name: 'Empty catch block',
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    priority: 'High',
    suggestion: 'Empty catch block silently swallows errors. At minimum, log the error',
    category: 'error-handling'
  },
  {
    id: 'generic-error-message',
    name: 'Generic error message',
    pattern: /(?:throw new Error|console\.error)\s*\(\s*['"`](?:Error|Something went wrong|An error occurred)['"`]/gi,
    priority: 'Medium',
    suggestion: 'Generic error message provides no debugging context. Include specific details',
    category: 'debugging'
  },

  // String operations
  {
    id: 'string-concat-in-loop',
    name: 'String concatenation in loop',
    pattern: /(?:for|while)\s*\([^)]*\)\s*\{[^}]*\+=/g,
    priority: 'Low',
    suggestion: 'String concatenation in loop. Consider array.join() or template literals',
    category: 'performance'
  },

  // Modern JS
  {
    id: 'var-usage',
    name: 'var instead of const/let',
    pattern: /\bvar\s+\w+\s*=/g,
    priority: 'Low',
    suggestion: 'Using var instead of const/let. Prefer const for immutability, let for reassignment',
    category: 'modern-js'
  },

  // React-specific
  {
    id: 'inline-style-object',
    name: 'Inline style object in JSX',
    pattern: /style=\{\s*\{[^}]+\}\s*\}/g,
    priority: 'Low',
    suggestion: 'Inline style object creates new reference on each render. Consider useMemo or CSS classes',
    category: 'react-performance',
    fileTypes: ['.jsx', '.tsx']
  },
  {
    id: 'anonymous-function-prop',
    name: 'Anonymous function as prop',
    pattern: /(?:onClick|onChange|onSubmit)=\{\s*\([^)]*\)\s*=>/g,
    priority: 'Low',
    suggestion: 'Anonymous arrow function as event handler creates new reference each render. Consider useCallback',
    category: 'react-performance',
    fileTypes: ['.jsx', '.tsx']
  }
];

/**
 * UX improvement patterns
 * These detect UI code that could provide better user experience
 */
const UX_PATTERNS = [
  // Loading states
  {
    id: 'missing-loading-state',
    name: 'Missing loading state',
    pattern: /(?:async\s+function|fetch\(|axios\.|\.post\(|\.get\()(?!.*loading)/gi,
    priority: 'High',
    suggestion: 'Async operation without visible loading state. Users need feedback during network requests',
    category: 'loading-states'
  },

  // Error UX
  {
    id: 'technical-error-message-ui',
    name: 'Technical error shown to user',
    pattern: /(?:alert|toast|notification|showError)\s*\([^)]*(?:JSON\.parse|undefined|null|TypeError|ReferenceError)/gi,
    priority: 'High',
    suggestion: 'Technical error message may be shown to users. Consider user-friendly messages',
    category: 'error-ux'
  },
  {
    id: 'console-log-error',
    name: 'console.log for error',
    pattern: /catch\s*\([^)]+\)\s*\{[^}]*console\.log/g,
    priority: 'Medium',
    suggestion: 'Using console.log for errors. Use console.error for proper log levels',
    category: 'logging'
  },

  // Accessibility
  {
    id: 'missing-alt-attribute',
    name: 'Image without alt',
    pattern: /<img(?![^>]*\balt=)[^>]*>/gi,
    priority: 'High',
    suggestion: 'Image without alt attribute. Required for screen readers and accessibility',
    category: 'a11y',
    fileTypes: ['.jsx', '.tsx', '.html']
  },
  {
    id: 'click-on-div',
    name: 'Click handler on non-interactive element',
    pattern: /<(?:div|span)\s+[^>]*onClick/gi,
    priority: 'Medium',
    suggestion: 'Click handler on div/span. Consider using a button for keyboard accessibility',
    category: 'a11y',
    fileTypes: ['.jsx', '.tsx']
  },

  // Form UX
  {
    id: 'form-no-validation-message',
    name: 'Form without validation feedback',
    pattern: /(?:required|pattern=)[^>]*>(?!.*(?:error|invalid|helperText|validationMessage))/gi,
    priority: 'Medium',
    suggestion: 'Form validation without visible error messages. Users need feedback on invalid inputs',
    category: 'form-ux',
    fileTypes: ['.jsx', '.tsx']
  },
  {
    id: 'submit-no-disable',
    name: 'Submit button without disabled state',
    pattern: /type=["']submit["'](?![^>]*disabled)/gi,
    priority: 'Medium',
    suggestion: 'Submit button without disabled state. Consider disabling during submission',
    category: 'form-ux',
    fileTypes: ['.jsx', '.tsx', '.html']
  }
];

// ============================================================
// Analysis Functions
// ============================================================

/**
 * Analyze file content for optimization opportunities
 * @param {Object} file - File object with path and content
 * @returns {Object[]} Array of suggestions
 */
function analyzeFile(file) {
  const suggestions = [];
  const ext = path.extname(file.path);

  // Check technical patterns
  for (const pattern of TECHNICAL_PATTERNS) {
    // Skip if file type doesn't match
    if (pattern.fileTypes && !pattern.fileTypes.includes(ext)) {
      continue;
    }

    const matches = file.content.match(pattern.pattern);
    if (matches && matches.length > 0) {
      // Find line numbers for each match
      const lines = findPatternLines(file.content, pattern.pattern);

      suggestions.push({
        type: 'technical',
        id: pattern.id,
        name: pattern.name,
        priority: pattern.priority,
        suggestion: pattern.suggestion,
        category: pattern.category,
        file: file.path,
        lines: lines,
        matchCount: matches.length
      });
    }
  }

  // Check UX patterns
  for (const pattern of UX_PATTERNS) {
    // Skip if file type doesn't match
    if (pattern.fileTypes && !pattern.fileTypes.includes(ext)) {
      continue;
    }

    const matches = file.content.match(pattern.pattern);
    if (matches && matches.length > 0) {
      const lines = findPatternLines(file.content, pattern.pattern);

      suggestions.push({
        type: 'ux',
        id: pattern.id,
        name: pattern.name,
        priority: pattern.priority,
        suggestion: pattern.suggestion,
        category: pattern.category,
        file: file.path,
        lines: lines,
        matchCount: matches.length
      });
    }
  }

  return suggestions;
}

/**
 * Find line numbers where pattern matches
 * @param {string} content - File content
 * @param {RegExp} pattern - Pattern to find
 * @returns {number[]} Array of line numbers (1-indexed)
 */
function findPatternLines(content, pattern) {
  const lines = [];
  const contentLines = content.split('\n');

  // Create a new RegExp without global flag for line-by-line check
  const linePattern = new RegExp(pattern.source, pattern.flags.replace('g', ''));

  contentLines.forEach((line, idx) => {
    if (linePattern.test(line)) {
      lines.push(idx + 1);
    }
  });

  // If no individual line matches found, do full content match and estimate
  if (lines.length === 0) {
    const fullMatches = content.match(pattern);
    if (fullMatches) {
      // Try to find approximate locations
      let searchPos = 0;
      for (const match of fullMatches) {
        const pos = content.indexOf(match, searchPos);
        if (pos !== -1) {
          const lineNum = content.substring(0, pos).split('\n').length;
          lines.push(lineNum);
          searchPos = pos + match.length;
        }
      }
    }
  }

  return lines.slice(0, 5); // Limit to first 5 occurrences
}

/**
 * Run solution optimization analysis on changed files
 * @param {Object[]} files - Array of file objects with path and content
 * @returns {Object} Analysis results
 */
function runOptimizationAnalysis(files) {
  const allSuggestions = [];

  // Only analyze code files
  const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte'];
  const codeFiles = files.filter(f => codeExtensions.some(ext => f.path.endsWith(ext)));

  for (const file of codeFiles) {
    const fileSuggestions = analyzeFile(file);
    allSuggestions.push(...fileSuggestions);
  }

  // Group by type and priority
  const technical = allSuggestions.filter(s => s.type === 'technical');
  const ux = allSuggestions.filter(s => s.type === 'ux');

  const highPriority = allSuggestions.filter(s => s.priority === 'High');
  const mediumPriority = allSuggestions.filter(s => s.priority === 'Medium');
  const lowPriority = allSuggestions.filter(s => s.priority === 'Low');

  return {
    total: allSuggestions.length,
    suggestions: allSuggestions,
    byType: {
      technical: technical,
      ux: ux
    },
    byPriority: {
      high: highPriority,
      medium: mediumPriority,
      low: lowPriority
    },
    summary: {
      technical: technical.length,
      ux: ux.length,
      high: highPriority.length,
      medium: mediumPriority.length,
      low: lowPriority.length
    }
  };
}

/**
 * Format optimization results for display
 * @param {Object} results - Analysis results
 * @returns {string} Formatted output
 */
function formatOptimizationResults(results) {
  const lines = [];

  const cyan = '\x1b[36m';
  const yellow = '\x1b[33m';
  const green = '\x1b[32m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';

  lines.push('');
  lines.push(`${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
  lines.push(`${cyan}💡 SOLUTION OPTIMIZATION SUGGESTIONS${reset}`);
  lines.push(`${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
  lines.push('');

  if (results.total === 0) {
    lines.push(`${green}✓ No optimization suggestions${reset}`);
    lines.push(`${dim}Code looks clean! No obvious improvements detected.${reset}`);
    return lines.join('\n');
  }

  // Technical suggestions
  if (results.byType.technical.length > 0) {
    lines.push(`${yellow}🔧 Technical (${results.byType.technical.length}):${reset}`);

    // Group by priority
    for (const suggestion of results.byType.technical.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))) {
      const priorityBadge = formatPriority(suggestion.priority);
      lines.push(`   ${priorityBadge} ${suggestion.name}`);
      lines.push(`      ${dim}→ ${suggestion.suggestion}${reset}`);
      if (suggestion.lines.length > 0) {
        const fileInfo = suggestion.lines.length > 1
          ? `${suggestion.file}:${suggestion.lines[0]} (${suggestion.matchCount} occurrences)`
          : `${suggestion.file}:${suggestion.lines[0]}`;
        lines.push(`      ${dim}   ${fileInfo}${reset}`);
      }
      lines.push('');
    }
  }

  // UX suggestions
  if (results.byType.ux.length > 0) {
    lines.push(`${yellow}🎨 UX (${results.byType.ux.length}):${reset}`);

    for (const suggestion of results.byType.ux.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))) {
      const priorityBadge = formatPriority(suggestion.priority);
      lines.push(`   ${priorityBadge} ${suggestion.name}`);
      lines.push(`      ${dim}→ ${suggestion.suggestion}${reset}`);
      if (suggestion.lines.length > 0) {
        const fileInfo = suggestion.lines.length > 1
          ? `${suggestion.file}:${suggestion.lines[0]} (${suggestion.matchCount} occurrences)`
          : `${suggestion.file}:${suggestion.lines[0]}`;
        lines.push(`      ${dim}   ${fileInfo}${reset}`);
      }
      lines.push('');
    }
  }

  // Summary
  lines.push(`${dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
  lines.push(`${dim}Summary: ${results.summary.high} high, ${results.summary.medium} medium, ${results.summary.low} low priority${reset}`);
  lines.push(`${dim}These are suggestions only - not blocking.${reset}`);

  return lines.join('\n');
}

/**
 * Get priority sort order
 * @param {string} priority - Priority level
 * @returns {number} Sort order (lower = higher priority)
 */
function priorityOrder(priority) {
  switch (priority) {
    case 'High': return 0;
    case 'Medium': return 1;
    case 'Low': return 2;
    default: return 3;
  }
}

/**
 * Format priority badge
 * @param {string} priority - Priority level
 * @returns {string} Formatted priority badge
 */
function formatPriority(priority) {
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';

  switch (priority) {
    case 'High': return `${red}[High]${reset}`;
    case 'Medium': return `${yellow}[Medium]${reset}`;
    case 'Low': return `${dim}[Low]${reset}`;
    default: return `[${priority}]`;
  }
}

// ============================================================
// CLI Interface
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Solution Optimizer

Analyzes code for optimization opportunities (non-blocking suggestions).

Usage:
  flow-solution-optimizer.js [files...]       Analyze specific files
  flow-solution-optimizer.js --stdin          Read file list from stdin
  flow-solution-optimizer.js --json           Output JSON format

Options:
  --json         Output results as JSON
  --technical    Only show technical suggestions
  --ux           Only show UX suggestions
  --high-only    Only show high priority suggestions
  --help, -h     Show this help

Examples:
  node flow-solution-optimizer.js src/App.tsx src/utils.ts
  git diff --name-only | node flow-solution-optimizer.js --stdin
`);
    process.exit(0);
  }

  const jsonOutput = args.includes('--json');
  const technicalOnly = args.includes('--technical');
  const uxOnly = args.includes('--ux');
  const highOnly = args.includes('--high-only');

  // Get files to analyze
  let filePaths = args.filter(a => !a.startsWith('-'));

  if (args.includes('--stdin')) {
    // Read from stdin
    const input = fs.readFileSync(0, 'utf-8');
    filePaths = input.trim().split('\n').filter(Boolean);
  }

  if (filePaths.length === 0) {
    console.error('No files specified. Use --help for usage.');
    process.exit(1);
  }

  // Load file contents
  const files = filePaths.map(fp => {
    try {
      return {
        path: fp,
        content: fs.readFileSync(fp, 'utf-8')
      };
    } catch (err) {
      return null;
    }
  }).filter(Boolean);

  // Run analysis
  let results = runOptimizationAnalysis(files);

  // Filter by type if requested
  if (technicalOnly) {
    results.suggestions = results.byType.technical;
    results.byType.ux = [];
    results.total = results.suggestions.length;
  } else if (uxOnly) {
    results.suggestions = results.byType.ux;
    results.byType.technical = [];
    results.total = results.suggestions.length;
  }

  // Filter by priority if requested
  if (highOnly) {
    results.suggestions = results.byPriority.high;
    results.byType.technical = results.byType.technical.filter(s => s.priority === 'High');
    results.byType.ux = results.byType.ux.filter(s => s.priority === 'High');
    results.total = results.suggestions.length;
  }

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatOptimizationResults(results));
  }
}

// ============================================================
// Module Exports
// ============================================================

module.exports = {
  runOptimizationAnalysis,
  formatOptimizationResults,
  analyzeFile,
  TECHNICAL_PATTERNS,
  UX_PATTERNS
};
