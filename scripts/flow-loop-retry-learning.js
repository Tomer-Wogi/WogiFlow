#!/usr/bin/env node

/**
 * Wogi Flow - Loop Retry Learning
 *
 * Analyzes completed sessions that took >3 iterations to identify
 * patterns and suggest improvements to prevent similar issues.
 *
 * Integration:
 * - Hooks into archiveDurableSession() after task completion
 * - Categorizes root causes from step failure history
 * - Stores learnings in adaptive-learning.json
 * - Suggests updates to decisions.md / patterns
 */

const fs = require('fs');
const path = require('path');
const { getConfig, getProjectRoot, colors } = require('./flow-utils');
const { FailureCategory, detectCategory } = require('../.workflow/lib/failure-categories');

const PROJECT_ROOT = getProjectRoot();
const LEARNING_LOG_PATH = path.join(PROJECT_ROOT, '.workflow', 'state', 'adaptive-learning.json');

// ============================================================================
// Root Cause Categories
// ============================================================================

/**
 * Root cause categories for high-iteration tasks
 *
 * Uses centralized FailureCategory for patterns, adds suggestion/targetFile
 * for workflow improvement recommendations.
 */
const ROOT_CAUSE_CATEGORIES = {
  MISSING_CONTEXT: {
    // Use centralized patterns
    ...FailureCategory.MISSING_CONTEXT,
    // Add loop-retry specific fields
    suggestion: 'Load more context files before implementation',
    targetFile: 'decisions.md'
  },
  VALIDATION_FAILURES: {
    // Combines TYPE_ERROR and PATTERN_VIOLATION patterns
    patterns: [
      ...FailureCategory.TYPE_ERROR.patterns,
      ...FailureCategory.PATTERN_VIOLATION.patterns
    ],
    description: 'Repeated lint/type errors',
    severity: FailureCategory.TYPE_ERROR.severity,
    escalate: false,
    strategy: 'type_fix',
    suggestion: 'Check type definitions before editing',
    targetFile: 'decisions.md'
  },
  INCOMPLETE_REQUIREMENTS: {
    ...FailureCategory.INCOMPLETE_REQUIREMENTS,
    suggestion: 'Decompose story into more specific criteria',
    targetFile: 'agents/story-writer.md'
  },
  COMPONENT_REUSE_MISS: {
    ...FailureCategory.COMPONENT_REUSE_MISS,
    suggestion: 'Always check app-map.md before creating components',
    targetFile: 'decisions.md'
  },
  PATTERN_VIOLATION: {
    ...FailureCategory.PATTERN_VIOLATION,
    suggestion: 'Check decisions.md for coding patterns',
    targetFile: 'decisions.md'
  },
  EXTERNAL_DEPENDENCY: {
    // Combines EXTERNAL_DEPENDENCY, RATE_LIMIT, and API_ERROR
    patterns: [
      ...FailureCategory.EXTERNAL_DEPENDENCY.patterns,
      ...FailureCategory.RATE_LIMIT.patterns,
      ...FailureCategory.API_ERROR.patterns
    ],
    description: 'Waiting on CI/tests/external systems',
    severity: FailureCategory.EXTERNAL_DEPENDENCY.severity,
    escalate: false,
    strategy: 'wait_retry',
    suggestion: 'Consider async suspension for external dependencies',
    targetFile: 'config.json'
  },
  SYNTAX_ISSUES: {
    ...FailureCategory.SYNTAX_ERROR,
    suggestion: 'Validate code before saving',
    targetFile: 'decisions.md'
  },
  // Additional categories from centralized module
  IMPORT_ERROR: {
    ...FailureCategory.IMPORT_ERROR,
    suggestion: 'Check import paths and available exports',
    targetFile: 'decisions.md'
  },
  HALLUCINATION: {
    ...FailureCategory.HALLUCINATION,
    suggestion: 'Use only explicitly provided context',
    targetFile: 'decisions.md'
  },
  CONTEXT_OVERFLOW: {
    ...FailureCategory.CONTEXT_OVERFLOW,
    suggestion: 'Use /wogi-compact before large tasks',
    targetFile: 'config.json'
  },
  CAPABILITY_MISMATCH: {
    ...FailureCategory.CAPABILITY_MISMATCH,
    suggestion: 'Consider using a more capable model for complex tasks',
    targetFile: 'config.json'
  }
};

// ============================================================================
// Core Analysis Functions
// ============================================================================

/**
 * Check if learning should be triggered for this session
 * @param {Object} session - Completed durable session
 * @returns {boolean}
 */
