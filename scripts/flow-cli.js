#!/usr/bin/env node

/**
 * Wogi Flow - CLI Utilities
 *
 * Standardized CLI output and exit codes for composability and CI integration.
 *
 * Exit Codes:
 *   0  - Success
 *   1  - General failure
 *   2  - Configuration error
 *   3  - Validation error
 *   4  - Not found
 *   5  - Safety violation
 *   6  - Timeout
 *   7  - Dependency error
 *
 * Usage:
 *   const cli = require('./flow-cli');
 *   cli.output({ tasks: [...] }, { json: true });
 *   cli.success('Task completed');
 *   cli.fail('Something went wrong', 1);
 */

const _fs = require('node:fs');
const _path = require('node:path');
const { colors: c, parseFlags: utilsParseFlags } = require('./flow-utils');
const { success: outputSuccess, warn: outputWarn, error: outputError, info: outputInfo } = require('./flow-output');

// Exit codes
const EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
  CONFIG_ERROR: 2,
  VALIDATION_ERROR: 3,
  NOT_FOUND: 4,
  SAFETY_VIOLATION: 5,
  TIMEOUT: 6,
  DEPENDENCY_ERROR: 7
};

/**
 * Global CLI options
 */
let globalOptions = {
  json: false,
  quiet: false,
  verbose: false,
  noColor: process.env.NO_COLOR === '1' || process.env.CI === 'true'
};

/**
 * Parse common CLI flags
 * Uses the comprehensive implementation from flow-utils.js
 */
function parseFlags(args) {
  // Use the flow-utils implementation which handles:
  // - --key=value style
  // - Valued flags (--priority, --from, etc.)
  // - Named flags dictionary
  return utilsParseFlags(args);
}

/**
 * Configure global options
 */
function configure(options) {
  globalOptions = { ...globalOptions, ...options };
}

/**
 * Get color code (respects NO_COLOR)
 */
function color(name) {
  if (globalOptions.noColor || globalOptions.json) {
    return '';
  }
  return c[name] || '';
}

/**
 * Standard output function
 */
