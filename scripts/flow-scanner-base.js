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

const fs = require('fs');
const path = require('path');
const { getProjectRoot, getConfig, color, success, warn, error } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();

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
    this._excludeRegexps = this.config.excludePatterns.map(pattern => {
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\./g, '\\.');
      return new RegExp('^' + regexPattern + '$');
    });

    // Try to load babel for better parsing
    this.parser = null;
    this.traverse = null;
    try {
      this.parser = require('@babel/parser');
      this.traverse = require('@babel/traverse').default;
    } catch {
      // Babel not available, will use regex parsing
    }
  }

  /**
   * Find existing directories from config
   * @returns {string[]} Array of full paths to existing directories
   */
  findDirectories() {
    const found = [];
    for (const dir of this.config.directories) {
      const fullPath = path.join(PROJECT_ROOT, dir);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        found.push(fullPath);
      }
    }
    return found;
  }

  /**
   * Check if file should be excluded
   * @param {string} filePath - Full path to file
   * @returns {boolean} True if file should be excluded
   */
  shouldExclude(filePath) {
    const relativePath = path.relative(PROJECT_ROOT, filePath);

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
  PROJECT_ROOT
};