function shouldTriggerLearning(session) {
  if (!session) return false;

  const config = getConfig();
  const threshold = config.skillLearning?.loopRetryThreshold || 3;

  // Check iteration count
  const iterations = session.execution?.iteration || 0;
  if (iterations <= threshold) {
    return false;
  }

  // Check if learning is enabled
  if (config.skillLearning?.learnFromLoopRetries === false) {
    return false;
  }

  // Only analyze completed sessions
  if (session.status !== 'completed') {
    return false;
  }

  return true;
}

/**
 * Extract failure patterns from session steps
 * @param {Array} steps - Session steps with attempt history
 * @returns {Object} Grouped failure patterns
 */
function extractFailurePatterns(steps) {
  const patterns = {
    byCategory: {},
    errors: [],
    stepFailures: []
  };

  for (const step of steps) {
    // Check step error
    if (step.error) {
      patterns.errors.push({
        stepId: step.id,
        error: step.error,
        attempts: step.attempts
      });
    }

    // Track steps that needed multiple attempts
    if (step.attempts > 1) {
      patterns.stepFailures.push({
        stepId: step.id,
        description: step.description,
        attempts: step.attempts,
        error: step.error
      });
    }
  }

  return patterns;
}

/**
 * Categorize the root cause of high iterations
 * @param {Object} patterns - Extracted failure patterns
 * @param {Object} session - Full session data
 * @returns {Object} Root cause analysis
 */
function categorizeRootCause(patterns, session) {
  const allErrors = patterns.errors
    .map(e => typeof e.error === 'string' ? e.error : JSON.stringify(e.error))
    .join('\n');

  const analysis = {
    categories: [],
    primaryCategory: null,
    confidence: 0,
    details: {}
  };

  // Check each category
  for (const [category, config] of Object.entries(ROOT_CAUSE_CATEGORIES)) {
    for (const pattern of config.patterns) {
      if (pattern.test(allErrors)) {
        analysis.categories.push({
          category,
          description: config.description,
          suggestion: config.suggestion,
          targetFile: config.targetFile,
          matchCount: (allErrors.match(new RegExp(pattern.source, 'gi')) || []).length
        });
        break;
      }
    }
  }

  // Set primary category (highest match count)
  if (analysis.categories.length > 0) {
    analysis.categories.sort((a, b) => b.matchCount - a.matchCount);
    analysis.primaryCategory = analysis.categories[0].category;
    analysis.confidence = Math.min(analysis.categories[0].matchCount / 3, 1);
  } else {
    // Default to validation failures if we had retries but couldn't categorize
    if (session.execution.totalRetries > 0) {
      analysis.primaryCategory = 'VALIDATION_FAILURES';
      analysis.confidence = 0.3;
      analysis.categories.push({
        category: 'VALIDATION_FAILURES',
        description: ROOT_CAUSE_CATEGORIES.VALIDATION_FAILURES.description,
        suggestion: ROOT_CAUSE_CATEGORIES.VALIDATION_FAILURES.suggestion,
        targetFile: ROOT_CAUSE_CATEGORIES.VALIDATION_FAILURES.targetFile,
        matchCount: 0
      });
    }
  }

  // Add session-level details
  analysis.details = {
    totalIterations: session.execution.iteration,
    totalRetries: session.execution.totalRetries,
    failedSteps: patterns.stepFailures.length,
    errorCount: patterns.errors.length
  };

  return analysis;
}

/**
 * Generate learning entry from analysis
 * @param {Object} rootCause - Root cause analysis
 * @param {Object} session - Session data
 * @returns {Object} Learning entry
 */
function generateLearning(rootCause, session) {
  if (!rootCause.primaryCategory) {
    return null;
  }

  const categoryConfig = ROOT_CAUSE_CATEGORIES[rootCause.primaryCategory];
  const date = new Date().toISOString().split('T')[0];

  return {
    timestamp: new Date().toISOString(),
    date,
    taskId: session.taskId,
    iterations: session.execution.iteration,
    retries: session.execution.totalRetries,
    rootCause: rootCause.primaryCategory,
    confidence: rootCause.confidence,
    pattern: categoryConfig.description,
    suggestion: categoryConfig.suggestion,
    targetFile: categoryConfig.targetFile,
    applied: false,
    details: rootCause.details
  };
}

/**
 * Check if similar learning exists (deduplication)
 * @param {string} rootCause - Root cause category
 * @param {string} taskId - Task ID
 * @returns {boolean}
 */
