#!/usr/bin/env node

/**
 * Wogi Flow - Interactive Conflict Resolution
 *
 * Presents pattern conflicts to user for resolution with recommendations.
 * Uses arrow key navigation and real-time feedback.
 *
 * Usage:
 *   Programmatic:
 *     const { resolveConflicts } = require('./flow-conflict-resolver');
 *     const resolved = await resolveConflicts(conflicts);
 *
 *   CLI (reads conflicts from file):
 *     flow conflict-resolve --input conflicts.json --output resolved.json
 *     node scripts/flow-conflict-resolver.js --input conflicts.json
 */

const fs = require('fs');
const readline = require('readline');

// ============================================================================
// Constants
// ============================================================================

// Display configuration
const DEFAULT_TERMINAL_WIDTH = 80;
const MAX_BOX_WIDTH = 62;
const MAX_LINE_WIDTH = 60;
const DEFAULT_MAX_PATH_LENGTH = 50;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Colors for CLI output
// TODO: Consider using flow-output.js for shared color definitions
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  underline: '\x1b[4m'
};

// Resolution values
const RESOLUTION = {
  A: 'A',
  B: 'B',
  SKIP: 'SKIP'
};

// ============================================================================
// Terminal Utilities
// ============================================================================

/**
 * Clear the terminal screen
 */
function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

/**
 * Hide cursor
 */
function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

/**
 * Show cursor
 */
function showCursor() {
  process.stdout.write('\x1b[?25h');
}

/**
 * Get terminal width
 */
function getTerminalWidth() {
  return process.stdout.columns || DEFAULT_TERMINAL_WIDTH;
}

/**
 * Create a horizontal line
 */
function horizontalLine(char = '─', width = null) {
  const w = width || getTerminalWidth();
  return char.repeat(Math.min(w, MAX_LINE_WIDTH));
}

/**
 * Box drawing for headers
 */
function boxHeader(text) {
  const width = Math.min(getTerminalWidth(), MAX_BOX_WIDTH);
  const textWidth = width - 4;
  const paddedText = text.padEnd(textWidth).slice(0, textWidth);

  return [
    `${c.cyan}╔${'═'.repeat(width - 2)}╗${c.reset}`,
    `${c.cyan}║${c.reset}  ${c.bold}${paddedText}${c.reset}${c.cyan}║${c.reset}`,
    `${c.cyan}╚${'═'.repeat(width - 2)}╝${c.reset}`
  ].join('\n');
}

/**
 * Format a file path for display
 */
function formatFilePath(filePath, maxLength = DEFAULT_MAX_PATH_LENGTH) {
  if (!filePath) return '';
  if (filePath.length <= maxLength) return filePath;

  const parts = filePath.split('/');
  if (parts.length <= 2) return filePath.slice(-maxLength);

  // Show first and last parts
  return '.../' + parts.slice(-2).join('/');
}

/**
 * Format time ago
 */
function formatTimeAgo(date) {
  if (!date) return 'Unknown';

  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / MS_PER_DAY);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < DAYS_PER_WEEK) return `${diffDays} days ago`;
  if (diffDays < DAYS_PER_MONTH) return `${Math.floor(diffDays / DAYS_PER_WEEK)} weeks ago`;
  if (diffDays < DAYS_PER_YEAR) return `${Math.floor(diffDays / DAYS_PER_MONTH)} months ago`;
  return `${Math.floor(diffDays / DAYS_PER_YEAR)} years ago`;
}

// ============================================================================
// Conflict Display
// ============================================================================

/**
 * Render a single conflict for display
 */
