#!/usr/bin/env node

/**
 * Wogi Flow - Browser Error Pattern Recognition
 *
 * Maps common browser/JavaScript errors to likely causes and suggested fixes.
 * Used by the autonomous browser debugging loop to diagnose issues.
 *
 * Pattern categories:
 * - null-reference: Accessing properties on undefined/null
 * - network: Fetch failures, CORS, 404/500 errors
 * - dom: Element not found, selector issues
 * - react: React-specific errors and warnings
 * - vue: Vue-specific errors and warnings
 * - async: Promise rejections, async/await issues
 * - import: Module/import errors
 */

// ============================================================
// Error Pattern Database
// ============================================================

const ERROR_PATTERNS = {
  // Null Reference Errors
  'cannot read properties of undefined': {
    category: 'null-reference',
    pattern: /cannot read propert(y|ies) of undefined \(reading '([^']+)'\)/i,
    confidence: 'high',
    suggestion: 'Add null/undefined check before accessing the property',
    likelyCauses: [
      'Data not loaded yet (missing loading state)',
      'API response shape different than expected',
      'Missing null check before property access',
      'Object destructuring on undefined value'
    ],
    investigationSteps: [
      'Check the variable being accessed',
      'Verify the data source is loaded',
      'Add optional chaining (?.) or null check'
    ],
    suggestedFixes: [
      { type: 'optional-chaining', pattern: 'obj.prop', replacement: 'obj?.prop' },
      { type: 'null-check', pattern: 'obj.prop', replacement: 'obj && obj.prop' },
      { type: 'default-value', pattern: 'obj.prop', replacement: 'obj?.prop ?? defaultValue' }
    ],
    extractVariable: (match) => match?.[2]
  },

  'cannot read properties of null': {
    category: 'null-reference',
    pattern: /cannot read propert(y|ies) of null \(reading '([^']+)'\)/i,
    confidence: 'high',
    suggestion: 'The object is explicitly null - check where it\'s assigned',
    likelyCauses: [
      'API returned null instead of expected object',
      'State initialized as null',
      'DOM element not found (querySelector returned null)',
      'Explicit null assignment somewhere'
    ],
    investigationSteps: [
      'Search for assignments to this variable',
      'Check API response for null values',
      'Add null guard before access'
    ],
    suggestedFixes: [
      { type: 'null-guard', pattern: 'obj.prop', replacement: 'if (obj !== null) { obj.prop }' }
    ],
    extractVariable: (match) => match?.[2]
  },

  'is not a function': {
    category: 'null-reference',
    pattern: /([a-zA-Z0-9_$.]+) is not a function/i,
    confidence: 'high',
    suggestion: 'The value is not callable - check if it\'s properly imported/defined',
    likelyCauses: [
      'Calling method on undefined object',
      'Missing import statement',
      'Wrong export type (default vs named)',
      'Variable shadowing the function'
    ],
    investigationSteps: [
      'Check if the function is properly imported',
      'Verify the parent object exists',
      'Check for typos in function name'
    ],
    extractVariable: (match) => match?.[1]
  },

  // Network Errors
  'failed to fetch': {
    category: 'network',
    pattern: /failed to fetch/i,
    confidence: 'medium',
    suggestion: 'Network request failed - check server and connectivity',
    likelyCauses: [
      'Backend server not running',
      'Wrong API URL/port',
      'CORS blocking the request',
      'Network connectivity issue',
      'Request timed out'
    ],
    investigationSteps: [
      'Check if backend is running',
      'Verify the API URL is correct',
      'Check browser Network tab for CORS errors',
      'Test the endpoint directly (curl/Postman)'
    ],
    suggestedFixes: [
      { type: 'check-server', action: 'Verify backend is running' },
      { type: 'cors', action: 'Add CORS headers to backend' }
    ]
  },

  'net::err_connection_refused': {
    category: 'network',
    pattern: /net::err_connection_refused/i,
    confidence: 'high',
    suggestion: 'Server is not accepting connections - likely not running',
    likelyCauses: [
      'Backend server not started',
      'Wrong port number',
      'Firewall blocking connection'
    ],
    investigationSteps: [
      'Start the backend server',
      'Check the port matches configuration',
      'Check firewall settings'
    ]
  },

  '404': {
    category: 'network',
    pattern: /404|not found/i,
    confidence: 'medium',
    suggestion: 'Resource not found - check URL path',
    likelyCauses: [
      'Wrong API endpoint path',
      'Resource deleted/moved',
      'Typo in URL',
      'Missing route on backend'
    ],
    investigationSteps: [
      'Verify the URL path is correct',
      'Check backend routes',
      'Look for typos in the endpoint'
    ]
  },

  '500': {
    category: 'network',
    pattern: /500|internal server error/i,
    confidence: 'medium',
    suggestion: 'Server error - check backend logs',
    likelyCauses: [
      'Bug in backend code',
      'Database connection issue',
      'Missing environment variable',
      'Unhandled exception'
    ],
    investigationSteps: [
      'Check backend server logs',
      'Verify database connectivity',
      'Check environment variables'
    ]
  },

  'cors': {
    category: 'network',
    pattern: /cors|cross-origin|access-control-allow-origin/i,
    confidence: 'high',
    suggestion: 'CORS policy blocking request - configure backend CORS',
    likelyCauses: [
      'Missing CORS headers on backend',
      'Wrong allowed origin',
      'Preflight request failing'
    ],
    investigationSteps: [
      'Add CORS middleware to backend',
      'Check allowed origins include frontend URL',
      'Verify credentials mode matches server config'
    ],
    suggestedFixes: [
      { type: 'backend', action: 'Add CORS middleware: app.use(cors())' }
    ]
  },

  // DOM Errors
  'element not found': {
    category: 'dom',
    pattern: /element.*not found|null.*queryselector|cannot find.*element/i,
    confidence: 'medium',
    suggestion: 'DOM element doesn\'t exist - check selector and timing',
    likelyCauses: [
      'Wrong CSS selector',
      'Element not rendered yet',
      'Conditional rendering hiding element',
      'Element removed from DOM'
    ],
    investigationSteps: [
      'Verify the selector in browser DevTools',
      'Check if element is conditionally rendered',
      'Add wait/timeout before querying'
    ]
  },

  // React Errors
  'each child in a list should have a unique key': {
    category: 'react',
    pattern: /each child in a list should have a unique.*key/i,
    confidence: 'high',
    suggestion: 'Add unique key prop to list items',
    likelyCauses: [
      'Missing key prop in .map() render',
      'Using index as key (not recommended)',
      'Duplicate keys in data'
    ],
    investigationSteps: [
      'Find the .map() call rendering this list',
      'Add key={item.id} or similar unique identifier'
    ],
    suggestedFixes: [
      { type: 'add-key', pattern: '<Item />', replacement: '<Item key={item.id} />' }
    ]
  },

  'cannot update a component while rendering': {
    category: 'react',
    pattern: /cannot update a component.*while rendering/i,
    confidence: 'high',
    suggestion: 'State update during render - move to useEffect',
    likelyCauses: [
      'Calling setState directly in render body',
      'Side effect not wrapped in useEffect',
      'Infinite render loop'
    ],
    investigationSteps: [
      'Find the setState call in render',
      'Wrap in useEffect with proper dependencies'
    ]
  },

  'rendered more hooks than during the previous render': {
    category: 'react',
    pattern: /rendered (more|fewer) hooks/i,
    confidence: 'high',
    suggestion: 'Conditional hook call - hooks must be called unconditionally',
    likelyCauses: [
      'Hook called inside if/else',
      'Hook called inside loop',
      'Early return before hook call'
    ],
    investigationSteps: [
      'Move all hooks to top of component',
      'Remove conditional around hook calls',
      'Ensure consistent hook order'
    ]
  },

  'maximum update depth exceeded': {
    category: 'react',
    pattern: /maximum update depth exceeded/i,
    confidence: 'high',
    suggestion: 'Infinite loop detected - check useEffect dependencies',
    likelyCauses: [
      'useEffect updating state that\'s in its dependencies',
      'Event handler causing re-render loop',
      'Missing or wrong dependency array'
    ],
    investigationSteps: [
      'Check useEffect dependency arrays',
      'Look for state updates triggering themselves',
      'Use useCallback/useMemo to stabilize references'
    ]
  },

  // Vue Errors
  '[vue warn] property or method': {
    category: 'vue',
    pattern: /\[vue warn\].*property.*method.*not defined/i,
    confidence: 'high',
    suggestion: 'Template references undefined property - check data/methods',
    likelyCauses: [
      'Typo in template variable name',
      'Missing data property',
      'Method not defined in methods object'
    ],
    investigationSteps: [
      'Check spelling in template',
      'Add property to data() return',
      'Define method in methods object'
    ]
  },

  // Async Errors
  'unhandled promise rejection': {
    category: 'async',
    pattern: /unhandled.*promise.*rejection/i,
    confidence: 'medium',
    suggestion: 'Promise rejected without catch handler',
    likelyCauses: [
      'Missing .catch() on Promise',
      'Missing try/catch around await',
      'Error in async function not handled'
    ],
    investigationSteps: [
      'Add .catch() handler to Promise chain',
      'Wrap await in try/catch',
      'Check error boundary for React'
    ],
    suggestedFixes: [
      { type: 'try-catch', pattern: 'await fn()', replacement: 'try { await fn() } catch (err) { /* handle */ }' }
    ]
  },

  // Import Errors
  'cannot find module': {
    category: 'import',
    pattern: /cannot find module '([^']+)'/i,
    confidence: 'high',
    suggestion: 'Module not found - check path or install package',
    likelyCauses: [
      'Typo in import path',
      'Package not installed',
      'Wrong relative path',
      'Missing file extension'
    ],
    investigationSteps: [
      'Check the import path spelling',
      'Run npm install if it\'s a package',
      'Verify the file exists at that path'
    ],
    extractModule: (match) => match?.[1]
  },

  'is not exported from': {
    category: 'import',
    pattern: /'([^']+)' is not exported from '([^']+)'/i,
    confidence: 'high',
    suggestion: 'Named export doesn\'t exist - check export/import match',
    likelyCauses: [
      'Typo in export name',
      'Using named import for default export',
      'Export was renamed or removed'
    ],
    investigationSteps: [
      'Check the source file exports',
      'Switch between default/named import',
      'Check for typos'
    ],
    extractExport: (match) => ({ name: match?.[1], from: match?.[2] })
  }
};