function isDuplicateLearning(rootCause, taskId) {
  if (!fs.existsSync(LEARNING_LOG_PATH)) {
    return false;
  }

  try {
    const log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));
    const loopLearnings = log.loopRetryLearnings || [];

    // Check for same root cause in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString();

    return loopLearnings.some(l =>
      l.rootCause === rootCause &&
      l.timestamp >= cutoffDate
    );
  } catch {
    return false;
  }
}

/**
 * Store learning to adaptive-learning.json
 * @param {Object} learning - Learning entry
 */
function storeLearning(learning) {
  let log = { entries: [], loopRetryLearnings: [] };

  if (fs.existsSync(LEARNING_LOG_PATH)) {
    try {
      log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));
      if (!log.loopRetryLearnings) {
        log.loopRetryLearnings = [];
      }
    } catch {
      log = { entries: [], loopRetryLearnings: [] };
    }
  }

  log.loopRetryLearnings.push(learning);

  // Keep last 50 learnings
  if (log.loopRetryLearnings.length > 50) {
    log.loopRetryLearnings = log.loopRetryLearnings.slice(-50);
  }

  // Ensure directory exists
  const dir = path.dirname(LEARNING_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(LEARNING_LOG_PATH, JSON.stringify(log, null, 2));
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Analyze a completed session for learnings
 * @param {Object} session - Completed durable session
 * @returns {Object} Analysis result
 */
async function analyzeCompletedSession(session) {
  // Check if we should analyze
  if (!shouldTriggerLearning(session)) {
    return { analyzed: false, reason: 'threshold-not-met' };
  }

  // Extract failure patterns
  const patterns = extractFailurePatterns(session.steps);

  // Categorize root cause
  const rootCause = categorizeRootCause(patterns, session);

  if (!rootCause.primaryCategory) {
    return { analyzed: false, reason: 'no-root-cause-identified' };
  }

  // Check for duplicate
  if (isDuplicateLearning(rootCause.primaryCategory, session.taskId)) {
    return {
      analyzed: false,
      reason: 'duplicate-learning',
      rootCause: rootCause.primaryCategory
    };
  }

  // Generate and store learning
  const learning = generateLearning(rootCause, session);
  if (learning) {
    storeLearning(learning);

    // Log to console
    console.log(`${colors.cyan}   📚 Loop Retry Learning${colors.reset}`);
    console.log(`   Task took ${session.execution.iteration} iterations`);
    console.log(`   Root cause: ${rootCause.primaryCategory}`);
    console.log(`   Suggestion: ${learning.suggestion}`);

    return {
      analyzed: true,
      learning,
      suggestion: formatSuggestion(learning)
    };
  }

  return { analyzed: false, reason: 'no-learning-generated' };
}

/**
 * Format suggestion for display
 * @param {Object} learning - Learning entry
 * @returns {string} Formatted suggestion
 */
function formatSuggestion(learning) {
  const categoryConfig = ROOT_CAUSE_CATEGORIES[learning.rootCause];
  if (!categoryConfig) return '';

  let suggestion = `\n💡 **Learning from ${learning.taskId}**\n`;
  suggestion += `   Problem: ${categoryConfig.description}\n`;
  suggestion += `   Suggestion: ${categoryConfig.suggestion}\n`;

  if (learning.targetFile) {
    suggestion += `   Update: Consider adding to ${learning.targetFile}\n`;
  }

  return suggestion;
}

/**
 * Get learning statistics
 * @returns {Object} Stats
 */
function getLearningStats() {
  if (!fs.existsSync(LEARNING_LOG_PATH)) {
    return { total: 0, byCategory: {}, recentLearnings: [], avgIterations: 0 };
  }

  try {
    const log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));
    const learnings = log.loopRetryLearnings || [];

    const byCategory = {};
    for (const l of learnings) {
      byCategory[l.rootCause] = (byCategory[l.rootCause] || 0) + 1;
    }

    return {
      total: learnings.length,
      byCategory,
      recentLearnings: learnings.slice(-5),
      avgIterations: learnings.length > 0
        ? Math.round(learnings.reduce((sum, l) => sum + l.iterations, 0) / learnings.length * 10) / 10
        : 0
    };
  } catch {
    return { total: 0, byCategory: {}, recentLearnings: [], avgIterations: 0 };
  }
}

/**
 * Get unapplied learning suggestions
 * @returns {Array} Suggestions that haven't been applied
 */