function renderConflict(conflict, index, total, selectedOption = null) {
  const lines = [];
  const width = Math.min(getTerminalWidth(), MAX_BOX_WIDTH);

  // Header
  lines.push('');
  lines.push(boxHeader(`Pattern Conflict Resolution`));
  lines.push('');

  // Progress indicator
  lines.push(`${c.dim}Found ${total} conflicts requiring your decision:${c.reset}`);
  lines.push('');

  // Conflict header
  lines.push(`${c.yellow}${'━'.repeat(width - 4)}${c.reset}`);
  lines.push(`${c.bold}CONFLICT ${index + 1}/${total}: ${conflict.description}${c.reset}`);
  lines.push(`${c.yellow}${'━'.repeat(width - 4)}${c.reset}`);
  lines.push('');

  // Option A
  const isARecommended = conflict.recommendation === 'A';
  const isASelected = selectedOption === 'A';
  const aBg = isASelected ? c.bgBlue : '';
  const aPrefix = isASelected ? '▶ ' : '  ';

  lines.push(`${aBg}${aPrefix}${c.bold}Option A: ${conflict.patternA.pattern.name}${isARecommended ? ` ${c.green}(Recommended)${c.reset}${aBg}${c.bold}` : ''}${c.reset}`);

  // Option A examples
  if (conflict.patternA.pattern.examples && conflict.patternA.pattern.examples.length > 0) {
    const examples = conflict.patternA.pattern.examples.slice(0, 3);
    lines.push(`${c.dim}    Examples: ${examples.join(', ')}${c.reset}`);
  }

  // Option A stats
  const totalOccurrences = conflict.patternA.occurrences + conflict.patternB.occurrences;
  const aPercentage = Math.round((conflict.patternA.occurrences / totalOccurrences) * 100);
  lines.push(`${c.dim}    Usage: ${conflict.patternA.occurrences} files (${aPercentage}%)${c.reset}`);
  lines.push(`${c.dim}    Last used: ${formatTimeAgo(conflict.patternA.newestOccurrence)}${c.reset}`);

  // Option A file examples
  if (conflict.patternA.files && conflict.patternA.files.length > 0) {
    lines.push(`${c.dim}    Files: ${conflict.patternA.files.slice(0, 2).map(f => formatFilePath(f, 30)).join(', ')}${c.reset}`);
  }

  lines.push('');

  // Option B
  const isBRecommended = conflict.recommendation === 'B';
  const isBSelected = selectedOption === 'B';
  const bBg = isBSelected ? c.bgBlue : '';
  const bPrefix = isBSelected ? '▶ ' : '  ';

  lines.push(`${bBg}${bPrefix}${c.bold}Option B: ${conflict.patternB.pattern.name}${isBRecommended ? ` ${c.green}(Recommended)${c.reset}${bBg}${c.bold}` : ''}${c.reset}`);

  // Option B examples
  if (conflict.patternB.pattern.examples && conflict.patternB.pattern.examples.length > 0) {
    const examples = conflict.patternB.pattern.examples.slice(0, 3);
    lines.push(`${c.dim}    Examples: ${examples.join(', ')}${c.reset}`);
  }

  // Option B stats
  const bPercentage = Math.round((conflict.patternB.occurrences / totalOccurrences) * 100);
  lines.push(`${c.dim}    Usage: ${conflict.patternB.occurrences} files (${bPercentage}%)${c.reset}`);
  lines.push(`${c.dim}    Last used: ${formatTimeAgo(conflict.patternB.newestOccurrence)}${c.reset}`);

  // Option B file examples
  if (conflict.patternB.files && conflict.patternB.files.length > 0) {
    lines.push(`${c.dim}    Files: ${conflict.patternB.files.slice(0, 2).map(f => formatFilePath(f, 30)).join(', ')}${c.reset}`);
  }

  lines.push('');

  // Why recommended
  if (conflict.recommendationReason) {
    const recOption = conflict.recommendation;
    lines.push(`${c.green}  Why ${recOption} is recommended:${c.reset}`);
    lines.push(`${c.dim}    ${conflict.recommendationReason}${c.reset}`);
    lines.push('');
  }

  // Skip option
  const isSkipSelected = selectedOption === 'SKIP';
  const skipBg = isSkipSelected ? c.bgBlue : '';
  const skipPrefix = isSkipSelected ? '▶ ' : '  ';
  lines.push(`${skipBg}${skipPrefix}${c.dim}[S] Skip - Don't enforce either pattern${c.reset}`);

  lines.push('');

  // Controls
  lines.push(`${c.dim}${horizontalLine()}${c.reset}`);
  lines.push(`${c.cyan}  ↑/↓${c.reset} Navigate   ${c.cyan}Enter${c.reset} Select   ${c.cyan}A/B/S${c.reset} Quick select   ${c.cyan}Q${c.reset} Quit`);

  return lines.join('\n');
}

