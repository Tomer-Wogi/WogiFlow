#!/usr/bin/env node

/**
 * Wogi Flow - Quick Capture
 *
 * Quickly capture ideas or bugs without interrupting flow.
 * Items go to backlog in ready.json for later triage.
 *
 * Usage:
 *   node scripts/flow-capture.js "<title>" [--type bug|feature] [--tags tag1,tag2] [--json]
 */

const path = require('path');
const {
  PATHS,
  readJson,
  writeJson,
  parseFlags,
  outputJson,
  success,
  error
} = require('./flow-utils');

// Try to load session state for auto-detecting current task
let loadSessionState;
try {
  const sessionModule = require('./flow-session-state');
  loadSessionState = sessionModule.loadSessionState;
} catch (importError) {
  if (process.env.DEBUG) {
    console.warn(`[DEBUG] Could not load flow-session-state: ${importError.message}`);
  }
  loadSessionState = () => ({});
}

/**
 * Keywords that indicate a bug report
 */
const BUG_KEYWORDS = [
  'bug',
  'fix',
  'broken',
  'error',
  'crash',
  'fails',
  'failing',
  'not working',
  'doesn\'t work',
  'issue',
  'problem'
];

/**
 * Auto-detect type from title
 * @param {string} title - The captured title
 * @returns {'bug' | 'feature'}
 */
function detectType(title) {
  const lowerTitle = title.toLowerCase();

  for (const keyword of BUG_KEYWORDS) {
    if (lowerTitle.includes(keyword)) {
      return 'bug';
    }
  }

  return 'feature';
}

/**
 * Generate a capture ID
 * Format: cap-YYYYMMDD-NNN
 * @param {Array} existingBacklog - Existing backlog items
 * @returns {string}
 */
function generateCaptureId(existingBacklog) {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

  // Find highest number for today
  const todayPattern = new RegExp(`^cap-${today}-(\\d{3})$`);
  let maxNum = 0;

  for (const item of existingBacklog) {
    const match = item.id && item.id.match(todayPattern);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }

  const nextNum = String(maxNum + 1).padStart(3, '0');
  return `cap-${today}-${nextNum}`;
}

/**
 * Get current task from session state
 */
function getCurrentTask() {
  try {
    const sessionState = loadSessionState();
    return sessionState.currentTask || null;
  } catch {
    return null;
  }
}

/**
 * Extract tags from current task context
 * @param {Object|null} currentTask - Current task if any
 * @returns {string[]}
 */
function extractContextTags(currentTask) {
  if (!currentTask) return [];

  const tags = [];

  if (currentTask.feature) {
    tags.push(`#feature:${currentTask.feature}`);
  }

  // Could also extract #screen: or #component: from task description
  // if task has tags field
  if (currentTask.tags && Array.isArray(currentTask.tags)) {
    tags.push(...currentTask.tags);
  }

  return tags;
}

/**
 * Add item to backlog in ready.json
 * @param {Object} item - Backlog item to add
 */
function addToBacklog(item) {
  const readyPath = PATHS.ready;

  try {
    const ready = readJson(readyPath, {
      lastUpdated: new Date().toISOString(),
      ready: [],
      inProgress: [],
      blocked: [],
      recentlyCompleted: [],
      backlog: []
    });

    // Ensure backlog is an array (not just non-null)
    if (!Array.isArray(ready.backlog)) {
      ready.backlog = [];
    }

    // Add item
    ready.backlog.push(item);
    ready.lastUpdated = new Date().toISOString();

    // Write back
    writeJson(readyPath, ready);
  } catch (err) {
    error(`Failed to add to backlog: ${err.message}`);
    throw err;
  }
}

/**
 * Main function
 */
function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));

  // Handle help
  if (flags.help) {
    console.log(`
Usage: flow capture "<title>" [options]

Quick capture an idea or bug without interrupting flow.

Options:
  --type <type>   Force type: bug or feature (default: auto-detect)
  --tags <tags>   Comma-separated tags to add
  --json          Output JSON

Examples:
  flow capture "Add dark mode toggle"
  flow capture "Bug: login fails on Safari"
  flow capture "Fix broken image" --type bug --tags "#screen:profile"
`);
    process.exit(0);
  }

  // Validate title
  const title = positional[0];
  if (!title) {
    error('Title is required');
    console.log('Usage: flow capture "<title>"');
    process.exit(1);
  }

  // Get current task for context
  const currentTask = getCurrentTask();

  // Load existing backlog to generate ID
  const ready = readJson(PATHS.ready, { backlog: [] });
  const existingBacklog = ready.backlog || [];

  // Generate ID
  const id = generateCaptureId(existingBacklog);

  // Determine type
  const type = flags.type || detectType(title);

  // Gather tags
  let tags = extractContextTags(currentTask);
  if (flags.tags) {
    const userTags = flags.tags.split(',').map(t => t.trim()).filter(Boolean);
    tags = [...tags, ...userTags];
  }

  // Create capture item
  const item = {
    id,
    title,
    type,
    capturedAt: new Date().toISOString(),
    ...(currentTask && { capturedDuring: currentTask.id }),
    ...(tags.length > 0 && { tags })
  };

  // Add to backlog
  addToBacklog(item);

  // Output
  if (flags.json) {
    outputJson({
      success: true,
      captured: item
    });
  } else {
    success(`Captured: ${title} (${type})`);
  }
}

// Run only when executed directly
if (require.main === module) {
  main();
}

module.exports = { main, detectType, generateCaptureId, addToBacklog };
