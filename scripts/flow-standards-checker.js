#!/usr/bin/env node

/**
 * Wogi Flow - Standards Compliance Checker
 *
 * Verifies code follows project standards defined in:
 * - decisions.md (coding rules)
 * - app-map.md (component reuse)
 * - function-map.md (utility reuse)
 * - api-map.md (API consolidation)
 * - .claude/rules/* (naming, security, architecture)
 *
 * Enforcement is STRICT - all violations block completion.
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  fileExists,
  readFile,
  safeJsonParse,
  color
} = require('./flow-utils');
const {
  calculateCombinedSimilarity,
  getMatchLevel,
  getMatchConfig
} = require('./flow-semantic-match');

// ============================================================================
// Constants
// ============================================================================

const STANDARDS_FILES = {
  decisions: path.join(PATHS.state, 'decisions.md'),
  appMap: path.join(PATHS.state, 'app-map.md'),
  functionMap: path.join(PATHS.state, 'function-map.md'),
  apiMap: path.join(PATHS.state, 'api-map.md')
};

// Dynamically add all active registry map files for duplication checks
try {
  const { getActiveRegistries } = require('./flow-utils');
  for (const reg of getActiveRegistries()) {
    const key = reg.id + 'Map';
    if (!STANDARDS_FILES[key]) {
      STANDARDS_FILES[key] = path.join(PATHS.state, reg.mapFile);
    }
  }
} catch {
  // Fallback: keep original three
}

const RULES_DIR = path.join(PATHS.root, '.claude', 'rules');

// Naming convention patterns from naming-conventions.md
const NAMING_RULES = {
  catchVariable: {
    pattern: /catch\s*\(\s*(\w+)\s*\)/g,
    expected: 'err',
    message: 'Catch block variable should be "err", not "{found}"'
  },
  fileNaming: {
    pattern: /^[a-z][a-z0-9-]*\.(ts|js|tsx|jsx)$/,
    message: 'File names should be kebab-case'
  }
};

// Match level to severity mapping (used by semantic matching)
const MATCH_LEVEL_SEVERITY = {
  definite: 'must-fix',   // >= 90 combined score: blocks task
  likely: 'warning',      // 70-89 combined score: user decides
  possible: 'info'        // 50-69 combined score: informational only
};

// Task type to check type mapping for smart scoping
const TASK_CHECK_MAP = {
  'component': ['naming', 'components', 'security'],
  'utility': ['naming', 'functions', 'security'],
  'api': ['naming', 'api', 'security'],
  'feature': ['naming', 'components', 'functions', 'api', 'security'],
  'bugfix': ['naming', 'security'],
  'refactor': ['naming', 'components', 'functions', 'api', 'security'],
  'story': ['naming', 'components', 'functions', 'api', 'security'],
  'default': ['naming', 'components', 'functions', 'api', 'security']
};

// All available check types
const ALL_CHECK_TYPES = ['naming', 'components', 'functions', 'api', 'security'];

// ============================================================================
// Parse Standards Files
// ============================================================================

/**
 * Parse decisions.md into structured rules
 * @returns {Object[]} Array of rules
 */
function parseDecisions() {
  const decisionsPath = STANDARDS_FILES.decisions;
  if (!fileExists(decisionsPath)) return [];

  const content = readFile(decisionsPath, '');
  const rules = [];

  // Parse markdown sections as rules
  const sections = content.split(/^###?\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const title = lines[0]?.trim();
    if (!title) continue;

    // Extract rule details
    const body = lines.slice(1).join('\n').trim();

    // Look for code patterns in the section
    const codeBlocks = body.match(/```[\s\S]*?```/g) || [];
    const goodPatterns = [];
    const badPatterns = [];

    codeBlocks.forEach(block => {
      if (block.includes('// Good') || block.includes('// Correct')) {
        goodPatterns.push(block.replace(/```\w*\n?|\n?```/g, '').trim());
      } else if (block.includes('// Bad') || block.includes('// Wrong') || block.includes('// incorrect')) {
        badPatterns.push(block.replace(/```\w*\n?|\n?```/g, '').trim());
      }
    });

    rules.push({
      title,
      body,
      goodPatterns,
      badPatterns,
      source: 'decisions.md'
    });
  }

  return rules;
}

