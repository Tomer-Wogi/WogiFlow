#!/usr/bin/env node

/**
 * Wogi Flow - Failure Learning System
 *
 * After execution failures, asks the executor model what information
 * was missing, then updates model profiles with learnings.
 *
 * This creates a feedback loop where:
 * 1. Task fails with executor model
 * 2. We ask the executor "what was missing?"
 * 3. Executor tells us what context it needed
 * 4. We update the model profile with this learning
 * 5. Next similar task gets better context
 *
 * Part of Hybrid Mode Intelligence System
 *
 * Usage:
 *   const { learnFromFailure, enhancePromptWithLearning } = require('./flow-failure-learning');
 *
 *   // After a failure
 *   const learning = await learnFromFailure(modelId, taskType, code, error);
 */

const fs = require('fs');
const path = require('path');
const {
  PATHS,
  PROJECT_ROOT,
  readFile,
  writeFile,
  fileExists,
  dirExists,
  info,
  warn,
  success,
  error: logError,
  parseFlags,
  outputJson,
  safeJsonParse
} = require('./flow-utils');

const { updateModelProfile, getModelProfile } = require('./flow-model-profile');
const { classifyTask } = require('./flow-task-classifier');

// ============================================================
// Configuration
// ============================================================

const LEARNINGS_DIR = path.join(PATHS.state, 'failure-learnings');
const LEARNING_CATEGORIES = {
  MISSING_IMPORTS: 'missing_imports',
  UNCLEAR_TYPES: 'unclear_types',
  MISSING_CONTEXT: 'missing_context',
  AMBIGUOUS_REQUIREMENTS: 'ambiguous_requirements',
  PATTERN_MISMATCH: 'pattern_mismatch',
  API_UNCLEAR: 'api_unclear',
  OTHER: 'other'
};

// Prompt templates for asking executor what was missing
const LEARNING_PROMPTS = {
  standard: `You generated this code:
\`\`\`
{CODE}
\`\`\`

It failed with this error:
{ERROR}

What information would have helped you avoid this mistake?
Categories:
1. Missing imports (which ones?)
2. Unclear types (which types?)
3. Missing context (what context?)
4. Ambiguous requirements (what was unclear?)

Be specific and concise. Answer in this format:
CATEGORY: [category from above]
MISSING: [specific items that were missing]
SUGGESTION: [how to improve the prompt next time]`,

  detailed: `You were asked to: {TASK}

You generated:
\`\`\`
{CODE}
\`\`\`

This failed with:
{ERROR}

Analyze what went wrong and what you needed to succeed.

1. What specific information was missing from the prompt?
2. What imports or types did you have to guess?
3. What patterns were you unsure about?
4. What would have made this task clearer?

Format your response as:
CATEGORY: [missing_imports|unclear_types|missing_context|ambiguous_requirements|pattern_mismatch|api_unclear|other]
MISSING_ITEMS: [comma-separated list of specific missing items]
CONFIDENCE_ISSUE: [what you were least confident about]
SUGGESTED_CONTEXT: [what should be included next time]`
};

// ============================================================
// Learning Response Parsing
// ============================================================

/**
 * Parse the executor's response about what was missing
 * @param {string} response - Executor's response
 * @returns {Object} - Parsed learning data
 */
