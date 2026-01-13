#!/usr/bin/env node

/**
 * Wogi Flow - Context Orchestrator
 *
 * Enables targeted context loading for tasks using the PIN system.
 * Supports orchestrator pattern where cheaper models (Haiku) gather
 * relevant context for expensive models (Opus).
 *
 * Features:
 * - PIN-based section lookup
 * - Task description to relevant sections mapping
 * - Token-aware context truncation
 * - Product context integration
 *
 * Usage:
 *   const { getTargetedContext } = require('./flow-context-orchestrator');
 *   const context = await getTargetedContext({ task: "Add user auth" });
 */

const path = require('path');
const {
  PATHS,
  fileExists,
  readFile,
  parseFlags,
  outputJson,
  info,
  warn,
  safeJsonParse
} = require('./flow-utils');

const {
  getSectionsForTask,
  getSectionsByPins,
  formatSectionsAsContext,
  formatSectionsAsReferences
} = require('./flow-section-resolver');

// ============================================================
// Configuration
// ============================================================

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;

// Default limits
const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_SECTION_LIMIT = 10;

// ============================================================
// Token Estimation
// ============================================================

/**
 * Estimate token count for a string
 * @param {string} text - Text to estimate
 * @returns {number} - Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate sections to fit within token limit
 * @param {Object[]} sections - Sections to truncate
 * @param {number} maxTokens - Max tokens
 * @returns {Object[]} - Truncated sections
 */
function truncateToTokenLimit(sections, maxTokens) {
  const result = [];
  let currentTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content || '');

    if (currentTokens + sectionTokens <= maxTokens) {
      result.push(section);
      currentTokens += sectionTokens;
    } else if (result.length === 0) {
      // Always include at least one section, even if truncated
      const availableChars = (maxTokens - currentTokens) * CHARS_PER_TOKEN;
      result.push({
        ...section,
        content: (section.content || '').substring(0, availableChars) + '...[truncated]',
        truncated: true
      });
      break;
    } else {
      break;
    }
  }

  return result;
}

// ============================================================
// Section Merging
// ============================================================

/**
 * Merge and deduplicate sections from multiple sources
 * @param {Object[][]} sectionArrays - Arrays of sections to merge
 * @returns {Object[]} - Merged and deduplicated sections
 */
function mergeSections(...sectionArrays) {
  const seen = new Map();

  for (const sections of sectionArrays) {
    for (const section of sections) {
      if (!seen.has(section.id)) {
        seen.set(section.id, section);
      } else {
        // Keep the one with higher score
        const existing = seen.get(section.id);
        const existingScore = existing.score || existing.matchScore || 0;
        const newScore = section.score || section.matchScore || 0;
        if (newScore > existingScore) {
          seen.set(section.id, section);
        }
      }
    }
  }

  return Array.from(seen.values());
}

// ============================================================
// Product Context
// ============================================================

/**
 * Get product context from product.md
 * @param {Object} options - { format: 'full' | 'summary' }
 * @returns {Object|null} - Product context or null
 */
async function getProductContext(options = {}) {
  const { format = 'summary' } = options;
  const productPath = path.join(PATHS.specs, 'product.md');

  if (!fileExists(productPath)) {
    return null;
  }

  try {
    // Get product sections via PINs
    const productPins = ['product-name', 'target-users', 'value-prop', 'core-features'];
    const sections = await getSectionsByPins(productPins, { limit: 5 });

    if (sections.length === 0) {
      // Fall back to reading the file directly
      const content = readFile(productPath);
      return {
        context: content,
        source: 'file',
        tokenEstimate: estimateTokens(content)
      };
    }

    const context = formatSectionsAsContext(sections, { format });
    return {
      context,
      sections: sections.map(s => s.id),
      source: 'pins',
      tokenEstimate: estimateTokens(context)
    };
  } catch (err) {
    warn(`Error loading product context: ${err.message}`);
    return null;
  }
}

/**
 * Get product overview (name, tagline, type only)
 * @returns {Object|null} - Brief product info
 */
function getProductOverview() {
  const productPath = path.join(PATHS.specs, 'product.md');

  if (!fileExists(productPath)) {
    return null;
  }

  try {
    const content = readFile(productPath);

    // Extract key fields using regex
    const nameMatch = content.match(/\*\*Name\*\*:\s*(.+)/);
    const taglineMatch = content.match(/\*\*Tagline\*\*:\s*(.+)/);
    const typeMatch = content.match(/\*\*Type\*\*:\s*(.+)/);

    return {
      name: nameMatch ? nameMatch[1].trim() : null,
      tagline: taglineMatch ? taglineMatch[1].trim() : null,
      type: typeMatch ? typeMatch[1].trim() : null
    };
  } catch (err) {
    return null;
  }
}

// ============================================================
// Main Context Gathering
// ============================================================

/**
 * Get targeted context for a task
 * @param {Object} options
 * @param {string} options.task - Task description
 * @param {string[]} options.pins - Explicit pins to include
 * @param {number} options.maxTokens - Max tokens for context
 * @param {string} options.format - 'full' | 'summary' | 'reference'
 * @param {boolean} options.includeProduct - Include product context
 * @returns {Object} - { context, sections, tokenEstimate }
 */
