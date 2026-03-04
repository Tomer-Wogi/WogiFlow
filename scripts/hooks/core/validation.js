#!/usr/bin/env node

/**
 * Wogi Flow - Validation (Core Module)
 *
 * CLI-agnostic validation logic.
 * Runs lint/typecheck after file edits.
 *
 * Returns a standardized result that adapters transform for specific CLIs.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Import from parent scripts directory
const { getConfig, PATHS } = require('../../flow-utils');
const { getCommand, getExec } = require('../../flow-script-resolver');

/**
 * Check if validation is enabled
 * @returns {boolean}
 */
function isValidationEnabled() {
  const config = getConfig();
  return config.hooks?.rules?.validation?.enabled !== false;
}

/**
 * Get validation commands for a file extension
 * @param {string} ext - File extension (e.g., '.ts', '.tsx')
 * @returns {string[]} Array of commands to run
 */
function getValidationCommands(ext) {
  const config = getConfig();

  // Check hooks config first
  const hooksCommands = config.hooks?.rules?.validation?.commands;
  if (hooksCommands && hooksCommands[`*${ext}`]) {
    return hooksCommands[`*${ext}`];
  }

  // Fall back to validation.afterFileEdit config
  const legacyCommands = config.validation?.afterFileEdit?.commands;
  if (legacyCommands && legacyCommands[`*${ext}`]) {
    return legacyCommands[`*${ext}`];
  }

  // Build defaults dynamically from config.scripts and script-resolver
  const typecheckCmd = getCommand('typecheck') || null;
  const lintCmd = getCommand('lint') || null;

  // Only add tsc if tsconfig.json exists (project actually uses TypeScript)
  const hasTsConfig = (() => {
    try { return fs.existsSync(path.join(PATHS.root, 'tsconfig.json')); } catch { return false; }
  })();

  const tscCmd = hasTsConfig ? (typecheckCmd || getExec('tsc', ['--noEmit'])) : null;
  const eslintCmd = lintCmd || getExec('eslint', ['{file}']);

  const defaults = {};
  if (tscCmd) defaults['.ts'] = [tscCmd];
  if (tscCmd && eslintCmd) defaults['.tsx'] = [tscCmd, eslintCmd];
  else if (tscCmd) defaults['.tsx'] = [tscCmd];
  else if (eslintCmd) defaults['.tsx'] = [eslintCmd];
  if (eslintCmd) defaults['.js'] = [eslintCmd];
  if (eslintCmd) defaults['.jsx'] = [eslintCmd];

  // Also support Python, Go, Rust file extensions
  defaults['.py'] = [];
  defaults['.go'] = [];
  defaults['.rs'] = [];

  return defaults[ext] || [];
}

/**
 * Run a single validation command
 * @param {string} command - Command to run (may contain {file} placeholder)
 * @param {string} filePath - Path to the file being validated
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<Object>} Result: { passed, output, error, duration }
 */
async function runValidationCommand(command, filePath, timeout = 30000) {
  const startTime = Date.now();
  const actualCommand = command.replace('{file}', `"${filePath}"`);

  return new Promise((resolve) => {
    try {
      const result = execSync(actualCommand, {
        cwd: PATHS.root,
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      resolve({
        passed: true,
        output: result,
        error: null,
        duration: Date.now() - startTime,
        command: actualCommand
      });
    } catch (err) {
      resolve({
        passed: false,
        output: err.stdout || '',
        error: err.stderr || err.message,
        duration: Date.now() - startTime,
        command: actualCommand
      });
    }
  });
}

/**
 * Run all validation for a file
 * @param {Object} options
 * @param {string} options.filePath - Path to the file
 * @param {number} options.timeout - Timeout per command in ms
 * @returns {Promise<Object>} Result: { passed, results, summary }
 */
async function runValidation(options = {}) {
  const { filePath, timeout = 30000 } = options;

  if (!isValidationEnabled()) {
    return {
      passed: true,
      skipped: true,
      reason: 'validation_disabled',
      results: []
    };
  }

  const ext = path.extname(filePath);
  const commands = getValidationCommands(ext);

  if (commands.length === 0) {
    return {
      passed: true,
      skipped: true,
      reason: 'no_commands_for_extension',
      extension: ext,
      results: []
    };
  }

  const results = [];
  let allPassed = true;

  for (const cmd of commands) {
    const result = await runValidationCommand(cmd, filePath, timeout);
    results.push(result);
    if (!result.passed) {
      allPassed = false;
    }
  }

  return {
    passed: allPassed,
    skipped: false,
    results,
    summary: generateValidationSummary(results, filePath)
  };
}

/**
 * Generate human-readable validation summary
 */
function generateValidationSummary(results, filePath) {
  const fileName = path.basename(filePath);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  if (failed === 0) {
    return `Validation passed for ${fileName} (${passed} check${passed !== 1 ? 's' : ''})`;
  }

  let summary = `Validation failed for ${fileName}:\n`;
  for (const result of results.filter(r => !r.passed)) {
    summary += `\n- ${result.command}:\n`;
    if (result.error) {
      // Truncate long error output
      const errorLines = result.error.split('\n').slice(0, 10);
      summary += errorLines.map(line => `  ${line}`).join('\n');
      if (result.error.split('\n').length > 10) {
        summary += '\n  ... (truncated)';
      }
    }
  }

  return summary;
}

/**
 * Parse TypeScript errors from output
 * @param {string} output - TypeScript compiler output
 * @returns {Array} Parsed errors
 */
function parseTypeScriptErrors(output) {
  const errors = [];
  const errorRegex = /(.+)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/g;

  let match;
  while ((match = errorRegex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      code: match[4],
      message: match[5]
    });
  }

  return errors;
}

/**
 * Parse ESLint errors from output
 * @param {string} output - ESLint output
 * @returns {Array} Parsed errors
 */
function parseEslintErrors(output) {
  const errors = [];
  const errorRegex = /(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)$/gm;

  let match;
  while ((match = errorRegex.exec(output)) !== null) {
    errors.push({
      line: parseInt(match[1], 10),
      column: parseInt(match[2], 10),
      severity: match[3],
      message: match[4],
      rule: match[5]
    });
  }

  return errors;
}

module.exports = {
  isValidationEnabled,
  getValidationCommands,
  runValidationCommand,
  runValidation,
  generateValidationSummary,
  parseTypeScriptErrors,
  parseEslintErrors
};