// ============================================================
// Pattern Matching Functions
// ============================================================

/**
 * Get all registered error patterns
 * @returns {object} - All patterns by key
 */
function getAllPatterns() {
  return ERROR_PATTERNS;
}

/**
 * Find matching pattern for an error message
 * @param {string} errorText - The error message to analyze
 * @returns {object|null} - Matching pattern or null
 */
function getPatternForError(errorText) {
  if (!errorText) return null;

  const normalizedError = errorText.toLowerCase();

  for (const [key, pattern] of Object.entries(ERROR_PATTERNS)) {
    // Check if the key phrase is in the error
    if (normalizedError.includes(key.toLowerCase())) {
      // Try to extract additional info using the regex pattern
      let match = null;
      if (pattern.pattern) {
        match = errorText.match(pattern.pattern);
      }

      return {
        ...pattern,
        matchedKey: key,
        regexMatch: match,
        extractedInfo: extractPatternInfo(pattern, match)
      };
    }
  }

  return null;
}

/**
 * Extract additional information from pattern match
 * @param {object} pattern - The matched pattern
 * @param {Array} match - Regex match result
 * @returns {object} - Extracted information
 */
function extractPatternInfo(pattern, match) {
  const info = {};

  if (pattern.extractVariable && match) {
    info.variable = pattern.extractVariable(match);
  }
  if (pattern.extractModule && match) {
    info.module = pattern.extractModule(match);
  }
  if (pattern.extractExport && match) {
    info.export = pattern.extractExport(match);
  }

  return info;
}