async function getTargetedContext(options = {}) {
  const {
    task = '',
    pins = [],
    maxTokens = DEFAULT_MAX_TOKENS,
    format = 'full',
    includeProduct = true
  } = options;

  // Get sections by task description
  let taskSections = [];
  if (task) {
    taskSections = await getSectionsForTask(task, {
      limit: DEFAULT_SECTION_LIMIT
    });
  }

  // Get sections by explicit pins
  let pinSections = [];
  if (pins.length > 0) {
    pinSections = await getSectionsByPins(pins, {
      limit: Math.floor(DEFAULT_SECTION_LIMIT / 2)
    });
  }

  // Merge and deduplicate (pass arrays separately as intended by mergeSections)
  const mergedSections = mergeSections(taskSections, pinSections);

  // Calculate available tokens for sections
  let availableTokens = maxTokens;
  let productContextResult = null;

  // Include product context if requested
  if (includeProduct) {
    productContextResult = await getProductContext({ format: 'summary' });
    if (productContextResult) {
      availableTokens -= productContextResult.tokenEstimate;
    }
  }

  // Truncate sections to fit
  const truncatedSections = truncateToTokenLimit(mergedSections, availableTokens);

  // Format sections
  const sectionsContext = formatSectionsAsContext(truncatedSections, { format });

  // Combine contexts
  let fullContext = '';
  if (productContextResult) {
    fullContext += '## Product Context\n\n' + productContextResult.context + '\n\n';
  }
  if (sectionsContext) {
    fullContext += sectionsContext;
  }

  return {
    context: fullContext.trim(),
    sections: truncatedSections.map(s => ({
      id: s.id,
      score: s.score || s.matchScore || 0,
      truncated: s.truncated || false
    })),
    productIncluded: !!productContextResult,
    tokenEstimate: estimateTokens(fullContext)
  };
}

/**
 * Get context for a specific task ID
 * Loads task details and gathers relevant context
 * @param {string} taskId - Task ID (e.g., "wf-abc123")
 * @returns {Object} - Task context
 */
async function getContextForTaskId(taskId) {
  // Try to find task in ready.json
  const readyPath = path.join(PATHS.state, 'ready.json');
  if (!fileExists(readyPath)) {
    return getTargetedContext({ task: taskId });
  }

  const ready = safeJsonParse(readyPath, {});
  const allTasks = [
    ...(ready.ready || []),
    ...(ready.inProgress || []),
    ...(ready.blocked || [])
  ];

  const task = allTasks.find(t =>
    (typeof t === 'string' && t === taskId) ||
    (typeof t === 'object' && t.id === taskId)
  );

  if (task && typeof task === 'object' && task.title) {
    return getTargetedContext({
      task: `${task.title} ${task.description || ''}`,
      pins: task.tags || []
    });
  }

  return getTargetedContext({ task: taskId });
}

/**
 * Get minimal context references (for orchestrator hints)
 * @param {string} task - Task description
 * @returns {string} - Reference string
 */
async function getContextReferences(task) {
  const sections = await getSectionsForTask(task, { limit: 5 });
  return formatSectionsAsReferences(sections);
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const { args, flags } = parseFlags(process.argv.slice(2));

  if (flags.help) {
    console.log(`
Usage: node scripts/flow-context-orchestrator.js [command] [options]

Get targeted context for tasks using the PIN system.

Commands:
  task "<description>"   Get context for a task description
  taskid <id>            Get context for a task ID
  product                Get product context only
  refs "<description>"   Get section references only

Options:
  --max-tokens <n>       Max tokens for context (default: 8000)
  --format <type>        Output format: full, summary, reference
  --no-product           Exclude product context
  --json                 Output as JSON
  --help                 Show this help

Examples:
  node scripts/flow-context-orchestrator.js task "Add user authentication"
  node scripts/flow-context-orchestrator.js taskid wf-abc123 --json
  node scripts/flow-context-orchestrator.js product --format summary
`);
    process.exit(0);
  }

  const command = args[0];
  const maxTokens = parseInt(flags['max-tokens']) || DEFAULT_MAX_TOKENS;
  const format = flags.format || 'full';
  const includeProduct = flags.product !== false;

  switch (command) {
    case 'task': {
      const task = args.slice(1).join(' ');
      if (!task) {
        console.error('Usage: flow-context-orchestrator task "<description>"');
        process.exit(1);
      }

      const result = await getTargetedContext({
        task,
        maxTokens,
        format,
        includeProduct
      });

      if (flags.json) {
        outputJson(result);
      } else {
        console.log(result.context);
        console.log(`\n--- ${result.sections.length} sections, ~${result.tokenEstimate} tokens ---`);
      }
      break;
    }

    case 'taskid': {
      const taskId = args[1];
      if (!taskId) {
        console.error('Usage: flow-context-orchestrator taskid <id>');
        process.exit(1);
      }

      const result = await getContextForTaskId(taskId);

      if (flags.json) {
        outputJson(result);
      } else {
        console.log(result.context);
        console.log(`\n--- ${result.sections.length} sections, ~${result.tokenEstimate} tokens ---`);
      }
      break;
    }

    case 'product': {
      const result = await getProductContext({ format });

      if (!result) {
        console.log('No product.md found');
        process.exit(1);
      }

      if (flags.json) {
        outputJson(result);
      } else {
        console.log(result.context);
      }
      break;
    }

    case 'refs': {
      const task = args.slice(1).join(' ');
      if (!task) {
        console.error('Usage: flow-context-orchestrator refs "<description>"');
        process.exit(1);
      }

      const refs = await getContextReferences(task);
      console.log(refs || 'No relevant sections found');
      break;
    }

    default:
      console.error('Unknown command. Use --help for usage.');
      process.exit(1);
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Main functions
  getTargetedContext,
  getContextForTaskId,
  getContextReferences,

  // Product context
  getProductContext,
  getProductOverview,

  // Utilities
  estimateTokens,
  truncateToTokenLimit,
  mergeSections
};

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
