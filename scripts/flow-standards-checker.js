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

const fs = require('node:fs');
const path = require('node:path');
const {
  PATHS,
  fileExists,
  readFile,
  safeJsonParse,
  color,
  getConfig
} = require('./flow-utils');
const {
  calculateCombinedSimilarity,
  getMatchLevel,
  getMatchConfig,
  findReuseCandidates
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
} catch (_err) {
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
// wf-00c5067b: 'hook-three-layer' added to all task types — entry-file LOC
// + import-count rule (per .claude/rules/architecture/hook-three-layer.md)
// is universally applicable; the exemption list in config covers known
// pre-extraction violators (see ARCH-001, ARCH-002 in .workflow/state/last-audit.json).
const TASK_CHECK_MAP = {
  'component': ['naming', 'components', 'security', 'hook-three-layer'],
  'utility': ['naming', 'functions', 'security', 'hook-three-layer'],
  'api': ['naming', 'api', 'security', 'hook-three-layer'],
  'feature': ['naming', 'components', 'functions', 'api', 'schemas', 'services', 'security', 'hook-three-layer'],
  'bugfix': ['naming', 'security', 'hook-three-layer'],
  'refactor': ['naming', 'components', 'functions', 'api', 'schemas', 'services', 'security', 'hook-three-layer'],
  'story': ['naming', 'components', 'functions', 'api', 'schemas', 'services', 'security', 'hook-three-layer'],
  'default': ['naming', 'components', 'functions', 'api', 'schemas', 'services', 'security', 'hook-three-layer']
};

// All available check types
const ALL_CHECK_TYPES = ['naming', 'components', 'functions', 'api', 'schemas', 'services', 'security', 'hook-three-layer'];

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
          } catch (_err) {
            // Skip unreadable files
          }
        }
      }
    } catch (_err) {
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
function checkSecurityPatterns(file, _securityRules) {
  const violations = [];
  const content = file.content || '';

  // Hard-coded security checks from security-patterns.md

  // 1. Raw JSON.parse — strengthened by Track B (2026-04-13).
  // Original heuristic only flagged JSON.parse OUTSIDE try blocks. This missed
  // SEC-001 (raw JSON.parse on user-config inside a try block — which loses the
  // prototype-pollution guard that safeJsonParse provides).
  // New rule: if `safeJsonParse` is importable (any `require('./flow-utils')`,
  // `require('./flow-io')`, or explicit `safeJsonParse` import in the same module),
  // raw JSON.parse on file contents is a violation regardless of try-catch.
  const fileImportsSafeJsonParse =
    /require\(['"]\.\/flow-(utils|io|config-loader)['"]\)/.test(content) ||
    /\bsafeJsonParse\b/.test(content);
  const jsonParseMatches = content.matchAll(/JSON\s*\.\s*parse\s*\(/g);
  for (const match of jsonParseMatches) {
    const beforeMatch = content.substring(0, match.index);
    const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const linesBefore = content.substring(Math.max(0, match.index - 200), match.index);
    const onSameLineAlready = content.substring(lineStart, match.index).includes('safeJsonParse');

    if (onSameLineAlready) continue;

    if (fileImportsSafeJsonParse) {
      violations.push({
        type: 'security',
        severity: 'must-fix',
        file: file.path,
        line: lineNumber,
        message: 'Raw JSON.parse — use safeJsonParse instead (file already imports flow-utils/flow-io)',
        rule: 'security-patterns.md §2 (strengthened by Track B 2026-04-13)',
      });
    } else if (!linesBefore.includes('try')) {
      violations.push({
        type: 'security',
        severity: 'must-fix',
        file: file.path,
        line: lineNumber,
        message: 'Raw JSON.parse without try-catch — use safeJsonParse from flow-utils.js',
        rule: 'security-patterns.md §2',
      });
    }
  }

  // 1b. Catch variable convention (Track B 2026-04-13).
  // naming-conventions.md mandates `_err` for unused catch variables.
  // Patterns like `catch (_parseErr)`, `catch (_e)`, `catch (_someError)` slip
  // past visual review because they look "underscore-prefixed correct."
  const catchMatches = content.matchAll(/\bcatch\s*\(\s*([A-Za-z_][\w$]*)\s*\)/g);
  for (const match of catchMatches) {
    const varName = match[1];
    // Allowed: 'err' (used inside) or '_err' (intentionally ignored).
    if (varName === 'err' || varName === '_err') continue;
    // Flag underscore-prefixed non-_err variants as MUST_FIX (intentionally ignored
    // but uses non-canonical name — naming-conventions.md violation).
    if (varName.startsWith('_')) {
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
      violations.push({
        type: 'naming',
        severity: 'must-fix',
        file: file.path,
        line: lineNumber,
        message: `catch variable "${varName}" — naming-conventions.md mandates "_err" for unused catch (not descriptive _ variants)`,
        rule: 'naming-conventions.md §"Unused Catch Variables"',
      });
    } else if (varName === 'e' || varName === 'error' || varName === 'ex' || varName === 'exception') {
      // Pre-existing rule: avoid 'e' / 'error' / 'ex' / 'exception' — use 'err'.
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
      violations.push({
        type: 'naming',
        severity: 'warning',
        file: file.path,
        line: lineNumber,
        message: `catch variable "${varName}" — use "err" per naming-conventions.md`,
        rule: 'naming-conventions.md §"Catch Block Variables"',
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

/**
 * Check for API duplication using semantic matching
 * @param {Object} file - File with path and content
 * @param {Object[]} existingEndpoints - Endpoints from api-map
 * @param {Object} matchConfig - Semantic match config — optional, auto-loaded if omitted
 * @returns {Object[]} Array of violations
 */
/**
 * wf-00c5067b — Hook Three-Layer enforcement.
 *
 * Per `.claude/rules/architecture/hook-three-layer.md`:
 *   - Entry files (`scripts/hooks/entry/<cli>/*.js`) must be ≤120 LOC and
 *     import from at most 2 `core/` modules (single-entry-point principle).
 *   - Core files (`scripts/hooks/core/*.js`) should be CLI-agnostic.
 *
 * This check enforces the LOC + import-count rules. Core CLI-identifier
 * grep is intentionally NOT enforced here (false-positive prone — adversary
 * critique 2026-05-08 found 1/4 supposed violations was actually config data).
 *
 * Exemptions: read from config.standardsCheck.hookThreeLayer.exemptions
 * map of `{relativePath: reason}`. Each exemption MUST cite a rationale
 * (typically a Phase 2 task ID for entries awaiting orchestrator extraction).
 *
 * @param {Object} file - File with path and content
 * @param {Object} hookThreeLayerConfig - {enabled, exemptions, maxLoc, maxCoreImports}
 * @returns {Object[]} Array of violations
 */
function checkHookThreeLayer(file, hookThreeLayerConfig = {}) {
  const violations = [];
  const {
    enabled = true,
    exemptions = {},
    maxLoc = 120,
    maxCoreImports = 2
  } = hookThreeLayerConfig;

  if (!enabled) return violations;

  // Normalize path to repo-root-relative form for exemption lookup
  const relPath = file.path.startsWith('/')
    ? path.relative(PATHS.root, file.path)
    : file.path;

  // Only apply to hook entry files
  const isEntry = /^scripts\/hooks\/entry\/[^/]+\/[^/]+\.js$/.test(relPath);
  if (!isEntry) return violations;

  // Skip if exempted (with rationale)
  if (Object.prototype.hasOwnProperty.call(exemptions, relPath)) return violations;

  const content = file.content || '';
  const lines = content.split('\n');

  // Rule 1: LOC ceiling
  if (lines.length > maxLoc) {
    violations.push({
      type: 'hook-three-layer',
      severity: 'must-fix',
      file: file.path,
      line: null,
      message: `Hook entry file exceeds ${maxLoc} LOC (${lines.length} lines). Extract orchestration logic to core/. Add to config.standardsCheck.hookThreeLayer.exemptions with rationale to defer.`,
      rule: 'hook-three-layer.md'
    });
  }

  // Rule 2: Core import count
  // Match `require('../core/...')` or `require('../../core/...')` etc.
  // Capture each core path; count distinct core modules imported.
  const coreImportRegex = /require\(['"][^'"]*\/core\/([^'"/]+)['"]\)/g;
  const coreModules = new Set();
  let match;
  while ((match = coreImportRegex.exec(content)) !== null) {
    coreModules.add(match[1]);
  }

  if (coreModules.size > maxCoreImports) {
    violations.push({
      type: 'hook-three-layer',
      severity: 'must-fix',
      file: file.path,
      line: null,
      message: `Hook entry imports from ${coreModules.size} core/ modules (limit: ${maxCoreImports}). Single-entry-point principle violated. Refactor to dispatch through one orchestrator-core. Modules: ${[...coreModules].sort().join(', ')}`,
      rule: 'hook-three-layer.md'
    });
  }

  return violations;
}

function checkApiDuplication(file, existingEndpoints, matchConfig) {
  const violations = [];
  const content = file.content || '';
  const config = matchConfig || getMatchConfig();

  // Detect route declarations: .get('/path'), .post('/path'), @Get('/path'), router.get('/path')
  const routeRegex = /(?:\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]|@(?:Get|Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"`]+)['"`])/gi;
  let match;

  while ((match = routeRegex.exec(content)) !== null) {
    const routePath = match[1] || match[2];
    if (!routePath) continue;

    for (const existing of existingEndpoints) {
      const existingPath = existing.path || existing.name || '';
      if (routePath === existingPath) continue; // Exact same path — skip

      const scores = calculateCombinedSimilarity(routePath, existingPath, 'apis');
      const matchLevel = getMatchLevel(scores.combined, config.thresholds);
      const severity = MATCH_LEVEL_SEVERITY[matchLevel];

      if (!severity || severity === 'info') continue;

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

      violations.push({
        type: 'api-duplication',
        severity,
        file: file.path,
        line: lineNumber,
        message: `Route "${routePath}" is ${scores.combined}% similar to existing "${existingPath}" (${existing.method || ''} ${existingPath})`,
        suggestion: 'Consider reusing or extending the existing API endpoint',
        rule: 'api-map.md'
      });
    }
  }

  return violations;
}

/**
 * Check for schema/service/generic registry duplication using semantic matching
 * @param {Object} file - File with path and content
 * @param {Object[]} existingItems - Items from the registry map
 * @param {string} domain - Domain: 'schemas', 'services', or any registry domain
 * @param {Object} matchConfig - Semantic match config — optional, auto-loaded if omitted
 * @returns {Object[]} Array of violations
 */
function checkRegistryDuplication(file, existingItems, domain, matchConfig) {
  const violations = [];
  const content = file.content || '';
  const config = matchConfig || getMatchConfig();

  // Extract declared names from file content based on domain
  const declaredNames = extractDeclaredNames(content, domain);

  for (const declaredName of declaredNames) {
    for (const existing of existingItems) {
      const existingName = existing.name || existing.title || '';
      if (declaredName.name.toLowerCase() === existingName.toLowerCase()) continue;

      const scores = calculateCombinedSimilarity(declaredName.name, existingName, domain);
      const matchLevel = getMatchLevel(scores.combined, config.thresholds);
      const severity = MATCH_LEVEL_SEVERITY[matchLevel];

      if (!severity || severity === 'info') continue;

      violations.push({
        type: `${domain}-duplication`,
        severity,
        file: file.path,
        line: declaredName.line,
        message: `${domain} item "${declaredName.name}" is ${scores.combined}% similar to existing "${existingName}" (${existing.description || 'no description'})`,
        suggestion: `Consider reusing existing ${domain} entry from ${domain === 'schemas' ? 'schema-map.md' : 'service-map.md'}`,
        rule: `${domain === 'schemas' ? 'schema-map.md' : 'service-map.md'}`
      });
    }
  }

  return violations;
}

/**
 * Extract declared names from file content based on domain
 * @param {string} content - File content
 * @param {string} domain - Domain for context
 * @returns {Array<{name: string, line: number}>}
 */
function extractDeclaredNames(content, domain) {
  const names = [];
  const lines = content.split('\n');

  // Patterns by domain
  const patterns = {
    schemas: [
      // Prisma: model User { ... }
      /^\s*model\s+(\w+)\s*\{/,
      // TypeORM: @Entity('table_name') / class UserEntity
      /@Entity\s*\(\s*['"]?(\w+)['"]?\s*\)/,
      /class\s+(\w+Entity)\b/,
      // Mongoose: new Schema / mongoose.model('Name')
      /mongoose\.model\s*\(\s*['"](\w+)['"]/,
      // Django: class UserModel(models.Model)
      /class\s+(\w+)\s*\(\s*models\.Model\s*\)/
    ],
    services: [
      // NestJS: @Controller(), @Injectable()
      /@(?:Controller|Injectable)\s*\([\s\S]*?\)\s*(?:export\s+)?class\s+(\w+)/,
      // Express: router/controller pattern
      /class\s+(\w+(?:Controller|Service|Provider|Repository))\b/,
      // Generic exported class
      /export\s+class\s+(\w+(?:Service|Manager|Handler|Processor))\b/
    ]
  };

  const domainPatterns = patterns[domain] || [
    // Fallback: any class or const export
    /export\s+(?:class|const)\s+(\w+)/
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of domainPatterns) {
      const match = lines[i].match(pattern);
      if (match && match[1]) {
        names.push({ name: match[1], line: i + 1 });
      }
    }
  }

  return names;
}

/**
 * Parse schema-map.md into schema registry
 * @returns {Object[]} Array of schema items
 */
function parseSchemaMap() {
  const schemaMapPath = path.join(PATHS.state, 'schema-map.md');
  if (!fileExists(schemaMapPath)) return [];
  return parseGenericMap(schemaMapPath);
}

/**
 * Parse service-map.md into service registry
 * @returns {Object[]} Array of service items
 */
function parseServiceMap() {
  const serviceMapPath = path.join(PATHS.state, 'service-map.md');
  if (!fileExists(serviceMapPath)) return [];
  return parseGenericMap(serviceMapPath);
}

/**
 * Generic map parser for any markdown map with table or list entries.
 * Handles future registry types automatically.
 * @param {string} mapPath - Absolute path to the map file
 * @returns {Object[]} Array of { name, description, path, source }
 */
function parseGenericMap(mapPath) {
  const content = readFile(mapPath, '');
  if (!content) return [];

  const items = [];
  const source = path.basename(mapPath);

  // Strategy 1: Parse markdown table rows (| Name | Path | Description |)
  const tableRows = content.match(/\|\s*`?([A-Za-z_][A-Za-z0-9_.-]*)`?\s*\|\s*([^\|]+)\s*\|/g) || [];
  for (const row of tableRows) {
    const match = row.match(/\|\s*`?([A-Za-z_][A-Za-z0-9_.-]*)`?\s*\|\s*([^\|]+)\s*\|/);
    if (match) {
      items.push({
        name: match[1].trim(),
        description: match[2].trim(),
        source
      });
    }
  }

  // Strategy 2: Parse markdown list entries (- **Name**: description)
  if (items.length === 0) {
    const listItems = content.match(/^-\s+\*\*([A-Za-z_][A-Za-z0-9_.-]*)\*\*:?\s*([^\n]+)?/gm) || [];
    for (const item of listItems) {
      const match = item.match(/-\s+\*\*([A-Za-z_][A-Za-z0-9_.-]*)\*\*:?\s*([^\n]+)?/);
      if (match) {
        items.push({
          name: match[1].trim(),
          description: match[2]?.trim() || '',
          source
        });
      }
    }
  }

  // Strategy 3: Parse simple list entries (- `name` — description)
  if (items.length === 0) {
    const simpleItems = content.match(/^-\s+`([A-Za-z_][A-Za-z0-9_.-]*)`\s*[—–-]\s*([^\n]+)?/gm) || [];
    for (const item of simpleItems) {
      const match = item.match(/-\s+`([A-Za-z_][A-Za-z0-9_.-]*)`\s*[—–-]\s*([^\n]+)?/);
      if (match) {
        items.push({
          name: match[1].trim(),
          description: match[2]?.trim() || '',
          source
        });
      }
    }
  }

  return items;
}

/**
 * Discover all registry map files — from manifest first, then disk fallback.
 * Returns a unified list regardless of whether registries are "active".
 * @returns {Array<{id: string, domain: string, mapFile: string, mapPath: string, source: string}>}
 */
function discoverAllRegistries() {
  const registries = [];
  const seen = new Set();

  // 1. Load from registry-manifest.json
  const manifestPath = path.join(PATHS.state, 'registry-manifest.json');
  if (fileExists(manifestPath)) {
    try {
      const manifest = safeJsonParse(manifestPath, null);
      if (manifest && manifest.registries) {
        for (const reg of manifest.registries) {
          // Validate mapFile is a safe filename (no path traversal)
          if (!reg.mapFile || !/^[a-z0-9-]+\.md$/.test(reg.mapFile)) continue;
          const mapPath = path.join(PATHS.state, reg.mapFile);
          if (fileExists(mapPath)) {
            registries.push({
              id: reg.id,
              domain: reg.type || reg.id,
              mapFile: reg.mapFile,
              mapPath,
              source: 'manifest'
            });
            seen.add(reg.mapFile);
          }
        }
      }
    } catch (_err) {
      // Fall through to disk scan
    }
  }

  // 2. Disk fallback — scan .workflow/state/*-map.md for files not in manifest
  try {
    const stateDir = PATHS.state;
    const entries = fs.readdirSync(stateDir);
    for (const entry of entries) {
      if (entry.endsWith('-map.md') && !seen.has(entry) && /^[a-z0-9-]+\.md$/.test(entry)) {
        const mapPath = path.join(stateDir, entry);
        const id = entry.replace('-map.md', '');
        registries.push({
          id,
          domain: id,
          mapFile: entry,
          mapPath,
          source: 'disk'
        });
        seen.add(entry);
      }
    }
  } catch (_err) {
    // Disk scan failed — proceed with manifest-only results
  }

  return registries;
}

/**
 * Collect reuse candidates from ALL registries for AI-as-judge evaluation.
 * Uses a low 30% pre-filter threshold — the AI filters before the user sees results.
 *
 * @param {Object[]} files - Files with path and content
 * @param {Object} options - Options: { taskType, changedPaths, allRegistries }
 * @returns {Array<{newItem: string, file: string, domain: string, matches: Object[]}>}
 */
function collectReuseCandidates(files, options = {}) {
  const _config = getMatchConfig();
  const candidates = [];

  // Map domain → parser
  const domainParsers = {
    components: parseAppMap,
    functions: parseFunctionMap,
    apis: parseApiMap,
    schemas: parseSchemaMap,
    services: parseServiceMap
  };

  // Discover registries — all when allRegistries is true (default), active-only otherwise
  const allRegs = options.allRegistries !== false;
  let registries;
  if (allRegs) {
    registries = discoverAllRegistries();
  } else {
    // Only check active registries (from manifest)
    try {
      const { getActiveRegistries } = require('./flow-utils');
      registries = getActiveRegistries().map(r => ({
        id: r.id,
        domain: r.type || r.id,
        mapFile: r.mapFile,
        mapPath: path.join(PATHS.state, r.mapFile),
        source: 'active'
      }));
    } catch (_err) {
      registries = discoverAllRegistries();
    }
  }

  for (const registry of registries) {
    // Parse registry items
    let items;
    const parser = domainParsers[registry.domain];
    if (parser) {
      items = parser();
    } else {
      // Generic fallback for unknown registry types
      items = parseGenericMap(registry.mapPath);
    }

    if (!items || items.length === 0) continue;

    // For each file, extract declared names and find candidates
    for (const file of files) {
      if (!file.content) continue;

      // Extract names relevant to this domain
      const declaredNames = extractDeclaredNames(file.content, registry.domain);

      // Also check file name for component-like registries
      if (['components'].includes(registry.domain)) {
        const fileName = path.basename(file.path, path.extname(file.path));
        if (fileName && /^[A-Z]/.test(fileName)) {
          // Avoid duplicate if extractDeclaredNames already found the same name
          if (!declaredNames.some(d => d.name === fileName)) {
            declaredNames.push({ name: fileName, line: 1 });
          }
        }
      }

      for (const declared of declaredNames) {
        const matches = findReuseCandidates(declared.name, items, registry.domain);

        if (matches.length > 0) {
          candidates.push({
            newItem: declared.name,
            file: file.path,
            line: declared.line,
            domain: registry.domain,
            registryFile: registry.mapFile,
            matches
          });
        }
      }
    }
  }

  return candidates;
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
  const _decisions = parseDecisions();
  const components = checksToRun.includes('components') ? parseAppMap() : [];
  const functions = checksToRun.includes('functions') ? parseFunctionMap() : [];
  const endpoints = checksToRun.includes('api') ? parseApiMap() : [];
  const rulesFiles = checksToRun.includes('security') ? loadRulesDir() : [];

  // Load schema/service registries if needed
  const schemas = checksToRun.includes('schemas') ? parseSchemaMap() : [];
  const services = checksToRun.includes('services') ? parseServiceMap() : [];

  const allViolations = [];

  // wf-00c5067b: load hook-three-layer config (with sensible defaults if unset)
  const config = getConfig();
  const hookThreeLayerConfig = (config?.standardsCheck?.hookThreeLayer) || {
    enabled: checksToRun.includes('hook-three-layer'),
    exemptions: {},
    maxLoc: 120,
    maxCoreImports: 2
  };

  const checksSummary = {
    'decisions.md': { checked: true, violations: 0 },
    'app-map.md': { checked: checksToRun.includes('components') && components.length > 0, violations: 0 },
    'function-map.md': { checked: checksToRun.includes('functions') && functions.length > 0, violations: 0 },
    'api-map.md': { checked: checksToRun.includes('api') && endpoints.length > 0, violations: 0 },
    'schema-map.md': { checked: checksToRun.includes('schemas') && schemas.length > 0, violations: 0 },
    'service-map.md': { checked: checksToRun.includes('services') && services.length > 0, violations: 0 },
    'naming-conventions': { checked: checksToRun.includes('naming'), violations: 0 },
    'security-patterns': { checked: checksToRun.includes('security'), violations: 0 },
    'hook-three-layer': { checked: checksToRun.includes('hook-three-layer'), violations: 0 }
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

    // API duplication
    if (checksToRun.includes('api') && endpoints.length > 0) {
      const apiViolations = checkApiDuplication(file, endpoints, matchConfig);
      allViolations.push(...apiViolations);
      checksSummary['api-map.md'].violations += apiViolations.length;
    }

    // Schema duplication
    if (checksToRun.includes('schemas') && schemas.length > 0) {
      const schemaViolations = checkRegistryDuplication(file, schemas, 'schemas', matchConfig);
      allViolations.push(...schemaViolations);
      checksSummary['schema-map.md'].violations += schemaViolations.length;
    }

    // Service duplication
    if (checksToRun.includes('services') && services.length > 0) {
      const serviceViolations = checkRegistryDuplication(file, services, 'services', matchConfig);
      allViolations.push(...serviceViolations);
      checksSummary['service-map.md'].violations += serviceViolations.length;
    }

    // Security patterns
    if (checksToRun.includes('security')) {
      const securityViolations = checkSecurityPatterns(file, rulesFiles);
      allViolations.push(...securityViolations);
      checksSummary['security-patterns'].violations += securityViolations.length;
    }

    // Hook three-layer architecture (wf-00c5067b)
    if (checksToRun.includes('hook-three-layer')) {
      const hookViolations = checkHookThreeLayer(file, hookThreeLayerConfig);
      allViolations.push(...hookViolations);
      checksSummary['hook-three-layer'].violations += hookViolations.length;
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
// Non-Negotiable Rules Validation (wf-d0adca72 / A5)
// ============================================================================

const NON_NEGOTIABLE_FRAGMENT_ID = 'non-negotiable-rules';
const NON_NEGOTIABLE_FRAGMENT_PATH = '.workflow/prompts/fragments/non-negotiable-rules.md';
const CITATION_FORMAT_REGEX = /\b[\w./-]+\.(?:js|ts|tsx|jsx|md|json|yaml|yml|py|go|rs|sh):\d+(?:-\d+)?\b/;

/**
 * Validate that the non-negotiable-rules fragment exists and is loadable.
 * @returns {{ ok: boolean, reason?: string, path?: string }}
 */
function checkNonNegotiableFragment() {
  const fs = require('node:fs');
  const path = require('node:path');
  const full = path.join(process.cwd(), NON_NEGOTIABLE_FRAGMENT_PATH);
  if (!fs.existsSync(full)) {
    return { ok: false, reason: `missing fragment: ${NON_NEGOTIABLE_FRAGMENT_PATH}`, path: full };
  }
  const content = fs.readFileSync(full, 'utf8');
  const required = ['Evidence before claim', 'No silent scope changes', 'Route every request', 'filepath:line', 'Destructive operations', 'Do not invent artifacts'];
  const missing = required.filter((r) => !content.includes(r));
  if (missing.length > 0) {
    return { ok: false, reason: `fragment missing required sections: ${missing.join(', ')}`, path: full };
  }
  return { ok: true, path: full };
}

/**
 * Validate that a composed prompt includes the non-negotiable-rules block.
 * @param {string} composedPrompt
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkComposedPromptHasNonNegotiables(composedPrompt) {
  if (!composedPrompt || typeof composedPrompt !== 'string') {
    return { ok: false, reason: 'composedPrompt must be a non-empty string' };
  }
  if (!composedPrompt.includes('Non-Negotiable Rules')) {
    return { ok: false, reason: 'composed prompt missing "Non-Negotiable Rules" header — fragment not loaded' };
  }
  if (!composedPrompt.includes('filepath:line')) {
    return { ok: false, reason: 'composed prompt missing citation-format rule' };
  }
  return { ok: true };
}

/**
 * Validate that a text body contains at least one filepath:line citation when it makes claims about code.
 * Heuristic: if the text references code (function names with parens, paths with slashes, or quoted identifiers),
 * it should cite at least one location in `path:line` format.
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.requireCitation=true]
 * @returns {{ ok: boolean, reason?: string, hasCitation: boolean }}
 */
function checkCitationFormat(text, { requireCitation = true } = {}) {
  if (!text || typeof text !== 'string') {
    return { ok: false, reason: 'text must be a non-empty string', hasCitation: false };
  }
  const hasCitation = CITATION_FORMAT_REGEX.test(text);
  if (!requireCitation) return { ok: true, hasCitation };
  // Make claim-about-code detection lightweight
  const looksLikeCodeClaim = /\b(function|class|module|import|require|file|path)\b|`[^`]+`/.test(text);
  if (looksLikeCodeClaim && !hasCitation) {
    return { ok: false, reason: 'text references code but has no filepath:line citation', hasCitation: false };
  }
  return { ok: true, hasCitation };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  runStandardsCheck,
  formatStandardsResults,
  checkNonNegotiableFragment,
  checkComposedPromptHasNonNegotiables,
  checkCitationFormat,
  NON_NEGOTIABLE_FRAGMENT_ID,
  NON_NEGOTIABLE_FRAGMENT_PATH,
  CITATION_FORMAT_REGEX,
  parseDecisions,
  parseAppMap,
  parseFunctionMap,
  parseApiMap,
  parseSchemaMap,
  parseServiceMap,
  parseGenericMap,
  checkNamingConventions,
  checkComponentDuplication,
  checkFunctionDuplication,
  checkApiDuplication,
  checkRegistryDuplication,
  checkSecurityPatterns,
  checkHookThreeLayer,
  extractDeclaredNames,
  discoverAllRegistries,
  collectReuseCandidates,
  getCheckTypesForTask,
  isInChangedPaths,
  STANDARDS_FILES,
  MATCH_LEVEL_SEVERITY,
  TASK_CHECK_MAP,
  ALL_CHECK_TYPES
};
