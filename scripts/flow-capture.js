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

const fs = require('fs');
const path = require('path');
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
// Configuration
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
    maxGroupSize: 5,
    routing: {
      enabled: true,
      defaultCertainty: 'certain',
      autoDetect: true
    }
  };

  const captureConfig = config.capture || {};
  return {
    ...defaults,
    ...captureConfig,
    routing: {
      ...defaults.routing,
      ...(captureConfig.routing || {})
    }
  };
}

// ============================================================
// Certainty Detection & Routing (v2.1)
// ============================================================

/**
 * Signals that indicate uncertainty
 */
const UNCERTAINTY_SIGNALS = [
  /\?$/,                    // Ends with question mark
  /\bmaybe\b/i,            // Contains "maybe"
  /\bshould we\b/i,        // "Should we..."
  /\bconsider\b/i,         // Contains "consider"
  /\bwhat if\b/i,          // "What if..."
  /\bmight\b/i,            // Contains "might"
  /\bcould we\b/i,         // Contains "could we"
  /\bperhaps\b/i,          // Contains "perhaps"
  /\bwondering\b/i,        // Contains "wondering"
  /\bthinking about\b/i,   // "Thinking about..."
];

/**
 * Detect certainty level from text
 * @param {string} text - Capture text
 * @returns {'certain' | 'uncertain'}
 */
function detectCertainty(text) {
  for (const signal of UNCERTAINTY_SIGNALS) {
    if (signal.test(text)) {
      return 'uncertain';
    }
  }
  return 'certain';
}

/**
 * Add item to discussion queue for uncertain ideas
 * @param {Object} item - Capture item
 */
function addToDiscussionQueue(item) {
  const queuePath = path.join(PATHS.state, 'discussion-queue.md');

  // Initialize or read existing queue
  let content;
  try {
    content = fs.readFileSync(queuePath, 'utf-8');
  } catch {
    content = `# Discussion Queue

Ideas that need review before becoming tasks.

## Pending Review

<!-- New items are added under today's date -->

## Reviewed

<!-- Moved items go here with decision -->
`;
  }

  // Format today's date
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().slice(0, 5);

  // Find or create today's section
  const todayHeader = `### ${today}`;
  const todayEntry = `- [ ] ${item.title} (captured: ${time})${item.groupedFrom ? ` [${item.groupedFrom.length} items]` : ''}`;

  if (content.includes(todayHeader)) {
    // Add under today's section
    // Escape special regex characters in todayHeader (date is safe but be defensive)
    const escapedHeader = todayHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(
      new RegExp(`(${escapedHeader}\\n)`, 'g'),
      `$1${todayEntry}\n`
    );
  } else {
    // Create today's section after "## Pending Review"
    content = content.replace(
      '## Pending Review\n',
      `## Pending Review\n\n${todayHeader}\n${todayEntry}\n`
    );
  }

  try {
    fs.writeFileSync(queuePath, content, 'utf-8');
  } catch (err) {
    error(`Failed to write discussion queue: ${err.message}`);
    throw err;
  }
}

/**
 * Add item to roadmap for certain ideas
 * @param {Object} item - Capture item
 */