/**
 * Parse app-map.md into component registry
 * @returns {Object[]} Array of components
 */
function parseAppMap() {
  const appMapPath = STANDARDS_FILES.appMap;
  if (!fileExists(appMapPath)) return [];

  const content = readFile(appMapPath, '');
  const components = [];

  // Parse component entries (typically formatted as tables or lists)
  // Look for patterns like: | ComponentName | path/to/file | description |
  const tableRows = content.match(/\|\s*([A-Z][a-zA-Z]+)\s*\|\s*([^\|]+)\s*\|/g) || [];

  for (const row of tableRows) {
    const match = row.match(/\|\s*([A-Z][a-zA-Z]+)\s*\|\s*([^\|]+)\s*\|/);
    if (match) {
      components.push({
        name: match[1].trim(),
        path: match[2].trim(),
        source: 'app-map.md'
      });
    }
  }

  // Also look for markdown list format: - **ComponentName**: description
  const listItems = content.match(/^-\s+\*\*([A-Z][a-zA-Z]+)\*\*:?\s*([^\n]+)?/gm) || [];
  for (const item of listItems) {
    const match = item.match(/-\s+\*\*([A-Z][a-zA-Z]+)\*\*:?\s*([^\n]+)?/);
    if (match) {
      components.push({
        name: match[1].trim(),
        description: match[2]?.trim() || '',
        source: 'app-map.md'
      });
    }
  }

  return components;
}

/**
 * Parse function-map.md into utility registry
 * @returns {Object[]} Array of functions
 */
function parseFunctionMap() {
  const functionMapPath = STANDARDS_FILES.functionMap;
  if (!fileExists(functionMapPath)) return [];

  const content = readFile(functionMapPath, '');
  const functions = [];

  // Parse function entries
  const tableRows = content.match(/\|\s*`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s*\|\s*([^\|]+)\s*\|/g) || [];

  for (const row of tableRows) {
    const match = row.match(/\|\s*`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s*\|\s*([^\|]+)\s*\|/);
    if (match) {
      functions.push({
        name: match[1].trim(),
        description: match[2].trim(),
        source: 'function-map.md'
      });
    }
  }

  return functions;
}

/**
 * Parse api-map.md into endpoint registry
 * @returns {Object[]} Array of endpoints
 */
function parseApiMap() {
  const apiMapPath = STANDARDS_FILES.apiMap;
  if (!fileExists(apiMapPath)) return [];

  const content = readFile(apiMapPath, '');
  const endpoints = [];

  // Parse API entries (typically: | GET | /api/users | description |)
  const tableRows = content.match(/\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*([^\|]+)\s*\|/gi) || [];

  for (const row of tableRows) {
    const match = row.match(/\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*([^\|]+)\s*\|/i);
    if (match) {
      endpoints.push({
        method: match[1].toUpperCase(),
        path: match[2].trim(),
        source: 'api-map.md'
      });
    }
  }

  return endpoints;
}

/**
 * Load rules from .claude/rules directory
 * @returns {Object[]} Array of rules from rule files
 */
function loadRulesDir() {
  if (!fs.existsSync(RULES_DIR)) return [];

  const rules = [];

  function scanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            rules.push({
              file: path.relative(RULES_DIR, fullPath),
              content,
              source: fullPath
            });
          } catch (err) {
            // Skip unreadable files
          }
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }

  scanDir(RULES_DIR);
  return rules;
}

// ============================================================================
// Violation Detection
// ============================================================================

/**
 * Check for naming convention violations
 * @param {Object} file - File with path and content
 * @returns {Object[]} Array of violations
 */
