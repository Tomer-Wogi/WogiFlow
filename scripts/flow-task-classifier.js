#!/usr/bin/env node

/**
 * Wogi Flow - Task Classifier
 *
 * Classifies tasks into types: create, modify, refactor, fix, integrate
 * Uses heuristics and optional AI classification for ambiguous cases.
 *
 * Part of Hybrid Mode Intelligence System
 *
 * Usage:
 *   const { classifyTask, getTaskTypeContext } = require('./flow-task-classifier');
 *
 *   // Classify a task
 *   const type = classifyTask('Add user authentication', ['src/auth.ts']);
 *
 *   // Load context for task type
 *   const context = await getTaskTypeContext('create');
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  readFile,
  fileExists,
  info,
  warn,
  parseFlags,
  outputJson
} = require('./flow-utils');

const { getSectionsByPins } = require('./flow-section-index');

// ============================================================
// Configuration
// ============================================================

const TASK_TYPES_DIR = path.join(PATHS.state, 'task-types');

// Task type definitions with classification keywords
const TASK_TYPE_PATTERNS = {
  create: {
    keywords: [
      'create', 'add', 'new', 'implement', 'build', 'make', 'generate',
      'scaffold', 'setup', 'initialize', 'write'
    ],
    filePatterns: [
      // Files that don't exist yet are typically create tasks
      { test: 'not-exists', weight: 3 }
    ],
    contextKeywords: [
      'component', 'hook', 'service', 'util', 'page', 'screen', 'feature'
    ]
  },
  modify: {
    keywords: [
      'update', 'change', 'edit', 'modify', 'adjust', 'tweak', 'alter',
      'extend', 'enhance', 'improve', 'add to'
    ],
    filePatterns: [
      { test: 'exists', weight: 2 }
    ],
    contextKeywords: [
      'prop', 'parameter', 'option', 'field', 'behavior', 'style'
    ]
  },
  refactor: {
    keywords: [
      'refactor', 'restructure', 'reorganize', 'extract', 'simplify',
      'clean up', 'rename', 'move', 'split', 'merge', 'consolidate'
    ],
    filePatterns: [
      { test: 'multi-file', weight: 2 }
    ],
    contextKeywords: [
      'structure', 'architecture', 'pattern', 'duplicate', 'complexity'
    ]
  },
  fix: {
    keywords: [
      'fix', 'bug', 'error', 'issue', 'problem', 'broken', 'failing',
      'crash', 'debug', 'repair', 'resolve', 'patch'
    ],
    filePatterns: [],
    contextKeywords: [
      'error', 'exception', 'fail', 'wrong', 'incorrect', 'regression'
    ]
  },
  integrate: {
    keywords: [
      'integrate', 'connect', 'wire', 'hook up', 'link', 'combine',
      'api', 'service', 'endpoint', 'fetch', 'sync'
    ],
    filePatterns: [
      { test: 'multi-file', weight: 1 }
    ],
    contextKeywords: [
      'api', 'service', 'endpoint', 'database', 'external', 'third-party'
    ]
  }
};

// ============================================================
// Task Classification
// ============================================================

/**
 * Classify task type based on description and affected files
 * @param {string} taskDescription - Task description
 * @param {string[]} affectedFiles - List of files that will be affected
 * @param {Object} options - Classification options
 * @returns {Object} - Classification result with type and confidence
 */
