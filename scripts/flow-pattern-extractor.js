#!/usr/bin/env node

/**
 * Wogi Flow - Pattern Extraction Engine
 *
 * Scans codebases to extract patterns across 10 categories:
 * - Code patterns (naming, error handling, imports)
 * - API patterns (endpoints, responses, pagination, error format, status codes)
 * - Component patterns (props, hooks, state)
 * - Architecture patterns (file org, modules, layers)
 * - Type patterns (interface prefix, type naming, enums, generics)
 * - Export patterns (default vs named, barrel files, module system)
 * - Test patterns (file naming, organization, assertions, mocking)
 * - Folder patterns (feature-first vs type-first, co-location)
 * - Comment patterns (doc style, inline, headers, TODOs)
 * - Config patterns (env style, validation, defaults)
 *
 * Detects conflicts between old and new code patterns,
 * provides recommendations based on frequency/recency/best practices.
 *
 * Usage:
 *   flow pattern-extract [options]
 *   node scripts/flow-pattern-extractor.js [options]
 *
 * Options:
 *   --output <file>        Output file (default: stdout)
 *   --format <format>      Output format: json, markdown, decisions (default: json)
 *   --categories <cats>    Categories: code,api,component,architecture,types,exports,tests,folders,comments,config (default: all)
 *   --framework <name>     Framework: auto, react, nestjs, python (default: auto)
 *   --with-conflicts       Include conflict analysis
 *   --resolve-conflicts    Interactive conflict resolution (uses flow-conflict-resolver)
 *   --analysis-mode <mode> Git analysis: balanced (default), deep
 *   --max-files <n>        Max files to scan (default: 1000)
 *   --json                 JSON output for scripting
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const { resolvePatterns } = require('./flow-framework-resolver');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_FILES = 1000;
const DEFAULT_ANALYSIS_MODE = 'balanced';

// Module-level analysis mode (set by extractPatterns, read by addPatternOccurrence)
let _currentAnalysisMode = DEFAULT_ANALYSIS_MODE;

// Cache for git file dates to avoid repeated git calls
const _gitFileDateCache = new Map();

// Pattern detection thresholds
const MIN_PATTERN_FREQUENCY = 0.05;  // At least 5% of files must use pattern
const CONFLICT_THRESHOLD = 0.10;     // Patterns with >10% each are conflicting

// Scoring weights for recommendations
const SCORING_WEIGHTS = {
  frequency: 0.30,
  recency: 0.30,
  bestPractice: 0.25,
  consistency: 0.15
};

// File patterns to scan by language
const FILE_PATTERNS = {
  javascript: ['**/*.js', '**/*.jsx', '**/*.mjs'],
  typescript: ['**/*.ts', '**/*.tsx'],
  python: ['**/*.py'],
  go: ['**/*.go'],
  rust: ['**/*.rs'],
  java: ['**/*.java']
};

// Ignore patterns
const IGNORE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.git/**',
  'coverage/**',
  '*.min.js',
  '*.bundle.js',
  '__pycache__/**',
  '.venv/**',
  'vendor/**'
];

// Colors for CLI output
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get project root directory
 */
function getProjectRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Generate unique pattern ID
 */