/**
 * Get patterns for a specific category
 * @param {string} category - Category name
 * @returns {Array} - Patterns in that category
 */
function getPatternsByCategory(category) {
  return Object.entries(ERROR_PATTERNS)
    .filter(([_, p]) => p.category === category)
    .map(([key, pattern]) => ({ key, ...pattern }));
}

/**
 * Get all category names
 * @returns {Array} - List of category names
 */
function getCategories() {
  const categories = new Set();
  for (const pattern of Object.values(ERROR_PATTERNS)) {
    categories.add(pattern.category);
  }
  return Array.from(categories);
}

/**
 * Analyze an error and provide comprehensive diagnosis
 * @param {string} errorText - The error message
 * @param {object} context - Additional context (file, line, etc.)
 * @returns {object} - Comprehensive diagnosis
 */
function diagnoseError(errorText, context = {}) {
  const pattern = getPatternForError(errorText);

  if (!pattern) {
    return {
      diagnosed: false,
      category: 'unknown',
      confidence: 'low',
      errorText,
      suggestion: 'Unable to identify error pattern. Manual investigation needed.',
      context
    };
  }

  return {
    diagnosed: true,
    category: pattern.category,
    confidence: pattern.confidence,
    errorText,
    matchedPattern: pattern.matchedKey,
    suggestion: pattern.suggestion,
    likelyCauses: pattern.likelyCauses,
    investigationSteps: pattern.investigationSteps,
    suggestedFixes: pattern.suggestedFixes,
    extractedInfo: pattern.extractedInfo,
    context
  };
}

