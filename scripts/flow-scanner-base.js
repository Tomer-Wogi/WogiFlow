#!/usr/bin/env node

/**
 * Wogi Flow - Base Scanner Class
 *
 * Provides common functionality for code scanners (functions, APIs).
 * Handles:
 * - Babel/regex parsing
 * - Directory scanning
 * - File exclusion
 * - JSDoc extraction
 * - Type annotation conversion
 */

const fs = require('node:fs');
const path = require('node:path');
const { getConfig, PATHS } = require('./flow-utils');

// ============================================================
// Base Scanner Class
// ============================================================

class BaseScanner {
  /**
   * @param {Object} options - Configuration options
   * @param {string[]} options.directories - Directories to scan
   * @param {string[]} options.filePatterns - File patterns to include
   * @param {string[]} options.excludePatterns - Patterns to exclude
   * @param {string} options.configKey - Config key for registry settings (e.g., 'functionRegistry')
   */
  constructor(options = {}) {
    const globalConfig = getConfig();
    const registryConfig = globalConfig[options.configKey] || {};

    this.config = {
      directories: registryConfig.directories || options.directories || [],
      globPatterns: registryConfig.globPatterns || options.globPatterns || [],
      filePatterns: options.filePatterns || ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'],
      excludePatterns: options.excludePatterns || [
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.stories.*',
        '**/node_modules/**',
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/dist/**',
        '**/build/**'
      ]
    };

    // Pre-compile exclude patterns to avoid per-file RegExp allocation
    // Use placeholder to prevent ** and * from interfering during replacement
    this._excludeRegexps = this.config.excludePatterns.map(pattern => {
      const regexPattern = pattern
        .replace(/\*\*/g, '\0GLOBSTAR\0')   // Placeholder for **
        .replace(/\./g, '\\.')              // Escape dots
        .replace(/\*/g, '[^/]*')            // Single * → non-slash wildcard
        .replace(/\0GLOBSTAR\0/g, '.*');    // Restore ** → any path
      return new RegExp('^' + regexPattern + '$');
    });