function generatePatternId() {
  return 'pat-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Glob files with ignore patterns
 */
function globFiles(projectRoot, patterns, ignorePatterns = IGNORE_PATTERNS) {
  const results = [];

  function walkDir(dir, baseDir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        // Check ignore patterns
        const shouldIgnore = ignorePatterns.some(pattern => {
          if (pattern.endsWith('/**')) {
            const dirPattern = pattern.slice(0, -3);
            return relativePath.startsWith(dirPattern) || entry.name === dirPattern;
          }
          return entry.name === pattern || relativePath === pattern;
        });

        if (shouldIgnore) continue;

        if (entry.isDirectory()) {
          walkDir(fullPath, baseDir);
        } else if (entry.isFile()) {
          // Check if matches any pattern
          const matches = patterns.some(pattern => {
            return matchesGlobPattern(relativePath, entry.name, pattern);
          });

          if (matches) {
            results.push(relativePath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walkDir(projectRoot, projectRoot);
  return results;
}

/**
 * Match a file against a glob pattern.
 * Supports:
 *   **\/*.ext         - match by extension anywhere (e.g., **\/*.prisma)
 *   **\/*.compound.ext - match by compound extension (e.g., **\/*.controller.ts)
 *   **\/name.ext      - match exact filename anywhere (e.g., **\/models.py)
 *   **\/*suffix.ext   - match suffix pattern anywhere (e.g., **\/*_handler.go)
 *   dir/**\/*.ext     - match by extension within directory (e.g., prisma/**\/*.prisma)
 *   **\/dir/**\/*.ext - match extension within any ancestor dir (e.g., **\/models/**\/*.py)
 *
 * @param {string} relativePath - File path relative to project root
 * @param {string} fileName - Filename only (no directory)
 * @param {string} pattern - Glob pattern to match
 * @returns {boolean} Whether the file matches
 */
function matchesGlobPattern(relativePath, fileName, pattern) {
  // dir/**//*.ext — match extension within a specific directory prefix
  // e.g., prisma/**//*.prisma matches prisma/schema/user.prisma
  const dirScopedMatch = pattern.match(/^([^*]+)\/\*\*\/\*\.(.+)$/);
  if (dirScopedMatch) {
    const dirPrefix = dirScopedMatch[1];
    const ext = '.' + dirScopedMatch[2];
    return relativePath.startsWith(dirPrefix + '/') && fileName.endsWith(ext);
  }

  // **/dir/**//*.ext — match extension within any ancestor directory name
  // e.g., **/models/**//*.py matches src/models/user.py
  const anyDirScopedMatch = pattern.match(/^\*\*\/([^*]+)\/\*\*\/\*\.(.+)$/);
  if (anyDirScopedMatch) {
    const dirName = anyDirScopedMatch[1];
    const ext = '.' + anyDirScopedMatch[2];
    return (relativePath.includes('/' + dirName + '/') || relativePath.startsWith(dirName + '/')) &&
           fileName.endsWith(ext);
  }

  // **/*.ext or **/*.compound.ext — match by extension/suffix anywhere
  if (pattern.startsWith('**/*.')) {
    const ext = pattern.slice(4);
    return fileName.endsWith(ext);
  }

  // **/name.ext — match exact filename in any directory
  if (pattern.startsWith('**/') && !pattern.slice(3).includes('*')) {
    const targetName = pattern.slice(3);
    return fileName === targetName;
  }

  // **/*suffix.ext — match suffix pattern anywhere (e.g., **/*_handler.go)
  if (pattern.startsWith('**/*') && !pattern.slice(4).includes('*') && !pattern.slice(4).includes('/')) {
    const suffix = pattern.slice(4);
    return fileName.endsWith(suffix);
  }

  // Exact filename match
  return fileName === pattern;
}

/**
 * Detect project framework
 */
function detectFramework(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Check for frameworks
      if (deps['next']) return 'nextjs';
      if (deps['@nestjs/core']) return 'nestjs';
      if (deps['react']) return 'react';
      if (deps['vue']) return 'vue';
      if (deps['@angular/core']) return 'angular';
      if (deps['express']) return 'express';
      if (deps['fastify']) return 'fastify';

      // Check for TypeScript
      if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
        return 'typescript';
      }

      return 'javascript';
    } catch {
      return 'javascript';
    }
  }

  // Check for Python
  if (fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
      fs.existsSync(path.join(projectRoot, 'setup.py')) ||
      fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {

    // Check for frameworks
    try {
      const reqPath = path.join(projectRoot, 'requirements.txt');
      if (fs.existsSync(reqPath)) {
        const reqs = fs.readFileSync(reqPath, 'utf-8');
        if (reqs.includes('fastapi')) return 'fastapi';
        if (reqs.includes('django')) return 'django';
        if (reqs.includes('flask')) return 'flask';
      }
    } catch {
      // Ignore
    }
    return 'python';
  }

  // Check for Go
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return 'go';
  }

  // Check for Rust
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    return 'rust';
  }

  return 'unknown';
}

/**
 * Get git blame date for a file line
 */
function _getGitBlameDate(projectRoot, filePath, lineNumber) {
  try {
    // Validate lineNumber to prevent command injection
    const lineNum = parseInt(lineNumber, 10);
    if (isNaN(lineNum) || lineNum < 1 || lineNum > 1000000) {
      return null;
    }

    // Validate filePath to prevent path traversal
    const fullPath = path.join(projectRoot, filePath);
    if (!fullPath.startsWith(projectRoot + path.sep) && fullPath !== projectRoot) {
      return null;
    }
    // Use execFileSync with array arguments to prevent shell injection
    const output = execFileSync('git', [
      'blame',
      '-L', `${lineNum},${lineNum}`,
      '--porcelain',
      fullPath
    ], {
      encoding: 'utf-8',
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timestampMatch = output.match(/^author-time (\d+)/m);
    if (timestampMatch) {
      return new Date(parseInt(timestampMatch[1]) * 1000);
    }
  } catch {
    // Git blame failed (file not tracked, invalid line, etc.)
  }
  return null;
}

/**
 * Get file's last commit date via git log (more reliable than mtime after git clone)
 */
function _getGitFileDate(projectRoot, filePath) {
  const key = `${projectRoot}:${filePath}`;
  if (_gitFileDateCache.has(key)) {
    return _gitFileDateCache.get(key);
  }

  // Validate filePath to prevent path traversal
  const resolvedPath = path.resolve(projectRoot, filePath);
  if (!resolvedPath.startsWith(projectRoot + path.sep) && resolvedPath !== projectRoot) {
    const date = getFileMtime(projectRoot, filePath);
    _gitFileDateCache.set(key, date);
    return date;
  }

  try {
    const output = execFileSync('git', [
      'log', '-1', '--format=%at', '--', filePath
    ], {
      encoding: 'utf-8',
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timestamp = parseInt(output.trim(), 10);
    if (!isNaN(timestamp) && timestamp > 0) {
      const date = new Date(timestamp * 1000);
      _gitFileDateCache.set(key, date);
      return date;
    }
  } catch {
    // Git log failed (not a git repo, file not tracked, etc.)
  }

  // Fallback to mtime
  const date = getFileMtime(projectRoot, filePath);
  _gitFileDateCache.set(key, date);
  return date;
}

/**
 * Get file modification time
 */
function getFileMtime(projectRoot, filePath) {
  try {
    const fullPath = path.join(projectRoot, filePath);
    const stats = fs.statSync(fullPath);
    return stats.mtime;
  } catch {
    return new Date(0);
  }
}

// ============================================================================
// Pattern Data Structures
// ============================================================================

/**
 * Create a pattern object
 */
function createPattern(category, subcategory, name, options = {}) {
  return {
    id: generatePatternId(),
    category,
    subcategory,
    name,
    description: options.description || '',
    examples: options.examples || [],
    frequency: options.frequency || 0,
    files: options.files || [],
    firstSeen: options.firstSeen || null,
    lastSeen: options.lastSeen || null,
    confidence: options.confidence || 0,
    source: options.source || 'detected'
  };
}

/**
 * Create a conflict object
 */
function createConflict(patternA, patternB, options = {}) {
  return {
    id: 'conf-' + crypto.randomBytes(4).toString('hex'),
    category: patternA.category,
    subcategory: patternA.subcategory,
    description: options.description || `Conflicting ${patternA.subcategory} patterns`,
    patternA: {
      pattern: patternA,
      occurrences: patternA.frequency,
      newestOccurrence: patternA.lastSeen,
      files: patternA.files.slice(0, 5)
    },
    patternB: {
      pattern: patternB,
      occurrences: patternB.frequency,
      newestOccurrence: patternB.lastSeen,
      files: patternB.files.slice(0, 5)
    },
    recommendation: options.recommendation || null,
    recommendationReason: options.recommendationReason || '',
    resolution: null
  };
}

// ============================================================================
// Code Pattern Extractors
// ============================================================================

/**
 * Extract code-level patterns: naming, error handling, imports
 */
function extractCodePatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'naming.files': {},
    'naming.functions': {},
    'naming.variables': {},
    'error-handling.catch-variable': {},
    'error-handling.style': {},
    'imports.style': {}
  };

  for (const file of files) {
    const fullPath = path.join(projectRoot, file);
    let content;

    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const basename = path.basename(file);
    const ext = path.extname(file);

    // File naming patterns
    if (/^[a-z][a-z0-9-]*\.[a-z]+$/.test(basename)) {
      addPatternOccurrence(patterns['naming.files'], 'kebab-case', file, projectRoot);
    } else if (/^[A-Z][a-zA-Z0-9]*\.[a-z]+$/.test(basename)) {
      addPatternOccurrence(patterns['naming.files'], 'PascalCase', file, projectRoot);
    } else if (/^[a-z][a-zA-Z0-9]*\.[a-z]+$/.test(basename)) {
      addPatternOccurrence(patterns['naming.files'], 'camelCase', file, projectRoot);
    } else if (/^[a-z][a-z0-9_]*\.[a-z]+$/.test(basename)) {
      addPatternOccurrence(patterns['naming.files'], 'snake_case', file, projectRoot);
    }

    // Function naming patterns (JS/TS)
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
      const funcMatches = content.matchAll(/function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g);
      for (const match of funcMatches) {
        const funcName = match[1];
        if (/^[a-z][a-zA-Z0-9]*$/.test(funcName)) {
          addPatternOccurrence(patterns['naming.functions'], 'camelCase', file, projectRoot);
        } else if (/^[a-z][a-z0-9_]*$/.test(funcName)) {
          addPatternOccurrence(patterns['naming.functions'], 'snake_case', file, projectRoot);
        }
      }

      // Arrow function naming
      const arrowMatches = content.matchAll(/const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:async\s*)?\(/g);
      for (const match of arrowMatches) {
        const funcName = match[1];
        if (/^[a-z][a-zA-Z0-9]*$/.test(funcName)) {
          addPatternOccurrence(patterns['naming.functions'], 'camelCase', file, projectRoot);
        }
      }

      // Error handling - catch variable naming
      const catchMatches = content.matchAll(/catch\s*\(\s*(\w+)\s*\)/g);
      for (const match of catchMatches) {
        const errorVar = match[1];
        if (errorVar === 'err') {
          addPatternOccurrence(patterns['error-handling.catch-variable'], 'err', file, projectRoot);
        } else if (errorVar === 'e') {
          addPatternOccurrence(patterns['error-handling.catch-variable'], 'e', file, projectRoot);
        } else if (errorVar === 'error') {
          addPatternOccurrence(patterns['error-handling.catch-variable'], 'error', file, projectRoot);
        }
      }

      // Import style - absolute vs relative
      const importMatches = content.matchAll(/import\s+.*\s+from\s+['"]([^'"]+)['"]/g);
      for (const match of importMatches) {
        const importPath = match[1];
        if (importPath.startsWith('.') || importPath.startsWith('..')) {
          addPatternOccurrence(patterns['imports.style'], 'relative', file, projectRoot);
        } else if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
          addPatternOccurrence(patterns['imports.style'], 'absolute-alias', file, projectRoot);
        } else if (!importPath.includes('/') || importPath.startsWith('@')) {
          // Package import, skip
        } else {
          addPatternOccurrence(patterns['imports.style'], 'absolute', file, projectRoot);
        }
      }
    }

    // Python-specific patterns
    if (ext === '.py') {
      // Function naming
      const pyFuncMatches = content.matchAll(/def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g);
      for (const match of pyFuncMatches) {
        const funcName = match[1];
        if (/^[a-z][a-z0-9_]*$/.test(funcName)) {
          addPatternOccurrence(patterns['naming.functions'], 'snake_case', file, projectRoot);
        } else if (/^[a-z][a-zA-Z0-9]*$/.test(funcName)) {
          addPatternOccurrence(patterns['naming.functions'], 'camelCase', file, projectRoot);
        }
      }

      // Exception variable
      const exceptMatches = content.matchAll(/except\s+\w+\s+as\s+(\w+)/g);
      for (const match of exceptMatches) {
        const errorVar = match[1];
        if (errorVar === 'e') {
          addPatternOccurrence(patterns['error-handling.catch-variable'], 'e', file, projectRoot);
        } else if (errorVar === 'err') {
          addPatternOccurrence(patterns['error-handling.catch-variable'], 'err', file, projectRoot);
        } else if (errorVar === 'error') {
          addPatternOccurrence(patterns['error-handling.catch-variable'], 'error', file, projectRoot);
        }
      }
    }
  }

  return aggregatePatterns(patterns, 'code', files.length);
}

/**
 * Add a pattern occurrence
 */
function addPatternOccurrence(patternMap, patternName, file, projectRoot) {
  if (!patternMap[patternName]) {
    patternMap[patternName] = {
      files: [],
      mtime: null
    };
  }

  patternMap[patternName].files.push(file);

  // Track most recent - use git dates in deep mode for reliable recency
  const fileDate = _currentAnalysisMode === 'deep'
    ? _getGitFileDate(projectRoot, file)
    : getFileMtime(projectRoot, file);

  if (!patternMap[patternName].mtime || fileDate > patternMap[patternName].mtime) {
    patternMap[patternName].mtime = fileDate;
  }
}

/**
 * Aggregate pattern occurrences into Pattern objects
 */
function aggregatePatterns(patternMap, category, totalFiles) {
  const results = [];

  for (const [subcategory, patterns] of Object.entries(patternMap)) {
    for (const [name, data] of Object.entries(patterns)) {
      const frequency = data.files.length;
      const frequencyRatio = frequency / totalFiles;

      // Skip patterns with too few occurrences
      if (frequencyRatio < MIN_PATTERN_FREQUENCY) continue;

      results.push(createPattern(category, subcategory, name, {
        description: getPatternDescription(subcategory, name),
        frequency: frequency,
        files: data.files.slice(0, 10), // Keep first 10 examples
        lastSeen: data.mtime,
        confidence: Math.min(frequencyRatio * 2, 1) // Higher frequency = higher confidence
      }));
    }
  }

  return results;
}

/**
 * Get human-readable pattern description
 */
function getPatternDescription(subcategory, name) {
  const descriptions = {
    'naming.files': {
      'kebab-case': 'File names use kebab-case (e.g., my-component.tsx)',
      'PascalCase': 'File names use PascalCase (e.g., MyComponent.tsx)',
      'camelCase': 'File names use camelCase (e.g., myComponent.tsx)',
      'snake_case': 'File names use snake_case (e.g., my_component.tsx)'
    },
    'naming.functions': {
      'camelCase': 'Functions use camelCase naming',
      'snake_case': 'Functions use snake_case naming',
      'PascalCase': 'Functions use PascalCase naming'
    },
    'error-handling.catch-variable': {
      'err': 'Catch blocks use "err" as error variable',
      'e': 'Catch blocks use "e" as error variable',
      'error': 'Catch blocks use "error" as error variable'
    },
    'imports.style': {
      'relative': 'Imports use relative paths (./file)',
      'absolute': 'Imports use absolute paths',
      'absolute-alias': 'Imports use path aliases (@/ or ~/)'
    },
    // API patterns
    'api.naming': {
      'kebab-case-routes': 'API routes use kebab-case (/my-resource)',
      'snake_case-routes': 'API routes use snake_case (/my_resource)',
      'camelCase-routes': 'API routes use camelCase (/myResource)'
    },
    'api.response-format': {
      'wrapped-response': 'API responses wrapped with success flag',
      'data-wrapper': 'API responses wrapped in { data: ... }',
      'data-meta-envelope': 'API responses use { data, meta } envelope',
      'result-status-envelope': 'API responses use { result, status } envelope'
    },
    'api.error-format': {
      'error-message-object': 'Errors returned as { error, message }',
      'errors-array': 'Errors returned as { errors: [...] }',
      'code-message-pair': 'Errors returned as { code, message }'
    },
    'api.pagination': {
      'page-limit': 'Pagination uses page/limit parameters',
      'cursor-based': 'Pagination uses cursor-based approach',
      'offset-limit': 'Pagination uses offset/limit parameters'
    },
    'api.status-codes': {
      '201-on-create': 'Returns 201 for resource creation',
      '204-no-content': 'Returns 204 for no-content responses',
      '422-validation': 'Returns 422 for validation errors',
      '400-validation': 'Returns 400 for validation errors'
    },
    // Type patterns
    'types.interface-prefix': {
      'I-prefix': 'Interfaces use I-prefix (IUser, IConfig)',
      'no-prefix': 'Interfaces have no prefix (User, Config)'
    },
    'types.type-naming': {
      'T-prefix': 'Type aliases use T-prefix (TUser, TConfig)',
      'PascalCase': 'Type aliases use PascalCase (User, Config)'
    },
    'types.enum-naming': {
      'SCREAMING_SNAKE': 'Enum members use SCREAMING_SNAKE_CASE',
      'PascalCase': 'Enum members use PascalCase'
    },
    'types.generic-naming': {
      'single-letter': 'Generics use single letters (T, K, V)',
      'T-prefix-descriptive': 'Generics use T-prefix descriptive names (TProps, TState)'
    },
    // Export patterns
    'exports.style': {
      'default-export': 'Modules use default exports',
      'named-exports': 'Modules use named exports'
    },
    'exports.barrel': {
      'barrel-index': 'Directories use barrel index files for re-exports'
    },
    'exports.module-system': {
      'commonjs': 'Uses CommonJS (module.exports/require)',
      'esm': 'Uses ES Modules (import/export)'
    },
    // Test patterns
    'tests.file-naming': {
      'dot-test': 'Test files use .test.ts naming',
      'dot-spec': 'Test files use .spec.ts naming',
      '__tests__-dir': 'Tests placed in __tests__/ directories'
    },
    'tests.organization': {
      'nested-describes': 'Tests use deeply nested describe blocks',
      'flat-describes': 'Tests use flat describe blocks',
      'should-style': 'Test names use "should" prefix',
      'descriptive-style': 'Test names use plain descriptions'
    },
    'tests.assertion': {
      'expect': 'Tests use expect() assertions (Jest/Vitest)',
      'assert': 'Tests use assert() assertions (Node/Chai)'
    },
    'tests.mocking': {
      'jest-mock': 'Uses jest.mock() for mocking',
      'jest-spyOn': 'Uses jest.spyOn() for spying',
      'sinon': 'Uses Sinon.js for mocking/stubbing',
      'vitest': 'Uses Vitest vi.mock()/vi.spyOn()'
    },
    'tests.setup': {
      'beforeEach': 'Uses beforeEach for test setup',
      'beforeAll': 'Uses beforeAll for suite setup',
      'afterEach': 'Uses afterEach for teardown'
    },
    // Folder patterns
    'folders.organization': {
      'feature-first': 'Project uses feature-first directory organization',
      'type-first': 'Project uses type-first directory organization (components/, services/)'
    },
    'folders.colocation': {
      'colocated': 'Tests are co-located next to source files',
      'separate-test-dir': 'Tests are in separate test directories'
    },
    'folders.index-files': {
      'index-per-dir': 'Directories use index files for exports'
    },
    // Comment patterns
    'comments.doc-style': {
      'jsdoc': 'Uses JSDoc with @param/@returns annotations',
      'block-comments': 'Uses block comments (/** ... */) without tags',
      'docstrings': 'Uses Python docstrings for documentation'
    },
    'comments.inline-style': {
      'double-slash': 'Uses // for inline comments',
      'block-inline': 'Uses /* */ for inline comments'
    },
    'comments.file-header': {
      'has-header': 'Files have header comments/shebangs'
    },
    'comments.todo-style': {
      'TODO': 'Uses TODO markers for pending work',
      'FIXME': 'Uses FIXME markers for known issues',
      'HACK': 'Uses HACK markers for workarounds'
    },
    // Config patterns
    'config.env-style': {
      'dotenv': 'Uses .env files for environment configuration',
      'config-dir': 'Uses dedicated config/ directory'
    },
    'config.env-naming': {
      'SCREAMING_SNAKE': 'Environment variables use SCREAMING_SNAKE_CASE'
    },
    'config.validation': {
      'joi': 'Uses Joi for config/input validation',
      'zod': 'Uses Zod for config/input validation',
      'class-validator': 'Uses class-validator decorators'
    },
    'config.defaults': {
      'or-fallback': 'Uses || operator for default values',
      'nullish-coalescing': 'Uses ?? operator for default values'
    }
  };

  return descriptions[subcategory]?.[name] || `${subcategory}: ${name}`;
}

// ============================================================================
// API Pattern Extractors
// ============================================================================

/**
 * Extract API patterns: endpoints, responses, validation
 */
function extractApiPatterns(projectRoot, files, options = {}) {
  const patterns = {
    'api.naming': {},
    'api.response-format': {},
    'api.error-format': {},
    'api.pagination': {},
    'api.status-codes': {}
  };

  const framework = options.framework || 'unknown';

  for (const file of files) {
    const fullPath = path.join(projectRoot, file);
    let content;

    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // NestJS patterns
    if (framework === 'nestjs' || content.includes('@Controller')) {
      // Route naming
      const routeMatches = content.matchAll(/@(Get|Post|Put|Delete|Patch)\(['"]([^'"]*)['"]\)/g);
      for (const match of routeMatches) {
        const route = match[2];
        if (route.includes('-')) {
          addPatternOccurrence(patterns['api.naming'], 'kebab-case-routes', file, projectRoot);
        } else if (route.includes('_')) {
          addPatternOccurrence(patterns['api.naming'], 'snake_case-routes', file, projectRoot);
        } else if (/[A-Z]/.test(route)) {
          addPatternOccurrence(patterns['api.naming'], 'camelCase-routes', file, projectRoot);
        }
      }
    }

    // Express patterns
    if (content.includes('express') || content.includes('app.get') || content.includes('router.')) {
      const routeMatches = content.matchAll(/\.(get|post|put|delete|patch)\(['"]([^'"]*)['"]/gi);
      for (const match of routeMatches) {
        const route = match[2];
        if (route.includes('-')) {
          addPatternOccurrence(patterns['api.naming'], 'kebab-case-routes', file, projectRoot);
        } else if (route.includes('_')) {
          addPatternOccurrence(patterns['api.naming'], 'snake_case-routes', file, projectRoot);
        }
      }
    }

    // Response patterns
    if (content.includes('res.json') || content.includes('res.send') || content.includes('res.status')) {
      // Wrapped response envelopes
      if (content.includes('success:') || content.includes('"success"')) {
        addPatternOccurrence(patterns['api.response-format'], 'wrapped-response', file, projectRoot);
      }
      if (content.includes('data:') || content.includes('"data"')) {
        addPatternOccurrence(patterns['api.response-format'], 'data-wrapper', file, projectRoot);
      }
      if (/\bmeta\s*:/.test(content) && /\bdata\s*:/.test(content)) {
        addPatternOccurrence(patterns['api.response-format'], 'data-meta-envelope', file, projectRoot);
      }
      if (/\bresult\s*:/.test(content) && /\bstatus\s*:/.test(content)) {
        addPatternOccurrence(patterns['api.response-format'], 'result-status-envelope', file, projectRoot);
      }

      // Error response format
      if (/\berror\s*:/.test(content) && /\bmessage\s*:/.test(content)) {
        addPatternOccurrence(patterns['api.error-format'], 'error-message-object', file, projectRoot);
      }
      if (/\berrors\s*:\s*\[/.test(content)) {
        addPatternOccurrence(patterns['api.error-format'], 'errors-array', file, projectRoot);
      }
      if (/\bcode\s*:/.test(content) && /\bmessage\s*:/.test(content)) {
        addPatternOccurrence(patterns['api.error-format'], 'code-message-pair', file, projectRoot);
      }

      // Pagination patterns
      if (/\bpage\b/.test(content) && /\blimit\b/.test(content)) {
        addPatternOccurrence(patterns['api.pagination'], 'page-limit', file, projectRoot);
      }
      if (/\bcursor\b/.test(content) || /\bnextCursor\b/.test(content)) {
        addPatternOccurrence(patterns['api.pagination'], 'cursor-based', file, projectRoot);
      }
      if (/\boffset\b/.test(content) && /\blimit\b/.test(content)) {
        addPatternOccurrence(patterns['api.pagination'], 'offset-limit', file, projectRoot);
      }

      // HTTP status code patterns
      if (/res\.status\(201\)/.test(content)) {
        addPatternOccurrence(patterns['api.status-codes'], '201-on-create', file, projectRoot);
      }
      if (/res\.status\(204\)/.test(content)) {
        addPatternOccurrence(patterns['api.status-codes'], '204-no-content', file, projectRoot);
      }
      if (/res\.status\(422\)/.test(content)) {
        addPatternOccurrence(patterns['api.status-codes'], '422-validation', file, projectRoot);
      }
      if (/res\.status\(400\)/.test(content)) {
        addPatternOccurrence(patterns['api.status-codes'], '400-validation', file, projectRoot);
      }
    }

    // FastAPI patterns (Python)
    if (content.includes('@app.') || content.includes('@router.')) {
      const routeMatches = content.matchAll(/@(?:app|router)\.(get|post|put|delete|patch)\(["']([^"']*)/gi);
      for (const match of routeMatches) {
        const route = match[2];
        if (route.includes('-')) {
          addPatternOccurrence(patterns['api.naming'], 'kebab-case-routes', file, projectRoot);
        } else if (route.includes('_')) {
          addPatternOccurrence(patterns['api.naming'], 'snake_case-routes', file, projectRoot);
        }
      }
    }
  }

  return aggregatePatterns(patterns, 'api', files.length);
}

// ============================================================================
// Component Pattern Extractors
// ============================================================================

/**
 * Extract component patterns: props, hooks, state
 */
function extractComponentPatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'component.style': {},
    'component.props': {},
    'component.hooks': {},
    'component.state': {}
  };

  for (const file of files) {
    const ext = path.extname(file);
    if (!['.jsx', '.tsx'].includes(ext)) continue;

    const fullPath = path.join(projectRoot, file);
    let content;

    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // Component style: functional vs class
    if (content.includes('extends React.Component') || content.includes('extends Component')) {
      addPatternOccurrence(patterns['component.style'], 'class-component', file, projectRoot);
    }
    if (content.includes('function ') && (content.includes('return (') || content.includes('return <'))) {
      addPatternOccurrence(patterns['component.style'], 'functional-component', file, projectRoot);
    }
    if (content.includes('const ') && content.includes(' = (') && content.includes('return (')) {
      addPatternOccurrence(patterns['component.style'], 'arrow-function-component', file, projectRoot);
    }

    // Props patterns
    if (content.includes('interface') && content.includes('Props')) {
      addPatternOccurrence(patterns['component.props'], 'typescript-interface', file, projectRoot);
    }
    if (content.includes('PropTypes')) {
      addPatternOccurrence(patterns['component.props'], 'prop-types', file, projectRoot);
    }
    if (content.includes('type ') && content.includes('Props =')) {
      addPatternOccurrence(patterns['component.props'], 'typescript-type', file, projectRoot);
    }

    // Hooks patterns
    if (content.includes('useState')) {
      addPatternOccurrence(patterns['component.state'], 'useState', file, projectRoot);
    }
    if (content.includes('useReducer')) {
      addPatternOccurrence(patterns['component.state'], 'useReducer', file, projectRoot);
    }

    // Custom hooks
    const hookMatches = content.matchAll(/function\s+(use[A-Z][a-zA-Z]*)/g);
    for (const _match of hookMatches) {
      addPatternOccurrence(patterns['component.hooks'], 'custom-hooks', file, projectRoot);
    }
    const arrowHookMatches = content.matchAll(/const\s+(use[A-Z][a-zA-Z]*)\s*=/g);
    for (const _match of arrowHookMatches) {
      addPatternOccurrence(patterns['component.hooks'], 'custom-hooks', file, projectRoot);
    }
  }

  return aggregatePatterns(patterns, 'component', files.length);
}

// ============================================================================
// Architecture Pattern Extractors
// ============================================================================

/**
 * Extract architecture patterns: file org, modules, layers
 */
function extractArchitecturePatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'architecture.layers': {},
    'architecture.modules': {},
    'architecture.file-structure': {}
  };

  // Analyze directory structure
  const directories = new Set();
  for (const file of files) {
    const dir = path.dirname(file);
    directories.add(dir);

    // Check for layered architecture
    if (dir.includes('controller') || dir.includes('controllers')) {
      addPatternOccurrence(patterns['architecture.layers'], 'controller-layer', file, projectRoot);
    }
    if (dir.includes('service') || dir.includes('services')) {
      addPatternOccurrence(patterns['architecture.layers'], 'service-layer', file, projectRoot);
    }
    if (dir.includes('repository') || dir.includes('repositories')) {
      addPatternOccurrence(patterns['architecture.layers'], 'repository-layer', file, projectRoot);
    }
    if (dir.includes('model') || dir.includes('models') || dir.includes('entity') || dir.includes('entities')) {
      addPatternOccurrence(patterns['architecture.layers'], 'model-layer', file, projectRoot);
    }

    // Check for module structure
    if (dir.includes('modules/') || dir.includes('features/')) {
      addPatternOccurrence(patterns['architecture.modules'], 'feature-modules', file, projectRoot);
    }
    if (dir.includes('shared/') || dir.includes('common/')) {
      addPatternOccurrence(patterns['architecture.modules'], 'shared-modules', file, projectRoot);
    }

    // File structure patterns
    const basename = path.basename(file);
    if (basename.includes('.controller.')) {
      addPatternOccurrence(patterns['architecture.file-structure'], 'suffix-naming', file, projectRoot);
    }
    if (basename.includes('.service.')) {
      addPatternOccurrence(patterns['architecture.file-structure'], 'suffix-naming', file, projectRoot);
    }
  }

  // Check for src structure
  if (directories.has('src') || Array.from(directories).some(d => d.startsWith('src/'))) {
    patterns['architecture.file-structure']['src-root'] = {
      files: files.filter(f => f.startsWith('src/')).slice(0, 10),
      mtime: new Date()
    };
  }

  return aggregatePatterns(patterns, 'architecture', files.length);
}

// ============================================================================
// Type/Interface Pattern Extractors
// ============================================================================

/**
 * Extract type/interface patterns: naming, prefixes, enums, generics
 */
function extractTypePatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'types.interface-prefix': {},
    'types.type-naming': {},
    'types.enum-naming': {},
    'types.generic-naming': {}
  };

  for (const file of files) {
    const ext = path.extname(file);
    if (!['.ts', '.tsx'].includes(ext)) continue;

    const fullPath = path.join(projectRoot, file);
    let content;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Interface prefix: IUser vs User
    const interfaceMatches = content.matchAll(/\binterface\s+([A-Z][a-zA-Z0-9]*)/g);
    for (const match of interfaceMatches) {
      const name = match[1];
      if (/^I[A-Z]/.test(name)) {
        addPatternOccurrence(patterns['types.interface-prefix'], 'I-prefix', file, projectRoot);
      } else {
        addPatternOccurrence(patterns['types.interface-prefix'], 'no-prefix', file, projectRoot);
      }
    }

    // Type alias naming: TUser vs PascalCase
    const typeMatches = content.matchAll(/\btype\s+([A-Z][a-zA-Z0-9]*)\s*[=<]/g);
    for (const match of typeMatches) {
      const name = match[1];
      if (/^T[A-Z]/.test(name)) {
        addPatternOccurrence(patterns['types.type-naming'], 'T-prefix', file, projectRoot);
      } else {
        addPatternOccurrence(patterns['types.type-naming'], 'PascalCase', file, projectRoot);
      }
    }

    // Enum member naming: SCREAMING_SNAKE vs PascalCase
    const enumMatches = content.matchAll(/\benum\s+[A-Z][a-zA-Z0-9]*\s*\{([^}]*)\}/g);
    for (const match of enumMatches) {
      const body = match[1];
      if (/\b[A-Z][A-Z0-9_]{2,}\b/.test(body)) {
        addPatternOccurrence(patterns['types.enum-naming'], 'SCREAMING_SNAKE', file, projectRoot);
      }
      if (/\b[A-Z][a-z][a-zA-Z0-9]+\s*[=,}]/.test(body)) {
        addPatternOccurrence(patterns['types.enum-naming'], 'PascalCase', file, projectRoot);
      }
    }

    // Generic parameter naming: T vs TProps
    const genericMatches = content.matchAll(/<\s*([A-Z][a-zA-Z0-9]*)\s*(?:extends|,|>)/g);
    for (const match of genericMatches) {
      const name = match[1];
      if (/^[TKVUE]$/.test(name)) {
        addPatternOccurrence(patterns['types.generic-naming'], 'single-letter', file, projectRoot);
      } else if (/^T[A-Z]/.test(name)) {
        addPatternOccurrence(patterns['types.generic-naming'], 'T-prefix-descriptive', file, projectRoot);
      }
    }
  }

  return aggregatePatterns(patterns, 'types', files.length);
}

