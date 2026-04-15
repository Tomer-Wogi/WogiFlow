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

// ============================================================
// Shared CLI Help Output
// ============================================================

/**
 * Print a standardized help message for CLI scripts.
 *
 * @param {string} scriptName - Display name of the script (e.g., 'flow-models.js')
 * @param {string} description - One-line description of what the script does
 * @param {Array<{name: string, description: string}>} commands - List of commands
 * @param {Object} [opts] - Additional options
 * @param {Array<{name: string, description: string}>} [opts.options] - CLI flags/options
 * @param {Array<string>} [opts.examples] - Example usage strings
 */
function showHelp(scriptName, description, commands, opts = {}) {
  const { options, examples } = opts;

  console.log('');
  console.log(color('bold', scriptName));
  if (description) {
    console.log(`  ${description}`);
  }
  console.log('');
  console.log(`${color('bold', 'Usage:')} node scripts/${scriptName} [command]`);
  if (commands && commands.length) {
    console.log('');
    console.log(`${color('bold', 'Commands:')}`);
    for (const cmd of commands) {
      console.log(`  ${color('green', cmd.name.padEnd(24))} ${cmd.description}`);
    }
  }
  if (options && options.length) {
    console.log('');
    console.log(`${color('bold', 'Options:')}`);
    for (const opt of options) {
      console.log(`  ${color('dim', opt.name.padEnd(24))} ${opt.description}`);
    }
  }
  if (examples && examples.length) {
    console.log('');
    console.log(`${color('bold', 'Examples:')}`);
    for (const ex of examples) {
      console.log(`  ${ex}`);
    }
  }
  console.log('');
}

// ============================================================
// String Utilities
// ============================================================

/**
 * Escape special regex characters in a string.
 * Makes the string safe for use in `new RegExp(...)`.
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for regex
 */
/**
 * Get today's date as YYYY-MM-DD string
 * @returns {string}
 */
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function escapeRegex(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Canonical slugify — consolidates 4 duplicate impls across scripts/ per audit
 * dup-003 (wf-7072d3ac, 2026-04-15).
 *
 * @param {string} str
 * @param {Object} [opts]
 * @param {'alnum'|'word'} [opts.mode='alnum']
 *   'alnum' — strips everything except [a-z0-9]+ (2026 matches old auto-learn/session-learning/rules-sync behavior).
 *   'word'  — preserves word chars incl. underscores (old flow-story behavior).
 * @param {number} [opts.maxLength] — truncate to this many chars (unset = unbounded).
 * @returns {string}
 */
function slugify(str, opts = {}) {
  const { mode = 'alnum', maxLength } = opts;
  if (!str || typeof str !== 'string') return '';
  let s = str.toLowerCase().trim();
  if (mode === 'word') {
    s = s
      .replace(/[^\w\s-]/g, '')       // strip non-word chars except space/hyphen
      .replace(/[\s_]+/g, '-');        // space/underscore → hyphen
  } else {
    s = s.replace(/[^a-z0-9]+/g, '-'); // single pass: anything non-alnum → hyphen
  }
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (Number.isFinite(maxLength) && maxLength > 0) s = s.slice(0, maxLength);
  return s;
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
  showHelp,
  escapeRegex,
  getTodayDate,
  slugify,
};