function parseLearningResponse(response) {
  const learning = {
    category: LEARNING_CATEGORIES.OTHER,
    missingItems: [],
    confidenceIssue: null,
    suggestedContext: [],
    raw: response
  };

  if (!response) return learning;

  // Parse CATEGORY
  const categoryMatch = response.match(/CATEGORY:\s*([^\n]+)/i);
  if (categoryMatch) {
    const cat = categoryMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
    if (Object.values(LEARNING_CATEGORIES).includes(cat)) {
      learning.category = cat;
    } else {
      // Try to map common variations
      if (cat.includes('import')) learning.category = LEARNING_CATEGORIES.MISSING_IMPORTS;
      else if (cat.includes('type')) learning.category = LEARNING_CATEGORIES.UNCLEAR_TYPES;
      else if (cat.includes('context')) learning.category = LEARNING_CATEGORIES.MISSING_CONTEXT;
      else if (cat.includes('require') || cat.includes('ambig')) learning.category = LEARNING_CATEGORIES.AMBIGUOUS_REQUIREMENTS;
      else if (cat.includes('pattern')) learning.category = LEARNING_CATEGORIES.PATTERN_MISMATCH;
      else if (cat.includes('api')) learning.category = LEARNING_CATEGORIES.API_UNCLEAR;
    }
  }

  // Parse MISSING/MISSING_ITEMS
  const missingMatch = response.match(/MISSING(?:_ITEMS)?:\s*([^\n]+)/i);
  if (missingMatch) {
    learning.missingItems = missingMatch[1]
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length < 100);
  }

  // Parse CONFIDENCE_ISSUE
  const confidenceMatch = response.match(/CONFIDENCE_ISSUE:\s*([^\n]+)/i);
  if (confidenceMatch) {
    learning.confidenceIssue = confidenceMatch[1].trim();
  }

  // Parse SUGGESTED_CONTEXT/SUGGESTION
  const suggestionMatch = response.match(/SUGGEST(?:ED_CONTEXT|ION):\s*([^\n]+)/i);
  if (suggestionMatch) {
    learning.suggestedContext = suggestionMatch[1]
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  // Fallback: if structured parsing found nothing, try to extract useful info from free text
  if (!learning.category && learning.missingItems.length === 0) {
    // Try to find comma-separated lists after "missing" or "needed" keywords
    const fallbackMatch = response.match(/(?:missing|needed|require[sd]?)[:\s]+([^.!?\n]{10,200})/gi);
    if (fallbackMatch && fallbackMatch.length > 0) {
      for (const match of fallbackMatch) {
        const items = match
          .replace(/(?:missing|needed|require[sd]?)[:\s]+/gi, '')
          .split(/[,;]/)
          .map(s => s.trim())
          .filter(s => s.length > 2 && s.length < 100);
        learning.missingItems.push(...items);
      }
      // Deduplicate
      learning.missingItems = [...new Set(learning.missingItems)];
    }

    // Log when fallback was needed for debugging
    if (learning.missingItems.length > 0) {
      warn('Learning response used fallback parsing (structured fields not found)');
    }
  }

  return learning;
}

// ============================================================
// Learning from Failures
// ============================================================

/**
 * Learn from a failure by asking the executor what was missing
 * @param {string} modelId - Model identifier
 * @param {string} taskType - Task type (create, modify, etc.)
 * @param {string} code - Generated code that failed
 * @param {string} error - Error message
 * @param {Object} options - Additional options
 * @returns {Object} - Learning result with enhanced prompt suggestions
 */
async function learnFromFailure(modelId, taskType, code, error, options = {}) {
  const { executor, taskDescription, prompt: originalPrompt } = options;

  const result = {
    modelId,
    taskType,
    timestamp: new Date().toISOString(),
    learning: null,
    profileUpdated: false,
    enhancedPrompt: null
  };

  // Build the learning prompt
  const learningPrompt = LEARNING_PROMPTS.detailed
    .replace('{TASK}', taskDescription || 'Complete the task')
    .replace('{CODE}', truncateCode(code, 1000))
    .replace('{ERROR}', truncateError(error, 500));

  // If we have an executor, ask it what was missing
  if (executor && typeof executor.generate === 'function') {
    try {
      info('Asking executor what information was missing...');
      const response = await executor.generate(learningPrompt, { maxTokens: 500 });
      result.learning = parseLearningResponse(response);
    } catch (err) {
      warn(`Could not ask executor for learning: ${err.message}`);
      // Fall back to heuristic analysis
      result.learning = analyzeFailureHeuristically(code, error);
    }
  } else {
    // No executor available, use heuristic analysis
    result.learning = analyzeFailureHeuristically(code, error);
  }

  // Update model profile with learning
  if (result.learning) {
    try {
      updateModelProfile(modelId, {
        taskType,
        success: false,
        errorCategory: result.learning.category,
        neededContext: result.learning.missingItems.join(', '),
        failure: {
          error: truncateError(error, 50),
          missingInfo: result.learning.category,
          fixApplied: 'Pending retry'
        }
      });
      result.profileUpdated = true;
    } catch (err) {
      warn(`Could not update model profile: ${err.message}`);
    }

    // Generate enhanced prompt for retry
    result.enhancedPrompt = enhancePromptWithLearning(originalPrompt || '', result.learning);
  }

  // Save learning to disk for analysis
  saveLearning(result);

  return result;
}

