#!/usr/bin/env node

/**
 * Wogi Flow - Output Utilities
 *
 * Terminal output formatting with colors and standard message types.
 * Extracted from flow-utils.js for better modularity.
 *
 * Usage:
 *   const { colors, color, success, warn, error, info } = require('./flow-output');
 */

// ============================================================
// Colors (ANSI escape codes)
// ============================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

/**
 * Colorize text for terminal output
 */
function color(colorName, text) {
  if (process.env.DEBUG && !colors[colorName]) {
    console.warn(`[DEBUG] Unknown color: "${colorName}"`);
  }
  return `${colors[colorName] || ''}${text}${colors.reset}`;
}

/**
 * Print colored output
 */
function print(colorName, text) {
  console.log(color(colorName, text));
}

/**
 * Print a styled header
 */
function printHeader(title) {
  console.log(color('cyan', '═'.repeat(50)));
  console.log(color('cyan', `        ${title}`));
  console.log(color('cyan', '═'.repeat(50)));
  console.log('');
}

/**
 * Print a section title
 */
function printSection(title) {
  console.log(color('cyan', title));
}

// ============================================================
// Standard Messaging Functions
// ============================================================
//
// STANDARD: All scripts should use these functions for consistent output:
//   success(msg) - Green checkmark ✓ for successful operations
//   warn(msg)    - Yellow warning ⚠ for non-fatal issues
//   error(msg)   - Red X ✗ for errors (use before process.exit(1))
//   info(msg)    - Cyan info ℹ for informational messages
//
// Import with: const { success, warn, error, info } = require('./flow-output');
//
// AVOID: Direct console.log with color() for status messages.
// ============================================================

/**
 * Print success message
 */
function success(message) {
  console.log(`${color('green', '✓')} ${message}`);
}

/**
 * Print warning message
 */
function warn(message) {
  console.log(`${color('yellow', '⚠')} ${message}`);
}

/**
 * Print error message
 */
function error(message) {
  console.log(`${color('red', '✗')} ${message}`);
}

/**
 * Print info message
 */
function info(message) {
  console.log(`${color('cyan', 'ℹ')} ${message}`);
}

module.exports = {
  colors,
  color,
  print,
  printHeader,
  printSection,
  success,
  warn,
  error,
  info,
};