function getUnappliedSuggestions() {
  if (!fs.existsSync(LEARNING_LOG_PATH)) {
    return [];
  }

  try {
    const log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));
    const learnings = log.loopRetryLearnings || [];

    return learnings
      .filter(l => !l.applied)
      .map(l => ({
        taskId: l.taskId,
        rootCause: l.rootCause,
        suggestion: l.suggestion,
        targetFile: l.targetFile,
        date: l.date
      }));
  } catch {
    return [];
  }
}

/**
 * Mark a learning as applied
 * @param {string} taskId - Task ID of the learning to mark
 * @returns {boolean} Success
 */
function markLearningApplied(taskId) {
  if (!fs.existsSync(LEARNING_LOG_PATH)) {
    return false;
  }

  try {
    const log = JSON.parse(fs.readFileSync(LEARNING_LOG_PATH, 'utf-8'));
    const learning = (log.loopRetryLearnings || []).find(l => l.taskId === taskId);

    if (learning) {
      learning.applied = true;
      learning.appliedAt = new Date().toISOString();
      fs.writeFileSync(LEARNING_LOG_PATH, JSON.stringify(log, null, 2));
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Core functions
  analyzeCompletedSession,
  shouldTriggerLearning,
  extractFailurePatterns,
  categorizeRootCause,
  generateLearning,

  // Storage
  storeLearning,
  isDuplicateLearning,

  // Utilities
  formatSuggestion,
  getLearningStats,
  getUnappliedSuggestions,
  markLearningApplied,

  // Constants
  ROOT_CAUSE_CATEGORIES,

  // Re-export centralized failure categories
  FailureCategory,
  detectCategory
};

// ============================================================================
// CLI Interface
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'stats': {
      const stats = getLearningStats();
      console.log('\n📊 Loop Retry Learning Statistics');
      console.log('─'.repeat(40));
      console.log(`Total learnings: ${stats.total}`);
      console.log(`Avg iterations when triggered: ${stats.avgIterations}`);
      console.log('');
      console.log('By category:');
      for (const [cat, count] of Object.entries(stats.byCategory)) {
        const config = ROOT_CAUSE_CATEGORIES[cat];
        console.log(`  ${cat}: ${count}`);
        if (config) {
          console.log(`    └─ ${config.description}`);
        }
      }
      console.log('─'.repeat(40));
      break;
    }

    case 'suggestions': {
      const suggestions = getUnappliedSuggestions();
      if (suggestions.length === 0) {
        console.log('\n✅ No unapplied suggestions');
        break;
      }

      console.log('\n💡 Unapplied Learning Suggestions');
      console.log('─'.repeat(40));
      for (const s of suggestions) {
        console.log(`\n📝 ${s.taskId} (${s.date})`);
        console.log(`   Root cause: ${s.rootCause}`);
        console.log(`   Suggestion: ${s.suggestion}`);
        console.log(`   Update: ${s.targetFile}`);
      }
      console.log('─'.repeat(40));
      break;
    }

    case 'test': {
      // Test with mock session
      const mockSession = {
        taskId: 'TASK-TEST',
        status: 'completed',
        execution: {
          iteration: 5,
          totalRetries: 8
        },
        steps: [
          { id: 'step-001', error: 'Type error: property does not exist', attempts: 3 },
          { id: 'step-002', error: 'TypeScript error TS2339', attempts: 2 },
          { id: 'step-003', error: null, attempts: 1 }
        ]
      };

      console.log('\n🧪 Testing with mock session');
      console.log('─'.repeat(40));
      console.log(`Task: ${mockSession.taskId}`);
      console.log(`Iterations: ${mockSession.execution.iteration}`);
      console.log(`Retries: ${mockSession.execution.totalRetries}`);
      console.log('');

      const patterns = extractFailurePatterns(mockSession.steps);
      console.log('Extracted patterns:', JSON.stringify(patterns, null, 2));

      const rootCause = categorizeRootCause(patterns, mockSession);
      console.log('\nRoot cause analysis:', JSON.stringify(rootCause, null, 2));

      const learning = generateLearning(rootCause, mockSession);
      console.log('\nGenerated learning:', JSON.stringify(learning, null, 2));
      console.log('─'.repeat(40));
      break;
    }

    default:
      console.log(`
Wogi Flow - Loop Retry Learning

Usage:
  node flow-loop-retry-learning.js <command>

Commands:
  stats        Show learning statistics
  suggestions  Show unapplied learning suggestions
  test         Test with mock session data

This module analyzes tasks that take >3 iterations and:
1. Identifies root causes (validation failures, missing context, etc.)
2. Stores learnings for pattern improvement
3. Suggests updates to decisions.md or other config files
`);
  }
}