/**
 * Analyze a failure heuristically when executor is not available
 * @param {string} code - Generated code
 * @param {string} error - Error message
 * @returns {Object} - Heuristic learning
 */
function analyzeFailureHeuristically(code, error) {
  const errorLower = (error || '').toLowerCase();
  const learning = {
    category: LEARNING_CATEGORIES.OTHER,
    missingItems: [],
    confidenceIssue: 'Unknown',
    suggestedContext: [],
    heuristic: true
  };

  // Detect import errors
  if (errorLower.includes('cannot find module') ||
      errorLower.includes('no exported member') ||
      errorLower.includes('is not exported')) {
    learning.category = LEARNING_CATEGORIES.MISSING_IMPORTS;

    // Extract module name
    const moduleMatch = error.match(/['"]([^'"]+)['"]/);
    if (moduleMatch) {
      learning.missingItems.push(`import from ${moduleMatch[1]}`);
    }
    learning.suggestedContext.push('Include available imports with exact paths');
  }

  // Detect type errors
  if ((errorLower.includes('type') && errorLower.includes('not assignable')) ||
      (errorLower.includes('property') && errorLower.includes('does not exist'))) {
    learning.category = LEARNING_CATEGORIES.UNCLEAR_TYPES;

    const typeMatch = error.match(/type ['"]([^'"]+)['"]/i);
    if (typeMatch) {
      learning.missingItems.push(`type definition for ${typeMatch[1]}`);
    }
    learning.suggestedContext.push('Include complete type definitions');
  }

  // Detect syntax errors (often from markdown pollution)
  if (errorLower.includes('unexpected token') ||
      errorLower.includes('parsing error')) {
    learning.category = LEARNING_CATEGORIES.PATTERN_MISMATCH;
    learning.missingItems.push('Output format clarification');
    learning.suggestedContext.push('Emphasize: output pure code only, no markdown');
  }

  // Detect API/context errors
  if (errorLower.includes('undefined') ||
      errorLower.includes('null') ||
      errorLower.includes('is not a function')) {
    learning.category = LEARNING_CATEGORIES.MISSING_CONTEXT;
    learning.missingItems.push('API or function signatures');
    learning.suggestedContext.push('Include function signatures and usage examples');
  }

  return learning;
}

/**
 * Enhance a prompt with learnings from failure
 * @param {string} originalPrompt - Original prompt
 * @param {Object} learning - Learning data
 * @returns {string} - Enhanced prompt
 */
function enhancePromptWithLearning(originalPrompt, learning) {
  if (!learning || !originalPrompt) return originalPrompt;

  const enhancements = [];

  // Add category-specific enhancements
  switch (learning.category) {
  case LEARNING_CATEGORIES.MISSING_IMPORTS:
    enhancements.push(`IMPORTANT: Your previous output had import errors.
The following imports were incorrect or missing: ${learning.missingItems.join(', ')}.
Use ONLY imports from the "Available Imports" section. Copy paths exactly.`);
    break;

  case LEARNING_CATEGORIES.UNCLEAR_TYPES:
    enhancements.push(`IMPORTANT: Your previous output had type errors.
These types were unclear: ${learning.missingItems.join(', ')}.
Match all types EXACTLY as defined. Don't add optional properties.`);
    break;

  case LEARNING_CATEGORIES.MISSING_CONTEXT:
    enhancements.push(`IMPORTANT: Your previous output referenced undefined code.
Missing context: ${learning.missingItems.join(', ')}.
Only use functions, components, and variables that are explicitly provided.`);
    break;

  case LEARNING_CATEGORIES.AMBIGUOUS_REQUIREMENTS:
    enhancements.push(`IMPORTANT: The requirements were unclear in the previous attempt.
Focus on: ${learning.confidenceIssue || 'the core requirement'}.
If unsure about any detail, use the simplest approach.`);
    break;

  case LEARNING_CATEGORIES.PATTERN_MISMATCH:
    enhancements.push(`IMPORTANT: Your previous output didn't match expected format.
Output ONLY pure code. NO markdown fences. NO explanations.
Start immediately with the first line of code.`);
    break;

  case LEARNING_CATEGORIES.API_UNCLEAR:
    enhancements.push(`IMPORTANT: API usage was incorrect in previous attempt.
Follow the API documentation exactly as shown.
Don't assume methods or parameters that aren't documented.`);
    break;

  default:
    if (learning.missingItems.length > 0) {
      enhancements.push(`NOTE: Previous attempt failed. These were missing: ${learning.missingItems.join(', ')}`);
    }
  }

  // Add suggested context
  if (learning.suggestedContext.length > 0) {
    enhancements.push(`Remember: ${learning.suggestedContext.join('. ')}`);
  }

  // Combine enhancements with original prompt
  if (enhancements.length === 0) return originalPrompt;

  return `${enhancements.join('\n\n')}

---

${originalPrompt}

---

Take care to avoid the previous mistakes.`;
}