function classifyTask(taskDescription, affectedFiles = [], options = {}) {
  const descLower = taskDescription.toLowerCase();
  const scores = {};

  // Initialize scores
  for (const type of Object.keys(TASK_TYPE_PATTERNS)) {
    scores[type] = 0;
  }

  // Score based on keywords
  for (const [type, patterns] of Object.entries(TASK_TYPE_PATTERNS)) {
    // Primary keywords (high weight)
    for (const keyword of patterns.keywords) {
      if (descLower.includes(keyword.toLowerCase())) {
        scores[type] += 2;
      }
    }

    // Context keywords (medium weight)
    for (const keyword of patterns.contextKeywords) {
      if (descLower.includes(keyword.toLowerCase())) {
        scores[type] += 1;
      }
    }
  }

  // Score based on file patterns
  if (affectedFiles.length > 0) {
    const existingFiles = affectedFiles.filter(f => {
      const fullPath = path.isAbsolute(f) ? f : path.join(PROJECT_ROOT, f);
      return fs.existsSync(fullPath);
    });

    const newFiles = affectedFiles.filter(f => {
      const fullPath = path.isAbsolute(f) ? f : path.join(PROJECT_ROOT, f);
      return !fs.existsSync(fullPath);
    });

    // New files suggest 'create'
    if (newFiles.length > 0 && existingFiles.length === 0) {
      scores.create += 3;
    }

    // Existing files suggest 'modify'
    if (existingFiles.length > 0 && newFiles.length === 0) {
      scores.modify += 2;
    }

    // Multiple files suggest 'refactor' or 'integrate'
    if (affectedFiles.length > 2) {
      scores.refactor += 1;
      scores.integrate += 1;
    }
  }

  // Apply special rules
  applySpecialRules(descLower, scores);

  // Find the highest scoring type
  const sortedTypes = Object.entries(scores)
    .sort((a, b) => b[1] - a[1]);

  const [topType, topScore] = sortedTypes[0];
  const [secondType, secondScore] = sortedTypes[1] || ['none', 0];

  // Calculate confidence
  let confidence = 'high';
  if (topScore === 0) {
    confidence = 'low';
  } else if (topScore - secondScore <= 1) {
    confidence = 'medium';
  }

  return {
    type: topType,
    confidence,
    scores,
    topScore,
    alternatives: sortedTypes.slice(1, 3).map(([t, s]) => ({ type: t, score: s }))
  };
}

/**
 * Apply special classification rules
 * @param {string} descLower - Lowercase task description
 * @param {Object} scores - Score object to modify
 */
function applySpecialRules(descLower, scores) {
  // "Add X to Y" pattern usually means modify
  if (/add \w+ to/.test(descLower)) {
    scores.modify += 2;
    scores.create -= 1;
  }

  // Error/bug keywords strongly indicate fix
  if (/error|bug|fix|broken|crash|fail/i.test(descLower)) {
    scores.fix += 3;
  }

  // "Rename" or "move" strongly indicates refactor
  if (/rename|move files?|reorganize/.test(descLower)) {
    scores.refactor += 3;
  }

  // API/service keywords suggest integrate
  if (/api|endpoint|service|fetch|connect to/.test(descLower)) {
    scores.integrate += 2;
  }

  // "New" or "create" with a noun strongly indicates create
  if (/(?:create|new|add|implement) (?:a )?(?:new )?\w+(?:component|hook|service|util|page)/i.test(descLower)) {
    scores.create += 3;
  }
}

// ============================================================
// Task Type Context Loading
// ============================================================

/**
 * Load context for a task type using PIN-based lookup
 * @param {string} taskType - Task type (create, modify, refactor, fix, integrate)
 * @returns {Object} - Task type context
 */