function output(data, options = {}) {
  const opts = { ...globalOptions, ...options };

  if (opts.json) {
    // JSON mode - machine readable
    const jsonData = {
      success: data.success !== false,
      timestamp: new Date().toISOString(),
      ...data
    };
    console.log(JSON.stringify(jsonData, null, opts.pretty ? 2 : 0));
  } else if (!opts.quiet) {
    // Human readable mode
    if (typeof data === 'string') {
      console.log(data);
    } else if (data.message) {
      console.log(data.message);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Success output
 */
function success(message, data = {}) {
  if (globalOptions.json) {
    output({ success: true, message, ...data });
  } else if (!globalOptions.quiet) {
    outputSuccess(message);
  }
}

/**
 * Warning output
 */
function warn(message, data = {}) {
  if (globalOptions.json) {
    output({ success: true, warning: message, ...data });
  } else if (!globalOptions.quiet) {
    outputWarn(message);
  }
}

/**
 * Error output
 */
function error(message, data = {}) {
  if (globalOptions.json) {
    output({ success: false, error: message, ...data }, { json: true });
  } else {
    outputError(message);
  }
}

/**
 * Info output
 */
function info(message) {
  if (!globalOptions.json && !globalOptions.quiet) {
    outputInfo(message);
  }
}

/**
 * Debug output (only in verbose mode)
 */
function debug(message) {
  if (globalOptions.verbose && !globalOptions.json) {
    console.log(`${color('dim')}[debug] ${message}${color('reset')}`);
  }
}

/**
 * Exit with code and optional message
 */
function exit(code, message = null, data = {}) {
  if (message) {
    if (code === EXIT_CODES.SUCCESS) {
      success(message, data);
    } else {
      error(message, { code, ...data });
    }
  }
  process.exit(code);
}

/**
 * Fail with error message
 */
function fail(message, code = EXIT_CODES.FAILURE, data = {}) {
  exit(code, message, data);
}

/**
 * Create progress indicator
 */
function progress(current, total, label = '') {
  if (globalOptions.json || globalOptions.quiet) return;

  const width = 30;
  const percent = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  process.stdout.write(`\r${color('cyan')}${bar}${color('reset')} ${percent}% ${label}`);

  if (current >= total) {
    console.log(''); // New line at end
  }
}

/**
 * Create a spinner for async operations
 */
function spinner(label) {
  if (globalOptions.json || globalOptions.quiet) {
    return { stop: () => {}, succeed: () => {}, fail: () => {} };
  }

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let running = true;

  const interval = setInterval(() => {
    if (running) {
      process.stdout.write(`\r${color('cyan')}${frames[i % frames.length]}${color('reset')} ${label}`);
      i++;
    }
  }, 80);

  return {
    stop: () => {
      running = false;
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(label.length + 3) + '\r');
    },
    succeed: (msg) => {
      running = false;
      clearInterval(interval);
      success(msg || label);
    },
    fail: (msg) => {
      running = false;
      clearInterval(interval);
      error(msg || label);
    }
  };
}

/**
 * Format a table for display
 */
function table(data, columns = null) {
  if (globalOptions.json) {
    return JSON.stringify(data);
  }

  if (data.length === 0) return '';

  // Auto-detect columns from first row
  const cols = columns || Object.keys(data[0]);

  // Calculate column widths
  const widths = {};
  for (const col of cols) {
    widths[col] = Math.max(
      col.length,
      ...data.map(row => String(row[col] || '').length)
    );
  }

  let output = '';

  // Header
  output += cols.map(col => col.padEnd(widths[col])).join(' │ ') + '\n';
  output += cols.map(col => '─'.repeat(widths[col])).join('─┼─') + '\n';

  // Rows
  for (const row of data) {
    output += cols.map(col => String(row[col] || '').padEnd(widths[col])).join(' │ ') + '\n';
  }

  return output;
}

/**
 * Format list items
 */
function list(items, options = {}) {
  if (globalOptions.json) {
    return JSON.stringify(items);
  }

  const bullet = options.numbered ? (i) => `${i + 1}.` : () => '•';

  return items.map((item, i) => `  ${bullet(i)} ${item}`).join('\n');
}

/**
 * Format key-value pairs
 */
function keyValue(obj, options = {}) {
  if (globalOptions.json) {
    return JSON.stringify(obj);
  }

  const indent = options.indent || '';
  const separator = options.separator || ': ';

  return Object.entries(obj)
    .map(([key, value]) => `${indent}${color('bold')}${key}${color('reset')}${separator}${value}`)
    .join('\n');
}

/**
 * Section header
 */
function section(title) {
  if (globalOptions.json || globalOptions.quiet) return;
  console.log(`\n${color('cyan')}${color('bold')}${title}${color('reset')}`);
  console.log(color('dim') + '─'.repeat(title.length + 4) + color('reset'));
}

/**
 * Wrap async function with standard error handling
 */
function wrapAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.isSafetyViolation) {
        fail(err.message, EXIT_CODES.SAFETY_VIOLATION);
      } else if (err.code === 'ENOENT') {
        fail(`File not found: ${err.path}`, EXIT_CODES.NOT_FOUND);
      } else if (err.name === 'SyntaxError') {
        fail(`Configuration error: ${err.message}`, EXIT_CODES.CONFIG_ERROR);
      } else {
        fail(err.message, EXIT_CODES.FAILURE);
      }
    }
  };
}

/**
 * Standard result wrapper for JSON output
 */
function result(success, data = {}, message = null) {
  return {
    success,
    message,
    timestamp: new Date().toISOString(),
    ...data
  };
}

// Module exports
module.exports = {
  EXIT_CODES,
  parseFlags,
  configure,
  color,
  output,
  success,
  warn,
  error,
  info,
  debug,
  exit,
  fail,
  progress,
  spinner,
  table,
  list,
  keyValue,
  section,
  wrapAsync,
  result,

  // Color codes for direct access
  c
};

// CLI Handler - show help when run directly
if (require.main === module) {
  console.log(`
${c.cyan}Wogi Flow - CLI Utilities${c.reset}

This module provides standardized CLI output and exit codes.

${c.bold}Exit Codes:${c.reset}
  0  SUCCESS          Operation completed successfully
  1  FAILURE          General failure
  2  CONFIG_ERROR     Invalid configuration
  3  VALIDATION_ERROR Validation failed
  4  NOT_FOUND        Resource not found
  5  SAFETY_VIOLATION Safety guardrail triggered
  6  TIMEOUT          Operation timed out
  7  DEPENDENCY_ERROR Missing dependency

${c.bold}Common Flags:${c.reset}
  --json             Output in JSON format
  --quiet, -q        Suppress non-essential output
  --verbose, -v      Show debug information
  --help, -h         Show help
  --version          Show version

${c.bold}Environment Variables:${c.reset}
  NO_COLOR=1         Disable colored output
  CI=true            CI mode (implies NO_COLOR)

${c.bold}Usage in scripts:${c.reset}
  const cli = require('./flow-cli');
  cli.configure({ json: true });
  cli.success('Done!');
  cli.fail('Error', cli.EXIT_CODES.VALIDATION_ERROR);
  `);
}