// ============================================================
// Learning Persistence
// ============================================================

/**
 * Save learning to disk for analysis
 * @param {Object} result - Learning result
 */
function saveLearning(result) {
  if (!dirExists(LEARNINGS_DIR)) {
    try {
      fs.mkdirSync(LEARNINGS_DIR, { recursive: true });
    } catch (err) {
      return; // Can't save, not critical
    }
  }

  // Save individual learning
  const filename = `${result.timestamp.replace(/[:.]/g, '-')}-${result.modelId}.json`;
  const filepath = path.join(LEARNINGS_DIR, filename);

  try {
    writeFile(filepath, JSON.stringify(result, null, 2));
  } catch (err) {
    // Not critical
  }

  // Update aggregate stats
  updateLearningStats(result);
}

/**
 * Update aggregate learning statistics
 * @param {Object} result - Learning result
 */
function updateLearningStats(result) {
  const statsPath = path.join(LEARNINGS_DIR, 'stats.json');

  let stats = {
    totalLearnings: 0,
    byModel: {},
    byCategory: {},
    byTaskType: {},
    lastUpdated: null
  };

  if (fileExists(statsPath)) {
    stats = safeJsonParse(statsPath, stats);
  }

  // Update counts
  stats.totalLearnings++;
  stats.byModel[result.modelId] = (stats.byModel[result.modelId] || 0) + 1;
  stats.byCategory[result.learning?.category || 'other'] =
    (stats.byCategory[result.learning?.category || 'other'] || 0) + 1;
  stats.byTaskType[result.taskType || 'unknown'] =
    (stats.byTaskType[result.taskType || 'unknown'] || 0) + 1;
  stats.lastUpdated = new Date().toISOString();

  // Use atomic write (temp file + rename) to avoid race conditions
  const tempPath = `${statsPath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(stats, null, 2), 'utf-8');
    fs.renameSync(tempPath, statsPath);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    // Not critical - stats update failure won't break functionality
  }
}

/**
 * Get learning statistics
 * @returns {Object} - Learning stats
 */
function getLearningStats() {
  const statsPath = path.join(LEARNINGS_DIR, 'stats.json');
  const defaultStats = { totalLearnings: 0, byModel: {}, byCategory: {}, byTaskType: {} };

  if (!fileExists(statsPath)) {
    return defaultStats;
  }

  return safeJsonParse(statsPath, defaultStats);
}

/**
 * Get recent learnings for a model
 * @param {string} modelId - Model identifier
 * @param {number} limit - Max learnings to return
 * @returns {Object[]} - Recent learnings
 */
function getRecentLearnings(modelId, limit = 10) {
  if (!dirExists(LEARNINGS_DIR)) {
    return [];
  }

  try {
    const files = fs.readdirSync(LEARNINGS_DIR)
      .filter(f => f.endsWith('.json') && f !== 'stats.json')
      .filter(f => !modelId || f.includes(modelId))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => {
      const filePath = path.join(LEARNINGS_DIR, f);
      return safeJsonParse(filePath, null);
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

// ============================================================
// Utilities
// ============================================================

/**
 * Truncate code for learning prompt
 * @param {string} code - Code to truncate
 * @param {number} maxLength - Max length
 * @returns {string} - Truncated code
 */
function truncateCode(code, maxLength = 1000) {
  if (!code || code.length <= maxLength) return code || '';
  return code.substring(0, maxLength) + '\n... (truncated)';
}

/**
 * Truncate error message
 * @param {string} error - Error to truncate
 * @param {number} maxLength - Max length
 * @returns {string} - Truncated error
 */
function truncateError(error, maxLength = 500) {
  if (!error || error.length <= maxLength) return error || '';
  return error.substring(0, maxLength) + '...';
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
Wogi Flow - Failure Learning System

Usage: node scripts/flow-failure-learning.js <command> [options]

Commands:
  stats                    Show learning statistics
  recent [model-id]        Show recent learnings
  analyze "<error>"        Analyze an error heuristically
  categories               List learning categories

Options:
  --json                   Output as JSON
  --limit=<n>              Limit for recent learnings (default: 10)
  --help                   Show this help message

Examples:
  node scripts/flow-failure-learning.js stats
  node scripts/flow-failure-learning.js recent qwen3-coder
  node scripts/flow-failure-learning.js analyze "Cannot find module '@/components/Button'"
`);
    process.exit(0);
  }

  switch (command) {
  case 'stats': {
    const stats = getLearningStats();

    if (flags.json) {
      outputJson(stats);
      return;
    }

    console.log('\nLearning Statistics:\n');
    console.log(`  Total Learnings: ${stats.totalLearnings}`);

    if (Object.keys(stats.byModel).length > 0) {
      console.log('\n  By Model:');
      for (const [model, count] of Object.entries(stats.byModel)) {
        console.log(`    ${model}: ${count}`);
      }
    }

    if (Object.keys(stats.byCategory).length > 0) {
      console.log('\n  By Category:');
      for (const [cat, count] of Object.entries(stats.byCategory)) {
        console.log(`    ${cat}: ${count}`);
      }
    }

    if (Object.keys(stats.byTaskType).length > 0) {
      console.log('\n  By Task Type:');
      for (const [type, count] of Object.entries(stats.byTaskType)) {
        console.log(`    ${type}: ${count}`);
      }
    }

    if (stats.lastUpdated) {
      console.log(`\n  Last Updated: ${stats.lastUpdated}`);
    }
    console.log('');
    break;
  }

  case 'recent': {
    const modelId = positional[1] || null;
    const limit = parseInt(flags.limit) || 10;
    const learnings = getRecentLearnings(modelId, limit);

    if (flags.json) {
      outputJson(learnings);
      return;
    }

    if (learnings.length === 0) {
      info('No recent learnings found.');
      return;
    }

    console.log(`\nRecent Learnings${modelId ? ` for ${modelId}` : ''}:\n`);
    for (const learning of learnings) {
      console.log(`  ${learning.timestamp}:`);
      console.log(`    Model: ${learning.modelId}`);
      console.log(`    Task Type: ${learning.taskType}`);
      console.log(`    Category: ${learning.learning?.category || 'unknown'}`);
      if (learning.learning?.missingItems?.length > 0) {
        console.log(`    Missing: ${learning.learning.missingItems.join(', ')}`);
      }
      console.log('');
    }
    break;
  }

  case 'analyze': {
    const errorMsg = positional.slice(1).join(' ');
    if (!errorMsg) {
      console.error('Error: Error message required');
      process.exit(1);
    }

    const learning = analyzeFailureHeuristically('', errorMsg);

    if (flags.json) {
      outputJson(learning);
      return;
    }

    console.log('\nHeuristic Analysis:\n');
    console.log(`  Category: ${learning.category}`);
    if (learning.missingItems.length > 0) {
      console.log(`  Missing Items: ${learning.missingItems.join(', ')}`);
    }
    if (learning.suggestedContext.length > 0) {
      console.log(`  Suggestions: ${learning.suggestedContext.join(', ')}`);
    }
    console.log('');
    break;
  }

  case 'categories': {
    if (flags.json) {
      outputJson(LEARNING_CATEGORIES);
      return;
    }

    console.log('\nLearning Categories:\n');
    for (const [name, value] of Object.entries(LEARNING_CATEGORIES)) {
      console.log(`  ${name}: ${value}`);
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
  // Core learning functions
  learnFromFailure,
  analyzeFailureHeuristically,
  enhancePromptWithLearning,
  parseLearningResponse,

  // Statistics and history
  getLearningStats,
  getRecentLearnings,
  saveLearning,

  // Constants
  LEARNING_CATEGORIES,
  LEARNING_PROMPTS,
  LEARNINGS_DIR
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
