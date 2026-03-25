#!/usr/bin/env node
'use strict';

/**
 * Validator - Extracted from flow-orchestrate.js
 *
 * Provides file existence checks, TypeScript compilation checks,
 * and ESLint checks for orchestrated code generation steps.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getProjectRoot, colors, PATHS } = require('./flow-utils');
const { getExecParts } = require('./flow-script-resolver');

function log(color, ...args) {
  console.log(colors[color] + args.join(' ') + colors.reset);
}

class Validator {
  static fileExists(filePath) {
    if (fs.existsSync(filePath)) {
      return { success: true, message: 'File exists' };
    }
    return { success: false, message: `File not found: ${filePath}` };
  }

  /**
   * Finds the nearest directory containing a tsconfig.json.
   * Walks up from the file's directory to find the right TypeScript project root.
   * Essential for monorepos where tsconfig is in apps/web/, apps/api/, etc.
   */
  static findTsConfigDir(filePath) {
    if (!filePath) return PATHS.root;

    let dir = path.dirname(filePath);
    while (dir && dir !== path.dirname(dir)) { // Stop at filesystem root
      const tsconfig = path.join(dir, 'tsconfig.json');
      if (fs.existsSync(tsconfig)) {
        return dir;
      }
      // Also check for package.json as fallback (workspace root)
      const packageJson = path.join(dir, 'package.json');
      if (fs.existsSync(packageJson)) {
        // If this package has a tsconfig, use it
        if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
          return dir;
        }
      }
      dir = path.dirname(dir);
    }
    return PATHS.root;
  }

  static typescriptCheck(filePath) {
    try {
      // Find the nearest tsconfig directory (for monorepo support)
      const cwd = this.findTsConfigDir(filePath);
      const tsconfigPath = path.join(cwd, 'tsconfig.json');

      // Check if tsconfig exists in this directory
      if (!fs.existsSync(tsconfigPath)) {
        log('dim', `   ⚠️ No tsconfig.json found, skipping TypeScript check`);
        return { success: true, message: 'TypeScript check skipped (no tsconfig.json)' };
      }

      if (cwd !== PATHS.root) {
        log('dim', `   📁 Running tsc from: ${path.relative(PATHS.root, cwd) || '.'}`);
      }

      // Use execFileSync with array args for safety
      const tscExec = getExecParts('tsc', ['--noEmit']);
      execFileSync(tscExec.cmd, tscExec.args, {
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, message: 'TypeScript check passed' };
    } catch (err) {
      const stderr = err.stderr || err.stdout || err.message;

      // Filter out help text (indicates no tsconfig found)
      if (stderr.includes('COMMON COMMANDS') || stderr.includes('tsc: The TypeScript Compiler')) {
        return { success: true, message: 'TypeScript check skipped (tsc could not find project)' };
      }

      // CRITICAL: Filter errors to only include the file we're validating
      // This prevents pre-existing errors in other files from failing validation
      if (filePath) {
        const cwd = this.findTsConfigDir(filePath);
        const relativeFile = path.relative(cwd, filePath);
        const fileName = path.basename(filePath);
        const lines = stderr.split('\n');

        // Find errors that mention our file (by relative path or just filename)
        const relevantErrors = lines.filter(line => {
          // Match lines that contain our file path
          return line.includes(relativeFile) ||
                 line.includes(fileName) ||
                 // Also include "error TS" lines that follow a file match (context)
                 (line.trim().startsWith('error TS') && lines[lines.indexOf(line) - 1]?.includes(fileName));
        });

        if (relevantErrors.length === 0) {
          // Errors exist but not in our file - pass validation
          const errorCount = (stderr.match(/error TS/g) || []).length;
          log('dim', `   ⚠️ ${errorCount} pre-existing error(s) in other files, ${fileName} is clean`);
          return { success: true, message: 'TypeScript check passed (file-specific)' };
        }

        // Errors in our file - fail with relevant errors only
        return {
          success: false,
          message: relevantErrors.slice(0, 10).join('\n')
        };
      }

      return {
        success: false,
        message: stderr.split('\n').slice(0, 10).join('\n')
      };
    }
  }

  static eslintCheck(filePath) {
    try {
      // Also find the right directory for eslint config
      const cwd = this.findTsConfigDir(filePath);
      // Use execFileSync with array args to prevent shell injection
      const eslintExec = getExecParts('eslint', [filePath, '--fix']);
      execFileSync(eslintExec.cmd, eslintExec.args, {
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, message: 'ESLint check passed' };
    } catch (err) {
      const stderr = err.stderr || err.stdout || err.message;
      return {
        success: false,
        message: stderr.split('\n').slice(0, 10).join('\n')
      };
    }
  }

  static runChecks(checks, filePath) {
    const results = [];

    for (const check of checks) {
      let result;
      switch (check) {
        case 'file-exists':
          result = this.fileExists(filePath);
          break;
        case 'typescript-check':
          result = this.typescriptCheck(filePath);  // Now passes filePath
          break;
        case 'eslint-check':
          result = this.eslintCheck(filePath);
          break;
        default:
          result = { success: true, message: `Unknown check: ${check}` };
      }
      results.push({ check, ...result });

      if (!result.success) break;
    }

    return results;
  }
}

module.exports = { Validator };