function checkNamingConventions(file) {
  const violations = [];

  // Check file naming (kebab-case)
  const fileName = path.basename(file.path);
  if (!NAMING_RULES.fileNaming.pattern.test(fileName) && /\.(ts|js|tsx|jsx)$/.test(fileName)) {
    // Only flag if it has uppercase or underscores (common violations)
    if (/[A-Z_]/.test(fileName.replace(/\.(ts|js|tsx|jsx)$/, ''))) {
      violations.push({
        type: 'naming-conventions',
        severity: 'must-fix',
        file: file.path,
        line: null,
        message: `File name "${fileName}" should be kebab-case`,
        rule: 'naming-conventions.md'
      });
    }
  }

  // Check catch block variable naming
  const content = file.content || '';
  let match;
  const catchRegex = /catch\s*\(\s*(\w+)\s*\)/g;

  while ((match = catchRegex.exec(content)) !== null) {
    const varName = match[1];
    if (varName !== 'err' && varName !== '_err' && varName !== '_') {
      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

      violations.push({
        type: 'naming-conventions',
        severity: 'must-fix',
        file: file.path,
        line: lineNumber,
        message: `Catch variable "${varName}" should be "err"`,
        rule: 'naming-conventions.md'
      });
    }
  }

  return violations;
}

/**
 * Check for component duplication using semantic matching
 * @param {Object} file - File with path and content
 * @param {Object[]} existingComponents - Components from app-map
 * @param {Object} matchConfig - Semantic match config (thresholds, weights) — optional, auto-loaded if omitted
 * @returns {Object[]} Array of violations
 */
function checkComponentDuplication(file, existingComponents, matchConfig) {
  const violations = [];

  // Only check for new component files
  if (!file.path.includes('component') && !file.path.includes('Component')) {
    return violations;
  }

  const config = matchConfig || getMatchConfig();
  const fileName = path.basename(file.path, path.extname(file.path));

  for (const existing of existingComponents) {
    const existingName = existing.name || '';
    if (fileName.replace(/-/g, '').toLowerCase() === existingName.toLowerCase()) continue;

    const scores = calculateCombinedSimilarity(fileName, existingName, 'components');
    const matchLevel = getMatchLevel(scores.combined, config.thresholds);
    const severity = MATCH_LEVEL_SEVERITY[matchLevel];

    if (!severity) continue; // 'none' level — skip

    if (severity === 'must-fix') {
      violations.push({
        type: 'component-duplication',
        severity: 'must-fix',
        file: file.path,
        line: null,
        message: `Component "${fileName}" is ${scores.combined}% similar to existing "${existingName}" (string: ${scores.string}%, semantic: ${scores.semantic}%)`,
        suggestion: `Use existing component or add variant to "${existingName}" instead`,
        rule: 'app-map.md / component-reuse.md'
      });
    } else if (severity === 'warning') {
      violations.push({
        type: 'component-duplication',
        severity: 'warning',
        file: file.path,
        line: null,
        message: `Component "${fileName}" is ${scores.combined}% similar to existing "${existingName}" (string: ${scores.string}%, semantic: ${scores.semantic}%) — review if intentional`,
        suggestion: `Consider reusing or extending "${existingName}" if the purpose overlaps`,
        rule: 'app-map.md / component-reuse.md'
      });
    }
    // 'info' level: don't add a violation (non-actionable)
  }

  return violations;
}

/**
 * Check for function duplication using semantic matching
 * @param {Object} file - File with path and content
 * @param {Object[]} existingFunctions - Functions from function-map
 * @param {Object} matchConfig - Semantic match config — optional, auto-loaded if omitted
 * @returns {Object[]} Array of violations
 */
