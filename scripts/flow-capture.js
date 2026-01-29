#!/usr/bin/env node

/**
 * Wogi Flow - Quick Capture with Auto-Grouping
 *
 * Quickly capture ideas or bugs without interrupting flow.
 * Items go to backlog in ready.json for later triage.
 *
 * v2.0: Auto-grouping - related items stay together, unrelated items split
 * Inspired by Matt Maher's "do-work" pattern.
 *
 * Usage:
 *   node scripts/flow-capture.js "<title>" [--type bug|feature] [--tags tag1,tag2] [--json]
 */

const {
  PATHS,
  readJson,
  writeJson,
  parseFlags,
  outputJson,
  success,
  error,
  getConfig
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

// ============================================================
// Auto-Grouping Configuration
// ============================================================

/**
 * Get capture configuration with defaults
 * @returns {Object} Capture config
 */
function getCaptureConfig() {
  const config = getConfig();
  const defaults = {
    autoGroup: true,
    groupingThreshold: 0.5,
    maxGroupSize: 5
  };

  return {
    ...defaults,
    ...(config.capture || {})
  };
}

// ============================================================
// Multi-Item Parsing
// ============================================================

/**
 * Split multi-item input into individual items
 * Handles: comma-separated, "and", numbered lists
 *
 * @param {string} input - Raw capture input
 * @returns {string[]} Array of individual items
 */
function parseMultipleItems(input) {
  // If input is short and simple, treat as single item
  if (input.length < 30 && !input.includes(',') && !input.includes(' and ')) {
    return [input];
  }

  // Split by common delimiters
  let items = [input];

  // Split by numbered list pattern: "1. item, 2. item" or "1) item 2) item"
  if (/\d+[\.\)]\s/.test(input)) {
    items = input
      .split(/\d+[\.\)]\s+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  // Split by comma or semicolon
  else if (input.includes(',') || input.includes(';')) {
    items = input
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  // Split by " and " (but not "button and" or "login and")
  else if (/ and /i.test(input)) {
    // Only split if " and " appears to be a list delimiter
    const andCount = (input.match(/ and /gi) || []).length;
    if (andCount >= 1) {
      items = input
        .split(/ and /i)
        .map(s => s.trim())
        .filter(Boolean);
    }
  }

  return items;
}

// ============================================================
// Semantic Analysis for Grouping
// ============================================================

/**
 * Extract action type from item text
 * @param {string} text - Item text
 * @returns {string|null} Action type
 */
function extractActionType(text) {
  const lower = text.toLowerCase();

  // Color-related
  if (/\b(color|blue|red|green|white|black|gray|grey|dark|light)\b/.test(lower)) {
    return 'color';
  }

  // Size-related
  if (/\b(size|small|large|bigger|smaller|width|height|padding|margin)\b/.test(lower)) {
    return 'size';
  }

  // Text/label changes
  if (/\b(text|label|title|name|rename|word|message)\b/.test(lower)) {
    return 'text';
  }

  // Bug fix
  if (BUG_KEYWORDS.some(kw => lower.includes(kw))) {
    return 'bugfix';
  }

  // Add/create
  if (/\b(add|create|new|implement)\b/.test(lower)) {
    return 'add';
  }

  // Remove/delete
  if (/\b(remove|delete|hide|disable)\b/.test(lower)) {
    return 'remove';
  }

  // Update/change
  if (/\b(update|change|modify|edit)\b/.test(lower)) {
    return 'update';
  }

  return null;
}

/**
 * Extract component/target from item text
 * @param {string} text - Item text
 * @returns {string|null} Component/target
 */
function extractTarget(text) {
  const lower = text.toLowerCase();

  // Common UI component patterns
  const componentPatterns = [
    /\b(button|btn)\b/,
    /\b(header|footer|nav|navbar|sidebar)\b/,
    /\b(form|input|field|textarea)\b/,
    /\b(modal|dialog|popup)\b/,
    /\b(table|list|grid|card)\b/,
    /\b(menu|dropdown|select)\b/,
    /\b(tab|panel|section)\b/,
    /\b(icon|image|logo)\b/,
    /\b(link|anchor)\b/,
    /\b(toast|alert|notification)\b/
  ];

  for (const pattern of componentPatterns) {
    const match = lower.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // Check for page/screen references
  const pageMatch = lower.match(/\b(page|screen|view):\s*(\w+)/);
  if (pageMatch) {
    return `page:${pageMatch[2]}`;
  }

  return null;
}

/**
 * Calculate similarity score between two items
 * @param {Object} item1 - First item analysis
 * @param {Object} item2 - Second item analysis
 * @returns {number} Similarity score 0-1
 */
function calculateSimilarity(item1, item2) {
  let score = 0;

  // Same action type (+0.4)
  if (item1.actionType && item2.actionType && item1.actionType === item2.actionType) {
    score += 0.4;
  }

  // Same target component (+0.4)
  if (item1.target && item2.target && item1.target === item2.target) {
    score += 0.4;
  }

  // Same item type (bug/feature) (+0.2)
  if (item1.type === item2.type) {
    score += 0.2;
  }

  // Word overlap bonus
  const words1 = new Set(item1.text.toLowerCase().split(/\s+/));
  const words2 = new Set(item2.text.toLowerCase().split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w) && w.length > 3);
  if (intersection.length >= 2) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

/**
 * Analyze an item for grouping
 * @param {string} text - Item text
 * @returns {Object} Analysis result
 */
function analyzeItem(text) {
  return {
    text,
    actionType: extractActionType(text),
    target: extractTarget(text),
    type: detectType(text)
  };
}

// ============================================================
// Grouping Logic
// ============================================================

/**
 * Group related items together
 * @param {string[]} items - Array of item texts
 * @param {Object} config - Grouping configuration
 * @returns {Object[]} Array of groups, each with { title, items }
 */
function groupRelatedItems(items, config) {
  if (items.length <= 1) {
    return items.map(item => ({
      title: item,
      items: [item],
      grouped: false
    }));
  }

  // Analyze all items
  const analyzed = items.map(analyzeItem);

  // Build groups using similarity threshold
  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < analyzed.length; i++) {
    if (assigned.has(i)) continue;

    const group = {
      items: [items[i]],
      analyses: [analyzed[i]]
    };
    assigned.add(i);

    // Find similar items
    for (let j = i + 1; j < analyzed.length; j++) {
      if (assigned.has(j)) continue;
      if (group.items.length >= config.maxGroupSize) break;

      const similarity = calculateSimilarity(analyzed[i], analyzed[j]);
      if (similarity >= config.groupingThreshold) {
        group.items.push(items[j]);
        group.analyses.push(analyzed[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  // Generate titles for groups
  return groups.map(group => {
    if (group.items.length === 1) {
      return {
        title: group.items[0],
        items: group.items,
        grouped: false
      };
    }

    // Generate a combined title
    const analysis = group.analyses[0];
    let title;

    if (analysis.actionType === 'color' && analysis.target) {
      title = `Update ${analysis.target} colors`;
    } else if (analysis.actionType && analysis.target) {
      title = `${capitalize(analysis.actionType)} ${analysis.target} changes`;
    } else if (analysis.actionType) {
      title = `${capitalize(analysis.actionType)} changes (${group.items.length} items)`;
    } else if (analysis.target) {
      title = `${capitalize(analysis.target)} updates (${group.items.length} items)`;
    } else {
      title = `Related changes (${group.items.length} items)`;
    }

    return {
      title,
      items: group.items,
      grouped: true
    };
  });
}

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string}
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

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
v2.0: Now with auto-grouping - related items stay together, unrelated items split.

Options:
  --type <type>     Force type: bug or feature (default: auto-detect)
  --tags <tags>     Comma-separated tags to add
  --json            Output JSON
  --no-group        Disable auto-grouping (create separate items)

Examples:
  flow capture "Add dark mode toggle"
  flow capture "Bug: login fails on Safari"
  flow capture "Fix broken image" --type bug --tags "#screen:profile"

Multi-item examples (auto-grouped):
  flow capture "change send button to blue, change cancel button to blue"
  → ONE capture: "Update button colors"

  flow capture "fix login bug, add dark mode, update footer"
  → THREE captures (unrelated items)
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

  // Get capture config
  const captureConfig = getCaptureConfig();

  // Parse into multiple items
  const items = parseMultipleItems(title);

  // Group related items (unless disabled)
  let groups;
  if (flags['no-group'] || !captureConfig.autoGroup || items.length === 1) {
    // No grouping - each item becomes a separate capture
    groups = items.map(item => ({
      title: item,
      items: [item],
      grouped: false
    }));
  } else {
    groups = groupRelatedItems(items, captureConfig);
  }

  // Load existing backlog to generate IDs
  const ready = readJson(PATHS.ready, { backlog: [] });
  let existingBacklog = ready.backlog || [];

  // Gather tags
  let tags = extractContextTags(currentTask);
  if (flags.tags) {
    const userTags = flags.tags.split(',').map(t => t.trim()).filter(Boolean);
    tags = [...tags, ...userTags];
  }

  // Create capture items for each group
  const capturedItems = [];

  for (const group of groups) {
    const id = generateCaptureId(existingBacklog);

    // Determine type from the group's items
    const type = flags.type || detectType(group.items.join(' '));

    const item = {
      id,
      title: group.title,
      type,
      capturedAt: new Date().toISOString(),
      ...(currentTask && { capturedDuring: currentTask.id }),
      ...(tags.length > 0 && { tags }),
      ...(group.grouped && {
        groupedFrom: group.items,
        itemCount: group.items.length
      })
    };

    addToBacklog(item);
    capturedItems.push(item);

    // Update existingBacklog for next ID generation
    existingBacklog = [...existingBacklog, item];
  }

  // Output
  if (flags.json) {
    outputJson({
      success: true,
      captured: capturedItems,
      groupingApplied: groups.some(g => g.grouped),
      totalItems: items.length,
      captureCount: capturedItems.length
    });
  } else {
    if (capturedItems.length === 1) {
      const item = capturedItems[0];
      if (item.grouped) {
        success(`Captured: ${item.title} (${item.type}) - grouped ${item.itemCount} related items`);
      } else {
        success(`Captured: ${item.title} (${item.type})`);
      }
    } else {
      success(`Captured ${capturedItems.length} items:`);
      for (const item of capturedItems) {
        if (item.grouped) {
          console.log(`  • ${item.title} (${item.itemCount} items grouped)`);
        } else {
          console.log(`  • ${item.title}`);
        }
      }
    }
  }
}

// Run only when executed directly
if (require.main === module) {
  main();
}

module.exports = {
  main,
  detectType,
  generateCaptureId,
  addToBacklog,
  // Auto-grouping exports
  getCaptureConfig,
  parseMultipleItems,
  analyzeItem,
  groupRelatedItems,
  calculateSimilarity
};