// ============================================================================
// Export Pattern Extractors
// ============================================================================

/**
 * Extract export patterns: default vs named, barrel files, module system
 */
function extractExportPatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'exports.style': {},
    'exports.barrel': {},
    'exports.module-system': {}
  };

  for (const file of files) {
    const ext = path.extname(file);
    if (!['.js', '.jsx', '.ts', '.tsx', '.mjs'].includes(ext)) continue;

    const fullPath = path.join(projectRoot, file);
    let content;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

    const basename = path.basename(file);

    // Export style: default vs named
    if (/\bexport\s+default\b/.test(content)) {
      addPatternOccurrence(patterns['exports.style'], 'default-export', file, projectRoot);
    }
    if (/\bexport\s+(const|function|class|type|interface|enum)\s/.test(content)) {
      addPatternOccurrence(patterns['exports.style'], 'named-exports', file, projectRoot);
    }

    // Barrel files (index.ts that re-exports)
    if (/^index\.(ts|js|tsx|jsx)$/.test(basename)) {
      const reExportCount = (content.match(/export\s+(\{[^}]+\}\s+from|[\s\S]*?\*\s+from)/g) || []).length;
      if (reExportCount > 0) {
        addPatternOccurrence(patterns['exports.barrel'], 'barrel-index', file, projectRoot);
      }
    }

    // Module system: ESM vs CJS
    if (content.includes('module.exports') || /\bexports\./.test(content)) {
      addPatternOccurrence(patterns['exports.module-system'], 'commonjs', file, projectRoot);
    }
    if (/^import\s/m.test(content) || /^export\s/m.test(content)) {
      addPatternOccurrence(patterns['exports.module-system'], 'esm', file, projectRoot);
    }
  }

  return aggregatePatterns(patterns, 'exports', files.length);
}