/**
 * Render completion summary
 */
function renderSummary(resolutions) {
  const lines = [];

  lines.push('');
  lines.push(boxHeader(`Resolution Complete`));
  lines.push('');

  const countA = resolutions.filter(r => r.resolution === 'A').length;
  const countB = resolutions.filter(r => r.resolution === 'B').length;
  const countSkip = resolutions.filter(r => r.resolution === 'SKIP').length;

  lines.push(`${c.green}✓${c.reset} Resolved ${resolutions.length} conflicts:`);
  lines.push('');

  if (countA > 0) {
    lines.push(`  ${c.cyan}${countA}${c.reset} chose Option A (primary pattern)`);
  }
  if (countB > 0) {
    lines.push(`  ${c.cyan}${countB}${c.reset} chose Option B (alternative pattern)`);
  }
  if (countSkip > 0) {
    lines.push(`  ${c.dim}${countSkip}${c.reset} skipped (no preference)`);
  }

  lines.push('');

  // List resolutions
  lines.push(`${c.dim}${horizontalLine()}${c.reset}`);
  lines.push(`${c.bold}Decisions made:${c.reset}`);
  lines.push('');

  for (const res of resolutions) {
    if (res.resolution === 'SKIP') {
      lines.push(`  ${c.dim}○ ${res.description}: Skipped${c.reset}`);
    } else {
      const chosen = res.resolution === 'A' ? res.patternA.pattern.name : res.patternB.pattern.name;
      lines.push(`  ${c.green}●${c.reset} ${res.description}: ${c.cyan}${chosen}${c.reset}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Interactive Resolution
// ============================================================================

/**
 * Resolve conflicts interactively using arrow keys
 */
async function resolveConflictsInteractive(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    console.log(`${c.yellow}No conflicts to resolve.${c.reset}`);
    return [];
  }

  // Check if we're in a TTY
  if (!process.stdin.isTTY) {
    console.error(`${c.red}Error: Interactive mode requires a TTY.${c.reset}`);
    console.error(`${c.dim}Use --auto-accept for non-interactive resolution.${c.reset}`);
    process.exit(1);
  }

  const resolutions = [];
  let currentIndex = 0;

  // Process each conflict
  while (currentIndex < conflicts.length) {
    const conflict = conflicts[currentIndex];
    const resolution = await resolveOneConflict(conflict, currentIndex, conflicts.length);

    if (resolution === 'QUIT') {
      showCursor();
      console.log(`\n${c.yellow}Resolution cancelled. No changes saved.${c.reset}`);
      process.exit(0);
    }

    // Store resolution
    resolutions.push({
      ...conflict,
      resolution: resolution,
      resolvedAt: new Date().toISOString()
    });

    currentIndex++;
  }

  // Show summary
  clearScreen();
  console.log(renderSummary(resolutions));

  return resolutions;
}

/**
 * Resolve a single conflict with arrow key navigation
 */
async function resolveOneConflict(conflict, index, total) {
  return new Promise((resolve) => {
    const options = ['A', 'B', 'SKIP'];
    let selectedIndex = conflict.recommendation === 'B' ? 1 : 0; // Pre-select recommended

    function render() {
      clearScreen();
      console.log(renderConflict(conflict, index, total, options[selectedIndex]));
    }

    // Initial render
    hideCursor();
    render();

    // Setup raw mode for key input
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }

    function handleKeypress(str, key) {
      if (!key) return;

      // Handle arrow keys
      if (key.name === 'up') {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
        render();
      } else if (key.name === 'down') {
        selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
        render();
      } else if (key.name === 'return') {
        // Enter key - select current option
        cleanup();
        resolve(options[selectedIndex]);
      } else if (str === 'a' || str === 'A') {
        cleanup();
        resolve('A');
      } else if (str === 'b' || str === 'B') {
        cleanup();
        resolve('B');
      } else if (str === 's' || str === 'S') {
        cleanup();
        resolve('SKIP');
      } else if (str === 'q' || str === 'Q' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve('QUIT');
      }
    }

    function cleanup() {
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
      }
      showCursor();
    }

    process.stdin.on('keypress', handleKeypress);
  });
}

/**
 * Auto-accept all recommendations (non-interactive)
 */
function resolveConflictsAuto(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    return [];
  }

  return conflicts.map(conflict => ({
    ...conflict,
    resolution: conflict.recommendation || 'SKIP',
    resolvedAt: new Date().toISOString(),
    autoResolved: true
  }));
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Main entry point for resolving conflicts
 *
 * @param {Array} conflicts - Array of conflict objects from pattern extractor
 * @param {Object} options - Resolution options
 * @param {boolean} options.interactive - Use interactive mode (default: true if TTY)
 * @param {boolean} options.autoAccept - Auto-accept all recommendations
 * @returns {Promise<Array>} Resolved conflicts with user decisions
 */
async function resolveConflicts(conflicts, options = {}) {
  const {
    interactive = process.stdin.isTTY,
    autoAccept = false
  } = options;

  if (autoAccept) {
    return resolveConflictsAuto(conflicts);
  }

  if (interactive) {
    return resolveConflictsInteractive(conflicts);
  }

  // Non-interactive, non-auto: just return with null resolutions
  return conflicts.map(conflict => ({
    ...conflict,
    resolution: null
  }));
}

/**
 * Convert resolutions to decisions.md format
 */
function resolutionsToDecisions(resolutions) {
  const lines = ['## Pattern Decisions', ''];

  for (const res of resolutions) {
    if (res.resolution === 'SKIP') continue;

    const chosenPattern = res.resolution === 'A'
      ? res.patternA.pattern
      : res.patternB.pattern;

    lines.push(`### ${chosenPattern.subcategory.replace('.', ': ').replace(/\b\w/g, l => l.toUpperCase())}`);
    lines.push('');
    lines.push(`**Pattern**: ${chosenPattern.name}`);

    if (chosenPattern.description) {
      lines.push(`**Description**: ${chosenPattern.description}`);
    }

    if (chosenPattern.examples && chosenPattern.examples.length > 0) {
      lines.push(`**Examples**: \`${chosenPattern.examples.slice(0, 3).join('`, `')}\``);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Safe JSON parsing with prototype pollution prevention
 */
function safeJsonParse(content, defaultValue = null) {
  try {
    // Check for prototype pollution attempts in raw content
    if (/__proto__|constructor\s*["'`:]|prototype\s*["'`:]/i.test(content)) {
      console.error(`${c.red}Suspicious content detected in JSON${c.reset}`);
      return defaultValue;
    }

    const parsed = JSON.parse(content);

    // Validate it's an array or object
    if (typeof parsed !== 'object' || parsed === null) {
      return defaultValue;
    }

    // Recursive check for prototype pollution in nested structures
    function hasPrototypePollution(obj) {
      if (typeof obj !== 'object' || obj === null) {
        return false;
      }
      if (!Array.isArray(obj)) {
        const keys = Object.getOwnPropertyNames(obj);
        if (keys.includes('__proto__') || keys.includes('constructor') || keys.includes('prototype')) {
          return true;
        }
      }
      // Recursively check all values (array elements or object properties)
      for (const value of Object.values(obj)) {
        if (hasPrototypePollution(value)) {
          return true;
        }
      }
      return false;
    }

    if (hasPrototypePollution(parsed)) {
      console.error(`${c.red}Prototype pollution attempt detected${c.reset}`);
      return defaultValue;
    }

    return parsed;
  } catch (err) {
    console.error(`${c.red}JSON parse error: ${err.message}${c.reset}`);
    return defaultValue;
  }
}

/**
 * Load conflicts from JSON file
 */
function loadConflictsFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = safeJsonParse(content);

    if (!data) {
      console.error(`${c.red}Error: Failed to parse conflicts file.${c.reset}`);
      process.exit(1);
    }

    // Handle both direct array and wrapped format
    if (Array.isArray(data)) {
      return data;
    }
    if (data.conflicts && Array.isArray(data.conflicts)) {
      return data.conflicts;
    }

    console.error(`${c.red}Error: Invalid conflicts file format.${c.reset}`);
    process.exit(1);
  } catch (err) {
    console.error(`${c.red}Error loading conflicts: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

/**
 * Save resolutions to JSON file
 */
function saveResolutionsToFile(resolutions, filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(resolutions, null, 2), 'utf-8');
  } catch (err) {
    console.error(`${c.red}Error saving resolutions: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    input: null,
    output: null,
    autoAccept: false,
    format: 'json',
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--input' || arg === '-i') {
      options.input = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--auto-accept' || arg === '--auto') {
      options.autoAccept = true;
    } else if (arg === '--format' || arg === '-f') {
      options.format = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-') && !options.input) {
      options.input = arg;
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${c.bold}Wogi Flow - Conflict Resolver${c.reset}

Interactive resolution of pattern conflicts with recommendations.

${c.cyan}Usage:${c.reset}
  flow conflict-resolve [options] [input-file]
  node scripts/flow-conflict-resolver.js [options]

${c.cyan}Options:${c.reset}
  -i, --input <file>     Input file with conflicts JSON
  -o, --output <file>    Output file for resolutions (default: stdout)
  --auto-accept          Auto-accept all recommendations (non-interactive)
  -f, --format <format>  Output format: json, decisions (default: json)
  -h, --help             Show this help message

${c.cyan}Examples:${c.reset}
  ${c.dim}# Interactive resolution${c.reset}
  flow conflict-resolve conflicts.json -o resolved.json

  ${c.dim}# Auto-accept recommendations${c.reset}
  flow conflict-resolve conflicts.json --auto-accept

  ${c.dim}# Output as decisions.md format${c.reset}
  flow conflict-resolve conflicts.json --format decisions

${c.cyan}Navigation:${c.reset}
  ↑/↓        Navigate between options
  Enter      Select current option
  A/B/S      Quick select Option A, B, or Skip
  Q          Quit without saving
`);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.input) {
    console.error(`${c.red}Error: No input file specified.${c.reset}`);
    console.error(`${c.dim}Use --help for usage information.${c.reset}`);
    process.exit(1);
  }

  // Load conflicts
  const conflicts = loadConflictsFromFile(options.input);

  if (conflicts.length === 0) {
    console.log(`${c.green}No conflicts found in input file.${c.reset}`);
    process.exit(0);
  }

  console.log(`${c.cyan}Loaded ${conflicts.length} conflicts from ${options.input}${c.reset}`);

  // Resolve conflicts
  const resolutions = await resolveConflicts(conflicts, {
    autoAccept: options.autoAccept
  });

  // Format output
  let output;
  if (options.format === 'decisions') {
    output = resolutionsToDecisions(resolutions);
  } else {
    output = JSON.stringify(resolutions, null, 2);
  }

  // Write output
  if (options.output) {
    fs.writeFileSync(options.output, output, 'utf-8');
    console.log(`${c.green}Resolutions saved to ${options.output}${c.reset}`);
  } else if (!options.autoAccept) {
    // Only print to stdout in auto mode or when explicitly requested
    console.log(output);
  }

  process.exit(0);
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  resolveConflicts,
  resolveConflictsInteractive,
  resolveConflictsAuto,
  resolutionsToDecisions,
  loadConflictsFromFile,
  saveResolutionsToFile,
  renderConflict,
  renderSummary,
  RESOLUTION
};

// Run CLI if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