function addToRoadmap(item) {
  const roadmapPath = path.join(PATHS.workflow, 'roadmap.md');

  // Initialize or read existing roadmap
  let content;
  try {
    content = fs.readFileSync(roadmapPath, 'utf-8');
  } catch {
    content = `# Roadmap

Planned features and improvements.

## Captured Ideas

<!-- Quick captures that have been marked as certain -->

## Future Work

<!-- Deferred work from previous sessions -->
`;
  }

  // Format entry
  const today = new Date().toISOString().split('T')[0];
  const entry = `\n### ${item.title}\n\n**Captured:** ${today}\n**Type:** ${item.type}\n**Status:** Pending story creation\n${item.groupedFrom ? `**Items:** ${item.groupedFrom.join(', ')}\n` : ''}`;

  // Add under "## Captured Ideas"
  if (content.includes('## Captured Ideas')) {
    content = content.replace(
      '## Captured Ideas\n',
      `## Captured Ideas\n${entry}`
    );
  } else {
    content += `\n## Captured Ideas\n${entry}`;
  }

  try {
    fs.writeFileSync(roadmapPath, content, 'utf-8');
  } catch (err) {
    error(`Failed to write roadmap: ${err.message}`);
    throw err;
  }
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
v2.1: Auto-grouping + Routing (certain → roadmap, uncertain → discussion queue)

Options:
  --type <type>     Force type: bug or feature (default: auto-detect)
  --tags <tags>     Comma-separated tags to add
  --json            Output JSON
  --no-group        Disable auto-grouping (create separate items)
  --certain         Force routing to roadmap (create story)
  --idea            Force routing to discussion queue (uncertain idea)
  --no-route        Disable routing, just add to backlog

Routing (v2.1):
  Certain ideas (explicit action) → Roadmap + story creation
  Uncertain ideas (questions, "maybe") → Discussion queue

  Auto-detected uncertainty signals:
    - Question marks: "should we add GraphQL?"
    - Hedging words: "maybe", "might", "could", "perhaps"
    - Tentative phrases: "what if", "should we", "thinking about"

Examples:
  flow capture "Add dark mode toggle"
  → Certain (explicit action) → Roadmap

  flow capture "should we maybe use GraphQL?"
  → Uncertain (question + "maybe") → Discussion queue

  flow capture "refactor auth" --certain
  → Forced to roadmap

  flow capture "add caching" --idea
  → Forced to discussion queue
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

  // Determine routing
  const routingEnabled = captureConfig.routing.enabled && !flags['no-route'];

  // Create capture items for each group
  const capturedItems = [];
  const routingResults = { roadmap: [], discussion: [], backlog: [] };

  for (const group of groups) {
    const id = generateCaptureId(existingBacklog);

    // Determine type from the group's items
    const type = flags.type || detectType(group.items.join(' '));

    // Determine certainty
    let certainty;
    if (flags.certain) {
      certainty = 'certain';
    } else if (flags.idea) {
      certainty = 'uncertain';
    } else if (captureConfig.routing.autoDetect) {
      certainty = detectCertainty(group.items.join(' '));
    } else {
      certainty = captureConfig.routing.defaultCertainty;
    }

    const item = {
      id,
      title: group.title,
      type,
      certainty,
      capturedAt: new Date().toISOString(),
      ...(currentTask && { capturedDuring: currentTask.id }),
      ...(tags.length > 0 && { tags }),
      ...(group.grouped && {
        groupedFrom: group.items,
        itemCount: group.items.length
      })
    };

    // Route based on certainty
    if (routingEnabled) {
      if (certainty === 'certain') {
        addToRoadmap(item);
        routingResults.roadmap.push(item);
      } else {
        addToDiscussionQueue(item);
        routingResults.discussion.push(item);
      }
    } else {
      // Fallback to backlog
      addToBacklog(item);
      routingResults.backlog.push(item);
    }

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
      routingApplied: routingEnabled,
      routing: routingResults,
      totalItems: items.length,
      captureCount: capturedItems.length
    });
  } else {
    if (capturedItems.length === 1) {
      const item = capturedItems[0];
      const destination = item.certainty === 'certain' ? 'roadmap' : 'discussion queue';
      const destLabel = routingEnabled ? ` → ${destination}` : '';
      if (item.grouped) {
        success(`Captured: ${item.title} (${item.type})${destLabel} - grouped ${item.itemCount} related items`);
      } else {
        success(`Captured: ${item.title} (${item.type})${destLabel}`);
      }
    } else {
      success(`Captured ${capturedItems.length} items:`);
      for (const item of capturedItems) {
        const destination = item.certainty === 'certain' ? '→ roadmap' : '→ discussion';
        const destLabel = routingEnabled ? ` ${destination}` : '';
        if (item.grouped) {
          console.log(`  • ${item.title} (${item.itemCount} items grouped)${destLabel}`);
        } else {
          console.log(`  • ${item.title}${destLabel}`);
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
  calculateSimilarity,
  // Routing exports (v2.1)
  detectCertainty,
  addToDiscussionQueue,
  addToRoadmap
};