async function getTaskTypeContext(taskType) {
  // Security: Validate taskType against whitelist to prevent path traversal
  const validTaskTypes = Object.keys(TASK_TYPE_PATTERNS);
  if (!taskType || !validTaskTypes.includes(taskType)) {
    warn(`Invalid task type: ${taskType}. Must be one of: ${validTaskTypes.join(', ')}`);
    return {
      type: taskType || 'unknown',
      sections: [],
      requiredContext: [],
      priority: [],
      successIndicators: [],
      commonFailures: [],
      error: `Invalid task type: ${taskType}`
    };
  }

  const context = {
    type: taskType,
    sections: [],
    requiredContext: [],
    priority: [],
    successIndicators: [],
    commonFailures: []
  };

  // Try to load from PIN system
  try {
    const pins = [`task-${taskType}-context`, `task-${taskType}-priority`];
    context.sections = getSectionsByPins(pins);

    // Extract structured data from sections
    for (const section of context.sections) {
      if (section.id?.includes('context')) {
        context.requiredContext = extractListItems(section.content);
      }
      if (section.id?.includes('priority')) {
        context.priority = extractListItems(section.content);
      }
    }
  } catch (err) {
    // PIN-based loading is optional, fall back to file-based loading
    // Log at debug level since this is expected when PIN system isn't initialized
    if (err.message && !err.message.includes('not found') && !err.message.includes('Index not found')) {
      warn(`PIN-based context loading failed (falling back to file): ${err.message}`);
    }
  }

  // Also try to load from task-types directory
  const typePath = path.join(TASK_TYPES_DIR, `${taskType}.md`);
  if (fileExists(typePath)) {
    try {
      const content = readFile(typePath);
      context.raw = content;

      // Parse success indicators
      const successMatch = content.match(/## Success Indicators[\s\S]*?(?=##|$)/);
      if (successMatch) {
        context.successIndicators = extractListItems(successMatch[0]);
      }

      // Parse common failures
      const failuresMatch = content.match(/## Common Failures[\s\S]*?(?=##|$)/);
      if (failuresMatch) {
        context.commonFailures = extractTableRows(failuresMatch[0]);
      }
    } catch (err) {
      warn(`Error loading task type context: ${err.message}`);
    }
  }

  return context;
}

/**
 * Extract list items from markdown content
 * @param {string} content - Markdown content
 * @returns {string[]} - List items
 */
function extractListItems(content) {
  const matches = content.match(/^[-*]\s+\*?\*?([^*\n]+)\*?\*?/gm);
  if (!matches) return [];

  return matches.map(m =>
    m.replace(/^[-*]\s+/, '')
      .replace(/\*\*/g, '')
      .trim()
  ).filter(Boolean);
}

/**
 * Extract table rows from markdown content
 * @param {string} content - Markdown content
 * @returns {Object[]} - Table rows as objects
 */
function extractTableRows(content) {
  const rows = [];
  const lines = content.split('\n');

  let headers = null;
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;

    const cells = line.split('|')
      .map(c => c.trim())
      .filter(Boolean);

    if (!headers) {
      headers = cells.map(h => h.toLowerCase().replace(/\s+/g, '_'));
      continue;
    }

    const row = {};
    cells.forEach((cell, i) => {
      if (headers[i]) {
        row[headers[i]] = cell;
      }
    });
    rows.push(row);
  }

  return rows;
}

// ============================================================
// Batch Classification
// ============================================================

/**
 * Classify multiple tasks and return statistics
 * @param {Object[]} tasks - Array of { description, files } objects
 * @returns {Object} - Classification results and statistics
 */
function classifyTasks(tasks) {
  const results = [];
  const stats = {
    total: tasks.length,
    byType: {},
    byConfidence: { high: 0, medium: 0, low: 0 }
  };

  for (const task of tasks) {
    const classification = classifyTask(
      task.description || task.title || '',
      task.files || task.affectedFiles || []
    );

    results.push({
      ...task,
      classification
    });

    // Update stats
    const type = classification.type;
    stats.byType[type] = (stats.byType[type] || 0) + 1;
    stats.byConfidence[classification.confidence]++;
  }

  return { results, stats };
}

// ============================================================
// Context Recommendation
// ============================================================

/**
 * Get recommended context based on task classification
 * @param {string} taskDescription - Task description
 * @param {string[]} affectedFiles - Affected files
 * @returns {Object} - Context recommendation
 */
async function getContextRecommendation(taskDescription, affectedFiles = []) {
  const classification = classifyTask(taskDescription, affectedFiles);
  const taskContext = await getTaskTypeContext(classification.type);

  return {
    classification,
    taskContext,
    recommendedPins: [
      `task-${classification.type}`,
      `task-${classification.type}-context`
    ],
    priorityContext: taskContext.priority || [],
    warnings: classification.confidence === 'low'
      ? ['Low confidence classification - consider providing more context']
      : []
  };
}

// ============================================================
// CLI Interface
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseFlags(args);
  const command = positional[0];

  if (flags.help || !command) {
    console.log(`
Wogi Flow - Task Classifier

Usage: node scripts/flow-task-classifier.js <command> [options]

Commands:
  classify "<description>"    Classify a single task
  context <type>             Load context for a task type
  types                      List all task types with descriptions

Options:
  --files=<file1,file2>      Affected files (comma-separated)
  --json                     Output as JSON
  --help                     Show this help message

Task Types:
  create    - Creating new files/components
  modify    - Editing existing files
  refactor  - Structural changes
  fix       - Bug fixes and error resolution
  integrate - Connecting systems/services

Examples:
  node scripts/flow-task-classifier.js classify "Add user authentication"
  node scripts/flow-task-classifier.js classify "Fix login bug" --files=src/auth.ts
  node scripts/flow-task-classifier.js context create --json
`);
    process.exit(0);
  }

  switch (command) {
  case 'classify': {
    const description = positional.slice(1).join(' ');
    if (!description) {
      console.error('Error: Task description required');
      process.exit(1);
    }

    const files = flags.files ? flags.files.split(',') : [];
    const result = classifyTask(description, files);

    if (flags.json) {
      outputJson(result);
      return;
    }

    console.log(`\nTask Classification:\n`);
    console.log(`  Type: ${result.type}`);
    console.log(`  Confidence: ${result.confidence}`);
    console.log(`  Score: ${result.topScore}`);

    if (result.alternatives.length > 0) {
      console.log(`\n  Alternatives:`);
      for (const alt of result.alternatives) {
        if (alt.score > 0) {
          console.log(`    - ${alt.type} (score: ${alt.score})`);
        }
      }
    }
    console.log('');
    break;
  }

  case 'context': {
    const taskType = positional[1];
    if (!taskType) {
      console.error('Error: Task type required');
      process.exit(1);
    }

    if (!TASK_TYPE_PATTERNS[taskType]) {
      console.error(`Error: Unknown task type: ${taskType}`);
      console.error(`Valid types: ${Object.keys(TASK_TYPE_PATTERNS).join(', ')}`);
      process.exit(1);
    }

    const context = await getTaskTypeContext(taskType);

    if (flags.json) {
      outputJson(context);
      return;
    }

    console.log(`\nContext for "${taskType}" tasks:\n`);

    if (context.requiredContext.length > 0) {
      console.log('Required Context:');
      for (const item of context.requiredContext) {
        console.log(`  - ${item}`);
      }
    }

    if (context.priority.length > 0) {
      console.log('\nPriority Order:');
      context.priority.forEach((item, i) => {
        console.log(`  ${i + 1}. ${item}`);
      });
    }

    if (context.successIndicators.length > 0) {
      console.log('\nSuccess Indicators:');
      for (const item of context.successIndicators) {
        console.log(`  - ${item}`);
      }
    }
    console.log('');
    break;
  }

  case 'types': {
    if (flags.json) {
      outputJson(Object.keys(TASK_TYPE_PATTERNS).map(type => ({
        type,
        keywords: TASK_TYPE_PATTERNS[type].keywords.slice(0, 5)
      })));
      return;
    }

    console.log('\nTask Types:\n');
    for (const [type, patterns] of Object.entries(TASK_TYPE_PATTERNS)) {
      console.log(`  ${type}:`);
      console.log(`    Keywords: ${patterns.keywords.slice(0, 5).join(', ')}...`);
      console.log('');
    }
    break;
  }

  case 'recommend': {
    const description = positional.slice(1).join(' ');
    if (!description) {
      console.error('Error: Task description required');
      process.exit(1);
    }

    const files = flags.files ? flags.files.split(',') : [];
    const recommendation = await getContextRecommendation(description, files);

    if (flags.json) {
      outputJson(recommendation);
      return;
    }

    console.log(`\nContext Recommendation:\n`);
    console.log(`  Task Type: ${recommendation.classification.type}`);
    console.log(`  Confidence: ${recommendation.classification.confidence}`);
    console.log(`\n  Recommended PINs: ${recommendation.recommendedPins.join(', ')}`);

    if (recommendation.priorityContext.length > 0) {
      console.log('\n  Priority Context:');
      recommendation.priorityContext.slice(0, 5).forEach((item, i) => {
        console.log(`    ${i + 1}. ${item}`);
      });
    }

    if (recommendation.warnings.length > 0) {
      console.log('\n  Warnings:');
      for (const warning of recommendation.warnings) {
        console.log(`    ! ${warning}`);
      }
    }
    console.log('');
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Classification
  classifyTask,
  classifyTasks,

  // Context loading
  getTaskTypeContext,
  getContextRecommendation,

  // Utilities
  extractListItems,
  extractTableRows,

  // Constants
  TASK_TYPE_PATTERNS,
  TASK_TYPES_DIR
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