function checkFunctionDuplication(file, existingFunctions, matchConfig) {
  const violations = [];
  const content = file.content || '';
  const config = matchConfig || getMatchConfig();

  // Find function declarations
  const functionRegex = /(?:function\s+|const\s+|let\s+|var\s+)([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=\s*(?:async\s*)?\(|=\s*function|\()/g;
  let match;

  while ((match = functionRegex.exec(content)) !== null) {
    const funcName = match[1];

    for (const existing of existingFunctions) {
      const existingName = existing.name || '';
      if (funcName.toLowerCase() === existingName.toLowerCase()) continue;

      const scores = calculateCombinedSimilarity(funcName, existingName, 'functions');
      const matchLevel = getMatchLevel(scores.combined, config.thresholds);
      const severity = MATCH_LEVEL_SEVERITY[matchLevel];

      if (!severity || severity === 'info') continue;

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

      violations.push({
        type: 'function-duplication',
        severity,
        file: file.path,
        line: lineNumber,
        message: `Function "${funcName}" is ${scores.combined}% similar to existing "${existingName}" (${existing.description || 'no description'})`,
        suggestion: `Consider using existing function from function-map.md`,
        rule: 'function-map.md'
      });
    }
  }

  return violations;
}

/**
 * Check for security pattern violations
 * @param {Object} file - File with path and content
 * @param {Object[]} securityRules - Security rules from rules dir
 * @returns {Object[]} Array of violations
 */
function checkSecurityPatterns(file, securityRules) {
  const violations = [];
  const content = file.content || '';

  // Hard-coded security checks from security-patterns.md

  // 1. Raw JSON.parse without try-catch or safeJsonParse
  const jsonParseMatches = content.matchAll(/JSON\s*\.\s*parse\s*\(/g);
  for (const match of jsonParseMatches) {
    const beforeMatch = content.substring(0, match.index);
    const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

    // Check if inside try block (simple heuristic)
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const linesBefore = content.substring(Math.max(0, match.index - 200), match.index);

    if (!linesBefore.includes('try') && !content.substring(lineStart, match.index).includes('safeJsonParse')) {
      violations.push({
        type: 'security',
        severity: 'must-fix',
        file: file.path,
        line: lineNumber,
        message: 'Raw JSON.parse without try-catch - use safeJsonParse from flow-utils.js',
        rule: 'security-patterns.md #2'
      });
    }
  }

  // 2. fs.readFileSync without try-catch (after fileExists check is still risky)
  const readFileSyncMatches = content.matchAll(/fs\.readFileSync\s*\(/g);
  for (const match of readFileSyncMatches) {
    const beforeMatch = content.substring(0, match.index);
    const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
    const linesBefore = content.substring(Math.max(0, match.index - 200), match.index);

    if (!linesBefore.includes('try')) {
      violations.push({
        type: 'security',
        severity: 'warning',
        file: file.path,
        line: lineNumber,
        message: 'fs.readFileSync without try-catch - wrap in try-catch per security-patterns.md #1',
        rule: 'security-patterns.md #1'
      });
    }
  }

  return violations;
}

// ============================================================================
// Utility Functions
// ============================================================================

// Legacy calculateSimilarity/levenshteinDistance removed — use flow-semantic-match.js instead

// ============================================================================
// Main Check Function
// ============================================================================

/**
 * Determine which check types to run based on task type and options
 * @param {Object} options - Scoping options
 * @returns {string[]} Array of check types to run
 */
function getCheckTypesForTask(options = {}) {
  const {
    taskType = null,
    checkTypes = null,
    skipComponents = false,
    skipFunctions = false,
    skipSecurity = false,
    skipApi = false
  } = options;

  // If explicit checkTypes provided, use those
  if (checkTypes && Array.isArray(checkTypes)) {
    return checkTypes.filter(t => ALL_CHECK_TYPES.includes(t));
  }

  // Get checks based on task type
  let checks = TASK_CHECK_MAP[taskType] || TASK_CHECK_MAP['default'];
  checks = [...checks]; // Clone to avoid modifying the original

  // Apply skip flags
  if (skipComponents) checks = checks.filter(c => c !== 'components');
  if (skipFunctions) checks = checks.filter(c => c !== 'functions');
  if (skipSecurity) checks = checks.filter(c => c !== 'security');
  if (skipApi) checks = checks.filter(c => c !== 'api');

  return checks;
}

/**
 * Check if a file path matches any of the changed paths (for targeted checks)
 * @param {string} filePath - File path to check
 * @param {string[]} changedPaths - Array of changed paths
 * @returns {boolean} True if file matches
 */
function isInChangedPaths(filePath, changedPaths) {
  if (!changedPaths || changedPaths.length === 0) return true;
  return changedPaths.some(p => filePath.includes(p) || p.includes(filePath));
}

/**
 * Run all standards checks on files
 * @param {Object[]} files - Files with path and content
 * @param {Object} options - Scoping options
 * @param {string} options.taskType - Task type for smart scoping (component, utility, api, feature, bugfix, refactor)
 * @param {string[]} options.changedPaths - Paths changed in this task (for targeted checks)
 * @param {string[]} options.checkTypes - Override: specific check types to run
 * @param {boolean} options.skipComponents - Skip component duplication check
 * @param {boolean} options.skipFunctions - Skip function duplication check
 * @param {boolean} options.skipSecurity - Skip security pattern check
 * @param {boolean} options.skipApi - Skip API check
 * @param {number} options.similarityThreshold - Legacy: override similarity threshold (0-1). Prefer semanticMatching config.
 * @returns {Object} Check results
 */
function runStandardsCheck(files, options = {}) {
  const {
    changedPaths = []
  } = options;

  // Load semantic match config (preferred) with legacy fallback
  const matchConfig = getMatchConfig();

  // Determine which checks to run
  const checksToRun = getCheckTypesForTask(options);

  // Load all standards (lazy load only what's needed)
  const decisions = parseDecisions();
  const components = checksToRun.includes('components') ? parseAppMap() : [];
  const functions = checksToRun.includes('functions') ? parseFunctionMap() : [];
  const endpoints = checksToRun.includes('api') ? parseApiMap() : [];
  const rulesFiles = checksToRun.includes('security') ? loadRulesDir() : [];

  const allViolations = [];
  const checksSummary = {
    'decisions.md': { checked: true, violations: 0 },
    'app-map.md': { checked: checksToRun.includes('components') && components.length > 0, violations: 0 },
    'function-map.md': { checked: checksToRun.includes('functions') && functions.length > 0, violations: 0 },
    'api-map.md': { checked: checksToRun.includes('api') && endpoints.length > 0, violations: 0 },
    'naming-conventions': { checked: checksToRun.includes('naming'), violations: 0 },
    'security-patterns': { checked: checksToRun.includes('security'), violations: 0 }
  };

  for (const file of files) {
    if (!file.content) continue;

    // Skip files not in changedPaths if specified
    if (changedPaths.length > 0 && !isInChangedPaths(file.path, changedPaths)) {
      continue;
    }

    // Naming conventions
    if (checksToRun.includes('naming')) {
      const namingViolations = checkNamingConventions(file);
      allViolations.push(...namingViolations);
      checksSummary['naming-conventions'].violations += namingViolations.length;
    }

    // Component duplication
    if (checksToRun.includes('components') && components.length > 0) {
      const componentViolations = checkComponentDuplication(file, components, matchConfig);
      allViolations.push(...componentViolations);
      checksSummary['app-map.md'].violations += componentViolations.length;
    }

    // Function duplication
    if (checksToRun.includes('functions') && functions.length > 0) {
      const functionViolations = checkFunctionDuplication(file, functions, matchConfig);
      allViolations.push(...functionViolations);
      checksSummary['function-map.md'].violations += functionViolations.length;
    }

    // Security patterns
    if (checksToRun.includes('security')) {
      const securityViolations = checkSecurityPatterns(file, rulesFiles);
      allViolations.push(...securityViolations);
      checksSummary['security-patterns'].violations += securityViolations.length;
    }
  }

  // Count must-fix violations
  const mustFixCount = allViolations.filter(v => v.severity === 'must-fix').length;
  const warningCount = allViolations.filter(v => v.severity === 'warning').length;

  return {
    passed: mustFixCount === 0,
    blocked: mustFixCount > 0,
    violations: allViolations,
    mustFixCount,
    warningCount,
    summary: checksSummary,
    checksRun: checksToRun,
    taskType: options.taskType || 'default'
  };
}

/**
 * Format results for display
 * @param {Object} results - Check results
 * @returns {string} Formatted output
 */
function formatStandardsResults(results) {
  const lines = [];

  lines.push('');
  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push(color('cyan', '📋 PROJECT STANDARDS COMPLIANCE'));
  lines.push(color('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push('');

  // Summary by source
  for (const [source, data] of Object.entries(results.summary)) {
    if (!data.checked) {
      lines.push(color('dim', `⊘ ${source}: not configured`));
    } else if (data.violations === 0) {
      lines.push(color('green', `✓ ${source}: passed`));
    } else {
      lines.push(color('red', `✗ ${source}: ${data.violations} violation(s)`));
    }
  }

  lines.push('');

  // Show violations
  if (results.violations.length > 0) {
    lines.push(color('yellow', 'Violations:'));
    lines.push('');

    for (const v of results.violations) {
      const severity = v.severity === 'must-fix'
        ? color('red', '[MUST FIX]')
        : color('yellow', '[WARNING]');

      const location = v.line
        ? `${v.file}:${v.line}`
        : v.file;

      lines.push(`${severity} ${location}`);
      lines.push(`   → ${v.message}`);
      if (v.suggestion) {
        lines.push(color('dim', `   → Fix: ${v.suggestion}`));
      }
      lines.push(color('dim', `   → Rule: ${v.rule}`));
      lines.push('');
    }
  }

  // Final status
  lines.push('');
  if (results.blocked) {
    lines.push(color('red', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    lines.push(color('red', `⚠️ ${results.mustFixCount} VIOLATIONS - Review blocked until fixed`));
    lines.push(color('red', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  } else if (results.warningCount > 0) {
    lines.push(color('yellow', `⚠ ${results.warningCount} warnings (non-blocking)`));
    lines.push(color('green', '✓ Standards check passed'));
  } else {
    lines.push(color('green', '✓ All standards checks passed'));
  }

  return lines.join('\n');
}

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wogi Flow - Standards Compliance Checker

Usage: node flow-standards-checker.js [options] [files...]

Options:
  --json          Output as JSON
  -h, --help      Show this help

Examples:
  node flow-standards-checker.js src/components/MyComponent.tsx
  node flow-standards-checker.js --json src/**/*.ts
`);
    process.exit(0);
  }

  const jsonOutput = args.includes('--json');
  const filePaths = args.filter(a => !a.startsWith('-'));

  if (filePaths.length === 0) {
    console.log('No files specified. Usage: node flow-standards-checker.js [files...]');
    process.exit(1);
  }

  // Load file contents
  const files = filePaths.map(f => {
    try {
      const content = fs.readFileSync(f, 'utf-8');
      return { path: f, content };
    } catch (err) {
      return { path: f, content: '', error: err.message };
    }
  });

  const results = runStandardsCheck(files);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatStandardsResults(results));
  }

  process.exit(results.blocked ? 1 : 0);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  runStandardsCheck,
  formatStandardsResults,
  parseDecisions,
  parseAppMap,
  parseFunctionMap,
  parseApiMap,
  checkNamingConventions,
  checkComponentDuplication,
  checkFunctionDuplication,
  checkSecurityPatterns,
  getCheckTypesForTask,
  isInChangedPaths,
  STANDARDS_FILES,
  MATCH_LEVEL_SEVERITY,
  TASK_CHECK_MAP,
  ALL_CHECK_TYPES
};