/**
 * Format diagnosis for display
 * @param {object} diagnosis - Diagnosis from diagnoseError
 * @returns {string} - Formatted output
 */
function formatDiagnosis(diagnosis) {
  const lines = [];

  if (!diagnosis.diagnosed) {
    lines.push(`⚠️ Unable to diagnose: ${diagnosis.errorText}`);
    return lines.join('\n');
  }

  lines.push(`📋 Error Diagnosis`);
  lines.push(`   Category: ${diagnosis.category}`);
  lines.push(`   Confidence: ${diagnosis.confidence}`);
  lines.push(`   Pattern: ${diagnosis.matchedPattern}`);
  lines.push('');
  lines.push(`💡 ${diagnosis.suggestion}`);

  if (diagnosis.likelyCauses?.length > 0) {
    lines.push('');
    lines.push('Likely causes:');
    diagnosis.likelyCauses.forEach(cause => {
      lines.push(`  • ${cause}`);
    });
  }

  if (diagnosis.investigationSteps?.length > 0) {
    lines.push('');
    lines.push('Investigation steps:');
    diagnosis.investigationSteps.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${step}`);
    });
  }

  if (diagnosis.extractedInfo && Object.keys(diagnosis.extractedInfo).length > 0) {
    lines.push('');
    lines.push('Extracted info:');
    for (const [key, value] of Object.entries(diagnosis.extractedInfo)) {
      if (value) {
        lines.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================
// CLI
// ============================================================

function showHelp() {
  console.log(`
Wogi Flow - Browser Error Pattern Recognition

Usage:
  flow browser-patterns "error message"   Diagnose an error
  flow browser-patterns --list            List all patterns
  flow browser-patterns --categories      List pattern categories

Examples:
  flow browser-patterns "Cannot read properties of undefined (reading 'map')"
  flow browser-patterns "Failed to fetch"
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.includes('--list')) {
    console.log('\nRegistered Error Patterns:\n');
    for (const [key, pattern] of Object.entries(ERROR_PATTERNS)) {
      console.log(`  [${pattern.category}] "${key}"`);
      console.log(`     ${pattern.suggestion}`);
      console.log('');
    }
    return;
  }

  if (args.includes('--categories')) {
    console.log('\nError Categories:\n');
    getCategories().forEach(cat => {
      const count = getPatternsByCategory(cat).length;
      console.log(`  ${cat}: ${count} patterns`);
    });
    return;
  }

  // Diagnose the provided error message
  const errorText = args.join(' ');
  const diagnosis = diagnoseError(errorText);
  console.log('');
  console.log(formatDiagnosis(diagnosis));
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  ERROR_PATTERNS,
  getAllPatterns,
  getPatternForError,
  getPatternsByCategory,
  getCategories,
  diagnoseError,
  formatDiagnosis
};

if (require.main === module) {
  main();
}