    // Try to load babel for better parsing
    this.parser = null;
    this.traverse = null;
    try {
      this.parser = require('@babel/parser');
      this.traverse = require('@babel/traverse').default;
    } catch (_err) {
      // Babel not available, will use regex parsing
    }
  }

  /**
   * Find existing directories from config (explicit + glob-discovered)
   * @returns {string[]} Array of full paths to existing directories
   */
  findDirectories() {
    const found = new Set();

    // 1. Explicit directories from config
    for (const dir of this.config.directories) {
      const fullPath = path.join(PATHS.root, dir);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        found.add(fullPath);
      }
    }

    // 2. Glob-discovered directories (e.g. "src/**/hooks", "src/**/utils")
    for (const pattern of this.config.globPatterns) {
      for (const dir of this._expandGlobPattern(pattern)) {
        found.add(dir);
      }
    }

    return [...found];
  }

  /**
   * Expand a glob pattern like "src/** /hooks" into matching directories.
   * Supports ** (any depth) and * (single segment). No external dependencies.
   * @param {string} pattern - Glob pattern relative to project root
   * @returns {string[]} Array of full paths to matching directories
   */
  _expandGlobPattern(pattern) {
    const results = [];
    const segments = pattern.split('/');
    const MAX_DEPTH = 20;
    const MAX_DIRS = 5000;
    let dirsVisited = 0;
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.yarn', '.pnpm']);

    const walk = (currentPath, segIdx, depth) => {
      if (depth > MAX_DEPTH || dirsVisited > MAX_DIRS) return;
      dirsVisited++;

      if (segIdx >= segments.length) {
        if (fs.existsSync(currentPath) && fs.statSync(currentPath).isDirectory()) {
          results.push(currentPath);
        }
        return;
      }

      const seg = segments[segIdx];

      if (seg === '**') {
        // Zero levels: skip this segment
        walk(currentPath, segIdx + 1, depth);

        // One+ levels: recurse into subdirectories
        if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) return;
        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
            walk(path.join(currentPath, entry.name), segIdx, depth + 1);
          }
        } catch (_err) {
          // Permission error — skip
        }
      } else if (seg.includes('*')) {
        if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) return;
        // Escape regex metacharacters except *, then convert * to [^/]*
        const escaped = seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
        const segRegex = new RegExp('^' + escaped + '$');
        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (segRegex.test(entry.name)) {
              walk(path.join(currentPath, entry.name), segIdx + 1, depth + 1);
            }
          }
        } catch (_err) {
          // Permission error — skip
        }
      } else {
        walk(path.join(currentPath, seg), segIdx + 1, depth + 1);
      }
    };

    walk(PATHS.root, 0, 0);
    return results;
  }

  /**
   * Check if file should be excluded
   * @param {string} filePath - Full path to file
   * @returns {boolean} True if file should be excluded
   */
  shouldExclude(filePath) {
    const relativePath = path.relative(PATHS.root, filePath);

    for (const regex of this._excludeRegexps) {
      if (regex.test(relativePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if file is a source file
   * @param {string} filename - File name
   * @returns {boolean} True if source file
   */
  isSourceFile(filename) {
    return /\.(ts|js|tsx|jsx)$/.test(filename) && !filename.endsWith('.d.ts');
  }

  /**
   * Scan directory recursively
   * @param {string} dir - Directory to scan
   * @param {Function} scanFile - Function to call for each file
   */
  async scanDirectoryRecursive(dir, scanFile) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.scanDirectoryRecursive(fullPath, scanFile);
      } else if (entry.isFile() && this.isSourceFile(entry.name)) {
        if (!this.shouldExclude(fullPath)) {
          await scanFile(fullPath);
        }
      }
    }
  }

  /**
   * Get category/service name from file path
   * @param {string} relativePath - Relative path to file
   * @returns {string} Category name
   */
  getCategoryFromPath(relativePath) {
    const parts = relativePath.split(path.sep);
    // Use parent folder or filename without extension
    if (parts.length > 1) {
      return parts[parts.length - 2];
    }
    return path.basename(relativePath, path.extname(relativePath));
  }

  /**
   * Extract JSDoc comment before a node position
   * @param {string} content - File content
   * @param {number} nodeStart - Start position of node
   * @returns {Object} { description: string }
   */
  extractJSDoc(content, nodeStart) {
    // Look for JSDoc comment before the node
    const beforeNode = content.substring(0, nodeStart);
    const jsdocMatch = beforeNode.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/);

    if (!jsdocMatch) return { description: '' };

    const jsdocContent = jsdocMatch[1];
    const lines = jsdocContent.split('\n').map(line =>
      line.replace(/^\s*\*\s?/, '').trim()
    );

    // First non-empty line before @tags is the description
    let description = '';
    for (const line of lines) {
      if (line.startsWith('@')) break;
      if (line) description += (description ? ' ' : '') + line;
    }

    return { description };
  }

  /**
   * Extract JSDoc before a position (alternative method)
   * @param {string} content - File content
   * @param {number} position - Position in content
   * @returns {string} Description text
   */
  extractJSDocBefore(content, position) {
    const before = content.substring(0, position);
    const match = before.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/);

    if (!match) return '';

    const lines = match[1].split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .filter(line => !line.startsWith('@') && line);

    return lines.join(' ');
  }

  /**
   * Get line number for a position
   * @param {string} content - File content
   * @param {number} position - Position in content
   * @returns {number} Line number
   */
  getLineNumber(content, position) {
    return content.substring(0, position).split('\n').length;
  }

  /**
   * Convert TypeScript type annotation to string
   * @param {Object} annotation - AST type annotation node
   * @returns {string} Type as string
   */
  typeAnnotationToString(annotation) {
    if (!annotation) return 'any';

    switch (annotation.type) {
      case 'TSStringKeyword': return 'string';
      case 'TSNumberKeyword': return 'number';
      case 'TSBooleanKeyword': return 'boolean';
      case 'TSVoidKeyword': return 'void';
      case 'TSAnyKeyword': return 'any';
      case 'TSNullKeyword': return 'null';
      case 'TSUndefinedKeyword': return 'undefined';
      case 'TSNeverKeyword': return 'never';
      case 'TSUnknownKeyword': return 'unknown';
      case 'TSArrayType':
        return `${this.typeAnnotationToString(annotation.elementType)}[]`;
      case 'TSTypeReference':
        return annotation.typeName.name || 'unknown';
      case 'TSUnionType':
        return annotation.types.map(t => this.typeAnnotationToString(t)).join(' | ');
      case 'TSLiteralType':
        return JSON.stringify(annotation.literal.value);
      case 'TSTypeLiteral':
        return 'object';
      default:
        return 'any';
    }
  }

  /**
   * Extract parameters from AST params array
   * @param {Array} params - AST params array
   * @returns {Array} Array of { name, type }
   */
  extractParams(params) {
    return params.map(param => {
      let name = 'unknown';
      let type = 'any';

      if (param.type === 'Identifier') {
        name = param.name;
        if (param.typeAnnotation?.typeAnnotation) {
          type = this.typeAnnotationToString(param.typeAnnotation.typeAnnotation);
        }
      } else if (param.type === 'AssignmentPattern') {
        name = param.left.name;
        type = param.left.typeAnnotation?.typeAnnotation
          ? this.typeAnnotationToString(param.left.typeAnnotation.typeAnnotation)
          : 'any';
      } else if (param.type === 'RestElement') {
        name = `...${param.argument.name}`;
        type = 'any[]';
      } else if (param.type === 'ObjectPattern') {
        name = '{...}';
        type = 'object';
      }

      return { name, type };
    });
  }

  /**
   * Two-pass AST: collect all top-level declarations and all exported names.
   * Returns { declarations: Map<name, {node, kind}>, exported: Map<name, {isDefault}> }
   * Subclasses call this then intersect with their own registration logic.
   * @param {string} content - File content
   * @returns {Object|null} { declarations, exported } or null if parse fails
   */
  collectExportedDeclarations(content) {
    if (!this.parser) return null;

    try {
      const ast = this.parser.parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy']
      });

      // Pass 1: Collect all top-level function-like declarations
      const declarations = new Map();

      this.traverse(ast, {
        FunctionDeclaration: (nodePath) => {
          const parent = nodePath.parent.type;
          if (!nodePath.node.id) return;
          if (parent === 'Program' || parent === 'ExportNamedDeclaration' || parent === 'ExportDefaultDeclaration') {
            declarations.set(nodePath.node.id.name, { node: nodePath.node, kind: 'func' });
          }
        },
        VariableDeclaration: (nodePath) => {
          const parent = nodePath.parent.type;
          if (parent !== 'Program' && parent !== 'ExportNamedDeclaration') return;
          for (const decl of nodePath.node.declarations) {
            if (decl.id?.name && decl.init &&
                (decl.init.type === 'ArrowFunctionExpression' ||
                 decl.init.type === 'FunctionExpression')) {
              declarations.set(decl.id.name, { node: decl, kind: 'var' });
            }
          }
        }
      });

      // Pass 2: Collect all exported names (handles BOTH ESM `export` and
      // CommonJS `module.exports`/`exports` patterns).
      // arch-005 fix (2026-04-26): the original Babel scanner only handled
      // ESM. wogi-flow's source is CommonJS, so all exports were invisible
      // and function-map.md was empty after every scan.
      const exported = new Map();

      // CJS helper: handle `module.exports = { ... }` and
      // `module.exports.x = ...` and `exports.x = ...`.
      const handleCjsExportAssignment = (assignNode) => {
        const left = assignNode.left;
        const right = assignNode.right;
        if (!left || !right) return;

        // Pattern: module.exports = { foo, bar, baz }
        // or:      exports        = { foo, bar, baz }  (rare)
        const isModuleExports =
          left.type === 'MemberExpression' &&
          left.object?.name === 'module' &&
          left.property?.name === 'exports' &&
          !left.computed;
        const isBareExports =
          left.type === 'Identifier' && left.name === 'exports';

        if ((isModuleExports || isBareExports) && right.type === 'ObjectExpression') {
          for (const prop of right.properties) {
            if (prop.type === 'ObjectProperty' || prop.type === 'Property') {
              // Shorthand: { foo }  → key = foo (identifier), value = foo
              // Long form: { foo: bar }  → key = foo, value = bar (identifier)
              const keyName = prop.key?.name || prop.key?.value;
              if (typeof keyName === 'string' && keyName) {
                exported.set(keyName, { isDefault: false });
              }
            }
          }
          return;
        }

        // Pattern: module.exports.foo = bar
        //          exports.foo        = bar
        // (left is MemberExpression where the property is the export name)
        const isModuleExportsDotX =
          left.type === 'MemberExpression' &&
          left.object?.type === 'MemberExpression' &&
          left.object.object?.name === 'module' &&
          left.object.property?.name === 'exports';
        const isExportsDotX =
          left.type === 'MemberExpression' &&
          left.object?.name === 'exports';
        if (isModuleExportsDotX || isExportsDotX) {
          const name = left.property?.name;
          if (typeof name === 'string' && name) {
            exported.set(name, { isDefault: false });
          }
        }
      };

      this.traverse(ast, {
        ExportNamedDeclaration: (nodePath) => {
          const decl = nodePath.node.declaration;
          if (decl) {
            if (decl.type === 'FunctionDeclaration' && decl.id) {
              exported.set(decl.id.name, { isDefault: false });
            } else if (decl.type === 'VariableDeclaration') {
              for (const d of decl.declarations) {
                if (d.id?.name) exported.set(d.id.name, { isDefault: false });
              }
            }
          }
          for (const spec of nodePath.node.specifiers || []) {
            if (spec.local?.name) {
              exported.set(spec.local.name, { isDefault: false });
            }
          }
        },
        ExportDefaultDeclaration: (nodePath) => {
          const decl = nodePath.node.declaration;
          if (decl.type === 'FunctionDeclaration' && decl.id) {
            exported.set(decl.id.name, { isDefault: true });
          } else if (decl.type === 'Identifier') {
            exported.set(decl.name, { isDefault: true });
          }
        },
        // CommonJS exports — `module.exports = { ... }`, `exports.x = ...`
        AssignmentExpression: (nodePath) => {
          handleCjsExportAssignment(nodePath.node);
        }
      });

      return { declarations, exported };
    } catch (_err) {
      return null;
    }
  }

  /**
   * Two-pass regex: collect all exported names from file content.
   * Shared across scanners for consistent export detection.
   * @param {string} content - File content
   * @returns {Set<string>} Set of exported names
   */
  collectExportedNamesRegex(content) {
    const exported = new Set();
    let match;

    // export function / export const / export default function
    const exportedDeclRegex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(\w+)/g;
    while ((match = exportedDeclRegex.exec(content)) !== null) {
      exported.add(match[1]);
    }

    // export default Name (identifier)
    const exportDefaultIdRegex = /export\s+default\s+([A-Za-z_$]\w*)\s*;/g;
    while ((match = exportDefaultIdRegex.exec(content)) !== null) {
      exported.add(match[1]);
    }

    // export { Name, Name2 as Alias }
    const exportSpecRegex = /export\s*\{([^}]+)\}/g;
    while ((match = exportSpecRegex.exec(content)) !== null) {
      const specifiers = match[1].split(',');
      for (const spec of specifiers) {
        const name = spec.trim().split(/\s+as\s+/)[0].trim();
        if (name) exported.add(name);
      }
    }

    // CommonJS: module.exports = { foo, bar, baz }
    // arch-005 fix (2026-04-26): regex fallback was ESM-only, missing all
    // CJS exports. Same gap as the Babel scanner had.
    const cjsObjectExportRegex = /module\.exports\s*=\s*\{([^}]+)\}/g;
    while ((match = cjsObjectExportRegex.exec(content)) !== null) {
      const specifiers = match[1].split(',');
      for (const spec of specifiers) {
        const name = spec.trim().split(/[:\s]/)[0].trim();
        if (name && /^[a-zA-Z_$][\w$]*$/.test(name)) exported.add(name);
      }
    }

    // CommonJS: module.exports.foo = ... or exports.foo = ...
    const cjsDotExportRegex = /(?:module\.exports|^exports)\s*\.\s*([a-zA-Z_$][\w$]*)\s*=/gm;
    while ((match = cjsDotExportRegex.exec(content)) !== null) {
      exported.add(match[1]);
    }

    return exported;
  }

  /**
   * Parse params from string (regex fallback)
   * @param {string} paramsStr - Parameter string
   * @returns {Array} Array of { name, type }
   */
  parseParamsFromString(paramsStr) {
    if (!paramsStr.trim()) return [];

    return paramsStr.split(',').map(param => {
      const trimmed = param.trim();
      const colonIndex = trimmed.indexOf(':');

      if (colonIndex > 0) {
        return {
          name: trimmed.substring(0, colonIndex).trim().replace(/^\.\.\.|[?]$/, ''),
          type: trimmed.substring(colonIndex + 1).trim()
        };
      }

      return {
        name: trimmed.replace(/^\.\.\.|=.*$/, '').trim(),
        type: 'any'
      };
    });
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  BaseScanner,
  PROJECT_ROOT: PATHS.root
};
