#!/usr/bin/env node

/**
 * Wogi Flow - AST-Grep Integration
 *
 * Structural pattern search via the `sg` CLI (ast-grep). Extracted from
 * flow-utils.js (wf-94cc3b72 epic — flow-utils decomposition) to keep the
 * barrel thin. Re-exported from flow-utils.js for backwards compatibility.
 */

'use strict';

const path = require('node:path');
const { execSync, execFileSync } = require('node:child_process');
const { PROJECT_ROOT } = require('./flow-paths');
const { dirExists } = require('./flow-io');

/**
 * Common AST patterns for code discovery
 */
const AST_PATTERNS = {
  // React patterns
  reactComponent: 'function $NAME($PROPS) { return <$_>$$$</$_> }',
  reactArrowComponent: 'const $NAME = ($PROPS) => { return <$_>$$$</$_> }',
  useStateHook: 'const [$STATE, $SETTER] = useState($INIT)',
  useEffectHook: 'useEffect($FN, [$$$DEPS])',
  useCustomHook: 'const $RESULT = use$NAME($$$ARGS)',

  // TypeScript patterns
  interfaceDefinition: 'interface $NAME { $$$ }',
  typeDefinition: 'type $NAME = $$$',
  exportedFunction: 'export function $NAME($$$PARAMS) { $$$ }',
  exportedConst: 'export const $NAME = $$$',

  // Import patterns
  namedImport: 'import { $$$IMPORTS } from "$PATH"',
  defaultImport: 'import $NAME from "$PATH"',

  // Class patterns
  classDefinition: 'class $NAME { $$$ }',
  classExtends: 'class $NAME extends $BASE { $$$ }'
};

/**
 * Check if ast-grep CLI (sg) is available
 */
function isAstGrepAvailable() {
  try {
    execSync('which sg', { stdio: 'ignore' });
    return true;
  } catch (_err) {
    return false;
  }
}

// Allowed languages for ast-grep to prevent command injection (Security Rule 8)
const ALLOWED_AST_GREP_LANGUAGES = new Set([
  'typescript', 'javascript', 'tsx', 'jsx', 'python', 'go', 'rust',
  'java', 'c', 'cpp', 'csharp', 'ruby', 'swift', 'kotlin', 'html', 'css'
]);

/**
 * Search codebase using ast-grep for structural patterns
 * @param {string} pattern - AST pattern (e.g., "useState($INIT)")
 * @param {object} options - { lang, cwd, maxResults }
 * @returns {Array|null} Array of matches or null if ast-grep unavailable
 */
function astGrepSearch(pattern, options = {}) {
  const {
    lang = 'typescript',
    cwd = PROJECT_ROOT,
    maxResults = 20,
    searchDir = 'src'
  } = options;

  // Validate lang parameter to prevent command injection (Security Rule 8)
  if (!ALLOWED_AST_GREP_LANGUAGES.has(lang)) {
    if (process.env.DEBUG) {
      console.error(`[ast-grep] Invalid language: ${lang}. Allowed: ${[...ALLOWED_AST_GREP_LANGUAGES].join(', ')}`);
    }
    return null;
  }

  // Check if ast-grep is available
  if (!isAstGrepAvailable()) {
    return null;
  }

  const searchPath = path.join(cwd, searchDir);
  if (!dirExists(searchPath)) {
    return [];
  }

  try {
    // Use execFileSync with array args to prevent shell injection (Security Rule 8)
    const result = execFileSync('sg', [
      '--pattern', pattern,
      '--lang', lang,
      '--json', searchPath
    ], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000
    });

    const matches = JSON.parse(result || '[]');
    return matches.slice(0, maxResults).map(m => ({
      file: path.relative(cwd, m.file || m.path),
      line: m.range?.start?.line ?? m.startLine ?? 0,
      endLine: m.range?.end?.line ?? m.endLine ?? 0,
      content: m.text || m.match,
      meta: m.metaVariables || {}  // Captured $VARS
    }));
  } catch (err) {
    // Parse error, timeout, or no matches
    if (err.stdout) {
      try {
        const matches = JSON.parse(err.stdout);
        return matches.slice(0, maxResults).map(m => ({
          file: path.relative(cwd, m.file || m.path),
          line: m.range?.start?.line ?? 0,
          content: m.text || m.match,
          meta: m.metaVariables || {}
        }));
      } catch (_err) {
        // Ignore parse errors
      }
    }
    return [];
  }
}

/**
 * Search for React components in the codebase
 * @param {object} options - Search options
 */
function findReactComponents(options = {}) {
  const { maxResults = 10 } = options;

  // Try function components first
  let results = astGrepSearch(AST_PATTERNS.reactComponent, { ...options, maxResults });

  // If ast-grep not available, return null
  if (results === null) return null;

  // Also search arrow function components
  const arrowResults = astGrepSearch(AST_PATTERNS.reactArrowComponent, { ...options, maxResults });
  if (arrowResults) {
    results = [...results, ...arrowResults];
  }

  // Dedupe by file
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.file)) return false;
    seen.add(r.file);
    return true;
  }).slice(0, maxResults);
}

/**
 * Search for custom hooks in the codebase
 * @param {object} options - Search options
 */
function findCustomHooks(options = {}) {
  const { maxResults = 10 } = options;

  // Search for function use* pattern
  const results = astGrepSearch('function use$NAME($$$) { $$$ }', { ...options, maxResults });

  if (results === null) return null;

  return results.filter(r => {
    // Filter to only actual hook files
    const fileName = path.basename(r.file).toLowerCase();
    return fileName.startsWith('use') || fileName.includes('hook');
  });
}

/**
 * Search for TypeScript interfaces/types
 * @param {string} namePattern - Optional name pattern to filter by
 * @param {object} options - Search options
 */
function findTypeDefinitions(namePattern = null, options = {}) {
  const { maxResults = 10 } = options;

  // Search interfaces
  let results = astGrepSearch(AST_PATTERNS.interfaceDefinition, { ...options, maxResults });

  if (results === null) return null;

  // Also search type aliases
  const typeResults = astGrepSearch(AST_PATTERNS.typeDefinition, { ...options, maxResults });
  if (typeResults) {
    results = [...results, ...typeResults];
  }

  // Filter by name pattern if provided
  if (namePattern) {
    const regex = new RegExp(namePattern, 'i');
    results = results.filter(r => regex.test(r.content));
  }

  return results.slice(0, maxResults);
}

module.exports = {
  AST_PATTERNS,
  ALLOWED_AST_GREP_LANGUAGES,
  isAstGrepAvailable,
  astGrepSearch,
  findReactComponents,
  findCustomHooks,
  findTypeDefinitions,
};