// ============================================================================
// Test Pattern Extractors
// ============================================================================

/**
 * Extract test patterns: file naming, organization, assertions, mocking
 */
function extractTestPatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'tests.file-naming': {},
    'tests.organization': {},
    'tests.assertion': {},
    'tests.mocking': {},
    'tests.setup': {}
  };

  const testFiles = files.filter(f =>
    f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__/')
  );

  for (const file of testFiles) {
    // File naming pattern
    if (file.includes('.test.')) {
      addPatternOccurrence(patterns['tests.file-naming'], 'dot-test', file, projectRoot);
    }
    if (file.includes('.spec.')) {
      addPatternOccurrence(patterns['tests.file-naming'], 'dot-spec', file, projectRoot);
    }
    if (file.includes('__tests__/')) {
      addPatternOccurrence(patterns['tests.file-naming'], '__tests__-dir', file, projectRoot);
    }

    const fullPath = path.join(projectRoot, file);
    let content;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Assertion style
    if (content.includes('expect(')) {
      addPatternOccurrence(patterns['tests.assertion'], 'expect', file, projectRoot);
    }
    if (content.includes('assert.') || content.includes('assert(')) {
      addPatternOccurrence(patterns['tests.assertion'], 'assert', file, projectRoot);
    }

    // Mocking patterns
    if (content.includes('jest.mock(')) {
      addPatternOccurrence(patterns['tests.mocking'], 'jest-mock', file, projectRoot);
    }
    if (content.includes('jest.spyOn(')) {
      addPatternOccurrence(patterns['tests.mocking'], 'jest-spyOn', file, projectRoot);
    }
    if (content.includes('sinon.')) {
      addPatternOccurrence(patterns['tests.mocking'], 'sinon', file, projectRoot);
    }
    if (content.includes('vi.mock(') || content.includes('vi.spyOn(')) {
      addPatternOccurrence(patterns['tests.mocking'], 'vitest', file, projectRoot);
    }

    // Setup/teardown
    if (content.includes('beforeEach(')) {
      addPatternOccurrence(patterns['tests.setup'], 'beforeEach', file, projectRoot);
    }
    if (content.includes('beforeAll(')) {
      addPatternOccurrence(patterns['tests.setup'], 'beforeAll', file, projectRoot);
    }
    if (content.includes('afterEach(')) {
      addPatternOccurrence(patterns['tests.setup'], 'afterEach', file, projectRoot);
    }

    // Describe nesting
    const describeCount = (content.match(/\bdescribe\(/g) || []).length;
    if (describeCount > 2) {
      addPatternOccurrence(patterns['tests.organization'], 'nested-describes', file, projectRoot);
    } else if (describeCount >= 1) {
      addPatternOccurrence(patterns['tests.organization'], 'flat-describes', file, projectRoot);
    }

    // Test naming style
    if (/\bit\(\s*['"]should\s/.test(content)) {
      addPatternOccurrence(patterns['tests.organization'], 'should-style', file, projectRoot);
    } else if (/\bit\(\s*['"][a-z]/.test(content)) {
      addPatternOccurrence(patterns['tests.organization'], 'descriptive-style', file, projectRoot);
    }
  }

  return aggregatePatterns(patterns, 'tests', testFiles.length || 1);
}

// ============================================================================
// Folder Convention Pattern Extractors
// ============================================================================

/**
 * Extract folder patterns: organization, co-location, index files
 */
function extractFolderPatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'folders.organization': {},
    'folders.colocation': {},
    'folders.index-files': {}
  };

  const directories = new Map();
  const testDirs = new Set();
  const sourceDirs = new Set();

  for (const file of files) {
    const dir = path.dirname(file);
    if (!directories.has(dir)) directories.set(dir, []);
    directories.get(dir).push(file);

    if (file.includes('.test.') || file.includes('.spec.') || file.includes('__tests__')) {
      testDirs.add(dir);
    } else {
      sourceDirs.add(dir);
    }
  }

  // Feature-first vs type-first organization
  let featureFirstScore = 0;
  let typeFirstScore = 0;

  for (const dir of directories.keys()) {
    const lowDir = dir.toLowerCase();
    if (/\/(components|services|utils|hooks|helpers|types|models|controllers|views)\b/.test(lowDir)) {
      typeFirstScore++;
    }
    if (/\/(features|modules)\//.test(lowDir)) {
      featureFirstScore++;
    }
  }

  if (featureFirstScore > typeFirstScore && featureFirstScore > 0) {
    const sampleFile = files[0];
    if (sampleFile) addPatternOccurrence(patterns['folders.organization'], 'feature-first', sampleFile, projectRoot);
  } else if (typeFirstScore > 0) {
    const sampleFile = files[0];
    if (sampleFile) addPatternOccurrence(patterns['folders.organization'], 'type-first', sampleFile, projectRoot);
  }

  // Co-location patterns
  for (const testDir of testDirs) {
    if (sourceDirs.has(testDir)) {
      const sampleFile = directories.get(testDir)?.[0];
      if (sampleFile) addPatternOccurrence(patterns['folders.colocation'], 'colocated', sampleFile, projectRoot);
    } else if (testDir.includes('__tests__') || testDir.includes('/test/') || testDir.includes('/tests/')) {
      const sampleFile = directories.get(testDir)?.[0];
      if (sampleFile) addPatternOccurrence(patterns['folders.colocation'], 'separate-test-dir', sampleFile, projectRoot);
    }
  }

  // Index file pattern per directory
  for (const [_dir, dirFiles] of directories.entries()) {
    const hasIndex = dirFiles.some(f => /^index\.(ts|js|tsx|jsx)$/.test(path.basename(f)));
    if (hasIndex && dirFiles.length > 1) {
      addPatternOccurrence(patterns['folders.index-files'], 'index-per-dir', dirFiles[0], projectRoot);
    }
  }

  return aggregatePatterns(patterns, 'folders', files.length);
}

// ============================================================================
// Comment/Documentation Pattern Extractors
// ============================================================================

/**
 * Extract comment patterns: doc style, inline comments, headers, TODOs
 */
function extractCommentPatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'comments.doc-style': {},
    'comments.inline-style': {},
    'comments.file-header': {},
    'comments.todo-style': {}
  };

  for (const file of files) {
    const ext = path.extname(file);
    if (!['.js', '.jsx', '.ts', '.tsx', '.py'].includes(ext)) continue;

    const fullPath = path.join(projectRoot, file);
    let content;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Doc-style comments
    if (content.includes('/**')) {
      if (content.includes('@param') || content.includes('@returns') || content.includes('@type')) {
        addPatternOccurrence(patterns['comments.doc-style'], 'jsdoc', file, projectRoot);
      } else {
        addPatternOccurrence(patterns['comments.doc-style'], 'block-comments', file, projectRoot);
      }
    }

    // Python docstrings
    if (ext === '.py' && /"""[\s\S]*?"""|'''[\s\S]*?'''/.test(content)) {
      addPatternOccurrence(patterns['comments.doc-style'], 'docstrings', file, projectRoot);
    }

    // Inline comment style
    if (/\/\/ .+$/m.test(content)) {
      addPatternOccurrence(patterns['comments.inline-style'], 'double-slash', file, projectRoot);
    }
    if (/\/\* .+? \*\//.test(content)) {
      addPatternOccurrence(patterns['comments.inline-style'], 'block-inline', file, projectRoot);
    }

    // File header pattern (first non-empty line is a comment)
    const lines = content.split('\n');
    const firstLine = lines[0] || '';
    if (firstLine.startsWith('/**') || firstLine.startsWith('// ') || firstLine.startsWith('#!')) {
      addPatternOccurrence(patterns['comments.file-header'], 'has-header', file, projectRoot);
    }

    // TODO/FIXME conventions
    if (/\bTODO[\s:(]/.test(content)) {
      addPatternOccurrence(patterns['comments.todo-style'], 'TODO', file, projectRoot);
    }
    if (/\bFIXME[\s:(]/.test(content)) {
      addPatternOccurrence(patterns['comments.todo-style'], 'FIXME', file, projectRoot);
    }
    if (/\bHACK[\s:(]/.test(content)) {
      addPatternOccurrence(patterns['comments.todo-style'], 'HACK', file, projectRoot);
    }
  }

  return aggregatePatterns(patterns, 'comments', files.length);
}

// ============================================================================
// Config/Environment Pattern Extractors
// ============================================================================

/**
 * Extract config patterns: env style, naming, validation, defaults
 */
function extractConfigPatterns(projectRoot, files, _options = {}) {
  const patterns = {
    'config.env-style': {},
    'config.env-naming': {},
    'config.validation': {},
    'config.defaults': {}
  };

  // Check for .env files
  if (fs.existsSync(path.join(projectRoot, '.env')) ||
      fs.existsSync(path.join(projectRoot, '.env.example')) ||
      fs.existsSync(path.join(projectRoot, '.env.local'))) {
    if (files[0]) addPatternOccurrence(patterns['config.env-style'], 'dotenv', files[0], projectRoot);
  }

  // Check for config directory
  if (fs.existsSync(path.join(projectRoot, 'config')) ||
      fs.existsSync(path.join(projectRoot, 'src/config'))) {
    if (files[0]) addPatternOccurrence(patterns['config.env-style'], 'config-dir', files[0], projectRoot);
  }

  for (const file of files) {
    const fullPath = path.join(projectRoot, file);
    let content;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Environment variable access
    if (/process\.env\.[A-Z_]/.test(content)) {
      addPatternOccurrence(patterns['config.env-naming'], 'SCREAMING_SNAKE', file, projectRoot);
    }
    if (/os\.environ/.test(content)) {
      addPatternOccurrence(patterns['config.env-naming'], 'SCREAMING_SNAKE', file, projectRoot);
    }

    // Config validation library
    if (/\bJoi\b|\bjoi\./.test(content)) {
      addPatternOccurrence(patterns['config.validation'], 'joi', file, projectRoot);
    }
    if (/\bz\.(object|string|number|boolean|array)\b/.test(content)) {
      addPatternOccurrence(patterns['config.validation'], 'zod', file, projectRoot);
    }
    if (content.includes('class-validator') || /@Is(String|Number|Boolean|Email)\b/.test(content)) {
      addPatternOccurrence(patterns['config.validation'], 'class-validator', file, projectRoot);
    }

    // Default value patterns
    if (/process\.env\.\w+\s*\|\|\s*/.test(content)) {
      addPatternOccurrence(patterns['config.defaults'], 'or-fallback', file, projectRoot);
    }
    if (/process\.env\.\w+\s*\?\?\s*/.test(content)) {
      addPatternOccurrence(patterns['config.defaults'], 'nullish-coalescing', file, projectRoot);
    }
  }

  return aggregatePatterns(patterns, 'config', files.length);
}

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * Detect conflicting patterns
 */
function detectConflicts(patterns) {
  const conflicts = [];

  // Group patterns by subcategory
  const bySubcategory = {};
  for (const pattern of patterns) {
    const key = pattern.subcategory;
    if (!bySubcategory[key]) {
      bySubcategory[key] = [];
    }
    bySubcategory[key].push(pattern);
  }

  // Check each subcategory for conflicts
  for (const [subcategory, subcatPatterns] of Object.entries(bySubcategory)) {
    if (subcatPatterns.length < 2) continue;

    // Sort by frequency descending
    subcatPatterns.sort((a, b) => b.frequency - a.frequency);

    // Check for significant alternatives
    const total = subcatPatterns.reduce((sum, p) => sum + p.frequency, 0);

    for (let i = 0; i < subcatPatterns.length - 1; i++) {
      for (let j = i + 1; j < subcatPatterns.length; j++) {
        const ratioA = subcatPatterns[i].frequency / total;
        const ratioB = subcatPatterns[j].frequency / total;

        // Both patterns must have significant usage to be a conflict
        if (ratioA >= CONFLICT_THRESHOLD && ratioB >= CONFLICT_THRESHOLD) {
          const conflict = createConflict(subcatPatterns[i], subcatPatterns[j], {
            description: `Conflicting ${subcategory.replace('.', ' ')}: ${subcatPatterns[i].name} vs ${subcatPatterns[j].name}`
          });

          // Add recommendation
          const rec = scoreRecommendation(subcatPatterns[i], subcatPatterns[j]);
          conflict.recommendation = rec.recommendation;
          conflict.recommendationReason = rec.reason;

          conflicts.push(conflict);
        }
      }
    }
  }

  return conflicts;
}

/**
 * Score patterns to determine recommendation
 */
function scoreRecommendation(patternA, patternB) {
  const scoreA = {
    frequency: patternA.frequency,
    recency: patternA.lastSeen ? patternA.lastSeen.getTime() : 0,
    total: 0
  };

  const scoreB = {
    frequency: patternB.frequency,
    recency: patternB.lastSeen ? patternB.lastSeen.getTime() : 0,
    total: 0
  };

  // Normalize scores
  const totalFreq = scoreA.frequency + scoreB.frequency;
  scoreA.frequencyNorm = scoreA.frequency / totalFreq;
  scoreB.frequencyNorm = scoreB.frequency / totalFreq;

  const maxRecency = Math.max(scoreA.recency, scoreB.recency);
  scoreA.recencyNorm = maxRecency > 0 ? scoreA.recency / maxRecency : 0.5;
  scoreB.recencyNorm = maxRecency > 0 ? scoreB.recency / maxRecency : 0.5;

  // Calculate weighted scores
  scoreA.total = scoreA.frequencyNorm * SCORING_WEIGHTS.frequency +
                 scoreA.recencyNorm * SCORING_WEIGHTS.recency;
  scoreB.total = scoreB.frequencyNorm * SCORING_WEIGHTS.frequency +
                 scoreB.recencyNorm * SCORING_WEIGHTS.recency;

  const reasons = [];

  if (scoreA.total >= scoreB.total) {
    if (scoreA.frequencyNorm > scoreB.frequencyNorm) {
      reasons.push(`More frequent (${Math.round(scoreA.frequencyNorm * 100)}% vs ${Math.round(scoreB.frequencyNorm * 100)}%)`);
    }
    if (scoreA.recencyNorm > scoreB.recencyNorm) {
      reasons.push('More recent usage');
    }
    return {
      recommendation: 'A',
      scoreA: Math.round(scoreA.total * 100),
      scoreB: Math.round(scoreB.total * 100),
      reason: reasons.join(', ') || 'Higher overall score'
    };
  } else {
    if (scoreB.frequencyNorm > scoreA.frequencyNorm) {
      reasons.push(`More frequent (${Math.round(scoreB.frequencyNorm * 100)}% vs ${Math.round(scoreA.frequencyNorm * 100)}%)`);
    }
    if (scoreB.recencyNorm > scoreA.recencyNorm) {
      reasons.push('More recent usage');
    }
    return {
      recommendation: 'B',
      scoreA: Math.round(scoreA.total * 100),
      scoreB: Math.round(scoreB.total * 100),
      reason: reasons.join(', ') || 'Higher overall score'
    };
  }
}

/**
 * Generate recommendations from patterns
 */
function generateRecommendations(patterns, _conflicts) {
  const recommendations = [];

  // Group by subcategory
  const bySubcategory = {};
  for (const pattern of patterns) {
    const key = pattern.subcategory;
    if (!bySubcategory[key]) {
      bySubcategory[key] = [];
    }
    bySubcategory[key].push(pattern);
  }

  // Generate recommendation for each subcategory
  for (const [subcategory, subcatPatterns] of Object.entries(bySubcategory)) {
    // Sort by frequency
    subcatPatterns.sort((a, b) => b.frequency - a.frequency);

    // Top pattern is recommended
    const top = subcatPatterns[0];
    const total = subcatPatterns.reduce((sum, p) => sum + p.frequency, 0);
    const percentage = Math.round((top.frequency / total) * 100);

    recommendations.push({
      subcategory,
      pattern: top,
      score: percentage,
      reasoning: `Used in ${percentage}% of relevant files (${top.frequency} occurrences)`,
      alternatives: subcatPatterns.slice(1).map(p => ({
        name: p.name,
        frequency: p.frequency,
        percentage: Math.round((p.frequency / total) * 100)
      }))
    });
  }

  return recommendations;
}

// ============================================================================
// Output Formatters
// ============================================================================

/**
 * Format extraction result as JSON
 */
function formatAsJson(result) {
  return JSON.stringify(result, null, 2);
}

/**
 * Format extraction result as markdown (decisions.md compatible)
 */
function formatAsDecisions(result) {
  let md = `# Extracted Patterns\n\n`;
  md += `Generated: ${new Date().toISOString().split('T')[0]}\n`;
  md += `Framework: ${result.meta.framework}\n`;
  md += `Files scanned: ${result.meta.filesScanned}\n\n`;

  // Group recommendations by category
  const byCategory = {};
  for (const rec of result.recommendations) {
    const cat = rec.pattern.category;
    if (!byCategory[cat]) {
      byCategory[cat] = [];
    }
    byCategory[cat].push(rec);
  }

  for (const [category, recs] of Object.entries(byCategory)) {
    md += `## ${capitalize(category)} Patterns\n\n`;

    for (const rec of recs) {
      md += `### ${formatSubcategory(rec.subcategory)}\n\n`;
      md += `**Recommended**: ${rec.pattern.name}\n`;
      md += `**Usage**: ${rec.score}% (${rec.pattern.frequency} files)\n`;
      md += `**Description**: ${rec.pattern.description}\n\n`;

      if (rec.alternatives.length > 0) {
        md += `*Alternatives found*:\n`;
        for (const alt of rec.alternatives) {
          md += `- ${alt.name}: ${alt.percentage}% (${alt.frequency} files)\n`;
        }
        md += '\n';
      }
    }
  }

  // Add conflicts section if any
  if (result.conflicts.length > 0) {
    md += `## Conflicts Detected\n\n`;
    md += `The following patterns have significant usage of multiple approaches:\n\n`;

    for (const conflict of result.conflicts) {
      md += `### ${conflict.description}\n\n`;
      md += `- **Option A**: ${conflict.patternA.pattern.name} (${conflict.patternA.occurrences} files)\n`;
      md += `- **Option B**: ${conflict.patternB.pattern.name} (${conflict.patternB.occurrences} files)\n`;
      md += `- **Recommendation**: ${conflict.recommendation} - ${conflict.recommendationReason}\n\n`;
    }
  }

  return md;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatSubcategory(subcategory) {
  return subcategory
    .split('.')
    .map(part => part.split('-').map(capitalize).join(' '))
    .join(' - ');
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Main pattern extraction entry point
 */
async function extractPatterns(projectRoot, options = {}) {
  const {
    categories = ['code', 'api', 'component', 'architecture', 'types', 'exports', 'tests', 'folders', 'comments', 'config'],
    includeConflicts = true,
    includeRecommendations = true,
    maxFiles = DEFAULT_MAX_FILES,
    framework: frameworkOption = 'auto',
    analysisMode = DEFAULT_ANALYSIS_MODE
  } = options;

  // Set module-level analysis mode for addPatternOccurrence to use
  _currentAnalysisMode = analysisMode;
  _gitFileDateCache.clear();

  const startTime = Date.now();

  // Detect framework
  const framework = frameworkOption === 'auto'
    ? detectFramework(projectRoot)
    : frameworkOption;

  // Determine base file patterns based on framework/language
  let filePatterns = [...FILE_PATTERNS.javascript, ...FILE_PATTERNS.typescript];
  if (['python', 'fastapi', 'django', 'flask'].includes(framework)) {
    filePatterns = FILE_PATTERNS.python;
  } else if (framework === 'go') {
    filePatterns = FILE_PATTERNS.go;
  } else if (framework === 'rust') {
    filePatterns = FILE_PATTERNS.rust;
  }

  // Resolve additional framework-specific patterns from detectStack()
  let frameworkResolved = { patterns: [], matched: [] };
  try {
    const { detectStack } = require('./flow-context-init');
    const stack = detectStack(projectRoot);
    frameworkResolved = resolvePatterns(stack);
    if (frameworkResolved.patterns.length > 0) {
      // Merge framework patterns with base patterns (additive only)
      filePatterns = [...new Set([...filePatterns, ...frameworkResolved.patterns])];
    }
  } catch (err) {
    // Fallback: if detectStack or resolver fails, continue with base patterns only
    // This ensures backwards compatibility
  }

  // Get files to scan
  let files = globFiles(projectRoot, filePatterns);

  // Limit files if needed
  if (files.length > maxFiles) {
    console.error(`${c.yellow}Warning: Limiting scan to ${maxFiles} files (found ${files.length})${c.reset}`);
    files = files.slice(0, maxFiles);
  }

  // Extract patterns by category
  const allPatterns = [];

  if (categories.includes('code')) {
    const codePatterns = extractCodePatterns(projectRoot, files, { framework });
    allPatterns.push(...codePatterns);
  }

  if (categories.includes('api')) {
    const apiPatterns = extractApiPatterns(projectRoot, files, { framework });
    allPatterns.push(...apiPatterns);
  }

  if (categories.includes('component')) {
    const componentPatterns = extractComponentPatterns(projectRoot, files, { framework });
    allPatterns.push(...componentPatterns);
  }

  if (categories.includes('architecture')) {
    const archPatterns = extractArchitecturePatterns(projectRoot, files, { framework });
    allPatterns.push(...archPatterns);
  }

  if (categories.includes('types')) {
    const typePatterns = extractTypePatterns(projectRoot, files, { framework });
    allPatterns.push(...typePatterns);
  }

  if (categories.includes('exports')) {
    const exportPatterns = extractExportPatterns(projectRoot, files, { framework });
    allPatterns.push(...exportPatterns);
  }

  if (categories.includes('tests')) {
    const testPatterns = extractTestPatterns(projectRoot, files, { framework });
    allPatterns.push(...testPatterns);
  }

  if (categories.includes('folders')) {
    const folderPatterns = extractFolderPatterns(projectRoot, files, { framework });
    allPatterns.push(...folderPatterns);
  }

  if (categories.includes('comments')) {
    const commentPatterns = extractCommentPatterns(projectRoot, files, { framework });
    allPatterns.push(...commentPatterns);
  }

  if (categories.includes('config')) {
    const configPatterns = extractConfigPatterns(projectRoot, files, { framework });
    allPatterns.push(...configPatterns);
  }

  // Detect conflicts
  const conflicts = includeConflicts ? detectConflicts(allPatterns) : [];

  // Generate recommendations
  const recommendations = includeRecommendations
    ? generateRecommendations(allPatterns, conflicts)
    : [];

  const elapsed = Date.now() - startTime;

  return {
    meta: {
      extractedAt: new Date().toISOString(),
      projectRoot,
      framework,
      frameworksResolved: frameworkResolved.matched,
      filesScanned: files.length,
      scanDurationMs: elapsed,
      analysisMode
    },
    patterns: {
      code: allPatterns.filter(p => p.category === 'code'),
      api: allPatterns.filter(p => p.category === 'api'),
      component: allPatterns.filter(p => p.category === 'component'),
      architecture: allPatterns.filter(p => p.category === 'architecture'),
      types: allPatterns.filter(p => p.category === 'types'),
      exports: allPatterns.filter(p => p.category === 'exports'),
      tests: allPatterns.filter(p => p.category === 'tests'),
      folders: allPatterns.filter(p => p.category === 'folders'),
      comments: allPatterns.filter(p => p.category === 'comments'),
      config: allPatterns.filter(p => p.category === 'config')
    },
    conflicts,
    recommendations
  };
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(args) {
  const options = {
    output: null,
    format: 'json',
    categories: ['code', 'api', 'component', 'architecture', 'types', 'exports', 'tests', 'folders', 'comments', 'config'],
    framework: 'auto',
    withConflicts: true,
    resolveConflicts: false,
    analysisMode: 'balanced',
    maxFiles: DEFAULT_MAX_FILES,
    json: false,
    help: false,
    project: null  // Project folder to scan (default: current)
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--format':
      case '-f':
        options.format = args[++i];
        break;
      case '--categories':
        options.categories = args[++i].split(',');
        break;
      case '--framework':
        options.framework = args[++i];
        break;
      case '--with-conflicts':
        options.withConflicts = true;
        break;
      case '--no-conflicts':
        options.withConflicts = false;
        break;
      case '--resolve-conflicts':
        options.resolveConflicts = true;
        break;
      case '--analysis-mode':
        options.analysisMode = args[++i];
        break;
      case '--max-files':
        options.maxFiles = parseInt(args[++i], 10);
        break;
      case '--json':
        options.json = true;
        options.format = 'json';
        break;
      case '--project':
      case '-p':
        options.project = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
${c.bold}Wogi Flow - Pattern Extraction Engine${c.reset}

${c.cyan}Usage:${c.reset}
  flow pattern-extract [options]
  node scripts/flow-pattern-extractor.js [options]

${c.cyan}Options:${c.reset}
  --output, -o <file>      Output file (default: stdout)
  --format, -f <format>    Output format: json, markdown, decisions (default: json)
  --project, -p <folder>   Project folder to scan (default: current directory)
  --categories <cats>      Categories: code,api,component,architecture (default: all)
  --framework <name>       Framework: auto, react, nestjs, python (default: auto)
  --with-conflicts         Include conflict analysis (default)
  --no-conflicts           Skip conflict analysis
  --resolve-conflicts      Interactive conflict resolution
  --analysis-mode <mode>   Git analysis: balanced (default), deep
  --max-files <n>          Max files to scan (default: 1000)
  --json                   JSON output for scripting
  --help, -h               Show this help

${c.cyan}Examples:${c.reset}
  flow pattern-extract                           # Basic extraction
  flow pattern-extract --project /path/to/other  # Scan different project
  flow pattern-extract --format decisions        # Output as decisions.md format
  flow pattern-extract --framework react         # Force React framework detection
  flow pattern-extract --no-conflicts --json     # JSON without conflicts
`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Use specified project folder or default to current directory
  const projectRoot = options.project
    ? path.resolve(options.project)
    : getProjectRoot();

  if (options.project && (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory())) {
    console.error(`Error: Project path does not exist or is not a directory: ${projectRoot}`);
    process.exit(1);
  }

  console.error(`${c.cyan}Scanning project...${c.reset}`);
  console.error(`  Root: ${projectRoot}`);

  try {
    const result = await extractPatterns(projectRoot, {
      categories: options.categories,
      includeConflicts: options.withConflicts,
      includeRecommendations: true,
      maxFiles: options.maxFiles,
      framework: options.framework,
      analysisMode: options.analysisMode
    });

    console.error(`  Framework: ${result.meta.framework}`);
    console.error(`  Files: ${result.meta.filesScanned}`);
    console.error(`  Patterns: ${Object.values(result.patterns).flat().length}`);
    console.error(`  Conflicts: ${result.conflicts.length}`);
    console.error(`  Duration: ${result.meta.scanDurationMs}ms`);
    console.error('');

    // Format output
    let output;
    if (options.format === 'json' || options.json) {
      output = formatAsJson(result);
    } else if (options.format === 'markdown' || options.format === 'decisions') {
      output = formatAsDecisions(result);
    } else {
      output = formatAsJson(result);
    }

    // Write output
    if (options.output) {
      fs.writeFileSync(options.output, output);
      console.error(`${c.green}✓ Output written to ${options.output}${c.reset}`);
    } else {
      console.log(output);
    }

    // Handle interactive conflict resolution
    if (options.resolveConflicts && result.conflicts.length > 0) {
      console.error(`\n${c.yellow}Conflict resolution requested but not yet implemented.${c.reset}`);
      console.error(`Run: node scripts/flow-conflict-resolver.js --input <patterns.json>`);
    }

  } catch (err) {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = {
  extractPatterns,
  detectFramework,
  detectConflicts,
  generateRecommendations,
  formatAsJson,
  formatAsDecisions,
  // Individual extractors
  extractCodePatterns,
  extractApiPatterns,
  extractComponentPatterns,
  extractArchitecturePatterns,
  extractTypePatterns,
  extractExportPatterns,
  extractTestPatterns,
  extractFolderPatterns,
  extractCommentPatterns,
  extractConfigPatterns,
  // Utilities
  globFiles,
  createPattern,
  createConflict
};
